/**
 * Shared indexer helpers for the RAG content index.
 *
 * Extracted so both `app/scripts/index-content.js` (the CLI) and
 * `app/server/index.js` (startup hash-gated rebuild) can use the same walk +
 * chunk + hash logic without duplication.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.join(__dirname, '../../../..');
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');
const MUSIC_DIR = path.join(PROJECT_ROOT, 'music');

// Chunking config
const MAX_CHUNK_TOKENS = 500;
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN;

/**
 * Recursively find all markdown files under a directory. Returns objects with
 * both fullPath (for reading) and relativePath (stable identifier used in
 * chunks + hashing so the corpus hash is deterministic across machines).
 */
async function findMarkdownFiles(dir, baseDir = dir) {
  const files = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const subFiles = await findMarkdownFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const relativePath = path.relative(PROJECT_ROOT, fullPath);
        files.push({ fullPath, relativePath });
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message);
  }
  return files;
}

/**
 * Find every markdown file the RAG indexes: /docs + /music. Returns a single
 * array of {fullPath, relativePath} objects.
 */
async function findAllCorpusFiles() {
  const [docsFiles, musicFiles] = await Promise.all([
    findMarkdownFiles(DOCS_DIR),
    findMarkdownFiles(MUSIC_DIR),
  ]);
  return [...docsFiles, ...musicFiles];
}

/**
 * Split markdown content into chunks by ## headers, respecting MAX_CHUNK_CHARS.
 */
function chunkMarkdown(content, filePath) {
  const chunks = [];

  // Drop YAML frontmatter before chunking. It is metadata about the document,
  // not content of it, and embedding "tldr: ..." / "image_prompt: ..." blocks
  // puts non-prose into the vector index where it competes with real answers.
  // Kept as a local regex rather than a require so the indexer stays free of
  // dependencies on the docs-rendering modules.
  const body = String(content || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  let documentTitle = null;
  const titleMatch = body.match(/^#\s+(.+)$/m);
  if (titleMatch) documentTitle = titleMatch[1].trim();

  const sections = body.split(/(?=^##\s)/m);

  const pushChunk = (text, section) => {
    if (text.trim().length < 50) return;
    chunks.push({ content: text.trim(), file: filePath, section: section || documentTitle });
  };

  const splitLongSection = (text, section) => {
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';
    for (const para of paragraphs) {
      if ((currentChunk + para).length > MAX_CHUNK_CHARS && currentChunk.length > 0) {
        pushChunk(currentChunk, section);
        currentChunk = para;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }
    pushChunk(currentChunk, section);
  };

  for (const section of sections) {
    const text = section.trim();
    if (!text) continue;
    let sectionTitle = null;
    const headerMatch = section.match(/^##\s+(.+)$/m);
    if (headerMatch) sectionTitle = headerMatch[1].trim();

    if (text.length > MAX_CHUNK_CHARS) {
      splitLongSection(text, sectionTitle);
    } else {
      pushChunk(text, sectionTitle);
    }
  }

  if (chunks.length === 0 && body.trim().length >= 50) {
    const text = body.trim();
    if (text.length > MAX_CHUNK_CHARS) {
      splitLongSection(text, documentTitle);
    } else {
      pushChunk(text, documentTitle);
    }
  }

  return chunks;
}

/**
 * Compute a deterministic sha256 of the entire corpus. Sorts by relativePath
 * (so machine-local file ordering doesn't affect the hash) and hashes
 * (relativePath, contentHash) pairs. Any file addition, removal, or content
 * change flips the corpus hash.
 *
 * ~334 files @ ~2KB average = well under a second on modern hardware.
 */
async function computeCorpusHash(files) {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const fileHashes = await Promise.all(
    sorted.map(async (f) => {
      const content = await fs.readFile(f.fullPath);
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');
      return `${f.relativePath}\0${contentHash}`;
    })
  );

  return crypto.createHash('sha256').update(fileHashes.join('\0')).digest('hex');
}

module.exports = {
  PROJECT_ROOT,
  DOCS_DIR,
  MUSIC_DIR,
  MAX_CHUNK_CHARS,
  findMarkdownFiles,
  findAllCorpusFiles,
  chunkMarkdown,
  computeCorpusHash,
};
