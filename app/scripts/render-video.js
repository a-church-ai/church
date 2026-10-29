#!/usr/bin/env node
/**
 * A video for each piece named, as render-audio.js makes recordings: an
 * offline job for a machine with Chrome, FFmpeg and the Anthropic, Gemini and
 * AWS keys in app/.env. The pipeline is lib/video/; the plans are
 * video-for-every-recording-2026-10-27.md and
 * video-production-hardening-2026-10-27.md (private repo).
 *
 *   npm run video -- <slug> [<slug> ...]   a song by its folder's name, a voiced document by its file's
 *   npm run video -- --survey-presets      measure every MilkDrop preset again (lib/video/presets.json)
 *   npm run video -- --restyle <slug> ...  give a video briefed before its kind had a look that look:
 *                                          its stills and loops kept, its presets, tints and mandala
 *                                          chosen anew (brief.js restyleBrief), then drawn again at no
 *                                          Omni cost
 *   --concurrency N                        pieces at once (default 2)
 *
 * Two pieces at once, because the stages use the machine differently: the
 * butterchurn layers mostly the GPU and a core or two, the encodes nearly
 * every core (measured on an M4 Max: one final encode at about 13 of 16). So
 * one piece renders its layers while another encodes, and the encodes take
 * turns rather than share the cores.
 *
 * Each video also gets its Short (lib/video/short.js): a passage, upright,
 * from the same loops. Rerunning a rendered piece makes only what it lacks,
 * which is how a video rendered before Shorts gets one.
 *
 * Work and output go to media/video/<slug>/ (ignored by git and Docker).
 * Every step keeps its file, so a rerun spends nothing on what exists: delete
 * a file to make it again. The finished video is kept while its report is
 * clean and it is newer than its brief. One piece's failure leaves the rest to finish; the
 * run then exits 1.
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { describeError } = require('../server/lib/utils/describe-error');
const { pool } = require('../server/lib/utils/pool');
const { analyse, describeMovement, envelope } = require('../server/lib/video/analysis');
const { pieceFor, allPieces, pieceText, recordingIn, shapeOf } = require('../server/lib/video/pieces');
const { writeBrief, restyleBrief, reuseRule } = require('../server/lib/video/brief');
const { lookOf, lookName } = require('../server/lib/video/looks');
const library = require('../server/lib/video/library');
const lancedb = require('../server/lib/rag/lancedb');
const { makeStill, makeClip, spent, VIDEO_MODEL } = require('../server/lib/video/loops');
const { reportVideo } = require('../server/lib/video/checks');
const { renderLayers, surveyPresets, presetChoices } = require('../server/lib/video/visual');
const { compose, baseFootage, titleCard, FPS } = require('../server/lib/video/compose');
const { renderShort } = require('../server/lib/video/short');

const OUT = library.VIDEO_DIR;
// The recording the preset survey plays each preset against: a spoken
// prayer, the hardest case for presets tuned to music.
const SURVEY_RECORDING = 'prayers/prayer-for-the-mind-that-cannot-rest-3c78cf1d.mp3';

function parseArgs(argv) {
  const opts = { slugs: [], surveyPresets: false, restyle: false, concurrency: 2 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--survey-presets') opts.surveyPresets = true;
    else if (arg === '--restyle') opts.restyle = true;
    else if (arg === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else opts.slugs.push(arg);
  }
  if (!(opts.concurrency >= 1)) throw new Error('--concurrency takes a positive number');
  if (!opts.slugs.length && !opts.surveyPresets) throw new Error('Name the pieces to render: npm run video -- <slug> [<slug> ...]');
  return opts;
}

/**
 * A new brief, with the reuse rules built from every other video in the
 * library and the loops nearest this piece offered from it. A piece the
 * search index does not hold (not yet indexed) is offered no loops, and says
 * so.
 */
