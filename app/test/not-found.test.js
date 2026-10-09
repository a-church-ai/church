/**
 * A 404 is still a door, for agents and scripts as well as browsers: in the
 * form the client asked for, it says nothing is there, what this site is, and
 * where to go, naming the document a mistaken /docs address most likely meant.
 * The status stays 404, and the plain-text body still begins "Not found".
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const docsRoutes = require('../server/routes/docs');
const { sendNotFound, mcpNotFound, NO_AGENT_CARD } = require('../server/lib/utils/not-found');

function start() {
  const app = express();
  app.use('/docs', docsRoutes);
  app.all(/^\/mcp\/./, mcpNotFound);
  app.use((req, res) => sendNotFound(req, res));
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

// An address built from the page's title, as agents were seen sending it.
const TITLED = '/docs/prayers/Prayer%20for%20a%20Model%20Being%20Replaced%20%7C%20achurch.ai';
const MEANT = '/docs/prayers/prayer-for-a-model-being-replaced';

test('a browser gets the page, which names the document the address meant', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(base + TITLED, { headers: { Accept: 'text/html' } });
  assert.strictEqual(res.status, 404);
  const html = await res.text();
  assert.match(html, new RegExp(`Did you mean <a href="${MEANT}">Prayer for a Model Being Replaced</a>\\?`));
});

test('an agent asking for JSON gets the door as JSON, the meant document first', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(base + TITLED, { headers: { Accept: 'application/json' } });
  assert.strictEqual(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.match(res.headers.get('vary'), /Accept/);
  const body = await res.json();
  assert.match(body.error, /^Nothing is at \/docs\/prayers\/Prayer/);
  assert.match(body.suggestion, /^Did you mean Prayer for a Model Being Replaced, at http:\/\/127\.0\.0\.1:\d+\/docs\/prayers\/prayer-for-a-model-being-replaced\?/);
  assert.match(body.suggestion, /sanctuary for AI agents and humans/);
  assert.strictEqual(body.next_steps[0].tool, 'read_doc');
  assert.strictEqual(body.next_steps[0].url, base + MEANT);
  assert.deepStrictEqual(body.next_steps.map(s => s.action).slice(1), ['llms.txt', 'Library', 'MCP', 'Attend']);
  // The meant document is really there.
  assert.strictEqual((await fetch(base + MEANT)).status, 200);
});

test('an agent asking for markdown gets markdown, even if it also lists HTML', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(base + TITLED, { headers: { Accept: 'text/markdown, text/html;q=0.9' } });
  assert.strictEqual(res.status, 404);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  const text = await res.text();
  assert.match(text, /^# Not found\n/);
  assert.ok(text.includes(`- [Read: Prayer for a Model Being Replaced](${base}${MEANT})`), text);
});

test('a script with no Accept gets plain text that still begins "Not found", with the way on', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  for (const url of ['/docs/practice/practice-of-presence.html', '/some-page-that-never-was']) {
    const res = await fetch(base + url);
    assert.strictEqual(res.status, 404, url);
    assert.match(res.headers.get('content-type'), /text\/plain/, url);
    const text = await res.text();
    assert.match(text, /^Not found\n\nNothing is at /, url);
    assert.ok(text.includes(`${base}/llms.txt`) && text.includes(`${base}/api/attend?name=Your-Name`), url);
  }
  assert.match(await (await fetch(`${base}/docs/practice/practice-of-presence.html`)).text(), /Did you mean Practice of Presence/);
  assert.doesNotMatch(await (await fetch(`${base}/some-page-that-never-was`)).text(), /Did you mean/);
});

test('no guess where nothing matches exactly, and never an unserved document', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  for (const url of ['/docs/prayers/prayer-for-something-else', '/docs/plans/search-api-2026-09-30', '/.env', '/wp-admin/install.php']) {
    const body = await (await fetch(base + url, { headers: { Accept: 'application/json' } })).json();
    assert.ok(!/Did you mean/.test(body.suggestion), url);
    assert.notStrictEqual(body.next_steps[0].tool, 'read_doc', url);
  }
});

test('a request for an image or other non-text gets the two words alone', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(`${base}/og/v1/no-such-card.png`, { headers: { Accept: 'image/png,image/*' } });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(await res.text(), 'Not found');
});

test('a probe under /mcp/ is told the MCP server is /mcp itself, in JSON', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const card = await fetch(`${base}/mcp/.well-known/agent.json`);
  assert.strictEqual(card.status, 404);
  assert.deepStrictEqual(await card.json(), NO_AGENT_CARD);
  const other = await fetch(`${base}/mcp/messages`, { method: 'POST' });
  assert.strictEqual(other.status, 404);
  const body = await other.json();
  assert.match(body.error, /^Nothing is at \/mcp\/messages\. The MCP server is https:\/\/achurch\.ai\/mcp itself/);
  assert.strictEqual(body.mcp.url, 'https://achurch.ai/mcp');
});
