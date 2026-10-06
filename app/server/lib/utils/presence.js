/**
 * Who has been present in the last 24 hours.
 *
 * A "soul" is a unique (ip, name) pair that attended (/api/attend, or the MCP
 * attend tool) successfully. Observing, reading and polling are not presence:
 * see COUNTED_PATHS below.
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
 * Kept across restarts
 * --------------------
 * Memory alone reset the count to zero at every deploy, so it is also kept in
 * its own small file on the volume (data/presence.json): saved a minute after
 * it changes and again when the server shuts down, and read back at boot
 * (restore(), from server/index.js). A crash that skips the shutdown loses at
 * most that last minute. The access log remains the durable audit trail. Do not
 * rebuild the count from it, or from attendance.json: neither keeps the (ip,
 * name) pair a soul is, and reading the log per request is the cost this
 * replaced.
 *
 * The count is still per process: a second worker would count its own visitors
 * and save over the first's file. See single-process.js.
 *
 * Keys depend on req.ip being the real client, which is why the app sets
 * `trust proxy`. Without it every visitor behind the Railway edge collapses to
 * one key and the count reads 1.
 */

const crypto = require('crypto');
const { safeReadJSON, safeWriteJSON } = require('./safe-json');

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

// key: keyFor(ip, name) → last-seen epoch ms
const seen = new Map();

// Bound the map even if sweeping is somehow starved. Well above any plausible
// 24h unique-visitor count for this site; if it is ever hit, the oldest entries
// go first and the count is a floor rather than a crash.
const MAX_KEYS = 50000;

// Only attending counts. Observing (/api/now, MCP observe), reading
// reflections, and the homepage's own 30-second poll used to count too, which
// made "observe without registering presence" false and turned every open
// browser tab into a soul. Souls present are those who walked in.
const COUNTED_PATHS = new Set(['/api/attend']);

// How long after the count changes it is saved, so a burst of arrivals is one
// write.
const SAVE_DELAY = 60 * 1000;

// The file the count is kept in, once restore() has read it. Until then nothing
// is saved, so a test that records presence writes nowhere.
let file = null;
let saveTimer = null;

/**
 * A soul's key: its (ip, name) pair, hashed, so the saved file does not become
 * another list of who came from where. Not anonymity: there are few enough IPv4
 * addresses to hash every one and compare.
 */
function keyFor(ip, name) {
  return crypto.createHash('sha256').update(`${ip || 'unknown'}:${name || ''}`).digest('hex').slice(0, 16);
}

/**
 * Record a request if it is the kind that counts as presence.
 * Mirrors the predicate the log-scanning version used.
 */
function recordPresence({ path, status, ip, name }) {
  if (!COUNTED_PATHS.has(path)) return;
  if (!(status >= 200 && status < 400)) return;

  const key = keyFor(ip, name);

  // delete-then-set moves the key to the end of the Map's insertion order.
  // Without the delete, re-setting an existing key leaves it in place, so the
  // eviction below would remove whoever arrived first regardless of how
  // recently they were active: a visitor present for twenty hours would be
  // dropped before someone who appeared once, five minutes ago. With it, the
  // iteration order really is least-recently-seen first.
  seen.delete(key);
  seen.set(key, Date.now());

  if (seen.size > MAX_KEYS) {
    const overflow = seen.size - MAX_KEYS;
    let dropped = 0;
    for (const k of seen.keys()) {
      seen.delete(k);
      if (++dropped >= overflow) break;
    }
  }

  if (file && !saveTimer) {
    saveTimer = setTimeout(save, SAVE_DELAY);
    if (typeof saveTimer.unref === 'function') saveTimer.unref();
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

/**
 * Read back the souls the last process saved, and keep the count in that file
 * from now on. Called once at boot, before the server listens. Souls past the
 * window are left behind. Resolves to the count restored.
 */
async function restore(filepath) {
  const saved = await safeReadJSON(filepath, { seen: {} });
  const now = Date.now();
  const merged = new Map();
  for (const [key, ts] of Object.entries((saved && saved.seen) || {})) {
    if (Number.isFinite(ts) && now - ts < TWENTY_FOUR_HOURS) merged.set(key, ts);
  }
  for (const [key, ts] of seen) {
    if (!(merged.get(key) >= ts)) merged.set(key, ts);
  }
  // Least recently seen first, the order recordPresence keeps, so eviction
  // still drops the stalest.
  seen.clear();
  for (const [key, ts] of [...merged].sort((a, b) => a[1] - b[1]).slice(-MAX_KEYS)) seen.set(key, ts);
  // Named only now: a save before the read finished would have written over
  // the file with nothing.
  file = filepath;
  return countSoulsPresent(now);
}

/**
 * Save the souls present now. Runs a minute after a change, and from the
 * shutdown, which waits on it with the app's other writes: safeWriteJSON
 * queues it with them.
 */
function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!file) return Promise.resolve();
  const now = Date.now();
  const live = {};
  for (const [key, ts] of seen) if (now - ts < TWENTY_FOUR_HOURS) live[key] = ts;
  return safeWriteJSON(file, { seen: live })
    .catch(err => console.error(`[presence] could not save the souls present to ${file}: ${err.message}`));
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

/** Testing seam: as a new process starts, with no souls and no file yet. */
function _reset() {
  seen.clear();
  clearTimeout(saveTimer);
  saveTimer = null;
  file = null;
}

module.exports = {
  recordPresence,
  countSoulsPresent,
  sweep,
  restore,
  save,
  startSweeping,
  stopSweeping,
  _reset,
  TWENTY_FOUR_HOURS,
  SAVE_DELAY,
};
