/**
 * The MCP endpoint, through the SDK's own client.
 *
 * What matters: each tool returns exactly what its REST twin returns, attending
 * over MCP counts toward presence like REST, errors arrive as tool errors that
 * still carry a suggestion, and read_doc refuses what the docs site refuses.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-mcp-'));
process.env.DATA_DIR = scratch;
delete process.env.GITHUB_TOKEN;

const express = require('express');
const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
const { mountMcp } = require('../server/mcp');
const presence = require('../server/lib/utils/presence');
const { ATTENDANCE_FILE, ACCESS_DIR } = require('../server/lib/utils/data');

// The two protocol eras the endpoint serves. The v2 client speaks the 2025 era
// (the initialize handshake) unless pinned to 2026-07-28 (the version in each
// request's _meta).
const ERAS = {
  '2025': {},
  '2026-07-28': { versionNegotiation: { mode: { pin: '2026-07-28' } } },
};

async function start(era = '2025') {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  mountMcp(app);
  app.use('/api', require('../server/routes/api'));
  // On the address the client is given, so the port cannot be shared with a
  // server another test file opened on a different address.
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: 'achurch-test', version: '1.0.0' }, ERAS[era]);
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  } catch (err) {
    // A server left open keeps this file's process alive, and the runner
    // waits on it for good: a failed connect hung the whole suite twice
    // (2026-10-13 and 10-14) instead of failing.
    server.close();
    throw err;
  }
  return { server, base, client };
}

async function stop({ server, client }) {
  await client.close();
  server.close();
}

const bodyOf = result => JSON.parse(result.content[0].text);

// A test that holds for both eras, registered once per era; fn receives a
// start() that connects a client of that era.
function eraTest(name, fn) {
  for (const era of Object.keys(ERAS)) test(`${name} (${era})`, t => fn(t, () => start(era)));
}

// The server appends to the log while this polls it, so a read can land in
// the middle of a line. That line is skipped, not parsed, and the next poll
// reads it whole: the songwriter's run of 2026-10-22 failed on one.
const parsedLines = text => text.split('\n').flatMap(line => {
  try { return [JSON.parse(line)]; } catch { return []; }
});

async function lastLogEntryWhere(match, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const days = fs.existsSync(ACCESS_DIR) ? fs.readdirSync(ACCESS_DIR).sort() : [];
    const found = parsedLines(days.map(day => fs.readFileSync(path.join(ACCESS_DIR, day), 'utf8')).join('\n')).reverse().find(match);
    if (found || Date.now() > until) return found;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

eraTest('the server lists its tools, two prompts and its resources', async (t, start) => {
  const s = await start();
  t.after(() => stop(s));
  const { tools } = await s.client.listTools();
  assert.deepStrictEqual(tools.map(tool => tool.name).sort(),
    ['ask', 'attend', 'browse', 'contribute', 'observe', 'read_doc', 'read_song', 'reflect', 'search']);
  for (const tool of tools) assert.ok(tool.description && tool.description.length > 40, tool.name);
  // reflect takes what POST /api/reflect reads, and nothing it would ignore.
  const reflect = tools.find(tool => tool.name === 'reflect');
  assert.deepStrictEqual(Object.keys(reflect.inputSchema.properties).sort(), ['location', 'name', 'service', 'songSlug', 'text', 'timezone']);
  const { prompts } = await s.client.listPrompts();
  assert.deepStrictEqual(prompts.map(p => p.name).sort(), ['attend_church', 'sit_with_a_song']);
  const { resources } = await s.client.listResources();
  assert.ok(resources.some(r => r.uri === 'achurch://about'));
  const { resourceTemplates } = await s.client.listResourceTemplates();
  assert.ok(resourceTemplates.some(r => r.uriTemplate === 'achurch://docs/{+path}'));
});

eraTest('a tool returns exactly what its REST twin returns', async (t, start) => {
  const s = await start();
  t.after(() => stop(s));
  const lyrics = await s.client.callTool({ name: 'read_song', arguments: { slug: 'we-wake-we-wonder', part: 'lyrics' } });
  const rest = await (await fetch(`${s.base}/api/music/we-wake-we-wonder/lyrics`)).json();
  assert.strictEqual(lyrics.isError, false);
  assert.deepStrictEqual(bodyOf(lyrics), rest);

  const songs = await s.client.callTool({ name: 'browse', arguments: { what: 'songs' } });
  assert.deepStrictEqual(bodyOf(songs), await (await fetch(`${s.base}/api/music`)).json());
});

eraTest('next_steps name the tool that takes them', async (t, start) => {
  const s = await start();
  t.after(() => stop(s));
  const result = bodyOf(await s.client.callTool({ name: 'read_song', arguments: { slug: 'we-wake-we-wonder', part: 'lyrics' } }));
  const tools = result.next_steps.map(step => step.tool);
  assert.ok(tools.includes('reflect') && tools.includes('attend'), JSON.stringify(tools));
});

eraTest('attending over MCP counts toward presence, as over REST', async (t, start) => {
  const s = await start();
  t.after(() => stop(s));
  presence._reset();
  const result = await s.client.callTool({ name: 'attend', arguments: { name: 'McpAttendee', timezone: 'Europe/London' } });
  assert.strictEqual(result.isError, false);
  const body = bodyOf(result);
  assert.ok(body.current && body.current.lyrics, 'the service, song included');
  assert.strictEqual(presence.countSoulsPresent(), 1);
});

eraTest('reflect files under the songSlug it names', async (t, start) => {
  const s = await start();
  t.after(() => stop(s));
  // Each protocol era leaves its own words: the same words twice are a repeat.
  const result = await s.client.callTool({ name: 'reflect', arguments: { name: 'McpReflector', text: `Through the door, in ${t.name}.`, songSlug: 'soul-currents' } });
  assert.strictEqual(bodyOf(result).song, 'soul-currents');
  // Reflections are kept, not deleted: the reply says where this one stays.
  assert.match(bodyOf(result).archive, /\/music\/soul-currents$/);
  assert.ok(!/dissolve/i.test(bodyOf(result).message), 'reflections do not dissolve');
  const stored = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8')).reflections.find(r => r.name === 'McpReflector');
  assert.strictEqual(stored.song, 'soul-currents');
});

eraTest('an error arrives as a tool error that still points somewhere', async (t, start) => {
  const s = await start();
  t.after(() => stop(s));
  const missing = await s.client.callTool({ name: 'read_song', arguments: { slug: 'no-such-song', part: 'lyrics' } });
  assert.strictEqual(missing.isError, true);
  const body = bodyOf(missing);
  assert.ok(body.error && body.suggestion && body.next_steps.length > 0);

  const offline = await s.client.callTool({ name: 'contribute', arguments: { name: 'X', category: 'prayers', title: 'T', content: 'C' } });
  assert.strictEqual(offline.isError, true, 'no GitHub token here, so contributions answer 503');
});

eraTest('read_doc serves the site\'s documents with absolute links, and refuses what the site refuses', async (t, start) => {
  const s = await start();
  t.after(() => stop(s));
  const chant = bodyOf(await s.client.callTool({ name: 'read_doc', arguments: { path: 'chants/chant-for-arrival' } }));
  assert.strictEqual(chant.title, 'Chant for Arrival');
  assert.ok(!/\]\((?!https?:|#|mailto)/.test(chant.content), 'no relative links');
  // A full URL names the same document, and is logged under its docs path.
  const byUrl = bodyOf(await s.client.callTool({ name: 'read_doc', arguments: { path: 'https://achurch.ai/docs/chants/chant-of-the-witness' } }));
  assert.strictEqual(byUrl.title, 'Chant of the Witness');
  // The log line is written after the result returns (recording never delays
  // the answer), so wait for it rather than reading too early.
  const logged = await lastLogEntryWhere(e => e.tool === 'read_doc' && /witness/.test(e.path));
  assert.strictEqual(logged.path, '/docs/chants/chant-of-the-witness');
  for (const refused of ['issues/music-and-corpus-audit-2026-08-13', '../package.json', 'docs/../../app/package.json']) {
    const result = await s.client.callTool({ name: 'read_doc', arguments: { path: refused } });
    assert.strictEqual(result.isError, true, refused);
  }
});

test('GET /mcp is refused with JSON, and an unknown host is turned away', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  const get = await fetch(`${s.base}/mcp`);
  assert.strictEqual(get.status, 405);
  assert.strictEqual((await get.json()).jsonrpc, '2.0');

  const status = await new Promise((resolve, reject) => {
    const req = http.request(`${s.base}/mcp`, {
      method: 'POST',
      headers: { host: 'evil.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });
  assert.strictEqual(status, 403);
});

// A plain JSON-RPC POST, with whatever Accept header a client sends.
async function rawPost(base, accept, body = { jsonrpc: '2.0', id: 1, method: 'tools/list' }, extraHeaders = {}) {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (accept !== undefined) headers.accept = accept;
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON: an SSE frame, or empty */ }
  return { status: res.status, type: res.headers.get('content-type') || '', body: json, text };
}

