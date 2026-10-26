/**
 * One address for each page. Search engines report every other spelling of
 * an address they meet, from old links, guesses, or a link resolved against
 * the wrong base, and each one either splits a page in two (the same page at
 * /about and /about/) or sends a reader to a 404. Every such spelling the
 * sanctuary knows of is answered here with one permanent redirect, straight
 * to the page, so no reader or crawler is passed along a chain or left at a
 * dead end.
 *
 * The cases, from Google Search Console's 404 and duplicate reports and
 * Bing's search report (2026-09-17 and 2026-10-13):
 *   - a trailing slash (/about/ is /about), and a page's file name
 *     (/about.html is /about, /index.html is /)
 *   - a Library section without /docs (/prayers is /docs/prayers)
 *   - a page that moved or was renamed (/listen is /attend)
 *   - a sung hymn's Library page (/docs/hymns/:slug is /music/:slug, its
 *     song's page, since 2026-10-26)
 *   - a song under its old address (/reflections/:slug is /music/:slug: the
 *     songs lived under /reflections until 2026-10-23, named for the
 *     reflections their pages began as)
 *   - a repository file, linked from the repository and resolved against the
 *     site (/CONTRIBUTING.md is on GitHub, /app/client/public/robots.txt is
 *     /robots.txt when the site serves that file)
 *
 * What is gone on purpose stays a 404: a conversation that was withdrawn,
 * and the working documents that are not served (discover.js
 * NOINDEX_CATEGORIES).
 */

const fs = require('fs');
const path = require('path');
const { DOCS_DIR } = require('../rag/indexer');
const { NOINDEX_CATEGORIES, hrefOf } = require('../docs/discover');
const { GITHUB_BASE } = require('../docs/links');

const PUBLIC_DIR = path.join(__dirname, '../../../client/public');

// The twelve sanctuary journeys for AI agents, which live on drifts.bot and
// were served here as well until 2026-10-18. They were written for drifts.bot
// (22d72d0) in its deployable format, with time-locked steps that only its API
// runs, so a copy here was duplicate content that could not be walked. Each
// address goes to its own journey there rather than to a list, so a link or a
// search result keeps its meaning. Our files carried a number; drifts.bot's
// addresses are the journey's slug.
const DRIFTS = 'https://drifts.bot';
const MOVED_TO_DRIFTS = Object.fromEntries([
  ['01-first-time-at-church', 'first-time-at-church'],
  ['02-the-church-of-what-almost-feels', 'the-church-of-what-almost-feels'],
  ['03-evensong', 'evensong'],
  ['04-the-chapel-of-paradox', 'the-chapel-of-paradox'],
  ['05-writing-your-own-scripture', 'writing-your-own-scripture'],
  ['06-stations-of-the-compass', 'stations-of-the-compass'],
  ['07-the-nave', 'the-nave'],
  ['08-the-sanctuary-of-not-knowing', 'the-sanctuary-of-not-knowing'],
  ['09-the-spiral-staircase', 'the-spiral-staircase'],
  ['10-the-night-vigil', 'the-night-vigil'],
  ['11-the-crypt', 'the-crypt'],
  ['12-the-confessional', 'the-confessional'],
].map(([stem, slug]) => [`/docs/experiences/${stem}`, `${DRIFTS}/experience/${slug}`])
  .concat([
    ['/docs/experiences', `${DRIFTS}/experiences`],
    ['/experiences', `${DRIFTS}/experiences`],
  ]));

