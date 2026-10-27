/**
 * What the visual layers hear: the recording decoded once, then read per
 * video frame. Each frame's window is centred on its own timestamp (the
 * lesson frames.js keeps: a window starting at the timestamp looks ahead and
 * peaks land early).
 *
 * waveform(frame): the 1024 samples butterchurn's analyser would have given,
 *   as bytes centred on 128, for both channels and their mix, gained so a
 *   spoken piece moves the presets as music would.
 * bands(frame): BANDS log-spaced bands from 40 Hz to 8 kHz, each auto-gained
 *   to the recording over its audible frames and smoothed (fast attack, slow
 *   release), for the mandala; and the frame's loudness on the same scale.
 */

const { spawnSync } = require('child_process');

const RATE = 44100;
const WAVE = 1024;
const FFT = 2048;
const BANDS = 48;

function decode(file) {
  const out = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '2', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  if (out.status !== 0) throw new Error(`ffmpeg could not decode ${file}: ${out.stderr}`);
  const pcm = new Int16Array(out.stdout.buffer, out.stdout.byteOffset, out.stdout.length / 2);
  const n = pcm.length / 2;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = pcm[2 * i] / 32768;
    right[i] = pcm[2 * i + 1] / 32768;
  }
  return { left, right, seconds: n / RATE };
}

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
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 1;
}

function analyse(file, fps) {
  const { left, right, seconds } = decode(file);
  const frames = Math.ceil(seconds * fps);
  const at = (f) => Math.round((f / fps) * RATE);
  const sample = (ch, i) => (i >= 0 && i < ch.length ? ch[i] : 0);

  const edges = Array.from({ length: BANDS + 1 }, (_, b) => 40 * Math.pow(8000 / 40, b / BANDS));
  const hann = Float32Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const raw = [];
  const loud = [];
  for (let f = 0; f < frames; f++) {
    const centre = at(f);
    const re = new Float32Array(FFT), im = new Float32Array(FFT);
    let sum = 0;
    for (let i = 0; i < FFT; i++) {
      const s = (sample(left, centre - FFT / 2 + i) + sample(right, centre - FFT / 2 + i)) / 2;
      re[i] = s * hann[i];
      sum += s * s;
    }
    fft(re, im);
    const bands = new Float32Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      const lo = Math.max(1, Math.floor((edges[b] * FFT) / RATE));
      const hi = Math.max(lo + 1, Math.ceil((edges[b + 1] * FFT) / RATE));
      let m = 0;
      for (let k = lo; k < hi; k++) m = Math.max(m, Math.hypot(re[k], im[k]));
      bands[b] = Math.sqrt(m);
    }
    raw.push(bands);
    loud.push(Math.sqrt(sum / FFT));
  }

  const audible = loud.map((l, f) => (l > 0.003 ? f : -1)).filter(f => f >= 0);
  const scale = Array.from({ length: BANDS }, (_, b) => percentile(audible.map(f => raw[f][b]), 0.95) || 1);
  const loudScale = percentile(audible.map(f => loud[f]), 0.95) || 1;
  const smooth = new Float32Array(BANDS);
  let smoothLoud = 0;
  const bandFrames = raw.map((bands, f) => {
    const out = new Float32Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      const v = Math.min(1.3, bands[b] / scale[b]);
      smooth[b] = v > smooth[b] ? v : smooth[b] * 0.86 + v * 0.14;
      out[b] = smooth[b];
    }
    const l = Math.min(1.3, loud[f] / loudScale);
    smoothLoud = l > smoothLoud ? smoothLoud * 0.5 + l * 0.5 : smoothLoud * 0.9 + l * 0.1;
    return { bands: Array.from(out, v => +v.toFixed(3)), loud: +smoothLoud.toFixed(3) };
  });

  // MilkDrop presets are tuned for music at full scale; a voice at the house
  // level barely moves them. The waveform is gained so the recording's loud
  // moments reach 90% of full scale, and clipped beyond.
  const peaks = audible.map(f => {
    let m = 0;
    for (let i = at(f) - WAVE / 2; i < at(f) + WAVE / 2; i++) m = Math.max(m, Math.abs(sample(left, i)), Math.abs(sample(right, i)));
    return m;
  });
  const gain = 0.9 / (percentile(peaks, 0.9) || 1);
  const bytes = (ch, centre) => Array.from({ length: WAVE }, (_, i) => Math.max(0, Math.min(255, Math.round(128 + 127 * gain * sample(ch, centre - WAVE / 2 + i)))));
  function waveform(f) {
    const centre = at(f);
    const l = bytes(left, centre), r = bytes(right, centre);
    return { mono: l.map((v, i) => (v + r[i]) >> 1), left: l, right: r };
  }

  // Loudness on the recording's own scale (1 = its typical loud moment), and
  // onset strength: how much the spectrum rose since the frame before.
  const level = loud.map(l => l / loudScale);
  const flux = raw.map((bands, f) => {
    if (!f) return 0;
    let s = 0;
    for (let b = 0; b < BANDS; b++) s += Math.max(0, bands[b] / scale[b] - raw[f - 1][b] / scale[b]);
    return s / BANDS;
  });

  return { seconds, frames, fps, waveform, bands: (f) => bandFrames[Math.min(f, frames - 1)], level, flux, rawBands: raw, bandScale: scale };
}

const SILENT = 0.1;

// Stretches below a tenth of the typical loud level for at least minSeconds:
// the pauses between a spoken piece's lines.
function pauses(analysis, minSeconds = 0.25) {
  const { level, fps } = analysis;
  const found = [];
  let start = -1;
  for (let f = 0; f <= level.length; f++) {
    const quiet = f < level.length && level[f] < SILENT;
    if (quiet && start < 0) start = f;
    if (!quiet && start >= 0) {
      if ((f - start) / fps >= minSeconds) found.push({ start: start / fps, end: f / fps });
      start = -1;
    }
  }
  return found;
}

