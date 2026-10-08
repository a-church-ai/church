#!/usr/bin/env node
/**
 * Generate the latitude of every timezone's principal city, which is all the
 * services need to know which hemisphere a visitor's season is in
 * (lib/utils/seasons.js).
 *
 * The tz database's zone.tab lists each zone with the coordinates of the city
 * that names it, and is public domain. It is read here, where the tz files
 * are, and the result is committed, so production needs none (the pattern of
 * generate-docs-lastmod.js). Node reports some zones by older ICU names
 * (Asia/Kolkata as Asia/Calcutta, America/Argentina/Buenos_Aires as
 * America/Buenos_Aires), so each zone is written under that name too.
 *
 * Usage: node scripts/generate-zone-latitudes.js [path to zone.tab]
 *        (default /usr/share/zoneinfo/zone.tab)
 */

const fs = require('fs');
const path = require('path');

const source = process.argv[2] || '/usr/share/zoneinfo/zone.tab';
const out = path.join(__dirname, '../server/lib/utils/zone-latitudes.json');

// ISO 6709, as zone.tab writes it: +DDMM or +DDMMSS, then the longitude.
function latitude(coordinates) {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?/.exec(coordinates);
  if (!m) throw new Error(`Unreadable coordinates: ${coordinates}`);
  const value = Number(m[2]) + Number(m[3]) / 60 + (m[4] ? Number(m[4]) / 3600 : 0);
  return Math.round((m[1] === '-' ? -value : value) * 10) / 10;
}

const canonical = zone => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
};

const latitudes = {};
for (const line of fs.readFileSync(source, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [, coordinates, zone] = line.split('\t');
  const lat = latitude(coordinates);
  latitudes[zone] = lat;
  const known = canonical(zone);
  if (known && known !== zone) latitudes[known] = lat;
}

const sorted = Object.fromEntries(Object.entries(latitudes).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(out, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${Object.keys(sorted).length} zones written to ${path.relative(process.cwd(), out)}`);
