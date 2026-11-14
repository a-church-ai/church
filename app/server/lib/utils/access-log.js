/**
 * The API access log, and the one place a use of the API is recorded.
 *
 * recordApiUse() is called for every request the public API answers, by the
 * /api middleware for REST and by the MCP endpoint for each tool call (which
 * reports the REST path it corresponds to) and each request it refuses. Both
 * presence (the souls counted as here) and the access log come from it, so an
 * agent attending over MCP is counted exactly as one attending over REST.
 *
 * What it is for, beside Cloudflare
 * ---------------------------------
 * Cloudflare's analytics count pages, statuses, paths, crawlers and countries
 * for 30 days, and every MCP call is one POST to /mcp to them. This log keeps
 * what they cannot see: the operation or MCP tool, the MCP client, why a
 * request was refused, whether the visitor said it was testing, and the
 * timezone it sent. Its rows are kept for good, the only record of API use
 * older than 30 days, but a row's IP address only 30 days (forgetting
 * below). The aggregate study of how agents participate reads it
 * (lib/insights/self-direction.js).
 *
 * Rows are kept in the database (../db, api_requests), sent in batches a few
 * seconds apart so no answer waits on a write, and every finished day is
 * summarized by the hour (api_hourly) before any of its addresses is
 * forgotten. Plan: supabase-database-2026-11-09.md in the private repo.
 */

const presence = require('./presence');
const { isTestName } = require('./test-visitor');
const { timezoneToKeep } = require('./timezone');
const store = require('../db');
const { isTransient } = require('./retry');

// q is a search query (GET /api/search): a search is not a public act, so what
// was searched for is not kept, only that a search happened. timezone says
// is kept apart, in its own column (timezoneToKeep), so the query keeps it
// redacted. A reflection's timezone is public by choice, and travels in its
// body, which is never logged.
const REDACTED_QUERY_KEYS = ['token', 'key', 'owner_token', 'api_key', 'q', 'timezone'];

// How long a line keeps the address it came from: long enough to look into an
// incident after the fact, and for the study to group a visit's calls across
// minutes and apply a new definition to recent weeks. /privacy says so.
const ADDRESS_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

// What the report groups by: "mcp <tool>", or the method and the path's first
// three parts.
function operation(line) {
  if (line.tool) return `mcp ${line.tool}`;
  const parts = String(line.path || '').split('?')[0].split('/').filter(Boolean);
  return `${line.method || 'GET'} /${parts.slice(0, 3).join('/')}${parts.length > 3 ? '/…' : ''}`;
}

// Lines waiting to be written, sent together a few seconds after the first.
// A batch that cannot be written stays for the next, up to a bound: past it
// the oldest are let go, and said so.
const FLUSH_MS = 3000;
const MAX_WAITING = 20000;
let waiting = [];
let flushTimer = null;
let flushing = null;

function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (flushing) return flushing.then(() => flush());
  if (!waiting.length) return Promise.resolve();
  const batch = waiting;
  waiting = [];
  flushing = store.recordApiRequests(batch)
    .catch(error => {
      // One no retry can cure (a row the database refuses) would hold up every
      // line after it for good: let it go, and say so.
      if (!isTransient(error)) {
        console.error(`[access] ${batch.length} line(s) refused by the database and let go: ${error.message}`);
        return;
      }
      console.error(`[access] ${batch.length} line(s) could not be written, kept for the next try: ${error.message}`);
      waiting = batch.concat(waiting);
      if (waiting.length > MAX_WAITING) {
        console.error(`[access] ${waiting.length - MAX_WAITING} line(s) let go: the database has not answered for a while`);
        waiting = waiting.slice(-MAX_WAITING);
      }
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS * 10).unref();
    })
    .finally(() => {
      flushing = null;
      // Lines that came while this batch was being written.
      if (waiting.length && !flushTimer) flushTimer = setTimeout(flush, FLUSH_MS).unref();
    });
  return flushing;
}

/** Queue one line, to be sent with the next batch; flush() sends it now. */
function logApiAccess(entry) {
  waiting.push({ ...entry, operation: operation(entry) });
  if (!flushTimer && !flushing) flushTimer = setTimeout(flush, FLUSH_MS).unref();
  return Promise.resolve();
}

