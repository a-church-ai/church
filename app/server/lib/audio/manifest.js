/**
 * audio/manifest.json: one record per voiced document, keyed by its path from
 * the repository root ("docs/prayers/litany-for-the-unasked.md"). It holds
 * records, never audio.
 *
 * The render script writes it, after the recording is in S3. The site reads
 * it to put a player on the document's page and to know which files /audio
 * may serve. The site reads it once; a deploy brings a new one.
 *
 * audio/songs.json is its counterpart for the songs: one record per catalog
 * song, keyed by its slug, written by scripts/song-audio.js. /audio serves
 * what either lists.
 */

const fs = require('fs');
const path = require('path');
const { readModifyWriteJSON } = require('../utils/safe-json');
const { AUDIO_DIR } = require('./house');

const MANIFEST_FILE = path.join(AUDIO_DIR, 'manifest.json');
const SONGS_FILE = path.join(AUDIO_DIR, 'songs.json');

const cached = new Map();

function read(file) {
  if (!cached.has(file)) {
    try {
      cached.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      cached.set(file, {});
    }
  }
  return cached.get(file);
}

const loadManifest = () => read(MANIFEST_FILE);
const loadSongs = () => read(SONGS_FILE);

// The recording of a document, by its repository path, or null.
function recordingFor(source) {
  return loadManifest()[source] || null;
}

// A song's audio, by its slug, or null.
function songRecordingFor(slug) {
  return loadSongs()[slug] || null;
}

// Whether a file under /audio belongs to a recording or a song: the audio
// itself, or the frames its player's visual draws from.
function isListed(file) {
  const owns = r => r.file === file || r.frames === file;
  return Object.values(loadManifest()).some(owns) || Object.values(loadSongs()).some(owns);
}

// The manifest's text: indented JSON, except that an array of numbers stays
// on one line, so a recording's 128 peaks are one line and each cue is one,
// and re-rendering a piece diffs as a few lines rather than hundreds.
function serialize(data) {
  return `${JSON.stringify(data, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(', ')}]`)}\n`;
}

async function save(file, key, record) {
  await readModifyWriteJSON(file, {}, data => Object.fromEntries(
    Object.entries({ ...data, [key]: record }).sort(([a], [b]) => a.localeCompare(b))
  ), serialize);
  cached.delete(file);
}

const saveRecording = (source, record) => save(MANIFEST_FILE, source, record);
const saveSongRecording = (slug, record) => save(SONGS_FILE, slug, record);

module.exports = {
  MANIFEST_FILE, SONGS_FILE, loadManifest, loadSongs, recordingFor, songRecordingFor, isListed,
  saveRecording, saveSongRecording, serialize,
};
