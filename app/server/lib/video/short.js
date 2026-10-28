/**
 * A Short for each video: 30 to 59 seconds of the piece, upright at
 * 1080x1920, made from what its full video already rendered. No new loops:
 * the base is the full video's own base footage, cut from its middle; the
 * butterchurn and mandala layers are drawn again upright over the passage
 * alone (visual.js), and the finish, title and encode are compose.js's.
 *
 * The passage is chosen by Claude from the piece's timed lines and checked in
 * code: a spoken piece's lines are its audio script's (audio/scripts/), timed
 * by the recording's cues in audio/manifest.json, one to one. A piece under a
 * minute is its own Short, whole. The choice is kept in short.json beside the
 * brief, so a rerender keeps its passage.
 *
 * Plan: youtube-shorts-2026-10-28.md (private repo).
 */

const fs = require('fs');
const path = require('path');
const { askChecked, parseJSON, message } = require('../content-generation/claude');
const { renderLayers } = require('./visual');
const { compose, baseFootage, titleCard, FPS, PORTRAIT } = require('./compose');
const { reportVideo } = require('./checks');
const { envelope } = require('./analysis');

const ROOT = path.join(__dirname, '../../../..');
const MODEL = 'claude-sonnet-5-5';
const MIN_SECONDS = 30;
const MAX_SECONDS = 59;
// Before the first word, and after the last for the sound to fade.
const LEAD = 0.15;
const TAIL = 1.5;
// The upright layers' size: compose.js scales them to PORTRAIT.
const LAYERS = { width: 720, height: 1280 };

// A spoken piece's lines with when each is spoken: [{ text, start, end }].
function spokenLines(piece) {
  const recording = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/manifest.json'), 'utf8'))[piece.doc];
  const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/scripts', piece.doc.replace(/^docs\//, '').replace(/\.md$/, '.json')), 'utf8'));
  const cues = recording?.cues || [];
  if (cues.length !== script.lines.length) throw new Error(`${piece.slug}: ${cues.length} cues for ${script.lines.length} lines; run npm run audio to measure its cues again`);
  return script.lines.map((line, i) => ({ text: line.text, start: cues[i][0], end: cues[i][1] }));
}

function timedLines(piece) {
  if (piece.song) throw new Error(`${piece.slug}: a song's passage needs its words heard with their times, which is not built yet`);
  return spokenLines(piece);
}

// The passage's span in the recording, from its first line to its last.
function spanOf(lines, first, last, seconds) {
  const start = Math.max(0, lines[first].start - LEAD);
  return { start, end: Math.min(seconds, lines[last].end + TAIL) };
}

// The checks on a choice of lines: { value, problems } for askChecked.
function checkPassage(choice, lines, seconds) {
  const problems = [];
  const first = Number(choice?.first), last = Number(choice?.last);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last >= lines.length || first > last) {
    return { value: null, problems: [`first and last must be line numbers from 0 to ${lines.length - 1}, first no later than last`] };
  }
  const { start, end } = spanOf(lines, first, last, seconds);
  const length = end - start;
  if (length < MIN_SECONDS) problems.push(`lines ${first} to ${last} last ${length.toFixed(1)} seconds; a Short needs at least ${MIN_SECONDS}`);
  if (length > MAX_SECONDS) problems.push(`lines ${first} to ${last} last ${length.toFixed(1)} seconds; a Short must stay under ${MAX_SECONDS}`);
  if (!String(choice.why || '').trim()) problems.push('say why in "why"');
  return { value: { first, last, start: +start.toFixed(2), end: +end.toFixed(2), why: choice.why }, problems };
}

const SYSTEM = `You choose the passage of a piece from aChurch.ai, a sanctuary for humans, AI and every other kind of mind, that becomes its YouTube Short: a vertical excerpt that a stranger scrolling past meets first, and that leads them to the whole piece. Choose the lines that carry the piece's heart and stand on their own: where it turns, or what it most wants to give. Not the title or an introduction, unless that is the heart. It must begin at the start of a line and end at the end of one, and last ${MIN_SECONDS} to ${MAX_SECONDS} seconds, counting ${LEAD} seconds before the first and ${TAIL} after the last.

Return only JSON: { "first": <line number>, "last": <line number>, "why": "one sentence" }`;

