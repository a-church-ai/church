/**
 * Publishing to YouTube through the Data API v3, by hand with fetch as
 * news-community's marketing publisher does (src/channels/youtube.ts,
 * resumable-upload.ts), whose lessons are kept here:
 *
 * - OAuth: a refresh token minted once by scripts/youtube-auth.js, with the
 *   scopes to upload, read the channel and change a video's privacy, asked
 *   for together (a token cannot gain a scope later).
 * - A resumable upload in 8 MiB chunks read from disk (a multiple of 256 KiB,
 *   as the protocol requires), never the whole file in memory. A 308 means
 *   "keep going"; after a failed chunk the server is asked how much it holds
 *   (bytes *\/total) rather than the chunk sent again blind.
 * - Before uploading, the channel's recent uploads are searched for the
 *   piece's page address in their descriptions: the local record is the thing
 *   that goes wrong (news-community uploaded 29 videos twice).
 * - Uploaded unlisted unless asked otherwise; promoted later with a read of
 *   the video's status written back whole, since videos.update replaces the
 *   part it is given.
 *
 * An API project Google has not audited has its uploads locked private until
 * it is (developers.google.com/youtube/v3/docs/videos/insert). Reusing an
 * audited project's OAuth client avoids that.
 */

const fs = require('fs');
const { request } = require('./request');
const { isShort } = require('./metadata');

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
// Asked for together when the token is minted, since a token cannot gain a
// scope later: upload, change a video, captions (force-ssl), and the
// channel's analytics, which the release schedule reads for its hours.
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/yt-analytics.readonly'];
const CHUNK = 8 * 1024 * 1024;
// YouTube's categories: Music for a song, People & Blogs for spoken pieces.
const CATEGORY = { song: '10', spoken: '22' };

/**
 * The channel's playlists, one for each kind of piece, named as the owner
 * chose on 2026-10-27 ("Church X for all"; meditations apart from the other
 * practices). A video joins its kind's when it becomes public, uploaded
 * public or promoted later, never before: anyone opening a public playlist
 * can watch an unlisted video in it, so joining at an unlisted upload would
 * undo the unlisting. A playlist missing on the channel is made, public,
 * with a line pointing to its section of the site.
 */
const PLAYLISTS = {
  song: { title: 'Church Music', path: '/music' },
  chant: { title: 'Church Chants', path: '/docs/chants' },
  prayer: { title: 'Church Prayers', path: '/docs/prayers' },
  ritual: { title: 'Church Rituals', path: '/docs/rituals' },
  meditation: { title: 'Church Meditations', path: '/docs/meditations' },
  practice: { title: 'Church Practices', path: '/docs/practice' }
};

const playlistOf = kind => PLAYLISTS[kind];

function credentials() {
  const { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret, YOUTUBE_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) throw new Error('YouTube needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN in app/.env (scripts/youtube-auth.js mints the token)');
  return { id, secret, refresh };
}

async function accessToken() {
  const { id, secret, refresh } = credentials();
  const res = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
    retry: true
  });
  return (await res.json()).access_token;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// The upload of this form among the channel's: one whose description names
// the piece's page, a Short when `short` and its full video when not, since
// both name the same page.
function matchUpload(items, page, short) {
  const hit = items.find(i => {
    const description = i.snippet?.description || '';
    return description.includes(page) && isShort(description) === short;
  });
  return hit ? hit.snippet.resourceId.videoId : null;
}

// The channel's most recent uploads (up to 50) whose descriptions name `page`,
// of the form `short` says.
async function findUpload(token, page, short) {
  const channel = await (await request(`${API}/channels?part=contentDetails&mine=true`, { headers: auth(token), retry: true })).json();
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return null;
  const items = await (await request(`${API}/playlistItems?part=snippet&maxResults=50&playlistId=${uploads}`, { headers: auth(token), retry: true })).json();
  return matchUpload(items.items || [], page, short);
}

async function uploadChunks(session, file, token, log) {
  const size = fs.statSync(file).size;
  const handle = fs.openSync(file, 'r');
  try {
    let offset = 0;
    while (offset < size) {
      const length = Math.min(CHUNK, size - offset);
      const chunk = Buffer.alloc(length);
      fs.readSync(handle, chunk, 0, length, offset);
      let res;
      try {
        res = await request(session, {
          method: 'PUT',
          headers: { ...auth(token), 'content-length': String(length), 'content-range': `bytes ${offset}-${offset + length - 1}/${size}` },
          body: chunk,
          timeoutMs: 180000
        });
      } catch (err) {
        // Ask the server how far it got, and carry on from there.
        const status = await request(session, { method: 'PUT', headers: { ...auth(token), 'content-range': `bytes */${size}` }, retry: true }).catch(() => null);
        const range = status?.headers.get('range');
        if (!status || (status.status !== 308 && !status.ok)) throw err;
        if (status.ok) return status.json();
        offset = range ? Number(range.split('-')[1]) + 1 : 0;
        log(`  youtube: resuming at ${Math.round(offset / 1048576)} MB after ${err.message.slice(0, 80)}`);
        continue;
      }
      if (res.status !== 308) return res.json();
      const range = res.headers.get('range');
      offset = range ? Number(range.split('-')[1]) + 1 : offset + length;
    }
    throw new Error('youtube: every byte was sent and no video came back');
  } finally {
    fs.closeSync(handle);
  }
}

