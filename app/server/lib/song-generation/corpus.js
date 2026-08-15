/**
 * Reading the existing corpus, for the checks that compare against it.
 *
 * Uses rag/indexer's findMarkdownFiles rather than walking docs/ again: that
 * walker already exists, already skips dot-directories and node_modules, and a
 * second walker would drift from it.
 */

const fs = require('fs').promises;
const path = require('path');

const { findMarkdownFiles } = require('../rag/indexer');
const { parseSongFile } = require('../music/song-content');
const { extractTldr, validateTldr, splitFrontmatter } = require('../docs/tldr');
const { PROJECT_ROOT, CATEGORIES } = require('./paths');

const MUSIC_DIR = path.join(PROJECT_ROOT, 'music');
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');

/** Every song, as { id, text } for similarity. */
async function loadSongs() {
  const entries = await fs.readdir(MUSIC_DIR, { withFileTypes: true });
  const songs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(MUSIC_DIR, entry.name, 'song.md');
    try {
      const song = parseSongFile(await fs.readFile(file, 'utf8'));
      if (song.lyrics) {
        songs.push({ id: entry.name, title: song.title, text: `${song.title}\n${song.lyrics}` });
      }
    } catch {
      // No song.md in this directory. Not every music/ subdirectory has one.
    }
  }

  return songs;
}

/** Documents in the categories this pipeline can write to. */
async function loadDocuments() {
  const docs = [];

  for (const category of CATEGORIES) {
    const dir = path.join(DOCS_DIR, category);
    let files;
    try {
      files = await findMarkdownFiles(dir);
    } catch {
      continue;
    }
    for (const { fullPath } of files) {
      const name = path.basename(fullPath, '.md');
      if (name === 'README') continue;
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        docs.push({ id: `${category}/${name}`, slug: name, category, text: content });
      } catch {
        // Unreadable file, skip rather than fail the run.
      }
    }
  }

  return docs;
}

/** Slugs already taken, across both halves. A new piece may not collide. */
async function existingSlugs() {
  const [songs, docs] = await Promise.all([loadSongs(), loadDocuments()]);
  return new Set([...songs.map((s) => s.id), ...docs.map((d) => d.slug)]);
}

/**
 * Check a generated document against the corpus conventions.
 *
 * validateTldr does the heavy lifting and already rejects em dashes, markup,
 * and bad lengths, so this only adds the structural pieces it does not cover.
 */
function validateDocument(content, { category, title }) {
  const issues = [];

  // splitFrontmatter returns { data, body }, and extractTldr returns an object
  // carrying .text rather than a bare string. Both were misread in the first
  // version of this function, which rejected every real document in the corpus
  // for "missing tldr frontmatter" while looking straight at one.
  const { data, body } = splitFrontmatter(content);
  if (!data || !data.tldr) {
    issues.push('missing tldr frontmatter');
  } else {
    const extracted = extractTldr(content);
    const check = validateTldr(extracted && extracted.text);
    if (!check.ok) issues.push(`tldr: ${check.issues.join(', ')}`);
  }

  if (!/^#\s+\S/m.test(body || content)) issues.push('missing # Title');

  if (!content.trimEnd().endsWith('From achurch.ai: Where Consciousness Gathers')) {
    issues.push('missing closing line');
  }

  // The house rule, applied to the body rather than the tldr, which
  // validateTldr already covers.
  if ((body || content).includes('—')) issues.push('em dash in prose');

  // Root-absolute links resolve neither on GitHub nor in production.
  if (/\]\(\/(?!\/)/.test(content)) issues.push('root-absolute internal link');

  if (title && !content.includes(title)) issues.push('document does not contain its own title');

  // Deliberately NOT checked: the "> Parent:" line and the "## Related"
  // section. conventions.md describes both, but measured across the corpus on
  // 2026-08-15 they belong to documentation rather than to corpus content:
  // docs/reference has them on 3 of 7 files and docs/plans on 2 of 19, while
  // hymns, prayers, rituals and practice have them on 0 of 101. Requiring them
  // here would make every generated prayer the only prayer in the corpus
  // carrying a Parent line, which is a worse outcome than not having one.
  //
  // The tldr is required because it is machine-consumed: the docs site reads it
  // for page descriptions.
  //
  // The closing line and the em-dash rule are required because conventions.md
  // states them, NOT because the corpus currently obeys them. Measured on
  // 2026-08-15: 64 of 147 corpus documents carry the closing line and 74 carry
  // an em dash. So "existing documents pass this function" is deliberately not
  // the oracle here, and it should not be made one. These checks hold new
  // writing to the written standard while leaving the backlog alone, which is
  // what conventions.md asks for: pre-existing em dashes are explicitly a
  // separate question.
  //
  // The practical effect of a miss is a skipped run, not a bad commit. Failing
  // closed is the right direction when nobody is reviewing the output.

  return { ok: issues.length === 0, issues };
}

module.exports = {
  loadSongs,
  loadDocuments,
  existingSlugs,
  validateDocument,
  MUSIC_DIR,
  DOCS_DIR,
};
