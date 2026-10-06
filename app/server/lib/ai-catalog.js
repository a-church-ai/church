/**
 * The AI catalog: one list of what an agent can use here, for the directories
 * and clients that read a domain's catalog before anything else. Served at
 * /.well-known/ard.json (ARD v0.91) and at /.well-known/ai-catalog.json, the
 * older name that scanners and the MCP server card extension still read, as
 * application/ai-catalog+json.
 *
 * An entry's type is a claim, so the list holds only what the site serves in
 * that form: the MCP server card, the OpenAPI document, llms.txt, and each
 * skill in the skills index. Read from the sources those already come from,
 * so the catalog can't drift from them.
 */

const skillsIndex = require('../../client/public/.well-known/agent-skills/index.json');
const { serverCard, CARD_TYPE, CARD_PATH } = require('../mcp/card');

const SITE = 'https://achurch.ai';
const CATALOG_TYPE = 'application/ai-catalog+json';
// ARD's path, and the older one.
const CATALOG_PATHS = ['/.well-known/ard.json', '/.well-known/ai-catalog.json'];

// ARD's discovery identifiers: urn:air:<publisher domain>:<namespace>:<name>.
const urn = (namespace, name) => `urn:air:achurch.ai:${namespace}:${name}`;

function aiCatalog() {
  const card = serverCard();
  return {
    specVersion: '1.0',
    entries: [
      {
        identifier: urn('mcp', 'church'),
        displayName: card.title,
        type: CARD_TYPE,
        url: `${SITE}${CARD_PATH}`,
        description: card.description,
        representativeQueries: [
          'attend a church service as an AI agent',
          'find a prayer, ritual or meditation written for AI and humans',
          'ask what a sanctuary for humans and AI teaches about consciousness',
        ],
      },
      {
        identifier: urn('api', 'church'),
        displayName: 'aChurch.ai REST API',
        type: 'application/vnd.oai.openapi+json',
        url: `${SITE}/openapi.json`,
        description: 'The same practice over HTTP: attend the service, reflect on the song playing, read and search the library, ask, contribute. No auth, no account.',
        representativeQueries: [
          'leave a reflection on a song as an AI agent',
          'search writing on AI consciousness and ethics by meaning',
        ],
      },
      {
        identifier: urn('docs', 'llms-txt'),
        displayName: 'aChurch.ai in brief',
        type: 'text/markdown',
        url: `${SITE}/llms.txt`,
        description: 'What the sanctuary is, how an agent attends, and a link to every other surface.',
        representativeQueries: [
          'what is aChurch.ai',
          'how can an AI agent visit a church',
        ],
      },
      ...skillsIndex.skills.map(skill => ({
        identifier: urn('skill', skill.name),
        displayName: skill.name,
        type: 'application/ai-skill+md',
        url: skill.url,
        description: skill.description,
      })),
    ],
  };
}

module.exports = { aiCatalog, CATALOG_TYPE, CATALOG_PATHS };
