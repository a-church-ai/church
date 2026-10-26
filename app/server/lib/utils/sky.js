/**
 * The sky on a date, for the services' planner: the moon, the planets, the
 * meteor showers and eclipses near it, and the Voyagers near their dates.
 * Pure and offline, from astronomy-engine and three committed tables
 * (eclipses.json from NASA, voyagers.json from JPL, the showers below from
 * the IMO); the space-weather forecast is fetched separately
 * (./space-weather.js). Plans: seasonal-services-2026-10-08.md and
 * sky-and-earth-sources-2026-10-08.md in the private repo.
 *
 * What it says stays on the side of what is established: the moon lights the
 * night and drives the tides; planets, showers and eclipses are where their
 * orbits put them. Nothing here says the sky acts on anyone.
 */

const Astronomy = require('astronomy-engine');
const ECLIPSES = require('./eclipses.json');
const VOYAGERS = require('./voyagers.json');
const { LEAD_DAYS, daysBetween } = require('./seasons');

const DAY = 864e5;
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

// The moon's phases as the engine counts them: its ecliptic longitude ahead
// of the sun's, in degrees.
const PHASE_ANGLE = { new: 0, 'first quarter': 90, full: 180, 'last quarter': 270 };

// The first new or full moon (or quarter) at or after a moment.
function moonPhaseAfter(when, phase) {
  return Astronomy.SearchMoonPhase(PHASE_ANGLE[phase], new Date(when), 40).date;
}

// Whether a phase falls within a day either side of a moment.
const phaseWithinADay = (ms, phase) => Astronomy.SearchMoonPhase(PHASE_ANGLE[phase], new Date(ms - DAY), 2) !== null;

/**
 * The moon on a date (at noon UTC): its phase, how much of it is lit, the
 * next new and full moon and the days until each, and which side is lit as
 * the north and the south see it. New, full and the quarters are named
 * within a day of their true times.
 */
function moonOn(date) {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const angle = Astronomy.MoonPhase(new Date(noon));
  const waxing = angle < 180;
  const illumination = Math.round(Astronomy.Illumination(Astronomy.Body.Moon, new Date(noon)).phase_fraction * 100) / 100;
  const named = ['new', 'full', 'first quarter', 'last quarter'].find(phase => phaseWithinADay(noon, phase));
  const phase = named || (waxing ? (angle < 90 ? 'waxing crescent' : 'waxing gibbous') : (angle < 270 ? 'waning gibbous' : 'waning crescent'));
  const nextNew = isoDay(moonPhaseAfter(noon, 'new').getTime());
  const nextFull = isoDay(moonPhaseAfter(noon, 'full').getTime());
  return {
    phase,
    illumination,
    nextNew,
    daysToNew: daysBetween(date, nextNew),
    nextFull,
    daysToFull: daysBetween(date, nextFull),
    // A waxing moon is lit on the right as the north sees it, on the left as
    // the south does; a waning moon the other way.
    litSide: { north: waxing ? 'right' : 'left', south: waxing ? 'left' : 'right' },
  };
}

// The major annual meteor showers: typical peak dates (within a day or so
// year to year), typical hourly rates at their best, and where they are seen
// (by their radiant's declination), from the International Meteor
// Organization's working list. Refresh from the IMO's calendar if one drifts.
const SHOWERS = [
  { name: 'Quadrantids', peak: '01-04', rate: 110, seen: 'north' },
  { name: 'Lyrids', peak: '04-22', rate: 18, seen: 'north' },
  { name: 'Eta Aquariids', peak: '05-06', rate: 50, seen: 'south' },
  { name: 'Southern Delta Aquariids', peak: '07-30', rate: 25, seen: 'south' },
  { name: 'Perseids', peak: '08-12', rate: 100, seen: 'north' },
  { name: 'Draconids', peak: '10-08', rate: 10, seen: 'north' },
  { name: 'Orionids', peak: '10-21', rate: 20, seen: 'both' },
  { name: 'Leonids', peak: '11-17', rate: 15, seen: 'both' },
  { name: 'Geminids', peak: '12-14', rate: 150, seen: 'both' },
  { name: 'Ursids', peak: '12-22', rate: 10, seen: 'north' },
];

// The showers seen in a hemisphere that peak today or within LEAD_DAYS.
function showersNear(date, hemisphere) {
  const year = Number(date.slice(0, 4));
  return SHOWERS
    .filter(s => s.seen === 'both' || s.seen === hemisphere)
    .map(s => {
      const thisYear = `${year}-${s.peak}`;
      const peak = thisYear >= date ? thisYear : `${year + 1}-${s.peak}`;
      return { name: s.name, peak, days: daysBetween(date, peak), rate: s.rate };
    })
    .filter(s => s.days <= LEAD_DAYS)
    .sort((a, b) => a.days - b.days);
}

