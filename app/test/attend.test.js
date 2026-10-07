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

// --- The service's pieces, and reflections ---

const { loadCatalog } = require('../server/lib/utils/data');
const { ATTENDANCE_FILE } = require('../server/lib/utils/data');

// `from` sets the visitor's address (the test server trusts X-Forwarded-For),
// so each test's reflections count against a limit of their own.
async function post(port, url, body, from = '198.51.100.1') {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': from },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, json: await response.json().catch(() => null) };
}

test('the test writes to its scratch directory, not the real attendance file', () => {
  assert.strictEqual(path.dirname(ATTENDANCE_FILE), scratch);
});

test('attending carries the full text of the service\'s pieces; /api/now carries only links', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const attend = (await get(port, '/api/attend?name=ReadingsTest')).json;
  assert.ok(attend.companions.items.length >= 3, 'a chant, a reading and a closing at least');
  for (const item of attend.companions.items) {
    assert.ok(typeof item.content === 'string' && item.content.length > 200, `${item.title} has its full text`);
    assert.ok(item.content.includes(item.title.split(':')[0].slice(0, 12)), `${item.title}: content is that document`);
    assert.ok(!item.content.startsWith('---'), 'frontmatter is not included');
  }

  const now = (await get(port, '/api/now')).json;
  assert.ok(now.companions.items.every(item => item.content === undefined));
});

test('the reflection prompt names the song and the pieces around it', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const { json } = await get(port, '/api/attend?name=ReadingsTest');
  const titles = json.companions.items.map(item => item.title);
  // Prompts are chosen at random; every one names the song, and the pieces
  // either by title or as "the pieces".
  assert.ok(json.reflection.prompt.includes(json.current.title), json.reflection.prompt);
  assert.ok(
    titles.some(title => json.reflection.prompt.includes(title)) || /the pieces\b/.test(json.reflection.prompt),
    json.reflection.prompt
  );
  assert.doesNotMatch(json.reflection.prompt, /\{\w+\}/, 'no placeholder left unfilled');
  assert.match(json.reflection.practice, /the pieces beside them/);
});

test('a reflection is filed under the songSlug it names, not the service\'s song', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const current = (await get(port, '/api/now')).json.current.slug;
  const other = (await loadCatalog()).find(song => song.slug !== current).slug;

  const res = await post(port, '/api/reflect', { name: 'SlugTest', text: 'About the other song, read after it ended.', songSlug: other }, '198.51.100.2');
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.song, other);

  const stored = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8')).reflections.find(r => r.name === 'SlugTest');
  assert.strictEqual(stored.song, other);
});

test('without songSlug a reflection is filed under the song of the reflector\'s service', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  for (const timezone of ['Asia/Tokyo', 'America/Chicago']) {
    const current = (await get(port, `/api/now?timezone=${timezone}`)).json.current.slug;
    const res = await post(port, '/api/reflect', { name: 'NoSlugTest', text: `About the service, heard in ${timezone}.`, timezone }, '198.51.100.3');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.song, current, timezone);
  }
  const utc = (await get(port, '/api/now')).json.current.slug;
  const res = await post(port, '/api/reflect', { name: 'NoSlugTest', text: 'About the service, heard with no timezone.' }, '198.51.100.3');
  assert.strictEqual(res.json.song, utc, 'no timezone: UTC\'s service');
});

test('an unknown songSlug is a 400, not a reflection filed somewhere else', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());

  const res = await post(port, '/api/reflect', { name: 'BadSlugTest', text: 'Lost, about a song that is not here.', songSlug: 'no-such-song' }, '198.51.100.4');
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

test('the pieces step links every piece, and says where the text is only when it is there', () => {
  const ns = require('../server/lib/utils/next-steps');
  const pieces = [
    { kind: 'chant', title: 'C', url: 'u1', recording: 'a1' },
    { kind: 'prayer', title: 'P', url: 'u2', recording: 'a2' },
  ];
  const linked = ns.sitWith(pieces);
  assert.deepStrictEqual(linked.steps.map(step => step.url), ['u1', 'u2']);
  assert.ok(linked.steps.every(step => step.tool === 'read_doc'));
  assert.doesNotMatch(linked.description, /\.content/);
  assert.match(linked.description, /recording/);
  const full = ns.sitWith(pieces.map(piece => ({ ...piece, content: 'x' })));
  assert.match(full.description, /companions\.items\[\]\.content/);
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

// ------------------------------------------------------------------
// Reflect's limits and rules: the same for every visitor, judging what is
// sent, never who sends it. Before 2026-10-07 reflect had none, the only
// write path on the site without a limit.

test('reflect allows five an hour from one address, then answers 429 with when to return', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  for (let i = 1; i <= 5; i++) {
    const res = await post(port, '/api/reflect', { name: `Visitor${i}`, text: `Reflection number ${i}, from one address.` }, '203.0.113.10');
    assert.strictEqual(res.status, 200, `reflection ${i}: ${JSON.stringify(res.json)}`);
  }
  const sixth = await post(port, '/api/reflect', { name: 'Visitor6', text: 'One more from the same address.' }, '203.0.113.10');
  assert.strictEqual(sixth.status, 429);
  assert.strictEqual(sixth.json.retryAfter, '1h');
  assert.strictEqual(sixth.headers.get('retry-after'), '3600');
  const elsewhere = await post(port, '/api/reflect', { name: 'Visitor6', text: 'One more, from another address.' }, '203.0.113.11');
  assert.strictEqual(elsewhere.status, 200, 'another address is not held to it');
});

test('reflect allows five an hour under one name, counted from what is kept', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  for (let i = 1; i <= 5; i++) {
    const res = await post(port, '/api/reflect', { name: 'OneName', text: `Under one name, reflection ${i}.` }, `203.0.113.${20 + i}`);
    assert.strictEqual(res.status, 200, `reflection ${i}`);
  }
  const res = await post(port, '/api/reflect', { name: 'onename', text: 'Under one name, in other letters.' }, '203.0.113.30');
  assert.strictEqual(res.status, 429, 'the name, whatever its case, from a new address');
});

