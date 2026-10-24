/**
 * Joining a script's rendered lines into one recording, with FFmpeg.
 *
 * Each line becomes a mono WAV: every voice at its house gain (and de-essed,
 * for a voice that needs it), and several voices layered for unison, scaled
 * so a chorus is not louder than one voice. Silences go between lines. The
 * whole is set to the house level by its voice (./levels.js), limited to the
 * house true peak, and encoded as MP3. Songs and imported recordings are set
 * the same way by what is sung (encodeWhole), so they meet the voices.
 *
 * This runs where the render script runs. The production image has no FFmpeg,
 * and the site only ever serves the finished file.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SPEECH } = require('./house');
const { decodePcm } = require('./peaks');
const { LEVEL_SAMPLE_RATE, voiceLevel, activeLevel, overLimit } = require('./levels');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => (code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-600)}`))));
  });
}

const ffmpeg = args => run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args]);
const WAV = ['-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le'];
const LEVEL = Object.fromEntries(Object.entries(SPEECH.level).map(([k, v]) => [k, v.value]));
// How far off its target a first encode may land before it is corrected.
const LEVEL_CORRECTION = 0.1;

async function lineWav(clips, out) {
  const chains = clips.map((c, i) =>
    `[${i}:a]aresample=44100,aformat=channel_layouts=mono,${c.deEss ? `deesser=i=${c.deEss},` : ''}volume=${c.gainDb}dB[v${i}]`);
  const filter = clips.length === 1
    ? `${chains[0]};[v0]anull[out]`
    : `${chains.join(';')};${clips.map((_, i) => `[v${i}]`).join('')}amix=inputs=${clips.length}:duration=longest:normalize=0,volume=${(1 / Math.sqrt(clips.length)).toFixed(3)}[out]`;
  await ffmpeg([...clips.flatMap(c => ['-i', c.file]), '-filter_complex', filter, '-map', '[out]', ...WAV, out]);
}

async function silenceWav(seconds, out) {
  await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(seconds), ...WAV, out]);
}

// The highest true peak a file decodes to, in dBTP: between the samples, as a
// player's converter reconstructs it, which is where an MP3 encode overshoots.
async function truePeakOf(file) {
  const { stderr } = await ffmpeg(['-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  return Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(stderr.slice(stderr.lastIndexOf('Summary')))[1]);
}

// Set a file to its house level and encode it: measure the level where it is
// heard (the voice over `spans`, or what is sung), one gain to `target`, the
// limiter at the true-peak ceiling (oversampled, so it sees the peaks between
// samples), then check what was written: its true peak and its level again.
// A file outside either is refused. Returns what the record keeps.
async function level(input, outFile, { spans, target, channels, bitrate, outputArgs = [] }) {
  const measureOf = samples => (spans ? voiceLevel(samples, LEVEL_SAMPLE_RATE, spans, channels) : activeLevel(samples, LEVEL_SAMPLE_RATE, channels));
  const samples = await decodePcm(input, LEVEL_SAMPLE_RATE, channels);
  const ceiling = LEVEL.truePeak - LEVEL.limiterMargin;
  const encode = async gainDb => {
    const chain = `volume=${gainDb.toFixed(2)}dB,aresample=192000,alimiter=limit=${(10 ** (ceiling / 20)).toFixed(4)}:attack=1:release=50:level=false,aresample=44100`;
    await ffmpeg(['-i', input, ...outputArgs, '-af', chain, '-ac', String(channels), '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', bitrate, outFile]);
    return measureOf(await decodePcm(outFile, LEVEL_SAMPLE_RATE, channels));
  };
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
  // The limiter lowers the level a little where it works; one correction
  // brings it back to the target, measured on what was written.
  let gain = target - measureOf(samples);
  let heard = await encode(gain);
  if (Math.abs(heard - target) > LEVEL_CORRECTION) {
    gain += target - heard;
    heard = await encode(gain);
  }
  const limited = overLimit(samples, LEVEL_SAMPLE_RATE, gain, ceiling, channels);
  const truePeak = await truePeakOf(outFile);
  const name = path.basename(outFile);
  if (truePeak > LEVEL.truePeak) throw new Error(`${name} decodes to a true peak of ${truePeak} dBTP, over ${LEVEL.truePeak}. Widen limiterMargin in audio/house-sound.json.`);
  if (Math.abs(heard - target) > LEVEL.tolerance) throw new Error(`${name} came out at ${heard.toFixed(1)} LUFS, not ${target} within ${LEVEL.tolerance}.`);
  const round = v => Math.round(v * 10) / 10;
  return { level: round(heard), truePeak, gain: round(gain), limited };
}

async function seconds(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

// A WAV's length from its own header: the data chunk's size over mono 16-bit
// at 44.1 kHz. FFmpeg writes a LIST chunk first, so the chunks are walked
// rather than assuming the 44-byte header.
function wavSeconds(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4096);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    for (let at = 12; at + 8 <= read;) {
      const id = head.toString('ascii', at, at + 4);
      const size = head.readUInt32LE(at + 4);
      if (id === 'data') return size / 2 / 44100;
      at += 8 + size + (size % 2);
    }
    throw new Error(`No data chunk in ${file}`);
  } finally {
    fs.closeSync(fd);
  }
}

// Each part as a WAV, in order, and when each starts and ends. The timeline is
// exact: it is what the concatenation joins, before the level is set,
// which changes levels and not lengths.
async function buildParts(parts, workDir) {
  await fs.promises.rm(workDir, { recursive: true, force: true });
  await fs.promises.mkdir(workDir, { recursive: true });
  const list = [];
  const timeline = [];
  const silences = new Map();
  let at = 0;
  for (const [i, part] of parts.entries()) {
    let file;
    if ('silence' in part) {
      const ms = Math.round(part.silence * 1000);
      if (!silences.has(ms)) {
        const made = path.join(workDir, `silence-${ms}.wav`);
        await silenceWav(ms / 1000, made);
        silences.set(ms, made);
      }
      file = silences.get(ms);
    } else {
      file = path.join(workDir, `line-${String(i).padStart(4, '0')}.wav`);
      await lineWav(part.clips, file);
    }
    const length = wavSeconds(file);
    timeline.push({ start: at, end: at + length });
    at += length;
    list.push(file);
  }
  return { list, timeline };
}

// When each part starts and ends, without making the recording: for timings
// of a recording made before assemble() returned them.
async function measure(parts, workDir) {
  const { timeline } = await buildParts(parts, workDir);
  await fs.promises.rm(workDir, { recursive: true, force: true });
  return timeline;
}

// parts: [{ clips: [{ file, gainDb, deEss }] } | { silence: seconds }], in order.
// Writes outFile and returns its length in seconds, each part's timing, and
// its levels.
async function assemble(parts, workDir, outFile) {
  const { list, timeline } = await buildParts(parts, workDir);
  const listFile = path.join(workDir, 'list.txt');
  await fs.promises.writeFile(listFile, list.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const joined = path.join(workDir, 'joined.wav');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined]);

  // The voice is measured over the spoken parts only: the holds and the gaps
  // between lines are the silences in the timeline.
  const spans = timeline.filter((_, i) => !('silence' in parts[i]));
  const levels = await level(joined, outFile, { spans, target: LEVEL.voice, channels: 1, bitrate: SPEECH.bitrate });
  await fs.promises.rm(workDir, { recursive: true, force: true });
  return { seconds: await seconds(outFile), timeline, levels };
}

// Music keeps its two channels, and needs more bits than speech's mono.
const WHOLE_BITRATE = '192k';

// What a song's or an imported recording's levelling depends on: the house
// level and the encoding. A song record keeps it, so a change to either
// re-makes the songs (scripts/song-audio.js), as renderKey does the speech.
const WHOLE_KEY = crypto.hash('sha256', JSON.stringify([SPEECH.level, WHOLE_BITRATE])).slice(0, 16);

// Audio made elsewhere, a song from its video or a meditation brought in
// whole, set to the house level by what is sung, as stereo MP3. One gain for
// the whole of it, so its dynamics stay as they were made, and the limiter
// only where a peak would pass the ceiling. outputArgs choose what of the
// input is kept. Returns its levels.
async function encodeWhole(input, outFile, outputArgs = ['-vn']) {
  return level(input, outFile, { target: LEVEL.sung, channels: 2, bitrate: WHOLE_BITRATE, outputArgs });
}

// ffmpeg, seconds and encodeWhole are shared with scripts/song-audio.js and
// scripts/import-recording.js.
module.exports = { assemble, measure, ffmpeg, seconds, truePeakOf, encodeWhole, WHOLE_KEY };
