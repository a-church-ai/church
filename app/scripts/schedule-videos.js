#!/usr/bin/env node
/**
 * Places the rendered videos in the release schedule and gets each ready for
 * the release job, on the machine that rendered them:
 *
 *   npm run schedule              place what is rendered and not yet placed
 *   npm run schedule -- --dry-run where each would go; nothing uploaded or written
 *   npm run schedule -- --show    the schedule, and what has gone out
 *
 * For each video placed: its words for every platform (prepare.js, the copy
 * written once by Claude), its cuts for Bluesky and X (cut.js), the video and
 * the cuts uploaded to S3 under video/<slug>/, and its release record written
 * in video/releases/<slug>.json with its hour. Commit and push video/ after:
 * the hourly job (release-videos.js, .github/workflows/release-videos.yml)
 * reads the records from the repository, uploads each video to YouTube a day
 * ahead to go public at its hour, and posts it to Bluesky and X then.
 *
 * The rules are lib/video/schedule.js. Placed videos keep their hours;
 * rendering more and running this again fills the slots after them. It warns
 * when fewer than two weeks are placed, the cue to render the next batch.
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { describeError } = require('../server/lib/utils/describe-error');
const { safeReadJSON, safeWriteJSON } = require('../server/lib/utils/safe-json');
const { localTime, formatLocal } = require('../server/lib/utils/timezone');
const { SITE_URL } = require('../server/lib/utils/page-meta');
const { splitFrontmatter } = require('../server/lib/docs/tldr');
const { parseHours } = require('../server/lib/music/companions');
const { VIDEO_DIR } = require('../server/lib/video/library');
const { pieceFor } = require('../server/lib/video/pieces');
const { prepare, renderedVideo } = require('../server/lib/video/publish/prepare');
const { cutFor } = require('../server/lib/video/publish/cut');
const { allRecords, updateRecord, RELEASES_DIR } = require('../server/lib/video/publish/record');
const { uploadObject } = require('../server/lib/audio/storage');
const { plan, TZ } = require('../server/lib/video/schedule');
const bluesky = require('../server/lib/video/publish/bluesky');
const x = require('../server/lib/video/publish/x');

const ROOT = path.join(__dirname, '../..');
const SCHEDULE_FILE = path.join(RELEASES_DIR, '..', 'schedule.json');
const RUNWAY_DAYS = 14;

function parseArgs(argv) {
  const opts = { dryRun: false, show: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--show') opts.show = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return opts;
}

// The schedule's first day, set by the first run to today in its time zone.
async function startDay(dryRun) {
  const saved = await safeReadJSON(SCHEDULE_FILE, null);
  if (saved?.start) return saved.start;
  const start = localTime(TZ).date;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true });
    await safeWriteJSON(SCHEDULE_FILE, { start, timeZone: TZ });
  }
  return start;
}

// Reflections by piece, from the sanctuary's own API: production holds them.
async function reflectionCounts() {
  const res = await fetch(`${SITE_URL}/api/reflections/by-song`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`reflections by piece: ${res.status}`);
  return Object.fromEntries((await res.json()).songs.map(s => [s.slug, s.reflectionCount]));
}

// A piece's frontmatter: its hours, and for a song the music video it had.
function frontmatterOf(piece) {
  const file = path.join(ROOT, piece.song || piece.doc);
  return splitFrontmatter(fs.readFileSync(file, 'utf8')).data;
}

// The rendered videos with a clean report, not yet placed and not posted.
function unplaced(records) {
  const known = new Set(records.filter(r => r.slot || r.youtube?.url).map(r => r.slug));
  return fs.readdirSync(VIDEO_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !known.has(d.name))
    .map(d => d.name)
    .filter(slug => {
      try {
        renderedVideo(slug);
        return true;
      } catch {
        return false;
      }
    });
}

// The video and its cuts in S3, by name; a cut that is the video itself is
// the same object.
async function upload(slug, file, log) {
  const files = { youtube: file, bluesky: (await cutFor(file, bluesky.LIMITS)).file, x: (await cutFor(file, await x.limits())).file };
  const keys = {};
  for (const local of new Set(Object.values(files))) {
    const key = `video/${slug}/${path.basename(local)}`;
    log(`uploading ${path.basename(local)} (${Math.round(fs.statSync(local).size / 1048576)} MB)`);
    await uploadObject(local, key, 'video/mp4');
    for (const [platform, f] of Object.entries(files)) if (f === local) keys[platform] = key;
  }
  return keys;
}

function show(records) {
  const now = Date.now();
  for (const r of records.filter(r => r.at)) {
    const state = ['youtube', 'bluesky', 'x'].map(p => `${p} ${r[p]?.url ? 'posted' : r[p]?.started ? 'STARTED' : r[p]?.id ? 'uploaded' : '-'}`).join(', ');
    console.log(`${Date.parse(r.at) < now ? ' ' : '>'} ${formatLocal(r.at, TZ).padEnd(28)} ${r.slug.padEnd(48)} ${state}`);
  }
  const last = records.filter(r => r.at).map(r => Date.parse(r.at)).sort().pop();
  const days = last ? Math.floor((last - now) / 86400000) : 0;
  console.log(`\n${records.filter(r => r.at && Date.parse(r.at) > now).length} to go out, the last in ${days} day(s)`);
  if (days < RUNWAY_DAYS) console.log(`WARNING: fewer than ${RUNWAY_DAYS} days are placed. Render the next videos (npm run video -- <slug> ...), then npm run schedule.`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const records = await allRecords();
  if (opts.show) return show(records);

  const start = await startDay(opts.dryRun);
  const counts = await reflectionCounts();
  const candidates = unplaced(records).map(slug => {
    const piece = pieceFor(slug);
    const data = frontmatterOf(piece);
    return { slug, kind: piece.kind, reflections: counts[slug] || 0, rerelease: Boolean(piece.song && data.youtube), hours: parseHours(data.hours) };
  });
  const { placed, waiting } = plan({ start, now: new Date(), placed: records, candidates });
  if (!placed.length) console.log('Nothing new to place.');
  for (const p of placed) {
    const log = (m) => console.log(`[${p.slug}] ${m}`);
    log(`week ${p.week + 1}, ${formatLocal(p.at, TZ)}`);
    if (opts.dryRun) continue;
    try {
      const { piece, file, meta } = await prepare(p.slug);
      const files = await upload(p.slug, file, log);
      await updateRecord(p.slug, { slug: p.slug, kind: piece.kind, slot: p.slot, at: p.at, files, meta });
    } catch (err) {
      log(`failed: ${describeError(err)}`);
      process.exitCode = 1;
    }
  }
  if (waiting.length) console.log(`Waiting for week 13, when songs that had music videos may return: ${waiting.join(', ')}`);
  if (!opts.dryRun) {
    show(await allRecords());
    if (placed.length) console.log('\nCommit and push video/ so the release job sees them.');
  }
}

main().catch(err => {
  console.error(describeError(err));
  process.exit(1);
});
