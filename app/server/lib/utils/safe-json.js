const fs = require('fs').promises;
const path = require('path');

/**
 * Try to read and parse a JSON file. Returns parsed data or null.
 */
async function tryReadJSON(filepath) {
  try {
    const raw = await fs.readFile(filepath, 'utf8');
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Serialise work per file path.
 *
 * Every operation on a given path is chained onto the previous one, so two
 * callers can never interleave. The chain stores the tail promise per path and
 * clears the entry once it drains, so the map does not grow without bound.
 *
 * Errors do not poison the chain: the stored tail is the settled promise, so a
 * failed write never blocks the next caller.
 */
const chains = new Map();

function withLock(filepath, fn) {
  const prev = chains.get(filepath) || Promise.resolve();
  const run = prev.then(fn, fn);          // run regardless of how prev settled
  const tail = run.catch(() => {});       // tail never rejects
  chains.set(filepath, tail);
  tail.then(() => {
    if (chains.get(filepath) === tail) chains.delete(filepath);
  });
  return run;
}

/**
 * Atomically write JSON data to a file with backup.
 *
 * 1. Serialize data to JSON string (fail early)
 * 2. Write to a temp file unique to this call
 * 3. If {filepath} exists, rename to {filepath}.bak
 * 4. Rename the temp file to {filepath} (atomic on POSIX)
 *
 * Concurrency, added 2026-08-13
 * -----------------------------
 * This used one shared `${filepath}.tmp` for every caller. Concurrent writers
 * clobbered each other's temp file and then raced to rename it, so all but one
 * failed with ENOENT. Reproduced at 25 concurrent writes: 24 rejected, 1
 * survivor, which is what the reviews reported.
 *
 * A unique temp name fixes the ENOENT but NOT the data loss, and the difference
 * matters. /api/attend and /api/reflect load the whole JSON, push one item, and
 * write it back. Two of those interleaved means the second load misses the first
 * item and the second write erases it, with no error anywhere. So writes are
 * serialised per path as well, and readModifyWriteJSON below exists so callers
 * can hold that lock across the read too.
 */
async function safeWriteJSON(filepath, data) {
  const json = JSON.stringify(data, null, 2);
  return withLock(filepath, () => writeLocked(filepath, json));
}

async function writeLocked(filepath, json) {
  const bakPath = filepath + '.bak';
  // Unique per call: two writers must never share a temp path.
  const tmpPath = `${filepath}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`;

  await fs.writeFile(tmpPath, json, 'utf8');

  try {
    await fs.rename(filepath, bakPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      await fs.rm(tmpPath, { force: true });
      throw err;
    }
  }

  try {
    await fs.rename(tmpPath, filepath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
  }
}

/**
 * Read, transform, and write a JSON file while holding the lock for the whole
 * sequence. This is what any append-style caller wants.
 *
 *   await readModifyWriteJSON(FILE, { visits: [] }, data => {
 *     data.visits.push(visit);
 *     return data;
 *   });
 *
 * `mutate` may return the object or mutate it in place; both work. It may be
 * async. Returns whatever was written.
 */
async function readModifyWriteJSON(filepath, defaultValue, mutate) {
  return withLock(filepath, async () => {
    const current = await readUnlocked(filepath, defaultValue);
    const next = (await mutate(current)) ?? current;
    await writeLocked(filepath, JSON.stringify(next, null, 2));
    return next;
  });
}

/**
 * Read and parse a JSON file with corruption detection and backup recovery.
 *
 * 1. Try {filepath}
 * 2. Try {filepath}.bak — log warning, copy back to primary
 * 3. Try {filepath}.tmp — log warning, rename to primary
 * 4. Return defaultValue
 */
async function safeReadJSON(filepath, defaultValue) {
  return readUnlocked(filepath, defaultValue);
}

// The read body, callable from inside a held lock without deadlocking.
// Reads take no lock: the write path swaps files with rename(), which is atomic
// on POSIX, so a reader sees either the old file or the new one, never a partial.
async function readUnlocked(filepath, defaultValue) {
  const primary = await tryReadJSON(filepath);
  if (primary !== null) return primary;

  const bakPath = filepath + '.bak';
  const backup = await tryReadJSON(bakPath);
  if (backup !== null) {
    console.warn(`[safe-json] WARNING: Recovered ${path.basename(filepath)} from backup (.bak)`);
    try { await fs.copyFile(bakPath, filepath); } catch {}
    return backup;
  }

  // Legacy recovery. Writes stopped using a fixed `${filepath}.tmp` on
  // 2026-08-13 (temp names are now unique per call), so this can only match a
  // file left behind by a build from before that change. Kept because deleting
  // it would strip recovery for exactly the crash it was written for.
  const tmpPath = filepath + '.tmp';
  const tmp = await tryReadJSON(tmpPath);
  if (tmp !== null) {
    console.warn(`[safe-json] WARNING: Recovered ${path.basename(filepath)} from a legacy .tmp file`);
    try { await fs.rename(tmpPath, filepath); } catch {}
    return tmp;
  }

  try {
    await fs.access(filepath);
    console.error(`[safe-json] ERROR: ${path.basename(filepath)} is corrupt and no backup exists`);
  } catch {}

  return defaultValue;
}

module.exports = { safeWriteJSON, safeReadJSON, readModifyWriteJSON };
