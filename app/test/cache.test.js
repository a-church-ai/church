/**
 * lib/utils/cache.js and lib/utils/pool.js: the shared cache every hand-written
 * one became (production-health-2026-10-12.md, private repo), and the pool
 * that bounds how many calls run at once.
 */

const test = require('node:test');
const assert = require('node:assert');

const { cache } = require('../server/lib/utils/cache');
const { pool } = require('../server/lib/utils/pool');

const quiet = { warn() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));

// A load whose calls are counted and finish only when released.
function gated() {
  const calls = [];
  const load = key => new Promise((resolve, reject) => calls.push({ key, resolve, reject }));
  return { calls, load };
}

test('a value within its time is loaded once', async () => {
  let loads = 0;
  const c = cache({ name: 't', ttl: 60000, load: async () => ++loads });
  assert.strictEqual(await c.get(), 1);
  assert.strictEqual(await c.get(), 1);
  assert.strictEqual(loads, 1);
});

test('callers arriving while nothing is held share one load', async () => {
  const g = gated();
  const c = cache({ name: 't', ttl: 60000, load: g.load });
  const waiting = Array.from({ length: 10 }, () => c.get());
  await tick();
  assert.strictEqual(g.calls.length, 1);
  g.calls[0].resolve('list');
  assert.deepStrictEqual(await Promise.all(waiting), Array(10).fill('list'));
});

test('after its time, the held value answers at once and one refresh runs behind it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const g = gated();
  const c = cache({ name: 't', ttl: 1000, load: g.load });
  const first = c.get();
  g.calls[0].resolve('old');
  assert.strictEqual(await first, 'old');

  t.mock.timers.tick(1000);
  const during = await Promise.all(Array.from({ length: 10 }, () => c.get()));
  assert.deepStrictEqual(during, Array(10).fill('old'));
  assert.strictEqual(g.calls.length, 2, 'one refresh, not ten');

  g.calls[1].resolve('new');
  await tick();
  assert.strictEqual(await c.get(), 'new');
});

test('a refresh that fails keeps the held value and is tried again', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const g = gated();
  const warnings = [];
  const c = cache({ name: 'feed', ttl: 1000, load: g.load, log: { warn: w => warnings.push(w) } });
  const first = c.get();
  g.calls[0].resolve('kept');
  await first;
  t.mock.timers.tick(1000);
  assert.strictEqual(await c.get(), 'kept');
  g.calls[1].reject(new Error('disk'));
  await tick();
  assert.match(warnings[0], /feed: refresh failed.*disk/);
  assert.strictEqual(await c.get(), 'kept');
  assert.strictEqual(g.calls.length, 3, 'the next get tries again');
});

test('a load someone waits on throws to them, and the next get loads again', async () => {
  let loads = 0;
  const c = cache({ name: 't', ttl: 60000, log: quiet, load: async () => { if (++loads === 1) throw new Error('first'); return 'second'; } });
  await assert.rejects(c.get(), /first/);
  assert.strictEqual(await c.get(), 'second');
});

test('set puts a value in place, and a load already running does not overwrite it', async () => {
  const g = gated();
  const c = cache({ name: 'plans', ttl: 60000, load: g.load });
  const reading = c.get('2026-10-12');
  c.set('2026-10-12', 'saved');
  g.calls[0].resolve('read before the save');
  assert.strictEqual(await reading, 'read before the save', 'its caller still gets an answer');
  assert.strictEqual(await c.get('2026-10-12'), 'saved');
  assert.strictEqual(g.calls.length, 1);
});

test('clear drops the value, and a load running when it was cleared is not kept', async () => {
  const g = gated();
  const c = cache({ name: 'reflections', ttl: 60000, load: g.load });
  const first = c.get();
  g.calls[0].resolve('before');
  await first;

  c.clear();
  const reading = c.get();
  c.clear(); // a reflection left while that load ran
  g.calls[1].resolve('without the new reflection');
  await reading;
  const after = c.get();
  assert.strictEqual(g.calls.length, 3, 'the next get loads again');
  g.calls[2].resolve('with it');
  assert.strictEqual(await after, 'with it');
});

test('keys are held apart, and a load is told its key', async () => {
  const c = cache({ name: 't', ttl: 60000, load: async key => `plan for ${key}` });
  assert.strictEqual(await c.get('a'), 'plan for a');
  assert.strictEqual(await c.get('b'), 'plan for b');
  c.clear('a');
  assert.strictEqual(await c.get('b'), 'plan for b');
});

test('a pool never runs more than its size at once, and returns results in order', async () => {
  let running = 0, most = 0;
  const results = await pool([5, 1, 4, 2, 3], 2, async (n, i) => {
    running++; most = Math.max(most, running);
    await new Promise(resolve => setTimeout(resolve, n));
    running--;
    return `${i}:${n}`;
  });
  assert.strictEqual(most, 2);
  assert.deepStrictEqual(results, ['0:5', '1:1', '2:4', '3:2', '4:3']);
});

test('a fatal error stops the pool once the calls in flight finish', async () => {
  const started = [];
  const spent = Object.assign(new Error('quota spent'), { fatal: true });
  await assert.rejects(pool([1, 2, 3, 4, 5, 6], 2, async n => {
    started.push(n);
    await tick();
    if (n === 2) throw spent;
  }), /quota spent/);
  assert.ok(started.length < 6, `stopped early, after ${started.join(', ')}`);
});

test('an empty pool returns an empty list', async () => {
  assert.deepStrictEqual(await pool([], 4, async () => 1), []);
});