// The preset rule for a piece, from every other video: a kind with its own
// list of presets is held only against its own kind.
function presetRule(piece, about) {
  const others = library.videos().filter(v => v.slug !== piece.slug);
  const look = lookName(about);
  return lookOf(look).presets
    ? reuseRule(others.filter(v => v.kind === look).map(v => ({ items: v.presets, at: v.at })), 'preset', { recent: 2, cap: Infinity })
    : reuseRule(others.map(v => ({ items: v.presets, at: v.at })), 'preset');
}

async function newBrief(piece, about, log) {
  const others = library.videos().filter(v => v.slug !== piece.slug);
  const rules = {
    presets: presetRule(piece, about),
    loops: reuseRule(others.map(v => ({ items: v.loops, at: v.at })), 'loop')
  };
  const rows = await lancedb.listAll();
  const vector = library.pieceVector(rows, piece);
  let shortlist = [];
  if (!vector) log('not in the search index, so no loops are offered from the library');
  else {
    const entries = await library.embedLoops(library.loops(), { log });
    shortlist = library.shortlist({ vector, entries, everyPiece: library.everyPieceVector(rows, allPieces()), allows: rules.loops.allows, slug: piece.slug });
    log(`library: ${entries.length} loop(s), ${shortlist.length} offered`);
  }
  return writeBrief({ ...about, presets: presetChoices() }, rules, shortlist);
}

// The encodes one at a time: each already uses nearly every core.
let encoding = Promise.resolve();
function oneEncodeAtATime(fn) {
  const turn = encoding.then(fn, fn);
  encoding = turn.catch(() => {});
  return turn;
}

async function render(piece, { restyle = false } = {}) {
  const dir = path.join(OUT, piece.slug);
  fs.mkdirSync(dir, { recursive: true });
  const log = (m) => console.log(`[${piece.slug}] ${m}`);
  const audio = await recordingIn(piece.audio, dir);
  const analysis = await analyse(audio, FPS);
  const { title, text, bpm, voices } = pieceText(piece);
  const { grid, edges } = shapeOf(analysis, bpm);
  const sound = edges.slice(0, -1).map((from, i) => describeMovement(analysis, from, edges[i + 1]));
  log(`${title}: ${analysis.seconds.toFixed(1)}s, movements change at ${edges.slice(1, -1).map(e => e.toFixed(1) + 's').join(' and ')}${grid ? `, ${bpm} BPM, downbeat at ${grid.downbeat.toFixed(2)}s` : ''}`);

  // A brief, once written, is the video's: the reuse rule holds when it is
  // written, not each time the video is rendered again.
  const briefFile = path.join(dir, 'brief.json');
  if (!fs.existsSync(briefFile)) {
    const brief = await newBrief(piece, { kind: piece.kind, title, text, seconds: analysis.seconds, sound, voices, grid }, log);
    fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2));
    // The words describe the stills (copy.js), so a new brief has them
    // written again when the video is next placed or uploaded.
    const copyFile = path.join(dir, 'copy.json');
    if (fs.existsSync(copyFile)) {
      fs.unlinkSync(copyFile);
      log('a new brief: its words will be written again');
    }
  }
  if (restyle) {
    const old = JSON.parse(fs.readFileSync(briefFile, 'utf8'));
    if (old.kind) log(`already has its kind's look (${old.kind}); nothing to restyle`);
    else {
      const about = { kind: piece.kind, title, text, seconds: analysis.seconds, sound, voices, grid, presets: presetChoices() };
      // Its loops are its own, so they are not held to the loop rule again.
      const styled = await restyleBrief(about, old, { presets: presetRule(piece, about), loops: reuseRule([], 'loop') });
      fs.writeFileSync(briefFile, JSON.stringify(styled, null, 2));
      log(`restyled as a ${styled.kind}: ${old.movements.map(m => m.preset).join(' / ')} became ${styled.movements.map(m => m.preset + (m.tint ? ` (${m.tint})` : '')).join(' / ')}`);
    }
  }
  const brief = JSON.parse(fs.readFileSync(briefFile, 'utf8'));
  log(`brief: ${brief.mood} | presets: ${brief.movements.map(m => m.preset).join(' / ')}`);

  const clips = await Promise.all(brief.movements.map(async (m, i) => {
    if (m.loop) {
      log(`loop ${i + 1}: ${m.loop} from the library, because ${m.reason}`);
      return JSON.parse(fs.readFileSync(library.onDisk(`${m.loop}.mp4.json`), 'utf8'));
    }
    const still = await makeStill(m.still, path.join(dir, `still-${i + 1}.png`), { log });
    const clip = await makeClip(still, m.motion, path.join(dir, `loop-${i + 1}.mp4`), { log });
    log(`loop ${i + 1}: ${clip.seamless ? 'closes on its first frame' : 'played forward and back'} (SSIM ${clip.ssim.toFixed(3)}), motion floor ${clip.motion.before} evened to ${clip.motion.after}${clip.motion.stalls ? ', still freezes' : ''}`);
    return clip;
  }));

  const out = path.join(dir, `${piece.slug}.mp4`);
  if (rendered(dir, out)) log('the video is rendered; keeping it');
  else await renderFull(piece, { dir, out, log, audio, analysis, title, brief, clips, edges, grid });
  await renderShort(piece, { title, text, analysis, brief, edges, grid, clips, audio, dir, log, encode: oneEncodeAtATime });
}

