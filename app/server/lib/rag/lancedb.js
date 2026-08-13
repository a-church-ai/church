/**
 * LanceDB wrapper for vector storage and search
 * Embedded vector database - no server required
 */

const lancedb = require('@lancedb/lancedb');
const path = require('path');

const DB_PATH = process.env.LANCEDB_PATH || path.join(__dirname, '../../../data/vectors.lance');
const TABLE_NAME = 'documents';

let db = null;

/**
 * Initialize connection to LanceDB
 * @returns {Promise<void>}
 */
async function connect() {
  if (db) return;
  db = await lancedb.connect(DB_PATH);
}

/**
 * Get the documents table. Always opens fresh — do NOT cache the returned
 * reference across calls. The background RAG indexer runs in a separate
 * child process and periodically drops + recreates this table (see
 * addDocuments below and app/server/index.js REBUILD_RAG_ON_STARTUP). A
 * cached table handle from before that swap points at a dropped underlying
 * artifact and search fails with an opaque error. Opening fresh each call
 * is cheap (just a handle) and correct.
 *
 * @returns {Promise<object|null>} - LanceDB table, or null if not yet created
 */
async function getTable() {
  try {
    await connect();
    const tables = await db.tableNames();
    if (!tables.includes(TABLE_NAME)) {
      return null;
    }
    return await db.openTable(TABLE_NAME);
  } catch (err) {
    // Reaches here mainly when the child-process indexer is mid-swap: table
    // shows in tableNames() then vanishes before openTable() succeeds, or the
    // underlying files are momentarily inconsistent. Callers treat null as
    // "no results" and /api/ask degrades to the graceful "no info found"
    // path (see rag/index.js chunks.length === 0). This is preferable to
    // surfacing an opaque 500 during the brief rebuild swap.
    console.warn(`[lancedb] getTable transient error (likely rebuild swap): ${err.message}`);
    return null;
  }
}

/**
 * Search for similar documents
 * @param {number[]} embedding - Query embedding vector
 * @param {number} limit - Max results to return
 * @returns {Promise<Array<{content: string, file: string, section: string, _distance: number}>>}
 */
async function search(embedding, limit = 5) {
  const tbl = await getTable();
  if (!tbl) {
    return [];
  }

  const results = await tbl
    .vectorSearch(embedding)
    .limit(limit)
    .toArray();

  return results.map(r => ({
    content: r.content,
    file: r.file,
    section: r.section || null,
    _distance: r._distance
  }));
}

/**
 * Add documents to the database (used by indexer)
 * @param {Array<{content: string, file: string, section: string, vector: number[]}>} documents
 * @returns {Promise<void>}
 */
async function addDocuments(documents) {
  await connect();

  const tables = await db.tableNames();

  if (tables.includes(TABLE_NAME)) {
    // Drop existing table to rebuild index
    await db.dropTable(TABLE_NAME);
  }

  // Create new table with documents
  table = await db.createTable(TABLE_NAME, documents);
}

/**
 * Check if index exists and has documents
 * @returns {Promise<{exists: boolean, count: number}>}
 */
async function checkIndex() {
  try {
    const tbl = await getTable();
    if (!tbl) {
      return { exists: false, count: 0 };
    }
    const count = await tbl.countRows();
    return { exists: true, count };
  } catch (error) {
    return { exists: false, count: 0 };
  }
}

module.exports = {
  connect,
  search,
  addDocuments,
  checkIndex,
  DB_PATH
};
