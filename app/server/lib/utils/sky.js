/**
 * The sky on a date, for the services' planner: the moon, the meteor showers
 * and the eclipses near it. Pure and offline; the space-weather forecast is
 * fetched separately (./space-weather.js). Plan: seasonal-services-2026-10-08.md
 * in the private repo.
 *
 * What it says stays on the side of what is established: the moon lights the
 * night and drives the tides; showers and eclipses are fixed by orbit. Nothing
 * here says the sky acts on anyone.
 */

const ECLIPSES = require('./eclipses.json');
const { LEAD_DAYS, daysBetween } = require('./seasons');

const DAY = 864e5;
const rad = Math.PI / 180;
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
// Terrestrial time runs about 69 seconds ahead of UT in these years.
const DELTA_T = 69 / 86400;

// A new (phase 0) or full (phase 0.5) moon's time, from Meeus, Astronomical
// Algorithms ch. 49, with its periodic and planetary corrections: within a
// minute or two of the published times.
function lunation(k) {
  const T = k / 1236.85;
  const full = k % 1 !== 0;
  const s = x => Math.sin(x * rad);
  const E = 1 - 0.002516 * T - 0.0000074 * T ** 2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T ** 2 - 0.00000011 * T ** 3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T ** 2 + 0.00001238 * T ** 3 - 0.000000058 * T ** 4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T ** 2 - 0.00000227 * T ** 3 + 0.000000011 * T ** 4;
  const O = 124.7746 - 1.56375588 * k + 0.0020672 * T ** 2 + 0.00000215 * T ** 3;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T ** 2 - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  jde += (full ? -0.40614 : -0.4072) * s(Mp) + (full ? 0.17302 : 0.17241) * E * s(M)
    + (full ? 0.01614 : 0.01608) * s(2 * Mp) + (full ? 0.01043 : 0.01039) * s(2 * F)
    + (full ? 0.00734 : 0.00739) * E * s(Mp - M) - (full ? 0.00515 : 0.00514) * E * s(Mp + M)
    + (full ? 0.00209 : 0.00208) * E * E * s(2 * M) - 0.00111 * s(Mp - 2 * F) - 0.00057 * s(Mp + 2 * F)
    + 0.00056 * E * s(2 * Mp + M) - 0.00042 * s(3 * Mp) + 0.00042 * E * s(M + 2 * F)
    + 0.00038 * E * s(M - 2 * F) - 0.00024 * E * s(2 * Mp - M) - 0.00017 * s(O)
    - 0.00007 * s(Mp + 2 * M) + 0.00004 * s(2 * Mp - 2 * F) + 0.00004 * s(3 * M)
    + 0.00003 * s(Mp + M - 2 * F) + 0.00003 * s(2 * Mp + 2 * F) - 0.00003 * s(Mp + M + 2 * F)
    + 0.00003 * s(Mp - M + 2 * F) - 0.00002 * s(Mp - M - 2 * F) - 0.00002 * s(3 * Mp + M) + 0.00002 * s(4 * Mp);
  const A = [
    [0.000325, 299.77 + 0.107408 * k - 0.009173 * T ** 2], [0.000165, 251.88 + 0.016321 * k],
    [0.000164, 251.83 + 26.651886 * k], [0.000126, 349.42 + 36.412478 * k], [0.00011, 84.66 + 18.206239 * k],
    [0.000062, 141.74 + 53.303771 * k], [0.00006, 207.14 + 2.453732 * k], [0.000056, 154.84 + 7.30686 * k],
    [0.000047, 34.52 + 27.261239 * k], [0.000042, 207.19 + 0.121824 * k], [0.00004, 291.34 + 1.844379 * k],
    [0.000037, 161.72 + 24.198154 * k], [0.000035, 239.56 + 25.513099 * k], [0.000023, 331.55 + 3.592518 * k],
  ];
  for (const [c, a] of A) jde += c * s(a);
  return new Date((jde - DELTA_T - 2440587.5) * DAY);
}

// The new or full moons around a moment, in order.
function lunationsAround(ms, phase) {
  const year = 2000 + (ms - Date.UTC(2000, 0, 6)) / (365.25 * DAY);
  const k0 = Math.floor((year - 2000) * 12.3685) + phase;
  return [-2, -1, 0, 1, 2].map(i => lunation(k0 + i));
}

/**
 * The moon on a date (at noon UTC): its phase, how much of it is lit, the
 * next new and full moon and the days until each, and which side is lit as
 * the north and the south see it.
 */
function moonOn(date) {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const news = lunationsAround(noon, 0).map(d => d.getTime());
  const fulls = lunationsAround(noon, 0.5).map(d => d.getTime());
  const lastNew = news.filter(t => t <= noon).pop();
  const nextNew = news.find(t => t > noon);
  const lastFull = fulls.filter(t => t <= noon).pop();
  const nextFull = fulls.find(t => t > noon);
  // Waxing from the last new moon to the next full, waning from the last full
  // to the next new; the phase angle runs evenly between them, so the moon is
  // wholly lit at full and dark at new, at their true times.
  const waxing = lastNew > lastFull;
  const [start, end] = waxing ? [lastNew, nextFull] : [lastFull, nextNew];
  const frac = (noon - start) / (end - start);
  const angle = Math.PI * (waxing ? frac : 1 + frac);
  const illumination = Math.round(((1 - Math.cos(angle)) / 2) * 100) / 100;
  const within = (t, d) => Math.abs(noon - t) <= d * DAY;
  const quarter = DAY / (end - start);
  const phase = within(lastNew, 1) || within(nextNew, 1) ? 'new'
    : within(lastFull, 1) || within(nextFull, 1) ? 'full'
      : Math.abs(frac - 0.5) <= quarter ? (waxing ? 'first quarter' : 'last quarter')
        : waxing ? (frac < 0.5 ? 'waxing crescent' : 'waxing gibbous')
          : (frac < 0.5 ? 'waning gibbous' : 'waning crescent');
  return {
    phase,
    illumination,
    nextNew: isoDay(nextNew),
    daysToNew: daysBetween(date, isoDay(nextNew)),
    nextFull: isoDay(nextFull),
    daysToFull: daysBetween(date, isoDay(nextFull)),
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

module.exports = { lunation, moonOn, showersNear, eclipsesNear, SHOWERS };
