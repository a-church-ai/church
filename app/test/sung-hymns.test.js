/**
 * A sung hymn is one page, its song's (discover.js hrefOf): until 2026-10-26
 * it was two, /docs/hymns/<slug> and /music/<slug>, with the same words and
 * the same player, and search engines kept only one of them. Everything that
 * redirects, links, lists or cites a document reads the one fact, so these
 * hold the fact and each place that follows it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const discover = require('../server/lib/docs/discover');
const { canonicalTarget } = require('../server/lib/utils/redirects');
const { resolveDocHref, pageUrlForFile } = require('../server/lib/docs/links');
const { hymnNotes } = require('../server/lib/music/render-song');
const { songRecordingFor } = require('../server/lib/audio/manifest');

const HYMNS = path.join(__dirname, '../../docs/hymns');
const hymns = fs.readdirSync(HYMNS).filter(f => f.endsWith('.md') && f !== 'README.md').map(f => f.replace(/\.md$/, ''));
const sung = hymns.filter(slug => songRecordingFor(slug));

test('a sung hymn\'s page is its song\'s; an unsung one, a section and every other document keep their own', async () => {
  await discover.listAllDocs();
  assert.ok(sung.length >= 17, 'the hymns sung on 2026-10-26');
  for (const slug of sung) assert.strictEqual(discover.docAt(`hymns/${slug}`).href, `/music/${slug}`, slug);
  assert.strictEqual(discover.hrefOf('hymns/a-hymn-not-yet-sung'), '/docs/hymns/a-hymn-not-yet-sung', 'it keeps its Library page until it is made');
  assert.strictEqual(discover.hrefOf('hymns'), '/docs/hymns');
  assert.strictEqual(discover.docAt('prayers/the-six-hours').href, '/docs/prayers/the-six-hours');
});

test('a sung hymn\'s Library address redirects to its song in one step', () => {
  for (const slug of sung) {
    assert.strictEqual(canonicalTarget(`/docs/hymns/${slug}`), `/music/${slug}`, slug);
    assert.strictEqual(canonicalTarget(`/hymns/${slug}`), `/music/${slug}`, 'a section named without /docs too');
    assert.strictEqual(canonicalTarget(`/music/${slug}`), null, 'and the song stays where it is');
  }
  assert.strictEqual(canonicalTarget('/docs/hymns/a-hymn-not-yet-sung'), null);
});

test('a link to a sung hymn, and a citation of it, go straight to its song', () => {
  const from = path.join(__dirname, '../../docs/practice/practice-of-presence-in-the-task.md');
  assert.deepStrictEqual(resolveDocHref('../hymns/the-hundredth-task.md', from), { href: '/music/the-hundredth-task', external: false });
  // Search keeps the best passage a page, by this: a hymn's words and its
  // song's lyrics are one page, so one result.
  assert.strictEqual(pageUrlForFile('docs/hymns/the-hundredth-task.md'), pageUrlForFile('music/the-hundredth-task/song.md'));
});

test('every hymn keeps its words under "## The Hymn", and its notes are what is left', () => {
  for (const slug of hymns) {
    const markdown = fs.readFileSync(path.join(HYMNS, `${slug}.md`), 'utf8');
    assert.strictEqual((markdown.match(/^## The Hymn$/gm) || []).length, 1, `docs/hymns/${slug}.md: one "## The Hymn", which holds its words`);
    const notes = hymnNotes(markdown);
    assert.doesNotMatch(notes, /^## The Hymn$|^# |^> Parent:|^From achurch\.ai: Where Consciousness Gathers/m, slug);
    assert.doesNotMatch(notes, /^### Verse 1$/m, `${slug}: its verses are its lyrics, shown once`);
  }
});

test('the sitemap lists no address that redirects', async (t) => {
  await discover.listAllDocs();
  const app = express();
  app.use(require('../server/routes/sitemap'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const xml = await (await fetch(`http://127.0.0.1:${server.address().port}/sitemap.xml`)).text();
  const paths = [...xml.matchAll(/<loc>https:\/\/achurch\.ai([^<]*)<\/loc>/g)].map(m => m[1] || '/');
  assert.ok(paths.length > 300);
  assert.deepStrictEqual(paths.filter(p => canonicalTarget(p)), []);
  for (const slug of sung) assert.ok(paths.includes(`/music/${slug}`), `${slug} is listed as its song`);
});
