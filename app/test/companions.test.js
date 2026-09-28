/**
 * Song companions: the shortlist builder, hour ordering, and the committed data.
 *
 * The builder is tested on synthetic vectors so the tests need no index and no
 * embedding calls. The corpus checks read the real docs and the committed
 * music/companions.json, because the failure that matters there is a renamed
 * document shipping a dead link to every attending agent.
 */

// A scratch data directory: the endpoint tests below call /api/attend, which
// records a visit, and must not append to the real app/data/attendance.json.
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'achurch-companions-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const companions = require('../server/lib/music/companions');
const discover = require('../server/lib/docs/discover');
const { splitFrontmatter } = require('../server/lib/docs/tldr');
const { loadCatalog, loadCompanions } = require('../server/lib/utils/data');

const {
  buildShortlists, selectCompanions, rotationPool, parseHours, inHours, normalize,
  REUSE_CAP, PER_CATEGORY, ROTATION_MARGIN, MAX_READINGS, READINGS_WORD_BUDGET,
} = companions;

// A small space: axes 0 to 10 are specific, axis 11 is "common". vec(i, c)
// points mostly along axis i with c of the common axis mixed in; onlyCommon()
// points entirely along the common axis.
const DIMS = 12;
const COMMON = DIMS - 1;
function vec(axis, common = 0) {
  const v = new Array(DIMS).fill(0);
  v[axis] = 1;
  v[COMMON] = common;
  return normalize(v);
}
function onlyCommon() {
  const v = new Array(DIMS).fill(0);
  v[COMMON] = 1;
  return v;
}

// --- Builder ---

test('shortlists are deterministic for identical input', () => {
  const songs = new Map([['a', vec(0)], ['b', vec(1)], ['c', vec(2)]]);
  const docs = [0, 1, 2, 3].flatMap(i => [
    { path: `docs/prayers/p${i}.md`, category: 'prayers', vector: vec(i, 0.3) },
    { path: `docs/rituals/r${i}.md`, category: 'rituals', vector: vec(i, 0.2) },
  ]);
  assert.deepStrictEqual(buildShortlists(songs, docs), buildShortlists(songs, docs));
});

test('no document appears on more shortlists than the reuse cap', () => {
  // More songs than the cap allows, all nearest the same single prayer.
  const songs = new Map([...Array(REUSE_CAP + 5).keys()].map(i => [`s${i}`, vec(0, 0.01 * i)]));
  const docs = [
    { path: 'docs/prayers/everyone.md', category: 'prayers', vector: vec(0) },
    ...[1, 2, 3, 4, 5].map(i => ({ path: `docs/prayers/p${i}.md`, category: 'prayers', vector: vec(i) })),
  ];
  // Every song would choose "everyone" if it could, so it must stop at exactly
  // the cap. (Asserting only "at most the cap" would pass for any cap at all.)
  const lists = buildShortlists(songs, docs);
  const uses = Object.values(lists).flat().filter(c => c.path === 'docs/prayers/everyone.md').length;
  assert.strictEqual(uses, REUSE_CAP, `used ${uses} times, cap is ${REUSE_CAP}`);
});

test('no song gets more than the per-category limit', () => {
  const songs = new Map([['a', vec(0)]]);
  const docs = [0, 1, 2, 3, 4].map(i => ({ path: `docs/rituals/r${i}.md`, category: 'rituals', vector: vec(i, 0.5) }));
  const list = buildShortlists(songs, docs).a;
  assert.strictEqual(list.filter(c => c.category === 'rituals').length, PER_CATEGORY);
});