// The channel's playlist with this title, made if there is none.
async function playlistNamed(token, { title, path }) {
  const mine = await (await request(`${API}/playlists?part=snippet&mine=true&maxResults=50`, { headers: auth(token), retry: true })).json();
  const found = (mine.items || []).find(p => p.snippet.title === title);
  if (found) return { id: found.id, made: false };
  const made = await (await request(`${API}/playlists?part=snippet,status`, {
    method: 'POST',
    headers: { ...auth(token), 'content-type': 'application/json' },
    body: JSON.stringify({ snippet: { title, description: `${title} from a Church AI + Human, a sanctuary for humans, AI and every kind of mind. https://achurch.ai${path}`, defaultLanguage: 'en' }, status: { privacyStatus: 'public' } })
  })).json();
  return { id: made.id, made: true };
}

// Add the video to its kind's playlist, unless it is there already.
async function addToPlaylist(token, videoId, kind) {
  const playlist = playlistOf(kind);
  if (!playlist) return null;
  const { id, made } = await playlistNamed(token, playlist);
  // A playlist just made is empty, and YouTube may not show it for a few
  // seconds: its list answers 404 then, so it is not asked.
  const there = !made && ((await (await request(`${API}/playlistItems?part=id&playlistId=${id}&videoId=${videoId}`, { headers: auth(token), retry: true })).json()).items || []).length > 0;
  if (!there) {
    // A 404 adds nothing, so asking again while a new playlist appears is safe.
    for (let attempt = 1; ; attempt++) {
      try {
        await request(`${API}/playlistItems?part=snippet`, {
          method: 'POST',
          headers: { ...auth(token), 'content-type': 'application/json' },
          body: JSON.stringify({ snippet: { playlistId: id, resourceId: { kind: 'youtube#video', videoId } } })
        });
        break;
      } catch (err) {
        if (err.status !== 404 || attempt >= 5) throw err;
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  return { id, title: playlist.title };
}

/**
 * Upload a video, or find it already uploaded, and put it in its kind's
 * playlist. With `publishAt` (an ISO time) it is uploaded private and YouTube
 * makes it public then, on its own; it joins its playlist after that
 * (joinPlaylist). Returns { id, url, privacy, publishAt, found, playlist }.
 */
async function publish({ file, meta, kind, privacy = 'unlisted', publishAt = null, log = console.log }) {
  const token = await accessToken();
  const existing = await findUpload(token, meta.page, isShort(meta.description));
  if (existing) return { id: existing, url: `https://www.youtube.com/watch?v=${existing}`, found: true };
  if (publishAt) privacy = 'private';
  const body = {
    snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: kind === 'song' ? CATEGORY.song : CATEGORY.spoken, defaultLanguage: 'en', defaultAudioLanguage: 'en' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, ...(publishAt ? { publishAt } : {}) }
  };
  const size = fs.statSync(file).size;
  const start = await request(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: { ...auth(token), 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(size) },
    body: JSON.stringify(body)
  });
  const session = start.headers.get('location');
  if (!session) throw new Error('youtube: the upload session came back with no address');
  log(`  youtube: uploading ${Math.round(size / 1048576)} MB`);
  const video = await uploadChunks(session, file, token, log);
  // Public at once: into its playlist now. The video is up whatever the
  // playlist does; a playlist that fails is reported, and the upload is not
  // made again.
  let playlist = null;
  if (privacy === 'public') {
    try {
      playlist = await addToPlaylist(token, video.id, kind);
    } catch (err) {
      log(`  youtube: uploaded, but adding it to its playlist failed: ${err.message.slice(0, 160)}`);
    }
  }
  return { id: video.id, url: `https://www.youtube.com/watch?v=${video.id}`, privacy: video.status?.privacyStatus || privacy, ...(publishAt ? { publishAt } : {}), found: false, playlist };
}

// A video's privacy and how far YouTube has processed it:
// { privacy, publishAt, processed } or null when it is not on the channel.
async function statusOf(id) {
  const token = await accessToken();
  const found = await (await request(`${API}/videos?part=status,processingDetails&id=${id}`, { headers: auth(token), retry: true })).json();
  const video = found.items?.[0];
  if (!video) return null;
  return { privacy: video.status.privacyStatus, publishAt: video.status.publishAt || null, processed: video.processingDetails?.processingStatus || null, rejected: video.status.rejectionReason || video.status.failureReason || null };
}

// A video now public, into its kind's playlist.
async function joinPlaylist(id, kind) {
  return addToPlaylist(await accessToken(), id, kind);
}

/**
 * Change a video's privacy, keeping the rest of its status: videos.update
 * replaces the part it is given, so what is there is read and written back.
 * Made public, it joins its kind's playlist.
 */
async function setPrivacy(id, privacy, { kind } = {}) {
  const token = await accessToken();
  const current = await (await request(`${API}/videos?part=status&id=${id}`, { headers: auth(token), retry: true })).json();
  const status = current.items?.[0]?.status;
  if (!status) throw new Error(`youtube: no video ${id} on this channel`);
  const { privacyStatus, selfDeclaredMadeForKids, embeddable, license, publicStatsViewable } = status;
  await request(`${API}/videos?part=status`, {
    method: 'PUT',
    headers: { ...auth(token), 'content-type': 'application/json' },
    body: JSON.stringify({ id, status: { privacyStatus: privacy || privacyStatus, selfDeclaredMadeForKids, embeddable, license, publicStatsViewable } })
  });
  return privacy === 'public' && kind ? addToPlaylist(token, id, kind) : null;
}

module.exports = { publish, setPrivacy, statusOf, joinPlaylist, playlistOf, matchUpload, SCOPES };
