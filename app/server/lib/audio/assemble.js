/**
 * Joining a script's rendered lines into one recording, with FFmpeg.
 *
 * Each line becomes a mono WAV: every voice at its house gain, and several
 * voices layered for unison, scaled so a chorus is not louder than one voice.
 * Silences go between lines. The whole is loudness-normalized in two passes
 * (one pass left the 2026-10-05 demos about 1 LU short of the target) and
 * encoded as MP3.
 *
 * This runs where the render script runs. The production image has no FFmpeg,
 * and the site only ever serves the finished file.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SPEECH } = require('./house');

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
// The highest peak a finished file may decode to, in dBFS.
const CLIP_DB = -0.5;

async function lineWav(clips, out) {
  const chains = clips.map((c, i) =>
    `[${i}:a]aresample=44100,aformat=channel_layouts=mono,volume=${c.gainDb}dB[v${i}]`);
  const filter = clips.length === 1
    ? `${chains[0]};[v0]anull[out]`
    : `${chains.join(';')};${clips.map((_, i) => `[v${i}]`).join('')}amix=inputs=${clips.length}:duration=longest:normalize=0,volume=${(1 / Math.sqrt(clips.length)).toFixed(3)}[out]`;
  await ffmpeg([...clips.flatMap(c => ['-i', c.file]), '-filter_complex', filter, '-map', '[out]', ...WAV, out]);
}

async function silenceWav(seconds, out) {
  await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(seconds), ...WAV, out]);
}

// The highest peak a file decodes to, in dBFS.
async function encodedPeak(file) {
  const { stderr } = await ffmpeg(['-i', file, '-af', 'astats=measure_overall=Peak_level:measure_perchannel=none', '-f', 'null', '-']);
  return Number((stderr.match(/Peak level dB:\s*(-?[\d.]+|-inf)/g) || []).pop().split(':')[1]);
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
// exact: it is what the concatenation joins, before loudness normalization,
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

// parts: [{ clips: [{ file, gainDb }] } | { silence: seconds }], in order.
// Writes outFile and returns its length in seconds and each part's timing.
async function assemble(parts, workDir, outFile) {
  const { list, timeline } = await buildParts(parts, workDir);
  const listFile = path.join(workDir, 'list.txt');
  await fs.promises.writeFile(listFile, list.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const joined = path.join(workDir, 'joined.wav');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined]);

  const { integrated, truePeak, range } = SPEECH.loudness;
  const target = `loudnorm=I=${integrated}:TP=${truePeak}:LRA=${range}`;
  const { stderr } = await ffmpeg(['-i', joined, '-af', `${target}:print_format=json`, '-f', 'null', '-']);
  const measured = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  const apply = `${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
  await ffmpeg(['-i', joined, '-af', apply, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', SPEECH.bitrate, outFile]);
  await fs.promises.rm(workDir, { recursive: true, force: true });

  // The encoder can push peaks past what loudnorm allowed: at 64 kbps the
  // 2026-10-05 recordings decoded to +0.9 dBFS, which clips, against -1.6 at
  // 128 kbps. Measure what was actually written, and refuse a file that clips.
  const peak = await encodedPeak(outFile);
  if (peak > CLIP_DB) {
    throw new Error(`${path.basename(outFile)} peaks at ${peak.toFixed(2)} dBFS once encoded, over ${CLIP_DB}. Raise the bitrate or lower the true-peak target in audio/house-sound.json.`);
  }
  return { seconds: await seconds(outFile), timeline };
}

// Music keeps its two channels, and needs more bits than speech's mono.
const WHOLE_BITRATE = '192k';

// Audio made elsewhere, a song from its video or a meditation brought in
// whole, at the house loudness with one gain for the whole of it, so its
// dynamics stay as they were made, as stereo MP3. Its own loudness range is
// the target's, so loudnorm never squeezes music to speech's narrower range.
// outputArgs choose what of the input is kept. Returns the loudness measured
// and whether the gain was one gain throughout: loudnorm quietly turns
// dynamic when one gain would break the true-peak ceiling.
async function encodeWhole(input, outFile, outputArgs = ['-vn']) {
  const { integrated, truePeak, range } = SPEECH.loudness;
  const json = stderr => JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  const m = json((await ffmpeg(['-i', input, '-vn', '-af', `loudnorm=I=${integrated}:TP=${truePeak}:print_format=json`, '-f', 'null', '-'])).stderr);
  const lra = Math.min(50, Math.max(range, Math.ceil(Number(m.input_lra)) + 1));
  const apply = `loudnorm=I=${integrated}:TP=${truePeak}:LRA=${lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
  const { stderr } = await ffmpeg(['-i', input, ...outputArgs, '-af', apply, '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', WHOLE_BITRATE, outFile]);
  const peak = await encodedPeak(outFile);
  if (peak > CLIP_DB) throw new Error(`peaks at ${peak.toFixed(2)} dBFS once encoded, over ${CLIP_DB}`);
  return { measured: Number(m.input_i), target: integrated, linear: json(stderr).normalization_type === 'linear' };
}

// ffmpeg, seconds and encodeWhole are shared with scripts/song-audio.js and
// scripts/import-recording.js.
module.exports = { assemble, measure, ffmpeg, seconds, encodedPeak, encodeWhole, CLIP_DB };
