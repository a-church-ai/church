/**
 * A Short for each video: 30 to 59 seconds of the piece, upright at
 * 1080x1920, made from what its full video already rendered. No new loops:
 * the base is the full video's own base footage, cut from its middle; the
 * butterchurn and mandala layers are drawn again upright over the passage
 * alone (visual.js), and the finish, title and encode are compose.js's.
 *
 * The passage is chosen by Claude from the piece's timed lines and checked in
 * code: a spoken piece's lines are its audio script's (audio/scripts/), timed
 * by the recording's cues in audio/manifest.json, one to one. A song has no
 * cues, so it is heard with each word's time (transcribe.js hearWhole, kept in
 * heard.json), the words grouped into phrases at its pauses, and its passage
 * begins and ends on bar lines of its beat grid. A piece under a minute is
 * its own Short, whole. The choice is kept in short.json beside the
 * brief, so a rerender keeps its passage.
 *
 * Plan: youtube-shorts-2026-10-28.md (private repo).
 */

const fs = require('fs');
const path = require('path');
const { askChecked, parseJSON, message } = require('../content-generation/claude');
const { hearWhole } = require('../audio/transcribe');
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
// A sung phrase ends at a pause this long, or at this many words.
const PHRASE_GAP = 0.6;
const PHRASE_WORDS = 14;

// A spoken piece's lines with when each is spoken: [{ text, start, end }].
function spokenLines(piece) {
  const recording = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/manifest.json'), 'utf8'))[piece.doc];
  const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/scripts', piece.doc.replace(/^docs\//, '').replace(/\.md$/, '.json')), 'utf8'));
  const cues = recording?.cues || [];
  if (cues.length !== script.lines.length) throw new Error(`${piece.slug}: ${cues.length} cues for ${script.lines.length} lines; run npm run audio to measure its cues again`);
  return script.lines.map((line, i) => ({ text: line.text, start: cues[i][0], end: cues[i][1] }));
}

// Heard words grouped into phrases: a new one after a pause, or when one runs
// long. [{ text, start, end }].
function phrasesOf(words) {
  const phrases = [];
  for (const w of words) {
    const last = phrases[phrases.length - 1];
    if (last && w.start - last.end < PHRASE_GAP && last.count < PHRASE_WORDS) {
      last.text += ` ${w.word}`;
      last.end = w.end;
      last.count++;
    } else phrases.push({ text: w.word, start: w.start, end: w.end, count: 1 });
  }
  return phrases.map(({ text, start, end }) => ({ text: text.trim(), start, end }));
}

// A song's sung phrases, heard once and kept.
async function sungLines(audio, dir) {
  const file = path.join(dir, 'heard.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(await hearWhole(audio, path.join(dir, 'heard.mp3')), null, 2));
  return phrasesOf(JSON.parse(fs.readFileSync(file, 'utf8')).words);
}

const timedLines = (piece, { audio, dir }) => (piece.song ? sungLines(audio, dir) : spokenLines(piece));

// The bar line at or before `t`, and at or after it, on a beat grid.
const barBefore = (grid, t) => grid.downbeat + Math.floor((t - grid.downbeat) / grid.bar) * grid.bar;
const barAfter = (grid, t) => grid.downbeat + Math.ceil((t - grid.downbeat) / grid.bar) * grid.bar;

/**
 * The passage's span in the recording, from its first line to its last: a
 * breath before and a fade after, and for a song with a beat grid, out to the
 * bar lines around them; never into the line before or after, so a sung
 * pickup does not open on the end of the previous phrase.
 */
function spanOf(lines, first, last, seconds, grid = null) {
  let start = lines[first].start - LEAD, end = lines[last].end + TAIL;
  if (grid) {
    start = barBefore(grid, start);
    end = barAfter(grid, end);
  }
  if (first > 0) start = Math.max(start, Math.min(lines[first - 1].end + 0.1, lines[first].start - LEAD));
  if (last < lines.length - 1) end = Math.min(end, Math.max(lines[last + 1].start - 0.1, lines[last].end + 0.3));
  return { start: Math.max(0, start), end: Math.min(seconds, end) };
}

// The checks on a choice of lines: { value, problems } for askChecked.
function checkPassage(choice, lines, seconds, grid = null) {
  const problems = [];
  const first = Number(choice?.first), last = Number(choice?.last);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last >= lines.length || first > last) {
    return { value: null, problems: [`first and last must be line numbers from 0 to ${lines.length - 1}, first no later than last`] };
  }
  const { start, end } = spanOf(lines, first, last, seconds, grid);
  const length = end - start;
  if (length < MIN_SECONDS) problems.push(`lines ${first} to ${last} last ${length.toFixed(1)} seconds; a Short needs at least ${MIN_SECONDS}`);
  if (length > MAX_SECONDS) problems.push(`lines ${first} to ${last} last ${length.toFixed(1)} seconds; a Short must stay under ${MAX_SECONDS}`);
  if (!String(choice.why || '').trim()) problems.push('say why in "why"');
  // The sound fades from where the last line ends.
  return { value: { first, last, start: +start.toFixed(2), end: +end.toFixed(2), quiet: +Math.min(end, lines[last].end).toFixed(2), why: choice.why }, problems };
}

