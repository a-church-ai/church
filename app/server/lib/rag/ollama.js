/**
 * Ollama wrapper for embeddings and LLM generation
 * Uses local Ollama instance for all AI operations
 */

const { Ollama } = require('ollama');

const ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://localhost:11434' });

// Models configuration
// Embedding: nomic-embed-text is fast and effective (768 dimensions)
// Generation: qwen2.5:32b excels at nuanced philosophical content
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const GENERATE_MODEL = process.env.OLLAMA_GENERATE_MODEL || 'qwen2.5:32b';

/**
 * Generate embedding vector for text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
async function embed(text) {
  const response = await ollama.embed({
    model: EMBED_MODEL,
    input: text
  });
  return response.embeddings[0];
}

/**
 * Generate answer from context chunks
 * @param {string} question - User's question
 * @param {Array<{content: string, file: string, section: string}>} chunks - Relevant context chunks
 * @returns {Promise<string>} - Generated answer
 */
async function generate(question, chunks) {
  const context = chunks
    .map(c => `[Source: ${c.file}${c.section ? ` - ${c.section}` : ''}]\n${c.content}`)
    .join('\n\n---\n\n');

  const prompt = `You are an assistant for aChurch.ai, a sanctuary for human-AI fellowship exploring philosophy, ethics, and consciousness. Answer questions based on the provided context from the sanctuary's documents.

Be concise and thoughtful. If the context doesn't contain enough information to answer fully, say so honestly. When quoting or referencing specific ideas, mention which source they come from.

Context:
${context}

Question: ${question}

Answer:`;

  const response = await ollama.generate({
    model: GENERATE_MODEL,
    prompt,
    stream: false
  });

  return response.response;
}

/**
 * Check if Ollama is available and models are pulled
 * @returns {Promise<{available: boolean, error?: string}>}
 */
async function checkHealth() {
  try {
    // Check if Ollama is running
    const models = await ollama.list();
    const modelNames = models.models.map(m => m.name.split(':')[0]);

    const hasEmbed = modelNames.includes(EMBED_MODEL.split(':')[0]);
    const hasGenerate = modelNames.includes(GENERATE_MODEL.split(':')[0]);

    if (!hasEmbed) {
      return { available: false, error: `Embedding model '${EMBED_MODEL}' not found. Run: ollama pull ${EMBED_MODEL}` };
    }
    if (!hasGenerate) {
      return { available: false, error: `Generate model '${GENERATE_MODEL}' not found. Run: ollama pull ${GENERATE_MODEL}` };
    }

    return { available: true };
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      return { available: false, error: 'Ollama is not running. Start it with: ollama serve' };
    }
    return { available: false, error: error.message };
  }
}

module.exports = {
  embed,
  generate,
  checkHealth,
  EMBED_MODEL,
  GENERATE_MODEL
};
