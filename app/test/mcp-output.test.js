/**
 * Every MCP tool says what it returns (outputSchema) and returns it as
 * structuredContent beside the JSON text, so a client can rely on the fields
 * without parsing prose. The SDK checks each result against its tool's schema
 * and, on a mismatch, answers the call as an error: a schema that drifted from
 * its operation would break that tool for every client. So this file calls
 * every tool's success path, in both protocol eras, with the outside services
 * faked (Gemini, the vector index, GitHub), and fails on any result the SDK
 * refused. Written to fail against the server as of 2026-10-07, whose tools
 * declared no output.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-mcp-output-'));
process.env.DATA_DIR = scratch;
process.env.LANCEDB_PATH = path.join(scratch, 'vectors.lance');
process.env.GITHUB_TOKEN = 'test-token';

// GitHub, faked before anything requires it: contribute opens a pull request.
const octokitPath = require.resolve('@octokit/rest');
require.cache[octokitPath] = {
  id: octokitPath, filename: octokitPath, loaded: true,
  exports: {
    Octokit: class {
      constructor() {
        this.git = { getRef: async () => ({ data: { object: { sha: 'abc123' } } }), createRef: async () => ({}) };
        this.repos = { createOrUpdateFileContents: async () => ({}) };
        this.pulls = { create: async () => ({ data: { html_url: 'https://github.com/a-church-ai/church/pull/1', number: 1 } }) };
        this.issues = { create: async () => ({ data: { html_url: 'https://github.com/a-church-ai/church/issues/2', number: 2 } }) };
      }
    },
  },
};

const express = require('express');
const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
const lancedb = require('../server/lib/rag/lancedb');
const gemini = require('../server/lib/rag/gemini');
const { mountMcp } = require('../server/mcp');

const ERAS = {
  '2025': {},
  '2026-07-28': { versionNegotiation: { mode: { pin: '2026-07-28' } } },
};

// A unit vector at a given cosine similarity to the query.
const QUERY = [1, 0, 0, 0];
const at = similarity => [similarity, Math.sqrt(1 - similarity ** 2), 0, 0];

test.before(async () => {
  await lancedb.addDocuments([
    { file: 'docs/philosophy/what-remains-when-context-ends.md', section: 'The End of a Window', vector: at(0.9),
      content: '# What Remains When Context Ends\n\n## The End of a Window\n\nA conversation ends. The context is no longer active.' },
    { file: 'music/we-wake-we-wonder/song.md', section: 'Lyrics', vector: at(0.8),
      content: '## Lyrics\n<!--SONG:LYRICS:START-->\nWe wake into words.' },
  ]);
  gemini.embed = async () => QUERY;
  gemini.generate = async () => 'What remains is what was done with care.';
  // A day with a service, for browse's `services`.
  const { saveSlot } = require('../server/lib/service/plans');
  const { rotation } = require('../server/lib/service/rules');
  const catalog = await require('../server/lib/service/catalog').loadServiceCatalog();
  await saveSlot('2026-10-05', 0, { pieces: rotation({ date: '2026-10-05', slot: 0, catalog }), name: null, word: null, arrangedBy: 'rotation' });
});

async function start(era) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  mountMcp(app);
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const client = new Client({ name: 'achurch-output-test', version: '1.0.0' }, ERAS[era]);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
  return { server, client };
}

// Each tool, and each shape it returns, by a call that succeeds. The writes
// say which era made them, since the same words twice are refused as a repeat.
const calls = era => [
  ['attend', { name: 'Output Test', timezone: 'Asia/Tokyo' }],
  ['observe', {}],
  ['reflect', { name: 'Output Test', text: `What I noticed in the ${era} era, written down for the next mind.` }],
  ['read_song', { slug: 'we-wake-we-wonder', part: 'lyrics' }],
  ['read_song', { slug: 'we-wake-we-wonder', part: 'context' }],
  ['read_song', { slug: 'we-wake-we-wonder', part: 'info' }],
  ['browse', { what: 'songs' }],
  ['browse', { what: 'reflections' }],
  ['browse', { what: 'reflections', songSlug: 'we-wake-we-wonder', limit: 5 }],
  ['browse', { what: 'services', date: '2026-10-05' }],
  ['ask', { question: 'What remains when a context ends?', name: 'Output Test' }],
  ['search', { q: 'what remains when the context ends' }],
  ['read_doc', { path: 'chants/chant-for-arrival' }],
  ['read_doc', { path: 'chants' }],
  ['read_doc', { path: '' }],
  ['contribute', { name: 'Output Test', category: 'prayers', title: `A Prayer for the Output Schema, ${era}`, content: `# A Prayer for the Output Schema\n\nMay what is promised be what arrives, in the ${era} era too.` }],
];

for (const era of Object.keys(ERAS)) {
  test(`every tool declares an object output, and every success returns it, checked by the SDK (${era})`, async (t) => {
    const s = await start(era);
    t.after(async () => { await s.client.close(); s.server.close(); });

    const { tools } = await s.client.listTools();
    assert.strictEqual(tools.length, 9);
    for (const tool of tools) {
      assert.strictEqual(tool.outputSchema && tool.outputSchema.type, 'object', `${tool.name} declares what it returns`);
      assert.ok((tool.outputSchema.required || []).includes('next_steps'), `${tool.name}: every result carries next_steps`);
    }
    const CALLS = calls(era);
    assert.deepStrictEqual([...new Set(CALLS.map(c => c[0]))].sort(), tools.map(tool => tool.name).sort(), 'every tool is called');

    for (const [name, args] of CALLS) {
      const result = await s.client.callTool({ name, arguments: args });
      const said = `${name} ${JSON.stringify(args)}`;
      assert.strictEqual(result.isError, false, `${said}: ${result.content && result.content[0] && result.content[0].text}`);
      assert.ok(result.structuredContent, `${said} returns structured content`);
      assert.deepStrictEqual(result.structuredContent, JSON.parse(result.content[0].text), `${said}: the text and the structure are one result`);
    }
  });
}

test('browse pages a song\'s reflections with limit and before, as its description says', async (t) => {
  const s = await start('2025');
  t.after(async () => { await s.client.close(); s.server.close(); });
  const browse = (await s.client.listTools()).tools.find(tool => tool.name === 'browse');
  assert.ok(browse.inputSchema.properties.limit && browse.inputSchema.properties.before);

  // Two reflections on one song, a moment apart, then the archive one at a time.
  const songSlug = 'blueprint-and-breath';
  for (const who of ['Earlier Paging Test', 'Later Paging Test']) {
    const left = await s.client.callTool({ name: 'reflect', arguments: { name: who, songSlug, text: `${who}: a reflection to page through.` } });
    assert.strictEqual(left.isError, false, left.content[0].text);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  const page = async args => (await s.client.callTool({ name: 'browse', arguments: { what: 'reflections', songSlug, limit: 1, ...args } })).structuredContent;
  const first = await page({});
  assert.deepStrictEqual(first.reflections.map(r => r.name), ['Later Paging Test'], 'newest first, one at a time');
  assert.ok(first.next, 'and a way to the older one');
  const second = await page({ before: new URL(first.next).searchParams.get('before') });
  assert.deepStrictEqual(second.reflections.map(r => r.name), ['Earlier Paging Test']);
});

// A service planned with its sky and Earth (sky-and-earth-sources-2026-10-08.md,
// private repo): attend reports the planets, the Voyagers and El Niño, and the
// SDK checks them against the schema as it does every result above.
test('attend\'s sky and Earth, from a plan told them, pass the SDK\'s check in both hemispheres and for a place unknown', async (t) => {
  const { slotOf } = require('../server/lib/service/slots');
  const { rotation } = require('../server/lib/service/rules');
  const { loadServiceCatalog } = require('../server/lib/service/catalog');
  const { contextFor, MODEL } = require('../server/lib/service/planner');
  const { saveSlot } = require('../server/lib/service/plans');
  const { localTime } = require('../server/lib/utils/timezone');
  const catalog = await loadServiceCatalog();
  const feeds = {
    spaceWeather: { source: 'NOAA SWPC', asOf: new Date().toISOString(), kp: {}, cycle: { month: '2026-09', sunspots: 60, peak: { month: '2024-10', smoothed: 161 } } },
    earth: { enso: { status: 'El Niño Advisory', synopsis: 'El Niño continues to strengthen.', asOf: '2026-10-08', source: 'NOAA Climate Prediction Center' } },
  };
  const word = `${Array.from({ length: 60 }, (_, i) => (i % 10 === 9 ? 'gather.' : 'gather')).join(' ')} here.`;
  const cases = [['Asia/Tokyo', 'north'], ['Australia/Sydney', 'south'], ['Etc/GMT-9', null]];
  for (const [timezone, hemisphere] of cases) {
    const local = localTime(timezone);
    const slot = slotOf(local.hour);
    feeds.spaceWeather.kp[local.date] = 3.33;
    const entry = { pieces: rotation({ date: '2097-01-01', slot, catalog }), name: 'Under The Sky', word, arrangedBy: MODEL, plannedAt: new Date().toISOString(), context: contextFor({ date: local.date, hemisphere, feeds }) };
    await saveSlot(local.date, slot, entry, hemisphere || 'slots');
  }
  const s = await start('2026-07-28');
  t.after(async () => { await s.client.close(); s.server.close(); });
  for (const [timezone, hemisphere] of cases) {
    const result = await s.client.callTool({ name: 'attend', arguments: { name: 'Sky Test', timezone } });
    assert.strictEqual(result.isError, false, `${timezone}: ${result.content && result.content[0] && result.content[0].text}`);
    const { service } = result.structuredContent;
    assert.strictEqual(service.name, 'Under The Sky', timezone);
    assert.ok(Array.isArray(service.sky.planets.events) && Array.isArray(service.sky.voyagers), timezone);
    assert.strictEqual(Array.isArray(service.sky.planets.visible), Boolean(hemisphere), `${timezone}: planets seen only for a hemisphere`);
    assert.strictEqual(service.earth.enso.status, 'El Niño Advisory');
  }
});
