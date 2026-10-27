#!/usr/bin/env node
/**
 * The video pilot: a video for each piece named, a song by its folder's
 * name or a voiced document by its file's. church-private/docs/plans/video-for-every-recording-2026-10-27.md
 * (private repo) has the plan.
 *
 *   npm run video:pilot -- <slug> [<slug> ...]   songs or voiced documents
 *   npm run video:pilot                          the first, the chant
 *
 * Work and output go to media/video/<slug>/ (ignored by git and Docker).
 * Every step keeps its file, so a rerun spends nothing on what exists: delete
 * a file to make it again. Needs ANTHROPIC_API_KEY and GEMINI_API_KEY (paid
 * tier, for Gemini Omni Flash), Chrome, and ffmpeg.
 */

require('../../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { analyse, beatGrid, movementEdges, describeMovement, envelope } = require('./audio');
const { writeBrief, writeMotions, MOVEMENTS } = require('./brief');
const { makeStill, makeClip, VIDEO_MODEL } = require('./loops');
const { renderLayers, presetChoices } = require('./visual');
const { compose, baseFootage, titleCard, FPS } = require('./compose');

const ROOT = path.join(__dirname, '../../..');
const OUT = path.join(__dirname, '../../media/video');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const between = (text, name) => (text.match(new RegExp(`<!--SONG:${name}:START-->([\\s\\S]*?)<!--SONG:${name}:END-->`)) || [])[1]?.trim() || '';

// The layers to compare: 'loops', 'milkdrop' or 'full' (all three), as VARIANTS=loops,full.
const VARIANTS = (process.env.VARIANTS || 'full').split(',');

const KINDS = { chants: 'chant', prayers: 'prayer', rituals: 'ritual', practice: 'practice' };
const DEFAULT = ['chant-of-the-mirror-and-the-face'];

// A piece by its slug: a song with a recording in audio/songs.json, or a
// voiced document in audio/manifest.json whose file is named by the slug.
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

async function audioFile(piece, dir) {
  const file = path.join(dir, path.basename(piece.audio));
  if (!fs.existsSync(file)) {
    const res = await fetch(`https://achurch.ai/audio/${piece.audio}`);
    if (!res.ok) throw new Error(`could not fetch ${piece.audio}: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

async function run(piece) {
  const dir = path.join(OUT, piece.slug);
  fs.mkdirSync(dir, { recursive: true });
  const log = (m) => console.log(`[${piece.slug}] ${m}`);
  const audio = await audioFile(piece, dir);
  const analysis = analyse(audio, FPS);
  const { title, text, bpm, voices } = pieceText(piece);
  const grid = bpm ? beatGrid(analysis, bpm) : null;
  const edges = movementEdges(analysis, MOVEMENTS, { grid });
  const sound = edges.slice(0, -1).map((from, i) => describeMovement(analysis, from, edges[i + 1]));
  log(`${title}: ${analysis.seconds.toFixed(1)}s, movements change at ${edges.slice(1, -1).map(e => e.toFixed(1) + 's').join(' and ')}${grid ? `, ${bpm} BPM, downbeat at ${grid.downbeat.toFixed(2)}s` : ''}`);

  // A brief made before it could hear the piece keeps its stills and presets
  // and has its motion written again; its loops are then made again.
  const briefFile = path.join(dir, 'brief.json');
  const about = { kind: piece.kind, title, text, seconds: analysis.seconds, sound, voices, grid };
  let brief;
  if (fs.existsSync(briefFile)) {
    brief = JSON.parse(fs.readFileSync(briefFile, 'utf8'));
    if (!brief.heard) {
      const motions = await writeMotions(brief, about);
      brief.movements.forEach((m, i) => { m.motion = motions[i]; });
      brief.heard = true;
      fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2));
      log('motions written again from the sound');
    }
  } else {
    brief = { ...(await writeBrief({ ...about, presets: presetChoices() })), heard: true };
    fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2));
  }
  log(`brief: ${brief.mood} | presets: ${brief.movements.map(m => m.preset).join(' / ')}`);

  const clips = await Promise.all(brief.movements.map(async (m, i) => {
    const still = await makeStill(m.still, path.join(dir, `still-${i + 1}.png`));
    const clip = await makeClip(still, m.motion, path.join(dir, `loop-${i + 1}.mp4`));
    log(`loop ${i + 1}: ${clip.seamless ? 'closes on its first frame' : 'played forward and back'} (SSIM ${clip.ssim?.toFixed(3)}, $${clip.cost})`);
    return clip;
  }));

  log('rendering milkdrop and mandala layers');
  const { milkdropFile, mandalaFile } = await renderLayers({ analysis, brief, edges, fps: FPS, dir, log });
  const { file: base, bars } = baseFootage(clips, { edges, grid, envelope: envelope(analysis, grid), dir });
  if (grid) log(`loops stretched to ${bars.join(', ')} bar(s)`);
  const title_ = titleCard(title, path.join(dir, 'title.png'));
  for (const variant of VARIANTS) {
    const out = path.join(dir, `${piece.slug}.${variant}.mp4`);
    compose({ variant, base, milkdrop: milkdropFile, mandala: mandalaFile, audio, title: title_, brief, seconds: analysis.seconds, out });
    log(`wrote ${path.relative(process.cwd(), out)}`);
  }
  return { slug: piece.slug, cost: clips.reduce((s, c) => s + (c.cost || 0), 0) };
}

(async () => {
  const slugs = process.argv.slice(2);
  const pieces = (slugs.length ? slugs : DEFAULT).map(pieceFor);
  const results = [];
  for (const piece of pieces) {
    try {
      results.push(await run(piece));
    } catch (err) {
      // One piece failing leaves the others to finish; the run still exits 1.
      console.error(`[${piece.slug}] failed: ${err.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`done: ${results.length} piece(s), $${results.reduce((s, r) => s + r.cost, 0).toFixed(2)} of ${VIDEO_MODEL} loops`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