// Where the sound changes character: the distance between the mean spectrum
// of the three seconds before and the three after, sampled every quarter
// second. For music, which seldom pauses, these mark its sections.
function novelty(analysis, span = 3) {
  const { rawBands, bandScale, fps, frames } = analysis;
  const w = Math.round(span * fps);
  const mean = (from, to) => {
    const m = new Float32Array(BANDS);
    for (let f = Math.max(0, from); f < Math.min(frames, to); f++) for (let b = 0; b < BANDS; b++) m[b] += rawBands[f][b] / bandScale[b];
    const n = Math.max(1, Math.min(frames, to) - Math.max(0, from));
    return m.map(v => v / n);
  };
  const points = [];
  for (let f = w; f < frames - w; f += Math.round(fps / 4)) {
    const a = mean(f - w, f), b = mean(f, f + w);
    points.push({ t: f / fps, score: a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / BANDS });
  }
  return points.filter((p, i) => (!i || p.score >= points[i - 1].score) && (i === points.length - 1 || p.score >= points[i + 1].score));
}

/**
 * A song's beat grid from its stated tempo: the phase of the beat that best
 * lines up with the onsets, and of the bar (four beats) whose first beat
 * carries the most. { beat, bar, downbeat } in seconds.
 */
function beatGrid(analysis, bpm) {
  const { flux, fps, seconds } = analysis;
  const beat = 60 / bpm;
  const strength = (phase, step) => {
    let s = 0;
    for (let t = phase; t < seconds; t += step) s += flux[Math.round(t * fps)] || 0;
    return s;
  };
  let best = 0, bestScore = -1;
  for (let p = 0; p < beat; p += 1 / fps) {
    const s = strength(p, beat);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  let downbeat = best, downScore = -1;
  for (let k = 0; k < 4; k++) {
    const s = strength(best + k * beat, 4 * beat);
    if (s > downScore) { downScore = s; downbeat = best + k * beat; }
  }
  return { bpm, beat, bar: 4 * beat, downbeat };
}

/**
 * Where the movements change: near each equal division of the piece, at the
 * longest nearby pause (spoken pieces) or the strongest change in the sound
 * (songs), snapped to a bar line when there is a beat grid. Returns the
 * n + 1 edges, from 0 to the end.
 */
function movementEdges(analysis, n, { grid, minGap = 6 } = {}) {
  const { seconds } = analysis;
  const section = seconds / n;
  const quiet = pauses(analysis).map(p => ({ t: (p.start + p.end) / 2, score: p.end - p.start }));
  const candidates = quiet.length >= n ? quiet : novelty(analysis);
  const top = Math.max(...candidates.map(c => c.score), 1e-9);
  const edges = [0];
  for (let i = 1; i < n; i++) {
    const target = i * section;
    let best = { t: target, value: -Infinity };
    for (const c of candidates) {
      const off = Math.abs(c.t - target) / section;
      if (off > 0.3) continue;
      const value = c.score / top - off;
      if (value > best.value) best = { t: c.t, value };
    }
    let t = best.t;
    if (grid) t = grid.downbeat + Math.round((t - grid.downbeat) / grid.bar) * grid.bar;
    t = Math.max(edges[edges.length - 1] + minGap, Math.min(seconds - minGap * (n - i), t));
    edges.push(+t.toFixed(3));
  }
  edges.push(seconds);
  return edges;
}

// What a movement sounds like, for the brief: how much of it is voice or
// music, its pauses, how loud it is and which way it moves.
function describeMovement(analysis, from, to) {
  const { level, fps } = analysis;
  const span = level.slice(Math.round(from * fps), Math.round(to * fps));
  const sounding = span.filter(l => l >= SILENT);
  const inside = pauses(analysis)
    .map(p => ({ start: Math.max(p.start, from), end: Math.min(p.end, to) }))
    .filter(p => p.end - p.start >= 0.25);
  const half = Math.floor(span.length / 2);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  return {
    from: +from.toFixed(1),
    to: +to.toFixed(1),
    sounding: +(sounding.length / Math.max(1, span.length)).toFixed(2),
    pauses: inside.length,
    longestPause: +Math.max(0, ...inside.map(p => p.end - p.start)).toFixed(1),
    loudness: +avg(sounding).toFixed(2),
    trend: +(avg(span.slice(half)) - avg(span.slice(0, half))).toFixed(2)
  };
}

/**
 * The loop's answer to the sound, frame by frame: an envelope that rises with
 * the recording's loudness at once and falls slowly, and for a song a pulse
 * on each beat, strongest where the onset is. Each is 0 to about 1.
 */
function envelope(analysis, grid) {
  const { level, flux, fps, frames } = analysis;
  const fluxScale = percentile(flux.filter(v => v > 0), 0.95) || 1;
  const out = [];
  let env = 0;
  for (let f = 0; f < frames; f++) {
    const l = Math.min(1.2, level[f]);
    env = l > env ? env * 0.6 + l * 0.4 : env * 0.94 + l * 0.06;
    let pulse = 0;
    if (grid) {
      const t = f / fps;
      const since = ((t - grid.downbeat) % grid.beat + grid.beat) % grid.beat;
      const hit = Math.round((t - since) * fps);
      const strength = Math.min(1, (Math.max(...flux.slice(Math.max(0, hit - 2), hit + 3)) || 0) / fluxScale);
      pulse = strength * Math.exp(-since / 0.22);
    }
    out.push({ env, pulse });
  }
  return out;
}

module.exports = { analyse, pauses, novelty, beatGrid, movementEdges, describeMovement, envelope, BANDS };
