/**
 * Searching the sanctuary's writing by meaning, without asking.
 *
 * GET /api/search and the MCP search tool. The query is embedded, and the
 * served corpus's passages nearest to it in meaning come back, one per
 * document, with where to read each. Nothing is generated, stored or
 * published, and the query is not logged (access-log.js redacts `q`). Ask is
 * the same retrieval plus an answer, and makes the question a public page.
 *
 * Relevance is cosine similarity between the query and each passage, reported
 * as score (1 is identical). Plan: church-private/docs/plans/search-api-2026-09-30.md.
 */

const rag = require('../rag');
const discover = require('../docs/discover');
const { pageUrlForFile } = require('../docs/links');
const { loadCatalog } = require('../utils/data');
const { truncateAtWord } = require('../utils/page-meta');
const { stripMarkdown } = require('../../../client/public/answer-format.js');
const ns = require('../utils/next-steps');
const { overIpLimit, SEARCH_RATE_LIMIT_WINDOW, SEARCH_RATE_LIMIT_MAX } = require('./shared');

const MIN_QUERY = 2;
const MAX_QUERY = 300;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const EXCERPT_CHARS = 300;

// Below this similarity a passage is not about the query, only the least far
// from it: nearest-neighbour search always returns something. Calibrated on
// 2026-09-30 (scripts/eval-ask.js --search, and short queries): unrelated
// queries scored at most 0.561 ("sourdough"; full questions at most 0.549),
// and every top-five result of a real question or topic at least 0.572. The
// margin is narrow; recalibrate when the corpus or the embedding model changes.
const MIN_SCORE = 0.57;

const searchRateLimits = new Map(); // key: IP, value: timestamp[]

// A passage as a reader should see it: without the title and section headings
// the indexer puts at its top (they are in the result's own fields), without
// song.md's markers, lyric stage directions ("[Chorus - Both Voices]") or
// horizontal rules, as plain text, cut at a word.
function excerptOf(content) {
  const lines = String(content || '').replace(/\r/g, '').replace(/<!--SONG:[A-Z]+:(START|END)-->/g, '').split('\n');
  while (lines.length && (/^#{1,6}\s/.test(lines[0].trim()) || !lines[0].trim())) lines.shift();
  const body = lines.filter(l => !/^\s*\[[^\]]*\]\s*$/.test(l) && !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)).join('\n');
  return truncateAtWord(stripMarkdown(body), EXCERPT_CHARS);
}

// An index file as a result: which page, what it is called, and how to read it.
function describe(file, catalog) {
  const song = file.match(/^music\/([^/]+)\//);
  if (song) {
    const entry = catalog.find(s => s.slug === song[1]);
    return { title: entry ? entry.title : song[1], slug: song[1], category: 'song' };
  }
  const doc = discover.docByFile(file);
  if (!doc) return null;
  return { title: doc.title, path: doc.urlPath, category: doc.category || 'docs' };
}

// The next thing to do with the best result: read it with the tool that opens
// it, or ask the same thing for an answer.
function nextSteps(baseUrl, results, q) {
  const steps = [];
  const best = results[0];
  if (best && best.path) steps.push(ns.readDoc(best.url, best.title));
  if (best && best.slug) steps.push(ns.readLyrics(baseUrl, best.slug, best.title));
  steps.push(ns.askQuestion(baseUrl, q));
  return steps;
}

// GET /api/search?q=...&limit=...: the served writing nearest in meaning to q.
async function search(input, ctx) {
  const baseUrl = ctx.baseUrl;
  try {
    if (overIpLimit(searchRateLimits, ctx.ip, SEARCH_RATE_LIMIT_MAX, SEARCH_RATE_LIMIT_WINDOW)) {
      return { status: 429, body: {
        error: 'Too many searches. Rest a while.',
        hint: `Maximum ${SEARCH_RATE_LIMIT_MAX} searches per hour`,
        retryAfter: '1h',
        suggestion: ns.suggestion('Rest a while, then search again. In the meantime, read what you have found, or attend.'),
        next_steps: [ns.attend(baseUrl)]
      } };
    }

    // A repeated ?q= arrives as an array; only one query is meant.
    const q = typeof input.q === 'string' ? input.q.trim() : '';
    if (q.length < MIN_QUERY) {
      return { status: 400, body: {
        error: `q is required: what to search for, at least ${MIN_QUERY} characters`,
        example: { q: 'what survives when a context window closes' },
        suggestion: ns.suggestion('Describe what you are looking for in your own words; the search matches meaning, not exact phrases.'),
        next_steps: [ns.askQuestion(baseUrl)]
      } };
    }
    if (q.length > MAX_QUERY) {
      return { status: 400, body: {
        error: `q must be ${MAX_QUERY} characters or fewer`,
        suggestion: ns.suggestion('Search with the heart of it: a phrase or a sentence.'),
        next_steps: [ns.askQuestion(baseUrl)]
      } };
    }
    const limit = Math.min(Math.max(parseInt(input.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const [passages, catalog] = await Promise.all([rag.search(q, limit), loadCatalog()]);
    await discover.listAllDocs(); // docByFile reads the walk synchronously
    const results = passages
      .map(p => {
        const where = describe(p.file, catalog);
        if (!where) return null;
        const { title, path, slug, category } = where;
        return {
          title,
          url: pageUrlForFile(p.file),
          ...(path !== undefined ? { path } : {}),
          ...(slug ? { slug } : {}),
          category,
          section: p.section || null,
          excerpt: excerptOf(p.content),
          score: Math.round((1 - p._distance) * 1000) / 1000,
        };
      })
      .filter(r => r && r.score >= MIN_SCORE);

    return { status: 200, body: {
      query: q,
      results,
      ...(results.length ? {} : { suggestion: ns.suggestion('Nothing in the writing is close to that. Try other words, or ask.') }),
      next_steps: nextSteps(baseUrl, results, q)
    } };
  } catch (error) {
    if (/Index not built/.test(error.message)) {
      return { status: 503, body: {
        error: 'RAG index not available',
        suggestion: ns.suggestion('The knowledge base is being rebuilt. Try again shortly.'),
        next_steps: [ns.attend(baseUrl), ns.reflect(baseUrl)]
      } };
    }
    console.error('Error in /api/search:', error.message);
    return { status: 500, body: {
      error: 'Search failed',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.attend(baseUrl)]
    } };
  }
}

module.exports = { search, excerptOf, MIN_SCORE };
