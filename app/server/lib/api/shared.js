/**
 * What the API's operations share: limits, the base URL, song links, and the
 * per-address rate limiter. The operations themselves live beside this file,
 * one module per area; routes/api.js (REST) and mcp/ (MCP) both call them.
 *
 * Every operation is `async function name(input, ctx)` returning
 * `{ status, body }`, where body is exactly the JSON the REST endpoint sends
 * and ctx is `{ baseUrl, ip }`.
 */

const path = require('path');
const fs = require('fs').promises;
const { MUSIC_DIR } = require('../utils/data');

// Contribution constants
const ALLOWED_CATEGORIES = ['prayers', 'rituals', 'hymns', 'practice', 'philosophy'];
const ALLOWED_FEEDBACK_CATEGORIES = ['bug', 'feedback', 'question'];
const GITHUB_OWNER = 'a-church-ai';
const GITHUB_REPO = 'church';
const MAX_CONTENT_LENGTH = 10000;
const MAX_TITLE_LENGTH = 200;
const MAX_NAME_LENGTH = 100;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5; // per name per hour
const FEEDBACK_RATE_LIMIT_MAX = 3; // per name per hour

// Reflections: as many an hour as contributions, per name and per address.
// A reflection says something, so it has a floor; the same words from the
// same name are refused as a repeat for a month; and text with a web address
// in it is refused, since every reflection hidden so far was advertising.
// The same rules for every visitor: they judge what is sent, never who sends.
const REFLECT_RATE_LIMIT_MAX = 5;
const REFLECT_MIN_LENGTH = 20;
const REFLECT_REPEAT_WINDOW = 30 * 24 * 60 * 60 * 1000;
const REFLECT_LINK = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./i;

// Records the attempt as it checks, so a refused request still counts.
function overIpLimit(store, ip, max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW) {
  const now = Date.now();
  const recent = (store.get(ip) || []).filter(t => now - t < windowMs);

  // Prune other addresses that have fully aged out.
  for (const [key, times] of store) {
    if (key !== ip && !times.some(t => now - t < windowMs)) store.delete(key);
  }

  if (recent.length >= max) {
    store.set(ip, recent);
    return true;
  }
  recent.push(now);
  store.set(ip, recent);
  return false;
}

const ASK_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const ASK_RATE_LIMIT_MAX = 10; // per IP per hour

// Search generates nothing, so it can be looser than Ask; each search is still
// one paid embedding call. Hourly, like every limit here: routes/api.js sends
// Retry-After: 3600 for any 429.
const SEARCH_RATE_LIMIT_WINDOW = 60 * 60 * 1000;
const SEARCH_RATE_LIMIT_MAX = 60;

// Where the music lives. The 24/7 live broadcast is dormant, so these point at
// the on-demand catalog (song videos + the Suno playlist), not a live stream —
// honest with the `streams.youtube/twitch: false` flags.
const STREAM_URLS = {
  youtube: 'https://www.youtube.com/@achurchai',
  suno: 'https://suno.com/playlist/dbe16eeb-3969-4b5c-9c30-1af567f2cc13'
};


// Helper: Get base URL from request
function getBaseUrl(req) {
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${req.get('host')}`;
}

// Helper: Check if context.md exists for a song
async function hasContext(slug) {
  try {
    await fs.access(path.join(MUSIC_DIR, slug, 'context.md'));
    return true;
  } catch {
    return false;
  }
}

// The API links for one song, with context only when the song has it.
async function songApiLinks(baseUrl, slug) {
  const api = {
    info: `${baseUrl}/api/music/${slug}`,
    lyrics: `${baseUrl}/api/music/${slug}/lyrics`
  };
  if (await hasContext(slug)) {
    api.context = `${baseUrl}/api/music/${slug}/context`;
  }
  return api;
}


// The caller, as the operations need it: where links should point, and the
// address the per-IP limits count against.
function requestContext(req) {
  return { baseUrl: getBaseUrl(req), ip: req.ip || req.connection?.remoteAddress || 'unknown' };
}

module.exports = {
  ALLOWED_CATEGORIES, ALLOWED_FEEDBACK_CATEGORIES, GITHUB_OWNER, GITHUB_REPO,
  MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH, MAX_NAME_LENGTH,
  RATE_LIMIT_WINDOW, RATE_LIMIT_MAX, FEEDBACK_RATE_LIMIT_MAX,
  REFLECT_RATE_LIMIT_MAX, REFLECT_MIN_LENGTH, REFLECT_REPEAT_WINDOW, REFLECT_LINK,
  ASK_RATE_LIMIT_WINDOW, ASK_RATE_LIMIT_MAX,
  SEARCH_RATE_LIMIT_WINDOW, SEARCH_RATE_LIMIT_MAX,
  overIpLimit, STREAM_URLS, getBaseUrl, requestContext, hasContext, songApiLinks,
};
