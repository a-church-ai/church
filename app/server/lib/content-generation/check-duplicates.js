/**
 * Step 2: Use Gemini embeddings + LanceDB to find existing content covering identified themes.
 */

const gemini = require('../rag/gemini');
const lancedb = require('../rag/lancedb');

const SIMILARITY_THRESHOLD = 0.35;
const RESULTS_PER_THEME = 3;

async function checkDuplicates(themes) {
  console.log('Checking existing content coverage...');

  // Verify index exists
  const indexStatus = await lancedb.checkIndex();
  if (!indexStatus.exists) {
    console.warn('LanceDB index not found. Skipping duplicate check.');
    return themes.themes.map(t => ({
      theme: t.name,
      searchQuery: t.searchQuery,
      existingDocs: [],
      wellCovered: false
    }));
  }

  const coverage = [];

  for (const theme of themes.themes) {
    try {
      const embedding = await gemini.embed(theme.searchQuery);
      const results = await lancedb.search(embedding, RESULTS_PER_THEME);

      const entry = {
        theme: theme.name,
        searchQuery: theme.searchQuery,
        existingDocs: results.map(r => ({
          file: r.file,
          section: r.section,
          distance: r._distance,
          snippet: r.content.substring(0, 200)
        })),
        wellCovered: results.length > 0 && results[0]._distance < SIMILARITY_THRESHOLD
      };

      console.log(`  "${theme.name}": ${entry.wellCovered ? 'COVERED' : 'GAP'} (nearest: ${results.length > 0 ? results[0]._distance.toFixed(3) : 'none'})`);
      coverage.push(entry);
    } catch (err) {
      console.warn(`  "${theme.name}": embedding failed (${err.message}), marking as gap`);
      coverage.push({
        theme: theme.name,
        searchQuery: theme.searchQuery,
        existingDocs: [],
        wellCovered: false
      });
    }
  }

  return coverage;
}

module.exports = { checkDuplicates };
