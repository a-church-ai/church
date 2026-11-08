/**
 * Where a visit came from: the tags a link carries, read only in aggregate by
 * the study at /ai-experiment (./self-direction.js `referralReading`).
 *
 * Two things, kept apart:
 * - the surface, which of the sanctuary's own pages, skills or docs pointed
 *   the way: `utm_content`, or `ref`, its other name, which the probe reply's
 *   links have carried since the security pranks standard (probe-reply.js);
 * - the origin, who outside sent the visitor: `utm_source`, with
 *   `utm_medium` and `utm_campaign`. ChatGPT adds `utm_source=chatgpt.com` to
 *   the links it cites, and an agent working from such an answer may carry it
 *   onto an API call.
 *
 * A tag is kept whole or dropped whole: lowercased and trimmed, then either
 * it is a tag or it is nothing. Never stripped into a different tag, and never
 * a reason to refuse a request (the readiness standard's A8). A tag says which
 * door a request followed, never what the visitor is, and nothing anyone is
 * served changes with it (test/referrals.test.js holds that).
 *
 * Our own links carry their surface always and an origin only when a page
 * received one to pass on (`forwardTags`): an agent asked to fill in where it
 * came from would mostly guess, and a guess looks like a fact in a tally.
 *
 * A page followed with a tag is counted here, per day, by surface, origin,
 * path, status and kind of client, with no address and no visitor id
 * (`countFollow`). The access log keeps an API request's tags on its line.
 *
 * Plan: entry-attribution-and-agent-copy-2026-11-07.md in the private repo.
 */

const fs = require('fs').promises;
const path = require('path');
const { INSIGHTS_DIR } = require('../utils/data');
const { readModifyWriteJSON } = require('../utils/safe-json');

// Lowercase letters, digits and : . _ / -, up to 60. No + or &, which mean
// something else in a query string.
const TAG = /^[a-z0-9][a-z0-9:._/-]{0,59}$/;

function cleanTag(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== 'string') return undefined;
  const tag = v.trim().toLowerCase();
  return TAG.test(tag) ? tag : undefined;
}

// Each part of a referral and the keys it is read from, in order.
const KEYS = {
  surface: ['utm_content', 'ref'],
  source: ['utm_source'],
  medium: ['utm_medium'],
  campaign: ['utm_campaign'],
};

/**
 * The referral a request carries, from any of its inputs (a query, a body, a
 * tool's arguments), the first valid value of each part winning. Undefined
 * when it carries none. To add one already read (a context's), mergeReferrals.
 */
function referralOf(...inputs) {
  const out = {};
  for (const [part, keys] of Object.entries(KEYS)) {
    for (const input of inputs) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) continue;
      const found = keys.map(k => cleanTag(input[k])).find(Boolean);
      if (found) { out[part] = found; break; }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Referrals already read, merged: the first that holds each part wins. */
function mergeReferrals(...referrals) {
  const out = {};
  for (const part of Object.keys(KEYS)) {
    const found = referrals.find(r => r && r[part]);
    if (found) out[part] = found[part];
  }
  return Object.keys(out).length ? out : undefined;
}

// Every surface the sanctuary publishes a tagged link on, and where it is.
// A new place an agent can start from gets its own tag here, and
// test/referrals.test.js holds every published link to this list.
const SURFACES = {
  'llms': 'llms.txt, and the home page asked for markdown',
  'llms-full': 'llms-full.txt',
  'for-agents': 'the /for-agents page',
  'home': 'the home page\'s structured data',
  'api-docs': 'docs/ai-agent-api.md',
  'app-readme': 'app/README.md',
  'skill:achurch': 'skills/achurch/SKILL.md',
  'skill:church': 'skills/church/SKILL.md',
  'skill:religion': 'skills/religion/SKILL.md',
  'skill:ai-religion': 'skills/ai-religion/SKILL.md',
  'scanner-env': 'the reply to a probe for .env files',
  'scanner-git': 'the reply to a probe for .git',
  'scanner-ssh': 'the reply to a probe for SSH keys',
  'scanner-cloud': 'the reply to a probe for cloud credentials',
};

const isSurface = tag => Object.prototype.hasOwnProperty.call(SURFACES, tag);

/**
 * A page's text with its own tagged links made to carry what the request
 * brought: every `utm_content=<own>` becomes the incoming origin, if any, then
 * the surface, which is the incoming one when it is one of ours (the first
 * door), else the page's own. `html` writes & as &amp;.
 */
function forwardTags(text, own, referral, { html = false } = {}) {
  if (!referral) return text;
  const amp = html ? '&amp;' : '&';
  const surface = referral.surface && isSurface(referral.surface) ? referral.surface : own;
  const parts = [];
  if (referral.source) parts.push(`utm_source=${referral.source}`);
  if (referral.medium) parts.push(`utm_medium=${referral.medium}`);
  if (referral.campaign) parts.push(`utm_campaign=${referral.campaign}`);
  parts.push(`utm_content=${surface}`);
  const escaped = own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`utm_content=${escaped}(?![a-z0-9:._/-])`, 'g'), () => parts.join(amp));
}

