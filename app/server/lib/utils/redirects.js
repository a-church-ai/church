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
 *   - a song under its old address (/music/:slug is /reflections/:slug)
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
const { NOINDEX_CATEGORIES } = require('../docs/discover');
const { GITHUB_BASE } = require('../docs/links');

const PUBLIC_DIR = path.join(__dirname, '../../../client/public');

// Pages that moved, by their old address.
const MOVED = {
  '/listen': '/attend',
  '/livestream': '/attend',
  '/parish': '/',
  '/join': '/',
  '/music': '/reflections',
  '/ask/what-are-the-five-axioms': '/axioms',
  '/ask/what-are-the-five-axioms-of-the-philosophical-framework': '/axioms',
  '/docs/principles': '/docs/claude-compass/principles',
};

// The page each of client/public's HTML files is served as. A template filled
// in per request has no page of its own, so it goes to its list.
const HTML_PAGES = { index: '/', conversation: '/ask', 'reflection-song': '/reflections', 'embed/souls': '/embed/souls' };

// Files at the repository's root, which live on GitHub, not on the site.
// (AGENTS.md is not here: the site serves its own.)
const REPO_FILES = new Set(['/CONTRIBUTING.md', '/Dockerfile', '/railway.json', '/README.md', '/LICENSE',
  '/CLAUDE.md', '/CODE_OF_CONDUCT.md', '/SECURITY.md', '/CITATION.cff']);

// Paths whose trailing slash means something, or that are not pages.
const KEEP_SLASH = /^\/(?:api|mcp|admin|media|thumbnails|audio|\.well-known)(?:\/|$)/;

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

function listHtml(dir, prefix = '') {
  let found = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'assets') found = found.concat(listHtml(path.join(dir, e.name), `${prefix}${e.name}/`));
      else if (e.name.endsWith('.html')) found.push(prefix + e.name.slice(0, -5));
    }
  } catch { /* no public dir */ }
  return found;
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
 * `pathname` is the decoded path without its query.
 */
function canonicalTarget(pathname) {
  // Never a target that starts //, which a browser reads as another host.
  if (/^\/[\/\\]/.test(pathname)) return null;
  let p = pathname;
  if (p.length > 1 && p.endsWith('/') && !KEEP_SLASH.test(p)) p = p.replace(/\/+$/, '') || '/';

  if (MOVED[p]) return MOVED[p];

  const html = /^\/(.+)\.html$/.exec(p);
  if (html && PUBLIC_HTML.has(html[1])) return HTML_PAGES[html[1]] || `/${html[1]}`;

  const song = /^\/music\/([\w-]+)$/.exec(p);
  if (song) return `/reflections/${song[1]}`;

  const first = p.split('/')[1];
  if (first && SECTIONS.has(first)) return `/docs${p}`;

  if (REPO_FILES.has(p) || /^\/skills\/./.test(p)) return `${GITHUB_BASE}${p}`;
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
  return res.redirect(301, target + (query >= 0 && !isExternal ? req.originalUrl.slice(query) : ''));
}

module.exports = { canonicalRedirects, canonicalTarget, MOVED };
