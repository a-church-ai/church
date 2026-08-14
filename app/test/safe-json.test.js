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

const { safeWriteJSON, safeReadJSON } = require('../server/lib/utils/safe-json');

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

test('concurrent read-modify-write preserves every appended item', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'attendance.json');
  await safeWriteJSON(file, { visits: [] });

  // Exactly what /api/attend and /api/reflect do: load, push, save.
  async function appendVisit(i) {
    const data = await safeReadJSON(file, { visits: [] });
    data.visits.push({ i });
    await safeWriteJSON(file, data);
  }

  const N = 25;
  await Promise.all(Array.from({ length: N }, (_, i) => appendVisit(i)));

  const final = await safeReadJSON(file, { visits: [] });
  assert.strictEqual(
    final.visits.length, N,
    `expected ${N} visits, found ${final.visits.length}: concurrent appends are overwriting each other`
  );
});
