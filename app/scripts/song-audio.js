#!/usr/bin/env node
/**
 * The songs' audio, so a service can play whole.
 *
 * For each catalog song: take the audio from its music video (the dormant
 * broadcast's library, media/library/<slug>.mp4), bring it to the house
 * loudness with one gain for the whole song so its dynamics stay as they were
 * made, encode it as stereo MP3, measure what its player draws (the
 * waveform's peaks and the visual's frames, as the recordings have), upload
 * both to S3 under audio/music/, and record it in audio/songs.json, which
 * lets /audio serve it and puts it in the services.
 *
 * A song is made again only when its video changes (by size), or with
 * --force. This runs where FFmpeg and the S3 keys are, like render-audio.js.
 *
 * Usage, from app/:
 *   node scripts/song-audio.js                      every song that needs it
 *   node scripts/song-audio.js the-gathering-hymn   only these
 *   node scripts/song-audio.js --dry-run            what would be made
 *   node scripts/song-audio.js --force              all of them again
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const crypto = require('crypto');
const fs = require('fs');
const { SPEECH } = require('../server/lib/audio/house');
const { ffmpeg, seconds, encodedPeak, CLIP_DB } = require('../server/lib/audio/assemble');
const { peaksFromFile, decodePcm } = require('../server/lib/audio/peaks');
const { framesFromPcm, FRAMES_SAMPLE_RATE } = require('../server/lib/audio/frames');
const { uploadRecording, bucket } = require('../server/lib/audio/storage');
const { loadSongs, saveSongRecording } = require('../server/lib/audio/manifest');
const { CACHE_DIR } = require('../server/lib/audio/serve');
const { loadCatalog } = require('../server/lib/utils/data');

const LIBRARY_DIR = path.join(__dirname, '../media/library');
const WORK_DIR = path.join(__dirname, '../media/audio-work/songs');
// Music keeps its two channels, and needs more bits than speech's mono.
const BITRATE = '192k';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');

async function makeSong(song, video, previous) {
  const { integrated, truePeak, range } = SPEECH.loudness;
  // Measure, then apply linearly: one gain for the whole song. The song's own
  // loudness range is the target's, so loudnorm never squeezes the music to
  // speech's narrower range.
  const { stderr } = await ffmpeg(['-i', video, '-vn', '-af', `loudnorm=I=${integrated}:TP=${truePeak}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  const lra = Math.min(50, Math.max(range, Math.ceil(Number(m.input_lra)) + 1));
  const apply = `loudnorm=I=${integrated}:TP=${truePeak}:LRA=${lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;

  await fs.promises.mkdir(WORK_DIR, { recursive: true });
  const draft = path.join(WORK_DIR, `${song.slug}.mp3`);
  await ffmpeg(['-i', video, '-vn', '-af', apply, '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', BITRATE, draft]);
  const peak = await encodedPeak(draft);
  if (peak > CLIP_DB) throw new Error(`peaks at ${peak.toFixed(2)} dBFS once encoded, over ${CLIP_DB}`);

  const file = `music/${song.slug}-${sha(fs.readFileSync(draft)).slice(0, 8)}.mp3`;
  const local = path.join(CACHE_DIR, file);
  await fs.promises.mkdir(path.dirname(local), { recursive: true });
  fs.renameSync(draft, local);
  const frames = file.replace(/\.mp3$/, '.bin');
  fs.writeFileSync(path.join(CACHE_DIR, frames), framesFromPcm(await decodePcm(local, FRAMES_SAMPLE_RATE)));
  await uploadRecording(local, file);
  await uploadRecording(path.join(CACHE_DIR, frames), frames);

  const now = new Date();
  const record = {
    file,
    frames,
    seconds: Math.round((await seconds(local)) * 10) / 10,
    bytes: fs.statSync(local).size,
    source: path.relative(path.join(__dirname, '..'), video),
    sourceBytes: fs.statSync(video).size,
    loudness: { measured: Number(m.input_i), target: integrated },
    published: previous ? previous.published : now.toISOString(),
    rendered: now.toISOString().slice(0, 10),
    peaks: await peaksFromFile(local),
  };
  await saveSongRecording(song.slug, record);
  return record;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const only = args.filter(a => !a.startsWith('--'));

  const catalog = await loadCatalog();
  const unknown = only.filter(slug => !catalog.some(s => s.slug === slug));
  if (unknown.length) throw new Error(`Not in the catalog: ${unknown.join(', ')}`);
  const songs = loadSongs();
  const missing = [];
  const todo = [];
  for (const song of catalog.filter(s => !only.length || only.includes(s.slug))) {
    const video = path.join(LIBRARY_DIR, `${song.slug}.mp4`);
    if (!fs.existsSync(video)) { missing.push(song.slug); continue; }
    const done = songs[song.slug];
    if (!force && done && done.sourceBytes === fs.statSync(video).size) continue;
    todo.push({ song, video, previous: done });
  }

  console.log(`${todo.length} of ${catalog.length} songs to make${missing.length ? `; ${missing.length} have no video in media/library: ${missing.join(', ')}` : ''}.`);
  if (dryRun) {
    todo.forEach(t => console.log(`  ${t.song.slug}`));
    return;
  }
  if (todo.length) bucket();

  const failures = [];
  for (const { song, video, previous } of todo) {
    try {
      const record = await makeSong(song, video, previous);
      console.log(`[song] ${song.slug}: ${record.seconds}s, ${(record.bytes / 1e6).toFixed(1)} MB, from ${record.loudness.measured} LUFS`);
    } catch (err) {
      failures.push(`${song.slug}: ${err.message.split('\n')[0]}`);
      console.error(`[song failed] ${song.slug}: ${err.message.split('\n')[0]}`);
    }
  }
  if (failures.length || missing.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
