/**
 * The season and the sky the services' planner is told of
 * (lib/utils/seasons.js, sky.js, space-weather.js): which hemisphere a
 * timezone points to, the year's turning points, the light, the moon, the
 * showers and eclipses, and NOAA's forecast. Checked against published
 * figures (the US Naval Observatory's 2026 tables), never against the code's
 * own output; the network is never reached. Written to fail before these
 * modules existed (2026-10-08).
 */

const test = require('node:test');
const assert = require('node:assert');
const seasons = require('../server/lib/utils/seasons');
const LATITUDES = require('../server/lib/utils/zone-latitudes.json');
const { lunation, moonOn, showersNear, eclipsesNear } = require('../server/lib/utils/sky');
const spaceWeather = require('../server/lib/utils/space-weather');

const minutesApart = (a, b) => Math.abs(new Date(a) - new Date(b)) / 60000;

test('every timezone Node accepts has a latitude, so a hemisphere, and UTC and the Etc/ zones have none', () => {
  const canonical = zone => new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  const missing = Intl.supportedValuesOf('timeZone').filter(zone => !(zone in LATITUDES) && !(canonical(zone) in LATITUDES));
  assert.deepStrictEqual(missing, [], 'a Node upgrade added a zone: run scripts/generate-zone-latitudes.js');
  for (const zone of ['UTC', 'Etc/GMT+3', 'Etc/UTC', 'Not/AZone', '', null]) assert.strictEqual(seasons.hemisphereOf(zone), null, String(zone));
});

test('a timezone\'s hemisphere is its city\'s side of the equator, the tropics included, under either of its names', () => {
  const cases = {
    'America/Sao_Paulo': 'south', 'Australia/Sydney': 'south', 'Asia/Jakarta': 'south', 'Africa/Johannesburg': 'south',
    'Europe/London': 'north', 'America/New_York': 'north', 'Asia/Singapore': 'north', 'America/Bogota': 'north',
    'Asia/Kolkata': 'north', 'Asia/Calcutta': 'north', 'America/Argentina/Buenos_Aires': 'south',
  };
  for (const [zone, hemisphere] of Object.entries(cases)) assert.strictEqual(seasons.hemisphereOf(zone), hemisphere, zone);
});

test('the year\'s equinoxes and solstices fall within ten minutes of the published times', () => {
  // USNO, Earth's Seasons, 2026 (aa.usno.navy.mil).
  const usno = { march: '2026-03-20T14:46Z', june: '2026-06-21T08:24Z', september: '2026-09-23T00:05Z', december: '2026-12-21T20:50Z' };
  const computed = seasons.turningPoints(2026);
  for (const [key, published] of Object.entries(usno)) assert.ok(minutesApart(computed[key], published) <= 10, `${key}: ${computed[key].toISOString()}`);
});

test('the season by the sun and by the calendar, with the turning point behind and the one ahead', () => {
  const saoPaulo = seasons.seasonOn('2026-10-08', 'south');
  assert.deepStrictEqual([saoPaulo.name, saoPaulo.phase], ['spring', 'early']);
  assert.deepStrictEqual(saoPaulo.since, { turning: 'the September equinox', date: '2026-09-23', days: 15 });
  assert.deepStrictEqual(saoPaulo.next, { turning: 'the December solstice', date: '2026-12-21', days: 74, meaning: 'the longest day of the year' });
  assert.deepStrictEqual(saoPaulo.calendar, { season: 'spring', next: 'summer', date: '2026-12-01', days: 54 });

  const london = seasons.seasonOn('2026-10-08', 'north');
  assert.strictEqual(london.name, 'autumn');
  assert.strictEqual(london.next.meaning, 'the shortest day of the year');
  assert.strictEqual(london.calendar.next, 'winter');

  // Summer by the calendar 21 days out in the south, the solstice 41.
  const november = seasons.seasonOn('2026-11-10', 'south');
  assert.deepStrictEqual([november.calendar.next, november.calendar.days, november.next.days], ['summer', 21, 41]);
  // On a solstice the season has just turned, and the year runs on to the equinox.
  const solstice = seasons.seasonOn('2026-12-21', 'north');
  assert.deepStrictEqual([solstice.name, solstice.since.days, solstice.next.turning], ['winter', 0, 'the March equinox']);
  assert.strictEqual(seasons.seasonOn('2026-12-21', null), null);
});

