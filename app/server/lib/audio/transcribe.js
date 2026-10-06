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
 */

const MODEL = 'gpt-4o-mini-transcribe';
const SECOND_OPINION = 'whisper-1';
const TRIES = 5;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function transcribe(mp3, model = MODEL) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured. Add it to app/.env');
  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.append('model', model);
    form.append('language', 'en');
    form.append('file', new Blob([mp3], { type: 'audio/mpeg' }), 'line.mp3');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    if (res.ok) return (await res.json()).text || '';
    const detail = (await res.text()).slice(0, 300);
    if (!(res.status === 429 || res.status >= 500) || attempt === TRIES) {
      const err = new Error(`Transcription: HTTP ${res.status} ${detail}`);
      err.fatal = res.status === 401 || /quota|billing/i.test(detail);
      throw err;
    }
    await sleep(Math.min(30000, 1500 * 2 ** (attempt - 1)));
  }
}

module.exports = { transcribe, MODEL, SECOND_OPINION };
