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
 * request was refused, and whether the visitor said it was testing. Its lines
 * are kept for good, the only record of API use older than 30 days, but a
 * line's IP address only 14 days (forgetAddresses below).
 *
 * One file per UTC day, data/access/<date>.jsonl, so an old day can be
 * rewritten whole while today's is appended to.
 */

const fs = require('fs').promises;
const { createReadStream } = require('fs');
const readline = require('readline');
const path = require('path');
const presence = require('./presence');
const { isTestName } = require('./test-visitor');
const { ACCESS_DIR, RUNTIME_DIR } = require('./data');

// q is a search query (GET /api/search): a search is not a public act, so what
// was searched for is not kept, only that a search happened. timezone says
// roughly where a visitor is, beside their address; the API tells them it is
// not stored, and the home page sends the browser's with every poll, so only
// that one was given is kept. A reflection's timezone is public by choice,
// and travels in its body, which is never logged.
const REDACTED_QUERY_KEYS = ['token', 'key', 'owner_token', 'api_key', 'q', 'timezone'];

// How long a line keeps the address it came from: long enough to look into
// an incident after the fact.
const ADDRESS_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

const dayFile = (date) => path.join(ACCESS_DIR, `${date}.jsonl`);

async function logApiAccess(entry) {
  try {
    await fs.mkdir(ACCESS_DIR, { recursive: true });
    await fs.appendFile(dayFile(entry.timestamp.slice(0, 10)), JSON.stringify(entry) + '\n');
  } catch (error) {
    console.error('Failed to log API access:', error.message);
  }
}

// The most recent entries first, from today's file and as many days before it
// as it takes.
async function loadAccessLogs(limit = 100) {
  let days;
  try {
    days = (await fs.readdir(ACCESS_DIR)).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse();
  } catch {
    return [];
  }
  const entries = [];
  for (const day of days) {
    const lines = (await fs.readFile(path.join(ACCESS_DIR, day), 'utf8')).trim().split('\n').filter(Boolean).reverse();
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch {}
      if (entries.length >= limit) return entries;
    }
  }
  return entries;
}

/**
 * Record one answered use of the API: presence first (in memory, immediate),
 * then the access log line. Presence is recorded here rather than derived from
 * the log later; the old approach re-read and re-parsed the whole log on every
 * /api/now, which the home page then polled every 30 seconds per tab. See ./presence.
 *
 * @param {{ method, path, query, status, duration, ip, userAgent, name, tool?, client?, error?, fields?, contentType? }} use
 *   path is the REST path (/api/attend); tool is set for an MCP tool call, and
 *   client is the MCP client's own name, where its request gave one. name is
 *   the visitor's, used for presence and to mark a test visitor's line
 *   (test-visitor.js), and never written. A refused request carries why
 *   (error), and one that sent a body the names of its fields and its
 *   Content-Type, never their values.
 */
function recordApiUse({ method, path, query = {}, status, duration, ip, userAgent, name, tool, client, error, fields, contentType }) {
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
    userAgent: userAgent || null
  };
  if (tool) entry.tool = tool;
  if (client) entry.client = client;
  if (isTestName(name)) entry.test = true;
  if (error) entry.error = error;
  if (fields) entry.fields = fields;
  if (contentType !== undefined) entry.contentType = contentType;
  return logApiAccess(entry);
}

// Whether a file's first line still carries an address. Every line is
// written with an ip field (null when none was known), and a file is stripped
// whole, so the first line answers for all of them without reading the rest.
async function hasAddresses(file) {
  const input = createReadStream(file);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try { return 'ip' in JSON.parse(line); } catch { return false; }
    }
    return false;
  } finally {
    lines.close();
    input.destroy();
  }
}

/**
 * Take the IP address out of every access file not written to for 14 days,
 * keeping each line and its other fields. Today's file is the only one
 * appended to, so an old one can be rewritten (a temporary file, then a
 * rename) without racing a write. The size-rotated api-access*.jsonl files
 * from before the daily ones are access files like any other.
 *
 * @returns {Promise<string[]>} the files stripped
 */
async function forgetAddresses({ now = Date.now() } = {}) {
  const files = [];
  for (const [dir, pattern] of [[ACCESS_DIR, /^\d{4}-\d{2}-\d{2}\.jsonl$/], [RUNTIME_DIR, /^api-access.*\.jsonl$/]]) {
    let names = [];
    try { names = (await fs.readdir(dir)).filter(f => pattern.test(f)); } catch {}
    files.push(...names.map(f => path.join(dir, f)));
  }
  const stripped = [];
  for (const file of files) {
    if (now - (await fs.stat(file)).mtimeMs < ADDRESS_DAYS * DAY) continue;
    if (!(await hasAddresses(file))) continue;
    const lines = (await fs.readFile(file, 'utf8')).split('\n').map(line => {
      if (!line) return line;
      try {
        const { ip, ...rest } = JSON.parse(line);
        return JSON.stringify(rest);
      } catch {
        return line;
      }
    });
    await fs.writeFile(`${file}.tmp`, lines.join('\n'));
    await fs.rename(`${file}.tmp`, file);
    stripped.push(file);
  }
  return stripped;
}

// After boot and hourly, as the service planner runs (lib/service/plans.js).
function startForgetting({ log = console, firstAfterMs = 60 * 1000, everyMs = 60 * 60 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const stripped = await forgetAddresses();
      if (stripped.length) log.log(`[access] addresses forgotten in ${stripped.length} file(s) older than ${ADDRESS_DAYS} days`);
    } catch (err) {
      log.error(`[access] forgetting addresses failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, firstAfterMs).unref();
  setInterval(run, everyMs).unref();
}

module.exports = { recordApiUse, logApiAccess, loadAccessLogs, forgetAddresses, startForgetting, dayFile, ADDRESS_DAYS };
