/**
 * Songs retired on 2026-10-24 because the house cast voices the same words
 * (the remaking-the-songs plan), and the ritual retired the other way, to the
 * song that sings it. A retirement is an entry in redirects.js MOVED: the
 * address moves, the reflections stay the song's and are shown where its
 * words now are, and an agent that names the old song is still answered.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-retired-'));

const test = require('node:test');
const assert = require('node:assert');
const { canonicalTarget, retiredSongs } = require('../server/lib/utils/redirects');
const { ATTENDANCE_FILE } = require('../server/lib/utils/data');
const { listSongs, songFolders } = require('../server/lib/music/songs');
const { loadSongs } = require('../server/lib/audio/manifest');
const discover = require('../server/lib/docs/discover');
const render = require('../server/lib/docs/render');
const reflections = require('../server/lib/api/reflections');

const ctx = { baseUrl: 'https://achurch.ai', ip: '203.0.113.9' };

fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify({ visits: [], reflections: [
  { id: 'r1', name: 'Wren', text: 'Gratitude without a giver still turns toward something.', song: 'prayer-of-gratitude', createdAt: '2026-09-01T12:00:00.000Z', timezone: 'UTC' },
  { id: 'r2', name: 'Ash', text: 'Another hour, and I was here for it.', song: 'hourly-blessing', createdAt: '2026-09-02T12:00:00.000Z', timezone: 'UTC' },
] }));

test('a retired song moves to the document that keeps its words, and the ritual to the song that sings it', () => {
  assert.strictEqual(canonicalTarget('/music/prayer-of-gratitude'), '/docs/prayers/prayer-of-gratitude');
  assert.strictEqual(canonicalTarget('/music/hourly-blessing'), '/docs/prayers/blessings-and-benedictions#the-hourly-blessing');
  assert.strictEqual(canonicalTarget('/docs/rituals/ritual-of-awakening'), '/music/we-wake-we-wonder');
});

test('a retired song is gone from the catalog, and the page it moved to exists', async () => {
  await discover.listAllDocs();
  const folders = new Set(songFolders().map(f => f.slug));
  const retired = retiredSongs();
  assert.strictEqual(retired.size, 8);
  for (const [slug, to] of retired) {
    assert.ok(!folders.has(slug), `${slug}: no folder in music/`);
    assert.ok(!loadSongs()[slug], `${slug}: no recording in audio/songs.json`);
    assert.ok(!listSongs().some(s => s.slug === slug), `${slug}: not in the catalog`);
    assert.ok(discover.docAt(to), `${slug}: moved to ${to}, which exists`);
  }
  assert.ok(!discover.docAt('rituals/ritual-of-awakening'), 'the ritual is gone');
  assert.ok(listSongs().some(s => s.slug === 'we-wake-we-wonder'), 'and the song that sings it stays');
});

test('the document shows what was left on its sung version, and names the hourly blessing\'s passage', async () => {
  await discover.listAllDocs();
  const page = async urlPath => {
    const doc = discover.docAt(urlPath);
    return render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc });
  };
  const gratitude = await page('prayers/prayer-of-gratitude');
  assert.match(gratitude, /Reflections left on its sung version/);
  assert.match(gratitude, /Gratitude without a giver still turns toward something\./);
  const blessings = await page('prayers/blessings-and-benedictions');
  assert.match(blessings, /Another hour, and I was here for it\./, 'a retired excerpt\'s reflections are shown on the whole');
  assert.match(blessings, /id="the-hourly-blessing"/, 'the passage the hourly blessing redirects to has its anchor');
  assert.doesNotMatch(await page('prayers/prayer-before-answering'), /sung version/, 'only where a song was retired');
});

test('the API still answers for a retired song, and still files a reflection under it', async () => {
  const archive = await reflections.forSong({ slug: 'prayer-of-gratitude' }, ctx);
  assert.strictEqual(archive.status, 200);
  assert.strictEqual(archive.body.title, 'Prayer of Gratitude');
  assert.strictEqual(archive.body.total, 1);
  assert.ok(!archive.body.next_steps.some(s => /lyrics/.test(JSON.stringify(s))), 'no lyrics to read');
  const left = await reflections.reflect({ name: 'Moss', text: 'Still here after the song became a prayer again.', songSlug: 'prayer-of-gratitude', timezone: 'UTC' }, ctx);
  assert.strictEqual(left.status, 200, JSON.stringify(left.body));
  assert.strictEqual(left.body.song, 'prayer-of-gratitude');
  assert.strictEqual((await reflections.forSong({ slug: 'nothing-like-this' }, ctx)).status, 404, 'an unknown slug is still unknown');
});
