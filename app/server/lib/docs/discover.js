/**
 * Docs discovery: enumerate files, resolve URL paths to disk paths, list
 * siblings for related-links navigation.
 *
 * Uses the same filesystem walker the RAG indexer uses so both surfaces stay
 * in lockstep on which files are considered "docs."
 *
 * Categorization is intentionally by first path segment. Top-level files
 * (docs/what.md, docs/unifying-axioms.md) have no category; directory
 * children get their directory name as category. A curated split names which
 * categories are "primary" (reader-facing) vs "meta" (operational). Meta
 * categories still get URLs and sitemap entries; the docs root just promotes
 * primary ones visually.
 */

const path = require('path');
const fs = require('fs');
const { findMarkdownFiles, DOCS_DIR } = require('../rag/indexer');
const { extractMeta } = require('./meta');

// Categories to promote on the /docs index. Everything else lands under "More".
const PRIMARY_CATEGORIES = [
  'welcome',
  'philosophy',
  'practice',
  'prayers',
  'chants',
  'rituals',
  'hymns',
  'builders',
  'comparisons',
  'collections',
];

// Categories kept out of search results. These are internal working
// documents: roadmaps, SEO retrospectives, doc templates, imported side-quest
// write-ups. They stay live, linkable and readable, so nothing about the
// project's openness changes. They are simply not what someone searching for
// the sanctuary should land on, and they were competing for crawl budget with
// the reader-facing corpus.
//
// Used in two places that must agree: the robots meta on the rendered page
// (lib/docs/render.js) and the sitemap (server/index.js). A page that says
// noindex while still appearing in the sitemap is a contradictory signal.
const NOINDEX_CATEGORIES = ['plans', 'side-quests', 'templates', 'standards', 'issues', 'reviews'];

function isNoindexPath(urlPath) {
  const first = String(urlPath || '').split('/').filter(Boolean)[0];
  return Boolean(first) && NOINDEX_CATEGORIES.includes(first.toLowerCase());
}

let cache = null;

// Display order for names: numbers compare as numbers, so "Principle 2"
// precedes "Principle 10".
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

// Each entry also carries the document's title and description, read once
// here. Docs change only by deploy, so the walk is built once and never
// invalidated; everything that labels or describes a document (the sidebar,
// indexes, related links, search, share cards, MCP) reads it from here
// rather than opening the file again.
async function buildCache() {
  const files = await findMarkdownFiles(DOCS_DIR);
  // findMarkdownFiles returns {fullPath, relativePath} where relativePath is
  // repo-root-relative (e.g. "docs/practice/foo.md"). We want docs-root-relative.
  const docs = files.map(f => {
    const relToDocs = path.relative(DOCS_DIR, f.fullPath);
    const segments = relToDocs.split(path.sep);
    const filename = segments[segments.length - 1];
    const stem = filename.replace(/\.md$/, '');
    const category = segments.length > 1 ? segments[0] : null;
    const dirRelToDocs = segments.slice(0, -1).join('/');
    return {
      fullPath: f.fullPath,
      docsRelPath: relToDocs.replace(/\\/g, '/'),  // Windows-safe
      urlPath: buildUrlPath(dirRelToDocs, stem),
      dirRelPath: dirRelToDocs,
      filename,
      stem,
      category,
    };
  });
  await Promise.all(docs.map(async doc => {
    const { title, description } = extractMeta(await fs.promises.readFile(doc.fullPath, 'utf8'), doc.urlPath);
    doc.title = title;
    doc.description = description;
  }));

  // Group by category (first segment; null for top-level)
  const byCategory = new Map();
  for (const doc of docs) {
    const key = doc.category || '';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(doc);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => byName(a.docsRelPath, b.docsRelPath));
  }

  cache = { docs, byCategory };
  return cache;
}

// Build the docs-site URL path from directory + stem. README/readme files
// index their directory (URL is the dir); everything else is dir/stem.
//
// Lowercased so there is exactly one canonical URL per doc. The route
// lowercases incoming segments, so emitting the filename's own case here
// meant docs/CONTRIBUTING.md advertised /docs/CONTRIBUTING in the sitemap and
// sidebar while the resolver could only ever match lowercase. Disk reads use
// fullPath and the GitHub link uses docsRelPath, so both keep the real case.
function buildUrlPath(dirRelToDocs, stem) {
  const isReadme = stem.toLowerCase() === 'readme';
  const dir = dirRelToDocs ? dirRelToDocs.replace(/\\/g, '/') : '';
  const urlPath = isReadme ? dir : (dir ? `${dir}/${stem}` : stem);
  return urlPath.toLowerCase();
}

async function getCache() {
  if (!cache) await buildCache();
  return cache;
}

