/**
 * The MCP server card: the hosted endpoint described for discovery, in the v1
 * shape of the server card extension (modelcontextprotocol/ext-server-card).
 * Served at /mcp/server-card, the location the extension reserves, and listed
 * in the AI catalog (lib/ai-catalog.js).
 *
 * Built from server.json, the MCP Registry entry, so the card and the registry
 * can never name a different version, description or endpoint. The card has
 * no tools, prompts or resources: a client lists those from the server itself.
 */

const { SUPPORTED_PROTOCOL_VERSIONS } = require('@modelcontextprotocol/server');
const registry = require('./server.json');

const CARD_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
const CARD_TYPE = 'application/mcp-server-card+json';
const CARD_PATH = '/mcp/server-card';
// Where it is served: its own path, and two that directories still probe.
const CARD_PATHS = [CARD_PATH, '/.well-known/mcp/server-card.json', '/.well-known/mcp.json'];

// The versions a client can speak to /mcp, as docs/mcp.md lists them:
// 2026-07-28 on the modern path, and every version the SDK negotiates in an
// initialize on the legacy path (checked: 2024-11-05 and 2024-10-07 included,
// over Streamable HTTP; the old SSE transport is a different matter, and
// isn't served).
const PROTOCOL_VERSIONS = ['2026-07-28', ...SUPPORTED_PROTOCOL_VERSIONS];

function serverCard() {
  const { name, title, description, version, websiteUrl, repository, icons, remotes } = registry;
  return {
    $schema: CARD_SCHEMA,
    name,
    title,
    description,
    version,
    websiteUrl,
    repository,
    icons,
    remotes: remotes.map(remote => ({ ...remote, supportedProtocolVersions: PROTOCOL_VERSIONS })),
  };
}

module.exports = { serverCard, CARD_SCHEMA, CARD_TYPE, CARD_PATH, CARD_PATHS, PROTOCOL_VERSIONS };
