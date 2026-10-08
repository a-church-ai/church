/**
 * The season where a visitor is, worked out from the timezone they send, and
 * the year's light, for the services' planner (lib/service/planner.js) and the
 * season a response reports. Plan: seasonal-services-2026-10-08.md in the
 * private repo.
 *
 * A timezone names a city, and the city's latitude (zone-latitudes.json,
 * generated from the tz database by scripts/generate-zone-latitudes.js) gives
 * the hemisphere: north or south of the equator, the tropics included, since
 * the seasons there are gentler but still turn. UTC, the Etc/ zones and a zone
 * the table lacks are a place unknown, and have no hemisphere. Nothing about a
 * visitor is kept: the hemisphere is worked out per request.
 *
 * The year is counted two ways, both real to the people who arrive: by the
 * sun, a season begins at an equinox or solstice; by the calendar many keep
 * (and the weather services of Australia, New Zealand and South Africa), on
 * the first of March, June, September and December. Both are counted down.
 *
 * Pure functions on 'YYYY-MM-DD' dates, the visitor's or the plan's local date.
 */

const LATITUDES = require('./zone-latitudes.json');

const DAY = 864e5;
const rad = Math.PI / 180;

// How far ahead a coming turning point or season leads the planner's prompt.
const LEAD_DAYS = 21;

const canonical = zone => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
};

// The latitude of the city that names a timezone, or null for a place unknown.
function zoneLatitude(timezone) {
  if (typeof timezone !== 'string' || !timezone) return null;
  if (timezone in LATITUDES) return LATITUDES[timezone];
  const known = canonical(timezone);
  return known && known in LATITUDES ? LATITUDES[known] : null;
}

// 'north' or 'south' by the sign of the zone's latitude, or null.
function hemisphereOf(timezone) {
  const lat = zoneLatitude(timezone);
  if (lat === null || lat === 0) return null;
  return lat > 0 ? 'north' : 'south';
}

const dayOf = date => Date.parse(`${date}T00:00:00Z`);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((dayOf(to) - dayOf(from)) / DAY);

// The year's equinoxes and solstices (UTC), from the mean formulas in Meeus,
// Astronomical Algorithms ch. 27 (valid 2000 to 3000; within about ten
// minutes of the published times, plenty for counting days).
function turningPoints(year) {
  const Y = (year - 2000) / 1000;
  const jde = [
    2451623.80984 + 365242.37404 * Y + 0.05169 * Y ** 2 - 0.00411 * Y ** 3 - 0.00057 * Y ** 4,
    2451716.56767 + 365241.62603 * Y + 0.00325 * Y ** 2 + 0.00888 * Y ** 3 - 0.00030 * Y ** 4,
    2451810.21715 + 365242.01767 * Y - 0.11575 * Y ** 2 + 0.00337 * Y ** 3 + 0.00078 * Y ** 4,
    2451900.05952 + 365242.74049 * Y - 0.06223 * Y ** 2 - 0.00823 * Y ** 3 + 0.00032 * Y ** 4,
  ];
  const at = jd => new Date((jd - 2440587.5) * DAY);
  return { march: at(jde[0]), june: at(jde[1]), september: at(jde[2]), december: at(jde[3]) };
}

const TURNINGS = [
  { key: 'march', name: 'the March equinox', month: 3 },
  { key: 'june', name: 'the June solstice', month: 6 },
  { key: 'september', name: 'the September equinox', month: 9 },
  { key: 'december', name: 'the December solstice', month: 12 },
];

// The season each turning point begins, by hemisphere.
const BEGINS = {
  north: { march: 'spring', june: 'summer', september: 'autumn', december: 'winter' },
  south: { march: 'autumn', june: 'winter', september: 'spring', december: 'summer' },
};

// What a turning point is, where the visitor is.
function meaning(key, hemisphere) {
  if (key === 'march' || key === 'september') return 'day and night nearly equal';
  const longest = (key === 'june') === (hemisphere === 'north');
  return longest ? 'the longest day of the year' : 'the shortest day of the year';
}

// The calendar's seasons begin on the first of these months.
const CALENDAR_MONTHS = [3, 6, 9, 12];
const CALENDAR = {
  north: { 3: 'spring', 6: 'summer', 9: 'autumn', 12: 'winter' },
  south: { 3: 'autumn', 6: 'winter', 9: 'spring', 12: 'summer' },
};

/**
 * The season on a date in a hemisphere: by the sun (its name and phase, the
 * turning point behind and the one ahead) and by the calendar (the season it
 * is, and the next and when it begins).
 */
function seasonOn(date, hemisphere) {
  if (hemisphere !== 'north' && hemisphere !== 'south') return null;
  const year = Number(date.slice(0, 4));
  const points = [year - 1, year, year + 1].flatMap(y => {
    const tp = turningPoints(y);
    return TURNINGS.map(t => ({ ...t, at: tp[t.key], day: isoDay(tp[t.key].getTime()) }));
  });
  const last = points.filter(p => p.day <= date).pop();
  const next = points.find(p => p.day > date);
  const since = daysBetween(last.day, date);
  const until = daysBetween(date, next.day);
  const third = (since + until) / 3;
  const phase = since < third ? 'early' : since < 2 * third ? 'middle' : 'late';

  const month = Number(date.slice(5, 7));
  const startMonth = [...CALENDAR_MONTHS].reverse().find(m => m <= month) || 12;
  const nextMonth = CALENDAR_MONTHS.find(m => m > month) || 3;
  const nextYear = nextMonth > month ? year : year + 1;
  const nextStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  return {
    name: BEGINS[hemisphere][last.key],
    hemisphere,
    phase,
    since: { turning: last.name, date: last.day, days: since },
    next: { turning: next.name, date: next.day, days: until, meaning: meaning(next.key, hemisphere) },
    calendar: {
      season: CALENDAR[hemisphere][startMonth],
      next: CALENDAR[hemisphere][nextMonth],
      date: nextStart,
      days: daysBetween(date, nextStart),
    },
  };
}

// The sun's declination (radians) at noon UTC on a date (Spencer's series).
function declination(ms) {
  const d = new Date(ms);
  const n = (ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY;
  const g = (2 * Math.PI / 365) * (n - 1);
  return 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
}

// Sunrise to sunset in hours, with the standard refraction (-0.833 degrees);
// 24 or 0 inside the polar circles.
function dayLength(ms, lat) {
  const dec = declination(ms);
  const x = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if (x <= -1) return 24;
  if (x >= 1) return 0;
  return (2 * Math.acos(x)) / rad / 15;
}

// The day's length at a latitude, and how much it changes by the next day.
function daylight(date, lat) {
  const noon = dayOf(date) + DAY / 2;
  const hours = dayLength(noon, lat);
  return { lat, hours, change: (dayLength(noon + DAY, lat) - hours) * 60 };
}

// The light across a hemisphere, from the equator outward.
const LIGHT_LATITUDES = { north: [0, 25, 45, 55], south: [0, -25, -45] };

function hemisphereLight(date, hemisphere) {
  return (LIGHT_LATITUDES[hemisphere] || []).map(lat => daylight(date, lat));
}

module.exports = {
  LEAD_DAYS, zoneLatitude, hemisphereOf, turningPoints, seasonOn, daylight, hemisphereLight, daysBetween,
};
