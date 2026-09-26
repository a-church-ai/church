#!/usr/bin/env node
/**
 * Generate music/companions.json: a ranked shortlist of companion documents
 * for every song in music/library.json.
 *
 * Reads vectors from the local RAG index (run app/scripts/index-content.js
 * first if docs or songs changed), ranks candidates with
 * server/lib/music/companions.js, applies music/companions.overrides.json if
 * present, and writes the result. Commit the output; the diff is the review.
 *
 * Overrides (optional file), for pairings the similarity gets wrong:
 *   {
 *     "<song-slug>": { "pin": ["docs/rituals/some-ritual.md"] },
 *     "_exclude": ["docs/practice/some-practice.md"]
 *   }
 *
 * Usage: node app/scripts/generate-companions.js
 */

const fs = require('fs').promises;
const path = require('path');

const lancedb = require('../server/lib/rag/lancedb');
const indexer = require('../server/lib/rag/indexer');
const discover = require('../server/lib/docs/discover');
const companions = require('../server/lib/music/companions');
const { loadCatalog, COMPANIONS_FILE } = require('../server/lib/utils/data');

const OVERRIDES_FILE = path.join(path.dirname(COMPANIONS_FILE), 'companions.overrides.json');

async function readOverrides() {
  try {
    return JSON.parse(await fs.readFile(OVERRIDES_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Could not read ${OVERRIDES_FILE}: ${error.message}`);
  }
}

async function main() {
  const rows = await lancedb.listAll();
  if (rows.length === 0) {
    throw new Error('The RAG index is empty or missing. Run: node app/scripts/index-content.js');
  }

  const catalog = await loadCatalog();
  const slugs = catalog.map(song => song.slug);

  const allDocs = await discover.listAllDocs();
  const eligible = allDocs
    .filter(d => companions.ELIGIBLE_CATEGORIES.includes(d.category))
    .filter(d => d.stem.toLowerCase() !== 'readme')
    .map(d => ({ path: `docs/${d.docsRelPath}`, category: d.category }));
  const eligiblePaths = new Set(eligible.map(d => d.path));

  const overrides = await readOverrides();
  const excluded = new Set(overrides._exclude || []);
  const pinnedPaths = Object.entries(overrides)
    .filter(([key]) => key !== '_exclude')
    .flatMap(([, value]) => value.pin || []);
  for (const p of [...excluded, ...pinnedPaths]) {
    if (!eligiblePaths.has(p)) {
      throw new Error(`Override path is not an eligible document: ${p}`);
    }
  }
  for (const slug of Object.keys(overrides)) {
    if (slug !== '_exclude' && !slugs.includes(slug)) {
      throw new Error(`Override names a song not in library.json: ${slug}`);
    }
  }

  const songVectors = companions.songVectors(rows, slugs);
  const missing = slugs.filter(s => !songVectors.has(s));
  if (missing.length > 0) {
    console.warn(`No indexed lyrics or context for: ${missing.join(', ')}. Re-index to include them.`);
  }

  const docVectors = companions.docVectors(rows, eligible.filter(d => !excluded.has(d.path)));
  const unindexed = eligible.length - excluded.size - docVectors.length;
  if (unindexed > 0) {
    console.warn(`${unindexed} eligible documents are not in the index yet. Re-index to include them.`);
  }

  const categoryOf = p => eligible.find(d => d.path === p).category;
  const shortlists = companions.applyPins(
    companions.buildShortlists(songVectors, docVectors),
    overrides,
    categoryOf
  );

  const corpusHash = await indexer.computeCorpusHash(await indexer.findAllCorpusFiles());
  const songs = Object.fromEntries(Object.keys(shortlists).sort().map(slug => [slug, shortlists[slug]]));
  const output = { corpusHash, songs };

  await fs.writeFile(COMPANIONS_FILE, JSON.stringify(output, null, 2) + '\n');

  const uses = new Map();
  for (const list of Object.values(songs)) for (const c of list) uses.set(c.path, (uses.get(c.path) || 0) + 1);
  const categories = {};
  for (const list of Object.values(songs)) for (const c of list) categories[c.category] = (categories[c.category] || 0) + 1;
  console.log(`Wrote ${COMPANIONS_FILE}`);
  console.log(`  ${Object.keys(songs).length} songs, ${docVectors.length} candidate documents, ${uses.size} used`);
  console.log(`  shortlist entries by category: ${JSON.stringify(categories)}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