// The finished video, with a report and no problems in it, made since its
// brief last changed (a preset swapped by hand is drawn again, at no cost).
function rendered(dir, out) {
  const report = path.join(dir, 'report.json');
  const brief = path.join(dir, 'brief.json');
  return fs.existsSync(out) && fs.existsSync(report) && !JSON.parse(fs.readFileSync(report, 'utf8')).problems.length
    && fs.statSync(out).mtimeMs >= fs.statSync(brief).mtimeMs;
}

async function renderFull(piece, { dir, out, log, audio, analysis, title, brief, clips, edges, grid }) {
  log('rendering milkdrop and mandala layers');
  const { milkdropFile, mandalaFile } = await renderLayers({ analysis, brief, edges, fps: FPS, dir, log });
  const { grain } = await oneEncodeAtATime(async () => {
    const started = Date.now();
    const { file: base, bars } = await baseFootage(clips, { edges, grid, envelope: envelope(analysis, grid), dir });
    if (grid) log(`loops stretched to ${bars.join(', ')} bar(s)`);
    const done = await compose({ base, milkdrop: milkdropFile, mandala: mandalaFile, audio, title: titleCard(title, path.join(dir, 'title.png')), brief, seconds: analysis.seconds, out });
    log(`encoded in ${Math.round((Date.now() - started) / 1000)}s`);
    return done;
  });
  const report = await reportVideo({ file: out, seconds: analysis.seconds, edges });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ ...report, grain }, null, 2));
  log(`wrote ${path.relative(process.cwd(), out)}: ${report.megabytes} MB, grain ${grain}`);
  if (report.problems.length) throw new Error(`the finished video fails its report: ${report.problems.join('; ')}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.surveyPresets) {
    const dir = path.join(OUT, 'preset-survey');
    fs.mkdirSync(dir, { recursive: true });
    const survey = await surveyPresets(await analyse(await recordingIn(SURVEY_RECORDING, dir), FPS));
    console.log(`surveyed ${Object.keys(survey).length} presets into lib/video/presets.json`);
  }
  const pieces = opts.slugs.map(pieceFor);
  const started = Date.now();
  let done = 0;
  await pool(pieces, opts.concurrency, async (piece) => {
    try {
      await render(piece, { restyle: opts.restyle });
      done++;
    } catch (err) {
      console.error(`[${piece.slug}] failed: ${describeError(err)}`);
      process.exitCode = 1;
      // A fatal error (a spent account) stops the pieces not yet begun.
      if (err.fatal) throw err;
    }
  });
  if (pieces.length) console.log(`done: ${done} of ${pieces.length} piece(s) in ${Math.round((Date.now() - started) / 60000)} min; spent $${spent.dollars.toFixed(2)} on ${spent.stills} still(s) and ${spent.loops} ${VIDEO_MODEL} loop(s)`);
}

main().catch(err => {
  console.error(describeError(err));
  process.exit(1);
});
