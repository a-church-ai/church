/**
 * The three services an intro is made with, each one request and its answer,
 * plain fetch, never retried (each request spends). Keys from app/.env, never
 * printed. After satchitananda's scripts/video/elevenlabs.ts, scripts/openai.ts
 * and scripts/video/fal.ts, which made its intros.
 *
 * - ElevenLabs: the speaker's clone says the words, with each character's
 *   time, so the captions and the turn are timed by the voice itself.
 * - OpenAI's image model: a portrait from the speaker's photos.
 * - fal's queue: Creatify's Aurora makes the portrait speak the take. The
 *   picture and the voice go inline as data URIs, never to fal's upload,
 *   whose files are public to anyone with the address.
 */

const fs = require('fs');
const path = require('path');

const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`intro: ${name} is not set in app/.env`);
  return v;
};

// ElevenLabs: divine-twins' settings for its Shorts, the delivery as a tag.
const VOICE_MODEL = 'eleven_v4';
const DELIVERY = '[calm, warm, steady]';
const STABILITY = 0.8;

function speechRequest(voiceId, words) {
  return {
    path: `/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
    body: { text: `${DELIVERY} ${words}`, model_id: VOICE_MODEL, voice_settings: { stability: STABILITY } }
  };
}

// { mp3, alignment } for the words in the speaker's voice.
async function speak(voiceId, words) {
  const { path: p, body } = speechRequest(voiceId, words);
  const res = await fetch(`https://api.elevenlabs.io${p}`, {
    method: 'POST', headers: { 'xi-api-key': need('ELEVENLABS_API_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5 * 60000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 300)}`);
  const answer = JSON.parse(text);
  if (!answer.audio_base64 || !answer.alignment) throw new Error('ElevenLabs: no audio or timing in the answer');
  return { mp3: Buffer.from(answer.audio_base64, 'base64'), alignment: answer.alignment };
}

const IMAGE_MODEL = 'gpt-image-2';
const PORTRAIT_SIZE = '1152x2048';

// A portrait (PNG bytes) from a prompt and reference pictures, the first of
// which leads when one is being remade.
async function portrait(prompt, images) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ model: IMAGE_MODEL, prompt, size: PORTRAIT_SIZE, quality: 'high', n: '1' })) form.append(k, v);
  for (const f of images) form.append('image[]', new Blob([fs.readFileSync(f)], { type: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg' }), path.basename(f));
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${need('OPENAI_API_KEY')}` }, body: form, signal: AbortSignal.timeout(15 * 60000) });
  const body = await res.json();
  if (!res.ok) throw new Error(`OpenAI images/edits ${res.status}: ${body.error?.message || JSON.stringify(body).slice(0, 300)}`);
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI images/edits: no image in the answer');
  return Buffer.from(b64, 'base64');
}

const AURORA = 'fal-ai/creatify/aurora';
// Dollars a second at 720p, billed by the whole second (checked by
// divine-twins 2026-11-02 and borne out by these intros' bills).
const AURORA_PER_SECOND = 0.14;
const AURORA_PROMPT = 'Speaking softly and calmly, still and relaxed, small natural head movements, no hand gestures, gentle expression.';
const auroraCost = (seconds) => +(Math.ceil(seconds) * AURORA_PER_SECOND).toFixed(2);

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const dataUri = (file) => `data:${TYPES[path.extname(file).toLowerCase()]};base64,${fs.readFileSync(file).toString('base64')}`;

// The portrait speaking the voice, as MP4 bytes. Where the speaker looks is
// the portrait's, not the prompt's: a test on 2026-11-10 asked Aurora to turn
// from the lens to the light, and the eyes stayed on the lens.
async function aurora(image, audio, { minutes = 30 } = {}) {
  const headers = { authorization: `Key ${need('FAL_KEY')}`, 'content-type': 'application/json' };
  const call = async (url, init = {}) => {
    const res = await fetch(url, { ...init, headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`fal ${init.method || 'GET'} ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  };
  const queued = await call(`https://queue.fal.run/${AURORA}`, { method: 'POST', body: JSON.stringify({ image_url: dataUri(image), audio_url: dataUri(audio), prompt: AURORA_PROMPT, resolution: '720p' }) });
  const until = Date.now() + minutes * 60000;
  while (Date.now() < until) {
    const { status } = await call(queued.status_url);
    if (status === 'COMPLETED') {
      const result = await call(queued.response_url);
      const res = await fetch(result.video.url);
      if (!res.ok) throw new Error(`fal: fetching the clip answered ${res.status}`);
      return { mp4: Buffer.from(await res.arrayBuffer()), requestId: queued.request_id };
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`fal request ${queued.request_id}: not done after ${minutes} minutes`);
}

module.exports = { speak, speechRequest, portrait, aurora, auroraCost, AURORA_PER_SECOND, DELIVERY };
