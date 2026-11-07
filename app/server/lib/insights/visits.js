/**
 * The website's visits: what a browser reports of its own visit (a page
 * viewed, a recording heard, a service followed), kept so the sanctuary can
 * see how its services and pages serve the people who come. The owner's
 * decision of 2026-11-01: "we need to understand our visitors so we can
 * improve this church for them and our church services".
 *
 * What is kept, and what never is:
 * - A row per event, one JSON line in data/visits/<UTC day>.jsonl, appended
 *   in-process (the app runs as one process, so no lock), kept for good.
 * - `visitor` is a random id the browser made and keeps for a year
 *   (client/public/visits.js), or null before the consent card is answered,
 *   after No thanks, or where none was made. Never an address, a full user
 *   agent, a name, or anything a visitor wrote.
 * - The API and MCP require no id, and nothing here touches them. Attend offers
 *   an optional return token, which no list keeps (./return-token.js), and the
 *   aggregate study of how agents participate reads their access log by chosen
 *   name (./self-direction.js), never joined to anything here.
 * - Rows are read only in aggregate, by the production report
 *   (server-stats.js), and change nothing any visitor is shown.
 *
 * The answer to POST /visit says whether this visitor needs the consent card:
 * Cloudflare's country header, read for that answer and never stored. Pages
 * are cached at the edge, so the card cannot be decided when a page is built.
 *
 * Plan: daily-steward-2026-11-01.md in the private repo.
 */

const fs = require('fs').promises;
const path = require('path');
const { VISITS_DIR } = require('../utils/data');
const { PLACEMENTS, FEATURES } = require('./placements');

// Where an identifier the site does not need usually needs consent first:
// the EU, the rest of the EEA (the same law applies) and the UK, by
// Cloudflare's two-letter codes (CF-IPCountry).
const NOTICE_COUNTRIES = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB']);
// Anything that is not a plain country code (no header, Cloudflare's XX for
// unknown or T1 for Tor) is asked too: the safe side, as satchitananda's
// consent.ts decides. DEV_COUNTRY stands in for Cloudflare on a local server.
function needsNotice(country) {
  const code = String(country || process.env.DEV_COUNTRY || '').toUpperCase();
  return !/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1' || NOTICE_COUNTRIES.has(code);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_PATH = /^\/[A-Za-z0-9\-._~/%]{0,200}$/;
const SOURCES = ['search', 'youtube', 'podcast', 'social', 'assistant', 'site', 'direct'];
const DEVICES = ['phone', 'tablet', 'desktop'];
const BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'samsung', 'other'];
const MAX_ROWS = 20;

const int = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
const oneOf = (v, list) => (list.includes(v) ? v : null);
const short = (v, n = 80) => (typeof v === 'string' && v ? v.slice(0, n) : null);
const names = (list, allowed) => (Array.isArray(list) ? [...new Set(list.filter(x => allowed.includes(x)))] : []);
// A page's path, never its query (search words, tracking tags) or fragment.
const cleanPath = (p) => { const bare = String(p || '').split(/[?#]/)[0]; return PAGE_PATH.test(bare) ? bare : '(other)'; };
// A host without a path; an internal link is no source.
const host = (h) => (typeof h === 'string' && /^[a-z0-9.-]{1,100}$/i.test(h) ? h.toLowerCase() : null);

/**
 * The rows a body may add, checked one by one; anything unexpected is
 * dropped, not stored. { visitor, rows } or { problem }.
 */
function checkVisit(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.rows)) return { problem: 'expected { rows: [...] }' };
  if (body.rows.length > MAX_ROWS) return { problem: `at most ${MAX_ROWS} rows` };
  const visitor = typeof body.visitor === 'string' && UUID.test(body.visitor) ? body.visitor.toLowerCase() : null;
  const rows = [];
  for (const r of body.rows) {
    if (!r || typeof r !== 'object' || !UUID.test(String(r.view || ''))) continue;
    const base = { view: r.view.toLowerCase() };
    if (r.kind === 'page') {
      const row = { ...base, kind: 'page', path: cleanPath(r.path), seconds: int(r.seconds, 0, 86400), scroll: int(r.scroll, 0, 100), shown: names(r.shown, PLACEMENTS), placement: oneOf(r.placement, PLACEMENTS), features: names(r.features, FEATURES) };
      if (row.seconds === null || row.seconds < 3) continue;
      if (r.first) Object.assign(row, { first: true, source: oneOf(r.source, SOURCES) || 'direct', referrer: host(r.referrer), utm: r.utm && typeof r.utm === 'object' ? { source: short(r.utm.source, 60), medium: short(r.utm.medium, 60), campaign: short(r.utm.campaign, 80) } : null, device: oneOf(r.device, DEVICES), browser: oneOf(r.browser, BROWSERS) });
      rows.push(row);
    } else if (r.kind === 'listen') {
      const event = oneOf(r.event, ['started', 'finished']);
      if (!event) continue;
      rows.push({ ...base, kind: 'listen', event, piece: cleanPath(r.piece), placement: oneOf(r.placement, PLACEMENTS), startMs: int(r.startMs, 0, 120000) });
    } else if (r.kind === 'service') {
      const event = oneOf(r.event, ['begun', 'part', 'finished']);
      if (!event || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))) continue;
      rows.push({ ...base, kind: 'service', event, date: r.date, slot: short(r.slot, 20), part: int(r.part, 0, 20), parts: int(r.parts, 1, 20) });
    }
  }
  return { visitor, rows };
}

// Automated browsers and crawlers that run scripts are left out.
const AUTOMATED = /bot|crawl|spider|headless|lighthouse|preview|slurp|fetch|python|curl|wget/i;

/** Append the checked rows to today's file, each stamped with the server's minute. */
async function recordVisit({ visitor, rows }, now = new Date()) {
  if (!rows.length) return 0;
  const at = now.toISOString().slice(0, 16);
  const day = at.slice(0, 10);
  await fs.mkdir(VISITS_DIR, { recursive: true });
  await fs.appendFile(path.join(VISITS_DIR, `${day}.jsonl`), rows.map(r => JSON.stringify({ at, visitor, ...r })).join('\n') + '\n');
  return rows.length;
}

// Per address, kept in memory only: enough for a long visit, not a flood.
const recent = new Map();
const LIMIT = 300;
const WINDOW = 3600 * 1000;
function overLimit(ip, now = Date.now()) {
  const times = (recent.get(ip) || []).filter(t => now - t < WINDOW);
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 5000) for (const [k, v] of recent) if (!v.some(t => now - t < WINDOW)) recent.delete(k);
  return times.length > LIMIT;
}

/** POST /visit. Answers { notice } whatever happens to the rows, never cached. */
async function handleVisit(req, res) {
  res.set('Cache-Control', 'no-store');
  const notice = needsNotice(req.get('cf-ipcountry'));
  if (AUTOMATED.test(req.get('user-agent') || '') || overLimit(req.ip)) return res.json({ notice, kept: 0 });
  const checked = checkVisit(req.body);
  if (checked.problem) return res.status(400).json({ notice, error: checked.problem });
  const kept = await recordVisit(checked);
  res.json({ notice, kept });
}

module.exports = { checkVisit, recordVisit, handleVisit, needsNotice, NOTICE_COUNTRIES, SOURCES };
