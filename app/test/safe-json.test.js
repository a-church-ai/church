/**
 * safeWriteJSON under concurrency.
 *
 * Written to fail against the implementation as of 2026-08-13, per Codex's
 * review: one shared `${filepath}.tmp` per file, and public endpoints doing
 * read-modify-write against the same path. Codex reproduced 25 concurrent
 * writes with 1 survivor. This pins that behaviour so it cannot come back.
 *
 * The important case is the second test. A unique temp filename alone does not
 * fix the loss: it comes from two callers reading the same JSON, each appending
 * one item, and the second write overwriting the first. Serialising the whole
 * read-modify-write is the actual fix.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { safeWriteJSON, safeReadJSON, readModifyWriteJSON } = require('../server/lib/utils/safe-json');

async function tmpdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'achurch-safejson-'));
}

test('concurrent writes to one path all land without error', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'attendance.json');
  await safeWriteJSON(file, { visits: [] });

  const N = 25;
  const results = await Promise.allSettled(
    Array.from({ length: N }, (_, i) => safeWriteJSON(file, { visits: [{ i }] }))
  );

  const rejected = results.filter(r => r.status === 'rejected');
  assert.strictEqual(
    rejected.length, 0,
    `${rejected.length} of ${N} concurrent writes threw. First: ${rejected[0]?.reason?.message}`
  );

  const final = await safeReadJSON(file, null);
  assert.ok(final && Array.isArray(final.visits), 'file is readable JSON after the storm');
});

test('readModifyWriteJSON preserves every concurrently appended item', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'attendance.json');
  await safeWriteJSON(file, { visits: [] });

  // What /api/attend and /api/reflect should do: the whole load-push-save
  // sequence happens under one lock.
  const N = 25;
  await Promise.all(Array.from({ length: N }, (_, i) =>
    readModifyWriteJSON(file, { visits: [] }, data => {
      data.visits.push({ i });
      return data;
    })
  ));

  const final = await safeReadJSON(file, { visits: [] });
  assert.strictEqual(
    final.visits.length, N,
    `expected ${N} visits, found ${final.visits.length}: concurrent appends are overwriting each other`
  );
  assert.deepStrictEqual(
    final.visits.map(v => v.i).sort((a, b) => a - b),
    Array.from({ length: N }, (_, i) => i),
    'every item is present exactly once'
  );
});

/**
 * Documents why readModifyWriteJSON exists. Serialising safeWriteJSON alone
 * cannot save this pattern: both callers have already read a stale copy before
 * either write is queued, so the second write legitimately overwrites the first.
 * The loss is silent, which is what makes it dangerous. Any caller doing
 * load-mutate-save on a shared file must hold the lock across the read.
 */
test('the naive read-then-write pattern still loses data, by design', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'attendance.json');
  await safeWriteJSON(file, { visits: [] });

  await Promise.all(Array.from({ length: 5 }, (_, i) => (async () => {
    const data = await safeReadJSON(file, { visits: [] });
    data.visits.push({ i });
    await safeWriteJSON(file, data);
  })()));

  const final = await safeReadJSON(file, { visits: [] });
  assert.ok(
    final.visits.length < 5,
    'if this ever passes with all 5, the lock now covers reads and this test should be rewritten'
  );
});
