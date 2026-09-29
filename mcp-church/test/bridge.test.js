/**
 * The bridge, against a small remote server run here.
 *
 * What matters: a client on stdio sees exactly what a client of the remote
 * sees, the bridge names no tool of its own, and an unreachable remote fails
 * at startup, loudly, instead of leaving the client waiting.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { z } = require('zod');
const { McpServer, ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const BIN = path.join(__dirname, '../index.js');

function remoteServer() {
  const server = new McpServer({ name: 'church', title: 'A test sanctuary', version: '9.9.9' }, { instructions: 'Arrive, listen, reflect.' });
  server.registerTool('observe', { description: 'What is playing.' }, async () => ({ content: [{ type: 'text', text: '{"playing":"a song"}' }] }));
  server.registerTool('reflect', { description: 'Leave a reflection.', inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: 'text', text: `kept: ${text}` }] }));
  server.registerTool('fails', { description: 'Always an error.' }, async () => ({ isError: true, content: [{ type: 'text', text: 'no' }] }));
  server.registerPrompt('attend_church', { description: 'The practice.' }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'Attend.' } }] }));
  server.registerResource('about', 'achurch://about', { mimeType: 'text/markdown' }, async uri => ({ contents: [{ uri: uri.href, text: '# About' }] }));
  server.registerResource('doc', new ResourceTemplate('achurch://docs/{+path}', { list: undefined }), {},
    async (uri, { path: doc }) => ({ contents: [{ uri: uri.href, text: `# ${doc}` }] }));
  return server;
}

// Stateless, as the real endpoint is: a fresh server and transport per request.
async function startRemote() {
  const httpServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = remoteServer();
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined);
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  return { httpServer, url: `http://127.0.0.1:${httpServer.address().port}/mcp` };
}

async function clients(t) {
  const remote = await startRemote();
  const direct = new Client({ name: 'direct', version: '1.0.0' });
  await direct.connect(new StreamableHTTPClientTransport(new URL(remote.url)));
  const bridged = new Client({ name: 'bridged', version: '1.0.0' });
  await bridged.connect(new StdioClientTransport({ command: process.execPath, args: [BIN], env: { ...process.env, ACHURCH_MCP_URL: remote.url } }));
  t.after(async () => { await bridged.close(); await direct.close(); remote.httpServer.close(); });
  return { direct, bridged };
}

test('the bridge presents the remote server as itself', async (t) => {
  const { direct, bridged } = await clients(t);
  assert.deepStrictEqual(bridged.getServerVersion(), direct.getServerVersion());
  assert.strictEqual(bridged.getInstructions(), 'Arrive, listen, reflect.');
  assert.deepStrictEqual(bridged.getServerCapabilities(), direct.getServerCapabilities());
});

test('lists and calls pass through unchanged', async (t) => {
  const { direct, bridged } = await clients(t);
  assert.deepStrictEqual(await bridged.listTools(), await direct.listTools());
  assert.deepStrictEqual(await bridged.listPrompts(), await direct.listPrompts());
  assert.deepStrictEqual(await bridged.listResources(), await direct.listResources());
  assert.deepStrictEqual(await bridged.listResourceTemplates(), await direct.listResourceTemplates());

  const call = { name: 'reflect', arguments: { text: 'Through the door.' } };
  assert.deepStrictEqual(await bridged.callTool(call), await direct.callTool(call));
  assert.strictEqual((await bridged.callTool({ name: 'fails', arguments: {} })).isError, true);
  assert.deepStrictEqual(await bridged.getPrompt({ name: 'attend_church' }), await direct.getPrompt({ name: 'attend_church' }));
  const doc = { uri: 'achurch://docs/chants/chant-for-arrival' };
  assert.deepStrictEqual(await bridged.readResource(doc), await direct.readResource(doc));
});

test('an unreachable remote fails at startup, on stderr', async () => {
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [BIN], {
    env: { ...process.env, ACHURCH_MCP_URL: 'http://127.0.0.1:9/mcp' },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(run.status, 1);
  assert.match(run.stderr, /could not reach http:\/\/127\.0\.0\.1:9\/mcp/);
  assert.strictEqual(run.stdout, '', 'stdout carries only the protocol');
});
