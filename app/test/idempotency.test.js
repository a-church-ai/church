/**
 * shared.js once: what is kept, what is not, and that a run is shared.
 */
const test = require('node:test');
const assert = require('node:assert');
const { once } = require('../server/lib/api/shared');

const ctx = { ip: '198.51.100.9', baseUrl: 'http://localhost' };

test('a 5xx or a 429 is not kept, so a retry gets a fresh chance; a 4xx is', async () => {
  let runs = 0;
  const failing = async () => { runs++; return { status: runs === 1 ? 503 : 200, body: { runs } } };
  assert.strictEqual((await once('k-503', ctx, '/api/ask', { q: 1 }, failing)).status, 503);
  const retried = await once('k-503', ctx, '/api/ask', { q: 1 }, failing);
  assert.deepStrictEqual([retried.status, retried.replayed], [200, undefined], 'run again, not replayed');
  let limited = 0;
  const busy = async () => ({ status: ++limited === 1 ? 429 : 201, body: {} });
  await once('k-429', ctx, '/api/ask', {}, busy);
  assert.strictEqual((await once('k-429', ctx, '/api/ask', {}, busy)).status, 201);
  let refusals = 0;
  const refusing = async () => ({ status: 400, body: { n: ++refusals } });
  await once('k-400', ctx, '/api/ask', {}, refusing);
  const again = await once('k-400', ctx, '/api/ask', {}, refusing);
  assert.deepStrictEqual([again.status, again.body.n, again.replayed], [400, 1, true]);
});

test('a key is per path and per address', async () => {
  let runs = 0;
  const run = async () => ({ status: 200, body: { n: ++runs } });
  await once('k-scope', ctx, '/api/reflect', {}, run);
  await once('k-scope', ctx, '/api/feedback', {}, run);
  await once('k-scope', { ...ctx, ip: '198.51.100.10' }, '/api/reflect', {}, run);
  assert.strictEqual(runs, 3);
});