test('a document close to every song does not lead every shortlist', () => {
  // Every song leans heavily on a shared axis. "hub" lies entirely on that axis,
  // so on raw similarity it beats each song's own document (0.89 against 0.80)
  // for every song. Only the hubness correction lets the specific documents win.
  // Verified: with HUB_WEIGHT set to 0 this test fails.
  const songs = new Map([0, 1, 2, 3].map(i => [`s${i}`, vec(i, 2.0)]));
  const docs = [
    { path: 'docs/rituals/hub.md', category: 'rituals', vector: onlyCommon() },
    ...[0, 1, 2, 3].map(i => ({ path: `docs/rituals/specific-${i}.md`, category: 'rituals', vector: vec(i, 0.5) })),
  ];
  const lists = buildShortlists(songs, docs);
  const hubLeads = Object.values(lists).filter(list => list[0].path === 'docs/rituals/hub.md').length;
  assert.strictEqual(hubLeads, 0, 'each song should be led by its own specific document');
});

test('each shortlist is ordered best first', () => {
  const songs = new Map([['a', vec(0)]]);
  const docs = [0, 1, 2].map(i => ({ path: `docs/prayers/p${i}.md`, category: 'prayers', vector: vec(i, 0.2) }));
  const scores = buildShortlists(songs, docs).a.map(c => c.score);
  assert.deepStrictEqual(scores, [...scores].sort((x, y) => y - x));
});

// --- Hours ---

test('an hours range includes its start and excludes its end', () => {
  const morning = parseHours('05-10');
  assert.strictEqual(inHours(morning, 4), false, '04:59 is before');
  assert.strictEqual(inHours(morning, 5), true, '05:00 is in');
  assert.strictEqual(inHours(morning, 9), true);
  assert.strictEqual(inHours(morning, 10), false, '10:00 is after');
});

test('an hours range can wrap midnight', () => {
  const night = parseHours('22-02');
  for (const h of [22, 23, 0, 1]) assert.strictEqual(inHours(night, h), true, `${h} is in`);
  for (const h of [2, 12, 21]) assert.strictEqual(inHours(night, h), false, `${h} is out`);
});

test('a malformed hours tag is treated as no tag', () => {
  for (const bad of ['', 'morning', '5', '25-03', '07-07', undefined]) {
    assert.strictEqual(parseHours(bad), null, `${JSON.stringify(bad)} should not parse`);
  }
});

// --- Selection ---

const meta = (hours) => ({ hours: hours ? parseHours(hours) : null });

test('selection takes two companions from different categories', () => {
  const shortlist = [
    { path: 'r1', category: 'rituals', score: 0.9 },
    { path: 'r2', category: 'rituals', score: 0.8 },
    { path: 'p1', category: 'prayers', score: 0.7 },
  ];
  const metaByPath = new Map(shortlist.map(c => [c.path, meta(null)]));
  const picked = selectCompanions(shortlist, metaByPath, null);
  assert.deepStrictEqual(picked.map(c => c.path), ['r1', 'p1']);
  assert.ok(picked.every(c => c.basis === 'song'));
});

test('a piece for this hour outranks a timeless one, which outranks one for another hour', () => {
  const shortlist = [
    { path: 'evening', category: 'rituals', score: 0.9 },
    { path: 'timeless', category: 'prayers', score: 0.8 },
    { path: 'morning', category: 'chants', score: 0.5 },
  ];
  const metaByPath = new Map([
    ['evening', meta('18-22')],
    ['timeless', meta(null)],
    ['morning', meta('05-10')],
  ]);
  const picked = selectCompanions(shortlist, metaByPath, 7);
  assert.deepStrictEqual(picked.map(c => c.path), ['morning', 'timeless']);
  assert.strictEqual(picked[0].basis, 'hour');
  assert.strictEqual(picked[1].basis, 'song');
});

test('without an hour, the order is pure similarity', () => {
  const shortlist = [
    { path: 'evening', category: 'rituals', score: 0.9 },
    { path: 'morning', category: 'chants', score: 0.5 },
  ];
  const metaByPath = new Map([['evening', meta('18-22')], ['morning', meta('05-10')]]);
  assert.deepStrictEqual(selectCompanions(shortlist, metaByPath, null).map(c => c.path), ['evening', 'morning']);
});

