/**
 * What is checked before money is spent and before a viewer sees it. Plain
 * arithmetic on pixels, no model calls. The measures and thresholds are
 * mvplanner's (testing/music-videos: imgqa.py, video_io.py, report.py) and
 * news-community's (marketing: blank-check.ts), where each was learned.
 *
 * stillDefects: a generated still's speckle, colour collapse or darkness.
 * loopMotion, evenLoop: whether an animated loop freezes, and the loop with
 *   its quiet frames played faster (image-to-video models hold on to the
 *   frame they are given, and ours start and end on it).
 * reportVideo: a finished video's length, sound, exposure and blackness.
 */

const { spawnSync } = require('child_process');

function frames(file, { width, height, gray = false, args = [] }) {
  const out = spawnSync('ffmpeg', ['-v', 'error', ...args, '-i', file, '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', gray ? 'gray' : 'rgb24', '-'], { maxBuffer: 1 << 30 });
  if (out.status !== 0) throw new Error(`ffmpeg could not read ${file}: ${String(out.stderr).slice(-300)}`);
  return out.stdout;
}

/**
 * The still's defects, an empty list when it is clean.
 * - speckle: noise (mean difference from a 3x3 median) above 0.010 that does
 *   not correlate between neighbouring pixels (below 0.05); fine detail such
 *   as rain or foliage is noisy too, but its residual correlates
 * - colourless: mean saturation under 0.05
 * - dark: over 90% of the frame near black
 */
function stillDefects(file) {
  const W = 512, H = 288;
  return stillDefectsOf(frames(file, { width: W, height: H }), W, H);
}

// The same, on raw RGB pixels.
function stillDefectsOf(rgb, W, H) {
  const luma = new Float32Array(W * H);
  let saturation = 0, dark = 0;
  for (let p = 0; p < W * H; p++) {
    const r = rgb[3 * p] / 255, g = rgb[3 * p + 1] / 255, b = rgb[3 * p + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    luma[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    saturation += max ? (max - min) / max : 0;
    if (luma[p] < 0.08) dark++;
  }
  const residual = new Float32Array(W * H);
  const window = new Float32Array(9);
  let noise = 0, n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) window[k++] = luma[(y + dy) * W + x + dx];
      window.sort();
      const r = luma[y * W + x] - window[4];
      residual[y * W + x] = r;
      noise += Math.abs(r);
      n++;
    }
  }
  noise /= n;
  // Lag-one correlation of the residual with its right-hand neighbour.
  let sxy = 0, sxx = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 2; x++) {
      const a = residual[y * W + x], b = residual[y * W + x + 1];
      sxy += a * b;
      sxx += a * a;
    }
  }
  const correlation = sxx ? sxy / sxx : 1;
  const measures = { noise: +noise.toFixed(4), correlation: +correlation.toFixed(3), saturation: +(saturation / (W * H)).toFixed(3), dark: +(dark / (W * H)).toFixed(3) };
  const defects = [];
  if (measures.noise > 0.010 && measures.correlation < 0.05) defects.push('speckle');
  if (measures.saturation < 0.05) defects.push('colourless');
  if (measures.dark > 0.9) defects.push('dark');
  return { defects, measures };
}

// The change between each pair of consecutive frames, 0 to 1.
function frameChanges(file) {
  const W = 160, H = 90;
  const raw = frames(file, { width: W, height: H, gray: true });
  const count = Math.floor(raw.length / (W * H));
  const change = [];
  for (let f = 1; f < count; f++) {
    let s = 0;
    for (let p = 0; p < W * H; p++) s += Math.abs(raw[f * W * H + p] - raw[(f - 1) * W * H + p]);
    change.push(s / (W * H * 255));
  }
  return change;
}

/**
 * How a loop moves: the mean change between consecutive frames, and the
 * quietest half second's against it. Below a tenth, it has frozen.
 *
 * mvplanner re-rolls a shot whose quietest half second is under a quarter;
 * that suits shots that should keep moving. Our loops breathe and settle by
 * design, and at a quarter six of nine approved loops failed; the freezes
 * that show sit at the seam, where the model eases out of and into the still
 * it was given (mvplanner measured that ease in 78% of its clips).
 */
function loopMotion(file, change = frameChanges(file)) {
  return motionOf(change, probeFps(file));
}

function motionOf(change, fps) {
  const mean = change.reduce((s, v) => s + v, 0) / Math.max(1, change.length);
  const span = Math.max(1, Math.round(fps / 2));
  let quietest = Infinity;
  for (let i = 0; i + span <= change.length; i++) {
    quietest = Math.min(quietest, change.slice(i, i + span).reduce((s, v) => s + v, 0) / span);
  }
  if (!Number.isFinite(quietest)) quietest = mean;
  const floor = mean ? quietest / mean : 0;
  return { mean: +mean.toFixed(5), floor: +floor.toFixed(3), stalls: floor < 0.1 };
}

