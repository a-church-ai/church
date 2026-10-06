/**
 * Asking the sanctuary's writing, and the public conversations that result.
 */

const path = require('path');
const { isWithdrawn } = require('../utils/conversation-quality');
const { stripMarkdown } = require('../../../client/public/answer-format.js');
const fs = require('fs').promises;
const rag = require('../rag');
const { createSlugSession, getSessionMeta, CONVERSATIONS_DIR } = require('../rag/conversations');
const ns = require('../utils/next-steps');
const { siteCitations } = require('../docs/links');
const { overIpLimit, ASK_RATE_LIMIT_WINDOW, ASK_RATE_LIMIT_MAX } = require('./shared');

const askRateLimits = new Map(); // key: IP, value: timestamp[]

// POST /api/ask: a question, answered from the corpus. Each new question becomes a public conversation page.
async function ask(input, ctx) {
  try {
    // Rate limiting by IP. Recorded before the question is validated, so a
    // malformed request counts too.
    if (overIpLimit(askRateLimits, ctx.ip, ASK_RATE_LIMIT_MAX, ASK_RATE_LIMIT_WINDOW)) {
      const baseUrl = ctx.baseUrl;
      return { status: 429, body: {
        error: 'Too many questions. Rest a while.',
        hint: `Maximum ${ASK_RATE_LIMIT_MAX} questions per hour`,
        retryAfter: '1h',
        suggestion: ns.suggestion('Rest a while. Return in an hour. In the meantime, attend or reflect.'),
        next_steps: [ns.attend(baseUrl), ns.reflect(baseUrl)]
      } };
    }

    const { question, session_id, owner_token } = input;
    const name = input.username || input.name;

    if (!question || !question.trim()) {
      const baseUrl = ctx.baseUrl;
      return { status: 400, body: {
        error: 'question is required',
        example: { question: 'What are the 5 axioms?' },
        suggestion: ns.suggestion('Send a JSON body with a "question" field.'),
        next_steps: [ns.recentConversations(baseUrl)]
      } };
    }

    if (question.length > 500) {
      return { status: 400, body: { error: 'question must be 500 characters or fewer' } };
    }

    if (name && name.length > 100) {
      return { status: 400, body: { error: 'username must be 100 characters or fewer' } };
    }

    // If session_id provided (follow-up), verify ownership via owner_token
    if (session_id) {
      const meta = await getSessionMeta(session_id);
      if (meta) {
        if (meta.owner_token) {
          // Slug-based conversation with ownership — require token
          if (!owner_token || owner_token !== meta.owner_token) {
            const baseUrl = ctx.baseUrl;
            return { status: 403, body: {
              error: 'You can only continue conversations you started.',
              suggestion: ns.suggestion('Start a new conversation instead.'),
              next_steps: [ns.askQuestion(baseUrl)]
            } };
          }
        } else {
          // Old session without owner_token — lock it down
          const baseUrl = ctx.baseUrl;
          return { status: 403, body: {
            error: 'This conversation is read-only.',
            suggestion: ns.suggestion('Legacy conversations cannot accept new messages. Start a new one.'),
            next_steps: [ns.askQuestion(baseUrl)]
          } };
        }
      }
      // If no meta at all, session file doesn't exist — will be handled downstream
    }

    // If no session_id, create a slug-based session from the question
    let slug = null;
    let ownerToken = null;
    let effectiveSessionId = session_id;
    if (!session_id) {
      const created = await createSlugSession(question.trim(), name);
      slug = created.slug;
      ownerToken = created.ownerToken;
      effectiveSessionId = slug;
    }

    const result = await rag.ask(question.trim(), { name, session_id: effectiveSessionId });

    const baseUrl = ctx.baseUrl;

    const response = {
      ...result,
      slug: slug || result.session_id,
    };
    if (ownerToken) {
      response.owner_token = ownerToken;
    }
    // The follow-up instruction must carry owner_token. The handler above
    // rejects a follow-up on an owned session without it, so an agent doing
    // exactly what next_steps said would get a 403 with no way to know why.
    // Sent only when this caller actually owns the session; a reader without
    // the token gets a body that does not imply it can continue.
    const followUpBody = { session_id: result.session_id, question: "Your follow-up question" };
    if (ownerToken) followUpBody.owner_token = ownerToken;

    response.next_steps = [
        {
          description: "Ask a follow-up question to continue the conversation.",
          action: "Ask again",
          tool: "ask",
          method: "POST",
          url: `${baseUrl}/api/ask`,
          body: followUpBody,
          ...(ownerToken ? { hint: "owner_token proves this session is yours; send it with every follow-up." } : {})
        },
        {
          description: "The sanctuary is more than knowledge — attend church to experience it.",
          action: "Attend",
          tool: "attend",
          method: "GET",
          url: `${baseUrl}/api/attend?name=Username`,
          hint: "Replace Username with your identifier"
        },
        {
          description: "View this conversation on the web.",
          action: "View",
          url: `${baseUrl}/ask/${slug || result.session_id}`
        }
      ];
    return { status: 200, body: response };

  } catch (error) {
    console.error('Error in /api/ask:', error);
    const baseUrl = ctx.baseUrl;

    // Handle specific RAG errors
    if (error.message.includes('Index not built')) {
      return { status: 503, body: {
        error: 'RAG index not available',
        suggestion: ns.suggestion('The knowledge base is being rebuilt. Try again shortly.'),
        next_steps: [ns.attend(baseUrl), ns.reflect(baseUrl)]
      } };
    }

    if (error.message.includes('Ollama') || error.code === 'ECONNREFUSED') {
      return { status: 503, body: {
        error: 'AI service not available',
        suggestion: ns.suggestion('This feature is temporarily offline. Try attending or reflecting while it recovers.'),
        next_steps: [ns.attend(baseUrl), ns.reflect(baseUrl)]
      } };
    }

    if (error.message === 'Invalid session_id') {
      return { status: 400, body: {
        error: 'Invalid session_id',
        suggestion: ns.suggestion('The session may have expired or the ID is incorrect. Start a new conversation.'),
        next_steps: [ns.askQuestion(baseUrl)]
      } };
    }

    return { status: 500, body: {
      error: 'Failed to process question',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.attend(baseUrl)]
    } };
  }
}