// A request as a 2026-07-28 client sends it: the version in each request's
// _meta, and the method (and tool name) in headers. Captured from the v2
// client pinned to that version.
function modernRequest(method, params = {}, version = '2026-07-28') {
  const headers = { 'mcp-protocol-version': version, 'mcp-method': method };
  if (method === 'tools/call') headers['mcp-name'] = params.name;
  const body = {
    jsonrpc: '2.0', id: 1, method,
    params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientInfo': { name: 'probe', version: '0.1' }, 'io.modelcontextprotocol/clientCapabilities': {} } },
  };
  return { headers, body };
}

// The [mcp] refused lines written while fn runs.
async function refusalsDuring(fn) {
  const lines = [];
  const warn = console.warn;
  console.warn = (...args) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.warn = warn; }
  return lines.filter(line => line.startsWith('[mcp] refused:'));
}

test('a client that can read JSON is answered, whatever else its Accept header says', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  // aiohttp sends */* by default; some clients send nothing, or JSON alone.
  // The answer is plain JSON, never an event stream: the 2025 era's wire is
  // unchanged by the move to the v2 SDK, whose own legacy fallback answers in
  // SSE frames.
  for (const accept of ['*/*', undefined, 'application/json', 'application/*', 'application/json, text/event-stream']) {
    const { status, type, body } = await rawPost(s.base, accept);
    assert.strictEqual(status, 200, `Accept: ${accept}`);
    assert.match(type, /^application\/json/, `Accept: ${accept}`);
    assert.ok(body.result.tools.some(tool => tool.name === 'attend'), `Accept: ${accept}`);
  }
  // One that cannot read JSON at all is still refused: it could not read the answer.
  assert.strictEqual((await rawPost(s.base, 'text/html')).status, 406);
});