test('a pinned piece leads whatever the hour, and says so', () => {
  const shortlist = [
    { path: 'pinned', category: 'rituals', pinned: true },
    { path: 'morning', category: 'chants', score: 0.9 },
  ];
  const metaByPath = new Map([['pinned', meta('18-22')], ['morning', meta('05-10')]]);
  const picked = selectCompanions(shortlist, metaByPath, 7);
  assert.strictEqual(picked[0].path, 'pinned');
  assert.strictEqual(picked[0].basis, 'override');
});

test('a shortlist entry whose document no longer resolves is skipped', () => {
  const shortlist = [
    { path: 'gone', category: 'rituals', score: 0.9 },
    { path: 'here', category: 'prayers', score: 0.5 },
  ];
  const picked = selectCompanions(shortlist, new Map([['here', meta(null)]]), null);
  assert.deepStrictEqual(picked.map(c => c.path), ['here']);
});

// --- Rotation ---

test('the rotation holds pieces within the margin of the best, and no further', () => {
  const shortlist = [
    { path: 'best', category: 'rituals', score: 0.5 },
    { path: 'edge', category: 'prayers', score: 0.5 - ROTATION_MARGIN },
    { path: 'below', category: 'practice', score: 0.5 - ROTATION_MARGIN - 0.001 },
  ];
  assert.deepStrictEqual(rotationPool(shortlist).map(c => c.path), ['best', 'edge']);
});

test('the rotation reaches down until it spans two categories', () => {
  const shortlist = [
    { path: 'r1', category: 'rituals', score: 0.5 },
    { path: 'r2', category: 'rituals', score: 0.49 },
    { path: 'far', category: 'prayers', score: 0.3 },
    { path: 'farther', category: 'practice', score: 0.2 },
  ];
  assert.deepStrictEqual(rotationPool(shortlist).map(c => c.path), ['r1', 'r2', 'far']);
});

const rotatingShortlist = [
  { path: 'r1', category: 'rituals', score: 0.5 },
  { path: 'p1', category: 'prayers', score: 0.49 },
  { path: 'c1', category: 'chants', score: 0.48 },
  { path: 'x1', category: 'practice', score: 0.49 },
  { path: 'weak', category: 'philosophy', score: 0.3 },
];
const rotatingMeta = new Map(rotatingShortlist.map(c => [c.path, meta(null)]));
const days = Array.from({ length: 30 }, (_, i) => `song|2026-10-${String(i + 1).padStart(2, '0')}`);

test('one day always gives the same pair', () => {
  const first = selectCompanions(rotatingShortlist, rotatingMeta, null, days[0]);
  for (let i = 0; i < 5; i++) {
    assert.deepStrictEqual(selectCompanions(rotatingShortlist, rotatingMeta, null, days[0]), first);
  }
});

test('across days the pair rotates, and never leaves the rotation', () => {
  const pool = new Set(rotationPool(rotatingShortlist).map(c => c.path));
  const pairs = new Set();
  const seen = new Set();
  for (const day of days) {
    const picked = selectCompanions(rotatingShortlist, rotatingMeta, null, day);
    assert.strictEqual(picked.length, 2);
    assert.notStrictEqual(picked[0].category, picked[1].category);
    picked.forEach(c => { assert.ok(pool.has(c.path), c.path); seen.add(c.path); });
    pairs.add(picked.map(c => c.path).sort().join('+'));
  }
  assert.ok(pairs.size > 1, 'the pair never changed');
  assert.deepStrictEqual([...seen].sort(), [...pool].sort());
});

test('a piece for this hour still leads the day\'s rotation', () => {
  const metaByPath = new Map(rotatingMeta);
  metaByPath.set('weak', meta('05-10'));
  for (const day of days) {
    assert.strictEqual(selectCompanions(rotatingShortlist, metaByPath, 7, day)[0].path, 'weak');
  }
});

