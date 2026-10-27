/**
 * A movement's loop: a still from Gemini's image model, animated by Gemini
 * Omni Flash into eight seconds that end on the frame they began with, so
 * the clip repeats without a seam. (Veo 3.1's preview models, which the
 * Gemini API offered for this, were shut down on 2026-10-22; Omni is their
 * successor there, through the Interactions API.)
 *
 * Omni is given the still as both its first and its last frame. Whether the
 * clip came back to it is measured, not assumed: where its last frame differs
 * from its first (SSIM below 0.9), it is played forward then backward instead,
 * which loops regardless. Each file is kept, and a rerun spends nothing on
 * what already exists: a clip is made again only when its motion changes.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { GoogleGenAI } = require('@google/genai');
const { stillDefects, evenLoop } = require('./checks');

const IMAGE_MODEL = 'gemini-3.1-flash-image';
const VIDEO_MODEL = 'gemini-omni-1.1-flash';
// 720p bills about $0.10 a second of video, 1080p (upscaled by Google) about $0.15.
const RESOLUTION = process.env.VIDEO_RESOLUTION || '1080p';
const SEAMLESS_SSIM = 0.9;

const STILL_COST = 0.101; // Gemini 3.1 Flash Image at 2K, per image

let client;
const ai = () => (client ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

// What the run has spent, printed call by call and totalled by the runner.
const spent = { stills: 0, loops: 0, dollars: 0 };
function charge(kind, dollars, label, log) {
  spent[kind]++;
  spent.dollars += dollars;
  log(`  $${dollars.toFixed(2)} ${label}`);
}

/**
 * The daily limit is not a passing failure: Tier 1 allows Omni 20 requests a
 * day. Once it is met, the run asks no more, rather than spending a request
 * per piece to learn it again.
 */
class DailyLimit extends Error {}
const exhausted = {};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Retry a passing failure (a 5xx, a per-minute limit, a dropped connection)
// up to three times with backoff; never a refusal (another 4xx), which
// would fail the same way and might be billed again.
async function withRetry(label, call, { log = console.log, waits = [30000, 60000, 90000] } = {}) {
  if (exhausted[label]) throw exhausted[label];
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const status = err.status ?? err.code;
      if (status === 429 && /per day/i.test(err.message)) {
        exhausted[label] = new DailyLimit(`the ${label} model's daily limit is met: ${err.message.slice(0, 200)}`);
        throw exhausted[label];
      }
      const passing = status === 429 || (typeof status === 'number' && status >= 500) || /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(err.message);
      if (!passing || attempt >= waits.length) throw err;
      log(`  ${label}: ${err.message.slice(0, 120)}; trying again in ${waits[attempt] / 1000}s`);
      await sleep(waits[attempt]);
    }
  }
}

async function generateStill(prompt, file, log) {
  const response = await withRetry('still', () => ai().models.generateContent({
    model: IMAGE_MODEL,
    contents: `${prompt}\n\nNo text, letters, numbers, faces or figures anywhere in the image.`,
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } }
  }), { log });
  const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part) throw new Error(`no image returned for ${path.basename(file)}`);
  fs.writeFileSync(file, Buffer.from(part.inlineData.data, 'base64'));
  charge('stills', STILL_COST, path.basename(file), log);
  return stillDefects(file);
}

/**
 * A movement's still, checked before Omni sees it (checks.js stillDefects).
 * One with a defect is made once more and the one with fewer kept: a fresh
 * sample, never a repair, which mvplanner found makes frames worse.
 */
async function makeStill(prompt, file, { log = console.log } = {}) {
  if (fs.existsSync(file)) return file;
  const first = await generateStill(prompt, file, log);
  if (!first.defects.length) return file;
  const again = file.replace(/\.png$/, '.again.png');
  log(`  ${path.basename(file)}: ${first.defects.join(', ')}; making it once more`);
  const second = await generateStill(prompt, again, log);
  if (second.defects.length < first.defects.length) fs.renameSync(again, file);
  else fs.rmSync(again);
  const kept = second.defects.length < first.defects.length ? second : first;
  if (kept.defects.length) log(`  ${path.basename(file)}: kept with ${kept.defects.join(', ')}`);
  return file;
}

function findVideo(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'video' && node.data) return node;
  for (const value of Object.values(node)) {
    const found = findVideo(value);
    if (found) return found;
  }
  return null;
}

