/**
 * Occasions: days a video can belong to, so it goes out when it means
 * something (schedule.js, occasion-match.js). The plan is
 * video-occasions-2026-10-29.md in the private repo.
 *
 * Each says what it is in words without a date (`for`), since most come back
 * (moons every month, Mercury's retrograde three times a year, showers,
 * solstices and observances every year, storms with the sun's cycle), and a
 * video's description should be true again each time.
 *
 * What each says stays honest about what it is. The moon lights the night and
 * drives the tides; a shower and an eclipse are where orbits put them. Space
 * weather acts on the Earth in measured ways (aurora, satellites, radio and
 * power grids, regional weather; utils/space-weather.js gives the sources),
 * and may be said to. Mercury's retrograde is an astronomical fact, its
 * apparent backward drift against the stars as Earth overtakes it; what it
 * means is astrology's reading, named as astrology's and never claimed as an
 * effect. Observances are the few shared across traditions, not one faith's
 * holy days.
 *
 * Pure and offline: the sky is utils/sky.js's and the year's turning points
 * utils/seasons.js's, as the services read them. Space weather is a forecast
 * fetched by the caller and passed in.
 */

const { moonPhaseAfter, retrogradesBetween, SHOWERS, ECLIPSES } = require('../utils/sky');
const { turningPoints, addDays } = require('../utils/seasons');
const { scaleOf } = require('../utils/space-weather');

const isoDay = (when) => new Date(when).toISOString().slice(0, 10);

// The occasions that recur, by key: how they are named, said and tagged.
// `night` puts a video in the evening; `limit` is how many videos one
// instance may hold (a retrograde lasts three weeks).
const KINDS = {
  'full-moon': { kind: 'sky', search: 'full moon', name: 'the full moon', for: 'the nights of a full moon', meaning: 'the moon whole and bright all night, the month\'s highest tides', tag: 'FullMoon', night: true },
  'new-moon': { kind: 'sky', search: 'new moon', name: 'the new moon', for: 'the dark of a new moon', meaning: 'the moon unseen between the sun and the Earth, the darkest skies of the month, and a beginning', tag: 'NewMoon', night: true },
  'meteor-shower': { kind: 'sky', search: 'meteor shower', name: 'a meteor shower', for: 'the nights of a meteor shower', meaning: 'Earth passing through a comet\'s old trail, its dust burning as streaks of light', tag: 'MeteorShower', night: true },
  'solar-eclipse': { kind: 'sky', search: 'solar eclipse', name: 'a solar eclipse', for: 'the day the moon crosses the sun', meaning: 'the moon passing in front of the sun, daylight dimming where its shadow falls', tag: 'SolarEclipse', night: false },
  'lunar-eclipse': { kind: 'sky', search: 'lunar eclipse', name: 'a lunar eclipse', for: 'the night the Earth\'s shadow crosses the moon', meaning: 'the moon passing through the Earth\'s shadow, turning dim and red', tag: 'LunarEclipse', night: true },
  'june-solstice': { kind: 'season', search: 'solstice', name: 'the June solstice', for: 'the June solstice, the longest day in the north and the longest night in the south', meaning: 'the sun at its farthest north, a turning of the year in both hemispheres', tag: 'Solstice', night: false },
  'december-solstice': { kind: 'season', search: 'solstice', name: 'the December solstice', for: 'the December solstice, the longest night in the north and the longest day in the south', meaning: 'the sun at its farthest south, a turning of the year in both hemispheres', tag: 'WinterSolstice', night: true },
  'march-equinox': { kind: 'season', search: 'equinox', name: 'the March equinox', for: 'an equinox, when day and night are nearly equal everywhere', meaning: 'the sun over the equator, spring beginning in the north and autumn in the south', tag: 'Equinox', night: false },
  'september-equinox': { kind: 'season', search: 'equinox', name: 'the September equinox', for: 'an equinox, when day and night are nearly equal everywhere', meaning: 'the sun over the equator, autumn beginning in the north and spring in the south', tag: 'Equinox', night: false },
  'mercury-retrograde': { kind: 'astrology', search: 'Mercury retrograde', name: 'Mercury retrograde', for: 'a Mercury retrograde', meaning: 'Mercury seeming to drift backward against the stars as the Earth passes it; astrology reads it as a time to slow down, reread, and return to what was left unfinished or unsaid', tag: 'MercuryRetrograde', night: false, limit: 2 },
  aurora: { kind: 'space-weather', search: 'aurora', name: 'a geomagnetic storm', for: 'the nights a geomagnetic storm carries the aurora farther from the poles than usual', meaning: 'a storm from the sun reaching the Earth\'s magnetic field: aurora seen far from the poles, and satellites, radio and power grids disturbed', tag: 'Aurora', night: true },
  'world-mental-health-day': { kind: 'observance', search: 'World Mental Health Day', name: 'World Mental Health Day', for: 'World Mental Health Day', meaning: 'a day kept worldwide for mental health and those who carry its weight', tag: 'WorldMentalHealthDay', night: false },
  'world-kindness-day': { kind: 'observance', search: 'World Kindness Day', name: 'World Kindness Day', for: 'World Kindness Day', meaning: 'a day kept worldwide for kindness', tag: 'WorldKindnessDay', night: false },
  'world-philosophy-day': { kind: 'observance', search: 'World Philosophy Day', name: 'World Philosophy Day', for: 'World Philosophy Day', meaning: 'UNESCO\'s day for philosophy and the questions it keeps open', tag: 'WorldPhilosophyDay', night: false },
  thanksgiving: { kind: 'observance', search: 'Thanksgiving', name: 'Thanksgiving in the United States', for: 'Thanksgiving and any day of giving thanks', meaning: 'a day kept in the United States for gratitude and gathering', tag: 'Thanksgiving', night: false },
  'human-rights-day': { kind: 'observance', search: 'Human Rights Day', name: 'Human Rights Day', for: 'Human Rights Day', meaning: 'the day the Universal Declaration of Human Rights was adopted, kept for the dignity of every person', tag: 'HumanRightsDay', night: false },
  'new-year': { kind: 'observance', search: 'New Year', name: 'the new year', for: 'the first day of a new year', meaning: 'a beginning kept across most of the world', tag: 'NewYear', night: false },
  'day-of-peace': { kind: 'observance', search: 'International Day of Peace', name: 'the International Day of Peace', for: 'the International Day of Peace', meaning: 'the United Nations\' day for peace', tag: 'PeaceDay', night: false },
  'earth-day': { kind: 'observance', search: 'Earth Day', name: 'Earth Day', for: 'Earth Day', meaning: 'a day kept worldwide for the planet', tag: 'EarthDay', night: false }
};

