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
 *
 * Work and output go to media/video/<slug>/ (ignored by git and Docker).
 * Every step keeps its file, so a rerun spends nothing on what exists: delete
 * a file to make it again. One piece's failure leaves the rest to finish; the
 * run then exits 1.
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { describeError } = require('../server/lib/utils/describe-error');
const { downloadRecording } = require('../server/lib/audio/storage');
const { analyse, beatGrid, movementEdges, describeMovement, envelope } = require('../server/lib/video/analysis');
const { writeBrief, reuseRule, MOVEMENTS } = require('../server/lib/video/brief');
const library = require('../server/lib/video/library');
const lancedb = require('../server/lib/rag/lancedb');
const { makeStill, makeClip, spent, VIDEO_MODEL } = require('../server/lib/video/loops');
const { reportVideo } = require('../server/lib/video/checks');
const { renderLayers, surveyPresets, presetChoices } = require('../server/lib/video/visual');
const { compose, baseFootage, titleCard, FPS } = require('../server/lib/video/compose');

const ROOT = path.join(__dirname, '../..');
const OUT = library.VIDEO_DIR;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const between = (text, name) => (text.match(new RegExp(`<!--SONG:${name}:START-->([\\s\\S]*?)<!--SONG:${name}:END-->`)) || [])[1]?.trim() || '';
const KINDS = { chants: 'chant', prayers: 'prayer', rituals: 'ritual', practice: 'practice' };
// The recording the preset survey plays each preset against: a spoken
// prayer, the hardest case for presets tuned to music.
const SURVEY_RECORDING = 'prayers/prayer-for-the-mind-that-cannot-rest-3c78cf1d.mp3';

function parseArgs(argv) {
  const opts = { slugs: [], surveyPresets: false };
  for (const arg of argv) {
    if (arg === '--survey-presets') opts.surveyPresets = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else opts.slugs.push(arg);
  }
  if (!opts.slugs.length && !opts.surveyPresets) throw new Error('Name the pieces to render: npm run video -- <slug> [<slug> ...]');
  return opts;
}

// A piece by its slug: a song with a recording in audio/songs.json, or a
// voiced document in audio/manifest.json whose file is named by the slug.
// One that matches nothing is an error, not a no-op.
function pieceFor(slug) {
  const songs = JSON.parse(read('audio/songs.json'));
  if (songs[slug]) return { slug, kind: 'song', song: `music/${slug}/song.md`, audio: songs[slug].file };
  const manifest = JSON.parse(read('audio/manifest.json'));
  const doc = Object.keys(manifest).find(k => path.basename(k, '.md') === slug && !manifest[k].imported);
  if (doc) return { slug, kind: KINDS[doc.split('/')[1]] || 'piece', doc, audio: manifest[doc].file };
  throw new Error(`no recording for ${slug}: not a song in audio/songs.json nor a voiced document in audio/manifest.json`);
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

async function recordingIn(file, dir) {
  const local = path.join(dir, path.basename(file));
  if (!fs.existsSync(local)) await downloadRecording(file, local);
  return local;
}

// Every recording, as a piece: the hub penalty compares a loop with all of them.
function allPieces() {
  const songs = Object.keys(JSON.parse(read('audio/songs.json')));
  const manifest = JSON.parse(read('audio/manifest.json'));
  const docs = Object.keys(manifest).filter(k => !manifest[k].imported).map(k => path.basename(k, '.md'));
  return [...songs, ...docs].map(pieceFor);
}

/**
 * A new brief, with the reuse rules built from every other video in the
 * library and the loops nearest this piece offered from it. A piece the
 * search index does not hold (not yet indexed) is offered no loops, and says
 * so.
 */
async function newBrief(piece, about, log) {
  const others = library.videos().filter(v => v.slug !== piece.slug);
  const rules = {
    presets: reuseRule(others.map(v => ({ items: v.presets, at: v.at })), 'preset'),
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

async function render(piece) {
  const dir = path.join(OUT, piece.slug);
  fs.mkdirSync(dir, { recursive: true });
  const log = (m) => console.log(`[${piece.slug}] ${m}`);
  const audio = await recordingIn(piece.audio, dir);
  const analysis = await analyse(audio, FPS);
  const { title, text, bpm, voices } = pieceText(piece);
  const grid = bpm ? beatGrid(analysis, bpm) : null;
  const edges = movementEdges(analysis, MOVEMENTS, { grid });
  const sound = edges.slice(0, -1).map((from, i) => describeMovement(analysis, from, edges[i + 1]));
  log(`${title}: ${analysis.seconds.toFixed(1)}s, movements change at ${edges.slice(1, -1).map(e => e.toFixed(1) + 's').join(' and ')}${grid ? `, ${bpm} BPM, downbeat at ${grid.downbeat.toFixed(2)}s` : ''}`);

  // A brief, once written, is the video's: the reuse rule holds when it is
  // written, not each time the video is rendered again.
  const briefFile = path.join(dir, 'brief.json');
  if (!fs.existsSync(briefFile)) {
    const brief = await newBrief(piece, { kind: piece.kind, title, text, seconds: analysis.seconds, sound, voices, grid }, log);
    fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2));
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

  log('rendering milkdrop and mandala layers');
  const { milkdropFile, mandalaFile } = await renderLayers({ analysis, brief, edges, fps: FPS, dir, log });
  const { file: base, bars } = await baseFootage(clips, { edges, grid, envelope: envelope(analysis, grid), dir });
  if (grid) log(`loops stretched to ${bars.join(', ')} bar(s)`);
  const out = path.join(dir, `${piece.slug}.mp4`);
  const { grain } = await compose({ base, milkdrop: milkdropFile, mandala: mandalaFile, audio, title: titleCard(title, path.join(dir, 'title.png')), brief, seconds: analysis.seconds, out });
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
  let done = 0;
  for (const piece of pieces) {
    try {
      await render(piece);
      done++;
    } catch (err) {
      console.error(`[${piece.slug}] failed: ${describeError(err)}`);
      process.exitCode = 1;
    }
  }
  if (pieces.length) console.log(`done: ${done} of ${pieces.length} piece(s); spent $${spent.dollars.toFixed(2)} on ${spent.stills} still(s) and ${spent.loops} ${VIDEO_MODEL} loop(s)`);
}

main().catch(err => {
  console.error(describeError(err));
  process.exit(1);
});