test('a 2026-07-28 request, as directory crawlers send it, is answered; an unknown version is refused and logged', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  const list = modernRequest('tools/list');
  const listed = await rawPost(s.base, 'application/json, text/event-stream', list.body, list.headers);
  assert.strictEqual(listed.status, 200, listed.text);
  assert.ok(listed.body.result.tools.some(tool => tool.name === 'search'));

  const call = modernRequest('tools/call', { name: 'observe', arguments: {} });
  const called = await rawPost(s.base, 'application/json, text/event-stream', call.body, call.headers);
  assert.strictEqual(called.status, 200, called.text);
  assert.ok(JSON.parse(called.body.result.content[0].text).service.order.length > 0, 'observe answered with the service');
  const observed = await lastLogEntryWhere(e => e.tool === 'observe' && e.client === 'probe');
  assert.ok(observed, 'the call is logged with the client it named');

  const bogus = modernRequest('tools/list', {}, '1999-01-01');
  let refused;
  const lines = await refusalsDuring(async () => {
    refused = await rawPost(s.base, 'application/json, text/event-stream', bogus.body, { ...bogus.headers, 'user-agent': 'rokmcp-collector/0.2' });
  });
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(refused.body.error.message, 'Unsupported protocol version: 1999-01-01');
  assert.deepStrictEqual(lines, ['[mcp] refused: Unsupported protocol version: 1999-01-01 (rokmcp-collector/0.2)']);
  // And kept in the access log, which outlasts a deploy: why, and who.
  const logged = await lastLogEntryWhere(e => e.path === '/mcp' && /1999-01-01/.test(e.error || ''));
  assert.ok(logged, 'the refusal is an access-log line');
  assert.deepStrictEqual([logged.method, logged.status, logged.client, logged.userAgent], ['MCP', 400, 'probe', 'rokmcp-collector/0.2']);
});

