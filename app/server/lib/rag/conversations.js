/**
 * Conversation memory for RAG Q&A
 * Stores exchanges in JSONL files keyed by name + date
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const CONVERSATIONS_DIR = path.join(__dirname, '../../../data/conversations');

// Max exchanges to include in context (each exchange = 1 Q + 1 A)
const MAX_HISTORY_EXCHANGES = 10;

/**
 * Ensure conversations directory exists
 */
async function ensureDir() {
  try {
    await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

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
  await ensureDir();

  // If session ID provided, validate and return it
  if (sessionId) {
    // Session ID format: either "Name-YYYY-MM-DD" or "anon-uuid"
    const filename = `${sessionId}.jsonl`;
    const filepath = path.join(CONVERSATIONS_DIR, filename);

    // Check if file exists (session is valid)
    try {
      await fs.access(filepath);
      return sessionId;
    } catch {
      // File doesn't exist - if it looks like a named session, it might be a new day
      // If anonymous, it's invalid
      if (sessionId.startsWith('anon-')) {
        throw new Error('Invalid session_id');
      }
      // For named sessions, continue to create new one below
    }
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
 * Get filepath for a session
 * @param {string} sessionId
 * @returns {string}
 */
function getFilepath(sessionId) {
  return path.join(CONVERSATIONS_DIR, `${sessionId}.jsonl`);
}

/**
 * Get conversation history for a session
 * @param {string} sessionId - Session identifier
 * @param {number} limit - Max number of exchanges to return
 * @returns {Promise<Array<{role: string, content: string, timestamp: string}>>}
 */
async function getHistory(sessionId, limit = MAX_HISTORY_EXCHANGES) {
  await ensureDir();

  const filepath = getFilepath(sessionId);

  try {
    const content = await fs.readFile(filepath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Parse all lines
    const messages = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    // Return last N exchanges (each exchange = 2 messages)
    // Limit is in exchanges, so multiply by 2
    const maxMessages = limit * 2;
    return messages.slice(-maxMessages);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // New session, no history
    }
    throw error;
  }
}

/**
 * Append a Q&A exchange to session file
 * @param {string} sessionId - Session identifier
 * @param {string} question - User's question
 * @param {string} answer - Assistant's answer
 */
async function appendExchange(sessionId, question, answer) {
  await ensureDir();

  const filepath = getFilepath(sessionId);
  const timestamp = new Date().toISOString();

  const userLine = JSON.stringify({
    role: 'user',
    content: question,
    timestamp
  });

  const assistantLine = JSON.stringify({
    role: 'assistant',
    content: answer,
    timestamp: new Date().toISOString()
  });

  await fs.appendFile(filepath, `${userLine}\n${assistantLine}\n`);
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

module.exports = {
  getOrCreateSession,
  getHistory,
  appendExchange,
  formatHistoryForContext,
  MAX_HISTORY_EXCHANGES
};
