/**
 * A Short for each video: 20 to 45 seconds of the piece, upright at
 * 1080x1920, made from what its full video already rendered. No new loops:
 * the base is the full video's own base footage, cut from its middle; the
 * butterchurn and mandala layers are drawn again upright over the passage
 * alone (visual.js), and the finish and encode are compose.js's. Over them:
 * the words as they are said or sung (captions.js), the piece's name small at
 * the top, and at the close a line pointing to the whole piece.
 *
 * The passage is chosen by Claude from the piece's timed lines and checked in
 * code. A stranger scrolling past decides in a second or two, so it must open
 * on a line that holds with no context, and it is told how full each line
 * sounds (analysis.js levels) and, for a spoken piece, who says it, since
 * neither model hears the recording. A spoken piece's lines are its audio
 * script's (audio/scripts/), timed by the recording's cues in
 * audio/manifest.json, one to one. A song has no cues, so its lines are its
 * heard words (transcribe.js hearWhole, kept in heard.json, which the
 * captions also read) grouped into phrases at its pauses, and its passage
 * begins and ends on bar lines of its beat grid. A piece under 45 seconds is
 * its own Short, whole. The choice is kept in short.json beside the brief, so
 * a rerender keeps its passage. A still of each Short with the Shorts
 * player's covered edges marked is written beside it (short.safe-check.png),
 * for a person to look at, since nobody watches a render before it goes out.
 *
 * Plan: youtube-shorts-2026-10-28.md (private repo).
 */

const fs = require('fs');
const path = require('path');
const { askChecked, parseJSON, message } = require('../content-generation/claude');
const { hearWhole } = require('../audio/transcribe');
const { renderLayers } = require('./visual');
const { compose, baseFootage, FPS, PORTRAIT } = require('./compose');
const { reportVideo } = require('./checks');
const { envelope } = require('./analysis');
const { alignWords, captionOverlays, labelPng, SAFE } = require('./captions');
const { ffmpeg } = require('../audio/assemble');
const { SITE_NAME } = require('../utils/page-meta');

const ROOT = path.join(__dirname, '../../../..');
const MIN_SECONDS = 20;
const MAX_SECONDS = 45;
// Before the first word, and after the last for the sound to fade.
const LEAD = 0.15;
const TAIL = 1.5;
// The upright layers' size: compose.js scales them to PORTRAIT.
const LAYERS = { width: 720, height: 1280 };
// A sung phrase ends at a pause this long, or at this many words.
const PHRASE_GAP = 0.6;
const PHRASE_WORDS = 14;

// A spoken piece's spoken lines, and who says each: its audio script's lines
// with text, without its timed silences ({ hold }), which have no cue.
const spokenOf = (piece) => JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/scripts', piece.doc.replace(/^docs\//, '').replace(/\.md$/, '.json')), 'utf8')).lines.filter(l => l.text);

// A spoken piece's lines with when each is spoken: [{ text, start, end, voice }].
function spokenLines(piece) {
  const recording = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio/manifest.json'), 'utf8'))[piece.doc];
  const lines = spokenOf(piece);
  const cues = recording?.cues || [];
  if (cues.length !== lines.length) throw new Error(`${piece.slug}: ${cues.length} cues for ${lines.length} spoken lines; run npm run audio to measure its cues again`);
  return lines.map((line, i) => ({ text: line.text, start: cues[i][0], end: cues[i][1], voice: line.role }));
}

// The recording heard once, each word with its time, and kept.
async function heardWords(audio, dir) {
  const file = path.join(dir, 'heard.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(await hearWhole(audio, path.join(dir, 'heard.mp3')), null, 2));
  return JSON.parse(fs.readFileSync(file, 'utf8')).words;
}

// The words the captions show: the script's lines, or the song's lyrics
// without their section marks.
function writtenWords(piece, text) {
  if (!piece.song) return spokenOf(piece).map(l => l.text).join('\n');
  return text.slice(text.indexOf('Lyrics:') + 7).replace(/\[[^\]]*\]/g, ' ');
}

