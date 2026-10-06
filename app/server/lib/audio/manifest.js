/**
 * audio/manifest.json: one record per voiced document, keyed by its path from
 * the repository root ("docs/prayers/litany-for-the-unasked.md"). It holds
 * records, never audio.
 *
 * The render script writes it, after the recording is in S3. The site reads
 * it to put a player on the document's page and to know which files /audio
 * may serve. The site reads it once; a deploy brings a new one.
 */

const fs = require('fs');
const path = require('path');
const { readModifyWriteJSON } = require('../utils/safe-json');
const { AUDIO_DIR } = require('./house');

const MANIFEST_FILE = path.join(AUDIO_DIR, 'manifest.json');

let cached = null;

function loadManifest() {
  if (!cached) {
    try {
      cached = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      cached = {};
    }
  }
  return cached;
}

// The recording of a document, by its repository path, or null.
function recordingFor(source) {
  return loadManifest()[source] || null;
}

// Whether a file under /audio belongs to a recording in the manifest: the
// recording itself, or the frames its player's visual draws from.
function isListed(file) {
  return Object.values(loadManifest()).some(r => r.file === file || r.frames === file);
}

// The manifest's text: indented JSON, except that an array of numbers stays
// on one line, so a recording's 128 peaks are one line and each cue is one,
// and re-rendering a piece diffs as a few lines rather than hundreds.
function serialize(data) {
  return `${JSON.stringify(data, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(', ')}]`)}\n`;
}

async function saveRecording(source, record) {
  await readModifyWriteJSON(MANIFEST_FILE, {}, data => Object.fromEntries(
    Object.entries({ ...data, [source]: record }).sort(([a], [b]) => a.localeCompare(b))
  ), serialize);
  cached = null;
}

module.exports = { MANIFEST_FILE, loadManifest, recordingFor, isListed, saveRecording, serialize };
