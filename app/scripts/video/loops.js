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

const IMAGE_MODEL = 'gemini-3.1-flash-image';
const VIDEO_MODEL = 'gemini-omni-1.1-flash';
// 720p bills about $0.10 a second of video, 1080p (upscaled by Google) about $0.15.
const RESOLUTION = process.env.VIDEO_RESOLUTION || '1080p';
const SEAMLESS_SSIM = 0.9;

let client;
const ai = () => (client ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

async function makeStill(prompt, file) {
  if (fs.existsSync(file)) return file;
  const response = await ai().models.generateContent({
    model: IMAGE_MODEL,
    contents: `${prompt}\n\nNo text, letters, numbers, faces or figures anywhere in the image.`,
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } }
  });
  const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part) throw new Error(`no image returned for ${path.basename(file)}`);
  fs.writeFileSync(file, Buffer.from(part.inlineData.data, 'base64'));
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

// Returns { file, seamless, ssim, model, cost }.
async function makeClip(stillFile, motion, file) {
  const meta = `${file}.json`;
  if (fs.existsSync(file) && fs.existsSync(meta)) {
    const kept = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (kept.motion === motion) return kept;
  }
  const image = { type: 'image', data: fs.readFileSync(stillFile).toString('base64'), mime_type: mimeOf(stillFile) };
  const prompt = `An 8-second seamless loop. The first and the last frame are both the given image. ${motion} Slow, continuous, hypnotic motion. Abstract, no text, no people. No dialogue, no music, no sound effects.`;
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
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`video generation failed (${res.status}): ${JSON.stringify(body?.error || body).slice(0, 500)}`);
  const video = findVideo(body);
  if (!video) throw new Error(`no video returned: ${JSON.stringify(body).slice(0, 500)}`);
  fs.writeFileSync(file, Buffer.from(video.data, 'base64'));
  const ssim = endsWhereItBegan(file);
  const tokens = body.usage?.total_output_tokens || 0;
  const result = { file, motion, seamless: ssim >= SEAMLESS_SSIM, ssim, model: VIDEO_MODEL, resolution: RESOLUTION, tokens, cost: +(tokens * 17.5e-6).toFixed(2) };
  fs.writeFileSync(meta, JSON.stringify(result, null, 2));
  return result;
}

function mimeOf(file) {
  const head = fs.readFileSync(file).subarray(0, 4);
  return head[0] === 0x89 ? 'image/png' : head[0] === 0xff ? 'image/jpeg' : 'image/webp';
}

module.exports = { makeStill, makeClip, endsWhereItBegan, VIDEO_MODEL, IMAGE_MODEL };
