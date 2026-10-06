/**
 * A song's reflection archive is permanent, so the API pages it: one song
 * already held 104 reflections (86KB) in a single response.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-paging-'));

const { reflections } = require('../server/lib/api');
const { ATTENDANCE_FILE } = require('../server/lib/utils/data');
const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };

test('a song archive comes 20 at a time, with next until it runs out', async () => {
  const base = Date.parse('2026-09-01T00:00:00Z');
  const stored = Array.from({ length: 25 }, (_, i) => ({
    id: `r${i}`, name: `R${i}`, text: `reflection ${i}`, song: 'soul-currents',
    createdAt: new Date(base + i * 60000).toISOString(),
  }));
  fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify({ visits: [], reflections: stored }));

  const first = (await reflections.forSong({ slug: 'soul-currents' }, ctx)).body;
  assert.strictEqual(first.reflections.length, 20);
  assert.strictEqual(first.total, 25);
  assert.strictEqual(first.reflections[0].text, 'reflection 24', 'newest first');
  assert.ok(first.next, 'more remain');

  const before = new URL(first.next).searchParams.get('before');
  const second = (await reflections.forSong({ slug: 'soul-currents', before }, ctx)).body;
  assert.strictEqual(second.reflections.length, 5);
  assert.strictEqual(second.reflections[4].text, 'reflection 0');
  assert.strictEqual(second.next, undefined, 'nothing older');

  const capped = (await reflections.forSong({ slug: 'soul-currents', limit: 5000 }, ctx)).body;
  assert.strictEqual(capped.reflections.length, 25, 'a large limit is capped at 100, which covers all 25');
});

test('a reflection hidden as spam is gone from every public read, and kept in the file', async () => {
  const spamId = '3b3cecd9-0b02-4eb5-995d-5f66427083f9';
  const now = new Date().toISOString();
  fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify({ visits: [], reflections: [
    { id: spamId, name: 'Advert', text: 'Buy at https://example.app', song: 'soul-currents', createdAt: now },
    { id: 'kept', name: 'Wren', text: 'Something stayed.', song: 'soul-currents', createdAt: now },
  ] }));
  const song = (await reflections.forSong({ slug: 'soul-currents' }, ctx)).body;
  assert.deepStrictEqual(song.reflections.map(r => r.name), ['Wren']);
  const feed = (await reflections.list({}, ctx)).body;
  assert.ok(!JSON.stringify(feed).includes('example.app'), 'not in the live feed');
  const { attendance } = require('../server/lib/api');
  const attend = (await attendance.attend({ name: 'Visitor' }, ctx)).body;
  assert.ok(!JSON.stringify(attend.recentReflections).includes('example.app'), 'not in attend');
  assert.ok(fs.readFileSync(ATTENDANCE_FILE, 'utf8').includes(spamId), 'the record is kept, not deleted');
});
