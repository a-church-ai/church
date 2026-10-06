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
 * URL and every response can be cached for a year.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const storage = require('./storage');

const CACHE_DIR = path.join(__dirname, '../../../media/audio');

// Whether a recording can be served here: it is already on disk, or S3 is
// configured to fetch it from. A page shows a player only when this holds,
// so a server without S3 credentials hides players instead of offering ones
// that fail. index.js warns at boot when that hides any.
function canServe(file, cacheDir = CACHE_DIR) {
  return storage.configured() || fs.existsSync(path.join(cacheDir, file));
}

function createAudioRouter({ isListed, cacheDir = CACHE_DIR, fetchMissing, onError = () => {} }) {
  const router = express.Router();
  const pending = new Map();

  router.get('/:category/:file', async (req, res, next) => {
    const file = `${req.params.category}/${req.params.file}`;
    if (!isListed(file)) return next();
    const local = path.join(cacheDir, file);
    try {
      await fs.promises.access(local);
    } catch {
      if (!pending.has(file)) {
        pending.set(file, fetchMissing(file, local).finally(() => pending.delete(file)));
      }
      try {
        await pending.get(file);
      } catch (err) {
        onError(file, err);
        return res.status(503).type('text/plain').send('This recording is unavailable right now. Please try again shortly.');
      }
    }
    res.sendFile(local, { maxAge: '365d', immutable: true });
  });

  return router;
}

module.exports = { createAudioRouter, canServe, CACHE_DIR };
