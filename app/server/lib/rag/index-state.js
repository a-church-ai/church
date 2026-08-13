/**
 * Persistent metadata for the RAG index.
 *
 * Records which corpus hash the current vectors.lance was built from, when
 * the rebuild happened, and how many chunks it produced. Lives on the
 * Railway volume alongside vectors.lance itself, so both the index and the
 * hash that describes it survive together.
 *
 * Used by the server startup path to decide whether a rebuild is needed
 * (see server/index.js): if the corpus hash on disk matches the hash of
 * the docs+music tree we boot with, the vectors are current and the
 * rebuild is skipped. Otherwise a background rebuild runs.
 *
 * Follows the same shape as content-generation/log.js: module-level path
 * constant + tiny read/write helpers over safe-json for atomic writes and
 * corruption recovery.
 */

const path = require('path');
const { safeReadJSON, safeWriteJSON } = require('../utils/safe-json');

const STATE_FILE = path.join(__dirname, '../../../data/rag-index-state.json');

const EMPTY_STATE = {
  corpusHash: null,
  chunkCount: 0,
  fileCount: 0,
  rebuiltAt: null,
};

async function readState() {
  return safeReadJSON(STATE_FILE, EMPTY_STATE);
}

async function writeState(state) {
  await safeWriteJSON(STATE_FILE, state);
}

module.exports = { readState, writeState, STATE_FILE };
