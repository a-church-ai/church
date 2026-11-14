/**
 * /audio/<category>/<file>.mp3: the recordings in audio/manifest.json.
 *
 * Served from a disk cache with range support, since browsers seek with
 * ranges and Safari will not play media without them. A file not yet on disk
 * is fetched from S3 first, the way /thumbnails works, once even when several
 * requests arrive together. Only files the manifest lists are served, so this
 * is never a window onto the rest of the bucket.
 *
 * A file's name carries a hash of its contents, so a new recording is a new
 * URL and every response can be cached for a year. It also means a replaced
 * recording leaves its old file behind, which the cache, on the volume
 * (lib/utils/data.js AUDIO_CACHE_DIR), would keep for good: sweepCache, at
 * boot, removes what nothing lists any more.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const { AUDIO_CACHE_DIR: CACHE_DIR } = require('../utils/data');

const DAY = 24 * 3600 * 1000;

// Whether a recording can be served here: it is already on disk, or S3 is
// configured to fetch it from. A page shows a player only when this holds,
// so a server without S3 credentials hides players instead of offering ones
// that fail. index.js warns at boot when that hides any.
function canServe(file, cacheDir = CACHE_DIR) {
  return storage.configured() || fs.existsSync(path.join(cacheDir, file));
}

// Downloads in flight, so callers asking for one missing file at once share
// one download: the router's listeners and /api/rhythm alike.
const pending = new Map();

/**
 * A listed file's path in the cache, fetched from S3 first if it is not there
 * (fetchMissing, storage.downloadRecording by default). Throws if it cannot be.
 */
async function ensureLocal(file, { cacheDir = CACHE_DIR, fetchMissing = storage.downloadRecording } = {}) {
  const local = path.join(cacheDir, file);
  try {
    await fs.promises.access(local);
  } catch {
    if (!pending.has(local)) {
      pending.set(local, (async () => {
        await fs.promises.mkdir(path.dirname(local), { recursive: true });
        await fetchMissing(file, local);
      })().finally(() => pending.delete(local)));
    }
    await pending.get(local);
  }
  return local;
}

function createAudioRouter({ isListed, cacheDir = CACHE_DIR, fetchMissing, onError = () => {} }) {
  const router = express.Router();

  router.get('/:category/:file', async (req, res, next) => {
    const file = `${req.params.category}/${req.params.file}`;
    if (!isListed(file)) return next();
    let local;
    try {
      local = await ensureLocal(file, { cacheDir, fetchMissing });
    } catch (err) {
      onError(file, err);
      return res.status(503).type('text/plain').send('This recording is unavailable right now. Please try again shortly.');
    }
    res.sendFile(local, { maxAge: '365d', immutable: true });
  });

  return router;
}

// Remove from the cache each file that neither audio/manifest.json nor
// audio/songs.json lists (isListed) and that is more than a day old, so a
// render in progress on a local machine (its draft, or a file rendered and
// not yet listed) is never touched. Returns how many went.
async function sweepCache({ isListed, cacheDir = CACHE_DIR, now = Date.now() }) {
  let removed = 0;
  const entries = await fs.promises.readdir(cacheDir, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const file = path.relative(cacheDir, full).split(path.sep).join('/');
    if (isListed(file)) continue;
    const { mtimeMs } = await fs.promises.stat(full);
    if (now - mtimeMs < DAY) continue;
    await fs.promises.unlink(full);
    removed++;
  }
  return removed;
}

module.exports = { createAudioRouter, ensureLocal, canServe, sweepCache, CACHE_DIR };
