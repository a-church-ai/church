#!/usr/bin/env node
/**
 * Where the writing stands against the house voice (docs/reference/conventions.md,
 * "The plain voice"), by section: em dashes, semicolons, words a sentence,
 * sentences over 30 words, repeated negatives ("Not a demo. Not a tutorial."),
 * and an approximate reading grade (Flesch-Kincaid). Served Library pages, and
 * the hand-written site pages, where an em dash is also counted as &mdash;.
 *
 * It reports and never fails: a long sentence can be the right one. The test
 * that holds the one hard rule, no em dashes, is test/plain-voice.test.js.
 *
 * Usage, from app/: npm run style            by section
 *                   npm run style -- --pages one line a page, most em dashes first
 */

const fs = require('fs');
const path = require('path');
const discover = require('../server/lib/docs/discover');
const { proseOf, sentencesOf, emDashes, RECORDS } = require('../server/lib/docs/plain-voice');

const PUBLIC = path.join(__dirname, '../client/public');

// Syllables, roughly: enough for a grade that moves the right way.
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

function measure(prose) {
  const sentences = sentencesOf(prose);
  const words = sentences.flatMap(s => s.split(/\s+/));
  return {
    dashes: emDashes(prose),
    semicolons: (prose.match(/;/g) || []).length,
    sentences: sentences.length,
    words: words.length,
    syllables: words.reduce((n, w) => n + syllables(w), 0),
    long: sentences.filter(s => s.split(/\s+/).length > 30).length,
    negatives: (prose.match(/(?:^|[.!?]\s+)Not (?:a|an|the)?\s*[^.!?\n]{1,40}\.\s+Not\b/g) || []).length,
  };
}

const add = (a, b) => Object.fromEntries(Object.keys(b).map(k => [k, (a[k] || 0) + b[k]]));
const grade = m => (m.sentences && m.words ? 0.39 * (m.words / m.sentences) + 11.8 * (m.syllables / m.words) - 15.59 : 0);

(async () => {
  const pages = [];
  for (const doc of await discover.listAllDocs()) {
    if (discover.isNoindexPath(doc.docsRelPath)) continue;
    const section = doc.docsRelPath.includes('/') ? doc.docsRelPath.split('/')[0] : '(top)';
    pages.push({ page: `docs/${doc.docsRelPath}`, section, record: RECORDS.test(doc.docsRelPath), ...measure(proseOf(fs.readFileSync(doc.fullPath, 'utf8'))) });
  }
  for (const file of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) {
    pages.push({ page: `client/public/${file}`, section: '(site pages)', record: false, ...measure(proseOf(fs.readFileSync(path.join(PUBLIC, file), 'utf8'), { html: true })) });
  }

  if (process.argv.includes('--pages')) {
    for (const p of pages.filter(p => p.dashes || p.long || p.negatives).sort((a, b) => b.dashes - a.dashes || b.long - a.long)) {
      console.log(`${String(p.dashes).padStart(4)} dashes ${String(p.long).padStart(3)} long ${String(p.negatives).padStart(2)} negatives ${p.record ? '(record) ' : ''}${p.page}`);
    }
    return;
  }

  const sections = {};
  for (const p of pages) {
    const { page, section, record, ...counts } = p;
    sections[section] = add(sections[section] || {}, { pages: 1, ...counts });
  }
  const row = (name, m) => `${name.padEnd(16)} ${String(m.pages).padStart(4)} pages  em dashes ${String(m.dashes).padStart(5)}  ; ${String(m.semicolons).padStart(4)}  words/sentence ${(m.words / (m.sentences || 1)).toFixed(1).padStart(5)}  >30 ${String(m.long).padStart(4)}  not-not ${String(m.negatives).padStart(3)}  grade ${grade(m).toFixed(1)}`;
  let all = {};
  for (const [name, m] of Object.entries(sections).sort((a, b) => b[1].pages - a[1].pages)) {
    console.log(row(name, m));
    all = add(all, m);
  }
  console.log(row('ALL', all));
})();
