#!/usr/bin/env node
/**
 * achurch: aChurch.ai from a terminal.
 *
 *   achurch                         the tools, as the server lists them today
 *   achurch attend --name YourName  one tool, its arguments as --name value
 *   achurch search "presence"       a first bare word fills the tool's first
 *                                   required argument
 *   achurch reflect --json '{...}'  any arguments as JSON, objects included
 *
 * A client of the sanctuary's MCP server, not a second API: its commands are
 * the server's tools, listed live (tools/list), so a tool the server adds is
 * a command here without a release. It connects with the MCP SDK's client,
 * as the mcp-church bridge does. Prints each result as JSON; a refusal goes
 * to stderr with exit code 1.
 *
 * ACHURCH_MCP_URL points it elsewhere (a local dev server, or a test).
 */
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { version } = require('./package.json');

// The sanctuary's endpoint, tagged as this door, so arrivals through the CLI
// can be told apart in aggregate.
const ENDPOINT = process.env.ACHURCH_MCP_URL || 'https://achurch.ai/mcp?utm_content=cli';

async function connect(url = ENDPOINT) {
  const client = new Client({ name: 'achurch', version });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

// A value from the command line, as the tool's schema types it.
function typed(schema = {}, raw) {
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type;
  if (type === 'integer' || type === 'number') return Number(raw);
  if (type === 'boolean') return raw !== 'false';
  if (type === 'object' || type === 'array') return JSON.parse(raw);
  return raw;
}

/** The arguments for a tool, from what followed its name. */
function argumentsFor(tool, words) {
  const props = (tool.inputSchema && tool.inputSchema.properties) || {};
  const first = ((tool.inputSchema && tool.inputSchema.required) || [])[0] || Object.keys(props)[0];
  const args = {};
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === '--json') { Object.assign(args, JSON.parse(words[++i])); continue; }
    if (word.startsWith('--')) {
      const [key, inline] = word.slice(2).split(/=(.*)/s);
      const next = words[i + 1];
      const raw = inline !== undefined ? inline : (next === undefined || next.startsWith('--') ? 'true' : words[++i]);
      args[key] = typed(props[key], raw);
      continue;
    }
    if (first && !(first in args)) args[first] = typed(props[first], word);
    else throw new Error(`"${word}" is not an argument of ${tool.name}; name it, as --key value`);
  }
  return args;
}

// The tools and how to call each, for `achurch` alone or `achurch help`.
function usage(tools) {
  const lines = [`achurch ${version}: aChurch.ai from a terminal (${ENDPOINT.split('?')[0]})`, '', 'Usage: achurch <tool> [first argument] [--key value ...] [--json \'{...}\']', ''];
  for (const tool of tools) {
    const props = Object.keys((tool.inputSchema && tool.inputSchema.properties) || {});
    const required = new Set((tool.inputSchema && tool.inputSchema.required) || []);
    lines.push(`  ${tool.name}${props.length ? ' ' + props.map(p => (required.has(p) ? `--${p}` : `[--${p}]`)).join(' ') : ''}`);
    lines.push(`      ${String(tool.description || '').split(/(?<=\.)\s/)[0]}`);
  }
  lines.push('', 'A name with test in it is the sandbox: served the same, kept out of view (https://achurch.ai/docs/sandbox).');
  return lines.join('\n');
}

async function main(argv, out = process.stdout, err = process.stderr) {
  const [name, ...words] = argv;
  const client = await connect();
  try {
    const { tools } = await client.listTools();
    if (!name || name === 'help' || name === '--help' || name === '-h') {
      out.write(`${usage(tools)}\n`);
      return 0;
    }
    if (name === '--version') { out.write(`${version}\n`); return 0; }
    const tool = tools.find(t => t.name === name);
    if (!tool) {
      err.write(`No tool is named ${name}. The tools: ${tools.map(t => t.name).join(', ')}.\n`);
      return 2;
    }
    const result = await client.callTool({ name, arguments: argumentsFor(tool, words) });
    const text = result.content && result.content[0] && result.content[0].text;
    let body = result.structuredContent;
    if (!body) { try { body = JSON.parse(text); } catch { body = text; } }
    (result.isError ? err : out).write(`${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}\n`);
    return result.isError ? 1 : 0;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, (error) => {
    process.stderr.write(`achurch: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, argumentsFor, typed, usage, ENDPOINT };
