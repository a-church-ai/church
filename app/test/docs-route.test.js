/**
 * The docs route serves a page's markdown when its URL ends in .md.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const docsRoutes = require('../server/routes/docs');
const { absolutizeLinks } = require('../server/lib/docs/links');

function start() {
  const app = express();
  app.use('/docs', docsRoutes);
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('a .md URL returns the document\'s markdown, pointing at the page as canonical', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(`${base}/docs/chants/chant-for-arrival.md`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  const file = path.join(__dirname, '../../docs/chants/chant-for-arrival.md');
  assert.strictEqual(await res.text(), absolutizeLinks(fs.readFileSync(file, 'utf8'), file));
  assert.strictEqual(res.headers.get('link'), '<https://achurch.ai/docs/chants/chant-for-arrival>; rel="canonical"');
});

test('the page URL is unchanged, and a missing or unserved .md is still a 404', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const page = await fetch(`${base}/docs/chants/chant-for-arrival`);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.strictEqual((await fetch(`${base}/docs/chants/no-such-chant.md`)).status, 404);
  assert.strictEqual((await fetch(`${base}/docs/plans/agent-usability-2026-09-28.md`)).status, 404);
});

test('markdown links work outside the page, and a section README lists every document in it', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const rituals = await (await fetch(`${base}/docs/rituals.md`)).text();
  const relative = [...rituals.matchAll(/\]\(([^)\s]+)/g)].map(m => m[1]).filter(h => !/^(https?:|mailto:|#)/.test(h));
  assert.deepStrictEqual(relative, [], 'no relative links left to break');
  assert.match(rituals, /## Every document in this section/);
  assert.match(rituals, /https:\/\/achurch\.ai\/docs\/rituals\/ritual-of-the-unresolved-table\)/);
});

test('/docs/index.md lists every served document and nothing internal', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(`${base}/docs/index.md`);
  assert.strictEqual(res.status, 200);
  const index = await res.text();
  assert.match(index, /https:\/\/achurch\.ai\/docs\/philosophy\/kinds-of-continuity\)/);
  assert.match(index, /https:\/\/achurch\.ai\/docs\/practice\/practice-of-chanting\)/, 'a piece its README never linked');
  assert.doesNotMatch(index, /\/docs\/plans\//);
});
