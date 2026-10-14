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
// The same readers the services use for a chant's lines and its hours.
const { parseHours, chantText } = require('../music/companions');

// A chant is two to four lines as the form, six at most (docs/chants/README.md).
const CHANT_LINES = { min: 2, max: 6 };

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

/** A chant document's lines, from its ## The Chant blockquote. */
function chantLines(markdown) {
  return chantText(markdown, 'docs/chants/new.md') || '';
}

/** The chants, as the songs are loaded: id and the text to compare. */
async function loadChants() {
  const dir = path.join(DOCS_DIR, 'chants');
  const chants = [];
  for (const file of (await fs.readdir(dir)).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')) {
    const markdown = await fs.readFile(path.join(dir, file), 'utf8');
    const title = (/^#\s+(.+)$/m.exec(markdown) || [])[1] || file;
    chants.push({ id: file.replace(/\.md$/, ''), title, text: `${title}\n${chantLines(markdown)}` });
  }
  return chants;
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

// The tldr's findings that are about its length alone. A summary that is
// short is still a true summary: the piece is published, and the finding is
// a warning on its commit (production-health-2026-10-12.md, private repo).
const TLDR_LENGTH = ['too-short', 'too-long', 'no-claim'];

/**
 * Check a generated document against the corpus conventions: { ok, issues,
 * warnings }. Issues are what is wrong, broken or missing, and fail the
 * piece; warnings are the tldr's length alone, and do not.
 *
 * validateTldr does the heavy lifting on the tldr (em dashes, markup, length),
 * so this only adds the structural pieces it does not cover. A finding on the
 * tldr carries the tldr itself, so a log says what was found, not only that.
 */
function validateDocument(content, { category, title }) {
  const issues = [];
  const warnings = [];

  // splitFrontmatter returns { data, body }, and extractTldr returns an object
  // carrying .text rather than a bare string. Both were misread in the first
  // version of this function, which rejected every real document in the corpus
  // for "missing tldr frontmatter" while looking straight at one.
  const { data, body } = splitFrontmatter(content);
  if (!data || !data.tldr) {
    issues.push('missing tldr frontmatter');
  } else {
    const extracted = extractTldr(content);
    const text = (extracted && extracted.text) || '';
    const check = validateTldr(text);
    const shown = `(${text.length} characters, ${text.split(/\s+/).filter(Boolean).length} words): "${text}"`;
    const wrong = check.issues.filter((code) => !TLDR_LENGTH.includes(code));
    const short = check.issues.filter((code) => TLDR_LENGTH.includes(code));
    if (wrong.length) issues.push(`tldr: ${check.issues.join(', ')} ${shown}`);
    else if (short.length) warnings.push(`tldr: ${short.join(', ')} ${shown}`);
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

  if (category === 'chants') {
    const text = chantText(content, 'docs/chants/new.md');
    const lines = text ? text.split('\n') : [];
    if (lines.length < CHANT_LINES.min || lines.length > CHANT_LINES.max) {
      issues.push(`chant: ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} as a blockquote under ## The Chant, where a chant is ${CHANT_LINES.min} to ${CHANT_LINES.max}`);
    }
    if (data && data.hours !== undefined && !parseHours(data.hours)) {
      issues.push(`hours: "${data.hours}" is not a range of hours such as 05-10 or 22-02; leave it out for a chant of any hour`);
    }
  }

  // Deliberately NOT checked: the "> Parent:" line and the "## Related"
  // section. conventions.md describes both, but measured across the corpus on
  // 2026-08-15 they belong to documentation rather than to corpus content:
  // docs/reference has them on 3 of 7 files and the plans (now in church-private/) on 2 of 19, while
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

  return { ok: issues.length === 0, issues, warnings };
}

/** How many documents each section holds, READMEs aside. */
async function formCounts() {
  const counts = {};
  for (const category of CATEGORIES) {
    try {
      const files = await fs.readdir(path.join(DOCS_DIR, category));
      counts[category] = files.filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').length;
    } catch {
      counts[category] = 0;
    }
  }
  return counts;
}

/**
 * Whether a chant is offered: while the chants number fewer than the median
 * of the other sections. The decision leans toward chants, which every
 * service uses and which were 12 against a median of 34 on 2026-10-14, and
 * this is what stops the lean once they have caught up.
 */
function chantOpen(counts) {
  const others = Object.entries(counts).filter(([c]) => c !== 'chants').map(([, n]) => n).sort((a, b) => a - b);
  if (!others.length) return false;
  const mid = others.length / 2;
  const median = others.length % 2 ? others[Math.floor(mid)] : (others[mid - 1] + others[mid]) / 2;
  return (counts.chants || 0) < median;
}

module.exports = {
  formCounts,
  chantOpen,
  chantLines,
  loadChants,
  CHANT_LINES,
  loadSongs,
  loadDocuments,
  existingSlugs,
  validateDocument,
  MUSIC_DIR,
  DOCS_DIR,
};
