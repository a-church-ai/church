/**
 * Who has been present in the last 24 hours.
 *
 * A "soul" is a unique (ip, name) pair that hit /api/now, /api/reflections or
 * /api/attend successfully. That definition is unchanged; only the storage is.
 *
 * Why this exists
 * ---------------
 * countSoulsPresent() used to read the entire access log and JSON.parse every
 * line, on demand. That runs on GET /api/now, which the homepage polls every 30
 * seconds per open tab (client/public/index.html). Measured against a log at the
 * real 10MB rotation ceiling, roughly 89,000 entries, one call cost ~85ms of
 * blocked event loop. Twenty open tabs meant about 3.4 seconds of blocking per
 * minute before the server did anything else, and it got worse as the log grew:
 * more traffic, bigger log, slower parse, more requests stacked behind it.
 *
 * So presence is recorded as it happens and read from memory in O(1).
 *
 * The trade, stated plainly
 * -------------------------
 * The count is per process and resets on restart. That is the right trade for a
 * "souls present in the last 24 hours" figure on a single-process deployment:
 * it is a sign of life, not an accounting record, and the access log remains the
 * durable audit trail. Do not "fix" this by reading the log again. If the count
 * ever needs to survive restarts or span processes, give it its own small store
 * rather than re-deriving it from logs written for another purpose.
 *
 * Keys depend on req.ip being the real client, which is why the app sets
 * `trust proxy`. Without it every visitor behind the Railway edge collapses to
 * one key and the count reads 1.
 */

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

// key: `${ip}:${name}` → last-seen epoch ms
const seen = new Map();

// Bound the map even if sweeping is somehow starved. Well above any plausible
// 24h unique-visitor count for this site; if it is ever hit, the oldest entries
// go first and the count is a floor rather than a crash.
const MAX_KEYS = 50000;

const COUNTED_PATHS = new Set(['/api/now', '/api/reflections', '/api/attend']);

/**
 * Record a request if it is the kind that counts as presence.
 * Mirrors the predicate the log-scanning version used.
 */
function recordPresence({ path, status, ip, name }) {
  if (!COUNTED_PATHS.has(path)) return;
  if (!(status >= 200 && status < 400)) return;

  const key = `${ip || 'unknown'}:${name || ''}`;
  seen.set(key, Date.now());

  if (seen.size > MAX_KEYS) {
    // Map preserves insertion order, and re-setting an existing key does not
    // move it, so this is approximate LRU. Good enough for a floor.
    const overflow = seen.size - MAX_KEYS;
    let dropped = 0;
    for (const k of seen.keys()) {
      seen.delete(k);
      if (++dropped >= overflow) break;
    }
  }
}

/** Drop everything older than the window. Called on a timer, not per request. */
function sweep(now = Date.now()) {
  let removed = 0;
  for (const [key, ts] of seen) {
    if (now - ts >= TWENTY_FOUR_HOURS) { seen.delete(key); removed++; }
  }
  return removed;
}

/**
 * Unique souls in the last 24 hours. O(n) over live keys with no I/O and no
 * parsing, where n is the number of distinct visitors rather than the number of
 * log lines ever written.
 */
function countSoulsPresent(now = Date.now()) {
  let count = 0;
  for (const ts of seen.values()) {
    if (now - ts < TWENTY_FOUR_HOURS) count++;
  }
  return count;
}

let sweepTimer = null;

/** Start the periodic sweep. Unref'd so it never holds the process open. */
function startSweeping(intervalMs = 60 * 60 * 1000) {
  if (sweepTimer) return sweepTimer;
  sweepTimer = setInterval(() => sweep(), intervalMs);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  return sweepTimer;
}

function stopSweeping() {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}

/** Testing seam. */
function _reset() { seen.clear(); }

module.exports = {
  recordPresence,
  countSoulsPresent,
  sweep,
  startSweeping,
  stopSweeping,
  _reset,
  TWENTY_FOUR_HOURS,
};
