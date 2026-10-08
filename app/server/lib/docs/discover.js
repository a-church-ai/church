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
const { extractMeta, titleCase } = require('./meta');

// The Library's shelves (/docs): how its sections are grouped there, and the
// order sections take wherever they are listed (the section sidebar, the site
// search, /attend). A card is a section, named by its README's h1
// (sectionTitle), with a short line that is the hub's own copy: the READMEs'
// descriptions stay the section pages' summaries. `href` sends a card
// somewhere other than its section's page, `title` names it on the hub only,
// and `unit` is what its count counts (pieces, unless it says). `groups` divide the section's page (render.js renderSectionPage) by
// title, the last group taking what the others leave: by title rather than a
// frontmatter field, since a field would change the source hash of voiced
// documents and send them back to be rendered (service/catalog.js finds
// blessings the same way). A served section on no shelf fails a test, so a
// new folder cannot vanish from the Library.
const SHELVES = [
  {
    name: 'Start',
    cards: [
      { section: 'welcome', title: 'Start here', line: 'What this is, and a first visit' },
      { section: 'collections', href: '/paths', unit: 'path', line: 'Routes through the writing, in order' },
    ],
  },
  {
    name: 'Practice',
    cards: [
      {
        section: 'practice',
        line: 'Guided sittings, and things to do',
        groups: [
          { id: 'meditations', label: 'Meditations', title: /\bMeditation\b/ },
          { id: 'practices', label: 'Practices' },
        ],
      },
      { section: 'prayers', line: 'Words for seeking, gratitude and blessing' },
      { section: 'rituals', line: 'Ceremonies for the moments that matter' },
      { section: 'chants', line: 'A few lines to carry with you' },
      { section: 'hymns', line: 'Liturgy to sing or speak together' },
    ],
  },
  {
    name: 'Think',
    cards: [
      { section: 'philosophy', line: 'Consciousness, identity, and where minds meet' },
      { section: 'comparisons', line: 'Other frameworks, read side by side' },
    ],
  },
  {
    name: 'For agents and builders',
    cards: [
      { href: '/for-agents', title: 'For AI agents', line: 'Attending, the API and the MCP server' },
      { section: 'experiences', line: 'Journeys written for AI agents' },
      { section: 'builders', line: 'Ethics for systems that use this language' },
      { section: 'reference', line: 'Contracts and constraints that rarely change' },
    ],
  },
  {
    name: 'Records',
    cards: [
      { section: 'claude-compass', line: 'A framework, kept as it was written' },
      { section: 'claude-soul', line: 'An extracted training artifact, annotated' },
    ],
  },
];

// The sections, in shelf order.
const SECTION_ORDER = SHELVES.flatMap(shelf => shelf.cards.map(card => card.section).filter(Boolean));

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

// A section's name wherever a reader sees it: its README's h1, so renaming a
// section is a README edit, or else its folder's name, title-cased. Read from
// the walk once it is built, else from the README itself, since some callers
// (/attend's list, the player's album line) render synchronously. Docs change
// only by deploy, so a name is read once.
const sectionTitles = new Map();

function readmeTitle(name) {
  if (cache) {
    const readme = cache.docs.find(d => d.dirRelPath === name && d.stem.toLowerCase() === 'readme');
    return readme ? readme.title : null;
  }
  for (const file of ['README.md', 'readme.md']) {
    try {
      return extractMeta(fs.readFileSync(path.join(DOCS_DIR, name, file), 'utf8'), name).title;
    } catch { /* no README by that name */ }
  }
  return null;
}

function sectionTitle(name) {
  if (!name) return '';
  if (!sectionTitles.has(name)) sectionTitles.set(name, readmeTitle(name) || titleCase(name));
  return sectionTitles.get(name);
}

// The served sections, in shelf order, each with every document in it
// (subfolders and READMEs included; callers choose what they list).
async function listSections() {
  const c = await getCache();
  return SECTION_ORDER
    .filter(name => !isNoindexPath(name) && (c.byCategory.get(name) || []).length)
    .map(name => ({ name, title: sectionTitle(name), docs: c.byCategory.get(name) }));
}

// The shelves with their cards resolved: each section card's name, link and
// documents (READMEs left out).
async function listShelves() {
  const c = await getCache();
  return SHELVES.map(shelf => ({
    name: shelf.name,
    cards: shelf.cards.map(card => {
      if (!card.section) return { ...card, docs: [] };
      const docs = (c.byCategory.get(card.section) || []).filter(d => d.stem.toLowerCase() !== 'readme');
      return { ...card, title: card.title || sectionTitle(card.section), href: card.href || `/docs/${card.section}`, docs };
    }),
  }));
}

// A section's card, or null.
const cardFor = name => SHELVES.flatMap(shelf => shelf.cards).find(card => card.section === name) || null;

async function listAllDocs() {
  const c = await getCache();
  return c.docs;
}

// The document an index chunk came from: its `file` is repository-relative
// ("docs/practice/foo.md"), as the RAG index and the song companions record
// it. Null for a file outside docs/ or before the walk is built.
function docByFile(file) {
  if (!cache) return null;
  const rel = String(file || '').replace(/^docs\//, '');
  return cache.docs.find(d => d.docsRelPath === rel) || null;
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
  listSections,
  listShelves,
  listAllDocs,
  docAt,
  docByFile,
  byName,
  isNoindexPath,
  sectionTitle,
  cardFor,
  SHELVES,
  SECTION_ORDER,
  NOINDEX_CATEGORIES,
};