// Which frames evenLoop keeps, from the changes between them.
function framesToKeep(change) {
  const sorted = [...change].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1e-9;
  const keep = [0];
  let owed = 0;
  change.forEach((c, i) => {
    owed += Math.min(1, Math.max(1 / 3, c / median));
    if (owed >= 1 || i === change.length - 1) {
      keep.push(i + 1);
      owed -= Math.floor(owed) || 1;
    }
  });
  return keep;
}

/**
 * The loop with its motion evened out, free: frames that barely change are
 * dropped, at most two in three, so the eased ends and any lull play faster
 * and the hitch at the seam closes up. A frame is kept outright when it moves
 * at least as much as the loop's median, and otherwise at the rate it moves
 * against that median; the first and last are always kept, so the seam still
 * meets. Frames are only ever dropped, never repeated, so ffmpeg's select
 * does it. Returns the new file and its motion before and after.
 */
function evenLoop(file, out) {
  const change = frameChanges(file);
  const before = loopMotion(file, change);
  const keep = framesToKeep(change);
  const fps = probeFps(file);
  // Runs of consecutive kept frames, so the expression stays short.
  const runs = [];
  for (const k of keep) {
    const last = runs[runs.length - 1];
    if (last && k === last[1] + 1) last[1] = k;
    else runs.push([k, k]);
  }
  const expr = runs.map(([a, b]) => (a === b ? `eq(n,${a})` : `between(n,${a},${b})`)).join('+');
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `select='${expr}',setpts=N/(${fps.toFixed(3)}*TB)`, '-an', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg could not even ${file}: ${result.stderr.slice(-300)}`);
  return { file: out, kept: keep.length, of: change.length + 1, before, after: loopMotion(out) };
}

function probeFps(file) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim();
  const [a, b] = out.split('/').map(Number);
  return b ? a / b : a || 24;
}

function probe(file) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type', '-of', 'json', file], { encoding: 'utf8' });
  return JSON.parse(out.stdout || '{}');
}

// Mean luma (Y, in limited range as the video stores it) at a moment.
function lumaAt(file, t) {
  const out = spawnSync('ffmpeg', ['-v', 'info', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /YAVG=([0-9.]+)/.exec(out.stderr);
  return m ? Number(m[1]) : null;
}

/**
 * The finished video's report: problems is empty when it may be published.
 * - its length within half a second of the recording's
 * - an audio track
 * - not black: five frames' mean luma, measured in the video's own limited
 *   range (news-community's first check read PNGs, which halve it, and let a
 *   black video through), all under 42 fails
 * - each movement's brightness within half and twice the median's
 */
function reportVideo({ file, seconds, edges }) {
  const info = probe(file);
  const duration = Number(info.format?.duration);
  const samples = [0.1, 0.3, 0.5, 0.7, 0.9].map(f => lumaAt(file, f * seconds)).filter(v => v !== null);
  const movements = edges.slice(0, -1).map((from, i) => lumaAt(file, (from + edges[i + 1]) / 2)).filter(v => v !== null);
  const problems = problemsOf({ duration, seconds, audio: !!info.streams?.some(s => s.codec_type === 'audio'), samples, movements });
  return {
    file,
    seconds: +duration.toFixed(2),
    megabytes: +(Number(info.format?.size) / 1024 / 1024).toFixed(1),
    luma: samples.map(v => +v.toFixed(1)),
    movements: movements.map(v => +v.toFixed(1)),
    problems
  };
}

// The report's verdict on what was measured.
function problemsOf({ duration, seconds, audio, samples, movements }) {
  const problems = [];
  if (!(Math.abs(duration - seconds) <= 0.5)) problems.push(`length ${Number.isFinite(duration) ? duration.toFixed(2) : '?'}s where the recording is ${seconds.toFixed(2)}s`);
  if (!audio) problems.push('no audio track');
  if (samples.length && samples.every(v => v < 42)) problems.push(`black: mean luma ${samples.map(v => v.toFixed(0)).join(', ')}`);
  const median = [...movements].sort((a, b) => a - b)[Math.floor(movements.length / 2)];
  movements.forEach((v, i) => {
    if (median && (v > 2 * median || v < median / 2)) problems.push(`movement ${i + 1} exposure ${v.toFixed(0)} against a median of ${median.toFixed(0)}`);
  });
  return problems;
}

module.exports = { lumaAt, stillDefects, stillDefectsOf, loopMotion, motionOf, evenLoop, framesToKeep, reportVideo, problemsOf };
