/**
 * Posting a video to X through API v2, by hand with fetch, after
 * news-community's marketing publisher (src/channels/x.ts):
 *
 * - OAuth 1.0a user context, signed here with HMAC-SHA1. The query is
 *   signed; JSON and multipart bodies are not.
 * - A chunked upload: initialize (the declaration), append (4 MiB segments,
 *   safe to repeat by segment index), finalize, then STATUS polled until the
 *   transcode lands. Attaching a media id before then posts no video, and
 *   nothing in the reply says so.
 * - The post itself is not retried: X has no idempotency key.
 *
 * How long a video may be depends on the account: 140 seconds without
 * Premium, so the cut (cut.js) is then the piece's opening and the post links
 * to the whole; with Premium the whole piece, as on YouTube. The account is
 * asked once a run (limits()), so a lapsed subscription falls back to the
 * opening rather than failing. X bills per post, more for one carrying a
 * link (about $0.20 in October 2026, against $0.015), and a little for the
 * account read: check the developer console before a large batch.
 */

const fs = require('fs');
const { createHmac, randomBytes } = require('crypto');
const { request } = require('./request');

const TWEETS = 'https://api.x.com/2/tweets';
const MEDIA = 'https://api.x.com/2/media/upload';
const CHUNK = 4 * 1024 * 1024;
const LIMITS = { name: 'x', maxSeconds: 140, maxBytes: 512 * 1000 * 1000 };
// With Premium: twenty minutes within the 512 MB a video may weigh, more
// than any of the sanctuary's pieces needs.
const PREMIUM_LIMITS = { name: 'x', maxSeconds: 20 * 60, maxBytes: 512 * 1000 * 1000 };
const TEXT_MAX = 280;
// X counts every link as 23 characters, whatever its length.
const LINK_LENGTH = 23;

function credentials() {
  const { X_API_KEY: apiKey, X_API_SECRET: apiSecret, X_ACCESS_TOKEN: token, X_ACCESS_SECRET: tokenSecret } = process.env;
  if (!apiKey || !apiSecret || !token || !tokenSecret) throw new Error('X needs X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_SECRET in app/.env');
  return { apiKey, apiSecret, token, tokenSecret };
}

const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The Authorization header for one request. `url` is bare, its query passed
 * as `params`, which are signed; a JSON or multipart body is not.
 */
function oauthHeader(method, url, creds, params = {}, fixed = {}) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: fixed.nonce || randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: fixed.timestamp || String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: '1.0'
  };
  const paramString = Object.entries({ ...oauth, ...params })
    .map(([k, v]) => [rfc3986(k), rfc3986(String(v))])
    .sort(([ka, va], [kb, vb]) => (ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const base = [method.toUpperCase(), rfc3986(url), rfc3986(paramString)].join('&');
  oauth.oauth_signature = createHmac('sha1', `${rfc3986(creds.apiSecret)}&${rfc3986(creds.tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries(oauth).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`).join(', ');
}

// v2 sometimes wraps its answer in data and sometimes not.
const unwrap = (json) => (json && json.data ? json.data : json);

async function upload(file, creds, log) {
  const size = fs.statSync(file).size;
  const init = `${MEDIA}/initialize`;
  const started = unwrap(await (await request(init, {
    method: 'POST',
    headers: { Authorization: oauthHeader('POST', init, creds), 'content-type': 'application/json' },
    body: JSON.stringify({ media_category: 'tweet_video', media_type: 'video/mp4', total_bytes: size }),
    retry: true
  })).json());
  const id = started.id || started.media_id_string;
  if (!id) throw new Error('x: initialize returned no media id');
  const handle = fs.openSync(file, 'r');
  try {
    for (let i = 0, offset = 0; offset < size; i++, offset += CHUNK) {
      const length = Math.min(CHUNK, size - offset);
      const chunk = Buffer.alloc(length);
      fs.readSync(handle, chunk, 0, length, offset);
      const form = new FormData();
      form.set('segment_index', String(i));
      form.set('media', new Blob([chunk], { type: 'video/mp4' }), 'video.mp4');
      const append = `${MEDIA}/${id}/append`;
      await request(append, { method: 'POST', headers: { Authorization: oauthHeader('POST', append, creds) }, body: form, retry: true, timeoutMs: 120000 });
    }
  } finally {
    fs.closeSync(handle);
  }
  const finalize = `${MEDIA}/${id}/finalize`;
  let processing = unwrap(await (await request(finalize, { method: 'POST', headers: { Authorization: oauthHeader('POST', finalize, creds) }, retry: true })).json()).processing_info;
  const deadline = Date.now() + 10 * 60000;
  while (processing && processing.state !== 'succeeded') {
    if (processing.state === 'failed') throw new Error(`x: processing failed: ${processing.error?.message || 'no reason given'}`);
    if (Date.now() > deadline) throw new Error(`x: still ${processing.state} after 10 minutes`);
    await new Promise(r => setTimeout(r, Math.max(2, processing.check_after_secs || 0) * 1000));
    const params = { command: 'STATUS', media_id: id };
    processing = unwrap(await (await request(`${MEDIA}?${new URLSearchParams(params)}`, { headers: { Authorization: oauthHeader('GET', MEDIA, creds, params) }, retry: true })).json()).processing_info;
  }
  log('  x: the video is ready');
  return id;
}

let account = null;

// The limits for this account, asked of X once a run.
async function limits() {
  if (!account) {
    const creds = credentials();
    const url = 'https://api.x.com/2/users/me';
    const params = { 'user.fields': 'subscription_type' };
    account = unwrap(await (await request(`${url}?${new URLSearchParams(params)}`, { headers: { Authorization: oauthHeader('GET', url, creds, params) }, retry: true })).json());
  }
  return account.subscription_type === 'Premium' || account.subscription_type === 'PremiumPlus' ? PREMIUM_LIMITS : LIMITS;
}

// The post: the copy's hook and two hashtags (three or more read as spam).
// No link: a link costs reach and about $0.20 a post; it goes in the reply.
function postText(meta) {
  return `${meta.copy.hook}\n\n${meta.copy.tags.slice(0, 2).map(t => `#${t}`).join(' ')}`;
}

// The reply that carries the link to the whole piece.
const replyText = (meta, link) => `${/youtube\.com|youtu\.be/.test(link) ? `${meta.copy.title}, the whole video` : `${meta.copy.title}, its words and recording`}: ${link}`;

/**
 * Post the video (its cut) with the hook and two hashtags, then reply with
 * the link to the whole piece. Returns { id, url, reply }.
 */
async function publish({ file, meta, link, log = console.log }) {
  const creds = credentials();
  log('  x: uploading');
  const mediaId = await upload(file, creds, log);
  const post = (body) => request(TWEETS, {
    method: 'POST',
    headers: { Authorization: oauthHeader('POST', TWEETS, creds), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(res => res.json()).then(unwrap);
  const { id } = await post({ text: postText(meta), media: { media_ids: [mediaId] } });
  const url = `https://x.com/i/status/${id}`;
  // The post stands without its reply; a reply that fails is reported, and
  // the post is not made again.
  let reply = null;
  try {
    reply = (await post({ text: replyText(meta, link), reply: { in_reply_to_tweet_id: id } })).id;
  } catch (err) {
    log(`  x: the post is up, its link reply failed: ${err.message.slice(0, 160)}`);
  }
  return { id, url, reply };
}

module.exports = { publish, oauthHeader, postText, replyText, limits };
