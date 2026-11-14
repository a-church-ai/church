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
 * filter on the index (servedCorpusParams), applied to every search. Indexing
 * only what is served means editing a plan no longer changes the corpus hash,
 * so it no longer re-embeds the whole index on the next deploy. The query
 * filter still matters for an index built before a rule change, which serves
 * until the rebuild after that deploy finishes.
 */

const { findMarkdownFiles, DOCS_DIR, MUSIC_DIR } = require('./indexer');
const discover = require('../docs/discover');
const { NOINDEX_CATEGORIES, isNoindexPath } = discover;
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

// The same rule as the database's search_served() reads it
// (supabase/migrations/20261110000600_search.sql): the sections kept out of
// search, the documents not yet published, and the songs whose context and
// lyrics are served.
function servedCorpusParams() {
  return {
    p_noindex: [...NOINDEX_CATEGORIES],
    p_unpublished: discover.unpublishedFiles().map(f => `docs/${f}`),
    p_songs: [...SONG_SLUGS],
  };
}

module.exports = { isServedFile, isServedChunk, servedCorpusFiles, servedCorpusParams };