// How alike the clip's first and last frames are, 0 to 1.
function endsWhereItBegan(file) {
  const count = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const last = Number(count.stdout.trim()) - 1;
  const out = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-i', file,
    '-filter_complex', `[0:v]select=eq(n\\,0),setpts=PTS-STARTPTS[a];[1:v]select=eq(n\\,${last}),setpts=PTS-STARTPTS[b];[a][b]ssim`, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
  const match = /All:([0-9.]+)/.exec(out.stderr);
  return match ? Number(match[1]) : 0;
}

async function generateLoop(stillFile, motion, file, log) {
  const image = { type: 'image', data: fs.readFileSync(stillFile).toString('base64'), mime_type: mimeOf(stillFile) };
  const prompt = `An 8-second seamless loop. The first and the last frame are both the given image. ${motion} Slow, continuous, hypnotic motion. Abstract, no text, no people. No dialogue, no music, no sound effects.`;
  const body = await withRetry('loop', async () => {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        model: VIDEO_MODEL,
        input: [image, image, { type: 'text', text: prompt }],
        response_format: { type: 'video', aspect_ratio: '16:9', resolution: RESOLUTION },
        store: false
      })
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(`video generation failed (${res.status}): ${JSON.stringify(json?.error || json).slice(0, 500)}`), { status: res.status });
    return json;
  }, { log });
  const video = findVideo(body);
  if (!video) throw new Error(`no video returned: ${JSON.stringify(body).slice(0, 500)}`);
  fs.writeFileSync(file, Buffer.from(video.data, 'base64'));
  const tokens = body.usage?.total_output_tokens || 0;
  const cost = tokens * 17.5e-6;
  charge('loops', cost, path.basename(file), log);
  const ssim = endsWhereItBegan(file);
  const even = evenLoop(file, file.replace(/\.mp4$/, '.even.mp4'));
  return { file, even: even.file, ssim, seamless: ssim >= SEAMLESS_SSIM, motion: { before: even.before.floor, after: even.after.floor, stalls: even.after.stalls, kept: `${even.kept}/${even.of}` }, tokens, cost: +cost.toFixed(2) };
}

// Better: one that moves, then one that closes, then the closer seam.
const better = (a, b) => (a.motion.stalls !== b.motion.stalls ? (a.motion.stalls ? b : a) : a.seamless !== b.seamless ? (a.seamless ? a : b) : a.ssim >= b.ssim ? a : b);

/**
 * A movement's loop: generated, its seam measured (SSIM of its first and last
 * frames), and its motion evened (checks.js evenLoop), which closes the eased
 * hitch at the seam for free. One that still freezes after that is made once
 * more and the better kept.
 *
 * Returns { file, even, motionText, seamless, ssim, motion, cost }. Kept on
 * disk beside the clip; made again only when its motion text changes. A clip
 * from before the evening is evened when next used, at no cost.
 */
async function makeClip(stillFile, motionText, file, { log = console.log } = {}) {
  const meta = `${file}.json`;
  if (fs.existsSync(file) && fs.existsSync(meta)) {
    const kept = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if ((kept.motionText ?? kept.motion) === motionText) {
      if (kept.even && fs.existsSync(kept.even)) return kept;
      const even = evenLoop(file, file.replace(/\.mp4$/, '.even.mp4'));
      const updated = { ...kept, motionText, even: even.file, motion: { before: even.before.floor, after: even.after.floor, stalls: even.after.stalls, kept: `${even.kept}/${even.of}` } };
      fs.writeFileSync(meta, JSON.stringify(updated, null, 2));
      return updated;
    }
  }
  let clip = await generateLoop(stillFile, motionText, file, log);
  let cost = clip.cost;
  if (clip.motion.stalls) {
    log(`  ${path.basename(file)}: still freezes after evening (floor ${clip.motion.after}); making it once more`);
    const again = await generateLoop(stillFile, motionText, file.replace(/\.mp4$/, '.again.mp4'), log);
    cost += again.cost;
    if (better(clip, again) === again) {
      fs.renameSync(again.file, file);
      fs.renameSync(again.even, clip.even);
      clip = { ...again, file, even: clip.even };
    } else {
      fs.rmSync(again.file);
      fs.rmSync(again.even);
    }
  }
  const result = { ...clip, motionText, model: VIDEO_MODEL, resolution: RESOLUTION, cost: +cost.toFixed(2) };
  fs.writeFileSync(meta, JSON.stringify(result, null, 2));
  return result;
}

function mimeOf(file) {
  const head = fs.readFileSync(file).subarray(0, 4);
  return head[0] === 0x89 ? 'image/png' : head[0] === 0xff ? 'image/jpeg' : 'image/webp';
}

module.exports = { makeStill, makeClip, endsWhereItBegan, withRetry, spent, DailyLimit, VIDEO_MODEL, IMAGE_MODEL };
