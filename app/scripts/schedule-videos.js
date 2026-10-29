#!/usr/bin/env node
/**
 * Places the rendered videos in the release schedule and gets each ready for
 * the release job, on the machine that rendered them:
 *
 *   npm run schedule              place what is rendered and not yet placed
 *   npm run schedule -- --dry-run where each would go; nothing uploaded or written
 *   npm run schedule -- --show    the schedule, and what has gone out
 *   npm run schedule -- --replan  place again every video not yet uploaded to
 *                                 YouTube, after the rules change
 *
 * For each video placed: its words for every platform (prepare.js, the copy
 * written once by Claude), its cuts for Bluesky and X (cut.js), the video,
 * the cuts and its Short (lib/video/short.js) uploaded to S3 under
 * video/<slug>/, and its release record written in
 * video/releases/<slug>.json with its hour and the Short's passage. A placed
 * video without its Short gets just that, and each its poster for its page
 * (lib/video/on-site.js). Commit and push video/ and the posters after: the
 * hourly job (release-videos.js, .github/workflows/release-videos.yml) reads
 * the records from the repository, uploads each video to YouTube a day ahead
 * to go public at its hour and its Short an hour after, and posts the video
 * to Bluesky and X then.
 *
 * Occasions: the days in the coming five weeks a video can belong to (full
 * and new moons, meteor showers, solstices, Mercury's retrograde, shared
 * observances, a forecast geomagnetic storm; lib/video/occasions.js) are
 * offered with the videos to place, Claude pairs the true fits
 * (occasion-match.js), and a paired video goes out inside its occasion with
 * a line in its description that names it without a date. Each pairing and
 * its reason is printed.
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
const { pieceFor, pieceText } = require('../server/lib/video/pieces');
const { prepare, renderedVideo } = require('../server/lib/video/publish/prepare');
const { cutFor } = require('../server/lib/video/publish/cut');
const { allRecords, updateRecord, RELEASES_DIR } = require('../server/lib/video/publish/record');
const { makePoster, POSTER_DIR } = require('../server/lib/video/on-site');
const { uploadObject } = require('../server/lib/audio/storage');
const { plan, TZ } = require('../server/lib/video/schedule');
const { occasionsBetween, addDays } = require('../server/lib/video/occasions');
const { matchOccasions } = require('../server/lib/video/occasion-match');
const { fetchSpaceWeather } = require('../server/lib/utils/space-weather');
const bluesky = require('../server/lib/video/publish/bluesky');
const x = require('../server/lib/video/publish/x');

const ROOT = path.join(__dirname, '../..');
const SCHEDULE_FILE = path.join(RELEASES_DIR, '..', 'schedule.json');
const RUNWAY_DAYS = 14;
// How far ahead occasions are offered: about as far as one batch fills.
const OCCASION_DAYS = 35;

function parseArgs(argv) {
  const opts = { dryRun: false, show: false, replan: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--show') opts.show = true;
    else if (arg === '--replan') opts.replan = true;
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
  const known = new Set(records.filter(r => r.slot || r.youtube).map(r => r.slug));
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

// The video, its cuts and its Short in S3, by name; a cut that is the video
// itself is the same object. Those already there (`have`) are kept.
async function upload(slug, { file, short }, log, have = {}) {
  const files = { youtube: file, short };
  if (!have.bluesky) files.bluesky = (await cutFor(file, bluesky.LIMITS)).file;
  if (!have.x) files.x = (await cutFor(file, await x.limits())).file;
  for (const platform of Object.keys(have)) delete files[platform];
  const keys = { ...have };
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
    const state = ['youtube', 'short', 'bluesky', 'x'].map(p => `${p} ${r[p]?.url ? 'posted' : r[p]?.started ? 'STARTED' : r[p]?.id ? 'uploaded' : '-'}`).join(', ');
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
  // Replanning lets go of every slot YouTube does not hold yet; those videos
  // keep their files and words, and are placed again with the rest.
  const kept = opts.replan ? records.filter(r => r.youtube || !r.slot) : records;
  if (opts.replan && !opts.dryRun) {
    for (const r of records.filter(r => !kept.includes(r))) await updateRecord(r.slug, { slot: null, at: null });
  }
  const about = new Map();
  const candidates = unplaced(kept).map(slug => {
    const piece = pieceFor(slug);
    const data = frontmatterOf(piece);
    const brief = JSON.parse(fs.readFileSync(path.join(VIDEO_DIR, slug, 'brief.json'), 'utf8'));
    const { title, text } = pieceText(piece);
    about.set(slug, { slug, kind: piece.kind, title, about: (data.tldr || text).replace(/\s+/g, ' ').slice(0, 500), mood: brief.mood });
    return { slug, kind: piece.kind, reflections: counts[slug] || 0, rerelease: Boolean(piece.song && data.youtube), hours: parseHours(data.hours) };
  });
  const today = localTime(TZ).date;
  const occasions = occasionsBetween(today, addDays(today, OCCASION_DAYS), { spaceWeather: await fetchSpaceWeather() });
  const pairs = await matchOccasions(occasions, [...about.values()]);
  for (const p of pairs) console.log(`[${p.slug}] for ${p.occasion.name} (${p.occasion.from === p.occasion.to ? p.occasion.from : `${p.occasion.from} to ${p.occasion.to}`}): ${p.why}`);
  const occasionOf = new Map(occasions.map(o => [o.id, o]));
  const { placed, waiting } = plan({ start, now: new Date(), placed: kept, candidates, pairs });
  const ready = new Map(records.filter(r => r.files && r.meta).map(r => [r.slug, r]));
  if (!placed.length) console.log('Nothing new to place.');
  // Videos placed before they had Shorts: just the Short, into S3. One put on
  // YouTube by hand (its record holds "short") needs none.
  for (const r of records.filter(r => r.slot && r.files && !r.files.short && !r.short)) {
    const log = (m) => console.log(`[${r.slug}] ${m}`);
    try {
      const { file, short, passage } = renderedVideo(r.slug);
      log(`its Short, ${passage.start.toFixed(1)}s to ${passage.end.toFixed(1)}s`);
      if (opts.dryRun) continue;
      await updateRecord(r.slug, { files: await upload(r.slug, { file, short }, log, r.files), passage });
    } catch (err) {
      log(`its Short: ${describeError(err)}`);
      process.exitCode = 1;
    }
  }
  for (const p of placed) {
    const log = (m) => console.log(`[${p.slug}] ${m}`);
    const occasion = p.occasion ? occasionOf.get(p.occasion) : null;
    log(`week ${p.week + 1}, ${formatLocal(p.at, TZ)}${occasion ? `, for ${occasion.name}` : ''}`);
    if (opts.dryRun) continue;
    const kept = occasion ? { id: occasion.id, key: occasion.key, name: occasion.name } : null;
    if (ready.has(p.slug)) {
      // Its words name its occasion, so a new one (or none) rewrites them.
      const was = ready.get(p.slug).occasion;
      const changed = ((was && was.key) || null) !== ((kept && kept.key) || null);
      try {
        const fresh = changed ? { meta: (await prepare(p.slug, { occasion })).meta } : {};
        await updateRecord(p.slug, { slot: p.slot, at: p.at, occasion: kept, ...fresh });
      } catch (err) {
        log(`failed: ${describeError(err)}`);
        process.exitCode = 1;
      }
      continue;
    }
    try {
      const { piece, file, short, passage, meta } = await prepare(p.slug, { occasion });
      const files = await upload(p.slug, { file, short }, log);
      await updateRecord(p.slug, { slug: p.slug, kind: piece.kind, slot: p.slot, at: p.at, occasion: kept, files, passage, meta });
    } catch (err) {
      log(`failed: ${describeError(err)}`);
      process.exitCode = 1;
    }
  }
  // Each placed video's poster, for its page once it is public
  // (lib/video/on-site.js), from the video rendered here. Committed with the
  // records, so it is in place before the release job makes the video public.
  for (const r of await allRecords()) {
    if (!(r.slot || r.youtube) || fs.existsSync(path.join(POSTER_DIR, `${r.slug}.jpg`))) continue;
    const log = (m) => console.log(`[${r.slug}] ${m}`);
    if (opts.dryRun) { log('would make its poster'); continue; }
    try {
      await makePoster(renderedVideo(r.slug).file, r.slug);
      log('its poster made');
    } catch (err) {
      log(`its poster: ${describeError(err)}`);
      process.exitCode = 1;
    }
  }
  if (waiting.length) console.log(`Waiting for week 13, when songs that had music videos may return: ${waiting.join(', ')}`);
  if (!opts.dryRun) {
    show(await allRecords());
    if (placed.length) console.log('\nCommit and push video/ and the posters (app/client/public/assets/video/) so the release job and the pages see them.');
  }
}

main().catch(err => {
  console.error(describeError(err));
  process.exit(1);
});