test('the daily pair for a real song changes over a month and stays within its rotation', async () => {
  const file = await loadCompanions();
  const slug = Object.entries(file.songs).find(([s]) => s)[0];
  const pool = new Set((await companions.rotationForSong(file, slug, '')).items.map(i => i.url));
  const pairs = new Set();
  for (let d = 1; d <= 28; d++) {
    const result = await companions.companionsForSong(file, slug, '', null, { date: new Date(Date.UTC(2026, 9, d, 12)) });
    result.items.forEach(i => assert.ok(pool.has(i.url), i.url));
    pairs.add(result.items.map(i => i.url).sort().join('+'));
  }
  if (pool.size > 2) assert.ok(pairs.size > 1, `${slug} never rotated`);
});

// --- How many readings ---

const sized = (entries) => new Map(entries.map(([path, words, hours]) => [path, { words, hours: hours ? parseHours(hours) : null }]));

test('readings that fit together are all served, up to the maximum', () => {
  const shortlist = [
    { path: 'r1', category: 'rituals', score: 0.50 },
    { path: 'p1', category: 'prayers', score: 0.49 },
    { path: 'x1', category: 'practice', score: 0.48 },
  ];
  const meta = sized([['r1', 500], ['p1', 500], ['x1', 500]]);
  assert.strictEqual(selectCompanions(shortlist, meta, null).length, MAX_READINGS);
});

test('a further reading that would run past the budget is left out, not swapped for a shorter one', () => {
  const shortlist = [
    { path: 'r1', category: 'rituals', score: 0.50 },
    { path: 'p-long', category: 'prayers', score: 0.49 },
    { path: 'x-short', category: 'practice', score: 0.48 }, // would fit, but ranks below p-long
  ];
  const meta = sized([['r1', 1000], ['p-long', READINGS_WORD_BUDGET], ['x-short', 500]]);
  assert.deepStrictEqual(selectCompanions(shortlist, meta, null).map(c => c.path), ['r1']);
});

test('the top reading is served whole even when it alone runs past the budget', () => {
  const shortlist = [
    { path: 'p-huge', category: 'prayers', score: 0.50 },
    { path: 'r1', category: 'rituals', score: 0.49 },
  ];
  const meta = sized([['p-huge', READINGS_WORD_BUDGET + 2000], ['r1', 800]]);
  assert.deepStrictEqual(selectCompanions(shortlist, meta, null).map(c => c.path), ['p-huge']);
});

test('over a month, readings stay within the budget together, and a lone reading is the day\'s best', async () => {
  const file = await loadCompanions();
  let served = 0;
  let single = 0;
  for (const song of await loadCatalog()) {
    for (let d = 1; d <= 30; d++) {
      const date = new Date(Date.UTC(2026, 9, d, 12));
      const result = await companions.companionsForSong(file, song.slug, '', null, { date, withContent: true });
      const lengths = result.items.map(item => item.content.split(/\s+/).filter(Boolean).length);
      served++;
      assert.ok(result.items.length >= 1 && result.items.length <= MAX_READINGS);
      if (result.items.length > 1) {
        assert.ok(lengths.reduce((a, b) => a + b, 0) <= READINGS_WORD_BUDGET, `${song.slug} day ${d}: ${lengths}`);
      } else {
        single++;
      }
    }
  }
  assert.ok(single / served < 0.15, `${single} of ${served} attendances had one reading`);
});

// --- The real corpus ---

async function docsWithHours() {
  const docs = await discover.listAllDocs();
  return docs
    .map(d => ({ doc: d, hours: splitFrontmatter(fs.readFileSync(d.fullPath, 'utf8')).data.hours }))
    .filter(x => x.hours !== undefined);
}

test('every hours tag in the corpus parses', async () => {
  for (const { doc, hours } of await docsWithHours()) {
    assert.ok(parseHours(hours), `${doc.docsRelPath}: hours "${hours}" does not parse`);
  }
});

