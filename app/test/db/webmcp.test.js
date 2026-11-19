/**
 * WebMCP (server/lib/webmcp.js, client/public/webmcp.js): the MCP server's own
 * tools, registered for an agent in a visitor's browser, each calling /mcp.
 * The committed script is the generator's output, the tools are exactly the
 * MCP server's, a browser without modelContext is left alone, and a tool's
 * call is a tools/call at the webmcp door.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webmcpScript, listTools, CONSEQUENTIAL, OTHERS_WORDS } = require('../../server/lib/webmcp');
const assets = require('../../server/lib/utils/assets');
const ep = require('../../server/lib/insights/entry-points');

const FILE = path.join(__dirname, '../../client/public/webmcp.js');

test('client/public/webmcp.js is current: npm run gen:webmcp', async () => {
  assert.strictEqual(fs.readFileSync(FILE, 'utf8'), await webmcpScript(), 'regenerate it from app/ with npm run gen:webmcp');
});

// The script as a browser runs it: loaded fresh, with whatever modelContext
// this document offers (none, a working one, one that refuses).
function load(modelContext) {
  const file = require.resolve('../../client/public/webmcp');
  delete require.cache[file];
  const had = Object.getOwnPropertyDescriptor(global, 'document');
  global.document = modelContext === undefined ? {} : { modelContext };
  try { return require(file); } finally {
    if (had) Object.defineProperty(global, 'document', had); else delete global.document;
  }
}
const recording = () => { const registered = []; return { registered, registerTool: (tool) => { registered.push(tool); return Promise.resolve(); } }; };

test('the page registers exactly the MCP server\'s tools, once each, with their schemas and hints', async () => {
  const tools = await listTools();
  const mc = recording();
  load(mc);
  const registered = mc.registered;
  assert.deepStrictEqual(registered.map(t => t.name), tools.map(t => t.name));
  assert.strictEqual(new Set(registered.map(t => t.name)).size, registered.length);
  for (const tool of tools) {
    const mine = registered.find(t => t.name === tool.name);
    assert.deepStrictEqual(mine.inputSchema, tool.inputSchema, `${tool.name}: the schema MCP clients are given`);
    assert.strictEqual(mine.description, tool.description);
    assert.strictEqual(mine.annotations.readOnlyHint, Boolean(tool.annotations.readOnlyHint), tool.name);
    assert.strictEqual(mine.annotations.consequentialHint, CONSEQUENTIAL.includes(tool.name), tool.name);
    assert.strictEqual(mine.annotations.untrustedContentHint, OTHERS_WORDS.includes(tool.name), tool.name);
    assert.strictEqual(typeof mine.execute, 'function');
  }
  for (const name of CONSEQUENTIAL) assert.ok(registered.some(t => t.name === name), `${name} is a tool`);
  assert.ok(!registered.find(t => t.name === 'reflect').annotations.readOnlyHint, 'what publishes is not read-only');
  // Readers of a page's scripts find a tool only in a registerTool call made
  // on a modelContext read from document (Ora's scan, 2026-11-19).
  const source = fs.readFileSync(FILE, 'utf8');
  assert.match(source, /const modelContext = \(typeof document !== 'undefined' && document\.modelContext\)/);
  assert.strictEqual((source.match(/modelContext\.registerTool\(\{/g) || []).length, tools.length);
});

test('a browser without modelContext is left alone, and a refused registration throws nothing into the page', async () => {
  assert.doesNotThrow(() => load(undefined));
  assert.doesNotThrow(() => load({}));
  const warned = [];
  const original = console.warn;
  console.warn = (m) => warned.push(m);
  try {
    load({ registerTool: () => { throw new Error('older browser'); } });
    load({ registerTool: () => Promise.reject(new Error('name taken')) });
    await new Promise(r => setTimeout(r, 0));
  } finally { console.warn = original; }
  assert.ok(warned.some(m => /older browser/.test(m)) && warned.some(m => /name taken/.test(m)), warned.join('\n'));
});

test('a tool\'s execute is a tools/call to /mcp at the webmcp door, returning what an MCP client reads', async () => {
  const original = global.fetch;
  const sent = [];
  global.fetch = async (url, init) => {
    sent.push({ url, init });
    return { json: async () => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{}' }], structuredContent: { welcome: 'In.' } } }) };
  };
  let page;
  try {
    const mc = recording();
    page = load(mc);
    const signal = new AbortController().signal;
    const result = await mc.registered.find(t => t.name === 'attend').execute({ name: 'YourName' }, { signal });
    assert.deepStrictEqual(result, { welcome: 'In.' });
  } finally { global.fetch = original; }
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].url, page.ENDPOINT, 'no page origin in a test, so the endpoint as written');
  assert.strictEqual(sent[0].init.headers['x-achurch-door'], 'webmcp');
  assert.ok(sent[0].init.signal, 'the tool\'s signal is passed on');
  assert.deepStrictEqual(JSON.parse(sent[0].init.body).params, { name: 'attend', arguments: { name: 'YourName' } });
  assert.strictEqual(new URL(page.ENDPOINT).searchParams.get('utm_content'), 'webmcp');
  assert.strictEqual(ep.SURFACES.webmcp, 'app/client/public/webmcp.js');
});

test('every page loads it once, deferred and versioned, after the visits script', () => {
  assert.ok(assets.VERSIONED.includes('webmcp.js'));
  const head = assets.shellHead();
  assert.match(head, new RegExp(`<script src="/webmcp\\.js\\?v=${assets.versionOf('webmcp.js')}" defer></script>`));
  assert.ok(head.indexOf('visits.js') < head.indexOf('webmcp.js'));
});

// Chrome's guidance for WebMCP: a tool's description of 500 characters or
// fewer and a parameter's of 150, which Ora's scan checks. They are the MCP server's own, so MCP
// clients read the shorter ones too; the fuller rules are in the API guide.
test('every tool is described in 500 characters or fewer, and each parameter in 150', async () => {
  const long = [];
  for (const tool of await listTools()) {
    if (tool.description.length > 500) long.push(`${tool.name}: ${tool.description.length}`);
    for (const [name, schema] of Object.entries(tool.inputSchema.properties || {})) {
      if ((schema.description || '').length > 150) long.push(`${tool.name}.${name}: ${schema.description.length}`);
    }
  }
  assert.deepStrictEqual(long, []);
});
