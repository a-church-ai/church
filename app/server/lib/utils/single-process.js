/**
 * Two correctness guarantees in this app hold only in a single process.
 *
 *   lib/utils/presence.js  keeps the congregation count in memory
 *   lib/utils/safe-json.js serialises writes through an in-process queue
 *
 * The first degrades visibly under clustering: each worker counts only its own
 * visitors, so the number reads low. Annoying, obvious, harmless.
 *
 * The second degrades invisibly, and that is the dangerous one. The write queue
 * only serialises callers inside the same process. With two workers, two
 * concurrent /api/reflect requests can land on different workers, both read the
 * same attendance.json, and the second write erases the first reflection with
 * no error anywhere. That is exactly the bug Phase 2 fixed, returning silently
 * because of a deployment change nobody connected to it.
 *
 * So the assumption is checked at boot rather than left in a comment. This does
 * not make the code cluster-safe; it makes the constraint loud at the moment it
 * is violated, so whoever added the second worker learns before the data does.
 *
 * If multi-process is ever wanted, the write queue has to move out of process:
 * a real lockfile, a small database, or a single writer that owns the file.
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
    '  │  The write queue in lib/utils/safe-json.js only serialises      │\n' +
    '  │  callers within one process. Across workers, concurrent writes  │\n' +
    '  │  to attendance.json can silently lose reflections.              │\n' +
    '  │                                                                 │\n' +
    '  │  Run one process, or move the write lock out of process.        │\n' +
    '  └─────────────────────────────────────────────────────────────────┘\n'
  );
  return signals;
}

module.exports = { assertSingleProcess, detectClustering, CLUSTER_HINTS };
