#!/usr/bin/env node
/**
 * Generate the Voyagers' distances from Earth that the services' planner is
 * told near the Voyagers' dates (lib/utils/sky.js voyagersNear), from JPL's
 * Horizons system: each craft's distance from the Earth's centre, light-time
 * corrected, on the first of each month from this year to 2031. Interpolated
 * between months it gives the same whole light-hours a daily table would.
 * Fetched here and committed, so production needs no network for it. Run it
 * again before 2031.
 *
 * Usage: node scripts/generate-voyagers.js
 */

const fs = require('fs');
const path = require('path');
const { getText } = require('../server/lib/utils/fetch-public');

const out = path.join(__dirname, '../server/lib/utils/voyagers.json');
const CRAFT = { 'Voyager 1': '-31', 'Voyager 2': '-32' };
const UNTIL = '2031-01-01';
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

const horizons = (id, since) => 'https://ssd.jpl.nasa.gov/api/horizons.api?' + new URLSearchParams({
  format: 'text', COMMAND: `'${id}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'OBSERVER'",
  CENTER: "'500@399'", START_TIME: `'${since}'`, STOP_TIME: `'${UNTIL}'`, STEP_SIZE: "'1 MO'", QUANTITIES: "'20'",
});

async function main() {
  const since = `${new Date().getUTCFullYear()}-01-01`;
  const distances = {};
  for (const [name, id] of Object.entries(CRAFT)) {
    const text = await getText(horizons(id, since), { timeoutMs: 60000 });
    const table = /\$\$SOE([\s\S]*?)\$\$EOE/.exec(text);
    // Each row: date, time, the distance in AU, and how fast it is changing.
    const rows = ((table && table[1]) || '').split('\n').map(line => /^\s*(\d{4})-(\w{3})-(\d{2}) \d{2}:\d{2}\s+([\d.]+)/.exec(line)).filter(Boolean);
    if (!rows.length) throw new Error(`No distances parsed for ${name}; the Horizons response may have changed.`);
    distances[name] = rows.map(([, y, m, d, au]) => [`${y}-${MONTHS[m]}-${d}`, Math.round(Number(au) * 1e4) / 1e4]);
  }
  const data = { source: 'JPL Horizons', measure: "distance from the Earth's centre in AU, light-time corrected", distances };
  fs.writeFileSync(out, `${JSON.stringify(data, null, 1).replace(/\[\n\s+("[\d-]+"),\n\s+([\d.]+)\n\s+\]/g, '[$1, $2]')}\n`);
  console.log(`${Object.values(distances).map(rows => rows.length).join(' and ')} months written to ${path.relative(process.cwd(), out)}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