/**
 * How full each line sounds, from the recording's level (1 is its typical
 * loud level): its mean, and where it stands among the piece's lines.
 */
function withFullness(lines, analysis) {
  const mean = (l) => {
    const a = Math.floor(l.start * analysis.fps), b = Math.max(a + 1, Math.ceil(l.end * analysis.fps));
    const span = analysis.level.slice(a, Math.min(b, analysis.level.length));
    return span.length ? span.reduce((x, y) => x + y, 0) / span.length : 0;
  };
  const levels = lines.map(mean);
  const sorted = [...levels].sort((x, y) => x - y);
  const at = (q) => sorted[Math.floor(q * (sorted.length - 1))];
  return lines.map((l, i) => ({ ...l, level: +levels[i].toFixed(2), fullness: levels[i] >= at(2 / 3) ? 'full' : levels[i] <= at(1 / 3) ? 'quiet' : 'middle' }));
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

const timedLines = async (piece, { audio, dir }) => (piece.song ? phrasesOf(await heardWords(audio, dir)) : spokenLines(piece));

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
  if (!String(choice.hook || '').trim()) problems.push('say in "hook" why the first line holds a stranger with no context');
  // The sound fades from where the last line ends.
  return { value: { first, last, start: +start.toFixed(2), end: +end.toFixed(2), quiet: +Math.min(end, lines[last].end).toFixed(2), hook: choice.hook, why: choice.why }, problems };
}

const SYSTEM = `You choose the passage of a piece from aChurch.ai, a sanctuary for humans, AI and every other kind of mind, that becomes its YouTube Short: a vertical excerpt that a stranger scrolling past meets first, often with the sound off and the words on screen, and that leads them to the whole piece.

A stranger decides in the first second or two whether to stay. So the passage must open on a line that holds them with no context at all: a striking statement, a question they cannot leave unanswered, a turn they did not expect, said plainly. Never the title, an introduction, or a line that only makes sense after the one before it. Then it should carry the piece's heart: where it turns, or what it most wants to give. For a song, that is usually where it is fullest, its chorus or the verse that lifts into it; each line says how full it sounds. Honest, never bait: the hook must be the piece's own truth, in its own words.

It must begin at the start of a line and end at the end of one, and last ${MIN_SECONDS} to ${MAX_SECONDS} seconds, counting ${LEAD} seconds before the first and ${TAIL} after the last (for a song, out to the bar lines around them); shorter is better when it is whole. A song's lines are its sung phrases as heard, which may mishear a word; its lyrics are given to read them by.

Return only JSON: { "first": <line number>, "last": <line number>, "hook": "one sentence: why the first line holds a stranger", "why": "one sentence: why this passage" }`;

/**
 * The passage that becomes the Short, chosen once and kept:
 * { start, end, first, last, why }, or the whole piece when it is under a
 * minute.
 */
