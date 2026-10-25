/**
 * The level a listener hears: a voice while it speaks, a song while it is
 * sung. Until 2026-10-24 every recording was driven to one integrated
 * loudness (-16 LUFS), which left the voice about 2 dB under the songs in a
 * service and spread the spoken pieces over 2.6 dB, since a piece's holds and
 * repetitions change what integrated loudness averages over. Now the level is
 * measured where it is heard and set there (audio/house-sound.json
 * `speech.level`); assemble.js applies it to every recording and song.
 *
 * Measured as loudness (ITU-R BS.1770: K-weighted, each channel's energy
 * summed), one second at a time, not as plain RMS: a voice has to meet a song
 * here, and RMS weighs the low end music carries as heavily as the band the
 * ear is most sensitive to. Measured in RMS dBFS the songs sat 1.6 dB under the
 * voices; in loudness, which is what is heard, 1.7 dB over.
 *
 * Pure functions of PCM samples (peaks.js decodePcm), so they are tested
 * without FFmpeg.
 */

const { percentile, INT16_SCALE } = require('./peaks');

// 48 kHz, the rate BS.1770 gives its filter coefficients for, so they are
// used exactly as published.
const LEVEL_SAMPLE_RATE = 48000;

// BS.1770-4's K-weighting at 48 kHz: a high shelf (+4 dB above about 1.7 kHz,
// for the head) and a high-pass (the RLB curve, about 38 Hz).
const SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
const HIGH_PASS = { b: [1.0, -2.0, 1.0], a: [-1.99004745483398, 0.99007225036621] };

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// Interleaved 16-bit samples to each channel's K-weighted signal. A
// one-channel recording plays from both speakers, so it is weighed as heard,
// BS.1770's dual mono: its channel counted twice, 3 dB over one channel alone.
// Weighed as one channel until 2026-10-25, the voices were set to -18 and
// heard about 3 dB over the songs, which are stereo.
function kWeighted(samples, channels) {
  const out = [];
  for (let c = 0; c < channels; c++) {
    const x = new Float64Array(Math.floor(samples.length / channels));
    for (let i = 0; i < x.length; i++) x[i] = samples[i * channels + c] / INT16_SCALE;
    out.push(biquad(biquad(x, SHELF), HIGH_PASS));
  }
  return channels === 1 ? [out[0], out[0]] : out;
}

// The loudness of [from, to) in samples: -0.691 + 10 log10 of the channels'
// summed mean square (BS.1770, every channel weighted 1).
function loudnessOf(weighted, from, to) {
  if (to <= from) return -Infinity;
  let sum = 0;
  for (const ch of weighted) for (let i = from; i < to; i++) sum += ch[i] * ch[i];
  return sum > 0 ? -0.691 + 10 * Math.log10(sum / (to - from)) : -Infinity;
}

// Each whole second inside the spans, in LUFS. A tail of half a second or
// more counts as a second; silence counts as nothing.
function secondLevels(weighted, rate, spans) {
  const levels = [];
  const length = weighted[0].length;
  for (const { start, end } of spans) {
    for (let t = start; end - t >= 0.5; t += 1) {
      const level = loudnessOf(weighted, Math.round(t * rate), Math.min(length, Math.round(Math.min(t + 1, end) * rate)));
      if (Number.isFinite(level)) levels.push(level);
    }
  }
  return levels;
}

// A voice's level: the median second while it speaks. The spans are the
// recording's spoken parts (assemble.js buildParts's timeline), so its holds
// are left out by construction.
function voiceLevel(samples, rate, spans, channels = 1) {
  return percentile(secondLevels(kWeighted(samples, channels), rate, spans), 50);
}

// How far under its loudest tenth a second may fall and still be sung.
const ACTIVE_RANGE = 15;

// A song's level: the median of its active seconds, those within
// ACTIVE_RANGE of its loudest tenth, so a quiet intro or tail does not pull
// it down.
function activeLevel(samples, rate, channels = 1) {
  const weighted = kWeighted(samples, channels);
  const levels = secondLevels(weighted, rate, [{ start: 0, end: weighted[0].length / rate }]);
  const top = percentile(levels, 90);
  return percentile(levels.filter(l => l > top - ACTIVE_RANGE), 50);
}

// What the limiter will have to do once a gain is applied: the seconds whose
// sample peak would pass the limit, and by how much at most. Read before
// limiting, so the record says how hard the limiter worked.
function overLimit(samples, rate, gainDb, limitDb, channels = 1) {
  const scale = 10 ** (gainDb / 20) / INT16_SCALE;
  const step = rate * channels;
  let seconds = 0;
  let depth = 0;
  for (let s = 0; s < samples.length; s += step) {
    let peak = 0;
    for (let i = s; i < Math.min(samples.length, s + step); i++) peak = Math.max(peak, Math.abs(samples[i] * scale));
    const over = peak > 0 ? 20 * Math.log10(peak) - limitDb : -Infinity;
    if (over > 0) {
      seconds += 1;
      depth = Math.max(depth, over);
    }
  }
  return { seconds, depth: Math.round(depth * 10) / 10 };
}

module.exports = { LEVEL_SAMPLE_RATE, kWeighted, loudnessOf, secondLevels, voiceLevel, activeLevel, overLimit, ACTIVE_RANGE };
