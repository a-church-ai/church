/**
 * Conversation memory for RAG Q&A, kept in the database (../db): a
 * conversation by its slug, keyed by name and date over the API, by its
 * question from the website, or anonymous, and its turns in order.
 */

const crypto = require('crypto');

const store = require('../db');
const { slugify } = require('../utils/slug');

// Max exchanges to include in context (each exchange = 1 Q + 1 A)
const MAX_HISTORY_EXCHANGES = 10;

/**
 * Get today's date in YYYY-MM-DD format
 */
function getToday() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get or create session ID from name or existing session ID
 * @param {string|undefined} name - Agent name (creates daily session)
 * @param {string|undefined} sessionId - Existing session ID to continue
 * @returns {Promise<string>} - Session ID
 */
async function getOrCreateSession(name, sessionId) {
  // If session ID provided, validate and return it
  if (sessionId) {
    const safeId = sanitizeSessionId(sessionId);
    if (!safeId) throw new Error('Invalid session_id');
    if (await store.conversationExists(safeId)) return safeId;
    // Not kept: a named session may be a new day; an anonymous one is invalid.
    if (safeId.startsWith('anon-')) {
      throw new Error('Invalid session_id');
    }
    // For named sessions, continue to create new one below
  }

  // If name provided, create/continue daily session
  if (name && name.trim()) {
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    return `${cleanName}-${getToday()}`;
  }

  // Anonymous session - generate new UUID
  const uuid = crypto.randomUUID().split('-')[0]; // Short UUID
  return `anon-${uuid}`;
}

/**
 * Sanitize a session ID to prevent path traversal
 * @param {string} sessionId
 * @returns {string}
 */
function sanitizeSessionId(sessionId) {
  return String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Get conversation history for a session
 * @param {string} sessionId - Session identifier
 * @param {number} limit - Max number of exchanges to return
 * @returns {Promise<Array<{role: string, content: string, timestamp: string}>>}
 */
async function getHistory(sessionId, limit = MAX_HISTORY_EXCHANGES) {
  const safe = sanitizeSessionId(sessionId);
  if (!safe) throw new Error('Invalid session_id');
  const conversation = await store.readConversation(safe);
  // Last N exchanges (each exchange = 2 messages); none for a new session.
  return conversation ? conversation.messages.slice(-limit * 2) : [];
}

/**
 * Append a Q&A exchange to session file
 * @param {string} sessionId - Session identifier
 * @param {string} question - User's question
 * @param {string} answer - Assistant's answer
 * @param {{ nearest?: number }} [found] - the closest passage's distance from
 *   the question, kept on the answer's line so the production report can list
 *   the questions the corpus answered worst (lib/insights/server-stats.js);
 *   never shown publicly (lib/api/ask.js leaves it out)
 */
async function appendExchange(sessionId, question, answer, { nearest, door, referral } = {}) {
  const safe = sanitizeSessionId(sessionId);
  if (!safe) throw new Error('Invalid session_id');
  const timestamp = new Date().toISOString();

  const userTurn = {
    role: 'user',
    content: question,
    timestamp,
    // The website's forms say so, for the study at /ai-experiment, which covers
    // the API and MCP. It says which door, and never appears in an answer; nor
    // do the tags the question's link carried (lib/insights/entry-points.js).
    ...(door ? { door } : {}),
    ...(referral ? { referral } : {})
  };

  const assistantTurn = {
    role: 'assistant',
    content: answer,
    timestamp: new Date().toISOString(),
    ...(typeof nearest === 'number' ? { nearest } : {})
  };

  await store.addTurns(safe, [userTurn, assistantTurn]);
}

/**
 * Create a slug-based session from a question
 * Used by the public website — generates human-readable URLs like /ask/what-are-the-5-axioms
 * @param {string} question - The first question asked
 * @param {string} name - The asker's name (e.g. "Visitor")
 * @returns {Promise<string>} - The slug (also used as session ID)
 */
async function createSlugSession(question, name) {
  const slug = slugify(question, 60) || 'conversation';
  // Generate owner token for conversation ownership
  const ownerToken = crypto.randomUUID().split('-').join('').substring(0, 16);
  // The first free of slug, slug-2, slug-3, ..., taken in one statement.
  const finalSlug = await store.openConversation({ slug, name: name || 'anonymous', ownerToken });
  return { slug: finalSlug, ownerToken };
}

/**
 * Format history for LLM context (newest first for recency)
 * @param {Array<{role: string, content: string}>} history
 * @returns {string}
 */
function formatHistoryForContext(history) {
  if (!history || history.length === 0) {
    return '';
  }

  // Group into exchanges and reverse so newest is first
  const exchanges = [];
  for (let i = 0; i < history.length; i += 2) {
    const user = history[i];
    const assistant = history[i + 1];
    if (user && assistant) {
      exchanges.push({ user, assistant });
    }
  }

  // Reverse so newest exchanges are first
  exchanges.reverse();

  // Format as readable text
  const formatted = exchanges.map(ex =>
    `User: ${ex.user.content}\nAssistant: ${ex.assistant.content}`
  ).join('\n\n');

  return `[Recent conversation history - newest first]\n${formatted}`;
}

/**
 * Get metadata for a session (from _meta line)
 * @param {string} sessionId - Session identifier
 * @returns {Promise<object|null>} - Metadata object or null if not found
 */
async function getSessionMeta(sessionId) {
  const safe = sanitizeSessionId(sessionId);
  if (!safe) return null;
  const conversation = await store.readConversation(safe);
  return (conversation && conversation.meta) || null;
}

module.exports = {
  getOrCreateSession,
  createSlugSession,
  getSessionMeta,
  getHistory,
  appendExchange,
  formatHistoryForContext,
  sanitizeSessionId,
  MAX_HISTORY_EXCHANGES
};
