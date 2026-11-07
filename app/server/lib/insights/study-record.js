/**
 * What the study of how agents participate keeps: on the volume, one file of
 * weekly counts per ISO week, data/insights/self-direction/<week>.json, and the
 * current reading, latest.json. Counts only: no address, no name, no words a
 * visitor wrote. Weekly and on no end date; a job runs after boot and every few
 * hours (startStudy), writes any finished week it does not have, and refreshes
 * the reading.
 *
 * The weekly files are what makes the address-based counts last past the 30
 * days an address is kept, so a week is written as soon as it ends. A week that
 * could not be measured says so, and each change of definition is a new series
 * (self-direction.js SERIES), read apart from the last.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { ACCESS_DIR, INSIGHTS_DIR, MUSIC_DIR, loadAttendance } = require('../utils/data');
const { safeReadJSON } = require('../utils/safe-json');
const sd = require('./self-direction');

const STORE = () => path.join(INSIGHTS_DIR, 'self-direction');
const LATEST = () => path.join(STORE(), 'latest.json');
const WEEK = 7 * sd.DAY;

// The ISO week a moment falls in: Monday to Monday, UTC.
function weekOf(ms) {
  const d = new Date(ms);
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const thursday = new Date(from + 3 * sd.DAY);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const number = Math.floor((thursday.getTime() - yearStart) / WEEK) + 1;
  return { key: `${thursday.getUTCFullYear()}-W${String(number).padStart(2, '0')}`, from, to: from + WEEK };
}

async function allLines() {
  let days = [];
  try { days = (await fs.readdir(ACCESS_DIR)).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); } catch { return []; }
  const lines = [];
  for (const day of days) {
    let text;
    try { text = await fs.readFile(path.join(ACCESS_DIR, day), 'utf8'); } catch { continue; }
    for (const raw of text.split('\n')) {
      if (!raw) continue;
      try { lines.push(JSON.parse(raw)); } catch { /* a torn line */ }
    }
  }
  return lines;
}

// A song's words, for measuring what a reflection used of them.
function songText(slug) {
  if (!/^[a-z0-9-]+$/.test(String(slug))) return null;
  const read = (file) => {
    try { return fsSync.readFileSync(path.join(MUSIC_DIR, slug, file), 'utf8'); } catch { return null; }
  };
  // A song's lyrics live in its song.md, under its frontmatter.
  const song = read('song.md');
  return { context: read('context.md'), lyrics: song ? song.replace(/^---[\s\S]*?\n---/, '') : null };
}

async function loadRecord() {
  const [lines, attendance] = await Promise.all([allLines(), loadAttendance()]);
  return sd.prepare({ lines, reflections: attendance.reflections || [] });
}

async function readWeek(key) {
  return safeReadJSON(path.join(STORE(), `${key}.json`), null);
}

/** Write every finished week since the log began that has no file yet. */
async function writeWeeks(s, { now = Date.now() } = {}) {
  await fs.mkdir(STORE(), { recursive: true });
  const written = [];
  if (s.logStart === null) return written;
  for (let week = weekOf(s.logStart); week.to <= now; week = weekOf(week.to)) {
    const file = path.join(STORE(), `${week.key}.json`);
    if (await readWeek(week.key)) continue;
    const span = { from: week.from, to: week.to };
    const snapshot = {
      series: sd.SERIES,
      week: week.key,
      from: new Date(week.from).toISOString(),
      to: new Date(week.to).toISOString(),
      computedAt: new Date(now).toISOString(),
      addressed: sd.addressedReading(s, span),
      named: sd.namedReading(s, { ...span, asOf: week.to, songText }),
    };
    await fs.writeFile(file, JSON.stringify(snapshot, null, 2));
    written.push(week.key);
  }
  return written;
}

/** The reading of the whole record to now. */
async function buildReading(s, { now = Date.now() } = {}) {
  let names = [];
  try { names = (await fs.readdir(STORE())).filter(f => /^\d{4}-W\d{2}\.json$/.test(f)).sort(); } catch { /* none yet */ }
  const weeks = [];
  for (const name of names) {
    const week = await safeReadJSON(path.join(STORE(), name), null);
    if (week && week.series === sd.SERIES) weeks.push(week);
  }
  const current = weekOf(now);
  const addressed = sd.combineAddressed([...weeks.map(w => w.addressed), sd.addressedReading(s, { from: current.from, to: now + 1 })]);
  const named = sd.namedReading(s, { from: 0, to: now + 1, asOf: now, songText });
  const series = weeks.map(w => ({ week: w.week, arrived: w.named.funnel.arrived, reflections: w.named.memory.reflections, measurable: Boolean(w.addressed && w.addressed.measurable) }));
  return {
    series: sd.SERIES,
    computedAt: new Date(now).toISOString(),
    logStart: s.logStart === null ? null : new Date(s.logStart).toISOString().slice(0, 10),
    ...named,
    addressed: withoutSealed(addressed),
    capabilities: sd.capabilities(named, addressed),
    experiments: sd.experimentsReading(s, addressed, { asOf: now, songText, now }),
    weeks: series,
  };
}

// Sealed counts stay in the weekly files until a test's reading date, when
// experimentsReading reads them; a reading never carries them.
function withoutSealed({ sealed, ...rest }) {
  return rest;
}

async function refresh({ now = Date.now() } = {}) {
  const s = await loadRecord();
  const written = await writeWeeks(s, { now });
  const reading = await buildReading(s, { now });
  await fs.mkdir(STORE(), { recursive: true });
  await fs.writeFile(`${LATEST()}.tmp`, JSON.stringify(reading, null, 2));
  await fs.rename(`${LATEST()}.tmp`, LATEST());
  cached = { reading, at: now };
  return { written, reading };
}

let cached = null;

/** The latest reading, or null before the first has been taken. */
async function latestReading({ now = Date.now() } = {}) {
  if (cached && now - cached.at < 5 * 60 * 1000) return cached.reading;
  const reading = await safeReadJSON(LATEST(), null);
  cached = { reading, at: now };
  return reading;
}

function startStudy({ log = console, firstAfterMs = 2 * 60 * 1000, everyMs = 6 * 60 * 60 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { written } = await refresh();
      if (written.length) log.log(`[study] weekly counts written: ${written.join(', ')}`);
    } catch (err) {
      log.error(`[study] reading failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, firstAfterMs).unref();
  setInterval(run, everyMs).unref();
}

module.exports = { weekOf, loadRecord, writeWeeks, buildReading, refresh, latestReading, startStudy, songText, STORE };
