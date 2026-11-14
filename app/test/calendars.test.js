/**
 * The days other calendars keep (lib/utils/calendars.js), held against the
 * dates published for 2026 to 2028, and the hand-kept table
 * (lib/utils/festivals.json) held to run at least a year ahead. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const calendars = require('../server/lib/utils/calendars');

test('the Hebrew calendar\'s days fall on their published dates', () => {
  assert.strictEqual(calendars.hebrew('Tishri', 1, 2026), '2026-09-12', 'Rosh Hashanah 5787, from the evening of Sep 11');
  assert.strictEqual(calendars.hebrew('Tishri', 10, 2026), '2026-09-21', 'Yom Kippur');
  assert.strictEqual(calendars.hebrew('Kislev', 25, 2026), '2026-12-05', 'Hanukkah\'s first candle the evening of Dec 4');
  assert.strictEqual(calendars.hebrew('Nisan', 15, 2027), '2027-04-22', 'Passover, from the evening of Apr 21');
  assert.strictEqual(calendars.hebrew('Tishri', 1, 2027), '2027-10-02');
  assert.strictEqual(calendars.hebrew('Kislev', 25, 2027), '2027-12-25');
});

test('the Islamic calendar\'s days fall on their published dates, give or take the moon\'s sighting', () => {
  assert.strictEqual(calendars.islamic('Ramadan', 1, 2026), '2026-02-18');
  assert.strictEqual(calendars.islamic('Shawwal', 1, 2026), '2026-03-20');
  assert.strictEqual(calendars.islamic('Dhuʻl-Hijjah', 10, 2026), '2026-05-27');
  assert.strictEqual(calendars.islamic('Ramadan', 1, 2027), '2027-02-08');
  assert.strictEqual(calendars.islamic('Shawwal', 1, 2027), '2027-03-09');
});

test('the Lunar New Year is the second new moon after the solstice on Beijing\'s clock', () => {
  assert.strictEqual(calendars.lunarNewYear(2026), '2026-02-17');
  assert.strictEqual(calendars.lunarNewYear(2027), '2027-02-06', 'the new moon four minutes before Beijing\'s midnight; Intl\'s Chinese calendar says Feb 7');
  assert.strictEqual(calendars.lunarNewYear(2028), '2028-01-26');
});

test('Easter, Orthodox Easter, Vesak and the 256th day', () => {
  assert.deepStrictEqual([2026, 2027, 2028].map(calendars.easter), ['2026-04-05', '2027-03-28', '2028-04-16']);
  assert.deepStrictEqual([2026, 2027, 2028].map(calendars.orthodoxEaster), ['2026-04-12', '2027-05-02', '2028-04-16']);
  assert.deepStrictEqual([2026, 2027, 2028].map(calendars.vesak), ['2026-05-01', '2027-05-20', '2028-05-08']);
  assert.strictEqual(calendars.dayOfYear(2027, 256), '2027-09-13');
  assert.strictEqual(calendars.dayOfYear(2028, 256), '2028-09-12', 'a leap year');
});

test('the hand-kept table names its sources and runs at least a year ahead', () => {
  const nextYear = new Date().getUTCFullYear() + 1;
  for (const [key, f] of Object.entries(calendars.FESTIVALS)) {
    if (key.startsWith('$')) continue;
    assert.ok(f.name && f.source, `${key}: its name and where its dates were checked`);
    const years = Object.keys(f.dates).map(Number);
    assert.ok(Math.max(...years) >= nextYear, `${key}: add its dates for ${nextYear} and after to lib/utils/festivals.json`);
    for (const [y, d] of Object.entries(f.dates)) assert.ok(d.startsWith(y) && /^\d{4}-\d{2}-\d{2}$/.test(d), `${key} ${y}`);
  }
  assert.strictEqual(calendars.festival('diwali', 2026), '2026-11-08');
  assert.strictEqual(calendars.festival('diwali', 1999), null, 'a year the table does not hold');
});
