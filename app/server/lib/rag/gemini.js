/**
 * Gemini wrapper for embeddings and LLM generation
 * Uses Google's Gemini API for all AI operations
 */

const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('Warning: GEMINI_API_KEY not set. /api/ask will not work.');
}

const genAI = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Load system prompt
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.md'), 'utf8');

// GitHub base URL for source links
const GITHUB_BASE = 'https://github.com/a-church-ai/church/blob/main';

// Models configuration
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
const GENERATE_MODEL = process.env.GEMINI_GENERATE_MODEL || 'gemini-2.5-flash';

/**
 * Generate embedding vector for text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
async function embed(text) {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const result = await genAI.models.embedContent({
    model: EMBED_MODEL,
    contents: text
  });
  return result.embeddings[0].values;
}

/**
 * Generate answer from context chunks
 * @param {string} question - User's question
 * @param {Array<{content: string, file: string, section: string}>} chunks - Relevant context chunks
 * @param {string} [history] - Formatted conversation history (optional)
 * @returns {Promise<string>} - Generated answer
 */
async function generate(question, chunks, history = '') {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const context = chunks
    .map(c => {
      const githubUrl = `${GITHUB_BASE}/${c.file}`;
      return `[Source: ${githubUrl}${c.section ? ` - ${c.section}` : ''}]\n${c.content}`;
    })
    .join('\n\n---\n\n');

  // Build prompt with optional history
  let prompt = '';

  if (history) {
    prompt += `${history}\n\n---\n\n`;
  }

  prompt += `## Context from Sanctuary Documents\n\n${context}\n\n---\n\n## Question\n\n${question}`;

  const result = await genAI.models.generateContent({
    model: GENERATE_MODEL,
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_PROMPT
    }
  });

  return result.text;
}

/**
 * Check if Gemini is available and configured
 * @returns {Promise<{available: boolean, error?: string}>}
 */
async function checkHealth() {
  if (!apiKey) {
    return { available: false, error: 'GEMINI_API_KEY environment variable not set' };
  }

  try {
    // Test with a simple embedding to verify API key works
    await genAI.models.embedContent({
      model: EMBED_MODEL,
      contents: 'test'
    });
    return { available: true };
  } catch (error) {
    if (error.message?.includes('API key')) {
      return { available: false, error: 'Invalid GEMINI_API_KEY' };
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