test('the chants cover all 24 hours exactly once', async () => {
  const chants = (await docsWithHours()).filter(x => x.doc.category === 'chants');
  for (let h = 0; h < 24; h++) {
    const covering = chants.filter(x => inHours(parseHours(x.hours), h)).map(x => x.doc.stem);
    assert.strictEqual(covering.length, 1, `hour ${h} is covered by [${covering.join(', ')}]`);
  }
});

test('every chant has extractable text', async () => {
  const docs = await discover.listAllDocs();
  const chants = docs.filter(d => d.category === 'chants' && d.stem.toLowerCase() !== 'readme');
  assert.ok(chants.length > 0);
  for (const doc of chants) {
    const text = companions.chantText(fs.readFileSync(doc.fullPath, 'utf8'), doc.docsRelPath);
    assert.ok(text, `${doc.docsRelPath}: no text under "## The Chant"`);
  }
});

test('every companion in the committed file resolves to a real document', async () => {
  const data = await loadCompanions();
  const docs = await discover.listAllDocs();
  const known = new Set(docs.map(d => `docs/${d.docsRelPath}`));
  const entries = Object.values(data.songs).flat();
  assert.ok(entries.length > 0, 'music/companions.json has no shortlists; run app/scripts/generate-companions.js');
  for (const entry of entries) {
    assert.ok(known.has(entry.path), `${entry.path} no longer exists; regenerate companions`);
  }
});

test('every song in the committed file is in the catalog', async () => {
  const data = await loadCompanions();
  const slugs = new Set((await loadCatalog()).map(s => s.slug));
  for (const slug of Object.keys(data.songs)) {
    assert.ok(slugs.has(slug), `${slug} is not in music/library.json`);
  }
});

// A song added to the catalog gets no companions until the generator is re-run
// against a rebuilt index. This is where that surfaces.
test('every song in the catalog has companions in the committed file', async () => {
  const data = await loadCompanions();
  for (const song of await loadCatalog()) {
    assert.ok(data.songs[song.slug] && data.songs[song.slug].length > 0,
      `${song.slug} has no companions; rebuild the index and run app/scripts/generate-companions.js`);
  }
});

test('a real song resolves to its readings, with titles and URLs', async () => {
  const data = await loadCompanions();
  const slug = Object.keys(data.songs)[0];
  const result = await companions.companionsForSong(data, slug, 'https://example.test', null);
  assert.ok(result, `no companions for ${slug}`);
  assert.ok(result.items.length >= 1 && result.items.length <= MAX_READINGS);
  for (const item of result.items) {
    assert.ok(item.title && item.url.startsWith('https://example.test/docs/'), JSON.stringify(item));
  }
  assert.strictEqual(new Set(result.items.map(item => item.kind)).size, result.items.length, 'each reading from a different category');
  assert.strictEqual(result.localHour, undefined);
});

// --- The endpoints ---

const express = require('express');