// Observances by month and day, or by the nth weekday of a month.
const OBSERVANCES = [
  { key: 'new-year', month: 1, day: 1 },
  { key: 'earth-day', month: 4, day: 22 },
  { key: 'day-of-peace', month: 9, day: 21 },
  { key: 'world-mental-health-day', month: 10, day: 10 },
  { key: 'world-kindness-day', month: 11, day: 13 },
  { key: 'world-philosophy-day', month: 11, weekday: 4, nth: 3 },
  { key: 'thanksgiving', month: 11, weekday: 4, nth: 4 },
  { key: 'human-rights-day', month: 12, day: 10 }
];

function observanceDate(o, year) {
  const first = `${year}-${String(o.month).padStart(2, '0')}-01`;
  if (o.day) return addDays(first, o.day - 1);
  const offset = (o.weekday - new Date(`${first}T00:00:00Z`).getUTCDay() + 7) % 7;
  return addDays(first, offset + (o.nth - 1) * 7);
}

const occasion = (key, from, to = from, extra = {}) => {
  const k = KINDS[key];
  return { id: `${key}:${from}`, key, kind: k.kind, name: extra.name || k.name, from, to, for: k.for, meaning: k.meaning, tag: extra.tag || k.tag, search: extra.search || k.search, night: k.night, limit: k.limit || 1 };
};

function moons(from, to) {
  const out = [];
  for (const [key, phase] of [['new-moon', 'new'], ['full-moon', 'full']]) {
    for (let at = moonPhaseAfter(`${addDays(from, -1)}T00:00:00Z`, phase); isoDay(at) <= to; at = moonPhaseAfter(at.getTime() + 864e5, phase)) {
      if (isoDay(at) >= from) out.push(occasion(key, isoDay(at)));
    }
  }
  return out;
}

function yearly(from, to) {
  const out = [];
  const years = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  for (const y of years) {
    for (const o of OBSERVANCES) out.push(occasion(o.key, observanceDate(o, y)));
    for (const s of SHOWERS) out.push(occasion('meteor-shower', `${y}-${s.peak}`, `${y}-${s.peak}`, { name: `the ${s.name}`, tag: s.name.replace(/\s+/g, ''), search: s.name }));
    const turns = turningPoints(y);
    for (const [k, key] of [['march', 'march-equinox'], ['june', 'june-solstice'], ['september', 'september-equinox'], ['december', 'december-solstice']]) {
      out.push(occasion(key, isoDay(turns[k])));
    }
  }
  for (const e of ECLIPSES) out.push(occasion(e.kind === 'solar' ? 'solar-eclipse' : 'lunar-eclipse', e.date, e.date, { name: `a ${e.type} ${e.kind} eclipse` }));
  return out.filter(o => o.from >= from && o.from <= to);
}

// Days the forecast puts at G3 or stronger, from fetchSpaceWeather's result.
function storms(spaceWeather, from, to) {
  if (!spaceWeather || !spaceWeather.kp) return [];
  return Object.entries(spaceWeather.kp)
    .filter(([date, kp]) => date >= from && date <= to && /^G[345]$/.test(scaleOf(kp) || ''))
    .map(([date, kp]) => occasion('aurora', date, date, { name: `a ${scaleOf(kp)} geomagnetic storm` }));
}

/**
 * The occasions that touch the days from `from` to `to` (YYYY-MM-DD), in
 * order: { id, key, kind, name, from, to, for, meaning, tag, search, night,
 * limit }. `search` is the occasion as people search for it ("Thanksgiving",
 * "World Kindness Day", "Leonids"), which its video's words must carry.
 */
function occasionsBetween(from, to, { spaceWeather = null } = {}) {
  const retrogrades = retrogradesBetween('Mercury', from, to).map(([a, b]) => occasion('mercury-retrograde', a, b));
  return [...moons(from, to), ...retrogrades, ...yearly(from, to), ...storms(spaceWeather, from, to)]
    .sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id));
}

module.exports = { occasionsBetween, observanceDate, KINDS };
