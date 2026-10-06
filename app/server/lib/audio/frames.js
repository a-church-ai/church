/**
 * The data the player's visual draws from: twenty times a second, how loud
 * the recording is and how much each of 16 bands of the voice range (60 Hz to
 * 1.5 kHz) carries, one byte each.
 *
 * Precomputed rather than read live from the playing audio. An analyser in the
 * browser would route the recording through Web Audio, and an iPhone with its
 * silent switch on plays an <audio> element but not Web Audio, so the visual
 * would silence the recording for those listeners. Precomputed, the player
 * only reads its own position, and the audio never depends on a decoration.
 *
 * The method follows the music-videos visualizer's offline analyser
 * (docs/audio-visualizer.md there), with its lesson kept: each window is
 * centred on its frame's own timestamp. A window that starts at the timestamp
 * looks 32 ms into the future, and peaks land early. Levels are auto-gained to
 * the recording over its audible frames only, so a meditation's silences do
 * not set the scale.
 *
 * The .bin format:
 *   bytes 0-3  "ACF1"
 *   byte 4     frames per second
 *   byte 5     bands
 *   then one record per frame: loudness, then the bands from low to high.
 *
 * Loudness 255 is 1.25 times the recording's typical loud level, so peaks
 * can overshoot the way speech does.
 */

const FPS = 20;
const BANDS = 16;
const FRAMES_SAMPLE_RATE = 16000;
const WINDOW = 1024;
const LOW_HZ = 60;
const HIGH_HZ = 1500;
const MAGIC = 'ACF1';
const HEADER = 6;
const SILENCE_RMS = 0.001;
const LOUD_HEADROOM = 1.25;

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

// In-place radix-2 FFT; n must be a power of two.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(angle * k);
        const s = Math.sin(angle * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * c - im[b] * s;
        const xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

const clamp01 = v => Math.min(1, Math.max(0, v));

// Mono 16-bit PCM in, the .bin bytes out.
function framesFromPcm(samples, sampleRate = FRAMES_SAMPLE_RATE) {
  const count = Math.max(1, Math.ceil((samples.length / sampleRate) * FPS));
  const hann = Float64Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)));
  const binHz = sampleRate / WINDOW;
  const bandBins = Array.from({ length: BANDS }, (_, b) => {
    const lo = Math.floor((LOW_HZ + ((HIGH_HZ - LOW_HZ) * b) / BANDS) / binHz);
    const hi = Math.ceil((LOW_HZ + ((HIGH_HZ - LOW_HZ) * (b + 1)) / BANDS) / binHz);
    return [lo, Math.max(hi, lo + 1)];
  });

  const loud = new Float64Array(count);
  const level = new Float64Array(count * BANDS);
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  for (let f = 0; f < count; f++) {
    const start = Math.round((f * sampleRate) / FPS) - WINDOW / 2;
    let sum = 0;
    for (let i = 0; i < WINDOW; i++) {
      const j = start + i;
      const v = j >= 0 && j < samples.length ? samples[j] / 32768 : 0;
      sum += v * v;
      re[i] = v * hann[i];
      im[i] = 0;
    }
    loud[f] = Math.sqrt(sum / WINDOW);
    fft(re, im);
    for (let b = 0; b < BANDS; b++) {
      const [lo, hi] = bandBins[b];
      let s = 0;
      for (let k = lo; k < hi; k++) s += Math.hypot(re[k], im[k]);
      level[f * BANDS + b] = 20 * Math.log10(s / (hi - lo) / (WINDOW / 2) + 1e-9);
    }
  }

  const audible = [];
  for (let f = 0; f < count; f++) if (loud[f] > SILENCE_RMS) audible.push(f);
  const loudHi = percentile(audible.map(f => loud[f]), 95);
  const bandValues = new Float64Array(audible.length * BANDS);
  audible.forEach((f, i) => bandValues.set(level.subarray(f * BANDS, (f + 1) * BANDS), i * BANDS));
  const lo = percentile(bandValues, 10);
  const hi = percentile(bandValues, 99);

  const out = new Uint8Array(HEADER + count * (1 + BANDS));
  for (let i = 0; i < 4; i++) out[i] = MAGIC.charCodeAt(i);
  out[4] = FPS;
  out[5] = BANDS;
  for (let f = 0; f < count; f++) {
    if (!(loud[f] > SILENCE_RMS)) continue;
    const o = HEADER + f * (1 + BANDS);
    out[o] = loudHi > 0 ? Math.round((Math.min(LOUD_HEADROOM, loud[f] / loudHi) / LOUD_HEADROOM) * 255) : 0;
    for (let b = 0; b < BANDS; b++) {
      out[o + 1 + b] = hi > lo ? Math.round(clamp01((level[f * BANDS + b] - lo) / (hi - lo)) * 255) : 0;
    }
  }
  return out;
}

// The .bin's shape, for tests and for anything reading one on the server.
function parseFrames(bytes) {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== MAGIC) throw new Error(`Not a frames file (${magic})`);
  const fps = bytes[4];
  const bands = bytes[5];
  const stride = 1 + bands;
  const count = Math.floor((bytes.length - HEADER) / stride);
  return {
    fps,
    bands,
    count,
    loud: f => bytes[HEADER + f * stride],
    band: (f, b) => bytes[HEADER + f * stride + 1 + b],
  };
}

module.exports = { framesFromPcm, parseFrames, FPS, BANDS, FRAMES_SAMPLE_RATE, LOW_HZ, HIGH_HZ, MAGIC };
