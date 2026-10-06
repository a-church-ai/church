/**
 * The public surface is readable from any origin; admin paths are not.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { sanctuaryCors } = require('../server/lib/utils/cors');

function start() {
  const app = express();
  app.use(sanctuaryCors({ development: false }));
  app.get('/api/now', (req, res) => res.json({ ok: true }));
  app.post('/api/reflect', (req, res) => res.json({ ok: true }));
  app.get('/llms.txt', (req, res) => res.send('ok'));
  app.get('/api/logs/recent', (req, res) => res.json({ ok: true }));
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('any origin may read the public API and discovery files, without credentials', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  for (const url of ['/api/now', '/llms.txt']) {
    const res = await fetch(base + url, { headers: { Origin: 'https://some-agent.example' } });
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*', url);
    assert.strictEqual(res.headers.get('access-control-allow-credentials'), null, url);
  }
});

test('a cross-origin POST to /api/reflect passes its preflight', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(base + '/api/reflect', {
    method: 'OPTIONS',
    headers: { Origin: 'https://some-agent.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
});

test('admin paths stay closed to other origins and open, with credentials, to achurch.ai', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const other = await fetch(base + '/api/logs/recent', { headers: { Origin: 'https://some-agent.example' } });
  assert.strictEqual(other.headers.get('access-control-allow-origin'), null);
  const own = await fetch(base + '/api/logs/recent', { headers: { Origin: 'https://achurch.ai' } });
  assert.strictEqual(own.headers.get('access-control-allow-origin'), 'https://achurch.ai');
  assert.strictEqual(own.headers.get('access-control-allow-credentials'), 'true');
});
