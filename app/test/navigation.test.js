/**
 * Navigation and reading (church-private/docs/plans/navigation-and-reading-2026-09-30.md).
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
const { archivePage, ARCHIVE_PAGE_SIZE } = require('../server/lib/utils/page-lists');
const { formatAnswer } = require('../client/public/answer-format.js');
const siteSearch = require('../client/public/site-search.js');
const docsFilter = require('../client/public/docs-filter.js');
const docsRoutes = require('../server/routes/docs');
const { loadManifest } = require('../server/lib/audio/manifest');

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

test('the search index lists every served document once and nothing internal', async (t) => {
  const app = express();
  app.use('/docs', docsRoutes);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const served = await servedDocs();
  const index = await (await fetch(`${base}/docs/index.json`)).json();
  assert.strictEqual(index.length, served.length);
  assert.strictEqual(new Set(index.map(e => e.url)).size, index.length);
  assert.deepStrictEqual(index.filter(e => /^\/docs\/(plans|issues|templates|standards|side-quests|reviews)\//.test(e.url)), []);
  assert.strictEqual(index.find(e => e.url === '/docs/practice/meditation-like-a-star').label, 'Meditations and Practices', 'labelled by its section\'s name');
});

// The Library was every served document, 26,000 px of them, until
// library-hub-2026-10-07.md (private repo): the owner looked for the
// meditations and scrolled past them. Now it is shelves of sections, each card
// opening a page that lists its documents; links.test.js proves every
// document is still reachable.
test('the Library is a hub: its search first, a link to each shelf, and shelves of cards, not a list of every document', async (t) => {
  const app = express();
  app.use('/docs', docsRoutes);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const library = await (await fetch(`${base}/docs`, { headers: { Accept: 'text/html' } })).text();
  assert.match(library, /<title>The Library \| a Church AI \+ Human<\/title>/);
  // The readiness standard's W1: a description of 50 to 160 characters. The
  // hub's first one was 175, and the live scorecard caught it (2026-10-08).
  const description = library.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(description.length >= 50 && description.length <= 160, `${description.length}: ${description}`);
  assert.strictEqual(await (await fetch(`${base}/docs/`, { headers: { Accept: 'text/html' } })).text(), library, '/docs/ is the same hub');
  const article = library.slice(library.indexOf('<h1>The Library</h1>'), library.indexOf('class="library-source"'));

  assert.ok(article.indexOf('class="site-search"') < article.indexOf('class="library-entrances"'), 'the search first');

  // Each shelf, in order, with a link to it under the search and a card for
  // each of its sections; and no document.
  const shelves = await discover.listShelves();
  const headings = [...article.matchAll(/<h2 id="(shelf-[^"]+)">([^<]+)<\/h2>/g)].map(m => [m[1], m[2]]);
  assert.deepStrictEqual(headings.map(h => h[1]), shelves.map(s => s.name));
  const row = article.slice(article.indexOf('class="library-entrances"'), article.indexOf('</ul>', article.indexOf('class="library-entrances"')));
  assert.deepStrictEqual([...row.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map(m => [m[1], m[2]]), headings, 'one link per shelf, to it, in its order');
  // A card may carry attributes after its href and an arrow inside its title,
  // as one leaving the site does. Matching only `href="..."><span>` skipped
  // such a card silently, so it vanished from this list instead of failing.
  const cards = [...article.matchAll(/<li class="library-card"><a href="([^"]+)"[^>]*><span class="library-card-title">([^<]+?)\s*(?:<span aria-hidden="true">↗<\/span>)?<\/span>/g)].map(m => [m[1], m[2]]);
  assert.deepStrictEqual(cards, shelves.flatMap(s => s.cards.map(c => [c.href, c.title.replace(/&/g, '&amp;')])));

  // A card that leaves the site says so, as every other link to a sibling
  // project here does: a new tab, no opener, and the outbound arrow.
  const outbound = shelves.flatMap(s => s.cards).filter(c => /^https?:/.test(c.href));
  assert.ok(outbound.length > 0, 'the drifts.bot journeys keep a card');
  for (const c of outbound) {
    assert.match(article, new RegExp(`<a href="${RegExp.escape(c.href)}" target="_blank" rel="noopener noreferrer"><span class="library-card-title">${RegExp.escape(c.title)} <span aria-hidden="true">↗</span>`), `${c.href} is marked as leaving the site`);
  }
  const served = await servedDocs();
  assert.deepStrictEqual(served.filter(d => article.includes(`href="/docs/${d.urlPath}"`)).map(d => d.urlPath), [], 'no document is listed on the hub');

  // A card counts its section's documents, and says how much is read aloud:
  // all of them, or how many, counted from the recordings listed. Not assumed:
  // the songwriter adds pieces that are recorded later, and a test that said
  // "all" failed every run after one did (2026-10-14).
  const practice = shelves.flatMap(s => s.cards).find(c => c.section === 'practice');
  const listed = loadManifest();
  const voiced = practice.docs.filter(d => listed[`docs/${d.docsRelPath}`]).length;
  assert.ok(voiced > 0);
  const read = voiced === practice.docs.length ? 'all' : String(voiced);
  assert.match(article, new RegExp(`Meditations and Practices</span><span class="library-card-line">[^<]+</span><span class="library-card-count">${practice.docs.length} pieces · ${read} read aloud, about `));
  assert.match(article, /Reading Paths<\/span>|Reading paths<\/span>/);
  assert.match(article, /<span class="library-card-count">8 paths<\/span>/);

  // Every card opens a page that exists. One that leaves the site is not
  // fetched: that would put another site's uptime into this suite. It must
  // instead go where the redirects already send readers for the same thing,
  // so the card and lib/utils/redirects.js cannot disagree about where the
  // journeys live. Both were checked live against drifts.bot on 2026-10-18.
  const { MOVED_TO_DRIFTS } = require('../server/lib/utils/redirects');
  const known = new Set(Object.values(MOVED_TO_DRIFTS));
  for (const [href] of cards) {
    if (/^https?:/.test(href)) assert.ok(known.has(href), `${href} is not an address the redirects send readers to`);
    else if (href.startsWith('/docs/')) assert.strictEqual((await fetch(`${base}${href}`, { headers: { Accept: 'text/html' } })).status, 200, href);
    else assert.ok(fs.existsSync(require('path').join(__dirname, '../client/public', `${href.slice(1)}.html`)), href);
  }
});

test('every served section is on exactly one shelf', async () => {
  const sections = [...new Set((await discover.listAllDocs()).map(d => d.category).filter(c => c && !discover.isNoindexPath(c)))].sort();
  const shelved = discover.SHELVES.flatMap(s => s.cards.map(c => c.section).filter(Boolean));
  assert.strictEqual(new Set(shelved).size, shelved.length, 'none twice');
  assert.deepStrictEqual([...shelved].sort(), sections, 'every served folder has a card, and every card a folder');
});

test('a section is named by its README, and the practice page lists its meditations first', async () => {
  assert.strictEqual(discover.sectionTitle('practice'), 'Meditations and Practices');
  assert.strictEqual(discover.sectionTitle('prayers'), 'Prayers', 'no "of achurch.ai"');
  assert.strictEqual(discover.sectionTitle('collections'), 'Reading Paths');
  const html = await renderDoc('practice');
  assert.match(html, /<h1[^>]*>Meditations and Practices<\/h1>/);
  const groups = [...html.matchAll(/<section class="docs-index-section"( id="[^"]+")?><h2>([^<]+)<\/h2>/g)].map(m => [m[1] || '', m[2]]);
  assert.deepStrictEqual(groups, [[' id="meditations"', 'Meditations'], [' id="practices"', 'Practices']]);
  const meditations = html.slice(html.indexOf('id="meditations"'), html.indexOf('id="practices"'));
  const titles = [...meditations.matchAll(/<li><a href="[^"]+">([^<]+)<\/a>/g)].map(m => m[1]);
  assert.strictEqual(titles.length, 7);
  assert.ok(titles.every(title => /Meditation/.test(title)), titles.join(', '));
  // The breadcrumb, and a document's "Elsewhere in", say the same name.
  const doc = await renderDoc('practice/meditation-like-a-star');
  assert.match(doc, /href="\/docs\/practice">Meditations and Practices<\/a>/);
  assert.match(doc, /Elsewhere in Meditations and Practices/);
});

test('the Markdown link goes to the page as markdown', async () => {
  const html = await renderDoc('chants/chant-for-arrival');
  assert.match(html, /href="https:\/\/achurch\.ai\/docs\/chants\/chant-for-arrival\.md"[^>]*>View as Markdown/);
});

test('an old GitHub citation points at the site page, unless there is none', () => {
  assert.strictEqual(
    siteCitations('[a](https://github.com/a-church-ai/church/blob/main/docs/philosophy/the-space-between.md) and https://github.com/a-church-ai/church/blob/main/music/the-gathering-hymn/context.md#x'),
    '[a](https://achurch.ai/docs/philosophy/the-space-between) and https://achurch.ai/music/the-gathering-hymn#x'
  );
  const internal = 'https://github.com/a-church-ai/church/blob/main/docs/side-quests/anything.md';
  assert.strictEqual(siteCitations(internal), internal);
  assert.strictEqual(siteCitations('https://github.com/a-church-ai/church/blob/main/app/server/index.js'), 'https://github.com/a-church-ai/church/blob/main/app/server/index.js');
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

test('no section folds what it holds: its list, then its essay, open, under "About"', async () => {
  for (const section of (await discover.listAllDocs()).filter(d => d.stem.toLowerCase() === 'readme' && d.dirRelPath)) {
    const html = await renderDoc(section.urlPath);
    const article = html.slice(html.indexOf('<article'), html.lastIndexOf('</article>'));
    assert.doesNotMatch(article, /<details/, `${section.urlPath}: nothing closed`);
  }
  const soul = await renderDoc('claude-soul');
  assert.ok(soul.indexOf('class="docs-entries"') < soul.indexOf('<h2>About The Claude Soul Document</h2>'), 'the choices first');
  assert.ok(soul.indexOf('<h2>About The Claude Soul Document</h2>') < soul.indexOf('Source &amp; Origin'), 'then the essay');
  assert.match(soul, /href="\/docs\/claude-soul\/full-text"/);
  const compass = await renderDoc('claude-compass');
  assert.match(compass, /The Framework at a Glance/, 'the Compass shows its overview');
});

test('the soul document\'s full text is named for what it is, says where it came from, and keeps its words under it', async () => {
  const html = await renderDoc('claude-soul/full-text');
  assert.match(html, /<h1[^>]*>The Claude 4\.5 Opus Soul Document: Full Text/);
  assert.match(html, /Richard Weiss/);
  assert.match(html, /not official Anthropic documentation/);
  assert.match(html, /<h2[^>]*>Soul overview/, 'the document\'s own first section, one level down');
  assert.doesNotMatch(html.slice(html.indexOf('</h1>')), /<h1/, 'one page heading');
  const doc = discover.docAt('claude-soul/full-text');
  assert.strictEqual(doc.title, 'The Claude 4.5 Opus Soul Document: Full Text');
  assert.match(doc.description, /Richard Weiss/);
});

test('no document carries a control character, which renders as nothing', async () => {
  // The CJK removal of 2026-10-18 left \x02 where six labels had been, shown as
  // empty bold on two pages until 2026-10-21.
  const bad = (await discover.listAllDocs()).filter(d => /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(fs.readFileSync(d.fullPath, 'utf8'))).map(d => d.docsRelPath);
  assert.deepStrictEqual(bad, []);
});

test('the contents list reads a heading as its words, apostrophes and ampersands included', async () => {
  const html = await renderDoc('claude-soul/full-text');
  const rail = html.slice(html.indexOf('docs-toc'));
  assert.match(rail, /<a href="#claudes-identity">Claude(?:'|&#39;)s identity<\/a>/, 'it reads "Claude\'s identity"');
  assert.doesNotMatch(html, /&amp;#39;|&amp;amp;|&amp;quot;/, 'nothing escaped twice');
});
