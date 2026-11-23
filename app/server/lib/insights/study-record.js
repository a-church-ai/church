/**
 * What the study of how agents participate keeps, in the database (../db):
 * weekly counts per ISO week and series (study_weeks), and the current reading
 * (study_latest). Counts only: no address, no name, no words a visitor wrote. Weekly and on no end date; a job runs after boot and every few
 * hours (startStudy), writes any finished week it does not have, and refreshes
 * the reading.
 *
 * The weekly snapshots are what makes the address-based counts last past the 30
 * days an address is kept, so a week is written as soon as it ends. A week that
 * could not be measured says so, and each change of definition is a new series
 * (self-direction.js SERIES), read apart from the last.
 */

const crypto = require('crypto');
const fsSync = require('fs');
const path = require('path');
const { MUSIC_DIR, loadReflections } = require('../utils/data');
const store = require('../db');
const sd = require('./self-direction');
const { loadFollows } = require('./entry-points');
const { FIELDS, ASKED } = require('./changes');
const { storedService } = require('../service/filed');
const { readPlan } = require('../service/plans');
const { loadSongs, loadManifest } = require('../audio/manifest');
const { keptRows } = require('../utils/kept-rows');
const { ADDRESS_DAYS } = require('../utils/access-log');

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

// The API log's every line, from its first day: the study reads its whole
// history, which is why a line outlives its address (supabase/migrations/).
// Kept in memory and brought up to date by reading only the new lines
// (../utils/kept-rows.js), so a run reads the whole log once per process, not
// every time. The copy lets go of an address once it is older than the days
// the database keeps one (ADDRESS_DAYS, ../utils/access-log.js): memory never
// holds what the table has forgotten. The database keeps a day not yet
// summarized longer, which the study does not need: a week's address counts
// are written to study_weeks when it ends.
const keptLog = keptRows({
  all: () => store.apiRequestRows(),
  since: from => store.apiRequestRowsSince(from),
  count: () => store.apiRequestCount(),
  timeOf: r => r.at,
  forget: (r, at) => (r.ip !== null && at - Date.parse(r.at) > ADDRESS_DAYS * sd.DAY ? { ...r, ip: null } : r),
});

