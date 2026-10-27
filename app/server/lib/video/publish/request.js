/**
 * One HTTP helper for the publishers: a fetch that throws an error carrying
 * the response's status and body (so utils/retry.js can tell a passing
 * failure from a refusal, and the caller can read the platform's reason),
 * retried only when the caller says the call is safe to repeat. A post or an
 * upload session is never retried: none of these platforms offers an
 * idempotency key, and a retry after an ambiguous failure is how the same
 * video is posted twice (news-community's lesson).
 */

const { withRetry } = require('../../utils/retry');

async function request(url, { method = 'GET', headers = {}, body, retry = false, timeoutMs = 60000, duplex } = {}) {
  const once = async () => {
    const res = await fetch(url, { method, headers, body, duplex, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok && res.status !== 308) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`${method} ${url.split('?')[0]} answered ${res.status}: ${text.slice(0, 600)}`), { status: res.status, body: text, retryAfter: res.headers.get('retry-after') });
    }
    return res;
  };
  return retry ? withRetry(once, { attempts: 4, baseMs: 2000, maxMs: 30000 }) : once();
}

module.exports = { request };
