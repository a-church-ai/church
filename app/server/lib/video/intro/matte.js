/**
 * A speaker cut out of their avatar clip, frame by frame, by Robust Video
 * Matting (github.com/PeterL1n/RobustVideoMatting, its MobileNetV3 model
 * published as ONNX), run here in onnxruntime-node: no Python, no service.
 * The portrait is made on a plain mid-grey backdrop, which this model cuts
 * most cleanly (divine-twins' finding, its shorts/avatar.py).
 *
 * The model is fetched once into ~/.cache/rvm and checked against the hash
 * it was first fetched with, so a changed file is refused, never run.
 *
 * Writes two videos the compositor reads: the foreground the model gives
 * (its colours freed from the backdrop at the edges) and the matte, grey.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MODEL_URL = 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx';
const MODEL = path.join(os.homedir(), '.cache/rvm/rvm_mobilenetv3_fp32.onnx');
// sha256 of the file first fetched, 2026-11-10.
const MODEL_SHA256 = '88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828';
// The model's working scale for a frame this size: its authors' advice for HD and taller.
const DOWNSAMPLE = 0.25;

async function model() {
  if (!fs.existsSync(MODEL)) {
    fs.mkdirSync(path.dirname(MODEL), { recursive: true });
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`matte: fetching the model answered ${res.status}`);
    fs.writeFileSync(MODEL, Buffer.from(await res.arrayBuffer()));
  }
  const sha = require('crypto').createHash('sha256').update(fs.readFileSync(MODEL)).digest('hex');
  if (sha !== MODEL_SHA256) throw new Error(`matte: ${MODEL} is sha256 ${sha.slice(0, 16)}, not the ${MODEL_SHA256.slice(0, 16)} first fetched; refused`);
  return MODEL;
}

// An ffmpeg process reading or writing raw frames, with `done`, settled when
// it exits: listened for from the start, so an exit before anyone waits is
// not missed (a source closes as soon as its last frame is read).
function ffmpegPipe(args) {
  const p = spawn('ffmpeg', ['-v', 'error', ...args], { stdio: ['pipe', 'pipe', 'inherit'] });
  p.done = new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code ? reject(new Error(`matte: ffmpeg exited ${code}`)) : resolve()));
  });
  return p;
}

// Exactly n bytes from a readable stream, or null at its end.
function reader(stream) {
  let chunks = [], have = 0, ended = false, wake = null;
  stream.on('data', (c) => { chunks.push(c); have += c.length; if (wake) wake(); });
  stream.on('end', () => { ended = true; if (wake) wake(); });
  return async (n) => {
    while (have < n && !ended) await new Promise(r => { wake = r; });
    wake = null;
    if (have < n) return null;
    const all = Buffer.concat(chunks);
    chunks = [all.subarray(n)];
    have -= n;
    return all.subarray(0, n);
  };
}

/**
 * The speaker in `clip`, at width x height and fps: writes `fg` (their
 * colours) and `alpha` (the matte), each as long as the clip.
 */
async function matte(clip, { width, height, fps, fg, alpha, log = () => {} }) {
  const ort = require('onnxruntime-node');
  const session = await ort.InferenceSession.create(await model());
  const src = ffmpegPipe(['-i', clip, '-vf', `fps=${fps},scale=${width}:${height}:flags=bicubic`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const outFg = ffmpegPipe(['-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv444p', fg]);
  const outAlpha = ffmpegPipe(['-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-', '-c:v', 'ffv1', '-pix_fmt', 'gray', alpha]);
  const read = reader(src.stdout);
  const n = width * height;
  const zero = () => new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1]);
  let rec = [zero(), zero(), zero(), zero()];
  const ratio = new ort.Tensor('float32', new Float32Array([DOWNSAMPLE]), [1]);
  const input = new Float32Array(3 * n);
  const fgBytes = Buffer.alloc(3 * n), alphaBytes = Buffer.alloc(n);
  const write = (stream, buf) => new Promise(r => (stream.write(buf) ? r() : stream.once('drain', r)));
  let frames = 0;
  const started = Date.now();
  for (let raw; (raw = await read(3 * n)); frames++) {
    // Interleaved bytes to planar 0..1, as the model takes them.
    for (let i = 0; i < n; i++) {
      input[i] = raw[3 * i] / 255;
      input[n + i] = raw[3 * i + 1] / 255;
      input[2 * n + i] = raw[3 * i + 2] / 255;
    }
    const out = await session.run({ src: new ort.Tensor('float32', input, [1, 3, height, width]), r1i: rec[0], r2i: rec[1], r3i: rec[2], r4i: rec[3], downsample_ratio: ratio });
    rec = [out.r1o, out.r2o, out.r3o, out.r4o];
    const f = out.fgr.data, a = out.pha.data;
    for (let i = 0; i < n; i++) {
      fgBytes[3 * i] = Math.min(255, Math.max(0, f[i] * 255 + 0.5));
      fgBytes[3 * i + 1] = Math.min(255, Math.max(0, f[n + i] * 255 + 0.5));
      fgBytes[3 * i + 2] = Math.min(255, Math.max(0, f[2 * n + i] * 255 + 0.5));
      alphaBytes[i] = Math.min(255, Math.max(0, a[i] * 255 + 0.5));
    }
    await write(outFg.stdin, fgBytes);
    await write(outAlpha.stdin, alphaBytes);
    if (frames % (fps * 4) === 0) log(`  matte: frame ${frames} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
  outFg.stdin.end();
  outAlpha.stdin.end();
  await Promise.all([outFg.done, outAlpha.done, src.done]);
  if (!frames) throw new Error(`matte: no frame could be read from ${clip}`);
  log(`  matte: ${frames} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  return { frames };
}

module.exports = { matte, MODEL_SHA256 };