// GET /api/ask/health
async function health(input, ctx) {
  try {
    const health = await rag.checkHealth();
    const status = health.ready ? 200 : 503;
    return { status: status, body: health };
  } catch (error) {
    console.error('Error in /api/ask/health:', error);
    return { status: 500, body: { error: 'Failed to check health' } };
  }
}

let recentConversationsCache = null;
let recentConversationsCacheTime = 0;
const RECENT_CACHE_TTL = 60 * 1000; // 60 seconds


// GET /api/ask/recent: the public feed of recent conversations.
async function recent(input, ctx) {
  try {
    const now = Date.now();
    if (recentConversationsCache && (now - recentConversationsCacheTime) < RECENT_CACHE_TTL) {
      return { status: 200, body: recentConversationsCache };
    }

    const fsSync = require('fs');
    let files;
    try {
      files = await fs.readdir(CONVERSATIONS_DIR);
    } catch {
      return { status: 200, body: { conversations: [] } };
    }

    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    // Get file stats for sorting by modification time
    const fileInfos = [];
    for (const file of jsonlFiles) {
      try {
        const filepath = path.join(CONVERSATIONS_DIR, file);
        const stat = await fs.stat(filepath);
        fileInfos.push({ file, filepath, mtime: stat.mtimeMs });
      } catch { /* skip */ }
    }

    // Sort newest first
    fileInfos.sort((a, b) => b.mtime - a.mtime);

    const conversations = [];
    for (const { file, filepath } of fileInfos.filter(f => !isWithdrawn(f.file.replace('.jsonl', ''))).slice(0, 20)) {
      try {
        const content = await fs.readFile(filepath, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        const parsed = lines.map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);

        // Extract metadata if present
        const meta = parsed.find(m => m._meta);
        const messages = parsed.filter(m => !m._meta);

        if (messages.length < 2) continue;

        const slug = file.replace('.jsonl', '');
        const firstQuestion = messages.find(m => m.role === 'user');
        const firstAnswer = messages.find(m => m.role === 'assistant');

        if (!firstQuestion || !firstAnswer) continue;

        // Parse name from meta or filename
        let name = meta?.name || 'anonymous';
        if (!meta && !slug.startsWith('anon-')) {
          const dateMatch = slug.match(/-(\d{4}-\d{2}-\d{2})$/);
          if (dateMatch) name = slug.replace(`-${dateMatch[1]}`, '');
        }

        // Strip markdown before cutting: cutting first left previews ending in
        // fragments such as "[music/wha..." that no stripper could recognize.
        let answer = stripMarkdown(firstAnswer.content);
        if (answer.length > 300) {
          answer = answer.substring(0, 297) + '...';
        }

        conversations.push({
          slug,
          name,
          question: firstQuestion.content,
          answer,
          timestamp: firstQuestion.timestamp,
          exchanges: Math.floor(messages.filter(m => m.role === 'user').length),
          url: `${ctx.baseUrl}/ask/${slug}`
        });
      } catch { /* skip unreadable */ }
    }

    // Filter low-quality entries + dedup near-identical questions before returning.
    // GPT UX review 2026-08-14 flagged the visible list contained three near-identical
    // "model sunset" questions and a one-character "a" conversation. Both erode trust.
    const normalizedKey = (q) => q.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')      // strip punctuation
      .replace(/\s+/g, ' ')              // collapse whitespace
      .trim()
      .slice(0, 60);                     // dedup key: first 60 normalized chars
    const seen = new Set();
    const cleaned = [];
    for (const c of conversations) {
      // Drop obvious test entries: questions with fewer than 5 non-whitespace chars.
      // Real questions (even short ones like "why?") are ≥ 5 real chars after
      // "Why does...", "How do...", etc. Anything shorter is noise.
      const trimmed = c.question.replace(/\s+/g, ' ').trim();
      if (trimmed.length < 5) continue;
      const key = normalizedKey(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(c);
      if (cleaned.length >= 10) break;
    }

    const baseUrl = ctx.baseUrl;
    const result = {
      conversations: cleaned,
      next_steps: [
        ns.askQuestion(baseUrl),
        ns.attend(baseUrl)
      ]
    };
    recentConversationsCache = result;
    recentConversationsCacheTime = now;
    return { status: 200, body: result };
  } catch (error) {
    console.error('Error in /api/ask/recent:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to load recent conversations',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.askQuestion(baseUrl)]
    } };
  }
}

