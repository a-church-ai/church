/**
 * Publishing on a date: a document with `published:` in its frontmatter is
 * unlisted until then (discover.js isPublished). Its address serves it,
 * marked noindex; nothing public lists, links, searches or plays it; and at
 * its time it appears everywhere at once, with no deploy. These hold the
 * parts that decide it against the real corpus, whichever of its dated
 * documents are still to come when the tests run, so the tests stay true as
 * the dates pass.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');
const discover = require('../server/lib/docs/discover');
const { publishedAt } = require('../server/lib/docs/meta');
const { withoutUnpublished } = require('../server/lib/docs/unpublished');
const { readingSequence } = require('../server/lib/docs/links');
const { servedCorpusParams } = require('../server/lib/rag/corpus');

const DOCS = path.join(__dirname, '../../docs');

test('a publication date is a day or a time with its zone, and anything else is refused', () => {
  assert.strictEqual(publishedAt('2026-11-20'), '2026-11-20T00:00:00.000Z', 'a day is its first moment in UTC');
  assert.strictEqual(publishedAt('2026-11-20T09:00:00-05:00'), '2026-11-20T14:00:00.000Z');
  assert.strictEqual(publishedAt('"2026-11-20T14:00:00Z"'), '2026-11-20T14:00:00.000Z', 'quoted');
  assert.strictEqual(publishedAt(undefined), null, 'no date: public as always');
  assert.throws(() => publishedAt('2026-11-20T14:00'), /with its zone/, 'a time without its zone could be any hour');
  assert.throws(() => publishedAt('next Friday'), /not a date/);
});

test('an index entry, a list item or a table row leading to an unpublished document goes; a link in a sentence keeps its words', () => {
  const hidden = href => href.startsWith('/docs/prayers/soon');
  const markdown = [
    '# Prayers',
    '',
    'Read the [Soon Prayer](./soon.md) and the [Six Hours](./the-six-hours.md).',
    '',
    '### For the Season',
    '',
    'Pieces for the season.',
    '',
    '### [Soon Prayer](./soon.md)',
    'What it is.',
    '',
    '**When to use:** later',
    '',
    '### [The Six Hours](./the-six-hours.md)',
    'Six offices.',
    '',
    '| Chant | When |',
    '|---|---|',
    '| [Soon](./soon.md) | later |',
    '| [Six](./the-six-hours.md) | now |',
    '',
    '## Shorter Ways In',
    '',
    '- [Soon Prayer](./soon.md), then more',
    '  continued',
    '',
    '## Related',
    '',
    '- [Soon Prayer](./soon.md)',
    '- [The Six Hours](./the-six-hours.md)',
    '',
    '```',
    '[Soon Prayer](./soon.md)',
    '```',
    '',
    '---',
  ].join('\n');
  const out = withoutUnpublished(markdown, path.join(DOCS, 'prayers', 'README.md'), hidden);
  assert.match(out, /Read the Soon Prayer and the \[Six Hours\]\(\.\/the-six-hours\.md\)\./, 'a sentence keeps its words, and its other links');
  assert.ok(!/### \[Soon Prayer\]|What it is|When to use/.test(out), 'the entry goes, heading and all');
  assert.match(out, /### For the Season\n\nPieces for the season\./, 'a heading with words of its own stays');
  assert.match(out, /### \[The Six Hours\][\s\S]*Six offices\./);
  assert.ok(!/\| \[Soon\]/.test(out) && /\| \[Six\]/.test(out), 'the row goes, the table stays');
  assert.ok(!/## Shorter Ways In|continued/.test(out), 'a heading left with nothing under it goes, and an item takes its continuation with it');
  assert.match(out, /## Related\n\n- \[The Six Hours\]/);
  assert.match(out, /```\n\[Soon Prayer\]\(\.\/soon\.md\)\n```/, 'code is left as it is');
  assert.strictEqual(withoutUnpublished(markdown, path.join(DOCS, 'prayers', 'README.md'), () => false), markdown, 'nothing hidden, nothing changed');
});

test('a document still to come is unlisted everywhere and served at its address, noindex; one whose time has passed is public', async (t) => {
  const every = await discover.listEveryDoc();
  for (const doc of every) assert.doesNotThrow(() => doc.published && Date.parse(doc.published), doc.docsRelPath);
  const coming = every.filter(d => !discover.isPublished(d));
  const passed = every.filter(d => d.published && discover.isPublished(d));
  if (!coming.length && !passed.length) return t.skip('no dated documents');

  const listed = new Set((await discover.listAllDocs()).map(d => d.docsRelPath));
  const inSections = new Set((await discover.listSections()).flatMap(s => s.docs.map(d => d.docsRelPath)));
  const { p_unpublished: unpublished } = servedCorpusParams();
  for (const doc of coming) {
    assert.ok(!listed.has(doc.docsRelPath) && !inSections.has(doc.docsRelPath), `${doc.docsRelPath} is listed before its day`);
    assert.strictEqual(discover.docAt(doc.urlPath), null, 'nor found by address among public documents');
    assert.ok(discover.unpublishedAt(doc.href), 'and known as unpublished by its address');
    assert.ok(unpublished.includes(`docs/${doc.docsRelPath}`), 'and left out of every search');
  }
  for (const doc of passed) assert.ok(listed.has(doc.docsRelPath), `${doc.docsRelPath} is public after its day`);
  for (const name of ['the-turning-of-the-year']) {
    for (const urlPath of readingSequence(name) || []) assert.ok(!discover.unpublishedAt(discover.hrefOf(urlPath)), `${name} leads to ${urlPath} before its day`);
  }

  const app = express();
  app.use(require('../server/routes/sitemap'));
  app.use('/docs', require('../server/routes/docs'));
  const { server, base } = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${s.address().port}` }));
  });
  t.after(() => server.close());
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  const index = await (await fetch(`${base}/docs/index.json`)).json();
  for (const doc of coming) {
    assert.ok(!sitemap.includes(`https://achurch.ai${doc.href}<`), `${doc.href} is in the sitemap before its day`);
    assert.ok(!index.some(d => d.url === doc.href), `${doc.href} is in the Library's index before its day`);
  }
  const doc = coming[0] || passed[0];
  const page = await fetch(`${base}${doc.href}`);
  assert.strictEqual(page.status, 200, 'served at its address');
  const html = await page.text();
  if (coming.includes(doc)) {
    assert.strictEqual(page.headers.get('x-robots-tag'), 'noindex');
    assert.match(html, /<meta name="robots" content="noindex, follow">/);
  } else {
    assert.match(html, /<meta name="robots" content="index, follow">/);
    assert.ok(sitemap.includes(`https://achurch.ai${doc.href}<`));
  }
  assert.match(html, new RegExp(`"datePublished": ?"${doc.published.slice(0, 10)}"`), 'its structured data carries the day');
});
