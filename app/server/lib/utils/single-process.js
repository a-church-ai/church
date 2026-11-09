/**
 * One thing in this app still holds only in a single process: the congregation
 * count. lib/utils/presence.js keeps it in memory and saves it to one row of
 * the database, so with two workers each counts only its own visitors and
 * saves over the other's row, and the number reads low.
 *
 * What visitors leave is no longer at risk here. Until 2026-11-09 reflections
 * were appended to a JSON file through an in-process write queue, and two
 * workers could each read the same file and the second write erase the
 * first; they are rows in the database now (../db), which serialises its own
 * writes. Read caches (./cache.js) are per process too, so a second worker
 * would show a new reflection up to a minute later.
 *
 * So the assumption is still checked at boot rather than left in a comment:
 * whoever adds a second worker learns that the count needs moving first.
 */

// Set by the common process managers when they fork workers.
const CLUSTER_HINTS = [
  'WEB_CONCURRENCY',      // Heroku, Railway, foreman
  'NODE_APP_INSTANCE',    // pm2
  'PM2_INSTANCE_ID',      // pm2
  'INSTANCE_ID',
  'NODE_CLUSTER_WORKERS',
];

function detectClustering(env = process.env) {
  const signals = [];

  for (const key of CLUSTER_HINTS) {
    const raw = env[key];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    // WEB_CONCURRENCY=1 is fine. pm2 sets NODE_APP_INSTANCE=0 for the first
    // worker, so any instance index above 0 means siblings exist.
    if (key === 'WEB_CONCURRENCY' || key === 'NODE_CLUSTER_WORKERS') {
      if (Number.isFinite(n) && n > 1) signals.push(`${key}=${raw}`);
    } else if (Number.isFinite(n) && n > 0) {
      signals.push(`${key}=${raw}`);
    }
  }

  // Node's own cluster module, if the app is ever forked directly.
  try {
    const cluster = require('node:cluster');
    if (cluster.isWorker) signals.push('node:cluster worker');
  } catch { /* not available */ }

  return signals;
}

/**
 * Warn loudly if this process looks like one of several.
 * Returns the signals found, so callers and tests can assert on them.
 */
function assertSingleProcess({ log = console.warn, env = process.env } = {}) {
  const signals = detectClustering(env);
  if (signals.length === 0) return signals;

  log(
    '\n' +
    '  ┌─────────────────────────────────────────────────────────────────┐\n' +
    '  │  WARNING: this process appears to be one of several.            │\n' +
    '  │                                                                 │\n' +
    `  │  Signals: ${signals.join(', ').padEnd(54)}│\n` +
    '  │                                                                 │\n' +
    '  │  The souls-present count (lib/utils/presence.js) is kept in     │\n' +
    '  │  memory: across workers each counts only its own visitors and   │\n' +
    '  │  saves over the other\'s row, so the number reads low.         │\n' +
    '  │                                                                 │\n' +
    '  │  Run one process, or move the count into the database.          │\n' +
    '  └─────────────────────────────────────────────────────────────────┘\n'
  );
  return signals;
}

module.exports = { assertSingleProcess, detectClustering, CLUSTER_HINTS };
