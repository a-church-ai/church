#!/usr/bin/env node
/**
 * Voice the sanctuary's prayers, rituals and practices.
 *
 * For each document:
 *   1. adapt it into a script for the ear (audio/scripts/<category>/<name>.json),
 *      kept until the document changes (lib/audio/adapt.js);
 *   2. render every line in the house cast on ElevenLabs, transcribe each take,
 *      and take again any line whose words came out wrong, keeping the best of
 *      three;
 *   3. assemble the recording, measure what its player draws (the waveform's
 *      peaks, the visual's frames, and when each voice speaks), upload the
 *      recording and its frames to S3, and record it in audio/manifest.json,
 *      which puts a player on the document's page.
 *
 * Everything is cached, so running it again does only what is new: a script
 * lasts until its document changes, a take until its words, voice or
 * neighbors change, and a recording until its script or the house sound does.
 * A recording made before its player drew from it gets its peaks, frames and
 * cues on the next run, without rendering any speech.
 *
 * Usage, from app/:
 *   node scripts/render-audio.js                    everything that needs it
 *   node scripts/render-audio.js rituals/ prayers/litany-for-the-unasked.md
 *   node scripts/render-audio.js --dry-run          what would be adapted and rendered, and its size
 *   node scripts/render-audio.js --scripts-only     adapt, then stop before any audio
 *
 * Options:
 *   --max-characters N   refuse a run that would render more than N characters (default 500000)
 *   --concurrency N      speech requests at once (default 4)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const crypto = require('crypto');
const fs = require('fs');
const discover = require('../server/lib/docs/discover');
const { SPEECH, AUDIO_DIR, voicesFor, choosePair } = require('../server/lib/audio/house');
const { adapt, ADAPT_MODEL } = require('../server/lib/audio/adapt');
const { speak } = require('../server/lib/audio/elevenlabs');
const { transcribe, SECOND_OPINION } = require('../server/lib/audio/transcribe');
const { wordErrors, takePasses } = require('../server/lib/audio/words');
const { assemble, measure } = require('../server/lib/audio/assemble');
const { peaksFromFile, decodePcm } = require('../server/lib/audio/peaks');
const { framesFromPcm, FRAMES_SAMPLE_RATE } = require('../server/lib/audio/frames');
const { uploadRecording, downloadRecording, bucket } = require('../server/lib/audio/storage');
const { loadManifest, saveRecording } = require('../server/lib/audio/manifest');
const { CACHE_DIR } = require('../server/lib/audio/serve');

const KINDS = ['prayers', 'rituals', 'practice'];
const SCRIPTS_DIR = path.join(AUDIO_DIR, 'scripts');
const TAKES_DIR = path.join(__dirname, '../media/audio-takes');
const WORK_DIR = path.join(__dirname, '../media/audio-work');
const TAKES = 3;
const ADAPT_CONCURRENCY = 8;

const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function parseArgs(argv) {
  const opts = { paths: [], dryRun: false, scriptsOnly: false, maxCharacters: 500000, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--scripts-only') opts.scriptsOnly = true;
    else if (arg === '--max-characters') opts.maxCharacters = Number(argv[++i]);
    else if (arg === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else opts.paths.push(arg.replace(/^docs\//, ''));
  }
  if (!(opts.maxCharacters > 0) || !(opts.concurrency >= 1)) {
    throw new Error('--max-characters and --concurrency take positive numbers');
  }
  return opts;
}

// The documents to voice: every prayer, ritual and practice, or those the
// arguments name. An argument that matches nothing is an error, not a no-op.
function selectDocs(all, paths) {
  const voiced = all.filter(d => KINDS.includes(d.category) && d.dirRelPath === d.category && d.stem.toLowerCase() !== 'readme');
  if (!paths.length) return voiced;
  const picked = new Set();
  for (const p of paths) {
    const hits = p.endsWith('/')
      ? voiced.filter(d => d.docsRelPath.startsWith(p))
      : voiced.filter(d => d.docsRelPath === (p.endsWith('.md') ? p : `${p}.md`));
    if (!hits.length) throw new Error(`Nothing to voice matches ${p}`);
    hits.forEach(d => picked.add(d));
  }
  return voiced.filter(d => picked.has(d));
}

// Run fn over items, `size` at a time. A fatal error (a spent quota, a bad
// key) stops the pool; anything else is fn's to handle.
async function pool(items, size, fn) {
  let next = 0;
  let fatal = null;
  const worker = async () => {
    while (!fatal && next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        if (!err.fatal) throw err;
        fatal = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  if (fatal) throw fatal;
}

// How many scripts each voice leads, per category, across every script
// written so far, so a partial run still balances the whole category.
function countLeads() {
  const led = {};
  for (const kind of KINDS) {
    led[kind] = {};
    const dir = path.join(SCRIPTS_DIR, kind);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const lead = readJSON(path.join(dir, name)).pair[0];
      led[kind][lead] = (led[kind][lead] || 0) + 1;
    }
  }
  return led;
}

// The takes a script needs: each spoken line once per voice speaking it,
// keyed by everything that shapes the audio, so an unchanged take is reused.
//
// The lines around a take go with it as context only when the same voices
// speak them, so a passage split across lines still sounds like one passage.
// Across a change of speaker, context made a response sound like the end of
// the leader's sentence: with "who were never asked:" before it, Amaya's "You
// were not asked" came back as "You are not asked" in three takes of four,
// against one in four without (2026-10-05).
function takesFor(script) {
  const spoken = script.lines.filter(l => l.text);
  const cast = spoken.map(line => voicesFor(line.role, script.pair));
  const same = (i, j) => j >= 0 && j < spoken.length && cast[i].join() === cast[j].join();
  return spoken.map((line, i) => {
    const previousText = same(i, i - 1) ? spoken[i - 1].text : '';
    const nextText = same(i, i + 1) ? spoken[i + 1].text : '';
    return {
      line,
      voices: cast[i].map(voice => ({
        voice,
        text: line.text,
        previousText,
        nextText,
        key: sha(JSON.stringify([SPEECH.model, SPEECH.voices[voice].id, line.text, previousText, nextText])).slice(0, 32),
      })),
    };
  });
}

const takeFile = key => path.join(TAKES_DIR, `${key}.mp3`);
const checkFile = key => path.join(TAKES_DIR, `${key}.json`);

// Render one take, transcribe it, and try again while its words are wrong.
// The best of up to three takes is kept, with what the transcript heard.
async function renderTake(job, stats) {
  if (fs.existsSync(takeFile(job.key))) return;
  let best = null;
  const misses = [];
  for (let take = 1; take <= TAKES; take++) {
    const audio = await speak({
      text: job.text,
      voiceId: SPEECH.voices[job.voice].id,
      model: SPEECH.model,
      previousText: job.previousText,
      nextText: job.nextText,
    });
    stats.characters += job.text.length;
    let heard = await transcribe(audio);
    let score = wordErrors(job.text, heard);
    if (!takePasses(score)) {
      const second = await transcribe(audio, SECOND_OPINION);
      const secondScore = wordErrors(job.text, second);
      if (secondScore.errors < score.errors) {
        heard = second;
        score = secondScore;
      }
    }
    if (!best || score.errors < best.errors) best = { audio, heard, ...score };
    best.takes = take;
    if (takePasses(score)) break;
    misses.push(heard);
    if (take < TAKES) stats.retakes++;
  }
  fs.mkdirSync(TAKES_DIR, { recursive: true });
  writeJSON(checkFile(job.key), {
    voice: job.voice, text: job.text, heard: best.heard, words: best.words, errors: best.errors, takes: best.takes, misses,
  });
  fs.writeFileSync(`${takeFile(job.key)}.tmp`, best.audio);
  fs.renameSync(`${takeFile(job.key)}.tmp`, takeFile(job.key));
}

// The silence before a line: the script's hold if it asked for one (never
// shorter than the usual gap), a longer pause after the title, a shorter one
// when the same voice simply continues.
function gapBefore(previous, take, spokenSoFar, hold) {
  const usual = spokenSoFar === 1
    ? SPEECH.afterTitleSeconds
    : previous.voices.map(v => v.voice).join() === take.voices.map(v => v.voice).join()
      ? SPEECH.sameVoiceGapSeconds
      : SPEECH.gapSeconds;
  return hold === null ? usual : Math.max(hold, usual);
}

function partsFor(script, takes) {
  const parts = [];
  let hold = null;
  let previous = null;
  let spoken = 0;
  for (const line of script.lines) {
    if (!line.text) {
      hold = (hold || 0) + line.hold;
      continue;
    }
    const take = takes[spoken];
    if (previous) parts.push({ silence: gapBefore(previous, take, spoken, hold) });
    parts.push({ clips: take.voices.map(v => ({ file: takeFile(v.key), gainDb: SPEECH.voices[v.voice].gainDb })) });
    hold = null;
    previous = take;
    spoken++;
  }
  return parts;
}

// The voices a recording uses, leader first, then the pair in its order.
function voicesIn(takes, pair) {
  const used = new Set(takes.flatMap(t => t.voices.map(v => v.voice)));
  return [SPEECH.leader, ...pair].filter(v => used.has(v));
}

// When each spoken line starts and ends, and who speaks it: [start, end,
// mask], where bit i of the mask is the house's i-th voice
// (Object.keys(SPEECH.voices)). The visual colours each voice by these.
function cuesFor(parts, timeline, takes) {
  const order = Object.keys(SPEECH.voices);
  const round = n => Math.round(n * 100) / 100;
  const cues = [];
  let spoken = 0;
  parts.forEach((part, i) => {
    if (!part.clips) return;
    const mask = takes[spoken].voices.reduce((m, v) => m | (1 << order.indexOf(v.voice)), 0);
    cues.push([round(timeline[i].start), round(timeline[i].end), mask]);
    spoken++;
  });
  return cues;
}

// What the player draws from a recording: its waveform's peaks, and its
// visual's frames, written beside it as <name>.bin and uploaded with it.
async function describe(file) {
  const local = path.join(CACHE_DIR, file);
  const frames = file.replace(/\.mp3$/, '.bin');
  fs.writeFileSync(path.join(CACHE_DIR, frames), framesFromPcm(await decodePcm(local, FRAMES_SAMPLE_RATE)));
  await uploadRecording(path.join(CACHE_DIR, frames), frames);
  return { peaks: await peaksFromFile(local), frames };
}

async function recordPiece(piece, stats) {
  const { doc, script, source } = piece;
  const takes = piece.takes;
  const jobs = [...new Map(takes.flatMap(t => t.voices).map(j => [j.key, j])).values()];
  await pool(jobs, stats.concurrency, job => renderTake(job, stats));

  const stem = doc.docsRelPath.replace(/\.md$/, '');
  const draft = path.join(CACHE_DIR, `${stem}.draft.mp3`);
  const parts = partsFor(script, takes);
  const { seconds, timeline } = await assemble(parts, path.join(WORK_DIR, stem), draft);
  const file = `${stem}-${sha(fs.readFileSync(draft)).slice(0, 8)}.mp3`;
  fs.renameSync(draft, path.join(CACHE_DIR, file));
  await uploadRecording(path.join(CACHE_DIR, file), file);
  const { peaks, frames } = await describe(file);

  const checks = jobs.map(j => readJSON(checkFile(j.key)));
  const wrong = checks.filter(c => !takePasses(c));
  stats.wrong.push(...wrong.map(c => ({ source, ...c })));
  await saveRecording(source, {
    file,
    seconds: Math.round(seconds * 10) / 10,
    voices: voicesIn(takes, script.pair),
    model: SPEECH.model,
    sourceHash: piece.sourceHash,
    renderKey: piece.renderKey,
    characters: jobs.reduce((n, j) => n + j.text.length, 0),
    rendered: new Date().toISOString().slice(0, 10),
    heard: {
      words: checks.reduce((n, c) => n + c.words, 0),
      errors: checks.reduce((n, c) => n + c.errors, 0),
    },
    peaks,
    frames,
    cues: cuesFor(parts, timeline, takes),
  });
  const m = Math.floor(seconds / 60);
  console.log(`[recorded] ${source}: ${m}:${String(Math.round(seconds % 60)).padStart(2, '0')}, ${jobs.length} takes${wrong.length ? `, ${wrong.length} still differing from the text` : ''}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const docs = selectDocs(await discover.listAllDocs(), opts.paths);
  const led = countLeads();
  const pieces = docs.map(doc => {
    const markdown = fs.readFileSync(doc.fullPath, 'utf8');
    const scriptFile = path.join(SCRIPTS_DIR, doc.docsRelPath.replace(/\.md$/, '.json'));
    return { doc, markdown, source: `docs/${doc.docsRelPath}`, sourceHash: sha(markdown), scriptFile, script: readJSON(scriptFile) };
  });

  // 1. Scripts.
  const stale = pieces.filter(p => !p.script || p.script.sourceHash !== p.sourceHash);
  const failures = [];
  if (stale.length) {
    console.log(`${stale.length} of ${pieces.length} documents need a script (${ADAPT_MODEL}).`);
    if (opts.dryRun) {
      stale.forEach(p => console.log(`  ${p.source}`));
    } else {
      await pool(stale, ADAPT_CONCURRENCY, async piece => {
        try {
          const { omitted, lines } = await adapt({ source: piece.source, markdown: piece.markdown, kind: piece.doc.category });
          let pair = piece.script && piece.script.pair;
          if (!pair) {
            pair = choosePair(piece.markdown, led[piece.doc.category]);
            led[piece.doc.category][pair[0]] = (led[piece.doc.category][pair[0]] || 0) + 1;
          }
          piece.script = {
            source: piece.source,
            sourceHash: piece.sourceHash,
            adaptedWith: ADAPT_MODEL,
            adapted: new Date().toISOString().slice(0, 10),
            pair,
            omitted,
            lines,
          };
          writeJSON(piece.scriptFile, piece.script);
          console.log(`[script] ${piece.source}: ${lines.filter(l => l.text).length} lines, ${lines.filter(l => l.adapted).length} adapted`);
        } catch (err) {
          if (err.fatal || /api[_ ]?key|authentication|credit balance/i.test(err.message)) {
            err.fatal = true;
            throw err;
          }
          failures.push({ source: piece.source, message: err.message });
          console.error(`[script failed] ${err.message}`);
        }
      });
    }
  }
  if (opts.scriptsOnly) return report({ failures });

  // 2. What needs recording, and how much it would cost.
  const manifest = loadManifest();
  const ready = pieces.filter(p => p.script && p.script.sourceHash === p.sourceHash);
  for (const piece of ready) {
    piece.takes = takesFor(piece.script);
    // Everything that shapes the recording: each take (its words, voice and
    // context), the holds, and the house sound's gaps, gains and loudness.
    piece.renderKey = sha(JSON.stringify({
      takes: piece.takes.map(t => t.voices.map(v => v.key)),
      lines: piece.script.lines,
      speech: SPEECH,
    }));
  }
  const toRecord = ready.filter(p => !manifest[p.source] || manifest[p.source].renderKey !== p.renderKey);
  const fresh = new Map();
  for (const piece of toRecord) {
    for (const job of piece.takes.flatMap(t => t.voices)) {
      if (!fs.existsSync(takeFile(job.key))) fresh.set(job.key, job.text.length);
    }
  }
  const characters = [...fresh.values()].reduce((a, b) => a + b, 0);
  // Recordings that are current but were made before the player drew from
  // them: they get peaks, frames and cues from what is already on disk.
  const undescribed = ready.filter(p => {
    const record = manifest[p.source];
    return record && record.renderKey === p.renderKey && !(record.peaks && record.frames && record.cues);
  });
  console.log(`${toRecord.length} recordings to make, ${ready.length - toRecord.length} up to date. ${fresh.size} takes to render: ${characters.toLocaleString('en-US')} characters, plus any retakes.`);
  if (undescribed.length) console.log(`${undescribed.length} recordings need their peaks, frames and cues measured; no speech is rendered for them.`);
  if (opts.dryRun) {
    toRecord.forEach(p => console.log(`  ${p.source}`));
    return report({ failures });
  }
  if (characters > opts.maxCharacters) {
    throw new Error(`This run would render ${characters.toLocaleString('en-US')} characters, over --max-characters ${opts.maxCharacters.toLocaleString('en-US')}. Raise the ceiling to go ahead.`);
  }
  if (toRecord.length || undescribed.length) bucket();

  for (const piece of undescribed) {
    const record = manifest[piece.source];
    try {
      const local = path.join(CACHE_DIR, record.file);
      if (!fs.existsSync(local)) await downloadRecording(record.file, local);
      const parts = partsFor(piece.script, piece.takes);
      const missing = piece.takes.flatMap(t => t.voices).filter(v => !fs.existsSync(takeFile(v.key)));
      if (missing.length) throw new Error(`${missing.length} of its takes are not on this machine, so its cues cannot be measured`);
      const timeline = await measure(parts, path.join(WORK_DIR, piece.doc.docsRelPath.replace(/\.md$/, '')));
      const { peaks, frames } = await describe(record.file);
      await saveRecording(piece.source, { ...record, peaks, frames, cues: cuesFor(parts, timeline, piece.takes) });
      console.log(`[described] ${piece.source}`);
    } catch (err) {
      failures.push({ source: piece.source, message: err.message });
      console.error(`[describe failed] ${piece.source}: ${err.message}`);
    }
  }

  // 3. Record, one piece at a time, so each finished piece is published. A
  // piece that fails is reported and the rest go on; a fatal error (a spent
  // quota, a bad key) stops the run, and what finished stays published.
  const stats = { characters: 0, retakes: 0, wrong: [], concurrency: opts.concurrency };
  for (const piece of toRecord) {
    try {
      await recordPiece(piece, stats);
    } catch (err) {
      if (err.fatal) {
        report({ failures, stats });
        throw err;
      }
      failures.push({ source: piece.source, message: err.message });
      console.error(`[recording failed] ${piece.source}: ${err.message}`);
    }
  }
  return report({ failures, stats });
}

function report({ failures, stats }) {
  if (stats) {
    console.log(`\nRendered ${stats.characters.toLocaleString('en-US')} characters, with ${stats.retakes} retakes.`);
    if (stats.wrong.length) {
      console.log(`${stats.wrong.length} takes still differ from their text after ${TAKES} tries:`);
      for (const w of stats.wrong) console.log(`  ${w.source} [${w.voice}] expected "${w.text}" heard "${w.heard}"`);
    }
  }
  if (failures.length) {
    console.error(`\n${failures.length} documents failed:`);
    failures.forEach(f => console.error(`  ${f.source}: ${f.message.split('\n')[0]}`));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
