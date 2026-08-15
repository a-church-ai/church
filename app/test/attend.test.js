/**
 * /api/attend returns 200 and a usable payload.
 *
 * Written after the endpoint 500'd in production 3,215 times. The cause was one
 * discarded return value: readModifyWriteJSON returns the mutated object, the
 * handler threw it away, and the next line read a bare `attendance` that only
 * ever existed as the callback's parameter. Every request hit
 * "ReferenceError: attendance is not defined", the handler's catch turned it
 * into a 500, and nothing else noticed, because /api/now, /api/health and
 * /api/music all kept returning 200.
 *
 * Two lessons are encoded here rather than in a comment somewhere:
 *
 *   The endpoint that WRITES is the one that broke. /api/now reads the same
 *   data and was fine throughout, so a smoke test that only checked the read
 *   path would have stayed green through the whole outage.
 *
 *   The assertion is on the response, not on the internals. A test that mocked
 *   readModifyWriteJSON would have passed against the broken code, because the
 *   bug was in what the handler did with the result.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// A scratch data directory, so the test cannot append to the real attendance
// log or be affected by what is already in it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-attend-'));
process.env.DATA_DIR = scratch;
process.env.NODE_ENV = 'test';

const request = require('../server/routes/api');
const express = require('express');

function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use('/api', request);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function get(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, json, text };
}

test('GET /api/attend returns 200, not 500', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const res = await get(port, '/api/attend?name=TestAgent');

  assert.strictEqual(
    res.status, 200,
    `expected 200, got ${res.status}: ${res.text.slice(0, 300)}`,
  );
});

test('the attend payload carries what an attending agent needs', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const { status, json } = await get(port, '/api/attend?name=TestAgent');
  assert.strictEqual(status, 200);

  // recentReflections is the specific field the crash was reading. Asserting it
  // is present and an array is what pins the regression.
  assert.ok(Array.isArray(json.recentReflections), 'recentReflections is an array');
  assert.ok(json.welcome, 'has a welcome');
  assert.ok(json.congregation, 'has congregation stats');
  assert.ok(json.reflection, 'has a reflection prompt');
});

test('the optional location and timezone parameters do not break it', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  // The exact shape a real caller uses.
  const { status } = await get(
    port,
    '/api/attend?name=Parish&location=Seattle,+WA&timezone=America/Los_Angeles',
  );
  assert.strictEqual(status, 200);
});

test('a missing name is a 400, not a 500', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const { status } = await get(port, '/api/attend');
  assert.strictEqual(status, 400, 'a bad request is the caller\'s error, not ours');
});

test('attending twice in a row still works', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  // The handler mutates and rewrites the attendance file on every call, so the
  // second visit exercises the read-existing-file path that the first created.
  assert.strictEqual((await get(port, '/api/attend?name=First')).status, 200);
  assert.strictEqual((await get(port, '/api/attend?name=Second')).status, 200);
});
