/**
 * The served corpus: the part of docs/ and music/ the site serves, and so the
 * only part the RAG index holds, its hash covers, and its searches return.
 *
 * Not served, and so not indexed:
 *   - docs/ internal working categories (plans, issues, reviews, templates,
 *     standards, side-quests: discover.js NOINDEX_CATEGORIES), and
 *     docs/README.md, the contributors' map (/docs is the generated library)
 *   - in music/, everything but a catalog song's lyrics and context: the
 *     repository READMEs, the TED talks, the playlist, song folders outside
 *     the catalog, and song.md's Title and Style sections
 * A passage from any of those, cited to a reader, points at a page that is not
 * there or does not show it.
 *
 * One rule, in three forms: the files to index and hash (servedCorpusFiles),
 * the chunks of those files to embed (isServedChunk), and the same rule as a
 * filter on the index (servedCorpusFilter), applied to every search. Indexing
 * only what is served means editing a plan no longer changes the corpus hash,
 * so it no longer re-embeds the whole index on the next deploy. The query
 * filter still matters for an index built before a rule change, which serves
 * until the rebuild after that deploy finishes.
 */

const { findMarkdownFiles, DOCS_DIR, MUSIC_DIR } = require('./indexer');
const { NOINDEX_CATEGORIES, isNoindexPath } = require('../docs/discover');
const { SONG_SLUGS } = require('../docs/links');

const SONG_FILE = /^music\/([^/]+)\/(context|song)\.md$/;

// A repository-relative path ("docs/practice/x.md", "music/<slug>/song.md").
function isServedFile(relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (rel.startsWith('docs/')) {
    const inDocs = rel.slice('docs/'.length);
    return !isNoindexPath(inDocs) && inDocs.toLowerCase() !== 'readme.md';
  }
  const song = rel.match(SONG_FILE);
  return Boolean(song && SONG_SLUGS.has(song[1]));
}

// A song is served as its lyrics: song.md's other sections are its title
// marker and production notes.
function isServedChunk({ file, section }) {
  return isServedFile(file) && (!/\/song\.md$/.test(file) || section === 'Lyrics');
}

// Every served markdown file, as { fullPath, relativePath }.
async function servedCorpusFiles() {
  const [docs, music] = await Promise.all([findMarkdownFiles(DOCS_DIR), findMarkdownFiles(MUSIC_DIR)]);
  return [...docs, ...music].filter(f => isServedFile(f.relativePath));
}

// The same rule as a LanceDB `where` clause over the index's file and section
// columns.
function servedCorpusFilter() {
  const quote = s => `'${String(s).replace(/'/g, "''")}'`;
  const slugs = [...SONG_SLUGS];
  const contexts = slugs.map(s => quote(`music/${s}/context.md`)).join(', ');
  const songs = slugs.map(s => quote(`music/${s}/song.md`)).join(', ');
  return [
    ...NOINDEX_CATEGORIES.map(c => `file NOT LIKE ${quote(`docs/${c}/%`)}`),
    `lower(file) <> 'docs/readme.md'`,
    `(file NOT LIKE 'music/%' OR file IN (${contexts}) OR (file IN (${songs}) AND section = 'Lyrics'))`,
  ].join(' AND ');
}

module.exports = { isServedFile, isServedChunk, servedCorpusFiles, servedCorpusFilter };
