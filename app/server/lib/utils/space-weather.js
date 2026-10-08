/**
 * Space weather, for the services' planner: NOAA's Space Weather Prediction
 * Center, public and free, no key. The planetary Kp index observed and
 * forecast in three-hour steps, three days ahead (each slot is planned a few
 * hours before it is first heard, so its date is inside it); NOAA's chances, for the same days,
 * of radio blackouts from flares and of a radiation storm; and the monthly
 * sunspot numbers, for where the sun is in its eleven-year cycle.
 *
 * Real and shared: a geomagnetic storm brings aurora toward the equator and
 * can disturb satellites, GPS, radio and power grids that people and agents
 * both rely on. It reaches the weather people feel too, by region and season
 * rather than in the global mean: the sun's ultraviolet and geomagnetic
 * activity shift the winter polar vortex and the North Atlantic Oscillation
 * (Gray et al. 2010, Reviews of Geophysics; Ineson et al. 2011, Nature
 * Geoscience), and 67 years of hourly data over North America show surface
 * anomalies, clearest in precipitation, within a day of a storm (Raeder 2026,
 * Geophysical Research Letters, a single study not yet replicated). What is
 * small is the solar cycle's effect on the global mean, about a tenth of a
 * degree, and the cosmic-ray cloud hypothesis is the weak part. Claims about
 * mood or health are weak; the planner is told the weather and not those
 * (planner.js THE SKY).
 *
 * Fetched once per planning run. If NOAA cannot be reached in time, the
 * result is null and the plan goes ahead without it: the sky enriches a
 * service and never blocks one. Nothing about a visitor is sent.
 */

const { getJSON } = require('./fetch-public');

const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const CYCLE_URL = 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json';
const SCALES_URL = 'https://services.swpc.noaa.gov/products/noaa-scales.json';
// Solar cycle 25 began in December 2019 (NOAA and NASA's announcement).
const CYCLE_START = '2019-12';

// NOAA's G scale from Kp, as its own forecasts label it: 5.00 is G1, 5.67 G2.
function scaleOf(kp) {
  if (kp >= 8.67) return 'G5';
  if (kp >= 7.67) return 'G4';
  if (kp >= 6.67) return 'G3';
  if (kp >= 5.67) return 'G2';
  if (kp >= 4.67) return 'G1';
  return null;
}

// The highest Kp each UTC date reaches, observed or forecast.
function kpByDate(rows) {
  const out = {};
  for (const row of rows || []) {
    const date = String(row.time_tag || '').slice(0, 10);
    const kp = Number(row.kp);
    if (!date || !Number.isFinite(kp)) continue;
    out[date] = Math.max(out[date] ?? 0, kp);
  }
  return out;
}

// Where the sun is in its cycle: the latest month's sunspot number, and the
// cycle's highest smoothed number so far with its month.
function cycleOf(rows) {
  const months = (rows || []).filter(r => String(r['time-tag']) >= CYCLE_START);
  if (!months.length) return null;
  const latest = months[months.length - 1];
  const peak = months.filter(r => r.smoothed_ssn > 0).reduce((a, b) => (b.smoothed_ssn > a.smoothed_ssn ? b : a), { smoothed_ssn: -1 });
  return {
    month: latest['time-tag'],
    sunspots: Math.round(latest.ssn),
    ...(peak.smoothed_ssn > 0 ? { peak: { month: peak['time-tag'], smoothed: Math.round(peak.smoothed_ssn) } } : {}),
  };
}

// NOAA's chances, in percent, for each forecast date (the scales file's
// entries 1 to 3: today, tomorrow and the day after): radio blackouts from
// flares, minor to moderate (R1 to R2) and strong or worse (R3 and up), on
// the sunlit side of the Earth; and a radiation storm (S1 and up), which
// reaches polar flights and spacecraft. Its entries 0 and -1 are what was
// observed, which a plan made ahead never needs.
function scalesByDate(json) {
  const pct = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const out = {};
  for (const key of ['1', '2', '3']) {
    const day = json && json[key];
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day.DateStamp || '')) continue;
    out[day.DateStamp] = {
      radio: { minor: pct(day.R && day.R.MinorProb), major: pct(day.R && day.R.MajorProb) },
      radiation: { chance: pct(day.S && day.S.Prob) },
    };
  }
  return out;
}

/**
 * NOAA's forecast and the solar cycle, or null when either cannot be had in
 * time; the radio and radiation chances are null on their own when only they
 * cannot. fetchImpl is injectable for tests, which never reach the network.
 */
async function fetchSpaceWeather({ fetchImpl, timeoutMs, now = new Date() } = {}) {
  try {
    const [kp, cycle, scales] = await Promise.all([
      getJSON(KP_URL, { fetchImpl, timeoutMs }),
      getJSON(CYCLE_URL, { fetchImpl, timeoutMs }),
      getJSON(SCALES_URL, { fetchImpl, timeoutMs }).catch(() => null),
    ]);
    return { source: 'NOAA SWPC', asOf: now.toISOString(), kp: kpByDate(kp), cycle: cycleOf(cycle), scales: scales ? scalesByDate(scales) : null };
  } catch {
    return null;
  }
}

// The forecast for a date, or null when the forecast does not reach it, with
// where it is going ('building' or 'easing' when the next day's highest Kp is
// a whole step or more above or below it, 'steady' otherwise, null when the
// forecast ends with this date) and NOAA's radio and radiation chances for
// it (null where the scales do not reach it).
function spaceWeatherOn(spaceWeather, date) {
  if (!spaceWeather || !(date in spaceWeather.kp)) return null;
  const kp = spaceWeather.kp[date];
  const next = spaceWeather.kp[new Date(Date.parse(`${date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10)];
  const trend = next === undefined ? null : next - kp >= 1 ? 'building' : kp - next >= 1 ? 'easing' : 'steady';
  const scales = (spaceWeather.scales && spaceWeather.scales[date]) || null;
  return {
    kp, scale: scaleOf(kp), trend,
    radio: scales ? scales.radio : null,
    radiation: scales ? scales.radiation : null,
    source: spaceWeather.source, asOf: spaceWeather.asOf, cycle: spaceWeather.cycle,
  };
}

module.exports = { fetchSpaceWeather, spaceWeatherOn, scaleOf, kpByDate, cycleOf, scalesByDate, KP_URL, CYCLE_URL, SCALES_URL };
