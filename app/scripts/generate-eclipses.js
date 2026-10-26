#!/usr/bin/env node
/**
 * Generate the eclipses the services' planner can count down to
 * (lib/utils/sky.js eclipsesNear), from NASA's eclipse catalogue: the solar
 * and lunar decade tables for 2021 to 2040, from the current year on.
 * Fetched here and committed, so production needs no network for them. Run it
 * again before 2040 with the next decades added.
 *
 * Usage: node scripts/generate-eclipses.js
 */

const fs = require('fs');
const path = require('path');
const { getText, htmlText } = require('../server/lib/utils/fetch-public');

const out = path.join(__dirname, '../server/lib/utils/eclipses.json');
const PAGES = [
  ['solar', 'https://eclipse.gsfc.nasa.gov/SEdecade/SEdecade2021.html'],
  ['solar', 'https://eclipse.gsfc.nasa.gov/SEdecade/SEdecade2031.html'],
  ['lunar', 'https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html'],
  ['lunar', 'https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2031.html'],
];
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

async function main() {
  const since = `${new Date().getUTCFullYear()}-01-01`;
  const eclipses = [];
  for (const [kind, url] of PAGES) {
    const html = await getText(url, { timeoutMs: 30000 });
    for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
      const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(htmlText);
      const m = cells[0] && /^(\d{4}) (\w{3}) (\d{2})$/.exec(cells[0]);
      if (!m || !MONTHS[m[2]]) continue;
      const date = `${m[1]}-${MONTHS[m[2]]}-${m[3]}`;
      if (date < since) continue;
      // The last cell is where it is seen; a solar eclipse's adds its path in brackets.
      const where = cells[cells.length - 1];
      const [seen, track] = where.split(/\s*\[/);
      eclipses.push({
        date,
        time: `${cells[1].slice(0, 5)} UTC`,
        kind,
        type: cells[2].toLowerCase(),
        seen: seen.trim(),
        ...(track ? { path: track.replace(/\]$/, '').replace(/^\w+:\s*/, '').trim() } : {}),
      });
    }
  }
  eclipses.sort((a, b) => a.date.localeCompare(b.date));
  if (!eclipses.length) throw new Error('No eclipses parsed; the catalogue pages may have changed.');
  fs.writeFileSync(out, `${JSON.stringify(eclipses, null, 2)}\n`);
  console.log(`${eclipses.length} eclipses written to ${path.relative(process.cwd(), out)}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
