#!/usr/bin/env node
/**
 * Audit the TLDR meta description derived for every doc in the corpus.
 *
 * Reports the distribution of sources (frontmatter / derived / fallback),
 * every page whose TLDR fails the validation gate, and the length spread.
 * Anything listed under FAILING wants an explicit `tldr:` in that file's
 * frontmatter, which always wins over derivation.
 *
 * Usage:
 *   node scripts/audit-tldr.js            # summary + failures
 *   node scripts/audit-tldr.js --all      # every page's TLDR
 *   node scripts/audit-tldr.js --json     # machine-readable
 */

const fs = require('fs');
const tldr = require('../server/lib/docs/tldr');
const { findMarkdownFiles, DOCS_DIR } = require('../server/lib/rag/indexer');

const showAll = process.argv.includes('--all');
const asJson = process.argv.includes('--json');

(async () => {
  const files = (await findMarkdownFiles(DOCS_DIR)).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath));

  const rows = files.map((f) => {
    const markdown = fs.readFileSync(f.fullPath, 'utf8');
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const result = tldr.extractTldr(markdown, {
      title: titleMatch ? titleMatch[1].trim() : null,
    });
    return { path: f.relativePath, ...result };
  });

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const bySource = rows.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});
  const failing = rows.filter(r => !r.valid);
  const lengths = rows.map(r => r.text.length).sort((a, b) => a - b);
  const pct = p => lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * p))];

  console.log(`TLDR audit: ${rows.length} docs\n`);
  console.log('source:');
  for (const [k, v] of Object.entries(bySource)) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log(`\nlength: min=${lengths[0]} p25=${pct(0.25)} median=${pct(0.5)} p75=${pct(0.75)} max=${lengths[lengths.length - 1]}`);
  console.log(`over ${tldr.MAX_CHARS} chars: ${rows.filter(r => r.text.length > tldr.MAX_CHARS).length}`);
  console.log(`containing a horizontal rule: ${rows.filter(r => /(^|\s)-{3,}(\s|$)/.test(r.text)).length}`);
  console.log(`containing markup or rejected punctuation: ${rows.filter(r => /[*_`#|<>]|\]\(|[—…]|;/.test(r.text)).length}`);

  console.log(`\nfailing the gate: ${failing.length}`);
  for (const r of failing) {
    console.log(`  [${r.issues.join(',')}] ${r.path}`);
    console.log(`      ${r.text.slice(0, 120)}`);
  }

  if (showAll) {
    console.log('\nall:');
    for (const r of rows) {
      console.log(`  ${String(r.text.length).padStart(3)} ${r.source.padEnd(11)} ${r.path}`);
      console.log(`      ${r.text}`);
    }
  }

  process.exitCode = failing.length > 0 ? 1 : 0;
})();
