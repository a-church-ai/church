#!/usr/bin/env node
/**
 * Strict TLDR conformance check against every rule in the distillation-tldr
 * methodology, including the ones lib/docs/tldr.js deliberately does not
 * enforce. This is a reporting tool, not a gate: it exists so the deviations
 * are measured and visible rather than assumed to be fine.
 *
 * Usage:
 *   node scripts/audit-tldr-strict.js            # counts per rule
 *   node scripts/audit-tldr-strict.js --show RULE  # list offenders for a rule
 */

const fs = require('fs');
const tldr = require('../server/lib/docs/tldr');
const { findMarkdownFiles, DOCS_DIR } = require('../server/lib/rag/indexer');

const showRule = (() => {
  const i = process.argv.indexOf('--show');
  return i > -1 ? process.argv[i + 1] : null;
})();

// Each rule: [name, test(text) -> true when the text VIOLATES the rule, note]
const RULES = [
  // --- Plain-text invariant (guide: "Rejected") ---
  ['markdown-bold', t => /\*\*|__/.test(t), 'plain-text invariant'],
  ['markdown-link', t => /\]\(|\[[^\]]*\]/.test(t), 'plain-text invariant'],
  // List markers only count at the start: a description is a single line, and
  // " + " mid-sentence ("constraint + enabler", "checklist + rationale") is
  // ordinary prose, not a bullet.
  ['markdown-other', t => /(^|\s)#|^[-*+]\s|`/.test(t), 'plain-text invariant'],
  ['html-tag', t => /<[^>]+>/.test(t), 'plain-text invariant'],
  ['media-placeholder', t => /<media:/.test(t), 'plain-text invariant'],
  ['em-dash', t => /[—–]/.test(t), 'plain-text invariant'],
  ['semicolon', t => /;/.test(t), 'plain-text invariant'],
  ['colon', t => /:/.test(t), 'plain-text invariant'],
  ['parenthesis', t => /[()]/.test(t), 'plain-text invariant'],
  ['ellipsis', t => /…|\.{3}/.test(t), 'plain-text invariant'],
  ['quotation-mark', t => /["“”]/.test(t), 'plain-text invariant'],
  ['wrapping-quotes', t => /^["“].*["”]$/.test(t), 'plain-text invariant'],

  // --- Self-containment (guide: dangling references) ---
  // A description that opens on a demonstrative or bare pronoun is pointing at
  // something the scanning reader cannot see.
  ['dangling-opener', t => /^(This|These|That|Those|It|They|Them|Its|Their|Such|Here|There)\b/i.test(t),
    'self-containment'],
  // "the practice", "the document" with no qualifier, at the start.
  ['bare-the-opener', t => /^The (practice|document|page|guide|ritual|prayer|piece|essay|note|collection|approach|idea|question|answer|problem|issue|proposal)\b/i.test(t),
    'self-containment'],

  // --- Content rules (guide: start with the substance) ---
  ['meta-commentary', t => /^(This (document|page|guide|doc|file|collection|essay|piece|practice|ritual)|The following|Below|In this (document|page|guide))\b/i.test(t),
    'start with the substance'],
  ['attribution-scaffolding', t => /^(According to|As noted|As described|As stated|It is said)\b/i.test(t),
    'skip attribution scaffolding'],

  // --- Sentence shape ---
  ['no-terminator', t => !/[.!?]$/.test(t), 'sentence format'],
  ['over-max', t => t.length > tldr.MAX_CHARS, `length <= ${tldr.MAX_CHARS}`],
  ['very-short', t => t.length < 60, 'carries a claim'],
];

(async () => {
  const files = (await findMarkdownFiles(DOCS_DIR)).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath));

  const rows = files.map((f) => {
    const markdown = fs.readFileSync(f.fullPath, 'utf8');
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const r = tldr.extractTldr(markdown, { title: titleMatch ? titleMatch[1].trim() : null });
    return { path: f.relativePath, text: r.text, source: r.source };
  });

  if (showRule) {
    const rule = RULES.find(r => r[0] === showRule);
    if (!rule) {
      console.error(`unknown rule: ${showRule}\nknown: ${RULES.map(r => r[0]).join(', ')}`);
      process.exitCode = 2;
      return;
    }
    const hits = rows.filter(r => rule[1](r.text));
    console.log(`${showRule}: ${hits.length} of ${rows.length}\n`);
    for (const h of hits) {
      console.log(`  ${h.path}`);
      console.log(`    ${h.text}`);
    }
    return;
  }

  console.log(`Strict TLDR conformance: ${rows.length} docs\n`);
  console.log('rule                       violations  requirement');
  console.log('-------------------------  ----------  -----------------------------');
  let clean = 0;
  const violationsByDoc = new Map();
  for (const [name, test, note] of RULES) {
    const hits = rows.filter(r => test(r.text));
    for (const h of hits) {
      if (!violationsByDoc.has(h.path)) violationsByDoc.set(h.path, []);
      violationsByDoc.get(h.path).push(name);
    }
    if (hits.length === 0) clean++;
    console.log(`${name.padEnd(25)}  ${String(hits.length).padStart(10)}  ${note}`);
  }
  console.log(`\nrules fully clean: ${clean} of ${RULES.length}`);
  console.log(`docs with zero violations: ${rows.length - violationsByDoc.size} of ${rows.length}`);
})();
