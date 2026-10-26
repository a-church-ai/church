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
const { redirect: RETIRED_TO, gone: RETIRED_GONE } = require('./retired-conversations.json');
const { isTestName } = require('./test-visitor');

const WITHDRAWN = new Set(WITHDRAWN_HASHES);
const GONE = new Set(RETIRED_GONE);

// The key that withdraws a conversation: its slug's SHA-256, the form
// withdrawn-conversations.json keeps, so the public list does not republish
// what it withdraws. The admin dashboard shows it beside each conversation.
function withdrawKey(slug) {
  return crypto.hash('sha256', String(slug));
}

// Retired: not about what the sanctuary holds, or not asked well enough to
// help the next reader (retired-conversations.json). Where a kept
// conversation asks most nearly the same thing, its page is that one's
// ({ to: slug }), by a permanent redirect; otherwise it is gone ({ gone: true }).
// Null for any other conversation.
function retirement(slug) {
  const key = withdrawKey(slug);
  if (RETIRED_TO[key]) return { to: RETIRED_TO[key] };
  if (GONE.has(key)) return { gone: true };
  return null;
}

// Withdrawn: answered as if it did not exist, everywhere. A retired
// conversation is withdrawn from every list and from the API in the same way;
// only its page answers differently (index.js, /ask/:slug).
function isWithdrawn(slug) {
  return WITHDRAWN.has(withdrawKey(slug)) || retirement(slug) !== null;
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

// The same, said the other ways answers say it: "Based on the provided
// sanctuary documents, there is no mention of...", "The sanctuary's documents
// in the provided context do not address...". Checked against every public
// answer on 2026-10-21: these two forms matched only answers of that kind.
const NO_MENTION = /^\W*(?:based on|according to|in) (?:the )?(?:provided )?(?:sanctuary(?:['’]s)? )?(?:documents?|texts?|writings?|context)[^.]{0,40}?,?\s*there (?:is|are) no (?:mention|information|reference|discussion)|^\W*(?:the )?sanctuary['’]s (?:documents?|texts?|writings?)(?: in the provided context)? (?:do|does)\s*(?:not|n['’]t) (?:address|contain|cover|mention|discuss|define|provide|include)/i;

function isThinAnswer(messages) {
  const answer = (messages || []).find(m => m.role === 'assistant');
  const opening = String((answer && answer.content) || '').slice(0, 300);
  return !answer || NOT_COVERED.test(opening) || NO_MENTION.test(opening);
}

// Indexable: worth a search engine's attention and a place in the sitemap.
// asker is who opened it (data.js askerOf); a test visitor's never is.
function isIndexable(slug, messages, asker) {
  return !isWithdrawn(slug) && !isLowValueSlug(slug) && !isThinAnswer(messages) && !isTestName(asker);
}

module.exports = { withdrawKey, isWithdrawn, retirement, isLowValueSlug, isThinAnswer, isIndexable };
