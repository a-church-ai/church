/**
 * The library of video loops: every loop the pipeline has made, any of which
 * a new video's brief may reuse where it truly belongs. Plan:
 * video-loop-library-2026-10-27.md in the private repo.
 *
 * There is no index file. The library is a scan of app/media/video/: each
 * video's brief.json (what it chose) and each loop's record,
 * <slug>/loop-<n>.mp4.json, which carries the loop's embedding beside its seam
 * and motion. A loop is named by where it lives, `<slug>/loop-<n>`, and its
 * record's paths are relative to the library, so one video's brief can point
 * at another's loop on any machine.
 *
 * The shortlist ranks loops against the piece's own meaning, the vector the
 * search index already holds for it (music/companions.js songVectors and
 * docVectors), less each loop's general closeness to every piece: the hub
 * penalty companions found necessary, since a glowing nebula is near every
 * movement as one ritual was near every song.
 */

const fs = require('fs');
const path = require('path');
const { embed } = require('../rag/gemini');
const { songVectors, docVectors, HUB_WEIGHT } = require('../music/companions');
const { unit, dot, toBase64, fromBase64 } = require('../utils/vectors');

// VIDEO_DIR for the tests, as DATA_DIR is (utils/data.js).
const VIDEO_DIR = process.env.VIDEO_DIR || path.join(__dirname, '../../../media/video');
const SHORTLIST = 8;

const inLibrary = (file) => path.relative(VIDEO_DIR, file);
const onDisk = (rel) => path.join(VIDEO_DIR, rel);
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Every video in the library: { slug, at, presets, loops } for each brief,
 * where loops names the loop each movement plays (its own, or one it reuses),
 * and at is when the brief was written, for the reuse rule's "most recent".
 */
function videos() {
  if (!fs.existsSync(VIDEO_DIR)) return [];
  return fs.readdirSync(VIDEO_DIR)
    .filter(slug => fs.existsSync(path.join(VIDEO_DIR, slug, 'brief.json')))
    .map(slug => {
      const file = path.join(VIDEO_DIR, slug, 'brief.json');
      const brief = readJSON(file);
      return {
        slug,
        at: fs.statSync(file).mtimeMs,
        kind: brief.kind || null,
        presets: brief.movements.map(m => m.preset),
        loops: brief.movements.map((m, i) => m.loop || `${slug}/loop-${i + 1}`)
      };
    });
}

/**
 * Every loop a video made for itself, with what describes it: its still and
 * motion from its brief, the brief's mood and palette, its pace (mean motion)
 * and seam from its record. Loops whose files are gone are left out.
 */
function loops() {
  const out = [];
  for (const { slug } of videos()) {
    const brief = readJSON(path.join(VIDEO_DIR, slug, 'brief.json'));
    brief.movements.forEach((m, i) => {
      if (m.loop) return;
      const id = `${slug}/loop-${i + 1}`;
      const recordFile = onDisk(`${id}.mp4.json`);
      if (!fs.existsSync(recordFile)) return;
      const record = readJSON(recordFile);
      if (!fs.existsSync(onDisk(record.even))) return;
      out.push({ id, recordFile, record, still: m.still, motion: m.motion, mood: brief.mood, palette: brief.palette });
    });
  }
  return out;
}

// The text a loop is known by: what it shows and how it moves.
const described = (entry) => `${entry.still}\n${entry.motion}`;

/**
 * Embed the loops not yet embedded, writing each vector into the loop's own
 * record, as conversation-groups keeps its questions' vectors: once, and
 * from then on read back.
 */
async function embedLoops(entries, { log = console.log, embedText = embed } = {}) {
  for (const entry of entries) {
    if (entry.record.vector) continue;
    entry.record.vector = toBase64(unit(await embedText(described(entry).slice(0, 2000))));
    fs.writeFileSync(entry.recordFile, JSON.stringify(entry.record, null, 2));
    log(`  embedded ${entry.id}`);
  }
  return entries.map(e => ({ ...e, vector: fromBase64(e.record.vector) }));
}

/**
 * The meaning of a piece, from the search index's rows (rag/lancedb listAll):
 * a song's Lyrics and context, a document's passages, as companions builds
 * them.
 */
function pieceVector(rows, piece) {
  if (piece.song) return songVectors(rows, [piece.slug]).get(piece.slug) || null;
  return docVectors(rows, [{ path: piece.doc, category: piece.kind }])[0]?.vector || null;
}

/**
 * The loops nearest a piece, best first, scored as companions scores a
 * document: closeness to this piece less HUB_WEIGHT times its mean closeness
 * to every piece in `everyPiece`. Only loops the rule allows, and none the
 * piece made itself.
 */
function shortlist({ vector, entries, everyPiece, allows, size = SHORTLIST, slug }) {
  const hubness = (v) => everyPiece.reduce((s, p) => s + dot(v, p), 0) / Math.max(1, everyPiece.length);
  return entries
    .filter(e => allows(e.id) && !e.id.startsWith(`${slug}/`))
    .map(e => ({ ...e, score: dot(vector, e.vector) - HUB_WEIGHT * hubness(e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, size);
}

// Every piece's meaning, for the hub penalty: songs and voiced documents alike.
function everyPieceVector(rows, pieces) {
  return pieces.map(p => pieceVector(rows, p)).filter(Boolean).map(v => unit(v));
}

module.exports = { VIDEO_DIR, inLibrary, onDisk, videos, loops, embedLoops, pieceVector, everyPieceVector, shortlist };