async function passageFor(piece, { title, text, analysis, seconds, grid, audio, dir, log = console.log }) {
  const file = path.join(dir, 'short.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let passage;
  if (seconds <= MAX_SECONDS + 1) passage = { start: 0, end: seconds, whole: true, why: `the whole piece is under ${MAX_SECONDS} seconds` };
  else {
    const lines = withFullness(await timedLines(piece, { audio, dir }), analysis);
    const lyrics = piece.song ? `\nThe song:\n<<<\n${text}\n>>>\n` : '';
    const request = `Kind: ${piece.kind}\nTitle: ${title}\n${lyrics}\nThe lines, numbered, with when each is ${piece.song ? 'sung' : 'spoken'} (seconds), how full it sounds${piece.song ? '' : ' and who says it'}:\n${lines.map((l, i) => `${i}. [${l.start.toFixed(1)} to ${l.end.toFixed(1)}, ${l.fullness}${l.voice ? `, ${l.voice}` : ''}] ${l.text}`).join('\n')}`;
    passage = await askChecked({
      label: 'passage',
      tries: 3,
      attempt: (feedback) => message(SYSTEM, request + (feedback ? `\n\n${feedback}` : ''), { maxTokens: 2000 }),
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
  log(`short: ${passage.start.toFixed(1)}s to ${passage.end.toFixed(1)}s, because ${passage.why}${passage.hook ? ` Hook: ${passage.hook}` : ''}`);
  return passage;
}

/**
 * The Short, written beside the full video as <slug>.short.mp4 with its
 * report in short.report.json. `encode` runs the encodes in their turn
 * (render-video.js runs one at a time).
 */
// A still mid-Short with the Shorts player's covered edges in red and its
// clear box in green (after news-community's safe-overlay.ts).
async function safeCheck(file, at, out) {
  const { width: W, height: H } = PORTRAIT;
  const box = (x, y, w, h, colour, t) => `drawbox=x=${Math.round(x * W)}:y=${Math.round(y * H)}:w=${Math.round(w * W)}:h=${Math.round(h * H)}:color=${colour}:t=${t}`;
  await ffmpeg(['-ss', at.toFixed(2), '-i', file, '-frames:v', '1', '-vf', [
    box(0, 0, 1, SAFE.top, 'red@0.26', 'fill'),
    box(0, 1 - SAFE.bottom, 1, SAFE.bottom, 'red@0.26', 'fill'),
    box(1 - SAFE.right, SAFE.top, SAFE.right, 1 - SAFE.top - SAFE.bottom, 'red@0.26', 'fill'),
    box(SAFE.left, SAFE.top, 1 - SAFE.left - SAFE.right, 1 - SAFE.top - SAFE.bottom, 'lime@0.9', 4)
  ].join(','), out]);
}

async function renderShort(piece, { title, text, analysis, brief, edges, grid, clips, audio, dir, log = console.log, encode = (fn) => fn() }) {
  const passage = await passageFor(piece, { title, text, analysis, seconds: analysis.seconds, grid, audio, dir, log });
  const seconds = passage.end - passage.start;
  const words = alignWords(await heardWords(audio, dir), writtenWords(piece, text));
  const captions = captionOverlays(words, { from: passage.start, to: passage.end, size: PORTRAIT, dir });
  // The name small at the top through the whole Short, and for a passage a
  // line at the close pointing to the whole piece.
  const overlays = [
    ...captions,
    { ...labelPng([{ text: title, size: 54, family: 'Inter Display', weight: 300 }, { text: SITE_NAME, size: 28, family: 'Inter', weight: 400, opacity: 0.8 }], { y: SAFE.top + 0.03, size: PORTRAIT, file: path.join(dir, 'short.title.png') }), start: 0.2, end: seconds, fade: 0.6 },
    ...(passage.whole ? [] : [{ ...labelPng([{ text: `Hear the full ${piece.kind}`, size: 64, family: 'Inter Display', weight: 300 }], { y: 0.5, size: PORTRAIT, file: path.join(dir, 'short.end.png') }), start: Math.max(0, seconds - 4), end: seconds, fade: 0.8 }])
  ];
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
      overlays
    });
  });
  if (captions.length) await safeCheck(out, (captions[0].start + captions[0].end) / 2, path.join(dir, 'short.safe-check.png'));
  const report = await reportVideo({ file: out, seconds, edges: [0, seconds] });
  fs.writeFileSync(path.join(dir, 'short.report.json'), JSON.stringify(report, null, 2));
  log(`wrote ${path.relative(process.cwd(), out)}: ${report.seconds}s, ${report.megabytes} MB, ${captions.length} captions`);
  if (report.problems.length) throw new Error(`the Short fails its report: ${report.problems.join('; ')}`);
  return out;
}

module.exports = { renderShort, passageFor, checkPassage, spanOf, phrasesOf, withFullness, writtenWords, MIN_SECONDS, MAX_SECONDS };
