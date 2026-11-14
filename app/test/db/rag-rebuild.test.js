/**
 * A failed RAG rebuild must not destroy the working index.
 *
 * Written first against LanceDB (2026-08-13, per Codex's review), whose
 * addDocuments() dropped the live table before creating its replacement, so a
 * rebuild that died partway left no index at all. The index is now in the
 * database (lib/rag/search-store.js): new passages are added, then exactly the
 * rebuild's passages are kept in one transaction (search_keep). This holds
 * the same contract against it: if the new set cannot be stored, the old one
 * is still there, whole, afterwards.
 */

const test = require('node:test');
const assert = require('node:assert');

const searchStore = require('../../server/lib/rag/search-store');
const store = require('../../server/lib/db');
const { resetDb } = require('../database');

const pad = v => [...v, ...Array(768 - v.length).fill(0)];
const doc = (file, content, vector) => ({ file, section: 'One', content, vector });
const good = [
  doc('docs/a.md', 'what remains', pad([1, 0])),
  doc('docs/b.md', 'what passes', pad([0, 1])),
];

test.before(async () => {
  await resetDb();
  await searchStore.addDocuments(good, { corpusHash: 'first', fileCount: 2 });
});

test('addDocuments rejects an empty document set instead of clearing the index', async () => {
  await assert.rejects(() => searchStore.addDocuments([]), /empty/i);
  await assert.rejects(() => searchStore.addDocuments(null));
  assert.strictEqual((await searchStore.checkIndex()).count, 2);
});

test('addDocuments rejects a new passage with no vector, or one of another width than the index\'s', async () => {
  await assert.rejects(() => searchStore.addDocuments([...good, doc('docs/c.md', 'no vector')]), /missing vector/);
  await assert.rejects(() => searchStore.addDocuments([...good, doc('docs/c.md', 'too narrow', [0.1, 0.2])]), /2-dim vector, expected 768/);
  assert.strictEqual((await searchStore.checkIndex()).count, 2);
});

test('a passage already stored may come without its vector: a rebuild embeds only what changed', async () => {
  const { added, removed } = await searchStore.addDocuments([
    { ...good[0], vector: undefined },
    doc('docs/c.md', 'what arrives', pad([0.6, 0.8])),
  ], { corpusHash: 'second', fileCount: 2 });
  assert.deepStrictEqual([added, removed], [1, 1], 'c added, b no longer in the corpus');
  const state = await searchStore.readState();
  assert.deepStrictEqual([state.corpusHash, state.chunkCount], ['second', 2]);
  assert.deepStrictEqual((await searchStore.search(pad([1, 0]), 5)).map(r => r.file), ['docs/a.md', 'docs/c.md']);
});

test('the database itself refuses to keep an empty index, or one naming a passage it does not hold', async () => {
  await assert.rejects(() => store.rpc('search_keep', { p_keys: [], p_state: {} }), /empty index/);
  await assert.rejects(() => store.rpc('search_keep', { p_keys: ['0'.repeat(64)], p_state: {} }), /not stored/);
  assert.strictEqual((await searchStore.listAll()).length, 2, 'the index it found is left whole');
});
