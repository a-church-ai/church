/**
 * A recording's waveform: 128 bytes that draw it as a row of bars, which the
 * player fills as it plays (lib/docs/render.js draws them, site-player.js
 * moves the fill).
 *
 * Measured once, when the recording is made, never in the browser: the page
 * shows how long a piece is and where its speaking and silences fall before
 * anyone presses play. Ported on 2026-10-05 from news-community's
 * audio-peaks.ts, with its constants unchanged, because its reasons hold for
 * speech:
 *
 *   - RMS per bucket, quantised to a byte.
 *   - Full height is the 95th percentile of the audible windows, not the
 *     loudest moment, so one plosive cannot squash every other bar. Windows
 *     eight times finer than a bucket give that percentile enough samples to
 *     trim an outlier.
 *   - Windows below about -60 dBFS are left out of the percentile, or a piece
 *     that is mostly silence (a meditation's holds) would scale against the
 *     silence and draw nothing.
 *   - The floor is zero. The minimum bar height is a drawing choice, applied
 *     where the bars are drawn, so the stored values stay what was measured.
 *
 * Buckets are contiguous and equal, so bucket i covers [i/n, (i+1)/n] of the
 * recording and the playhead needs no offset.
 */

const { spawn } = require('child_process');

const BUCKETS = 128;
const PEAK_MAX = 255;
const FINE_PER_BUCKET = 8;
const HI_PERCENTILE = 95;
const SILENCE_RMS = 0.001;
const INT16_SCALE = 32768;
const PEAKS_SAMPLE_RATE = 8000;

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function rmsOf(samples, start, end) {
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    const v = samples[i] / INT16_SCALE;
    sum += v * v;
  }
  return Math.sqrt(sum / (end - start));
}

// PCM in, `buckets` bytes out. Silence returns zeros: a silent recording is a
// real thing to draw, and distinct from having no waveform at all.
function peaksFromPcm(samples, buckets = BUCKETS) {
  if (!samples.length) return new Array(buckets).fill(0);
  const fineCount = buckets * FINE_PER_BUCKET;
  const fine = new Array(fineCount);
  for (let i = 0; i < fineCount; i++) {
    fine[i] = rmsOf(samples, Math.floor((i * samples.length) / fineCount), Math.floor(((i + 1) * samples.length) / fineCount));
  }
  const hi = percentile(fine.filter(v => v > SILENCE_RMS), HI_PERCENTILE);
  const peaks = new Array(buckets);
  for (let b = 0; b < buckets; b++) {
    let sum = 0;
    for (let f = b * FINE_PER_BUCKET; f < (b + 1) * FINE_PER_BUCKET; f++) sum += fine[f] * fine[f];
    const level = hi > 1e-9 ? Math.sqrt(sum / FINE_PER_BUCKET) / hi : 0;
    peaks[b] = Math.round(Math.min(1, Math.max(0, level)) * PEAK_MAX);
  }
  return peaks;
}

// Decode an audio file to mono signed 16-bit samples at `sampleRate`, with
// FFmpeg on the machine that renders. The production image has none, and
// nothing here runs there.
function decodePcm(file, sampleRate) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(sampleRate), 'pipe:1']);
    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', c => chunks.push(c));
    proc.stderr.on('data', c => { if (stderr.length < 4096) stderr += c; });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffmpeg could not decode ${file}: ${stderr.trim()}`));
      const pcm = Buffer.concat(chunks);
      const out = new Int16Array(Math.floor(pcm.length / 2));
      for (let i = 0; i < out.length; i++) out[i] = pcm.readInt16LE(i * 2);
      resolve(out);
    });
  });
}

async function peaksFromFile(file) {
  return peaksFromPcm(await decodePcm(file, PEAKS_SAMPLE_RATE));
}

module.exports = { peaksFromPcm, peaksFromFile, decodePcm, BUCKETS, PEAK_MAX };
