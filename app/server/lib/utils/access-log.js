/**
 * The API access log, and the one place a use of the API is recorded.
 *
 * recordApiUse() is called for every request the public API answers, by the
 * /api middleware for REST and by the MCP endpoint for each tool call (which
 * reports the REST path it corresponds to). Both presence (the souls counted
 * as here) and the access log come from it, so an agent attending over MCP is
 * counted exactly as one attending over REST.
 */

const fs = require('fs').promises;
const presence = require('./presence');
const { ACCESS_LOG_FILE } = require('./data');

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const REDACTED_QUERY_KEYS = ['token', 'key', 'owner_token', 'api_key'];

async function logApiAccess(entry) {
  const line = JSON.stringify(entry) + '\n';
  try {
    // Check file size and rotate if needed
    try {
      const stats = await fs.stat(ACCESS_LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const rotatedPath = ACCESS_LOG_FILE.replace('.jsonl', `-${Date.now()}.jsonl`);
        await fs.rename(ACCESS_LOG_FILE, rotatedPath);
      }
    } catch {
      // File doesn't exist yet, that's fine
    }
    await fs.appendFile(ACCESS_LOG_FILE, line);
  } catch (error) {
    console.error('Failed to log API access:', error.message);
  }
}

async function loadAccessLogs(limit = 100) {
  try {
    const content = await fs.readFile(ACCESS_LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    // Return most recent entries (file is append-only, so take from end)
    return lines.slice(-limit).reverse().map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Record one answered use of the API: presence first (in memory, immediate),
 * then the access log line. Presence is recorded here rather than derived from
 * the log later; the old approach re-read and re-parsed the whole log on every
 * /api/now, which the homepage polls every 30s per tab. See ./presence.
 *
 * @param {{ method, path, query, status, duration, ip, userAgent, name, tool? }} use
 *   path is the REST path (/api/attend); tool is set for an MCP tool call.
 */
function recordApiUse({ method, path, query = {}, status, duration, ip, userAgent, name, tool }) {
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
    ip,
    userAgent: userAgent || null
  };
  if (tool) entry.tool = tool;
  return logApiAccess(entry);
}

module.exports = { recordApiUse, logApiAccess, loadAccessLogs };
