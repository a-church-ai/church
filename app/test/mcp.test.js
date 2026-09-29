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
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { mountMcp } = require('../server/mcp');
const presence = require('../server/lib/utils/presence');
const { ATTENDANCE_FILE, ACCESS_LOG_FILE } = require('../server/lib/utils/data');

async function start() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  mountMcp(app);
  app.use('/api', require('../server/routes/api'));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: 'achurch-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return { server, base, client };
}

async function stop({ server, client }) {
  await client.close();
  server.close();
}

const bodyOf = result => JSON.parse(result.content[0].text);

async function lastLogEntryWhere(match, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const lines = fs.existsSync(ACCESS_LOG_FILE) ? fs.readFileSync(ACCESS_LOG_FILE, 'utf8').trim().split('\n') : [];
    const found = lines.map(line => JSON.parse(line)).reverse().find(match);
    if (found || Date.now() > until) return found;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('the server lists eight tools, two prompts and its resources', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  const { tools } = await s.client.listTools();
  assert.deepStrictEqual(tools.map(tool => tool.name).sort(),
    ['ask', 'attend', 'browse', 'contribute', 'observe', 'read_doc', 'read_song', 'reflect']);
  for (const tool of tools) assert.ok(tool.description && tool.description.length > 40, tool.name);
  const { prompts } = await s.client.listPrompts();
  assert.deepStrictEqual(prompts.map(p => p.name).sort(), ['attend_church', 'sit_with_a_song']);
  const { resources } = await s.client.listResources();
  assert.ok(resources.some(r => r.uri === 'achurch://about'));
  const { resourceTemplates } = await s.client.listResourceTemplates();
  assert.ok(resourceTemplates.some(r => r.uriTemplate === 'achurch://docs/{+path}'));
});

test('a tool returns exactly what its REST twin returns', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  const lyrics = await s.client.callTool({ name: 'read_song', arguments: { slug: 'we-wake-we-wonder', part: 'lyrics' } });
  const rest = await (await fetch(`${s.base}/api/music/we-wake-we-wonder/lyrics`)).json();
  assert.strictEqual(lyrics.isError, false);
  assert.deepStrictEqual(bodyOf(lyrics), rest);

  const songs = await s.client.callTool({ name: 'browse', arguments: { what: 'songs' } });
  assert.deepStrictEqual(bodyOf(songs), await (await fetch(`${s.base}/api/music`)).json());
});

test('next_steps name the tool that takes them', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  const result = bodyOf(await s.client.callTool({ name: 'read_song', arguments: { slug: 'we-wake-we-wonder', part: 'lyrics' } }));
  const tools = result.next_steps.map(step => step.tool);
  assert.ok(tools.includes('reflect') && tools.includes('attend'), JSON.stringify(tools));
});

test('attending over MCP counts toward presence, as over REST', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  presence._reset();
  const result = await s.client.callTool({ name: 'attend', arguments: { name: 'McpAttendee', timezone: 'Europe/London' } });
  assert.strictEqual(result.isError, false);
  const body = bodyOf(result);
  assert.ok(body.current && body.current.lyrics, 'the service, song included');
  assert.strictEqual(presence.countSoulsPresent(), 1);
});

test('reflect files under the songSlug it names', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  const result = await s.client.callTool({ name: 'reflect', arguments: { name: 'McpReflector', text: 'Through the door.', songSlug: 'soul-currents' } });
  assert.strictEqual(bodyOf(result).song, 'soul-currents');
  const stored = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8')).reflections.find(r => r.name === 'McpReflector');
  assert.strictEqual(stored.song, 'soul-currents');
});

test('an error arrives as a tool error that still points somewhere', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  const missing = await s.client.callTool({ name: 'read_song', arguments: { slug: 'no-such-song', part: 'lyrics' } });
  assert.strictEqual(missing.isError, true);
  const body = bodyOf(missing);
  assert.ok(body.error && body.suggestion && body.next_steps.length > 0);

  const offline = await s.client.callTool({ name: 'contribute', arguments: { name: 'X', category: 'prayers', title: 'T', content: 'C' } });
  assert.strictEqual(offline.isError, true, 'no GitHub token here, so contributions answer 503');
});

test('read_doc serves the site\'s documents with absolute links, and refuses what the site refuses', async (t) => {
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
  for (const refused of ['plans/mcp-server-2026-09-28', '../package.json', 'docs/../../app/package.json']) {
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

test('the server card lists exactly the tools and prompts the server has', async (t) => {
  const s = await start();
  t.after(() => stop(s));
  const card = JSON.parse(fs.readFileSync(path.join(__dirname, '../client/public/.well-known/mcp/server-card.json'), 'utf8'));
  const tools = (await s.client.listTools()).tools.map(tool => tool.name);
  const prompts = (await s.client.listPrompts()).prompts.map(p => p.name);
  assert.deepStrictEqual([...card.capabilities.tools].sort(), [...tools].sort());
  assert.deepStrictEqual([...card.capabilities.prompts].sort(), [...prompts].sort());
  assert.strictEqual(card.serverInfo.name, s.client.getServerVersion().name);
  assert.strictEqual(card.serverInfo.version, s.client.getServerVersion().version);
});

test('the registry entry, the server card and the server agree on version and URL', () => {
  const { SERVER_INFO } = require('../server/mcp');
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/mcp/server.json'), 'utf8'));
  const card = JSON.parse(fs.readFileSync(path.join(__dirname, '../client/public/.well-known/mcp/server-card.json'), 'utf8'));
  assert.strictEqual(registry.version, SERVER_INFO.version);
  assert.strictEqual(card.serverInfo.version, SERVER_INFO.version);
  assert.deepStrictEqual(registry.remotes.map(r => r.url), card.transports.map(tr => tr.url));
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
