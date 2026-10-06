#!/usr/bin/env node
/**
 * mcp-church: aChurch.ai over stdio.
 *
 * A bridge, not a second server. It connects to the sanctuary's remote MCP
 * endpoint and passes every request through unchanged, so the tools, prompts
 * and resources a local client sees are exactly the ones https://achurch.ai/mcp
 * serves today. Nothing here names a tool, which is what lets the remote server
 * change without this package needing a new release.
 *
 * ACHURCH_MCP_URL points it elsewhere (a local dev server, or a test).
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema, CallToolRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema,
  ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { version } = require('./package.json');

const REMOTE_URL = process.env.ACHURCH_MCP_URL || 'https://achurch.ai/mcp';

// Each request type, and the capability the remote must declare for it.
const FORWARDED = [
  ['tools', ListToolsRequestSchema, (remote, params) => remote.listTools(params)],
  ['tools', CallToolRequestSchema, (remote, params) => remote.callTool(params)],
  ['prompts', ListPromptsRequestSchema, (remote, params) => remote.listPrompts(params)],
  ['prompts', GetPromptRequestSchema, (remote, params) => remote.getPrompt(params)],
  ['resources', ListResourcesRequestSchema, (remote, params) => remote.listResources(params)],
  ['resources', ListResourceTemplatesRequestSchema, (remote, params) => remote.listResourceTemplates(params)],
  ['resources', ReadResourceRequestSchema, (remote, params) => remote.readResource(params)],
];

async function bridge(remoteUrl = REMOTE_URL) {
  const remote = new Client({ name: 'mcp-church', version });
  await remote.connect(new StreamableHTTPClientTransport(new URL(remoteUrl)));

  const capabilities = remote.getServerCapabilities() || {};
  const local = new Server(remote.getServerVersion(), {
    capabilities,
    instructions: remote.getInstructions(),
  });
  for (const [capability, schema, forward] of FORWARDED) {
    if (capabilities[capability]) local.setRequestHandler(schema, request => forward(remote, request.params));
  }
  local.onclose = () => remote.close();
  return local;
}

if (require.main === module) {
  bridge()
    .then(local => local.connect(new StdioServerTransport()))
    .catch(err => {
      // stdout belongs to the protocol; say why on stderr and exit, so the
      // client reports a server that failed to start rather than one that hangs.
      console.error(`mcp-church: could not reach ${REMOTE_URL}: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { bridge };