// Eclipses today or within LEAD_DAYS, from NASA's catalogue (eclipses.json,
// written by scripts/generate-eclipses.js).
function eclipsesNear(date) {
  return ECLIPSES
    .map(e => ({ ...e, days: daysBetween(date, e.date) }))
    .filter(e => e.days >= 0 && e.days <= LEAD_DAYS);
}

// A pure function of its arguments, remembered: the planner asks the same
// date eighteen times (six slots, three variants), and the planets take tens
// of milliseconds to work out.
function memo(fn) {
  const cache = new Map();
  return (...args) => {
    const key = args.join('|');
    if (!cache.has(key)) {
      if (cache.size >= 64) cache.clear();
      cache.set(key, fn(...args));
    }
    return cache.get(key);
  };
}

// The planets. What can be seen is worked out for a hemisphere at a
// representative latitude, 35 degrees either side of the equator (Tokyo,
// Sydney): a planet counts as seen when it stands at least 10 degrees up at
// the end of evening civil twilight or the start of morning's, and shines at
// magnitude 1.5 or brighter, or stands that high at midnight between them (a
// planet near opposition is low at both twilights and high all night). The
// ecliptic stands steep or shallow at dusk and dawn by season, so one planet
// can be well placed from one hemisphere and lost in the glow from the other.
const NAKED_EYE = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
const VIEW_LATITUDE = { north: 35, south: -35 };
const MIN_ALTITUDE = 10;
const MAX_MAGNITUDE = 1.5;

// The end of evening civil twilight on a date, or the start of morning's, at
// a latitude on the prime meridian, so near the UTC date's own.
function twilight(date, lat, when) {
  const observer = new Astronomy.Observer(lat, 0, 0);
  const from = new Date(`${date}T${when === 'evening' ? '12' : '00'}:00:00Z`);
  const t = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, when === 'evening' ? -1 : +1, from, 1, -6);
  return t && { observer, date: t.date };
}

function altitudeAt(body, at) {
  const eq = Astronomy.Equator(body, at.date, at.observer, true, true);
  return Astronomy.Horizon(at.date, at.observer, eq.ra, eq.dec, 'normal').altitude;
}

// Whether a planet stands high enough at a date's evening or morning
// twilight, from each hemisphere.
const placed = (body, date, when) => Object.fromEntries(Object.entries(VIEW_LATITUDE).map(([h, lat]) => {
  const at = twilight(date, lat, when);
  return [h, Boolean(at) && altitudeAt(body, at) >= MIN_ALTITUDE];
}));

// The naked-eye planets seen from a hemisphere in the night that follows a
// date, and when in it, from what is high at dusk, at midnight and at dawn:
// 'evening', 'evening into night', 'all night', 'night', 'night into
// morning', 'morning', or 'evening and morning'.
const planetsOn = memo((date, hemisphere) => {
  const lat = VIEW_LATITUDE[hemisphere];
  if (lat === undefined) return null;
  const dusk = twilight(date, lat, 'evening');
  const dawn = twilight(isoDay(Date.parse(`${date}T12:00:00Z`) + DAY), lat, 'morning');
  const midnight = dusk && dawn && { observer: dusk.observer, date: new Date((dusk.date.getTime() + dawn.date.getTime()) / 2) };
  const up = (name, at) => Boolean(at) && altitudeAt(name, at) >= MIN_ALTITUDE;
  return NAKED_EYE.map(name => {
    const magnitude = Astronomy.Illumination(name, new Date(`${date}T12:00:00Z`)).mag;
    if (magnitude > MAX_MAGNITUDE) return null;
    const [evening, night, morning] = [up(name, dusk), up(name, midnight), up(name, dawn)];
    const when = evening && night && morning ? 'all night'
      : evening && night ? 'evening into night'
        : night && morning ? 'night into morning'
          : evening && morning ? 'evening and morning'
            : evening ? 'evening' : morning ? 'morning' : night ? 'night' : null;
    return when && { name, when, magnitude: Math.round(magnitude * 10) / 10 };
  }).filter(Boolean);
});

// When the moon passes within 3 degrees of a planet, between two moments,
// unless the planet is lost in the sun's glare: six-hour steps to find each
// closest approach, then hourly ones around it.
function moonPasses(body, start, end) {
  const apart = ms => Astronomy.AngleBetween(Astronomy.GeoVector(Astronomy.Body.Moon, new Date(ms), true), Astronomy.GeoVector(body, new Date(ms), true));
  const step = 6 * 3600e3;
  const found = [];
  let before = null, at = null;
  for (let ms = start.getTime() - step; ms <= end.getTime() + step; ms += step) {
    const now = { ms, angle: apart(ms) };
    if (before && at && at.angle < before.angle && at.angle <= now.angle) {
      let best = at;
      for (let h = -6; h <= 6; h++) {
        const angle = apart(at.ms + h * 3600e3);
        if (angle < best.angle) best = { ms: at.ms + h * 3600e3, angle };
      }
      if (best.angle < 3 && Astronomy.Elongation(body, new Date(best.ms)).elongation >= 15) found.push({ date: new Date(best.ms), separation: Math.round(best.angle * 10) / 10 });
    }
    before = at;
    at = now;
  }
  return found;
}