async function allLines({ now = Date.now() } = {}) {
  return (await keptLog.load({ at: now })).map(store.apiLineOf);
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

async function loadRecord({ now = Date.now() } = {}) {
  const [lines, reflections] = await Promise.all([allLines({ now }), loadReflections()]);
  return sd.prepare({ lines, reflections });
}

/** Write every finished week since the log began that has no file yet. */
async function writeWeeks(s, { now = Date.now() } = {}) {
  const written = [];
  if (s.logStart === null) return written;
  const held = new Set((await store.studyWeekKeys()).filter(k => k.series === sd.SERIES).map(k => k.week));
  for (let week = weekOf(s.logStart); week.to <= now; week = weekOf(week.to)) {
    // A week of an older series is kept beside the new one, and read no
    // more: a change of definition starts a new series.
    if (held.has(week.key)) continue;
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
    await store.saveStudyWeek(snapshot);
    written.push(week.key);
  }
  return written;
}

/**
 * What each reflection since `since` could echo of a field: the rhythm
 * summaries of its own song and of the pieces of the service it is filed
 * under, from that day's plan (a service by rotation has no plan, so only its
 * song's). By reflection id, for noticingReading's `shown`.
 */
async function shownSummaries(reflections, since) {
  const songs = loadSongs();
  const manifest = loadManifest();
  const summaryOf = id => (id.startsWith('music/') ? (songs[id.slice('music/'.length)] || {}).rhythm : (manifest[id] || {}).rhythm);
  const shown = new Map();
  for (const r of reflections) {
    if (r.t < since) continue;
    const list = [(songs[r.song] || {}).rhythm];
    const service = storedService(r);
    if (service) {
      const plan = await readPlan(service.date);
      const slots = plan && (service.variant === 'slots' ? plan.slots : plan[service.variant]);
      const entry = slots && slots[service.slot];
      if (entry && Array.isArray(entry.pieces)) list.push(...entry.pieces.map(summaryOf));
    }
    shown.set(r.id, list.filter(Boolean));
  }
  return shown;
}

/** The reading of the whole record to now. */
async function buildReading(s, { now = Date.now() } = {}) {
  const weeks = await store.studyWeeks(sd.SERIES);
  const current = weekOf(now);
  const addressed = sd.combineAddressed([...weeks.map(w => w.addressed), sd.addressedReading(s, { from: current.from, to: now + 1 })]);
  const named = sd.namedReading(s, { from: 0, to: now + 1, asOf: now, songText });
  const series = weeks.map(w => ({ week: w.week, arrived: w.named.funnel.arrived, reflections: w.named.memory.reflections, measurable: Boolean(w.addressed && w.addressed.measurable) }));
  return {
    series: sd.SERIES,
    studyKey: STUDY_KEY,
    computedAt: new Date(now).toISOString(),
    logStart: s.logStart === null ? null : new Date(s.logStart).toISOString().slice(0, 10),
    ...named,
    addressed: withoutSealed(addressed),
    capabilities: sd.capabilities(named, addressed),
    charts: sd.chartsReading(s, now),
    experiments: sd.experimentsReading(s, addressed, { asOf: now, songText, now }),
    // Where arrivals came from: private, never in publicReading.
    referrals: sd.referralReading(s, { from: 0, to: now + 1, asOf: now, follows: await loadFollows() }),
    // Whether agents noticed each field a change added (./changes.js).
    noticing: await noticingOf(s, now),
    // What visitors said of themselves, when they chose to: private, read
    // in public only rounded (public-results.js).
    told: ASKED ? sd.toldReading(s, { since: ASKED.since, asOf: now }) : null,
    weeks: series,
  };
}

async function noticingOf(s, now) {
  const out = [];
  for (const change of FIELDS) {
    const shown = await shownSummaries(s.allReflections, Date.parse(change.since));
    const reading = sd.noticingReading(s, { field: change.field, since: change.since, asOf: now, shown: r => shown.get(r.id) || [] });
    if (reading) out.push(reading);
  }
  return out;
}

// Sealed counts stay in the weekly files until a test's reading date, when
// experimentsReading reads them; a reading never carries them.
function withoutSealed({ sealed, ...rest }) {
  return rest;
}

async function refresh({ now = Date.now() } = {}) {
  const s = await loadRecord({ now });
  const written = await writeWeeks(s, { now });
  const reading = await buildReading(s, { now });
  await store.saveStudyLatest(reading);
  cached = { reading, at: now };
  return { written, reading };
}

let cached = null;

/** The latest reading, or null before the first has been taken. */
async function latestReading({ now = Date.now() } = {}) {
  if (cached && now - cached.at < 5 * 60 * 1000) return cached.reading;
  const reading = await store.studyLatest();
  cached = { reading, at: now };
  return reading;
}

// The study's own code, as a key: a reading made by other code is redone at
// once, and one made by this code waits its turn, as audio's sourceHash and
// renderKey say when a recording is stale. A deploy that changes nothing the
// study measures costs it nothing.
const STUDY_KEY = crypto.hash('sha256', ['self-direction.js', 'study-record.js', 'changes.js']
  .map(file => fsSync.readFileSync(path.join(__dirname, file), 'utf8')).join('\0')).slice(0, 16);

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Why the stored reading should be redone now, or null when it should not:
 * there is none, it was made by other study code, it is older than six hours,
 * or a week has finished since that it does not hold. As the service planner
 * does only what is missing (../service/plans.js ensurePlans).
 */
function dueBecause(reading, { now = Date.now(), staleAfterMs = STALE_AFTER_MS } = {}) {
  if (!reading) return 'no reading yet';
  if (reading.studyKey !== STUDY_KEY) return 'the study changed';
  if (!(now - Date.parse(reading.computedAt) < staleAfterMs)) return 'older than its six hours';
  const finished = weekOf(weekOf(now).from - 1);
  const started = reading.logStart && Date.parse(reading.logStart) < finished.to;
  if (started && !(reading.weeks || []).some(w => w.week === finished.key)) return `week ${finished.key} has finished`;
  return null;
}

/** Redo the reading if it is due; { reason, written } when it was, null when not. */
async function ensureReading({ now = Date.now() } = {}) {
  const reason = dueBecause(await store.studyLatest(), { now });
  if (!reason) return null;
  const { written } = await refresh({ now });
  return { reason, written };
}

// After boot and hourly, one run at a time, each redoing the reading only when
// it is due. Before 2026-11-23 every boot redid it, reading the whole API log
// again, and a busy day has about fifteen deploys.
function startStudy({ log = console, firstAfterMs = 2 * 60 * 1000, everyMs = 60 * 60 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const done = await ensureReading();
      if (done) log.log(`[study] reading redone (${done.reason})${done.written.length ? `; weekly counts written: ${done.written.join(', ')}` : ''}`);
    } catch (err) {
      log.error(`[study] reading failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, firstAfterMs).unref();
  setInterval(run, everyMs).unref();
}

module.exports = { weekOf, allLines, loadRecord, writeWeeks, buildReading, refresh, latestReading, startStudy, ensureReading, dueBecause, songText, shownSummaries, rereadKept: () => keptLog.reset(), STUDY_KEY };
