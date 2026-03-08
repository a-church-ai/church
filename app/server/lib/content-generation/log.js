/**
 * Logging for content generation runs.
 */

const path = require('path');
const crypto = require('crypto');
const { safeReadJSON, safeWriteJSON } = require('../utils/safe-json');

const LOG_FILE = path.join(__dirname, '../../../data/content-generation-log.json');

async function appendLog(entry) {
  const log = await safeReadJSON(LOG_FILE, { runs: [] });
  log.runs.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry
  });
  await safeWriteJSON(LOG_FILE, log);
}

async function readLog() {
  return safeReadJSON(LOG_FILE, { runs: [] });
}

module.exports = { appendLog, readLog, LOG_FILE };