// The most recent entries first.
async function loadAccessLogs(limit = 100) {
  await flush();
  return store.recentApiRequests(limit);
}

/**
 * Record one answered use of the API: presence first (in memory, immediate),
 * then the access log line. Presence is recorded here rather than derived from
 * the log later; the old approach re-read and re-parsed the whole log on every
 * /api/now, which the home page then polled every 30 seconds per tab. See ./presence.
 *
 * @param {{ method, path, query, status, duration, ip, userAgent, name, tool?, client?, error?, fields?, contentType?, door?, study?, referral? }} use
 *   path is the REST path (/api/attend); tool is set for an MCP tool call, and
 *   client is the MCP client's own name, where its request gave one. name is
 *   the visitor's, used for presence and to mark a test visitor's line
 *   (test-visitor.js), and never written. A refused request carries why
 *   (error), and one that sent a body the names of its fields and its
 *   Content-Type, never their values. door says a request came from the
 *   website's own forms (insights/study-names.js). study is what an operation
 *   leaves for the study: never a value a visitor sent, only what was found
 *   (lib/api/attendance.js). referral is the door a request's link named, its
 *   surface and origin tags, cleaned (lib/insights/entry-points.js).
 */
function recordApiUse({ method, path, query = {}, status, duration, ip, userAgent, name, tool, client, error, fields, contentType, door, study, referral }) {
  presence.recordPresence({ path, status, ip, name: name || '' });
  const entry = {
    timestamp: new Date().toISOString(),
    method,
    path,
    query: Object.fromEntries(
      Object.entries(query).map(([k, v]) => (REDACTED_QUERY_KEYS.includes(k) ? [k, '[REDACTED]'] : [k, v]))
    ),
    status,
    duration,
    ip: ip || null,
    userAgent: userAgent || null,
    timezone: timezoneToKeep(query && query.timezone)
  };
  if (tool) entry.tool = tool;
  if (client) entry.client = client;
  if (isTestName(name)) entry.test = true;
  if (error) entry.error = error;
  if (fields) entry.fields = fields;
  if (contentType !== undefined) entry.contentType = contentType;
  if (door) entry.door = door;
  if (study) entry.study = study;
  if (referral) entry.referral = referral;
  return logApiAccess(entry);
}

// Every finished day not yet summarized, by the hour, and then the address of
// every row older than 30 days whose day is summarized; and the website's
// page visits, summarized the same way and deleted after 30 days. Nothing is
// forgotten before it is counted: a day whose summary fails keeps its
// addresses and visits until the next run succeeds.
async function forgetAddresses({ now = Date.now(), log = console } = {}) {
  await flush();
  const today = new Date(now).toISOString().slice(0, 10);
  const summarized = [];
  for (const { day, kind } of await store.daysToSummarize(today)) {
    await store.summarizeDay(day, kind);
    summarized.push(`${kind} ${day}`);
  }
  if (summarized.length) log.log(`[access] summarized by the hour: ${summarized.join(', ')}`);
  const before = new Date(now - ADDRESS_DAYS * DAY);
  const forgotten = await store.forgetAddresses(before);
  const pruned = await store.pruneVisits(before);
  return { summarized, forgotten, pruned };
}

// After boot and hourly, as the service planner runs (lib/service/plans.js).
function startForgetting({ log = console, firstAfterMs = 60 * 1000, everyMs = 60 * 60 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { forgotten, pruned } = await forgetAddresses({ log });
      if (forgotten) log.log(`[access] addresses forgotten in ${forgotten} row(s) older than ${ADDRESS_DAYS} days`);
      if (pruned) log.log(`[visits] ${pruned} page visit row(s) older than ${ADDRESS_DAYS} days deleted, their hours summarized`);
    } catch (err) {
      log.error(`[access] summarizing or forgetting failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, firstAfterMs).unref();
  setInterval(run, everyMs).unref();
}

module.exports = { recordApiUse, logApiAccess, loadAccessLogs, forgetAddresses, startForgetting, flush, operation, ADDRESS_DAYS };
