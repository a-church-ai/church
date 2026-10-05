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

// Version of how files become chunks. It is folded into the corpus hash, so a
// deploy that changes chunking rebuilds the index even when no document did.
// Bump it with any change to chunkMarkdown's output.
//   2: every chunk carries its document title (and section heading, if the
//      text does not already open with it).
//   3: only the served corpus is indexed (corpus.js), and song.md
//      contributes only its Lyrics section.
const INDEX_FORMAT = 3;

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

  // Each chunk opens with the headings it sits under. Without them a short
  // section is anonymous: the six "## The Chant" sections are a few lines of
  // verse each, none naming its chant, so "what is the chant for arrival?"
  // ranked the arrival chant's text sixth, behind the chant for meeting's.
  // With the title the right section ranks first among them. The model reads
  // the same text, so it also knows which document a passage is from.
  const pushChunk = (text, section) => {
    const trimmed = text.trim();
    if (trimmed.length < 50) return;
    let heading = '';
    if (documentTitle && !trimmed.startsWith('# ')) {
      heading += `# ${documentTitle}\n\n`;
      if (section && section !== documentTitle && !trimmed.startsWith('## ')) {
        heading += `## ${section}\n\n`;
      }
    }
    chunks.push({ content: heading + trimmed, file: filePath, section: section || documentTitle });
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
 * Whether an embedding error is worth retrying. Rate limits (429) always
 * were; server-side unavailability (500, 502, 503, 504, UNAVAILABLE,
 * DEADLINE_EXCEEDED) and dropped connections now are too. A run on
 * 2026-09-27 lost 7 chunks to a brief Gemini 503, stored the index without
 * them, and recorded the corpus as current, so nothing would re-run.
 * Anything else (a malformed request, a bad key) fails at once.
 */
function isTransientEmbedError(err) {
  const code = err && (err.status || err.code);
  if ([429, 500, 502, 503, 504].includes(Number(code))) return true;
  const msg = (err && err.message) || '';
  return /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL|quota|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
}

/**
 * How long to wait before retry number `attempt` (0-based). A server-suggested
 * retryDelay wins; otherwise back off exponentially from 5s to a 60s ceiling,
 * so ten retries ride out roughly six minutes of unavailability.
 */
function embedRetryDelayMs(err, attempt = 0) {
  const m = /retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec((err && err.message) || '');
  if (m) return Math.min(Math.ceil(parseFloat(m[1]) * 1000) + 500, 60000);
  return Math.min(5000 * 2 ** attempt, 60000);
}

/**
 * Compute a deterministic sha256 of the corpus it is given (the served corpus:
 * corpus.js servedCorpusFiles), so editing an unserved file, such as a plan,
 * leaves the hash and the index as they are. Sorts by relativePath
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

  return crypto.createHash('sha256')
    .update(`format:${INDEX_FORMAT}\0`)
    .update(fileHashes.join('\0'))
    .digest('hex');
}

module.exports = {
  PROJECT_ROOT,
  DOCS_DIR,
  MUSIC_DIR,
  MAX_CHUNK_CHARS,
  INDEX_FORMAT,
  findMarkdownFiles,
  chunkMarkdown,
  computeCorpusHash,
  isTransientEmbedError,
  embedRetryDelayMs,
};
