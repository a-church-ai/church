/**
 * RAG (Retrieval-Augmented Generation) orchestrator
 * Combines LanceDB vector search with Gemini LLM
 */

const gemini = require('./gemini');
const lancedb = require('./lancedb');
const conversations = require('./conversations');

// Number of chunks to retrieve for context
const TOP_K = process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K) : 5;

// GitHub base URL for source links
const { pageUrlForFile } = require('../docs/links');

/**
 * Ask a question about the sanctuary's content
 * @param {string} question - User's question
 * @param {Object} [options] - Options for the request
 * @param {string} [options.name] - Agent name (creates daily session)
 * @param {string} [options.session_id] - Existing session ID to continue
 * @returns {Promise<{answer: string, sources: Array<{file: string, section: string}>, model: string, session_id: string}>}
 */
async function ask(question, options = {}) {
  if (!question || !question.trim()) {
    throw new Error('Question is required');
  }

  // Check if index exists
  const indexStatus = await lancedb.checkIndex();
  if (!indexStatus.exists || indexStatus.count === 0) {
    throw new Error('Index not built. Run: node app/scripts/index-content.js');
  }

  // Get or create session
  const sessionId = await conversations.getOrCreateSession(options.name, options.session_id);

  // Load conversation history
  const history = await conversations.getHistory(sessionId);
  const formattedHistory = conversations.formatHistoryForContext(history);

  // Generate embedding for the question
  const embedding = await gemini.embed(question);

  // Search for relevant chunks
  const chunks = await lancedb.search(embedding, TOP_K);

  if (chunks.length === 0) {
    const noResultAnswer = "I couldn't find relevant information to answer that question. The sanctuary's wisdom may not cover this topic yet.";

    // Still save the exchange for continuity
    await conversations.appendExchange(sessionId, question, noResultAnswer);

    return {
      answer: noResultAnswer,
      sources: [],
      model: gemini.GENERATE_MODEL,
      session_id: sessionId
    };
  }

  // Generate answer from chunks (with history)
  const answer = await gemini.generate(question, chunks, formattedHistory);

  // Save the exchange
  await conversations.appendExchange(sessionId, question, answer);

  // One source per document, each pointing at its page on the site
  const sources = bestPerFile(chunks)
    .map(c => ({
      file: c.file,
      url: pageUrlForFile(c.file),
      section: c.section
    }));

  return {
    answer,
    sources,
    model: gemini.GENERATE_MODEL,
    session_id: sessionId
  };
}

/**
 * Each document's best passage, in the order given (search returns the
 * nearest first, so the first passage seen from a document is its best).
 * Ask's sources and search's results both collapse passages to documents this
 * way. keyOf says what counts as one document: a file for Ask's citations, a
 * page for search, where a song's lyrics and its context are one page.
 */
function bestPerFile(chunks, keyOf = c => c.file) {
  const seen = new Set();
  return chunks.filter(c => {
    const key = keyOf(c);
    return !seen.has(key) && seen.add(key);
  });
}

/**
 * The documents whose passages are closest in meaning to a query, each with
 * its best passage, nearest first. Nothing is generated or stored. Asks the
 * index for several passages per document wanted, so one long document's
 * many passages do not crowd out the rest. Documents are pages: a song's
 * lyrics and context are one result.
 * @param {string} query
 * @param {number} documents - how many documents to return
 * @returns {Promise<Array<{content: string, file: string, section: string, _distance: number}>>}
 */
async function search(query, documents) {
  const indexStatus = await lancedb.checkIndex();
  if (!indexStatus.exists || indexStatus.count === 0) {
    throw new Error('Index not built. Run: node app/scripts/index-content.js');
  }
  const chunks = await lancedb.search(await gemini.embed(query), Math.min(documents * 4, 80));
  // A rebuild swaps the table out for a moment, and a search in that moment
  // finds no table and returns nothing. Nothing from a table that exists is
  // a real "nothing close"; nothing from one that has just gone is not.
  if (chunks.length === 0) {
    const again = await lancedb.checkIndex();
    if (!again.exists || again.count === 0) throw new Error('Index not built (rebuilding)');
  }
  return bestPerFile(chunks, c => pageUrlForFile(c.file)).slice(0, documents);
}

/**
 * Check RAG system health
 * @returns {Promise<{ready: boolean, gemini: object, index: object}>}
 */
async function checkHealth() {
  const geminiHealth = await gemini.checkHealth();
  const indexStatus = await lancedb.checkIndex();

  return {
    ready: geminiHealth.available && indexStatus.exists && indexStatus.count > 0,
    gemini: geminiHealth,
    index: indexStatus
  };
}

module.exports = {
  ask,
  search,
  bestPerFile,
  checkHealth
};