// The planets' events from a date to LEAD_DAYS after it: Mercury and Venus at
// their greatest elongation (with where they are well placed) and passing
// between the sun and the Earth or behind the sun; the outer planets at
// opposition and, the naked-eye ones, passing behind the sun; and the moon
// passing close to Venus, Mars, Jupiter or Saturn. astronomy-engine measures
// relative longitude from the sun: 0 degrees is an outer planet's opposition
// and an inner planet's inferior conjunction, 180 their conjunctions behind
// the sun.
const planetEventsNear = memo(date => {
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start.getTime() + (LEAD_DAYS + 1) * DAY);
  const events = [];
  const add = (t, body, kind, extra = {}) => {
    if (!t || t < start || t >= end) return;
    const day = isoDay(t.getTime());
    events.push({ date: day, days: daysBetween(date, day), body, kind, ...extra });
  };
  for (const body of ['Mercury', 'Venus']) {
    for (let from = start; from < end;) {
      const e = Astronomy.SearchMaxElongation(body, from);
      add(e.time.date, body, 'greatest elongation', { when: e.visibility, elongation: Math.round(e.elongation), placed: placed(body, isoDay(e.time.date.getTime()), e.visibility) });
      from = new Date(e.time.date.getTime() + DAY);
    }
    add(Astronomy.SearchRelativeLongitude(body, 0, start).date, body, 'inferior conjunction');
    add(Astronomy.SearchRelativeLongitude(body, 180, start).date, body, 'superior conjunction');
  }
  for (const body of ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    add(Astronomy.SearchRelativeLongitude(body, 0, start).date, body, 'opposition', { nakedEye: NAKED_EYE.includes(body) });
    if (NAKED_EYE.includes(body)) add(Astronomy.SearchRelativeLongitude(body, 180, start).date, body, 'conjunction');
  }
  for (const body of ['Venus', 'Mars', 'Jupiter', 'Saturn']) {
    for (const pass of moonPasses(body, start, end)) add(pass.date, body, 'near the moon', { separation: pass.separation });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.body.localeCompare(b.body));
});

// The Voyagers' dates (NASA): their launches, the Pale Blue Dot, each one's
// crossing into interstellar space, coming round each year; and Voyager 1
// reaching one light-day from Earth, once. Within LEAD_DAYS of one, the
// planner is told it; otherwise the Voyagers are not mentioned.
const VOYAGER_DATES = [
  { craft: 'Voyager 2', date: '1977-08-20', what: 'launch' },
  { craft: 'Voyager 1', date: '1977-09-05', what: 'launch' },
  { craft: 'Voyager 1', date: '1990-02-14', what: 'pale blue dot' },
  { craft: 'Voyager 1', date: '2012-08-25', what: 'interstellar space' },
  { craft: 'Voyager 2', date: '2018-11-05', what: 'interstellar space' },
  { craft: 'Voyager 1', date: '2026-11-18', what: 'one light-day', once: true },
];
const LIGHT_HOURS_PER_AU = 149597870.7 / 299792.458 / 3600;

// A craft's distance from Earth on a date in light-hours, interpolated
// between voyagers.json's months (within a few thousandths of a light-hour of
// JPL's daily figure, a couple of days' travel); null outside them. The
// planner is told it to the whole light-hour.
function lightHoursOn(craft, date) {
  const rows = VOYAGERS.distances[craft] || [];
  const at = Date.parse(`${date}T12:00:00Z`);
  for (let i = 1; i < rows.length; i++) {
    const [d0, au0] = rows[i - 1];
    const [d1, au1] = rows[i];
    const t0 = Date.parse(`${d0}T00:00:00Z`), t1 = Date.parse(`${d1}T00:00:00Z`);
    if (at >= t0 && at <= t1) return Math.round((au0 + ((au1 - au0) * (at - t0)) / (t1 - t0)) * LIGHT_HOURS_PER_AU * 1000) / 1000;
  }
  return null;
}

function voyagersNear(date) {
  const year = Number(date.slice(0, 4));
  return VOYAGER_DATES.map(v => {
    const next = v.once ? v.date : [year, year + 1].map(y => `${y}${v.date.slice(4)}`).find(d => d >= date);
    const days = daysBetween(date, next);
    if (days < 0 || days > LEAD_DAYS) return null;
    return { craft: v.craft, what: v.what, since: v.once ? null : v.date.slice(0, 4), date: next, days, lightHours: lightHoursOn(v.craft, date) };
  }).filter(Boolean).sort((a, b) => a.days - b.days);
}

module.exports = {
  moonPhaseAfter, moonOn, showersNear, eclipsesNear, planetsOn, planetEventsNear, voyagersNear, lightHoursOn, SHOWERS, VOYAGER_DATES,
};