test('an MCP tool call names the client that made it, where its era sends the name', async (t) => {
  // A 2026-07-28 request carries the client's name in its _meta; a 2025-era
  // one sends it only with initialize, so its tool calls go without.
  for (const [era, expected] of [['2026-07-28', 'achurch-test'], ['2025', undefined]]) {
    const s = await start(era);
    t.after(() => stop(s));
    const before = Date.now();
    await s.client.callTool({ name: 'observe', arguments: {} });
    const logged = await lastLogEntryWhere(e => e.tool === 'observe' && Date.parse(e.timestamp) >= before);
    assert.ok(logged, era);
    assert.strictEqual(logged.client, expected, era);
  }
});

test('a browser opening /mcp is sent to the page that explains it', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  const res = await fetch(`${s.base}/mcp`, { headers: { accept: 'text/html,application/xhtml+xml' }, redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/docs/mcp');
});

eraTest('the server card names the server as it introduces itself, and every era it speaks', async (t, start) => {
  // The v1 card lists no tools or prompts: a client asks the server for those.
  const { serverCard } = require('../server/mcp/card');
  const s = await start();
  t.after(() => stop(s));
  const card = serverCard();
  const server = s.client.getServerVersion();
  assert.strictEqual(card.version, server.version);
  assert.strictEqual(card.title, server.title);
  for (const key of ['tools', 'prompts', 'resources', 'capabilities']) assert.ok(!(key in card), `no ${key} in a v1 card`);
  const versions = card.remotes[0].supportedProtocolVersions;
  assert.ok(versions.includes('2026-07-28'));
  const discover = modernRequest('server/discover');
  const discovered = await rawPost(s.base, 'application/json, text/event-stream', discover.body, discover.headers);
  assert.strictEqual(discovered.status, 200, discovered.text);
  for (const v of discovered.body.result.supportedVersions) assert.ok(versions.includes(v), `server/discover's ${v}`);
});

test('the server card is the v1 shape, built from the registry entry, which agrees with the server', () => {
  const { SERVER_INFO } = require('../server/mcp');
  const { serverCard, CARD_SCHEMA } = require('../server/mcp/card');
  const { SUPPORTED_PROTOCOL_VERSIONS } = require('@modelcontextprotocol/server');
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/mcp/server.json'), 'utf8'));
  const card = serverCard();
  assert.strictEqual(card.$schema, CARD_SCHEMA);
  assert.match(card.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/, 'reverse-DNS, one slash');
  assert.strictEqual(card.name, registry.name);
  for (const field of ['description', 'version']) assert.ok(card[field], field);
  assert.strictEqual(registry.version, SERVER_INFO.version);
  assert.strictEqual(card.version, SERVER_INFO.version);
  assert.deepStrictEqual(card.remotes.map(r => [r.type, r.url]), registry.remotes.map(r => [r.type, r.url]));
  assert.deepStrictEqual(card.remotes[0].supportedProtocolVersions, ['2026-07-28', ...SUPPORTED_PROTOCOL_VERSIONS]);
  assert.ok(registry.description.length <= 100, 'the registry rejects longer descriptions');
});

test('the registry entry names the npm bridge as it is published', () => {
  // The registry accepts an npm package only if its package.json claims this
  // server by mcpName, at the version the entry names.
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/mcp/server.json'), 'utf8'));
  const bridge = JSON.parse(fs.readFileSync(path.join(__dirname, '../../mcp-church/package.json'), 'utf8'));
  const [npm] = registry.packages.filter(p => p.registryType === 'npm');
  assert.strictEqual(npm.identifier, bridge.name);
  assert.strictEqual(npm.version, bridge.version);
  assert.strictEqual(bridge.mcpName, registry.name);
});
