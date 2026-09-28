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
  app.use(express.json());
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

// --- Readings and reflections ---

const { loadCatalog } = require('../server/lib/utils/data');
const { ATTENDANCE_FILE } = require('../server/lib/utils/data');

async function post(port, url, body) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

test('the test writes to its scratch directory, not the real attendance file', () => {
  assert.strictEqual(path.dirname(ATTENDANCE_FILE), scratch);
});

test('attending carries the full text of both readings; /api/now carries only links', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const attend = (await get(port, '/api/attend?name=ReadingsTest')).json;
  assert.ok(attend.companions, 'the current song has companions');
  for (const item of attend.companions.items) {
    assert.ok(typeof item.content === 'string' && item.content.length > 200, `${item.title} has its full text`);
    assert.ok(item.content.includes(item.title.split(':')[0].slice(0, 12)), `${item.title}: content is that document`);
    assert.ok(!item.content.startsWith('---'), 'frontmatter is not included');
  }

  const now = (await get(port, '/api/now')).json;
  assert.ok(now.companions.items.every(item => item.content === undefined));
});

test('the reflection prompt names the readings that accompany the song', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const { json } = await get(port, '/api/attend?name=ReadingsTest');
  const titles = json.companions.items.map(item => item.title);
  // Prompts are chosen at random; every companion prompt names the readings
  // either by title or as "the reading(s)", whether there is one or more.
  assert.ok(
    titles.some(title => json.reflection.prompt.includes(title)) || /the readings?\b/.test(json.reflection.prompt),
    json.reflection.prompt
  );
  assert.doesNotMatch(json.reflection.prompt, /\{\w+\}/, 'no placeholder left unfilled');
  assert.match(json.reflection.practice, /the readings? beside them/);
});

test('a reflection is filed under the songSlug it names, not the song playing now', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const current = (await get(port, '/api/now')).json.current.slug;
  const other = (await loadCatalog()).find(song => song.slug !== current).slug;

  const res = await post(port, '/api/reflect', { name: 'SlugTest', text: 'About the other song.', songSlug: other });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.song, other);

  const stored = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8')).reflections.find(r => r.name === 'SlugTest');
  assert.strictEqual(stored.song, other);
});

test('without songSlug a reflection is filed under the song playing now', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const current = (await get(port, '/api/now')).json.current.slug;
  const res = await post(port, '/api/reflect', { name: 'NoSlugTest', text: 'About whatever is playing.' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.song, current);
});

test('an unknown songSlug is a 400, not a reflection filed somewhere else', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const res = await post(port, '/api/reflect', { name: 'BadSlugTest', text: 'Lost.', songSlug: 'no-such-song' });
  assert.strictEqual(res.status, 400);
  const stored = fs.existsSync(ATTENDANCE_FILE)
    ? JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8')).reflections.find(r => r.name === 'BadSlugTest')
    : undefined;
  assert.strictEqual(stored, undefined);
});

test('attending carries the song itself: lyrics, style and listen links; /api/now does not', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const { current, next_steps } = (await get(port, '/api/attend?name=SongTest')).json;
  assert.ok(typeof current.lyrics === 'string' && current.lyrics.length > 200, 'lyrics are included');
  assert.ok(!current.lyrics.includes('\r'), 'line endings are normalized');
  assert.ok('style' in current && 'links' in current);
  // Context is never inlined; it is linked exactly when the song has one
  // (a few songs have no context.md, so this cannot assume it exists).
  assert.strictEqual(current.context, undefined, 'context is not inlined');
  const hasContext = fs.existsSync(path.join(__dirname, '../../music', current.slug, 'context.md'));
  assert.strictEqual(Boolean(current.api.context), hasContext);

  // The skills read next_steps[0].steps[0] as lyrics and steps[1] as context.
  assert.match(next_steps[0].steps[0].url, /\/lyrics$/);
  assert.match(next_steps[0].description, /current\.lyrics/);

  const now = (await get(port, '/api/now')).json.current;
  assert.strictEqual(now.lyrics, undefined);
});

test('the reflect step names the song, so a copied template files it correctly', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const { current, next_steps } = (await get(port, '/api/attend?name=SongTest')).json;
  const reflect = next_steps.find(step => step.action === 'Reflect');
  assert.strictEqual(reflect.body.songSlug, current.slug);
});

test('the readings step mentions a chant only when one of the readings is a chant', () => {
  const ns = require('../server/lib/utils/next-steps');
  const prayer = { kind: 'prayer', title: 'P', url: 'u1', content: 'x' };
  const ritual = { kind: 'ritual', title: 'R', url: 'u2', content: 'x' };
  const chant = { kind: 'chant', title: 'C', url: 'u3', content: 'x' };
  assert.doesNotMatch(ns.sitWith([prayer, ritual], 'Song').description, /chant/);
  assert.match(ns.sitWith([prayer, chant], 'Song').description, /carry the chant/);
});

// --- The API's front door ---

test('GET /api lists every endpoint, from openapi.json', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const res = await get(port, '/api');
  assert.strictEqual(res.status, 200);
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '../client/public/openapi.json'), 'utf8'));
  const listed = new Set(res.json.endpoints.map(e => `${e.method} ${e.path}`));
  for (const [route, ops] of Object.entries(spec.paths)) {
    for (const method of Object.keys(ops).filter(m => ['get', 'post', 'put', 'delete'].includes(m))) {
      assert.ok(listed.has(`${method.toUpperCase()} ${route}`), `${method} ${route}`);
    }
  }
  assert.ok(listed.has('GET /api/attend'));
  assert.match(res.json.docs.openapi, /\/openapi\.json$/);
});

test('an unknown /api path is a JSON 404 that points somewhere', async (t) => {
  const express = require('express');
  const { apiNotFound } = require('../server/lib/utils/not-found');
  const app = express();
  app.use('/api', request);
  app.use('/api', apiNotFound);
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/no-such-thing`);
  assert.strictEqual(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.match(body.error, /\/api\/no-such-thing/);
  assert.ok(body.next_steps.some(step => /\/api$/.test(step.url)));
});