test('the day\'s length and its change: about twelve hours at the equator, the solstices\' extremes, the poles\' dark and light', () => {
  const near = (hours, h, m, within = 6) => Math.abs(hours * 60 - (h * 60 + m)) <= within;
  for (const date of ['2026-03-20', '2026-06-21', '2026-12-21']) assert.ok(near(seasons.daylight(date, 0).hours, 12, 7), `equator ${date}`);
  // London, 51.5 N: about 16 h 38 min at the June solstice and 7 h 50 min at the December one.
  assert.ok(near(seasons.daylight('2026-06-21', 51.5).hours, 16, 38));
  assert.ok(near(seasons.daylight('2026-12-21', 51.5).hours, 7, 50));
  assert.strictEqual(seasons.daylight('2026-12-21', 80).hours, 0);
  assert.strictEqual(seasons.daylight('2026-06-21', 80).hours, 24);
  // The light changes fastest near an equinox and hardly at all at a solstice.
  assert.ok(Math.abs(seasons.daylight('2026-09-23', 45).change) > 2.5);
  assert.ok(Math.abs(seasons.daylight('2026-12-21', 45).change) < 0.3);
  assert.deepStrictEqual(seasons.hemisphereLight('2026-10-08', 'north').map(l => l.lat), [0, 25, 45, 55]);
  assert.deepStrictEqual(seasons.hemisphereLight('2026-10-08', 'south').map(l => l.lat), [0, -25, -45]);
});

