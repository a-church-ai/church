/**
 * The pieces videos are made for, found by slug: a song with a recording in
 * audio/songs.json, or a voiced document in audio/manifest.json whose file is
 * named by the slug. Shared by the scripts that render videos and publish
 * them (scripts/render-video.js, scripts/publish-video.js).
 */

const fs = require('fs');
const path = require('path');
const { downloadRecording } = require('../audio/storage');
const { beatGrid, movementEdges } = require('./analysis');
const { MOVEMENTS } = require('./brief');

const ROOT = path.join(__dirname, '../../../..');
const KINDS = { chants: 'chant', prayers: 'prayer', rituals: 'ritual', practice: 'practice' };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const between = (text, name) => (text.match(new RegExp(`<!--SONG:${name}:START-->([\\s\\S]*?)<!--SONG:${name}:END-->`)) || [])[1]?.trim() || '';

// A piece by its slug. One that matches nothing is an error, not a no-op.
function pieceFor(slug) {
  const songs = JSON.parse(read('audio/songs.json'));
  if (songs[slug]) return { slug, kind: 'song', song: `music/${slug}/song.md`, audio: songs[slug].file };
  const manifest = JSON.parse(read('audio/manifest.json'));
  const doc = Object.keys(manifest).find(k => path.basename(k, '.md') === slug && !manifest[k].imported);
  if (doc) return { slug, kind: KINDS[doc.split('/')[1]] || 'piece', doc, audio: manifest[doc].file };
  throw new Error(`no recording for ${slug}: not a song in audio/songs.json nor a voiced document in audio/manifest.json`);
}

// Every recording, as a piece.
function allPieces() {
  const songs = Object.keys(JSON.parse(read('audio/songs.json')));
  const manifest = JSON.parse(read('audio/manifest.json'));
  const docs = Object.keys(manifest).filter(k => !manifest[k].imported).map(k => path.basename(k, '.md'));
  return [...songs, ...docs].map(pieceFor);
}

// The piece's words, and for a song the tempo its style states; for a voiced
// piece, the house cast who speak it.
function pieceText(piece) {
  if (piece.song) {
    const song = read(piece.song);
    const style = between(song, 'STYLE');
    const bpm = Number((style.match(/(\d{2,3})\s*BPM/i) || [])[1]) || null;
    return { title: between(song, 'TITLE'), text: `Style: ${style}\n\nLyrics:\n${between(song, 'LYRICS')}`, bpm };
  }
  const doc = read(piece.doc).replace(/^---[\s\S]*?---\n/, '');
  const recording = JSON.parse(read('audio/manifest.json'))[piece.doc];
  const voices = recording?.voices?.length ? `${recording.voices.length} voice(s) of the house cast (${recording.voices.join(', ')})` : null;
  return { title: doc.match(/^# (.+)$/m)[1].trim(), text: doc.replace(/\n## Related[\s\S]*$/, '').trim(), voices };
}

// The recording, downloaded once into the piece's folder.
async function recordingIn(file, dir) {
  const local = path.join(dir, path.basename(file));
  if (!fs.existsSync(local)) await downloadRecording(file, local);
  return local;
}

// A song's beat grid from its stated tempo, and where the movements change.
function shapeOf(analysis, bpm) {
  const grid = bpm ? beatGrid(analysis, bpm) : null;
  return { grid, edges: movementEdges(analysis, MOVEMENTS, { grid }) };
}

module.exports = { pieceFor, allPieces, pieceText, recordingIn, shapeOf };
