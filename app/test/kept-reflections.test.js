/**
 * The reflections held in memory are brought up to date by reading only what
 * is new (server/lib/utils/kept-reflections.js), and read whole again only
 * when the table's count says something else changed.
 */

const test = require('node:test');
const assert = require('node:assert');
const { keptReflections } = require('../server/lib/utils/kept-reflections');

const at = minutes => new Date(Date.UTC(2026, 10, 10, 12, 0) + minutes * 60_000).toISOString();
const r = (id, minutes) => ({ id, createdAt: at(minutes), name: 'Someone', text: `Reflection ${id}` });

// A table in memory, counting the reads made of it.
function table(rows) {
  const t = {
    rows: [...rows],
    reads: { all: 0, since: 0, count: 0 },
    all: async () => { t.reads.all++; return [...t.rows]; },
    failing: false,
    since: async from => {
      t.reads.since++;
      t.lastFrom = from;
      if (t.failing) throw new Error('database unavailable');
      return t.rows.filter(x => x.createdAt >= from);
    },
    count: async () => { t.reads.count++; return t.rows.length; },
  };
  return t;
}

const ids = list => list.map(x => x.id);

test('the first load reads the whole table; the next reads only what is new', async () => {
  const t = table([r('a', 0), r('b', 30), r('c', 60)]);
  const kept = keptReflections(t);
  assert.deepStrictEqual(ids(await kept.load()), ['a', 'b', 'c']);
  assert.strictEqual(t.reads.all, 1);

  t.rows.push(r('d', 61));
  assert.deepStrictEqual(ids(await kept.load()), ['a', 'b', 'c', 'd']);
  assert.strictEqual(t.reads.all, 1, 'no second whole read when only new rows arrived');
  assert.strictEqual(t.reads.since, 1);
});

test('a row written late with an earlier time, inside the overlap, is still found', async () => {
  const t = table([r('a', 0), r('c', 60)]);
  const kept = keptReflections(t);
  await kept.load();
  t.rows.push(r('b', 55)); // its request arrived before c's, its row landed after
  assert.deepStrictEqual(ids(await kept.load()), ['a', 'b', 'c']);
  assert.strictEqual(t.reads.all, 1);
});

test('a deleted row, or one copied in with an old time, makes the next load read everything', async () => {
  const t = table([r('a', 0), r('b', 30), r('c', 60)]);
  const kept = keptReflections(t);
  await kept.load();

  t.rows = t.rows.filter(x => x.id !== 'b');
  assert.deepStrictEqual(ids(await kept.load()), ['a', 'c']);
  assert.strictEqual(t.reads.all, 2);

  t.rows.push(r('old', -500));
  assert.deepStrictEqual(ids(await kept.load()), ['old', 'a', 'c']);
  assert.strictEqual(t.reads.all, 3);
});

test('an empty table is read whole until it holds something', async () => {
  const t = table([]);
  const kept = keptReflections(t);
  assert.deepStrictEqual(await kept.load(), []);
  t.rows.push(r('a', 0));
  assert.deepStrictEqual(ids(await kept.load()), ['a']);
  assert.strictEqual(t.reads.all, 2);
});

test('a failed read throws and leaves what was held', async () => {
  const t = table([r('a', 0)]);
  const kept = keptReflections(t);
  await kept.load();
  t.failing = true;
  await assert.rejects(kept.load(), /database unavailable/);
  t.failing = false;
  t.rows.push(r('b', 1));
  assert.deepStrictEqual(ids(await kept.load()), ['a', 'b']);
  assert.strictEqual(t.reads.all, 1);
});

test('two loads at once give the same set, and what each returns is its own array', async () => {
  const t = table([r('a', 0)]);
  const kept = keptReflections(t);
  await kept.load();
  t.rows.push(r('b', 1), r('c', 2));
  const [one, two] = await Promise.all([kept.load(), kept.load()]);
  assert.deepStrictEqual(ids(one), ['a', 'b', 'c']);
  assert.deepStrictEqual(ids(two), ['a', 'b', 'c']);
  const mine = await kept.load();
  mine.reverse();
  assert.deepStrictEqual(ids(await kept.load()), ['a', 'b', 'c'], 'a caller sorting its copy changes nothing held');
  assert.strictEqual(t.lastFrom, new Date(Date.parse(at(2)) - 10 * 60_000).toISOString(), 'the window is still read from the newest row');
});