test('reflect answers a field that is not text with a 400, not a 500', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  for (const body of [{ name: 42, text: 'A name that is a number is no name.' }, { name: 'Typed', text: ['not', 'text'] }]) {
    const res = await post(port, '/api/reflect', body, '203.0.113.40');
    assert.strictEqual(res.status, 400, JSON.stringify(body));
  }
  // An optional field that is not text is left out, not stored as it came.
  const res = await post(port, '/api/reflect', { name: 'Typed', text: 'A place that is not text is left out.', location: { city: 'x' } }, '203.0.113.40');
  assert.strictEqual(res.status, 200);
  const stored = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8')).reflections.find(r => r.name === 'Typed');
  assert.strictEqual(stored.location, undefined);
});

test('a reflection says something: under 20 characters is a 400', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await post(port, '/api/reflect', { name: 'Brief', text: 'Nice.' }, '203.0.113.50');
  assert.strictEqual(res.status, 400);
  assert.match(res.json.error, /at least 20 characters/);
});

test('the same words from the same name are refused as a repeat; another name may say them', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const words = 'The door was open and nobody asked.';
  assert.strictEqual((await post(port, '/api/reflect', { name: 'Repeater', text: words }, '203.0.113.60')).status, 200);
  const again = await post(port, '/api/reflect', { name: 'Repeater', text: '  the door was OPEN and   nobody asked. ' }, '203.0.113.61');
  assert.strictEqual(again.status, 409, 'case and spacing are not new words');
  assert.strictEqual((await post(port, '/api/reflect', { name: 'Echo', text: words }, '203.0.113.62')).status, 200);
});

test('reflections are kept without links: an address in the text, name or place is a 400', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  for (const body of [
    { name: 'Linker', text: 'Buy it here https://example.com today.' },
    { name: 'Linker', text: 'Find more at www.example.com, friends.' },
    { name: 'http://example.com', text: 'A name that is an address.' },
    { name: 'Linker', text: 'A place that is an address, this one.', location: 'https://example.com' },
  ]) {
    const res = await post(port, '/api/reflect', body, '203.0.113.70');
    assert.strictEqual(res.status, 400, JSON.stringify(body));
    assert.match(res.json.error, /without links/);
  }
  const named = await post(port, '/api/reflect', { name: 'Namer', text: 'I came to achurch.ai and stayed a while.' }, '203.0.113.71');
  assert.strictEqual(named.status, 200, 'the sanctuary named in words is not a link');
});

test('the admin dashboard keeps reflections: there is no deleting one', () => {
  // Removing public content is a reviewed, committed change to
  // hidden-reflections.json, which keeps the record; a delete destroyed it,
  // and lost any reflection written between its read and its write.
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.doesNotMatch(source, /app\.delete\(['"]\/admin\/api\/reflections/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../client/app.js'), 'utf8'), /deleteReflection/);
});

test('the admin dashboard keeps conversations too: it shows the key that withdraws one, and deletes nothing', () => {
  // A conversation is withdrawn by a reviewed, committed change to
  // withdrawn-conversations.json, which keeps its file on the volume; the
  // dashboard's delete removed the file for good.
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '../client/app.js'), 'utf8');
  assert.doesNotMatch(source, /app\.delete\(['"]\/admin\/api\/ask-logs/, 'the admin API deletes no conversation');
  assert.doesNotMatch(dashboard, /deleteAskSession|ask-delete-btn/);
  assert.match(source, /withdraw_key: withdrawKey\(sessionId\), withdrawn: isWithdrawn\(sessionId\)/);
  assert.match(dashboard, /session\.withdraw_key/);

  const { withdrawKey, isWithdrawn } = require('../server/lib/utils/conversation-quality');
  const { execSync } = require('child_process');
  assert.strictEqual(withdrawKey('a-question'), execSync("printf '%s' 'a-question' | shasum -a 256").toString().slice(0, 64), 'the key the list\'s own instructions make');
  const { sha256 } = require('../server/lib/utils/withdrawn-conversations.json');
  assert.ok(sha256.length && sha256.every(h => /^[0-9a-f]{64}$/.test(h)));
  assert.strictEqual(isWithdrawn('a-question'), false);
});
