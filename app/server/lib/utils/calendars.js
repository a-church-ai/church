/**
 * The dates of days kept by other calendars, in the Gregorian year: the
 * Hebrew and Islamic calendars (from the runtime's own calendars, Intl, which
 * need nothing installed), the Chinese New Year and Vesak (from the sky, as
 * utils/sky.js reads it), Easter (the computus), and the days kept by hand in
 * festivals.json, which no calendar here can compute. Offline and pure but
 * for the table. Used by lib/video/occasions.js; plan:
 * occasion-windows-and-traditions-2026-11-02.md in the private repo.
 *
 * Every date is held against published calendars in test/calendars.test.js.
 */

const { addDays, turningPoints } = require('./seasons');
const { moonPhaseAfter } = require('./sky');
const FESTIVALS = require('./festivals.json');

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The day of a month and day in another calendar, searched within a Gregorian
// year, read at noon UTC (the Hebrew and Islamic days are arithmetic or
// tabular, so noon is safely inside the day). Null when it does not fall in
// that year.
function dateInCalendar(calendar, month, day, year) {
  const format = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  for (let d = `${year}-01-01`; d.startsWith(String(year)); d = addDays(d, 1)) {
    const parts = Object.fromEntries(format.formatToParts(new Date(`${d}T12:00:00Z`)).map(p => [p.type, p.value]));
    if (parts.month === month && Number(parts.day) === day) return d;
  }
  return null;
}

const hebrew = (month, day, year) => dateInCalendar('hebrew', month, day, year);
const islamic = (month, day, year) => dateInCalendar('islamic-umalqura', month, day, year);

// The Chinese New Year: the day, on Beijing's clock, of the second new moon
// after the December solstice. Not Intl's Chinese calendar: for 2027 it gives
// Feb 7, when the new moon falls four minutes before midnight in Beijing on
// Feb 6, the date China keeps (checked 2026-11-02).
function lunarNewYear(year) {
  const solstice = turningPoints(year - 1).december;
  const first = moonPhaseAfter(solstice, 'new');
  const second = moonPhaseAfter(new Date(first.getTime() + 864e5), 'new');
  return isoDay(second.getTime() + 8 * 3600e3);
}

// Vesak as the United Nations keeps it: the first full moon of May (UTC).
const vesak = (year) => isoDay(moonPhaseAfter(`${year}-05-01T00:00:00Z`, 'full').getTime());

// Easter Sunday, Western (Gregorian computus) and Orthodox (Julian, given in
// Gregorian dates).
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function orthodoxEaster(year) {
  const a = year % 4, b = year % 7, c = year % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  const julian = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return addDays(julian, Math.floor(year / 100) - Math.floor(year / 400) - 2);
}

// The nth day of a year (Programmers' Day is the 256th).
const dayOfYear = (year, n) => addDays(`${year}-01-01`, n - 1);

// A day kept by hand in festivals.json, or null for a year it does not hold.
const festival = (key, year) => (FESTIVALS[key] && FESTIVALS[key].dates[year]) || null;

module.exports = { dateInCalendar, hebrew, islamic, lunarNewYear, vesak, easter, orthodoxEaster, dayOfYear, festival, FESTIVALS };