/**
 * Resolve a URL path (array of segments after /docs/) to a disk file.
 * Returns { kind: 'file', fullPath, doc } or { kind: 'dir-index', dir, docs }
 * or null (404).
 *
 * The resolver tries in order:
 *   1. Leaf .md file at parts.join('/') + '.md'
 *   2. Directory README at parts.join('/') + '/README.md' (both cases)
 *   3. Directory itself (auto-generate an index of its files)
 *
 * Path traversal is prevented by resolving the path and rejecting anything
 * that escapes DOCS_DIR. Callers should also validate segments against
 * /^[a-z0-9._-]+$/ before calling this to fail earlier and more clearly.
 */
async function resolveDocPath(parts) {
  const relPath = parts.length ? parts.join('/') : '';
  const c = await getCache();

  // Empty parts = docs root
  if (relPath === '') {
    const readme = c.docs.find(d => d.stem.toLowerCase() === 'readme' && !d.category);
    if (readme) return { kind: 'file', fullPath: readme.fullPath, doc: readme };
    return { kind: 'dir-index', dir: '', docs: c.docs };
  }

  // Match case-insensitively. urlPath preserves the filename's case, but the
  // route lowercases incoming segments before calling us, so an exact compare
  // could never match a file whose name has capitals. docs/CONTRIBUTING.md was
  // the live instance: /docs/CONTRIBUTING 404'd in every case variant while
  // still being linked from the sidebar on every page and submitted in the
  // sitemap.
  const wanted = relPath.toLowerCase();

  // Try leaf .md file
  const leafDoc = c.docs.find(d => d.urlPath.toLowerCase() === wanted && d.stem.toLowerCase() !== 'readme');
  if (leafDoc) return { kind: 'file', fullPath: leafDoc.fullPath, doc: leafDoc };

  // Try directory README
  const readmeDoc = c.docs.find(d => d.urlPath.toLowerCase() === wanted && d.stem.toLowerCase() === 'readme');
  if (readmeDoc) return { kind: 'file', fullPath: readmeDoc.fullPath, doc: readmeDoc };

  // Try directory index (dir exists on disk with .md children but no README)
  const asDir = path.resolve(DOCS_DIR, relPath);
  if (!asDir.startsWith(path.resolve(DOCS_DIR) + path.sep)) return null;
  try {
    if (fs.statSync(asDir).isDirectory()) {
      const inDir = c.docs.filter(d => d.dirRelPath === relPath || d.dirRelPath.startsWith(relPath + '/'));
      if (inDir.length > 0) return { kind: 'dir-index', dir: relPath, docs: inDir };
    }
  } catch { /* not a directory */ }

  return null;
}

/**
 * Categorized listing for the /docs index. Primary categories first
 * (in curated order), then meta categories alphabetized.
 */
async function listCategoriesForIndex() {
  const c = await getCache();
  const primary = [];
  const meta = [];

  // Internal working categories are not served as pages and do not appear in
  // navigation. They live in the public repository and are reached from there.
  // This is the second consumer of isNoindexPath, alongside the sitemap: a
  // category declared not-reader-facing should not be offered to a reader in the
  // sidebar of every page either.
  //
  // The guard stays even though PRIMARY_CATEGORIES no longer lists any noindex
  // category, so that adding one to NOINDEX_CATEGORIES is sufficient on its own.
  const seen = new Set();
  for (const catName of PRIMARY_CATEGORIES) {
    if (isNoindexPath(catName)) continue;
    const list = c.byCategory.get(catName);
    if (list && list.length > 0) {
      primary.push({ name: catName, docs: list });
      seen.add(catName);
    }
  }

  for (const [catName, list] of c.byCategory.entries()) {
    if (catName === '' || seen.has(catName) || isNoindexPath(catName)) continue;
    meta.push({ name: catName, docs: list });
  }
  meta.sort((a, b) => byName(a.name, b.name));

  const topLevel = c.byCategory.get('') || [];

  return { primary, meta, topLevel };
}

async function listAllDocs() {
  const c = await getCache();
  return c.docs;
}

// The document at a docs URL path ("practice/foo", "" for the root README),
// for callers that already hold the walk: the marked link renderer is
// synchronous, so it cannot await getCache(). Null before the walk is built.
function docAt(urlPath) {
  if (!cache) return null;
  const wanted = String(urlPath || '').toLowerCase();
  return cache.docs.find(d => d.urlPath === wanted && (wanted === '' ? !d.category : true)) || null;
}

module.exports = {
  resolveDocPath,
  listCategoriesForIndex,
  listAllDocs,
  docAt,
  byName,
  isNoindexPath,
  PRIMARY_CATEGORIES,
  NOINDEX_CATEGORIES,
};
