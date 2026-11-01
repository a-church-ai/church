/**
 * A transcript of one rendered line, to check that the take says what the
 * line says (words.takePasses). OpenAI's gpt-4o-mini-transcribe, through
 * OPENAI_API_KEY: accurate on clean synthetic speech, and a fraction of a cent
 * a minute, which makes checking every line affordable.
 *
 * Transcription mishears too, so a take it fails gets a second opinion from
 * whisper-1 before a retake is spent. On 2026-10-05 the first model heard
 * Luca's "Wants:" as "Once" in four takes of six; whisper-1 heard "Wants" in
 * all six. A retake costs speech characters from a shared quota, and a
 * second opinion costs a fraction of a cent.
 *
 * A rare phrase can pull both toward a common one. On 2026-10-06 both heard
 * the title "Chant of the Named Guess." as "Named Guests" (once "Guest") in
 * three takes of three, while the same voice's "Write your guess." was heard
 * right. Cut free of its title, the last word was heard as "Guess", and the
 * take ends in one unbroken /s/ with no stop for a t: the takes were right.
 * A miss that repeats on one rare phrase is worth hearing alone before a
 * retake is spent.
 *
 * A recording made elsewhere (scripts/import-recording.js) is heard whole by
 * whisper-1 with each word's time, which both checks its words and says when
 * each passage is spoken, for the player's cues; a song is heard the same way
 * for its Short's passage (video/short.js). OpenAI takes files up to 25 MB, so
 * it is sent as a small mono copy (hearWhole).
 */

const MODEL = 'gpt-4o-mini-transcribe';
const SECOND_OPINION = 'whisper-1';
const TRIES = 5;

const fs = require('fs');
const { withRetry } = require('../utils/retry');
const { ffmpeg } = require('./assemble');

// One request, tried again while OpenAI is busy or failing.
async function request(fields, mp3) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured. Add it to app/.env');
  return withRetry(async () => {
    const form = new FormData();
    for (const [name, value] of fields) form.append(name, value);
    form.append('file', new Blob([mp3], { type: 'audio/mpeg' }), 'line.mp3');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    if (res.ok) return res.json();
    const detail = (await res.text()).slice(0, 300);
    const err = new Error(`Transcription: HTTP ${res.status} ${detail}`);
    err.status = res.status;
    err.retryAfter = res.headers.get('retry-after');
    // A spent quota or a bad key is not a busy moment: never asked again.
    err.fatal = res.status === 401 || /quota|billing/i.test(detail);
    throw err;
  }, { attempts: TRIES, baseMs: 1500, maxMs: 30000 });
}

async function transcribe(mp3, model = MODEL) {
  return (await request([['model', model], ['language', 'en']], mp3)).text || '';
}

// The whole text, and each word with when it starts and ends, in seconds.
async function transcribeWords(mp3) {
  const body = await request([
    ['model', SECOND_OPINION],
    ['language', 'en'],
    ['response_format', 'verbose_json'],
    ['timestamp_granularities[]', 'word'],
  ], mp3);
  return { text: body.text || '', words: (body.words || []).map(w => ({ word: w.word, start: w.start, end: w.end })) };
}

/**
 * A whole recording heard, with each word's time. A small mono copy, under
 * OpenAI's 25 MB, brought to one loudness whatever the house level is, so
 * what is heard does not depend on it: set 2 dB quieter (2026-10-25), Like a
 * Star's one short line after a twenty-second pause went unheard, twice. The
 * copy is written at `small` and removed after.
 */
async function hearWhole(recording, small) {
  await ffmpeg(['-i', recording, '-af', 'loudnorm=I=-16:TP=-1.5', '-ac', '1', '-ar', '16000', '-b:a', '48k', small]);
  try {
    return await transcribeWords(fs.readFileSync(small));
  } finally {
    fs.rmSync(small, { force: true });
  }
}

module.exports = { transcribe, transcribeWords, hearWhole, MODEL, SECOND_OPINION };
