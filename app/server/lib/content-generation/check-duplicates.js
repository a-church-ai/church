/**
 * What the sanctuary has already written about each theme, asked of the live
 * corpus: each theme's search phrase goes to production's /api/search (the
 * public operation in lib/api/search.js), which embeds it and searches the
 * deployed index, the writing a new piece would join. It needs no key and no
 * local index, so it runs the same on a laptop and in CI.
 */

const { SITE_URL } = require('../docs/links');

// search scores each document by its nearest passage, 1 - cosine distance.
// Above 0.825 (a distance under 0.175) the theme is already covered: the
// cutoff this check has always used.
const COVERED_SCORE = 0.825;
const RESULTS_PER_THEME = 3;
const TIMEOUT_MS = 30 * 1000;

// One search per theme, all at once. A search that fails fails the check,
// since every theme asks the same endpoint; the caller decides without it.
async function checkDuplicates(themes, { site = SITE_URL, get = fetch, log = console.log } = {}) {
  log('Checking existing content coverage...');
  const coverage = await Promise.all((themes.themes || []).map(async (theme) => {
    const url = `${site}/api/search?q=${encodeURIComponent(theme.searchQuery)}&limit=${RESULTS_PER_THEME}`;
    const res = await get(url, {
      headers: { 'user-agent': 'achurch-songwriter', accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`search answered ${res.status} for "${theme.searchQuery}"`);
    const { results = [] } = await res.json();
    const existingDocs = results.map((r) => ({ id: r.path, section: r.section, score: r.score, excerpt: r.excerpt }));
    return { theme: theme.name, searchQuery: theme.searchQuery, existingDocs, wellCovered: existingDocs.length > 0 && existingDocs[0].score > COVERED_SCORE };
  }));
  for (const c of coverage) {
    const nearest = c.existingDocs[0];
    log(`  "${c.theme}": ${c.wellCovered ? 'COVERED' : 'GAP'} (nearest: ${nearest ? `${nearest.id} ${nearest.score}` : 'none'})`);
  }
  return coverage;
}

module.exports = { checkDuplicates, COVERED_SCORE };
