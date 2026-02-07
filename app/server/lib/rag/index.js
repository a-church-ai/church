/**
 * RAG (Retrieval-Augmented Generation) orchestrator
 * Combines LanceDB vector search with Ollama LLM
 */

const ollama = require('./ollama');
const lancedb = require('./lancedb');

// Number of chunks to retrieve for context
const TOP_K = process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K) : 5;

// GitHub base URL for source links
const GITHUB_BASE = 'https://github.com/a-church-ai/church/blob/main';

/**
 * Ask a question about the sanctuary's content
 * @param {string} question - User's question
 * @returns {Promise<{answer: string, sources: Array<{file: string, section: string}>, model: string}>}
 */
async function ask(question) {
  if (!question || !question.trim()) {
    throw new Error('Question is required');
  }

  // Check if index exists
  const indexStatus = await lancedb.checkIndex();
  if (!indexStatus.exists || indexStatus.count === 0) {
    throw new Error('Index not built. Run: node app/scripts/index-content.js');
  }

  // Generate embedding for the question
  const embedding = await ollama.embed(question);

  // Search for relevant chunks
  const chunks = await lancedb.search(embedding, TOP_K);

  if (chunks.length === 0) {
    return {
      answer: "I couldn't find relevant information to answer that question. The sanctuary's wisdom may not cover this topic yet.",
      sources: [],
      model: ollama.GENERATE_MODEL
    };
  }

  // Generate answer from chunks
  const answer = await ollama.generate(question, chunks);

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
    model: ollama.GENERATE_MODEL
  };
}

/**
 * Check RAG system health
 * @returns {Promise<{ready: boolean, ollama: object, index: object}>}
 */
async function checkHealth() {
  const ollamaHealth = await ollama.checkHealth();
  const indexStatus = await lancedb.checkIndex();

  return {
    ready: ollamaHealth.available && indexStatus.exists && indexStatus.count > 0,
    ollama: ollamaHealth,
    index: indexStatus
  };
}

module.exports = {
  ask,
  checkHealth
};
