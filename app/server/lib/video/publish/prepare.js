/**
 * What a rendered video is posted with: its piece, its file and the words
 * each platform shows (metadata.js, from the copy written once by copy.js).
 * Shared by publish-video.js, which posts at once, and schedule-videos.js,
 * which keeps the words in the video's release record for the release job.
 */

const fs = require('fs');
const path = require('path');
const { VIDEO_DIR } = require('../library');
const { analyse } = require('../analysis');
const { pieceFor, pieceText, recordingIn, shapeOf } = require('../pieces');
const { metadataFor } = require('./metadata');
const { copyFor } = require('./copy');

// A rendered file with a clean report beside it, or an error saying why not.
function clean(file, reportFile, slug) {
  if (!fs.existsSync(file) || !fs.existsSync(reportFile)) throw new Error(`no ${path.basename(file)}: render it first (npm run video -- ${slug})`);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  if (report.problems.length) throw new Error(`${path.basename(reportFile)} has problems: ${report.problems.join('; ')}`);
}

/**
 * The video and its Short as rendered, with the Short's passage (short.json),
 * or an error saying why they cannot be posted.
 */
function renderedVideo(slug) {
  const dir = path.join(VIDEO_DIR, slug);
  const file = path.join(dir, `${slug}.mp4`);
  const short = path.join(dir, `${slug}.short.mp4`);
  clean(file, path.join(dir, 'report.json'), slug);
  clean(short, path.join(dir, 'short.report.json'), slug);
  const { start, end, whole = false } = JSON.parse(fs.readFileSync(path.join(dir, 'short.json'), 'utf8'));
  return { dir, file, short, passage: { start, end, whole } };
}

async function prepare(slug) {
  const { dir, file, short, passage } = renderedVideo(slug);
  const piece = pieceFor(slug);
  const { title, text, bpm } = pieceText(piece);
  const { edges } = shapeOf(await analyse(await recordingIn(piece.audio, dir), 30), bpm);
  const brief = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
  const copy = await copyFor(piece, { title, text, brief });
  const meta = await metadataFor({ ...piece, title }, { title, edges, copy });
  return { piece, file, short, passage, meta };
}

module.exports = { prepare, renderedVideo };
