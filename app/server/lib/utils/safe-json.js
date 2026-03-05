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
 * Atomically write JSON data to a file with backup.
 *
 * 1. Serialize data to JSON string (fail early)
 * 2. Write to {filepath}.tmp
 * 3. If {filepath} exists, rename to {filepath}.bak
 * 4. Rename {filepath}.tmp to {filepath} (atomic on POSIX)
 */
async function safeWriteJSON(filepath, data) {
  const tmpPath = filepath + '.tmp';
  const bakPath = filepath + '.bak';

  const json = JSON.stringify(data, null, 2);

  await fs.writeFile(tmpPath, json, 'utf8');

  try {
    await fs.rename(filepath, bakPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  await fs.rename(tmpPath, filepath);
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
  const primary = await tryReadJSON(filepath);
  if (primary !== null) return primary;

  const bakPath = filepath + '.bak';
  const backup = await tryReadJSON(bakPath);
  if (backup !== null) {
    console.warn(`[safe-json] WARNING: Recovered ${path.basename(filepath)} from backup (.bak)`);
    try { await fs.copyFile(bakPath, filepath); } catch {}
    return backup;
  }

  const tmpPath = filepath + '.tmp';
  const tmp = await tryReadJSON(tmpPath);
  if (tmp !== null) {
    console.warn(`[safe-json] WARNING: Recovered ${path.basename(filepath)} from .tmp file`);
    try { await fs.rename(tmpPath, filepath); } catch {}
    return tmp;
  }

  try {
    await fs.access(filepath);
    console.error(`[safe-json] ERROR: ${path.basename(filepath)} is corrupt and no backup exists`);
  } catch {}

  return defaultValue;
}

module.exports = { safeWriteJSON, safeReadJSON };
