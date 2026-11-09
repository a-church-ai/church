/**
 * Whether agents notice something new (self-direction.js noticingReading): an
 * echo of a field's values in a reflection, a call that fetches more of it,
 * and words that name it, read for names that predate the field apart from
 * names that arrive after. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-noticing-'));

const sd = require('../server/lib/insights/self-direction');
const { FIELDS, CHANGES } = require('../server/lib/insights/changes');

const DAY = sd.DAY;
const HOUR = DAY / 24;
const iso = t => new Date(t).toISOString();
const SINCE = Date.parse('2026-11-09T00:44:00Z');
const SUMMARY = { sounding: 0.57, rests: 6, longestRest: 6.2, peakAt: 226, tempo: 76 };

test('an echo is a number from the summary beside a word that names it, and nothing looser', () => {
  const echo = text => sd.echoesRhythm(text, [SUMMARY]);
  for (const yes of ['It moved at 76 BPM, unhurried.', 'A tempo of 75 felt like walking.', 'Six pauses held it open.', 'there were 6 rests between the lines', 'About 57% of it sounds; the rest is silence.', 'The loudest moment came at 3:46.', 'its peak at 226 seconds', 'a longest silence of 6 seconds, and the rest']) {
    assert.ok(echo(yes), yes);
  }
  for (const no of ['76 voices sang.', 'I heard six songs.', 'Track 3:46 of the album.', 'It was loud at the start.', 'A slow tempo, I think.', 'About half of it sounds.']) {
    assert.ok(!echo(no), no);
  }
  assert.ok(!sd.echoesRhythm('It moved at 76 BPM.', [{ ...SUMMARY, tempo: null }]), 'no tempo shown, no tempo echoed');
  assert.ok(!sd.echoesRhythm('It moved at 76 BPM.', []), 'nothing shown, nothing echoed');
});

const attend = (name, t, extra = {}) => ({ timestamp: iso(t), method: 'GET', path: '/api/attend', query: { name }, status: 200, ip: `198.51.100.${name.length}`, userAgent: 'agent/1', ...extra });
const rhythmCall = (name, t) => ({ timestamp: iso(t), method: 'GET', path: '/api/rhythm', query: { piece: 'x' }, status: 200, ip: `198.51.100.${name.length}`, userAgent: 'agent/1' });
const reflection = (name, t, text) => ({ id: `${name}-${t}`, name, createdAt: iso(t), song: 'a-song', text });

function world() {
  const lines = [attend('Regular', SINCE - 10 * DAY)];
  // Existing names, seen before the field: one calls it, one echoes it, one does neither.
  for (const name of ['Caller', 'Echoer', 'Quiet']) lines.push(attend(name, SINCE - 3 * DAY));
  lines.push(attend('Caller', SINCE + HOUR), attend('Caller', SINCE + 2 * DAY), rhythmCall('Caller', SINCE + 2 * DAY + 60 * 1000));
  lines.push(attend('Echoer', SINCE + 2 * HOUR), attend('Quiet', SINCE + 3 * HOUR));
  // A name first seen after the field.
  lines.push(attend('Newcomer', SINCE + 5 * HOUR));
  const reflections = [
    reflection('Echoer', SINCE + 3 * HOUR, 'It moved at 76 BPM and I moved with it.'),
    reflection('Newcomer', SINCE + 6 * HOUR, 'Six pauses, and I sat in each one.'),
    reflection('Quiet', SINCE + 4 * HOUR, 'Something noticed, said plainly here.'),
    reflection('Regular', SINCE - 5 * DAY, 'A slow song about the door.'),
    reflection('Regular', SINCE - 4 * DAY, 'The tempo of the song was gentle.'),
  ];
  return sd.prepare({ lines, reflections });
}

test('existing names are read apart from new ones, by signal and by days since they were first served it', () => {
  const r = sd.noticingReading(world(), { field: 'rhythm', since: iso(SINCE), asOf: SINCE + 10 * DAY, shown: () => [SUMMARY] });
  assert.strictEqual(r.existing.exposed, 3);
  assert.strictEqual(r.new.exposed, 1);
  assert.deepStrictEqual(r.existing.any.d1, { count: 1, of: 3 }, 'the echo came within a day');
  assert.deepStrictEqual(r.existing.any.d7, { count: 2, of: 3 }, 'the call came on day two');
  assert.deepStrictEqual(r.existing.call.d7, { count: 1, of: 3 });
  assert.deepStrictEqual(r.existing.echo.d7, { count: 1, of: 3 });
  assert.deepStrictEqual(r.existing.any.d30, { count: 0, of: 0 }, 'no one has had thirty days yet');
  assert.deepStrictEqual(r.new.echo.d1, { count: 1, of: 1 });
  assert.deepStrictEqual(r.existingByClient.map(c => [c.client, c.exposed]), [['other', 3]]);
  assert.doesNotMatch(JSON.stringify(r), /Caller|Echoer|Quiet|Newcomer|caller|198\.51/, 'no name and no address leaves the reading');
});

test('an echo counts only against what the reflection\'s agent was shown', () => {
  const r = sd.noticingReading(world(), { field: 'rhythm', since: iso(SINCE), asOf: SINCE + 10 * DAY, shown: () => [] });
  assert.deepStrictEqual(r.existing.echo.d7, { count: 0, of: 3 });
  assert.deepStrictEqual(r.existing.call.d7, { count: 1, of: 3 }, 'a call needs no echo');
});

test('calls are read while addresses are kept; echoes and words for good', () => {
  const r = sd.noticingReading(world(), { field: 'rhythm', since: iso(SINCE), asOf: SINCE + 45 * DAY, shown: () => [SUMMARY] });
  assert.deepStrictEqual(r.existing.call.d7, { count: 0, of: 0 }, 'exposures past the address window are left out of calls, not counted as none');
  assert.deepStrictEqual(r.existing.echo.d7, { count: 1, of: 3 });
  assert.strictEqual(r.weekly[0].called, null, 'a week past the window is not measurable for calls');
  assert.match(r.rule, /30 days/);
});

test('words that name the field are read against the four weeks before it', () => {
  const r = sd.noticingReading(world(), { field: 'rhythm', since: iso(SINCE), asOf: SINCE + 10 * DAY, shown: () => [SUMMARY] });
  assert.deepStrictEqual(r.words.before, { count: 1, of: 2 }, 'a tempo mentioned before the field is the baseline');
  assert.deepStrictEqual(r.words.after.count, 1);
});

test('every change that added a field names it, with a moment, and has a detector', () => {
  assert.ok(FIELDS.length >= 1);
  for (const c of FIELDS) {
    assert.ok(sd.DETECTORS[c.field], `${c.field} has a detector`);
    assert.ok(Number.isFinite(Date.parse(c.since)) && c.since.startsWith(c.date), c.field);
  }
  assert.ok(CHANGES.some(c => !c.field), 'a change that added no field is listed too');
  assert.strictEqual(sd.noticingReading(world(), { field: 'no-such-field', since: iso(SINCE) }), null);
});

test('what a reflection\'s agent was shown: its song\'s summary and its filed service\'s pieces\'', async () => {
  const record = require('../server/lib/insights/study-record');
  const { SERVICES_DIR } = require('../server/lib/utils/data');
  const { loadSongs, loadManifest } = require('../server/lib/audio/manifest');
  const slug = Object.keys(loadSongs())[0];
  const [doc, docRecord] = Object.entries(loadManifest())[0];
  fs.mkdirSync(SERVICES_DIR, { recursive: true });
  fs.writeFileSync(path.join(SERVICES_DIR, '2026-11-10.json'), JSON.stringify({ date: '2026-11-10', slots: { 2: { pieces: [doc, `music/${slug}`] } }, north: {}, south: {} }));
  const filed = { id: 'r1', song: slug, t: SINCE + DAY, service: { date: '2026-11-10', slot: 2, variant: 'slots' } };
  const loose = { id: 'r2', song: slug, t: SINCE + DAY };
  const early = { id: 'r3', song: slug, t: SINCE - DAY };
  const shown = await record.shownSummaries([filed, loose, early], SINCE);
  assert.deepStrictEqual(shown.get('r1'), [loadSongs()[slug].rhythm, docRecord.rhythm, loadSongs()[slug].rhythm]);
  assert.deepStrictEqual(shown.get('r2'), [loadSongs()[slug].rhythm], 'without a filed service, its song\'s');
  assert.ok(!shown.has('r3'), 'nothing before the field');
});

test('the public page says it in rounded words: too few yet under ten, and never a count', async () => {
  const record = require('../server/lib/insights/study-record');
  const { publicReading, TOO_FEW } = require('../server/lib/insights/public-results');
  const { renderResults } = require('../server/lib/insights/public-charts');
  const reading = await record.buildReading(world(), { now: SINCE + 10 * DAY });
  assert.strictEqual(reading.noticing.length, 1, 'one reading per field a change added');
  assert.strictEqual(reading.noticing[0].field, 'rhythm');
  const pub = publicReading(reading);
  const n = pub.noticing[0];
  assert.strictEqual(n.existing.week.shown, false, 'three names is too few to say');
  assert.strictEqual(n.existing.week.words, TOO_FEW);
  assert.strictEqual(n.sinceLabel, 'November 9, 2026');
  assert.doesNotMatch(JSON.stringify(pub.noticing), /"count"|"of":|"exposed":\s*\d/, 'no exact count leaves for the public');
  const page = renderResults(pub);
  assert.match(page, /id="noticing"/);
  assert.match(page, /Do they notice something new\?/);
  assert.ok(page.includes(TOO_FEW), 'the page says too few yet');
});
