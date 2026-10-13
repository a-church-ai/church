/**
 * Asking again when a request fails for a reason that passes
 * (server/lib/utils/retry.js), the one helper every outside read uses, and
 * the public fetches that use it (utils/fetch-public.js). Written to fail
 * before the helper existed (2026-10-13), when Gemini's search and question
 * calls, and NOAA's, failed on the first busy moment.
 */

const test = require('node:test');
const assert = require('node:assert');
const { withRetry, isTransient, retryDelayMs, suggestedDelayMs } = require('../server/lib/utils/retry');
const { getJSON } = require('../server/lib/utils/fetch-public');

const failing = (errors, value = 'done') => {
  let calls = 0;
  const fn = async () => {
    const err = errors[calls++];
    if (err) throw err;
    return value;
  };
  return { fn, calls: () => calls };
};
const status = (code, extra = {}) => Object.assign(new Error(`HTTP ${code}`), { status: code }, extra);

test('a busy moment is asked again, waiting longer each time, until it answers', async () => {
  const waits = [];
  const { fn, calls } = failing([status(429), status(503)]);
  const value = await withRetry(fn, { attempts: 3, baseMs: 100, maxMs: 1000, jitter: false, wait: async ms => waits.push(ms) });
  assert.strictEqual(value, 'done');
  assert.strictEqual(calls(), 3);
  assert.deepStrictEqual(waits, [100, 200]);
});

test('a bad request, a spent quota, or the last try fails at once with its own error', async () => {
  const bad = failing([status(400)]);
  await assert.rejects(withRetry(bad.fn, { wait: async () => {} }), /HTTP 400/);
  assert.strictEqual(bad.calls(), 1);

  const spent = failing([status(429, { fatal: true })]);
  await assert.rejects(withRetry(spent.fn, { wait: async () => {} }), /HTTP 429/);
  assert.strictEqual(spent.calls(), 1, 'a quota that is spent does not come back by waiting');

  const down = failing([status(503), status(503), status(503), status(503)]);
  await assert.rejects(withRetry(down.fn, { attempts: 3, wait: async () => {} }), /HTTP 503/);
  assert.strictEqual(down.calls(), 3);
});

test('what passes and what does not', () => {
  for (const err of [status(429), status(529), status(503), { name: 'TimeoutError', message: 'timed out' }, new Error('fetch failed'), new Error('read ECONNRESET'), new Error('429 RESOURCE_EXHAUSTED')]) {
    assert.ok(isTransient(err), err.message);
  }
  for (const err of [status(400), status(401), status(404), new Error('API key not valid'), null]) {
    assert.ok(!isTransient(err), err && err.message);
  }
});

test('the server\'s own suggested wait comes first, under the ceiling, and jitter spreads the rest', async () => {
  assert.strictEqual(suggestedDelayMs(status(429, { retryAfter: '7' })), 7000);
  assert.ok(Math.abs(suggestedDelayMs(status(503, { retryAfter: new Date(Date.now() + 4000).toUTCString() })) - 4000) < 1500);
  assert.strictEqual(retryDelayMs(new Error('"retryDelay": "2s"'), 0, { maxMs: 10000 }), 2500);
  assert.strictEqual(retryDelayMs(status(429, { retryAfter: '600' }), 0, { maxMs: 8000 }), 8000, 'never past the ceiling');
  const waits = [];
  await withRetry(failing([status(503)]).fn, { baseMs: 1000, wait: async ms => waits.push(ms) });
  assert.ok(waits[0] >= 750 && waits[0] <= 1250, `jittered: ${waits[0]}`);
});

test('a public fetch asks again through a busy moment and not past a missing page', async () => {
  let calls = 0;
  const busyThenOk = async () => (++calls === 1
    ? { ok: false, status: 503, headers: { get: () => null } }
    : { ok: true, json: async () => ({ fine: true }) });
  assert.deepStrictEqual(await getJSON('https://example.test/a', { fetchImpl: busyThenOk, retry: { wait: async () => {} } }), { fine: true });
  assert.strictEqual(calls, 2);

  let missing = 0;
  const gone = async () => { missing++; return { ok: false, status: 404, headers: { get: () => null } }; };
  await assert.rejects(getJSON('https://example.test/b', { fetchImpl: gone, retry: { wait: async () => {} } }), /HTTP 404/);
  assert.strictEqual(missing, 1);
});
