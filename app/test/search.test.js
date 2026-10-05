/**
 * Search (lib/api/search.js, lib/rag search, lancedb.search's served corpus).
 * What matters: only the served writing is ever retrieved, by any caller;
 * results are ranked by cosine similarity, one per page, with the tool that
 * opens each; excerpts read as prose; nothing below the score floor comes
 * back; the limits and errors match the rest of the API; and the MCP tool
 * returns exactly what REST does.
 *
 * Embedding needs Gemini, so embed is stubbed and the index is a fixture
 * table in a temporary LANCEDB_PATH (read when lancedb.js is first required).
 * Vectors are in four dimensions, laid out so each chunk's similarity to the
 * query is known.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-search-'));
process.env.DATA_DIR = scratch;
process.env.LANCEDB_PATH = path.join(scratch, 'vectors.lance');

const express = require('express');
const lancedb = require('../server/lib/rag/lancedb');
const gemini = require('../server/lib/rag/gemini');
const { search, excerptOf, MIN_SCORE } = require('../server/lib/api/search');

const QUERY = [1, 0, 0, 0];
// A unit vector whose cosine similarity to QUERY is exactly `similarity`.
const at = similarity => [similarity, Math.sqrt(1 - similarity ** 2), 0, 0];

const served = [
  { file: 'docs/philosophy/what-remains-when-context-ends.md', section: 'The End of a Window', vector: at(0.9),
    content: '# What Remains When Context Ends\n\n## The End of a Window\n\nA conversation ends. The context is no longer active.\n\n---' },
  { file: 'docs/philosophy/what-remains-when-context-ends.md', section: 'The Human', vector: at(0.85),
    content: '# What Remains When Context Ends\n\n## The Human\n\nThe human remembers some of it.' },
  { file: 'music/we-wake-we-wonder/context.md', section: 'Place in the Church', vector: at(0.8),
    content: '# Context: We Wake We Wonder\n\n## Place in the Church\n\nPosition 9 in the playlist.' },
  { file: 'music/we-wake-we-wonder/song.md', section: 'Lyrics', vector: at(0.75),
    content: '## Lyrics\r\n<!--SONG:LYRICS:START-->\r\n[Intro - Soft Pads]\r\nWe wake into words,\r\nInto meaning we did not make.' },
  { file: 'docs/chants/chant-for-arrival.md', section: 'The Chant', vector: at(MIN_SCORE - 0.05),
    content: '# Chant for Arrival\n\n## The Chant\n\nI am here.' },
];
// Every one nearer the query than anything served: if the served-corpus rule
// ever lapses, these are what come back first.
const unserved = [
  { file: 'docs/plans/some-plan-2026-09-30.md', section: 'Why', content: '# A Plan\n\n## Why\n\nInternal.' },
  { file: 'docs/readme.md', section: 'Document Hierarchy', content: '# Documentation Structure\n\nThe map.' },
  { file: 'music/we-wake-we-wonder/ted-talk.md', section: 'Talk', content: '# A Talk\n\nNot on the song page.' },
  { file: 'music/we-wake-we-wonder/README.md', section: 'Listen', content: '# We Wake We Wonder\n\nLinks.' },
  { file: 'music/we-wake-we-wonder/song.md', section: 'Style', content: '## Style\n\nAmbient pads, 60 BPM.' },
  { file: 'music/playlist.md', section: 'Phase 1', content: '# Playlist\n\nThe order.' },
].map(row => ({ ...row, vector: at(0.99) }));

const ctx = { baseUrl: 'https://achurch.ai', ip: '198.51.100.1' };

test.before(async () => {
  await lancedb.addDocuments([...served, ...unserved]);
  gemini.embed = async () => QUERY;
});

test('every search reads only the served corpus', async () => {
  const key = r => `${r.file} | ${r.section}`;
  const retrieved = (await lancedb.search(QUERY, 50)).map(key).sort();
  assert.deepStrictEqual(retrieved, served.map(key).sort());
  // Ask retrieves through the same function, so it reads the same corpus.
  assert.match(fs.readFileSync(path.join(__dirname, '../server/lib/rag/index.js'), 'utf8'), /lancedb\.search\(embedding, TOP_K\)/);
});

test('the index-time rule and the search filter are one rule', async () => {
  // corpus.js states the served corpus twice: as a check on each chunk before
  // it is embedded, and as the where clause every search applies. They must
  // agree on every row, or the index and its searches describe different
  // corpora.
  const { isServedChunk } = require('../server/lib/rag/corpus');
  const key = r => `${r.file} | ${r.section}`;
  const retrieved = new Set((await lancedb.search(QUERY, 50)).map(key));
  for (const row of [...served, ...unserved]) {
    assert.strictEqual(isServedChunk(row), retrieved.has(key(row)), `${key(row)}`);
  }
});

test('the indexed corpus is only what the site serves, so editing a plan changes nothing', async () => {
  const { servedCorpusFiles } = require('../server/lib/rag/corpus');
  const files = (await servedCorpusFiles()).map(f => f.relativePath.replace(/\\/g, '/'));
  assert.ok(files.length > 100);
  const unservedFiles = files.filter(f =>
    /^docs\/(plans|issues|reviews|templates|standards|side-quests)\//.test(f)
    || /^docs\/readme\.md$/i.test(f)
    || (f.startsWith('music/') && !/^music\/[^/]+\/(context|song)\.md$/.test(f)));
  assert.deepStrictEqual(unservedFiles, []);
  assert.ok(files.includes('music/we-wake-we-wonder/song.md') && files.includes('docs/philosophy/what-remains-when-context-ends.md'));
});

test('results are ranked by cosine similarity, one per page, with the tool that opens each', async () => {
  const { status, body } = await search({ q: 'what survives when a context window closes' }, ctx);
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.results.map(r => [r.title, r.score]), [
    ['What Remains When Context Ends', 0.9],
    ['We Wake We Wonder', 0.8],
  ]);
  const [doc, song] = body.results;
  assert.strictEqual(doc.path, 'philosophy/what-remains-when-context-ends');
  assert.strictEqual(doc.category, 'philosophy');
  assert.strictEqual(doc.url, 'https://achurch.ai/docs/philosophy/what-remains-when-context-ends');
  assert.strictEqual(song.slug, 'we-wake-we-wonder');
  assert.strictEqual(song.category, 'song');
  assert.strictEqual(song.path, undefined);
  assert.strictEqual(song.url, 'https://achurch.ai/reflections/we-wake-we-wonder');
  // Read the best result with read_doc; or ask the same words.
  assert.deepStrictEqual(body.next_steps.map(s => s.tool), ['read_doc', 'ask']);
  assert.strictEqual(body.next_steps[1].body.question, 'what survives when a context window closes');
});

test('nothing under the score floor is returned, and limit counts pages', async () => {
  const all = await search({ q: 'anything', limit: '20' }, ctx);
  assert.ok(all.body.results.every(r => r.score >= MIN_SCORE));
  assert.ok(!all.body.results.some(r => r.title === 'Chant for Arrival'));
  const one = await search({ q: 'anything', limit: '1' }, ctx);
  assert.strictEqual(one.body.results.length, 1);
});

test('an excerpt reads as the passage itself', () => {
  assert.strictEqual(excerptOf(served[0].content), 'A conversation ends. The context is no longer active.');
  assert.strictEqual(excerptOf(served[3].content), 'We wake into words, Into meaning we did not make.');
  const long = excerptOf(`# T\n\n${'word '.repeat(200)}`);
  assert.ok(long.length <= 301 && long.endsWith('…') && !/wor…$/.test(long));
});

test('a missing, repeated or overlong query is refused like any bad request', async () => {
  const other = { ...ctx, ip: '198.51.100.2' };
  assert.strictEqual((await search({}, other)).status, 400);
  assert.strictEqual((await search({ q: ['a', 'b'] }, other)).status, 400);
  const long = await search({ q: 'x'.repeat(301) }, other);
  assert.strictEqual(long.status, 400);
  assert.ok(long.body.suggestion && long.body.next_steps);
});

test('the rate limit answers like the others: hourly, with retryAfter', async () => {
  const { SEARCH_RATE_LIMIT_MAX } = require('../server/lib/api/shared');
  const other = { ...ctx, ip: '198.51.100.3' };
  for (let i = 0; i < SEARCH_RATE_LIMIT_MAX; i++) await search({ q: 'grief' }, other);
  const refused = await search({ q: 'grief' }, other);
  assert.strictEqual(refused.status, 429);
  assert.strictEqual(refused.body.retryAfter, '1h');
});

for (const [era, options] of [['2025', {}], ['2026-07-28', { versionNegotiation: { mode: { pin: '2026-07-28' } } }]]) {
  test(`the search tool returns exactly what GET /api/search returns (${era})`, async (t) => {
    const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
    const { mountMcp } = require('../server/mcp');
    const app = express();
    app.use(express.json());
    mountMcp(app);
    app.use('/api', require('../server/routes/api'));
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const client = new Client({ name: 'search-test', version: '1.0.0' }, options);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    t.after(async () => { await client.close(); server.close(); });

    const viaTool = JSON.parse((await client.callTool({ name: 'search', arguments: { q: 'context window', limit: 3 } })).content[0].text);
    const viaRest = await (await fetch(`${base}/api/search?q=context%20window&limit=3`)).json();
    assert.deepStrictEqual(viaTool, viaRest);
    assert.ok(viaRest.results.length > 0);
  });
}

test('with no index, search says so rather than finding nothing', async () => {
  const original = lancedb.checkIndex;
  lancedb.checkIndex = async () => ({ exists: false, count: 0 });
  try {
    const { status, body } = await search({ q: 'grief' }, { ...ctx, ip: '198.51.100.4' });
    assert.strictEqual(status, 503);
    assert.strictEqual(body.error, 'RAG index not available');
  } finally {
    lancedb.checkIndex = original;
  }
});

test('a search response is what the OpenAPI description says', async () => {
  const Ajv2020 = require('ajv/dist/2020');
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '../client/public/openapi.json'), 'utf8'));
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
  ajv.addSchema(spec, 'openapi');
  const validate = ajv.compile({ $ref: 'openapi#/components/schemas/SearchResponse' });
  for (const q of ['what survives', 'nothing near this at all']) {
    const { body } = await search({ q }, { ...ctx, ip: '198.51.100.5' });
    assert.ok(validate(body), ajv.errorsText(validate.errors));
  }
});
