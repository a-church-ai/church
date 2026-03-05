/**
 * LanceDB wrapper for vector storage and search
 * Embedded vector database - no server required
 */

const lancedb = require('@lancedb/lancedb');
const path = require('path');

const DB_PATH = process.env.LANCEDB_PATH || path.join(__dirname, '../../../data/vectors.lance');
const TABLE_NAME = 'documents';

let db = null;
let table = null;

/**
 * Initialize connection to LanceDB
 * @returns {Promise<void>}
 */
async function connect() {
  if (db) return;
  db = await lancedb.connect(DB_PATH);
}

/**
 * Get or create the documents table
 * @returns {Promise<object>} - LanceDB table
 */
async function getTable() {
  if (table) return table;

  await connect();

  const tables = await db.tableNames();
  if (tables.includes(TABLE_NAME)) {
    table = await db.openTable(TABLE_NAME);
  }

  return table;
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