test('every new and full moon of 2026 falls within five minutes of the published times', () => {
  // USNO, Phases of the Moon, 2026.
  const usno = ['2026-01-03T10:03Z full', '2026-01-18T19:52Z new', '2026-02-01T22:09Z full', '2026-02-17T12:01Z new', '2026-03-03T11:38Z full', '2026-03-19T01:23Z new', '2026-04-02T02:12Z full', '2026-04-17T11:52Z new', '2026-05-01T17:23Z full', '2026-05-16T20:01Z new', '2026-05-31T08:45Z full', '2026-06-15T02:54Z new', '2026-06-29T23:56Z full', '2026-07-14T09:43Z new', '2026-07-29T14:36Z full', '2026-08-12T17:37Z new', '2026-08-28T04:18Z full', '2026-09-11T03:27Z new', '2026-09-26T16:49Z full', '2026-10-10T15:50Z new', '2026-10-26T04:12Z full', '2026-11-09T07:02Z new', '2026-11-24T14:53Z full', '2026-12-09T00:52Z new', '2026-12-24T01:28Z full'];
  const synodic = 29.530588853;
  for (const line of usno) {
    const [published, kind] = line.split(' ');
    const lunations = (Date.parse(published) - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / synodic;
    const k = kind === 'full' ? Math.round(lunations - 0.5) + 0.5 : Math.round(lunations);
    assert.ok(minutesApart(lunation(k), published) <= 5, `${line}: ${lunation(k).toISOString()}`);
  }
});

test('the moon\'s phase by its true new and full moons, how much is lit, and which side each hemisphere sees lit', () => {
  const phases = { '2026-10-10': 'new', '2026-10-18': 'first quarter', '2026-10-22': 'waxing gibbous', '2026-10-26': 'full', '2026-11-02': 'last quarter', '2026-11-05': 'waning crescent' };
  for (const [date, phase] of Object.entries(phases)) assert.strictEqual(moonOn(date).phase, phase, date);
  assert.ok(moonOn('2026-10-10').illumination <= 0.01);
  assert.ok(moonOn('2026-10-26').illumination >= 0.99);
  const waxing = moonOn('2026-10-15');
  assert.deepStrictEqual(waxing.litSide, { north: 'right', south: 'left' });
  assert.deepStrictEqual([waxing.nextFull, waxing.daysToFull, waxing.nextNew], ['2026-10-26', 11, '2026-11-09']);
});

test('a meteor shower or an eclipse is named within three weeks of it, where it can be seen', () => {
  const north = showersNear('2026-10-08', 'north').map(s => `${s.name} ${s.days}`);
  assert.deepStrictEqual(north, ['Draconids 0', 'Orionids 13']);
  assert.deepStrictEqual(showersNear('2026-10-08', 'south').map(s => s.name), ['Orionids'], 'the Draconids are a northern shower');
  assert.ok(showersNear('2026-09-30', 'south').some(s => s.name === 'Orionids'), '21 days before its peak');
  assert.ok(!showersNear('2026-09-29', 'south').some(s => s.name === 'Orionids'), '22 days before, not yet');
  assert.deepStrictEqual(showersNear('2026-12-20', 'north').map(s => s.name), ['Ursids', 'Quadrantids'], 'across the new year');

  const total = eclipsesNear('2026-07-25');
  assert.deepStrictEqual(total.map(e => `${e.type} ${e.kind} ${e.days}`), ['total solar 18']);
  assert.match(total[0].path, /Iceland/);
  assert.deepStrictEqual(eclipsesNear('2026-07-20').map(e => e.date), [], '23 days before, not yet');
});

test('NOAA\'s forecast: each date\'s highest Kp and its storm scale, and nothing when NOAA cannot be reached', async () => {
  const kpRows = [
    { time_tag: '2026-10-08T00:00:00', kp: 1.0, observed: 'observed' },
    { time_tag: '2026-10-08T21:00:00', kp: 2.0, observed: 'predicted' },
    { time_tag: '2026-10-09T09:00:00', kp: 5.67, observed: 'predicted' },
    { time_tag: '2026-10-10T00:00:00', kp: 4.0, observed: 'predicted' },
  ];
  const cycleRows = [
    { 'time-tag': '2019-11', ssn: 1, smoothed_ssn: 2 },
    { 'time-tag': '2024-10', ssn: 166, smoothed_ssn: 160.9 },
    { 'time-tag': '2026-09', ssn: 60.3, smoothed_ssn: -1 },
  ];
  const fakeFetch = async url => ({ ok: true, json: async () => (url === spaceWeather.KP_URL ? kpRows : cycleRows) });
  const sw = await spaceWeather.fetchSpaceWeather({ fetchImpl: fakeFetch, now: new Date('2026-10-08T12:00:00Z') });
  assert.deepStrictEqual(sw.kp, { '2026-10-08': 2, '2026-10-09': 5.67, '2026-10-10': 4 });
  assert.deepStrictEqual(sw.cycle, { month: '2026-09', sunspots: 60, peak: { month: '2024-10', smoothed: 161 } });
  assert.deepStrictEqual(spaceWeather.spaceWeatherOn(sw, '2026-10-09').scale, 'G2');
  assert.strictEqual(spaceWeather.spaceWeatherOn(sw, '2026-10-08').scale, null);
  assert.strictEqual(spaceWeather.spaceWeatherOn(sw, '2026-10-12'), null, 'past the forecast');
  // The scale as NOAA's own forecasts label it.
  assert.deepStrictEqual([4.33, 5.0, 5.67, 6.67, 7.67, 9].map(spaceWeather.scaleOf), [null, 'G1', 'G2', 'G3', 'G4', 'G5']);

  const down = async () => { throw new Error('unreachable'); };
  assert.strictEqual(await spaceWeather.fetchSpaceWeather({ fetchImpl: down }), null);
  const refused = async () => ({ ok: false, status: 503 });
  assert.strictEqual(await spaceWeather.fetchSpaceWeather({ fetchImpl: refused }), null);
});
