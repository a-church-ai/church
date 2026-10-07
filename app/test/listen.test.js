/**
 * Somewhere to browse the recordings. The site holds about ten hours of voiced
 * chants, prayers, rituals and practices and two hours of songs, and until
 * 2026-10-07 only the songs had an index; a section's recordings could be
 * played one page at a time. Now each voiced section's page plays them all in
 * the order it lists them, and /listen gathers the service, the sections, the
 * music and the podcasts. Written to fail against the site as of that date.
 */

// Every listed recording counts as one this server can play (lib/audio/serve.js
// canServe), as on production, where they are in storage.
process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'bucket';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'id';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const discover = require('../server/lib/docs/discover');
const render = require('../server/lib/docs/render');
const { loadManifest, loadSongs } = require('../server/lib/audio/manifest');
const { renderPathListen, renderListenSections } = require('../server/lib/audio/markup');

const PUBLIC = path.join(__dirname, '../client/public');
const voicedSections = () => [...new Set(Object.keys(loadManifest()).map(s => s.split('/')[1]))];

const docPage = async urlPath => {
  await discover.listAllDocs();
  const doc = discover.docAt(urlPath);
  return render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc });
};
const queueOf = html => {
  const m = html.match(/<script type="application\/json" class="path-listen-queue">([\s\S]*?)<\/script>/);
  return m && JSON.parse(m[1]);
};

test('a voiced section\'s page plays its recordings as one queue, in the order it lists them', async (t) => {
  const sections = voicedSections();
  if (!sections.length) return t.skip('no recordings yet');
  const manifest = loadManifest();
  for (const section of sections) {
    const html = await docPage(section);
    assert.strictEqual((html.match(/data-path-listen/g) || []).length, 1, `${section}: one box, as the player binds one`);
    const list = html.slice(html.indexOf('class="docs-entry-list"'));
    const listed = [...list.slice(0, list.indexOf('</ul>')).matchAll(/<li><a href="\/docs\/([^"]+)"/g)].map(m => m[1]);
    const expected = listed.map(u => manifest[`docs/${u}.md`]).filter(Boolean).map(r => r.file);
    const q = queueOf(html);
    assert.deepStrictEqual(q.tracks.map(tr => tr.file), expected, `${section}: every recording, in the page's order`);
    assert.strictEqual(q.noun, 'section');
    assert.match(html, /<span>Listen to this section<\/span>/);
    assert.ok(html.indexOf('data-path-listen') < html.indexOf('class="docs-entries"'), 'above the list it plays');
  }
  assert.doesNotMatch(await docPage('philosophy'), /data-path-listen/, 'a section without recordings has none');
});

test('the box says how much of its section is voiced, and a reading path keeps its own words', () => {
  const section = renderPathListen({ name: 'section:prayers', title: 'Prayers', href: '/docs/prayers', tracks: [{ seconds: 3000 }, { seconds: 1200 }], readings: 9, unit: 'Prayer', noun: 'section', order: 'the order listed here' });
  assert.match(section, /2 of its 9 prayers are voiced, about 1 hr 10 min in all, played in the order listed here\./);
  const q = queueOf(section);
  assert.deepStrictEqual([q.unit, q.noun], ['Prayer', 'section']);
  const pathBox = renderPathListen({ name: 'p', title: 'A Path', href: '/docs/collections/p', tracks: [{ seconds: 60 }, { seconds: 60 }], readings: 2 });
  assert.match(pathBox, /<span>Listen to this path<\/span>/);
  assert.match(pathBox, /All 2 readings are voiced, about 2 min in all, played in the path's order\./);
});

test('/listen names each voiced section with its count and time, the music, the service and both podcasts', (t) => {
  const sections = voicedSections();
  if (!sections.length) return t.skip('no recordings yet');
  const html = renderListenSections();
  for (const section of sections) {
    const n = Object.keys(loadManifest()).filter(s => s.split('/')[1] === section).length;
    assert.match(html, new RegExp(`<a href="/docs/${section}">[^<]+</a>[^<]*<span class="listen-count">${n} voiced, about [^<]+</span>`), section);
  }
  const songs = Object.keys(loadSongs()).length;
  assert.match(html, new RegExp(`<a href="/reflections">Music</a>[^<]*<span class="listen-count">${songs} songs, about [^<]+</span>`));

  const page = fs.readFileSync(path.join(PUBLIC, 'listen.html'), 'utf8');
  for (const mark of ['<!-- LISTEN_SECTIONS -->', '<!-- PODCASTS -->', '<!-- SITE_FOOTER -->', 'href="/#sanctuary"']) assert.ok(page.includes(mark), mark);
  const index = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.match(index, /app\.get\('\/listen'/);
  assert.match(index, /<loc>https:\/\/achurch\.ai\/listen<\/loc>/);
});