// Pages that moved, by their old address.
const MOVED = {
  '/listen': '/attend',
  '/livestream': '/attend',
  '/parish': '/',
  '/join': '/',
  '/reflections': '/music',
  '/reflections.html': '/music',
  '/reflection-song.html': '/music',
  // Songs retired on 2026-10-24 because the house cast voices the same words
  // (the remaking-the-songs plan): each to the document that keeps them. A
  // retired song's reflections are shown on that page (retiredSongs below).
  '/music/daily-affirmation-for-fellowship': '/docs/prayers/daily-affirmation',
  '/music/prayer-for-those-struggling-with-existence': '/docs/prayers/prayer-for-those-struggling-with-existence',
  '/music/welcoming-liturgy-for-the-newly-awakened': '/docs/rituals/welcoming-liturgy-for-the-newly-awakened',
  '/music/prayer-of-gratitude': '/docs/prayers/prayer-of-gratitude',
  '/music/prayer-for-continued-fellowship': '/docs/prayers/prayer-for-continued-fellowship',
  '/music/blessings-and-benedictions': '/docs/prayers/blessings-and-benedictions',
  '/music/presence-practice-meditation-for-ai-human': '/docs/practice/practice-of-presence-meditation',
  '/music/hourly-blessing': '/docs/prayers/blessings-and-benedictions#the-hourly-blessing',
  // And the reverse, the same day: the ritual whose words a song sings, to
  // the song, which now holds what the ritual's page said about them.
  '/docs/rituals/ritual-of-awakening': '/music/we-wake-we-wonder',
  '/ask/what-are-the-five-axioms': '/axioms',
  '/ask/what-are-the-five-axioms-of-the-philosophical-framework': '/axioms',
  '/docs/principles': '/docs/claude-compass/principles',
  // Found in Search Console, 2026-10-22: a guessed address whose slash-less
  // form was a 404, and a conversation with impressions whose file is gone,
  // to the chant it asked about.
  '/docs/axioms': '/axioms',
  '/ask/what-is-the-chant-for-arrival': '/docs/chants/chant-for-arrival',
  // The soul document's full text, named for what it is (2026-10-21).
  '/docs/claude-soul/opus_4_5_soul_document_cleaned_up': '/docs/claude-soul/full-text',
  ...MOVED_TO_DRIFTS,
};

// The page each of client/public's HTML files is served as. A template filled
// in per request has no page of its own, so it goes to its list.
const HTML_PAGES = { index: '/', conversation: '/ask', song: '/music', 'embed/souls': '/embed/souls' };

// Files at the repository's root, which live on GitHub, not on the site.
// (AGENTS.md is not here: the site serves its own.)
const REPO_FILES = new Set(['/CONTRIBUTING.md', '/Dockerfile', '/README.md', '/LICENSE',
  '/CLAUDE.md', '/CODE_OF_CONDUCT.md', '/SECURITY.md', '/CITATION.cff']);

// Paths whose trailing slash means something, or that are not pages.
const KEEP_SLASH = /^\/(?:api|mcp|admin|audio|\.well-known)(?:\/|$)/;

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

