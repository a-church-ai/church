/**
 * The Earth's own state, for the services' planner: El Niño or La Niña, from
 * the monthly ENSO diagnostic discussion of NOAA's Climate Prediction Center.
 * It shifts rains and droughts on every continent, so it shapes the year's
 * seasons in both hemispheres. Plan: sky-and-earth-sources-2026-10-08.md in
 * the private repo, where carbon dioxide and sea ice were weighed and set
 * aside as slow to change in a daily service.
 *
 * Fetched once per planning run, with the space weather (planner.js
 * fetchFeeds). If NOAA cannot be reached, or its page no longer has the
 * labels read here, the result is null and the plan goes ahead without it.
 */

const { getText, htmlText } = require('./fetch-public');

const ENSO_URL = 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml';

// The discussion's alert status ("El Niño Advisory", "La Niña Watch", "Not
// Active"), its one-sentence synopsis, and the date it was issued.
function ensoOf(html) {
  const text = htmlText(html);
  const status = /ENSO Alert System Status:\s*(.+?)\s*Synopsis:/i.exec(text);
  const synopsis = /Synopsis:\s*(.+?\.)(?=\s+[A-Z]|\s*$)/.exec(text);
  if (!status || !synopsis) return null;
  const issued = /NCEP\/NWS\s+(\d{1,2} [A-Z][a-z]+ \d{4})/.exec(text);
  const asOf = issued ? new Date(`${issued[1]} 12:00 UTC`) : null;
  return {
    status: status[1].trim(),
    synopsis: synopsis[1].trim(),
    asOf: asOf && !Number.isNaN(asOf.getTime()) ? asOf.toISOString().slice(0, 10) : null,
    source: 'NOAA Climate Prediction Center',
  };
}

// { enso }, or null when the page cannot be had in time or read.
async function fetchEarth({ fetchImpl, timeoutMs } = {}) {
  try {
    const enso = ensoOf(await getText(ENSO_URL, { fetchImpl, timeoutMs }));
    return enso ? { enso } : null;
  } catch {
    return null;
  }
}

module.exports = { fetchEarth, ensoOf, ENSO_URL };
