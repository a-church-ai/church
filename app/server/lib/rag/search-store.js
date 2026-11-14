/**
 * The search index, in the database (search_chunks, pgvector): every passage of
 * the served corpus with its embedding and its words. It was LanceDB on the
 * volume until 2026-11-09 (plan: supabase-database-2026-11-09.md in the private
 * repo); the calls are the ones lancedb.js had, so its callers changed one
 * require.
 *
 * A passage's key is a hash of the embedding in use and its file, section
 * and text. A rebuild adds the
 * passages whose keys are new, then keeps exactly the rebuild's keys and
 * records the rebuild, in one transaction (search_keep), which refuses an
 * empty list and any key not stored. So there is never a moment with no
 * index, and a rebuild that produced nothing, or failed halfway, leaves the
 * index it found.
 */

const crypto = require('crypto');
const { db } = require('../db/client');
const store = require('../db');
const { cache } = require('../utils/cache');
const { servedCorpusParams } = require('./corpus');
const discover = require('../docs/discover');
const { EMBED_MODEL, EMBED_DIMENSIONS } = require('./gemini');

// What the stored vectors are: the model and the width, so a rebuild reuses
// them only while both are still the ones in use.
const EMBEDDING = `${EMBED_MODEL}@${EMBED_DIMENSIONS}`;
// Passages sent per request when a rebuild adds them: 100 vectors of 768 is
// about a megabyte of JSON.
const ADD_BATCH = 100;

// The embedding in use is part of the key, so a change of model or width
// makes every passage new, and the rebuild replaces them all.
const keyOf = (c) => crypto.hash('sha256', `${EMBEDDING}\0${c.file}\0${c.section || ''}\0${c.content}`);
const vectorOf = (v) => (typeof v === 'string' ? JSON.parse(v) : Array.from(v));

let servedParams = null;
let servedFor = null;

// The served corpus (corpus.js), applied to every search, rebuilt when a dated
// document goes public (corpus.js leaves out what is not public yet). The index
// holds only served files once rebuilt; this keeps one built under an older
// rule from answering with anything else in the meantime.
async function served() {
  await discover.listAllDocs();
  if (!servedParams || servedFor !== discover.publicationKey()) {
    servedFor = discover.publicationKey();
    servedParams = servedCorpusParams();
  }
  return servedParams;
}

/**
 * The passages closest in meaning to an embedding, from the served corpus.
 * Distance is cosine distance: 0 is identical, and similarity is
 * 1 - distance.
 * @returns {Promise<Array<{content: string, file: string, section: string, _distance: number}>>}
 */
async function search(embedding, limit = 5) {
  const rows = await store.rpc('search_near', { p_embedding: JSON.stringify(embedding), p_limit: limit, ...(await served()) });
  return rows.map(r => ({ content: r.content, file: r.file, section: r.section || null, _distance: r.distance }));
}

/**
 * The passages whose words match a query, best first, from the served corpus,
 * each with its vector so its similarity can be told too.
 * @returns {Promise<Array<{content: string, file: string, section: string, vector: number[], _score: number}>>}
 */
async function textSearch(query, limit = 5) {
  const rows = await store.rpc('search_words', { p_query: query, p_limit: limit, ...(await served()) });
  return rows.map(r => ({ content: r.content, file: r.file, section: r.section || null, vector: vectorOf(r.embedding), _score: r.score }));
}

/**
 * Every passage's file, section and vector. Used offline (companions, the
 * video loop library), never on a request path.
 */
async function listAll() {
  const rows = await store.fetchAll('search passages', () => db().from('search_chunks').select('key, file, section, embedding').order('key'));
  return rows.map(r => ({ file: r.file, section: r.section || null, vector: vectorOf(r.embedding) }));
}

/** The keys stored, so a rebuild embeds only passages that are new or changed. */
async function storedKeys() {
  const rows = await store.fetchAll('search keys', () => db().from('search_chunks').select('key').order('key'));
  return new Set(rows.map(r => r.key));
}

/**
 * Store a rebuild: the passages not already stored, then exactly these
 * passages kept and the rebuild recorded, in one transaction. Each document
 * that is new carries its vector; one already stored may come without.
 * @param {Array<{content: string, file: string, section: string, vector?: number[]}>} documents
 * @param {{ corpusHash: string, fileCount: number }} state
 */
async function addDocuments(documents, { corpusHash = null, fileCount = 0 } = {}) {
  // Refusing an empty set is the load-bearing check: a rebuild that produced
  // nothing is the case where the old index is most worth keeping. The
  // database refuses it too (search_keep).
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error('addDocuments: refusing to rebuild the index from an empty document set');
  }
  const stored = await storedKeys();
  const keyed = documents.map(d => ({ ...d, key: keyOf(d) }));
  const toAdd = [];
  const seen = new Set();
  for (const d of keyed) {
    if (stored.has(d.key) || seen.has(d.key)) continue;
    seen.add(d.key);
    if (!Array.isArray(d.vector) || d.vector.length !== EMBED_DIMENSIONS) {
      throw new Error(`addDocuments: ${d.file} has a ${Array.isArray(d.vector) ? `${d.vector.length}-dim vector` : 'missing vector'}, expected ${EMBED_DIMENSIONS}; refusing to rebuild`);
    }
    toAdd.push(d);
  }
  for (let i = 0; i < toAdd.length; i += ADD_BATCH) {
    await store.rpc('search_add', {
      p_rows: toAdd.slice(i, i + ADD_BATCH).map(d => ({ key: d.key, file: d.file, section: d.section || '', content: d.content, embedding: JSON.stringify(d.vector) })),
    });
  }
  const removed = await store.rpc('search_keep', { p_keys: [...new Set(keyed.map(d => d.key))], p_state: { corpusHash, fileCount, embedModel: EMBEDDING } });
  stateCache.clear();
  return { added: toAdd.length, removed };
}

const EMPTY_STATE = { corpusHash: null, chunkCount: 0, fileCount: 0, rebuiltAt: null, embedModel: null };

async function readStateNow() {
  const { data, error } = await db().from('search_state').select('*').eq('id', 1).limit(1);
  if (error) throw new store.DbError('search state', error);
  const r = data && data[0];
  if (!r) return { ...EMPTY_STATE };
  return { corpusHash: r.corpus_hash, chunkCount: r.chunk_count, fileCount: r.file_count, rebuiltAt: r.rebuilt_at, embedModel: r.embed_model };
}

// Read on every question and search, so held for a minute; a rebuild in this
// process clears it, and one in the child process is seen within the minute.
const stateCache = cache({ name: 'search state', ttl: 60 * 1000, load: readStateNow });

/** What the index was built from: { corpusHash, chunkCount, fileCount, rebuiltAt, embedModel }. */
async function readState() {
  return stateCache.get();
}

/** Whether the index has passages, and how many. */
async function checkIndex() {
  try {
    const state = await readState();
    return { exists: state.chunkCount > 0, count: state.chunkCount };
  } catch {
    return { exists: false, count: 0 };
  }
}

module.exports = { search, textSearch, listAll, storedKeys, addDocuments, checkIndex, readState, keyOf, EMBEDDING };
