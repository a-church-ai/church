/**
 * A failed RAG rebuild must not destroy the working index.
 *
 * Written to fail against the implementation as of 2026-08-13, per Codex's
 * review: lancedb.js addDocuments() drops the existing table before creating
 * the replacement, and index-content.js logs embedding failures, continues,
 * stores whatever succeeded, and records the corpus hash as current.
 *
 * So a rebuild that dies partway leaves no index at all, and one that merely
 * degrades leaves a partial index marked as up to date. Both are worse than
 * keeping the previous index.
 *
 * This asserts the contract, not the storage engine: addDocuments must be
 * atomic from a reader's point of view. If the new set cannot be built, the old
 * one is still queryable afterwards.
 */

const test = require('node:test');
const assert = require('node:assert');

const lancedb = require('../server/lib/rag/lancedb');

test('addDocuments rejects an empty document set instead of clearing the index', async () => {
  await assert.rejects(
    () => lancedb.addDocuments([]),
    /empty|no documents|refus/i,
    'addDocuments([]) should refuse rather than drop the table and create nothing'
  );
});

test('a failed rebuild leaves the previous index queryable', async (t) => {
  const before = await lancedb.checkIndex();
  if (!before.exists || before.count === 0) {
    t.skip('no local index present; run npm run index to exercise this test');
    return;
  }

  // Documents that will fail validation partway through the write.
  const bad = [
    { content: 'valid', file: 'a.md', section: null, vector: [0.1, 0.2] },
    { content: 'missing vector', file: 'b.md', section: null },
  ];

  await assert.rejects(() => lancedb.addDocuments(bad));

  const after = await lancedb.checkIndex();
  assert.strictEqual(
    after.exists, true,
    'index disappeared after a failed rebuild: the old table was dropped before the new one succeeded'
  );
  assert.strictEqual(
    after.count, before.count,
    `index row count changed from ${before.count} to ${after.count} after a failed rebuild`
  );
});
