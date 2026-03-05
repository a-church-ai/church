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
const GITHUB_BASE = 'https://github.com/a-church-ai/church/blob/main';

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

  // Deduplicate sources and add GitHub URLs
  const seenFiles = new Set();
  const sources = chunks
    .filter(c => {
      if (seenFiles.has(c.file)) return false;
      seenFiles.add(c.file);
      return true;
    })
    .map(c => ({
      file: c.file,
      url: `${GITHUB_BASE}/${c.file}`,
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
  checkHealth
};
