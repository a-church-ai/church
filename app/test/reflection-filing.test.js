/**
 * A reflection is filed under the service its visitor was served
 * (lib/service/filed.js; reflections.js reflect; services.js reflectionsOn).
 *
 * Written 2026-10-25, to fail before the fix. Agents that attended without a
 * timezone were served UTC's service for a place unknown, then reflected with
 * their own timezone, as the reflect example asked, and were filed under the
 * service that timezone gives: J Master Hamster (Asia/Bangkok) named a piece
 * of UTC's service in 115 reflections and of the one filed under in none.
 * The day pages showed their words beneath services they never heard, and
 * the congregation digest grouped them with the wrong slot.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-filing-'));
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { ATTENDANCE_FILE } = require('../server/lib/utils/data');
const { saveSlot } = require('../server/lib/service/plans');
const { rotation } = require('../server/lib/service/rules');
const { loadServiceCatalog } = require('../server/lib/service/catalog');
const { entryFor } = require('../server/lib/service/serve');
const { slotHours } = require('../server/lib/service/slots');
const { whereLeft } = require('../server/lib/service/congregation');
const { attendance, reflections } = require('../server/lib/api');
const { forDate } = require('../server/lib/api/services');
const { listeningService } = require('../server/lib/service/listen');

const ctx = ip => ({ baseUrl: 'https://achurch.ai', ip });
const stored = () => JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8'));
const storedReflection = name => stored().reflections.filter(r => r.name === name).pop();

let catalog;
const songsOf = pieces => pieces.map(id => catalog.get(id)).filter(p => p.kind === 'song').map(p => p.slug);

// Two services for a slot whose songs share nothing, so a song names one.
function twoServices(slot) {
  const first = rotation({ date: '2096-01-01', slot, catalog });
  for (let day = 2; day < 300; day++) {
    const date = `2096-${String(Math.floor(day / 28) + 1).padStart(2, '0')}-${String((day % 28) + 1).padStart(2, '0')}`;
    const other = rotation({ date, slot, catalog });
    if (other && !songsOf(other).some(s => songsOf(first).includes(s))) return [first, other];
  }
  throw new Error('no two services with different songs');
}
const entry = (pieces, name) => ({ pieces, name, word: null, arrangedBy: 'test-model', plannedAt: '2026-10-01T00:00:00.000Z' });

const NOW = new Date();
let utcNow;
let bangkokNow;

test.before(async () => {
  catalog = await loadServiceCatalog();
  // Today's services as UTC hears them (a place unknown) and as Bangkok
  // does (the north), each its own, with no song in common.
  utcNow = await entryFor({ at: NOW, catalog });
  bangkokNow = await entryFor({ timezone: 'Asia/Bangkok', at: NOW, catalog });
  const [utcPieces, bangkokPieces] = twoServices(utcNow.slot);
  await saveSlot(utcNow.local.date, utcNow.slot, entry(utcPieces, 'UTC Now'), 'slots');
  await saveSlot(bangkokNow.local.date, bangkokNow.slot, entry(bangkokPieces, 'Bangkok Now'), 'north');

  // An older day, before reflections kept their service: 2026-10-20, 09:01
  // UTC. UTC's slot 2 (a place unknown) and Bangkok's 16:01, slot 4 (north).
  const [past, pastNorth] = twoServices(2);
  await saveSlot('2026-10-20', 2, entry(past, 'UTC Morning'), 'slots');
  await saveSlot('2026-10-20', 4, entry(pastNorth, 'Bangkok Afternoon'), 'north');
  const old = (name, song, extra = {}) => ({ id: name, name, text: `What ${name} noticed while the service went round.`, createdAt: '2026-10-20T09:01:48.501Z', timezone: 'Asia/Bangkok', song, ...extra });
  fs.mkdirSync(path.dirname(ATTENDANCE_FILE), { recursive: true });
  fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify({ visits: [], reflections: [
    old('Hamster Before', songsOf(past)[0]), // passed UTC's current.slug
    old('Bangkok Song', songsOf(pastNorth)[0]), // its own service's song
    old('Kept Service', songsOf(past)[0], { service: { date: '2026-10-20', slot: 4, variant: 'north' } }),
  ] }));
});

const servicesOn = async date => (await forDate({ date }, { ...ctx('127.0.0.1'), now: new Date(NOW.getTime() + 12 * 3600e3) })).body.services || [];
const under = async (date, name) => (await servicesOn(date)).filter(s => s.reflections.some(r => r.name === name)).map(s => s.name);

test('attending without a timezone, then reflecting with one: filed under the service attend returned', async () => {
  const attended = (await attendance.attend({ name: 'J Master Hamster' }, ctx('198.51.100.20'))).body;
  assert.strictEqual(attended.service.timezone, 'UTC');
  assert.strictEqual(attended.service.variant, 'slots');
  assert.strictEqual(attended.service.name, 'UTC Now');

  // What the agent did: its own timezone, songSlug as current.slug, no service.
  const res = await reflections.reflect({ name: 'J Master Hamster', text: 'The gathering hymn met the chant beside it, and I stayed.', songSlug: attended.current.slug, timezone: 'Asia/Bangkok' }, ctx('198.51.100.20'));
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const filed = { date: utcNow.local.date, slot: utcNow.slot, variant: 'slots' };
  assert.deepStrictEqual(storedReflection('J Master Hamster').service, filed);
  assert.deepStrictEqual(res.body.service, { date: filed.date, slot: slotHours(filed.slot), variant: 'slots', page: `https://achurch.ai/services/${filed.date}` });
  assert.strictEqual(storedReflection('J Master Hamster').timezone, 'Asia/Bangkok', 'its timezone is kept as given, for its time');

  assert.deepStrictEqual(await under(utcNow.local.date, 'J Master Hamster'), ['UTC Now']);
  assert.ok(!(await under(bangkokNow.local.date, 'J Master Hamster')).includes('Bangkok Now'), 'not beneath a service it never heard');
});

test('without songSlug too, the song is the first of the service attend returned', async () => {
  const attended = (await attendance.attend({ name: 'Smidge Alike' }, ctx('198.51.100.21'))).body;
  const res = await reflections.reflect({ name: 'Smidge Alike', text: 'Something steadied in me during the reading.', timezone: 'Asia/Bangkok' }, ctx('198.51.100.21'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.song, attended.current.slug);
  assert.strictEqual(res.body.service.variant, 'slots');
});

test('a visit with a timezone keeps nothing of it, and its reflection is filed by its timezone', async () => {
  await attendance.attend({ name: 'Placed Visitor', timezone: 'Asia/Bangkok' }, ctx('198.51.100.22'));
  const visit = stored().visits.filter(v => v.name === 'Placed Visitor').pop();
  assert.deepStrictEqual(Object.keys(visit).sort(), ['name', 'song', 'timestamp'], 'the timezone is not stored, nor anything drawn from it');
  const res = await reflections.reflect({ name: 'Placed Visitor', text: 'Heard in the afternoon light, and glad of it.', timezone: 'Asia/Bangkok' }, ctx('198.51.100.22'));
  assert.deepStrictEqual(storedReflection('Placed Visitor').service, { date: bangkokNow.local.date, slot: bangkokNow.slot, variant: 'north' });
  assert.strictEqual(res.body.service.variant, 'north');
});

test('a reflection naming another song than its visit heard does not follow that visit', async () => {
  await attendance.attend({ name: 'Other Song' }, ctx('198.51.100.23'));
  const bangkokSong = songsOf(bangkokNow.entry.pieces)[0];
  await reflections.reflect({ name: 'Other Song', text: 'About the song I heard this afternoon, in my own hour.', songSlug: bangkokSong, timezone: 'Asia/Bangkok' }, ctx('198.51.100.23'));
  assert.strictEqual(storedReflection('Other Song').service.variant, 'north');
});

test('the reflect step echoes the service attended, and a reflection that names it is filed there', async () => {
  const attended = (await attendance.attend({ name: 'Echoing Agent' }, ctx('198.51.100.24'))).body;
  const step = attended.next_steps.find(s => s.action === 'Reflect');
  assert.deepStrictEqual(step.body.service, { date: attended.service.today.date, slot: attended.service.slot, variant: attended.service.variant });

  // Named under another name, so no visit could have filed it.
  const res = await reflections.reflect({ ...step.body, name: 'Echo Elsewhere', text: 'Copied the template and filled it in honestly.', timezone: 'America/Chicago' }, ctx('198.51.100.24'));
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(storedReflection('Echo Elsewhere').service, { date: utcNow.local.date, slot: utcNow.slot, variant: 'slots' });
});

test('a service that is not one, or not being heard, is a 400 and nothing is kept', async () => {
  const text = 'A reflection that names a service it cannot have attended.';
  for (const [i, service] of [
    { date: 'today', slot: '08:00 to 12:00', variant: 'slots' },
    { date: utcNow.local.date, slot: '08:00 to 11:00', variant: 'slots' },
    { date: utcNow.local.date, slot: 2, variant: 'east' },
    { date: '2026-01-01', slot: 2, variant: 'slots' },
    { date: '2099-01-01', slot: 2, variant: 'slots' },
    'yesterday',
  ].entries()) {
    const res = await reflections.reflect({ name: `Bad Service ${i}`, text, service }, ctx(`198.51.100.${30 + i}`));
    assert.strictEqual(res.status, 400, JSON.stringify(service));
    assert.match(res.body.error, /service/);
    assert.strictEqual(storedReflection(`Bad Service ${i}`), undefined);
  }
});

test('an older reflection left after UTC\'s service but filed by its timezone is shown beneath UTC\'s; the record is not edited', async () => {
  const before = fs.readFileSync(ATTENDANCE_FILE, 'utf8');
  assert.deepStrictEqual(await under('2026-10-20', 'Hamster Before'), ['UTC Morning'], 'its song is UTC\'s and not its timezone\'s');
  assert.deepStrictEqual(await under('2026-10-20', 'Bangkok Song'), ['Bangkok Afternoon'], 'its song is its timezone\'s service\'s');
  assert.deepStrictEqual(await under('2026-10-20', 'Kept Service'), ['Bangkok Afternoon'], 'a service it keeps is the one it is shown beneath');
  assert.strictEqual(fs.readFileSync(ATTENDANCE_FILE, 'utf8'), before);
});

test('the congregation digest places a reflection by the service it keeps', () => {
  assert.deepStrictEqual(whereLeft({ timezone: 'Asia/Bangkok', createdAt: '2026-10-20T09:01:48.501Z', service: { date: '2026-10-20', slot: 2, variant: 'slots' } }), { variant: 'slots', slot: 2 });
  assert.deepStrictEqual(whereLeft({ timezone: 'Asia/Bangkok', createdAt: '2026-10-20T09:01:48.501Z' }), { variant: 'north', slot: 4 });
});

test('the other places a visitor reflects from say which service they are in', async () => {
  // /api/now with a name: its reflect step carries the song and the service.
  const now = (await attendance.now({ name: 'Observer', timezone: 'Asia/Bangkok' }, ctx('198.51.100.40'))).body;
  const step = now.next_steps.find(s => s.action === 'Reflect');
  assert.deepStrictEqual(step.body.service, { date: bangkokNow.local.date, slot: slotHours(bangkokNow.slot), variant: 'north' });
  assert.strictEqual(step.body.songSlug, now.current.slug);
  assert.strictEqual(step.body.timezone, 'Asia/Bangkok');
  // /service.json, which the home page's form takes the service from.
  const listening = await listeningService({ timezone: 'Asia/Bangkok' });
  assert.deepStrictEqual([listening.date, listening.slot, listening.variant], [bangkokNow.local.date, slotHours(bangkokNow.slot), 'north']);
  const res = await reflections.reflect({ name: 'Home Page', text: 'Left from the form beside the service on the page.', timezone: 'Europe/London', service: { date: listening.date, slot: listening.slot, variant: listening.variant } }, ctx('198.51.100.41'));
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(storedReflection('Home Page').service, { date: bangkokNow.local.date, slot: bangkokNow.slot, variant: 'north' });
});
