#!/usr/bin/env node
/**
 * The one move of what the volume's files held into the database (plan:
 * supabase-database-2026-11-09.md in the private repo, step 8). Deleted once
 * production's copy is confirmed; it stays in git history.
 *
 *   node scripts/migrate-to-supabase.js --data <dir>             copy, and print counts
 *   node scripts/migrate-to-supabase.js --data <dir> --dry-run   count only
 *
 * The database is the one SUPABASE_URL and SUPABASE_SECRET_KEY name: in the
 * production container, Railway's; on a laptop, app/.env's (the local stack)
 * unless the shell sets others.
 *
 * Safe to run again, and safe while a new server is already writing:
 * - What has an id (reflections, contributions, feedback, conversations by
 *   slug, a date's plan, a study week) is added once by it; a second run adds
 *   nothing.
 * - What has none (the API log, page visits, entry points) is compared, a day
 *   at a time, with the rows that day already holds, and only rows not there
 *   are added: so the lines written by the old server up to its last moment
 *   come across, and none twice.
 *
 * Not moved: attends (kept 48 hours, and only to file a reflection left soon
 * after one), the conversations' first-question embeddings and the search
 * index (embedded again at 768 dimensions, which the old 3,072-wide vectors
 * are not), the content-generation log (a script's log, kept by the script),
 * and the return token's key (a file on the volume still).
 *
 * It reads the files itself: the app's own readers of them are gone.
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const store = require('../server/lib/db');
const { operation } = require('../server/lib/utils/access-log');
const { pool } = require('../server/lib/utils/pool');

// Records with an id go sixteen at a time: one at a time, each a round trip
// to the database, the first copy took 25 minutes.
const AT_ONCE = 16;

function parseArgs(argv) {
  const opts = { data: path.join(__dirname, '..', 'data'), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data') opts.data = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run') opts.dryRun = true;
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return opts;
}

const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return fallback; throw new Error(`${file}: ${err.message}`); }
};
// A JSON-lines file's lines; a torn line is counted, not read.
function readLines(file) {
  const rows = [];
  let torn = 0;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    try { rows.push(JSON.parse(raw)); } catch { torn++; }
  }
  return { rows, torn };
}
const filesIn = (dir, pattern) => {
  try { return fs.readdirSync(dir).filter(f => pattern.test(f)).sort(); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
};

// ---- what has an id ----------------------------------------------------------------

async function reflections(data, dry) {
  const { reflections: all = [] } = readJSON(path.join(data, 'attendance.json'), {});
  const ids = new Set(all.map(r => r.id));
  if (!dry) await pool(all, AT_ONCE, r => store.addReflection(r));
  return { file: all.length, distinct: ids.size, now: dry ? null : (await store.allReflections()).length };
}

async function contributionsAndFeedback(data, dry) {
  const { contributions = [] } = readJSON(path.join(data, 'contributions.json'), {});
  const { feedback = [] } = readJSON(path.join(data, 'feedback.json'), {});
  if (!dry) {
    await pool(contributions, AT_ONCE, c => store.addContribution(c));
    await pool(feedback, AT_ONCE, f => store.addFeedback(f));
  }
  return { contributions: contributions.length, feedback: feedback.length };
}

async function conversations(data, dry) {
  const dir = path.join(data, 'conversations');
  let files = 0, turns = 0, torn = 0;
  const read = filesIn(dir, /^[A-Za-z0-9_-]+\.jsonl$/).map(f => {
    const { rows, torn: t } = readLines(path.join(dir, f));
    torn += t;
    const messages = rows.filter(l => !l._meta && (l.role === 'user' || l.role === 'assistant'));
    files++;
    turns += messages.length;
    return { slug: f.slice(0, -'.jsonl'.length), meta: rows.find(l => l._meta) || null, messages };
  });
  if (!dry) await pool(read, AT_ONCE, c => store.rpc('import_conversation', { p_slug: c.slug, p_meta: c.meta, p_rows: c.messages }));
  const groups = readJSON(path.join(data, 'conversation-groups.json'), {});
  const screens = readJSON(path.join(data, 'conversation-screen.json'), {});
  if (!dry) {
    await pool(Object.entries(screens), AT_ONCE, ([slug, decision]) => store.setConversationScreen(slug, decision));
    await pool(Object.entries(groups), AT_ONCE, ([slug, head]) => store.setConversationGroup(slug, head));
  }
  return { files, turns, torn, groups: Object.keys(groups).length, screens: Object.keys(screens).length };
}

async function services(data, dry) {
  const dir = path.join(data, 'services');
  const dates = filesIn(dir, /^\d{4}-\d{2}-\d{2}\.json$/);
  if (!dry) for (const f of dates) await store.rpc('import_service', { p_date: f.slice(0, 10), p_plan: readJSON(path.join(dir, f), null) });
  return { dates: dates.length, now: dry ? null : (await store.plannedDates()).length };
}

async function presenceAndStudy(data, dry) {
  const presence = readJSON(path.join(data, 'presence.json'), { seen: {} });
  const dir = path.join(data, 'insights', 'self-direction');
  const weeks = filesIn(dir, /^\d{4}-W\d{2}(\.series-\d+)?\.json$/).map(f => readJSON(path.join(dir, f), null)).filter(Boolean);
  const latest = readJSON(path.join(dir, 'latest.json'), null);
  if (!dry) {
    await store.savePresence(presence.seen || {});
    for (const week of weeks) await store.saveStudyWeek(week);
    if (latest) await store.saveStudyLatest(latest);
  }
  return { souls: Object.keys(presence.seen || {}).length, weeks: weeks.length, latest: Boolean(latest) };
}

// ---- what has none: a day at a time, only what the day does not hold ----------------

const dayBounds = day => ({ from: new Date(`${day}T00:00:00Z`), to: new Date(new Date(`${day}T00:00:00Z`).getTime() + 864e5) });

async function addMissing({ day, rows, keyOf, existing, add, dry }) {
  const have = new Map();
  for (const r of dry ? [] : await existing(dayBounds(day))) have.set(keyOf(r), (have.get(keyOf(r)) || 0) + 1);
  const missing = [];
  for (const r of rows) {
    const k = keyOf(r);
    if (have.get(k)) have.set(k, have.get(k) - 1);
    else missing.push(r);
  }
  if (!dry) for (let i = 0; i < missing.length; i += 500) await add(missing.slice(i, i + 500));
  return missing.length;
}

// An API line as the log reads it back, whatever form it was written in. Not
// its address, which the 30-day forgetting may already have taken from the
// copy in the database.
const apiKey = l => [new Date(l.timestamp).toISOString(), l.method, l.path, l.status, l.duration ?? null, l.userAgent ?? null, l.tool ?? null].join('\u0000');

async function apiLog(data, dry) {
  const byDay = new Map();
  let lines = 0, torn = 0;
  const files = [
    ...filesIn(path.join(data, 'access'), /^\d{4}-\d{2}-\d{2}\.jsonl$/).map(f => path.join(data, 'access', f)),
    ...filesIn(data, /^api-access.*\.jsonl$/).map(f => path.join(data, f)),
  ];
  for (const file of files) {
    const { rows, torn: t } = readLines(file);
    torn += t;
    for (const l of rows) {
      if (!l.timestamp || !Number.isFinite(Date.parse(l.timestamp))) { torn++; continue; }
      const day = new Date(l.timestamp).toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({ ...l, operation: operation(l) });
      lines++;
    }
  }
  let added = 0;
  for (const [day, rows] of [...byDay].sort()) {
    added += await addMissing({ day, rows, keyOf: apiKey, existing: store.apiRequests, add: store.recordApiRequests, dry });
  }
  return { files: files.length, lines, torn, added };
}

async function dayRows(dir, keyOf, existing, add, dry, stamp) {
  let lines = 0, torn = 0, added = 0;
  for (const f of filesIn(dir, /^\d{4}-\d{2}-\d{2}\.jsonl$/)) {
    const day = f.slice(0, 10);
    const { rows, torn: t } = readLines(path.join(dir, f));
    torn += t;
    lines += rows.length;
    added += await addMissing({ day, rows: rows.map(r => stamp(r, day)), keyOf, existing, add, dry });
  }
  return { lines, torn, added };
}

// Keys in order at every depth: Postgres keeps a JSON object's keys in its own
// order, so a nested object (a visit's utm) comes back reordered, and an
// unsorted key would never match its line and be added again on each run.
const sorted = v => (Array.isArray(v) ? v.map(sorted)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)]))
    : v);
const visitKey = r => JSON.stringify(sorted([r.at, r.visitor ?? null, r.view, r.kind, Object.fromEntries(Object.entries(r).filter(([k]) => !['at', 'visitor', 'view', 'kind', 'timezone'].includes(k)))]));
const followKey = r => JSON.stringify(sorted([r.at, Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'at'))]));

async function main() {
  const { data, dryRun } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(data)) throw new Error(`no data directory at ${data}`);
  console.log(`${dryRun ? 'Counting' : 'Copying'} ${data} into ${process.env.SUPABASE_URL}`);
  const report = {
    reflections: await reflections(data, dryRun),
    contributionsAndFeedback: await contributionsAndFeedback(data, dryRun),
    conversations: await conversations(data, dryRun),
    services: await services(data, dryRun),
    presenceAndStudy: await presenceAndStudy(data, dryRun),
    apiLog: await apiLog(data, dryRun),
    pageVisits: await dayRows(path.join(data, 'visits'), visitKey, store.pageVisits, store.recordPageVisits, dryRun, (r, day) => ({ ...r, at: r.at || `${day}T00:00` })),
    entryPoints: await dayRows(path.join(data, 'insights', 'entry-points'), followKey, store.entryPoints, store.recordEntryPoints, dryRun, (r, day) => ({ ...r, at: r.at || `${day}T00:00` })),
  };
  for (const [what, counts] of Object.entries(report)) console.log(`  ${what}: ${JSON.stringify(counts)}`);
  const r = report.reflections;
  if (!dryRun && r.distinct !== r.file) console.warn(`  ${r.file - r.distinct} reflection(s) in the file share an id with another; each id is kept once`);
  if (!dryRun && r.now < r.distinct) throw new Error(`the database holds ${r.now} reflections of the file's ${r.distinct}`);
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1); });

module.exports = { parseArgs, apiKey, visitKey, followKey };