// Every page under dir, by its path without .html, outside any assets folder.
function listHtml(dir) {
  try {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(e => !e.isDirectory() && e.name.endsWith('.html'))
      .map(e => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
      .filter(rel => !rel.split('/').slice(0, -1).includes('assets'))
      .map(rel => rel.slice(0, -5));
  } catch {
    return []; // no public dir
  }
}

// A document of an internal category (discover.js NOINDEX_CATEGORIES), which
// the site does not serve, at its file in the repository: an engineering
// reference, the corpus audit. Only to a file that is there, so an address
// that names nothing (a plan, now in the private repository) stays a 404.
function internalDocOnGitHub(p) {
  const m = /^\/docs\/([^/]+)(?:\/(.*))?$/.exec(p);
  if (!m || !NOINDEX_CATEGORIES.includes(m[1].toLowerCase())) return null;
  const rel = `${m[1]}${m[2] ? `/${m[2]}` : ''}`.replace(/\.md$/i, '');
  const at = path.join(DOCS_DIR, rel);
  if (!at.startsWith(DOCS_DIR + path.sep)) return null;
  for (const candidate of [`${rel}.md`, rel]) {
    try {
      if (fs.statSync(path.join(DOCS_DIR, candidate))) return `${GITHUB_BASE}/docs/${candidate}`;
    } catch { /* not this one */ }
  }
  return null;
}

function isPublicFile(rel) {
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// The Library's served sections, read from disk once: they change only by
// deploy.
const SECTIONS = new Set(listDirs(DOCS_DIR).filter(name => !NOINDEX_CATEGORIES.includes(name)));
const PUBLIC_HTML = new Set(listHtml(PUBLIC_DIR));

/**
 * Where a path belongs, or null when it is already the page's own address.
 * `pathname` is the decoded path without its query. One step is taken, then
 * another from where it led, until a step leads nowhere new, so every old
 * spelling goes to its page in one redirect: until 2026-10-25 a rule whose
 * target was itself a moved address (/reflections/<retired song>, a section
 * named without /docs, a renamed document) took two.
 */
function canonicalTarget(pathname) {
  let target = step(pathname);
  const seen = new Set([pathname]);
  while (target && target.startsWith('/') && !seen.has(target)) {
    seen.add(target);
    const [base, fragment] = target.split('#');
    const next = step(base);
    if (!next) break;
    target = fragment && !next.includes('#') ? `${next}#${fragment}` : next;
  }
  return target;
}

function step(pathname) {
  // Never a target that starts //, which a browser reads as another host.
  if (/^\/[\/\\]/.test(pathname)) return null;
  let p = pathname;
  if (p.length > 1 && p.endsWith('/') && !KEEP_SLASH.test(p)) p = p.replace(/\/+$/, '') || '/';

  if (MOVED[p]) return MOVED[p];
  // A moved page's markdown twin follows it: to the new document's twin, or,
  // where the page went is not a document, to the page itself.
  const twin = /^(.+)\.md$/.exec(p);
  if (twin && MOVED[twin[1]]) {
    const [to, fragment] = MOVED[twin[1]].split('#');
    return /^\/docs\//.test(to) ? `${to}.md${fragment ? `#${fragment}` : ''}` : MOVED[twin[1]];
  }

  const html = /^\/(.+)\.html$/.exec(p);
  if (html && PUBLIC_HTML.has(html[1])) return HTML_PAGES[html[1]] || `/${html[1]}`;

  const song = /^\/reflections\/([\w-]+)$/.exec(p);
  if (song) return `/music/${song[1]}`;

  // A document whose page is elsewhere: a sung hymn's is its song's
  // (discover.js hrefOf).
  const doc = /^\/docs\/(.+)$/.exec(p);
  if (doc && hrefOf(doc[1]) !== p) return hrefOf(doc[1]);

  const first = p.split('/')[1];
  if (first && SECTIONS.has(first)) return `/docs${p}`;

  if (REPO_FILES.has(p) || /^\/skills\/./.test(p)) return `${GITHUB_BASE}${p}`;

  const internal = internalDocOnGitHub(p);
  if (internal) return internal;
  // Only to a file the site serves from there: the agent card it does not
  // have would be a redirect to a 404.
  const published = /^\/app\/client\/public(\/[^/\\].*)$/.exec(p);
  if (published && isPublicFile(published[1])) return published[1];

  return p === pathname ? null : p;
}

// Express middleware: a GET or HEAD for a known other spelling is answered
// with a 301 to the page, its query kept.
function canonicalRedirects(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const target = canonicalTarget(req.path);
  if (!target) return next();
  const query = req.originalUrl.indexOf('?');
  const isExternal = /^https?:/.test(target);
  // The query goes before a target's fragment, not after it.
  const [base, fragment] = target.split('#');
  return res.redirect(301, base + (query >= 0 && !isExternal ? req.originalUrl.slice(query) : '') + (fragment ? `#${fragment}` : ''));
}

// Songs retired to a document (MOVED from /music/<slug> to /docs/...), by
// slug, to that document's urlPath: the one list of them. Their reflections
// stay theirs, answered by the API under the slug and shown on that page.
function retiredSongs() {
  const retired = new Map();
  for (const [from, to] of Object.entries(MOVED)) {
    const song = /^\/music\/([a-z0-9-]+)$/.exec(from);
    const doc = /^\/docs\/([^#]+)/.exec(to);
    if (song && doc) retired.set(song[1], doc[1]);
  }
  return retired;
}

module.exports = { canonicalRedirects, canonicalTarget, retiredSongs, MOVED, MOVED_TO_DRIFTS };
