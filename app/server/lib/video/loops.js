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
 *
 * Both calls go through the app's retry helper (utils/retry.js): a passing
 * failure is asked again with backoff, a refusal never. Omni's daily limit
 * (Tier 1 allows 20 requests) is marked fatal, a quota spent rather than a
 * rate exceeded, and the run asks Omni no more once it is met, rather than
 * spending a request per piece to learn it again. An account out of credit
 * (retry.js isUnfunded) stops every Gemini call, stills and loops: it is the
 * same account production's Ask and Search draw on.
 */

const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { withRetry, isUnfunded } = require('../utils/retry');
const { describeError } = require('../utils/describe-error');
const { run, ffmpeg } = require('../audio/assemble');
const { stillDefects, evenLoop } = require('./checks');
const { inLibrary } = require('./library');

const IMAGE_MODEL = 'gemini-3.1-flash-image';
const STILL_COST = 0.101; // per image at 2K
const VIDEO_MODEL = 'gemini-omni-1.1-flash';
// 1080p, Google's upscale: about $0.15 a second, $1.22 a loop. Omni bills
// video as output tokens, $17.50 a million.
const RESOLUTION = '1080p';
const VIDEO_TOKEN_COST = 17.5e-6;
const SEAMLESS_SSIM = 0.9;

let client;
const ai = () => (client ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

// What the run has spent, printed call by call and totalled by the runner.
const spent = { stills: 0, loops: 0, dollars: 0 };
function charge(kind, dollars, label, log) {
  spent[kind]++;
  spent.dollars += dollars;
  log(`  $${dollars.toFixed(2)} ${label}`);
}

let dailyLimit = null;
let unfunded = null;

async function ask(label, call, log) {
  if (unfunded) throw unfunded;
  if (label === 'loop' && dailyLimit) throw dailyLimit;
  try {
    return await withRetry(call, {
      attempts: 4,
      baseMs: 15000,
      maxMs: 90000,
      onRetry: (err, n, ms) => log(`  ${label}: ${describeError(err).slice(0, 160)}; asking again in ${Math.round(ms / 1000)}s (${n} of 3)`)
    });
  } catch (err) {
    if (isUnfunded(err)) unfunded = err;
    else if (label === 'loop' && err.fatal) dailyLimit = err;
    throw err;
  }
}

// A refused request as an error the retry helper can read: its status, and
// fatal when it is the daily limit, which no wait within the run will lift.
function requestError(status, body) {
  const message = `${VIDEO_MODEL} refused the request (${status}): ${JSON.stringify(body?.error || body).slice(0, 400)}`;
  return Object.assign(new Error(message), { status, fatal: status === 429 && /per day/i.test(message) });
}

async function generateStill(prompt, file, log) {
  const response = await ask('still', () => ai().models.generateContent({
    model: IMAGE_MODEL,
    contents: `${prompt}\n\nNo text, letters, numbers, faces or figures anywhere in the image.`,
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } }
  }), log);
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
  const keepSecond = second.defects.length < first.defects.length;
  if (keepSecond) fs.renameSync(again, file);
  else fs.rmSync(again);
  const kept = keepSecond ? second : first;
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
async function endsWhereItBegan(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]);
  const last = Number(stdout.trim()) - 1;
  const { stderr } = await ffmpeg(['-i', file, '-i', file,
    '-filter_complex', `[0:v]select=eq(n\\,0),setpts=PTS-STARTPTS[a];[1:v]select=eq(n\\,${last}),setpts=PTS-STARTPTS[b];[a][b]ssim`, '-frames:v', '1', '-f', 'null', '-']);
  const match = /All:([0-9.]+)/.exec(stderr);
  return match ? Number(match[1]) : 0;
}

function mimeOf(file) {
  const head = fs.readFileSync(file).subarray(0, 4);
  return head[0] === 0x89 ? 'image/png' : head[0] === 0xff ? 'image/jpeg' : 'image/webp';
}

async function generateLoop(stillFile, motionText, file, log) {
  const image = { type: 'image', data: fs.readFileSync(stillFile).toString('base64'), mime_type: mimeOf(stillFile) };
  const prompt = `An 8-second seamless loop. The first and the last frame are both the given image. ${motionText} Slow, continuous, hypnotic motion. Abstract, no text, no people. No dialogue, no music, no sound effects.`;
  const body = await ask('loop', async () => {
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
    if (!res.ok) throw requestError(res.status, json);
    return json;
  }, log);
  const video = findVideo(body);
  if (!video) throw new Error(`no video returned: ${JSON.stringify(body).slice(0, 500)}`);
  fs.writeFileSync(file, Buffer.from(video.data, 'base64'));
  const cost = (body.usage?.total_output_tokens || 0) * VIDEO_TOKEN_COST;
  charge('loops', cost, path.basename(file), log);
  const ssim = await endsWhereItBegan(file);
  const even = await evenLoop(file, file.replace(/\.mp4$/, '.even.mp4'));
  return {
    file,
    even: even.file,
    ssim,
    seamless: ssim >= SEAMLESS_SSIM,
    motion: { mean: even.before.mean, before: even.before.floor, after: even.after.floor, stalls: even.after.stalls, kept: `${even.kept}/${even.of}` },
    cost
  };
}

// Better: one that moves, then one that closes, then the closer seam.
const better = (a, b) => (a.motion.stalls !== b.motion.stalls ? (a.motion.stalls ? b : a) : a.seamless !== b.seamless ? (a.seamless ? a : b) : a.ssim >= b.ssim ? a : b);

/**
 * A movement's loop: generated, its seam measured, and its motion evened
 * (checks.js evenLoop), which closes the eased hitch at the seam for free.
 * One that still freezes after that is made once more and the better kept.
 *
 * Returns { file, even, motionText, seamless, ssim, motion, cost }, kept on
 * disk beside the clip and made again only when its motion text changes.
 * Its paths are relative to the library (library.js), so another video can
 * reuse it from any checkout; its embedding is added by the library.
 */
async function makeClip(stillFile, motionText, file, { log = console.log } = {}) {
  const meta = `${file}.json`;
  if (fs.existsSync(file) && fs.existsSync(meta)) {
    const kept = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (kept.motionText === motionText) return kept;
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
  const result = { ...clip, file: inLibrary(clip.file), even: inLibrary(clip.even), motionText, model: VIDEO_MODEL, resolution: RESOLUTION, cost: +cost.toFixed(2) };
  fs.writeFileSync(meta, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { makeStill, makeClip, spent, VIDEO_MODEL };
