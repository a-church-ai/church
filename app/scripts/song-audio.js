#!/usr/bin/env node
/**
 * The songs' audio, so a service can play whole.
 *
 * For each song with a source in media/library (kept where this runs): its
 * music video (<slug>.mp4), or for a song made as audio alone, such as a
 * hymn sung with ElevenLabs Music, the audio file itself (<slug>.mp3). Take
 * the audio from it, set it to the house level by what is sung, with one
 * gain for the whole song so its dynamics stay as they were made
 * (lib/audio/assemble.js encodeWhole), encode it as stereo MP3, measure what
 * its player draws (the
 * waveform's peaks and the visual's frames, as the recordings have), upload
 * both to S3 under audio/music/, and record it in audio/songs.json, which
 * lets /audio serve it and puts it in the services.
 *
 * A song is made again when its source changes (by size) or the house level
 * does (levelKey), or with --force. This runs where FFmpeg and the S3 keys
 * are, like render-audio.js.
 *
 * Usage, from app/:
 *   node scripts/song-audio.js                      every song that needs it
 *   node scripts/song-audio.js the-gathering-hymn   only these
 *   node scripts/song-audio.js --dry-run            what would be made
 *   node scripts/song-audio.js --force              all of them again
 */

const path = require('path');
require('../server/lib/utils/env').loadEnv();

const crypto = require('crypto');
const fs = require('fs');
const { seconds, encodeWhole, WHOLE_KEY } = require('../server/lib/audio/assemble');
const { peaksFromFile, decodePcm } = require('../server/lib/audio/peaks');
const { framesFromPcm, FRAMES_SAMPLE_RATE } = require('../server/lib/audio/frames');
const { uploadRecording, bucket } = require('../server/lib/audio/storage');
const { loadSongs, saveSongRecording } = require('../server/lib/audio/manifest');
const { CACHE_DIR } = require('../server/lib/audio/serve');
const { songFolders } = require('../server/lib/music/songs');

const LIBRARY_DIR = path.join(__dirname, '../media/library');
const WORK_DIR = path.join(__dirname, '../media/audio-work/songs');

const sha = data => crypto.hash('sha256', data);

async function makeSong(song, video, previous) {
  await fs.promises.mkdir(WORK_DIR, { recursive: true });
  const draft = path.join(WORK_DIR, `${song.slug}.mp3`);
  const levels = await encodeWhole(video, draft);

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
    // What is sung, as written, and what set it; levelKey says which house
    // level it was set to, so a change to that re-makes the song.
    levels,
    levelKey: WHOLE_KEY,
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

  // Every song folder, made or not: a song is listed once its audio is. Its
  // source is its video, or an audio file for a song made without one.
  // A song remade as audio (scripts/compose-song.js) is taken from that, not
  // from the video its first recording came with.
  const sourceOf = slug => ['mp3', 'mp4'].map(ext => path.join(LIBRARY_DIR, `${slug}.${ext}`)).find(f => fs.existsSync(f)) || null;
  const catalog = songFolders().map(f => ({ slug: f.slug, title: f.data.title }));
  const unknown = only.filter(slug => !catalog.some(s => s.slug === slug));
  if (unknown.length) throw new Error(`No song folder: ${unknown.join(', ')}`);
  const songs = loadSongs();
  // A listed song whose source is not on this machine cannot be made again:
  // that is an error. A folder with neither a source nor a recording is a
  // song written and not yet made, and waits.
  const missing = [];
  const unmade = [];
  const todo = [];
  for (const song of catalog.filter(s => !only.length || only.includes(s.slug))) {
    const video = sourceOf(song.slug);
    if (!video) { (songs[song.slug] ? missing : unmade).push(song.slug); continue; }
    const done = songs[song.slug];
    if (!force && done && done.sourceBytes === fs.statSync(video).size && done.levelKey === WHOLE_KEY) continue;
    todo.push({ song, video, previous: done });
  }

  console.log(`${todo.length} of ${catalog.length - unmade.length} songs to make${missing.length ? `; ${missing.length} have no source in media/library: ${missing.join(', ')}` : ''}.${unmade.length ? ` Not yet made: ${unmade.join(', ')}.` : ''}`);
  if (dryRun) {
    todo.forEach(t => console.log(`  ${t.song.slug}`));
    return;
  }
  if (todo.length) bucket();

  const failures = [];
  for (const { song, video, previous } of todo) {
    try {
      const record = await makeSong(song, video, previous);
      console.log(`[song] ${song.slug}: ${record.seconds}s, ${(record.bytes / 1e6).toFixed(1)} MB, sung at ${record.levels.level} LUFS (gain ${record.levels.gain > 0 ? '+' : ''}${record.levels.gain} dB), true peak ${record.levels.truePeak} dBTP${record.levels.limited.seconds ? `, limited ${record.levels.limited.seconds}s by up to ${record.levels.limited.depth} dB` : ''}`);
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