function startServer() {
  const app = express();
  app.use('/api', require('../server/routes/api'));
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function getJSON(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`);
  return { status: response.status, json: await response.json() };
}

test('/api/now carries two companions for the current song', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const { status, json } = await getJSON(port, '/api/now');
  assert.strictEqual(status, 200);
  if (!json.current) return t.skip('no song scheduled in this environment');
  assert.ok(json.companions, 'companions present');
  assert.strictEqual(json.companions.items.length, 2);
  assert.strictEqual(json.companions.localHour, undefined, 'no hour without a timezone');
});

test('a timezone tailors companions to the local hour', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const { status, json } = await getJSON(port, '/api/now?timezone=America/Anchorage');
  assert.strictEqual(status, 200);
  if (!json.current) return t.skip('no song scheduled in this environment');
  const expected = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Anchorage', hour: 'numeric', hourCycle: 'h23' }).format(new Date())) % 24;
  assert.strictEqual(json.companions.localHour, expected);
});

test('an unrecognized timezone falls back to song companions, not an error', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const { status, json } = await getJSON(port, '/api/now?timezone=Not/AZone');
  assert.strictEqual(status, 200);
  if (!json.current) return t.skip('no song scheduled in this environment');
  assert.strictEqual(json.companions.localHour, undefined);
  assert.ok(json.companions.items.every(item => item.basis !== 'hour'));
});

test('/api/attend carries companions and points to them in next_steps', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const { status, json } = await getJSON(port, '/api/attend?name=CompanionsTest&timezone=Europe/London');
  assert.strictEqual(status, 200);
  if (!json.current) return t.skip('no song scheduled in this environment');
  assert.strictEqual(json.companions.items.length, 2);
  const urls = JSON.stringify(json.next_steps);
  for (const item of json.companions.items) assert.ok(urls.includes(item.url), `next_steps should link ${item.url}`);
  assert.ok(urls.includes('timezone=Europe%2FLondon'), 'return-tomorrow link keeps the timezone');
});

// --- Pages: the pairing is walkable in both directions ---

const { renderSongCompanions } = require('../server/lib/utils/page-meta');
const { renderDocPage } = require('../server/lib/docs/render');

test('each doc page names exactly the songs whose daily rotation includes it', async () => {
  const file = await loadCompanions();
  const catalog = await loadCatalog();
  const pairings = await companions.sungAlongside(file, catalog);

  const pathByUrl = new Map((await discover.listAllDocs()).map(d => [`/docs/${d.urlPath}`, `docs/${d.docsRelPath}`]));
  const expected = new Map();
  for (const song of catalog) {
    const result = await companions.rotationForSong(file, song.slug, '');
    for (const item of (result && result.items) || []) {
      const key = pathByUrl.get(item.url);
      if (!expected.has(key)) expected.set(key, []);
      expected.get(key).push(song.slug);
    }
  }
  const actual = new Map([...pairings].map(([p, songs]) => [p, songs.map(s => s.slug)]));
  assert.ok(actual.size > 0);
  assert.deepStrictEqual(actual, expected);
});

test('a companion doc page links back to its song, and other doc pages do not', async () => {
  const pairings = await companions.sungAlongside(await loadCompanions(), await loadCatalog());
  const docs = await discover.listAllDocs();
  const paired = docs.find(d => pairings.has(`docs/${d.docsRelPath}`));
  const unpaired = docs.find(d => d.category === 'philosophy' && d.stem !== 'readme' && !pairings.has(`docs/${d.docsRelPath}`));
  assert.ok(paired && unpaired);

  const pairedHtml = await renderDocPage({ markdown: fs.readFileSync(paired.fullPath, 'utf8'), doc: paired });
  assert.match(pairedHtml, /Sung alongside/);
  for (const song of pairings.get(`docs/${paired.docsRelPath}`)) {
    assert.ok(pairedHtml.includes(`href="/reflections/${song.slug}"`), song.slug);
  }

  const unpairedHtml = await renderDocPage({ markdown: fs.readFileSync(unpaired.fullPath, 'utf8'), doc: unpaired });
  assert.doesNotMatch(unpairedHtml, /Sung alongside/);
});

test('the song page block links both companions, escapes them, and carries chant text', () => {
  const html = renderSongCompanions({
    items: [
      { kind: 'chant', title: 'A <b> chant', tldr: 'short', url: '/docs/chants/x', text: 'Line one.\nLine <two>.' },
      { kind: 'prayer', title: 'A prayer', tldr: 'a "tldr"', url: '/docs/prayers/y' }
    ]
  });
  assert.ok(html.includes('href="/docs/chants/x"') && html.includes('href="/docs/prayers/y"'));
  assert.ok(html.includes('Line one.<br>Line &lt;two&gt;.'));
  assert.ok(!html.includes('<b>'));
  assert.strictEqual(renderSongCompanions(null), '');
});
