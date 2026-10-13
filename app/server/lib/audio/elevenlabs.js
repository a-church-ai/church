/**
 * Speech for one line, from ElevenLabs. The key is ELEVENLABS_API_KEY, read
 * by name and never logged.
 *
 * Rate limits and server errors are retried with backoff. A quota or
 * permission error is not: every later line would fail the same way, so it
 * stops the run (err.fatal).
 */

const API = 'https://api.elevenlabs.io/v1';
const TRIES = 6;

function apiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY not configured. Add it to app/.env');
  return key;
}

const { withRetry } = require('../utils/retry');

// previousText and nextText are the lines around this one. They are not
// spoken; they let the model shape this line as part of what surrounds it.
async function speak({ text, voiceId, model, previousText, nextText }) {
  const body = JSON.stringify({
    text,
    model_id: model,
    ...(previousText ? { previous_text: previousText } : {}),
    ...(nextText ? { next_text: nextText } : {}),
  });
  return withRetry(async () => {
    const res = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json' },
      body,
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const detail = (await res.text()).slice(0, 300);
    const err = new Error(`ElevenLabs speech: HTTP ${res.status} ${detail}`);
    err.status = res.status;
    err.retryAfter = res.headers.get('retry-after');
    // A spent quota or a bad key is not a busy moment: never asked again.
    err.fatal = res.status === 401 || res.status === 402 || /quota|payment|missing_permissions/i.test(detail);
    throw err;
  }, { attempts: TRIES, baseMs: 2000, maxMs: 60000 });
}

module.exports = { speak };