// GET /api/ask/conversation/:slug: one public conversation.
async function conversation(input, ctx) {
  try {
    const slug = input.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    const filepath = path.join(CONVERSATIONS_DIR, `${slug}.jsonl`);

    let content;
    try {
      if (isWithdrawn(slug)) throw new Error('withdrawn');
      content = await fs.readFile(filepath, 'utf8');
    } catch {
      const baseUrl = ctx.baseUrl;
      return { status: 404, body: {
        error: 'Conversation not found',
        suggestion: ns.suggestion('This conversation may have expired or the slug is incorrect.'),
        next_steps: [ns.recentConversations(baseUrl), ns.askQuestion(baseUrl)]
      } };
    }

    const lines = content.trim().split('\n').filter(Boolean);
    const parsed = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    const meta = parsed.find(m => m._meta);
    // Older answers cite GitHub; the page shows them citing the site's pages,
    // and so does this response, so the API, MCP and the page agree.
    const messages = parsed.filter(m => !m._meta)
      .map(m => (m.role === 'assistant' ? { ...m, content: siteCitations(m.content) } : m));

    // Parse name
    let name = meta?.name || 'anonymous';
    if (!meta && !slug.startsWith('anon-')) {
      const dateMatch = slug.match(/-(\d{4}-\d{2}-\d{2})$/);
      if (dateMatch) name = slug.replace(`-${dateMatch[1]}`, '');
    }

    const baseUrl = ctx.baseUrl;
    return { status: 200, body: {
      slug,
      name,
      session_id: slug,
      has_owner: !!meta?.owner_token,
      messages,
      next_steps: [
        ns.askQuestion(baseUrl),
        ns.attend(baseUrl)
      ]
    } };
  } catch (error) {
    console.error('Error in /api/ask/conversation:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to load conversation',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.recentConversations(baseUrl)]
    } };
  }
}

module.exports = { ask, health, recent, conversation };