const SYSTEM = `You choose the passage of a piece from aChurch.ai, a sanctuary for humans, AI and every other kind of mind, that becomes its YouTube Short: a vertical excerpt that a stranger scrolling past meets first, and that leads them to the whole piece. Choose the lines that carry the piece's heart and stand on their own: where it turns, or what it most wants to give. For a song that is usually its chorus or the verse that carries it. Not the title or an introduction, unless that is the heart. It must begin at the start of a line and end at the end of one, and last ${MIN_SECONDS} to ${MAX_SECONDS} seconds, counting ${LEAD} seconds before the first and ${TAIL} after the last (for a song, out to the bar lines around them). A song's lines are its sung phrases as heard, which may mishear a word; its lyrics are given to read them by.

Return only JSON: { "first": <line number>, "last": <line number>, "why": "one sentence" }`;

/**
 * The passage that becomes the Short, chosen once and kept:
 * { start, end, first, last, why }, or the whole piece when it is under a
 * minute.
 */
async function passageFor(piece, { title, text, seconds, grid, audio, dir, log = console.log }) {
  const file = path.join(dir, 'short.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let passage;
  if (seconds <= MAX_SECONDS + 1) passage = { start: 0, end: seconds, whole: true, why: 'the whole piece is under a minute' };
  else {
    const lines = await timedLines(piece, { audio, dir });
    const lyrics = piece.song ? `\nThe song:\n<<<\n${text}\n>>>\n` : '';
    const request = `Kind: ${piece.kind}\nTitle: ${title}\n${lyrics}\nThe lines, numbered, with when each is ${piece.song ? 'sung' : 'spoken'} (seconds):\n${lines.map((l, i) => `${i}. [${l.start.toFixed(1)} to ${l.end.toFixed(1)}] ${l.text}`).join('\n')}`;
    passage = await askChecked({
      label: 'passage',
      tries: 3,
      attempt: (feedback) => message(SYSTEM, request + (feedback ? `\n\n${feedback}` : ''), { model: MODEL, maxTokens: 2000 }),
      check: (raw) => {
        let choice;
        try {
          choice = parseJSON(raw);
        } catch (err) {
          return { value: null, problems: [`the reply is not JSON (${err.message})`], shown: raw };
        }
        return { ...checkPassage(choice, lines, seconds, grid), shown: raw };
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
async function renderShort(piece, { title, text, analysis, brief, edges, grid, clips, audio, dir, log = console.log, encode = (fn) => fn() }) {
  const passage = await passageFor(piece, { title, text, seconds: analysis.seconds, grid, audio, dir, log });
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
      fadeAt: passage.quiet ? Math.min(seconds - 0.3, passage.quiet - passage.start) : undefined,
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

module.exports = { renderShort, passageFor, checkPassage, spanOf, phrasesOf, MIN_SECONDS, MAX_SECONDS };
