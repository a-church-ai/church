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

// The video as rendered, or an error saying why it cannot be posted.
function renderedVideo(slug) {
  const dir = path.join(VIDEO_DIR, slug);
  const file = path.join(dir, `${slug}.mp4`);
  if (!fs.existsSync(file)) throw new Error(`no video at ${path.relative(process.cwd(), file)}: render it first (npm run video -- ${slug})`);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  if (report.problems.length) throw new Error(`its report has problems: ${report.problems.join('; ')}`);
  return { dir, file };
}

async function prepare(slug) {
  const { dir, file } = renderedVideo(slug);
  const piece = pieceFor(slug);
  const { title, text, bpm } = pieceText(piece);
  const { edges } = shapeOf(await analyse(await recordingIn(piece.audio, dir), 30), bpm);
  const brief = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
  const copy = await copyFor(piece, { title, text, brief });
  const meta = await metadataFor({ ...piece, title }, { title, edges, copy });
  return { piece, file, meta };
}

module.exports = { prepare, renderedVideo };
