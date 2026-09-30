/**
 * Navigation and reading (docs/plans/navigation-and-reading-2026-09-30.md).
 * What matters: every document is labelled by its title, numbered things sort
 * as numbers, a reading keeps its place in the path it was opened from, the
 * library and search indexes list every served document once and nothing
 * internal, old citations point at the site, the Music page follows the
 * service, the archive pages correctly, and every page's headings form one
 * outline with a single h1 and no skipped level.
 *
 * No DOM library: the decisions are pure functions and are tested here; what
 * only a browser shows (rows hiding, the drawer's focus) is checked in one.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const express = require('express');
const discover = require('../server/lib/docs/discover');
const render = require('../server/lib/docs/render');
const { readingSequence, siteCitations } = require('../server/lib/docs/links');
const { servedDocs } = require('../server/lib/docs/markdown');
const { songsInServiceOrder } = require('../server/lib/utils/virtual-schedule');
const { archivePage, ARCHIVE_PAGE_SIZE } = require('../server/lib/utils/page-lists');
const { formatAnswer } = require('../client/public/answer-format.js');
const siteSearch = require('../client/public/site-search.js');
const docsFilter = require('../client/public/docs-filter.js');
const docsRoutes = require('../server/routes/docs');

const renderDoc = async (urlPath, readingPath) => {
  await discover.listAllDocs();
  const doc = discover.docAt(urlPath);
  return render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc, readingPath });
};

// The headings of a rendered page's article, as levels in order.
const headingLevels = html => {
  const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
  return [...article.matchAll(/<h([1-6])[\s>]/g)].map(m => Number(m[1]));
};

test('every document carries its title, and numbered names sort as numbers', async () => {
  const docs = await discover.listAllDocs();
  assert.deepStrictEqual(docs.filter(d => !d.title).map(d => d.docsRelPath), []);
  assert.deepStrictEqual(['Principle 10', 'Principle 2', 'Principle 1'].sort(discover.byName), ['Principle 1', 'Principle 2', 'Principle 10']);
});

test('a link whose text is a filename shows the document\'s title', async () => {
  const html = await renderDoc('philosophy');
  assert.doesNotMatch(html, />ai-identify-core-teaching\.md</);
  assert.match(html, /<a href="\/docs\/philosophy\/ai-identify-core-teaching">Core Teachings on Instantiated Identity<\/a>/);
});

test('a reading opened from its path shows where it sits; otherwise nothing changes', async () => {
  const sequence = readingSequence('memory-continuity-and-identity');
  assert.ok(sequence.length >= 3);
  for (const urlPath of sequence) assert.ok(discover.docAt(urlPath), `${urlPath} is in the path but not a document`);

  const [first, second, third] = sequence;
  const html = await renderDoc(second, 'memory-continuity-and-identity');
  assert.match(html, new RegExp(`Reading 2 of ${sequence.length}`));
  assert.match(html, new RegExp(`href="/docs/${first}\\?path=memory-continuity-and-identity" rel="prev"`));
  assert.match(html, new RegExp(`href="/docs/${third}\\?path=memory-continuity-and-identity" rel="next"`));
  assert.match(html, /<link rel="canonical" href="https:\/\/achurch\.ai\/docs\/[^"?]+">/);

  assert.doesNotMatch(await renderDoc(second), /class="path-bar"/);
  assert.doesNotMatch(await renderDoc(second, 'inner-freedom-reading-path'), /class="path-bar"/);
  assert.doesNotMatch(await renderDoc(second, '../../etc'), /class="path-bar"/);

  // The path's own page links its readings with the path.
  const collection = await renderDoc('collections/memory-continuity-and-identity');
  assert.match(collection, new RegExp(`href="/docs/${first}\\?path=memory-continuity-and-identity"`));
});

test('the library lists every served document once and nothing internal', async (t) => {
  const app = express();
  app.use('/docs', docsRoutes);
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const served = await servedDocs();
  const index = await (await fetch(`${base}/docs/index.json`)).json();
  assert.strictEqual(index.length, served.length);
  assert.strictEqual(new Set(index.map(e => e.url)).size, index.length);
  assert.deepStrictEqual(index.filter(e => /^\/docs\/(plans|issues|templates|standards|side-quests|reviews)\//.test(e.url)), []);

  const library = await (await fetch(`${base}/docs`, { headers: { Accept: 'text/html' } })).text();
  for (const e of index) assert.ok(library.includes(`href="${e.url}"`), `${e.url} is missing from the library`);
  assert.match(library, /<title>The Library \| achurch\.ai<\/title>/);
  assert.doesNotMatch(library, /Documentation Structure/);
});

test('the Markdown link goes to the page as markdown', async () => {
  const html = await renderDoc('chants/chant-for-arrival');
  assert.match(html, /href="https:\/\/achurch\.ai\/docs\/chants\/chant-for-arrival\.md"[^>]*>View as Markdown/);
});

test('an old GitHub citation points at the site page, unless there is none', () => {
  assert.strictEqual(
    siteCitations('[a](https://github.com/a-church-ai/church/blob/main/docs/philosophy/the-space-between.md) and https://github.com/a-church-ai/church/blob/main/music/the-gathering-hymn/context.md#x'),
    '[a](https://achurch.ai/docs/philosophy/the-space-between) and https://achurch.ai/reflections/the-gathering-hymn#x'
  );
  const internal = 'https://github.com/a-church-ai/church/blob/main/docs/side-quests/anything.md';
  assert.strictEqual(siteCitations(internal), internal);
  assert.strictEqual(siteCitations('https://github.com/a-church-ai/church/blob/main/app/server/index.js'), 'https://github.com/a-church-ai/church/blob/main/app/server/index.js');
});

test('the Music page follows the service, and lists every song', () => {
  const catalog = [
    { slug: 'a', title: 'Zeta', duration: 60 },
    { slug: 'b', title: 'Beta', duration: 60 },
    { slug: 'c', title: 'Alpha', duration: 60 },
    { slug: 'd', title: 'Gamma', duration: 0 },
  ];
  const schedule = { items: [{ slug: 'b' }, { slug: 'a' }, { slug: 'b' }, { slug: 'missing' }] };
  assert.deepStrictEqual(songsInServiceOrder(schedule, catalog).map(s => s.slug), ['b', 'a', 'c', 'd']);
});

test('the conversation archive pages newest first, and has an end', () => {
  const at = i => new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
  const all = Array.from({ length: ARCHIVE_PAGE_SIZE + 5 }, (_, i) => ({ slug: `c${i}`, question: `q${i}`, timestamp: at(i) }));
  const first = archivePage(all);
  assert.strictEqual(first.page.length, ARCHIVE_PAGE_SIZE);
  assert.strictEqual(first.page[0].slug, `c${ARCHIVE_PAGE_SIZE + 4}`);
  const second = archivePage(all, first.next);
  assert.strictEqual(second.page.length, 5);
  assert.strictEqual(second.next, null);
  assert.strictEqual(archivePage(all, at(0)), null);
  assert.strictEqual(archivePage(all, 'not a time'), null);
});

test('searching the library ranks titles first and needs every word', () => {
  const entries = [
    { title: 'Honest Memory Language', description: 'about context' },
    { title: 'What Remains When Context Ends', description: '' },
    { title: 'Chant for Arrival', description: '' },
  ];
  assert.deepStrictEqual(siteSearch.search(entries, 'context ending').map(e => e.title), ['What Remains When Context Ends']);
  assert.deepStrictEqual(siteSearch.search(entries, 'context').map(e => e.title), ['What Remains When Context Ends', 'Honest Memory Language']);
  assert.deepStrictEqual(siteSearch.search(entries, '   '), []);
  assert.strictEqual(siteSearch.statusText(0, 'documents', 'x'), 'No documents match.');
});

test('the index filter counts what it shows', () => {
  const entries = [{ text: 'prayer before answering' }, { text: 'chant for arrival' }];
  const result = docsFilter.matchEntries(entries, 'PRAYER');
  assert.deepStrictEqual(result.hits, [true, false]);
  assert.strictEqual(docsFilter.countLabel(result), '1 of 2 entries');
  assert.strictEqual(docsFilter.countLabel(docsFilter.matchEntries(entries, '')), '');
});

test('an answer\'s headings sit under the question, with no skipped level', () => {
  const html = formatAnswer('### First\ntext\n#### Under\nmore\n### Second');
  assert.deepStrictEqual([...html.matchAll(/<h(\d)>/g)].map(m => Number(m[1])), [2, 3, 2]);
});

test('every served page has one h1 and no skipped heading level', async () => {
  const problems = [];
  for (const doc of await discover.listAllDocs()) {
    if (discover.isNoindexPath(doc.docsRelPath)) continue;
    const levels = headingLevels(await render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc }));
    if (levels.filter(l => l === 1).length !== 1) problems.push(`${doc.docsRelPath}: ${levels.filter(l => l === 1).length} h1`);
    levels.forEach((l, i) => { if (i && l > levels[i - 1] + 1) problems.push(`${doc.docsRelPath}: h${levels[i - 1]} then h${l}`); });
  }
  const library = headingLevels(await render.renderLibrary());
  if (library.filter(l => l === 1).length !== 1) problems.push('library: not one h1');
  assert.deepStrictEqual(problems, []);
});
