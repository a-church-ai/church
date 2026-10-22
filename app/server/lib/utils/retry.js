/**
 * Asking again when a request failed for a reason that passes: a rate limit,
 * a service busy or briefly down, a dropped connection, a timeout. Exponential
 * backoff with jitter, a server's own suggested wait when it gives one
 * (Retry-After, or Gemini's retryDelay), and a ceiling. Anything else fails at
 * once, since a bad request or a bad key does not improve with waiting, and
 * an error marked `fatal` (a quota that is spent, not a rate that is
 * exceeded) is never retried.
 *
 * One helper for every outside request the app makes that is safe to repeat:
 * Gemini (rag/gemini.js), NOAA, JPL and NASA (utils/fetch-public.js),
 * ElevenLabs and OpenAI's transcription (audio/). Claude calls get the same
 * from the Anthropic SDK itself (content-generation/claude.js maxRetries).
 * Writes that could land twice (a pull request opened on GitHub) are not
 * retried. When the last try fails, the caller logs the error with
 * ./describe-error.js, so the reason in its cause is not lost.
 */

const { setTimeout: sleep } = require('timers/promises');

// Statuses and messages that mean "try again shortly".
const TRANSIENT_STATUS = [408, 425, 429, 500, 502, 503, 504, 529];
const TRANSIENT_MESSAGE = /\b(408|429|500|502|503|504|529)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL|overloaded|quota|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i;

function isTransient(err) {
  if (!err || err.fatal) return false;
  if (TRANSIENT_STATUS.includes(Number(err.status || err.code))) return true;
  if (err.name === 'TimeoutError') return true;
  return TRANSIENT_MESSAGE.test(String(err.message || ''));
}

// A wait the server asked for, in milliseconds, or null: Gemini's retryDelay
// in its error body, or a Retry-After in seconds or as a date.
function suggestedDelayMs(err) {
  const m = /retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec((err && err.message) || '');
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  const after = err && err.retryAfter;
  if (after === undefined || after === null || after === '') return null;
  const seconds = Number(after);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const at = Date.parse(after);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

// How long to wait before retry number `attempt` (0-based): the server's
// suggestion plus half a second, else baseMs doubling, never over maxMs.
function retryDelayMs(err, attempt = 0, { baseMs = 1000, maxMs = 30000 } = {}) {
  const suggested = suggestedDelayMs(err);
  if (suggested !== null) return Math.min(suggested + 500, maxMs);
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

/**
 * Run fn(attempt) until it succeeds, it fails for good, or `attempts` tries
 * are spent; the last error is thrown. jitter spreads the waits (75% to 125%
 * of each) so clients that failed together do not return together. onRetry
 * (err, retryNumber, waitMs) is told before each wait; wait is injectable for
 * tests.
 */
async function withRetry(fn, { attempts = 3, baseMs = 1000, maxMs = 30000, retryable = isTransient, jitter = true, onRetry, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt + 1 >= attempts || !retryable(err)) throw err;
      const ms = retryDelayMs(err, attempt, { baseMs, maxMs });
      const delay = jitter ? Math.round(ms * (0.75 + Math.random() * 0.5)) : ms;
      if (onRetry) onRetry(err, attempt + 1, delay);
      await wait(delay);
    }
  }
}

module.exports = { withRetry, isTransient, retryDelayMs, suggestedDelayMs };
