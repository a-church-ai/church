/**
 * Which public conversations are shown, and which are indexed.
 *
 * Every question asked becomes a page, so the corpus collects pages nobody
 * should find through a search engine: numbered duplicates, test artifacts,
 * questions the writing cannot answer, and, rarely, one that should not be
 * public at all. One module decides, so the page, its API, the recent lists,
 * related links, the sitemap and the share image cannot disagree.
 */

const crypto = require('crypto');
const { sha256: WITHDRAWN_HASHES } = require('./withdrawn-conversations.json');

const WITHDRAWN = new Set(WITHDRAWN_HASHES);

// The key that withdraws a conversation: its slug's SHA-256, the form
// withdrawn-conversations.json keeps, so the public list does not republish
// what it withdraws. The admin dashboard shows it beside each conversation.
function withdrawKey(slug) {
  return crypto.createHash('sha256').update(String(slug)).digest('hex');
}

// Withdrawn: answered as if it did not exist, everywhere.
function isWithdrawn(slug) {
  return WITHDRAWN.has(withdrawKey(slug));
}

// Slugs that are duplicates or artifacts. They stay reachable but noindexed,
// so search engines keep one canonical page per question.
function isLowValueSlug(slug) {
  if (/^(ai|aiai|test|context|conversation|is-this-endpoint-working|memorymd-my-lifemd)$/i.test(slug)) return true;
  if (/^(anon-|testagent|devuser|openclaw)/i.test(slug)) return true;
  if (!slug.includes('-')) return true;   // real questions are multi-word / hyphenated
  if (/-\d+$/.test(slug)) return true;     // numbered duplicate of a canonical question
  return false;
}

// An answer that opens by saying the writing does not cover the question:
// "The provided sanctuary documents do not contain information on...". Such
// a page is honest, and useless to anyone arriving from a search engine.
const NOT_COVERED = /^\W*(the\s+)?(provided\s+)?(sanctuary(['’]s)?\s+)?(documents?|texts?|writings?|context)\s+(provided\s+)?(do|does)\s*(not|n['’]t)\s+(contain|provide|address|cover|include|mention|discuss|detail|describe|specify)|couldn['’]t find relevant information/i;

function isThinAnswer(messages) {
  const answer = (messages || []).find(m => m.role === 'assistant');
  return !answer || NOT_COVERED.test(String(answer.content || '').slice(0, 300));
}

// Indexable: worth a search engine's attention and a place in the sitemap.
function isIndexable(slug, messages) {
  return !isWithdrawn(slug) && !isLowValueSlug(slug) && !isThinAnswer(messages);
}

module.exports = { withdrawKey, isWithdrawn, isLowValueSlug, isThinAnswer, isIndexable };
