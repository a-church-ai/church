/**
 * The docs route serves a page's markdown when its URL ends in .md.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const docsRoutes = require('../server/routes/docs');

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
  assert.strictEqual(await res.text(), fs.readFileSync(path.join(__dirname, '../../docs/chants/chant-for-arrival.md'), 'utf8'));
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