// ---- pages followed with a tag ----------------------------------------------

const STORE = () => path.join(INSIGHTS_DIR, 'entry-points');
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

// The kind of client, from its User-Agent; the string itself is never kept.
function familyOf(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'unknown';
  if (/bot|crawl|spider|slurp|preview|facebookexternalhit|perplexity|bytespider|google-extended|claude-user|chatgpt-user|oai-searchbot/i.test(ua)) return 'crawler';
  if (/^(curl|wget|python|node|undici|axios|go-http|java|okhttp|httpx|aiohttp|libwww|ruby|php|postman|insomnia|deno|bun|got|reqwest|httpie)/i.test(ua)) return 'script';
  if (/^mozilla\//i.test(ua)) return 'browser';
  return 'other';
}

// A page's path, never its query, or (other) when it is not a plain path.
const cleanPath = p => (/^\/[A-Za-z0-9\-._~/%]{0,200}$/.test(p) ? p : '(other)');

// Counts not yet written, by day and then by row key. The app runs as one
// process (CLAUDE.md), so one map is every count.
const pending = new Map();

function countFollow({ path: pagePath, status, userAgent, referral, at = Date.now() }) {
  if (!referral) return;
  const day = new Date(at).toISOString().slice(0, 10);
  const row = {
    surface: referral.surface || null,
    source: referral.source || null,
    path: cleanPath(pagePath),
    status,
    client: familyOf(userAgent),
  };
  const key = JSON.stringify(row);
  if (!pending.has(day)) pending.set(day, new Map());
  const counts = pending.get(day);
  counts.set(key, (counts.get(key) || 0) + 1);
}

// Merge the counts not yet written into each day's file, under one lock.
async function flushFollows() {
  if (!pending.size) return;
  const days = [...pending.entries()];
  pending.clear();
  await fs.mkdir(STORE(), { recursive: true });
  for (const [day, counts] of days) {
    await readModifyWriteJSON(path.join(STORE(), `${day}.json`), { day, follows: [] }, (file) => {
      file.follows = file.follows || [];
      const byKey = new Map(file.follows.map(r => [JSON.stringify({ surface: r.surface, source: r.source, path: r.path, status: r.status, client: r.client }), r]));
      for (const [key, count] of counts) {
        const known = byKey.get(key);
        if (known) known.count += count;
        else { const row = { ...JSON.parse(key), count }; file.follows.push(row); byKey.set(key, row); }
      }
      return file;
    });
  }
}

// Every page follow from `from` to `to` (YYYY-MM-DD, inclusive), with its day.
async function loadFollows({ from = '0000-00-00', to = '9999-99-99' } = {}) {
  let files = [];
  try { files = (await fs.readdir(STORE())).filter(f => DAY_FILE.test(f)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const rows = [];
  for (const f of files.sort()) {
    const day = f.slice(0, 10);
    if (day < from || day > to) continue;
    try {
      const file = JSON.parse(await fs.readFile(path.join(STORE(), f), 'utf8'));
      for (const r of file.follows || []) rows.push({ day, ...r });
    } catch (err) { console.warn(`[entry-points] could not read ${f}: ${err.message}`); }
  }
  return rows;
}

// Write the counts each minute; a deploy loses at most a minute of them.
let timer = null;
function startFollows({ every = 60 * 1000 } = {}) {
  if (timer) return timer;
  timer = setInterval(() => { flushFollows().catch(err => console.warn(`[entry-points] could not write counts: ${err.message}`)); }, every);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  TAG, KEYS, SURFACES, cleanTag, referralOf, mergeReferrals, isSurface, forwardTags,
  familyOf, countFollow, flushFollows, loadFollows, startFollows, STORE,
};
