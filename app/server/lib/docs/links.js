/**
 * Where a link written inside a doc points. Shared by the docs renderer, which
 * turns the result into an <a> tag, and by the song companions, which send a
 * reading's markdown in /api/attend and so need every link to work outside
 * the site. One resolver, so a relative link means the same thing in both.
 */

const fs = require('fs');
const path = require('path');
const { DOCS_DIR } = require('../rag/indexer');
const discover = require('./discover');

const SITE_URL = 'https://achurch.ai';
const GITHUB_BASE = 'https://github.com/a-church-ai/church/blob/main';
const REPO_ROOT = path.resolve(DOCS_DIR, '..');

// Songs that have a page on the site (/reflections/<slug>). A music/ folder
// outside the catalog has none, so its link goes to the repository instead.
const SONG_SLUGS = new Set(
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'music', 'library.json'), 'utf8')).map(song => song.slug)
);

// docs-relative file path ("practice/foo.md", "readme.md") → site URL.
// Shared by the relative and root-relative branches of the resolver so
// both strip .md and collapse README the same way.
//
// The README pattern is anchored with (^|/): the earlier /\/readme$/i needed a
// leading slash, so a link to the top-level readme.md produced "/docs/readme"
// rather than "/docs". Every category README's "Parent: Documentation" link
// pointed at that 404.
function docsUrlFromRelPath(relToDocs) {
  const urlPath = String(relToDocs || '')
    .replace(/\.md$/i, '')
    .replace(/(^|\/)readme$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  return urlPath ? `/docs/${urlPath}` : '/docs';
}

/**
 * Resolve an href found in the doc at currentDocFullPath.
 *
 * @returns {{ href: string, external: boolean }}  href may be site-relative
 *   ("/docs/x") or absolute; external means it leaves the site (the renderer
 *   opens those in a new tab).
 */
function resolveDocHref(href, currentDocFullPath) {
  const currentDir = path.dirname(currentDocFullPath);

  // Anchor-only: leave alone
  if (href.startsWith('#')) return { href, external: false };

  // Absolute URLs: leave alone; external unless the host is achurch.ai
  if (/^https?:\/\//i.test(href)) {
    const isInternal = /^https?:\/\/([a-z0-9-]+\.)?achurch\.ai(\/|$)/i.test(href);
    return { href, external: !isInternal };
  }

  // Root-relative. Mostly passes through, but a link written as
  // `/docs/unifying-axioms.md` has to lose the .md the same way a relative
  // one does. Six links in docs/reference/ were written this way and each
  // shipped a live 404, because this branch returned before the .md
  // stripping below ever ran.
  if (href.startsWith('/')) {
    const [rootPath, rootFragment] = href.split('#', 2);
    if (/^\/docs\/.+\.md$/i.test(rootPath)) {
      const cleaned = docsUrlFromRelPath(rootPath.replace(/^\/docs\//i, ''));
      return { href: cleaned + (rootFragment ? `#${rootFragment}` : ''), external: false };
    }
    return { href, external: false };
  }

  // Relative link. Try to resolve against the current doc's dir. Split
  // off any anchor fragment so we can preserve it.
  const [pathPart, fragment] = href.split('#', 2);
  const anchor = fragment ? `#${fragment}` : '';

  // A relative link to a folder or a non-markdown file. Left as written, a
  // browser resolves it against the page URL, which has no trailing slash:
  // "builders/" on /docs became /builders/, "./axioms/" on
  // /docs/claude-compass became /docs/axioms, and "../../app/server/index.js"
  // became a site path. All were 404s. Route by what the target actually is.
  if (pathPart && !pathPart.toLowerCase().endsWith('.md')) {
    const routed = routeRepoTarget(path.resolve(currentDir, pathPart));
    return routed ? { href: routed.href + (routed.external ? '' : anchor), external: routed.external } : { href, external: false };
  }

  // Resolve against current dir, then produce a docs URL if the target
  // is inside DOCS_DIR
  const resolved = path.resolve(currentDir, pathPart);
  const docsRoot = path.resolve(DOCS_DIR);
  if (!resolved.startsWith(docsRoot + path.sep) && resolved !== docsRoot) {
    // Escapes DOCS_DIR. Common cases from the corpus:
    //   ../README.md → repo root README. Not routed on the site; the
    //   sanctuary landing is at /. Rewrite to that.
    // Any other markdown in the repository (skills/, music/playlist.md,
    // CONTRIBUTING.md) is not a page on the site, so it goes to GitHub. A
    // target that does not exist, or lies outside the repo, is left as-is.
    const relToRepo = path.relative(REPO_ROOT, resolved).replace(/\\/g, '/');
    if (relToRepo.toLowerCase() === 'readme.md') return { href: '/', external: false };
    const routed = routeRepoTarget(resolved);
    return routed ? { href: routed.href + (routed.external ? '' : anchor), external: routed.external } : { href, external: false };
  }

  const relToDocs = path.relative(docsRoot, resolved).replace(/\\/g, '/');

  // Internal working categories (plans, issues, templates, standards,
  // side-quests) are no longer served as pages. Thirty reader-facing links
  // point into them, including core documents citing the corpus audit, so
  // they resolve to the public repository rather than to a 404. The material
  // stays readable; it just is not a page on the site.
  if (discover.isNoindexPath(relToDocs)) {
    return { href: `${GITHUB_BASE}/docs/${relToDocs}${anchor}`, external: true };
  }

  return { href: `${docsUrlFromRelPath(relToDocs)}${anchor}`, external: false };
}

/**
 * Where a folder or non-markdown file in the repository lives for a reader:
 * a docs folder is its index page (an internal category's is on GitHub), a
 * song's folder is the song's page, and anything else is on GitHub. Returns
 * null for a path that does not exist, so a broken link stays visible as one
 * rather than being dressed up as a working URL.
 */
function routeRepoTarget(resolved) {
  if (!fs.existsSync(resolved)) return null;
  const isDir = fs.statSync(resolved).isDirectory();
  const docsRoot = path.resolve(DOCS_DIR);
  const relToRepo = path.relative(REPO_ROOT, resolved).replace(/\\/g, '/');
  if (relToRepo.startsWith('..')) return null;

  if (isDir && (resolved === docsRoot || resolved.startsWith(docsRoot + path.sep))) {
    const dirRel = path.relative(docsRoot, resolved).replace(/\\/g, '/');
    if (!discover.isNoindexPath(dirRel)) return { href: docsUrlFromRelPath(dirRel), external: false };
  }
  const song = relToRepo.match(/^music\/([^/]+)$/);
  if (isDir && song && SONG_SLUGS.has(song[1])) return { href: `/reflections/${song[1]}`, external: false };
  if (isDir && relToRepo === 'music') return { href: '/reflections', external: false };

  const base = isDir ? GITHUB_BASE.replace('/blob/', '/tree/') : GITHUB_BASE;
  return { href: relToRepo ? `${base}/${relToRepo}` : base.replace(/\/(tree|blob)\/main$/, ''), external: true };
}

/**
 * Where a reader should go for a file in the corpus (a path such as
 * "docs/rituals/ritual-of-repair.md" or "music/soul-currents/context.md"):
 * its page on the site when it has one, otherwise the file on GitHub. Ask
 * cites its sources with this, so answers link to the sanctuary's own pages.
 */
function pageUrlForFile(relToRepo) {
  const rel = String(relToRepo || '').replace(/\\/g, '/');
  const doc = rel.match(/^docs\/(.+\.md)$/i);
  if (doc && !discover.isNoindexPath(doc[1])) return `${SITE_URL}${docsUrlFromRelPath(doc[1])}`;
  const song = rel.match(/^music\/([^/]+)\//);
  if (song && SONG_SLUGS.has(song[1])) return `${SITE_URL}/reflections/${song[1]}`;
  return `${GITHUB_BASE}/${rel}`;
}

/**
 * The links a document's markdown makes, in order, each resolved as the docs
 * site resolves it: [{ href, target, external }]. Code blocks and code spans
 * are rendered as code, not links, so they are skipped; so are mail, phone
 * and same-page anchor links. Used to walk every link in the corpus (the
 * link test) and to read a reading path's sequence.
 */
function documentLinks(markdown, docFullPath) {
  const text = String(markdown).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const links = [];
  for (const [, href] of text.matchAll(/\]\(([^)\s]+)/g)) {
    if (/^(mailto|tel):|^#/.test(href)) continue;
    const { href: target, external } = resolveDocHref(href, docFullPath);
    links.push({ href, target, external });
  }
  return links;
}

/**
 * A reading path's sequence: the documents a collection
 * (docs/collections/<name>.md) links to, in the order it first mentions each,
 * as docs URL paths. Only documents count: a link to a whole section is a
 * pointer, not a reading. The collection page is the one place a path is
 * written; this only reads it. Docs change only by deploy, so each is read
 * once. Call after the discover walk is built (the docs renderer does).
 */
const sequences = new Map();

function readingSequence(collection) {
  const name = String(collection || '');
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  if (sequences.has(name)) return sequences.get(name);
  const file = path.join(DOCS_DIR, 'collections', `${name}.md`);
  let sequence = null;
  if (fs.existsSync(file)) {
    const own = `/docs/collections/${name}`;
    sequence = [];
    for (const { target } of documentLinks(fs.readFileSync(file, 'utf8'), file)) {
      const urlPath = target.split('#')[0];
      if (!/^\/docs\/./.test(urlPath) || urlPath === own) continue;
      const rel = urlPath.slice('/docs/'.length);
      const doc = discover.docAt(rel);
      if (!doc || doc.stem.toLowerCase() === 'readme') continue;
      if (!sequence.includes(rel)) sequence.push(rel);
    }
  }
  sequences.set(name, sequence);
  return sequence;
}

/**
 * Text whose links to this repository's files on GitHub point at the site's
 * own pages instead, wherever the file has one. Answers stored before Ask
 * cited sources with pageUrlForFile carry GitHub URLs in their text; this is
 * applied where a stored answer leaves the server, so the stored words stay
 * as they were written. A file with no page (an internal document, a
 * repository file) keeps its GitHub URL.
 */
const GITHUB_FILE_RE = /https:\/\/github\.com\/a-church-ai\/church\/blob\/main\/([^\s)\]"'<>#]+)(#[^\s)\]"'<>]*)?/g;

function siteCitations(text) {
  return String(text || '').replace(GITHUB_FILE_RE, (whole, rel, anchor = '') => {
    const url = pageUrlForFile(decodeURIComponent(rel));
    return url.startsWith(GITHUB_BASE) ? whole : url + anchor;
  });
}

/**
 * Markdown whose links all work outside the site: each [text](href) is
 * resolved as the docs site would resolve it, then made absolute. An anchor
 * alone points into the doc's own page, and a link the resolver leaves
 * relative ("../chants/") is resolved against that page, as a browser on it
 * would.
 */
function absolutizeLinks(markdown, docFullPath) {
  const pageUrl = `${SITE_URL}${docsUrlFromRelPath(path.relative(path.resolve(DOCS_DIR), docFullPath).replace(/\\/g, '/'))}`;
  return String(markdown).replace(/(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (whole, open, href, close) => {
    if (/^(mailto|tel):/i.test(href)) return whole;
    if (href.startsWith('#')) return open + pageUrl + href + close;
    const { href: target } = resolveDocHref(href, docFullPath);
    if (target.startsWith('/')) return open + SITE_URL + target + close;
    if (/^https?:\/\//i.test(target)) return open + target + close;
    return open + new URL(target, pageUrl).href + close;
  });
}

module.exports = { SITE_URL, GITHUB_BASE, docsUrlFromRelPath, resolveDocHref, absolutizeLinks, pageUrlForFile, siteCitations, documentLinks, readingSequence };