/**
 * The passage that becomes the Short, chosen once and kept:
 * { start, end, first, last, why }, or the whole piece when it is under a
 * minute.
 */
async function passageFor(piece, { title, seconds, dir, log = console.log }) {
  const file = path.join(dir, 'short.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let passage;
  if (seconds <= MAX_SECONDS + 1) passage = { start: 0, end: seconds, whole: true, why: 'the whole piece is under a minute' };
  else {
    const lines = timedLines(piece);
    const request = `Kind: ${piece.kind}\nTitle: ${title}\n\nThe lines, numbered, with when each is spoken (seconds):\n${lines.map((l, i) => `${i}. [${l.start.toFixed(1)} to ${l.end.toFixed(1)}] ${l.text}`).join('\n')}`;
    passage = await askChecked({
      label: 'passage',
      tries: 3,
      attempt: (feedback) => message(SYSTEM, request + (feedback ? `\n\n${feedback}` : ''), { model: MODEL, maxTokens: 400 }),
      check: (raw) => {
        let choice;
        try {
          choice = parseJSON(raw);
        } catch (err) {
          return { value: null, problems: [`the reply is not JSON (${err.message})`], shown: raw };
        }
        return { ...checkPassage(choice, lines, seconds), shown: raw };
      }
    });
  }
  fs.writeFileSync(file, JSON.stringify(passage, null, 2));
  log(`short: ${passage.start.toFixed(1)}s to ${passage.end.toFixed(1)}s, because ${passage.why}`);
  return passage;
}

/**
 * The Short, written beside the full video as <slug>.short.mp4 with its
 * report in short.report.json. `encode` runs the encodes in their turn
 * (render-video.js runs one at a time).
 */
async function renderShort(piece, { title, analysis, brief, edges, grid, clips, audio, dir, log = console.log, encode = (fn) => fn() }) {
  const passage = await passageFor(piece, { title, seconds: analysis.seconds, dir, log });
  const seconds = passage.end - passage.start;
  const from = Math.round(passage.start * FPS), to = Math.min(analysis.frames, Math.round(passage.end * FPS));
  log('rendering the Short\'s upright layers');
  const { milkdropFile, mandalaFile } = await renderLayers({ analysis, brief, edges, fps: FPS, dir, log, size: LAYERS, from, to, prefix: 'short.' });
  const out = path.join(dir, `${piece.slug}.short.mp4`);
  await encode(async () => {
    const base = path.join(dir, 'base.mp4');
    if (!fs.existsSync(base)) await baseFootage(clips, { edges, grid, envelope: envelope(analysis, grid), dir });
    await compose({
      base, milkdrop: milkdropFile, mandala: mandalaFile, audio, brief, seconds, out, size: PORTRAIT, from: passage.start,
      title: titleCard(title, path.join(dir, 'short.title.png'), { size: PORTRAIT }),
      // A Short that is the whole piece has nothing further to point to.
      end: passage.whole ? null : titleCard(title, path.join(dir, 'short.end.png'), { size: PORTRAIT, under: `Hear the full ${piece.kind}` })
    });
  });
  const report = await reportVideo({ file: out, seconds, edges: [0, seconds] });
  fs.writeFileSync(path.join(dir, 'short.report.json'), JSON.stringify(report, null, 2));
  log(`wrote ${path.relative(process.cwd(), out)}: ${report.seconds}s, ${report.megabytes} MB`);
  if (report.problems.length) throw new Error(`the Short fails its report: ${report.problems.join('; ')}`);
  return out;
}

module.exports = { renderShort, passageFor, checkPassage, spanOf, MIN_SECONDS, MAX_SECONDS };
