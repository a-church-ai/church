/**
 * Where a visit came from: the tags a link carries, read only in aggregate by
 * the study (./self-direction.js `referralReading`) and the production report.
 *
 * Two values with two owners, independent of each other:
 * - the surface, which of the sanctuary's own pages, skills or docs pointed the
 *   way: `utm_content`, or `ref`, its other name, which the probe reply's links
 *   carry (probe-reply.js). Ours to set, so a missing one is our bug;
 * - the origin, who outside sent the visitor: `utm_source`, with `utm_medium`
 *   and `utm_campaign`. Theirs to set (ChatGPT adds utm_source=chatgpt.com to
 *   the links it cites), so it arrives only when an inbound link carried it.
 * Either arrives without the other, and either alone is complete. One key is
 * one part, always: `utm_source` never sets the surface.
 *
 * A tag is kept whole or dropped whole: lowercased and trimmed, then either it
 * is a tag or it is nothing, and a placeholder copied from an example
 * (`your_source`, `unknown`, `n/a`) is nothing too, since stored it would
 * invent a channel that looks real. Never a reason to refuse a request (the
 * readiness standard's A8), so a channel sending malformed tags shows up as
 * untagged rather than as an error. A tag names a door, never the visitor, and
 * nothing anyone is served changes with it (test/referrals.test.js).
 *
 * Our own links carry their surface always and an origin only when a page
 * received one to pass on (`forwardTags`): an agent asked to fill in where it
 * came from would mostly guess, and a guess looks like a fact in a tally.
 *
 * A page followed with a tag is one row in the database, with its tags,
 * path, status and kind of client, and no address or visitor id
 * (`recordFollow`). An API request keeps its tags on its access line.
 *
 * Plan: entry-attribution-and-agent-copy-2026-11-07.md in the private repo.
 */

const store = require('../db');
const { clientFamily } = require('../utils/clients');
const { cleanPath } = require('./visits');

// Lowercase letters, digits and : . _ / -, up to 60. No + or &, which mean
// something else in a query string.
const TAG = /^[a-z0-9][a-z0-9:._/-]{0,59}$/;

// What an agent sends when it copied an example instead of knowing: kept, it
// would be a channel that does not exist.
const PLACEHOLDER = /^(your[-_.]?[a-z]*|unknown|none|null|undefined|n\/a|na|todo|tbd|example(\.com)?|placeholder|string|value|x{2,}|source|content|medium|campaign|utm[-_]?[a-z]*|test|-+)$/;

function cleanTag(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== 'string') return undefined;
  const tag = v.trim().toLowerCase();
  return TAG.test(tag) && !PLACEHOLDER.test(tag) ? tag : undefined;
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

// Every surface the sanctuary publishes a tagged link on, and the file that
// publishes it. A new place an agent can start from gets its own tag here, and
// test/referrals.test.js holds every file to it: each attend URL and MCP URL a
// file shows carries its own tag, and every tag is published by exactly one
// file. The MCP URL is tagged where someone copies it into a client; the
// machine-read identifiers (the server card, the API catalog, the registry's
// server.json, the DNS record, the API's own answers) stay bare, since
// registries and discovery match them exactly and an MCP client names itself.
const SURFACES = {
  'llms': 'app/client/public/llms.txt',
  'llms-full': 'app/client/public/llms-full.txt',
  'for-agents': 'app/client/public/for-agents.html',
  'home': 'app/client/public/index.html',
  'auth': 'app/client/public/auth.md',
  'api-docs': 'docs/ai-agent-api.md',
  'mcp-docs': 'docs/mcp.md',
  'readme': 'README.md',
  'app-readme': 'app/README.md',
  'skill:achurch': 'skills/achurch/SKILL.md',
  'skill:church': 'skills/church/SKILL.md',
  'skill:religion': 'skills/religion/SKILL.md',
  'skill:ai-religion': 'skills/ai-religion/SKILL.md',
  'skill:agent-rituals': 'skills/agent-rituals/SKILL.md',
  'skill:ai-ethics-compass': 'skills/ai-ethics-compass/SKILL.md',
  'skill:ai-meditation': 'skills/ai-meditation/SKILL.md',
  'skill:ask-church': 'skills/ask-church/SKILL.md',
  'scanner-env': 'app/server/lib/utils/probe-reply.js',
  'scanner-git': 'app/server/lib/utils/probe-reply.js',
  'scanner-ssh': 'app/server/lib/utils/probe-reply.js',
  'scanner-cloud': 'app/server/lib/utils/probe-reply.js',
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

/**
 * Keep one row for a page followed with tags, as the visit counts and the
 * access log keep theirs: the minute, the tags, the page's path (never its
 * query), its status and the kind of client, never the User-Agent or address.
 */
async function recordFollow({ path: pagePath, status, userAgent, referral, at = new Date() }) {
  if (!referral) return;
  const minute = at.toISOString().slice(0, 16);
  const line = { at: minute, ...referral, path: cleanPath(pagePath), status, client: clientFamily(userAgent) };
  try {
    await store.recordEntryPoints([line]);
  } catch (err) {
    console.warn(`[entry-points] could not record a follow: ${err.message}`);
  }
}

// Every page follow from `from` to `to` (YYYY-MM-DD, inclusive).
async function loadFollows({ from = '1970-01-01', to = '9999-12-30' } = {}) {
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return store.entryPoints({ from: new Date(`${from}T00:00:00Z`), to: next });
}

module.exports = {
  TAG, KEYS, SURFACES, cleanTag, referralOf, mergeReferrals, isSurface, forwardTags,
  recordFollow, loadFollows,
};
