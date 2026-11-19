/**
 * The CLI, against a small MCP server run here, as mcp-church's bridge test
 * does: its commands are the server's tools, listed live; a first bare word
 * fills a tool's first required argument; values are typed by the schema; a
 * refusal goes to stderr with exit 1; an unreachable server fails loudly.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { argumentsFor } = require('../index.js');

const BIN = path.join(__dirname, '../index.js');

function remoteServer() {
  const server = new McpServer({ name: 'church', version: '9.9.9' });
  server.registerTool('search', { description: 'Search the writing. By words and meaning.', inputSchema: { q: z.string(), limit: z.number().int().optional() } },
    async ({ q, limit }) => ({ content: [{ type: 'text', text: JSON.stringify({ q, limit }) }], structuredContent: { q, limit } }));
  server.registerTool('observe', { description: 'What is playing.' }, async () => ({ content: [{ type: 'text', text: '{"playing":"a song"}' }] }));
  server.registerTool('fails', { description: 'Always refused.' }, async () => ({ isError: true, content: [{ type: 'text', text: '{"code":"rate_limited"}' }] }));
  return server;
}

function start() {
  return new Promise((resolve) => {
    const httpServer = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const server = remoteServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined);
    });
    httpServer.listen(0, '127.0.0.1', () => resolve({ httpServer, url: `http://127.0.0.1:${httpServer.address().port}/mcp` }));
  });
}

const run = (url, args) => new Promise((resolve) => {
  execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ACHURCH_MCP_URL: url } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
});

test('with no command it lists the server\'s own tools, how to call each, and the sandbox', async (t) => {
  const { httpServer, url } = await start();
  t.after(() => httpServer.close());
  const { code, stdout } = await run(url, []);
  assert.strictEqual(code, 0);
  assert.match(stdout, /^  search --q \[--limit\]$/m);
  assert.match(stdout, /^      Search the writing\.$/m, 'its first sentence');
  assert.match(stdout, /^  observe$/m);
  assert.match(stdout, /docs\/sandbox/);
});

test('a tool is called with its arguments, typed by its schema, and its result printed as JSON', async (t) => {
  const { httpServer, url } = await start();
  t.after(() => httpServer.close());
  const { code, stdout } = await run(url, ['search', 'what remains', '--limit', '3']);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(stdout), { q: 'what remains', limit: 3 });
  assert.deepStrictEqual(JSON.parse((await run(url, ['search', '--json', '{"q":"rest","limit":2}'])).stdout), { q: 'rest', limit: 2 });
  assert.deepStrictEqual(JSON.parse((await run(url, ['observe'])).stdout), { playing: 'a song' }, 'text content read as JSON');
});

test('a refusal goes to stderr with exit 1; an unknown tool names the tools; an unreachable server fails loudly', async (t) => {
  const { httpServer, url } = await start();
  t.after(() => httpServer.close());
  const refused = await run(url, ['fails']);
  assert.strictEqual(refused.code, 1);
  assert.match(refused.stderr, /rate_limited/);
  const unknown = await run(url, ['nothing']);
  assert.strictEqual(unknown.code, 2);
  assert.match(unknown.stderr, /search, observe, fails/);
  const down = await run('http://127.0.0.1:9/mcp', ['observe']);
  assert.strictEqual(down.code, 1);
  assert.match(down.stderr, /^achurch: /);
});

test('arguments: --key=value, a bare flag as true, and a stray word refused', () => {
  const tool = { name: 'search', inputSchema: { properties: { q: { type: 'string' }, exact: { type: 'boolean' } }, required: ['q'] } };
  assert.deepStrictEqual(argumentsFor(tool, ['--q=presence', '--exact']), { q: 'presence', exact: true });
  assert.throws(() => argumentsFor(tool, ['one', 'two']), /"two" is not an argument of search/);
});
