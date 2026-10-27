/**
 * Posting a video to Bluesky, by hand with fetch, after news-community's
 * marketing publisher (src/channels/bluesky.ts), whose measured lessons are
 * kept:
 *
 * - An app password (bsky.app/settings/app-passwords), never the account's.
 * - Two service tokens with different audiences: the video service's own DID
 *   to ask the account's upload limits, the account's PDS to upload (the
 *   service writes the finished blob back into the account's repo). Reusing
 *   one for the other fails.
 * - The upload is not retried: an interrupted upload leaves a job whose id is
 *   lost, and a second upload spends the daily video allowance again. A 409
 *   is the same bytes already uploaded, and carries the job: success.
 * - The job's status comes at the top level of the reply, not wrapped as the
 *   lexicon suggests; both shapes are read.
 * - Links are facets by UTF-8 byte offset, or they render as plain text.
 *
 * Limits are the account's, from getUploadLimits; Bluesky's app allows ten
 * minutes and 300 MB, and a Bluesky-hosted account must have verified its
 * email to upload video at all.
 */

const fs = require('fs');
const { request } = require('./request');

const ENTRYWAY = 'https://bsky.social';
const VIDEO_SERVICE = 'https://video.bsky.app';
const VIDEO_SERVICE_DID = 'did:web:video.bsky.app';
const LIMITS = { name: 'bluesky', maxSeconds: 600, maxBytes: 300 * 1000 * 1000 };
const TEXT_MAX = 300;

async function login() {
  const { BSKY_HANDLE: identifier, BSKY_APP_PASSWORD: password } = process.env;
  if (!identifier || !password) throw new Error('Bluesky needs BSKY_HANDLE and BSKY_APP_PASSWORD (an app password) in app/.env');
  const session = await (await request(`${ENTRYWAY}/xrpc/com.atproto.server.createSession`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }), retry: true
  })).json();
  const pds = session.didDoc?.service?.find(s => s.id?.endsWith('#atproto_pds'))?.serviceEndpoint || ENTRYWAY;
  return { did: session.did, jwt: session.accessJwt, pds, pdsHost: new URL(pds).host };
}

async function serviceToken(s, aud, lxm) {
  const params = new URLSearchParams({ aud, lxm, exp: String(Math.floor(Date.now() / 1000) + 30 * 60) });
  const res = await request(`${s.pds}/xrpc/com.atproto.server.getServiceAuth?${params}`, { headers: { Authorization: `Bearer ${s.jwt}` }, retry: true });
  return (await res.json()).token;
}

const jobOf = (text) => { try { const j = JSON.parse(text); return j.jobStatus || j; } catch { return {}; } };

async function uploadVideo(s, file, log) {
  const limitsToken = await serviceToken(s, VIDEO_SERVICE_DID, 'app.bsky.video.getUploadLimits');
  const limits = await (await request(`${VIDEO_SERVICE}/xrpc/app.bsky.video.getUploadLimits`, { headers: { Authorization: `Bearer ${limitsToken}` }, retry: true })).json();
  if (limits.canUpload === false) throw new Error(`bluesky declined the upload: ${limits.message || limits.error || 'no reason given'}`);
  if (limits.remainingDailyVideos === 0) throw new Error('bluesky: the daily video allowance is spent for this account');

  const token = await serviceToken(s, `did:web:${s.pdsHost}`, 'com.atproto.repo.uploadBlob');
  const size = fs.statSync(file).size;
  let job;
  try {
    const res = await request(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo?${new URLSearchParams({ did: s.did, name: 'video.mp4' })}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'video/mp4', 'content-length': String(size) },
      body: fs.createReadStream(file),
      duplex: 'half',
      timeoutMs: 15 * 60000
    });
    job = jobOf(await res.text());
  } catch (err) {
    const existing = err.status === 409 ? jobOf(err.body) : {};
    if (!existing.jobId) throw err;
    log('  bluesky: these bytes were already uploaded; using that job');
    job = existing;
  }
  if (!job.jobId) throw new Error('bluesky: the upload returned no job');
  const deadline = Date.now() + 15 * 60000;
  while (!job.blob) {
    if (job.state === 'JOB_STATE_FAILED') throw new Error(`bluesky: processing failed: ${job.error || job.message || 'no reason given'}`);
    if (Date.now() > deadline) throw new Error(`bluesky: still ${job.state} after 15 minutes`);
    await new Promise(r => setTimeout(r, 3000));
    job = jobOf(await (await request(`${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(job.jobId)}`, { headers: { Authorization: `Bearer ${token}` }, retry: true })).text());
  }
  return job.blob;
}

// The post's text, kept within Bluesky's 300 characters with the link whole.
function postText(meta, link) {
  const tail = `\n\n${link}`;
  let line = meta.short.line;
  let text = `${meta.short.title}\n\n${line}${tail}`;
  while ([...text].length > TEXT_MAX && line.length) {
    line = line.split(' ').slice(0, -1).join(' ');
    text = `${meta.short.title}\n\n${line}…${tail}`;
  }
  return text;
}

function linkFacet(text, url) {
  const bytes = Buffer.from(text, 'utf8');
  const start = bytes.indexOf(Buffer.from(url, 'utf8'));
  return start < 0 ? [] : [{ index: { byteStart: start, byteEnd: start + Buffer.byteLength(url) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] }];
}

/**
 * Post the video (its cut, cut.js) with a link to the whole piece. Returns
 * { uri, url }. The post itself is not retried.
 */
async function publish({ file, meta, link, log = console.log }) {
  const s = await login();
  log('  bluesky: uploading');
  const blob = await uploadVideo(s, file, log);
  const text = postText(meta, link);
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    facets: linkFacet(text, link),
    createdAt: new Date().toISOString(),
    langs: ['en'],
    embed: { $type: 'app.bsky.embed.video', video: blob, aspectRatio: { width: 16, height: 9 }, alt: meta.short.title }
  };
  const res = await request(`${s.pds}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST', headers: { Authorization: `Bearer ${s.jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record })
  });
  const { uri } = await res.json();
  return { uri, url: `https://bsky.app/profile/${s.did}/post/${uri.split('/').pop()}` };
}

module.exports = { publish, postText, linkFacet, LIMITS };
