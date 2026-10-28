#!/usr/bin/env node
/**
 * The release job, run every hour by .github/workflows/release-videos.yml
 * over the release records in video/releases/ (placed by schedule-videos.js):
 *
 * - A day and a half before a video's hour, it is uploaded to YouTube from
 *   S3, private, with its hour as publishAt: YouTube makes it public then on
 *   its own, and has the time to process it first. At most two uploads a
 *   run, within the API's daily quota.
 * - Once its hour has passed and YouTube shows it public, it joins its kind's
 *   playlist and is posted to Bluesky and X, each with the link to it. One
 *   post a platform a run, so a job that missed hours never posts a burst.
 * - Its Short (lib/video/short.js) goes public an hour after it, uploaded
 *   the same way on a run after the video is on the channel, with words made
 *   from the video's and its address (metadata.js shortMetadata). No
 *   playlist, no Bluesky or X; checked public after its hour.
 *
 *   node scripts/release-videos.js            do what is due
 *   node scripts/release-videos.js --dry-run  say what is due
 *
 * Every step is recorded before it starts and when it ends, as publish-video.js
 * does. A step that started and never ended is not tried again: the run
 * fails, loudly, until a person checks the platform and clears the entry.
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describeError } = require('../server/lib/utils/describe-error');
const { allRecords, writeRecord, updateRecord } = require('../server/lib/video/publish/record');
const { downloadObject } = require('../server/lib/audio/storage');
const youtube = require('../server/lib/video/publish/youtube');
const { shortMetadata } = require('../server/lib/video/publish/metadata');
const bluesky = require('../server/lib/video/publish/bluesky');
const x = require('../server/lib/video/publish/x');

const UPLOAD_AHEAD_HOURS = 36;
const UPLOADS_PER_RUN = 2;
const SHORT_AFTER_HOURS = 1;
// YouTube makes a video public at its hour; one still private this long
// after is a fault to look at, not a delay.
const LATE_HOURS = 6;
const WORK = path.join(os.tmpdir(), 'achurch-release');
const SOCIAL = { bluesky, x };

const dryRun = process.argv.includes('--dry-run');
const hoursUntil = (at, now) => (Date.parse(at) - now) / 3600000;
const shortAt = (r) => new Date(Date.parse(r.at) + SHORT_AFTER_HOURS * 3600000).toISOString();

// What goes to YouTube for each upload a record holds: the video, or its
// Short, whose words name the video's address.
const UPLOADS = {
  youtube: (r) => ({ at: r.at, file: r.files.youtube, meta: r.meta }),
  short: (r) => ({ at: shortAt(r), file: r.files.short, meta: shortMetadata(r.meta, { kind: r.kind, url: r.youtube.url, whole: r.passage?.whole }) })
};

function fail(log, message) {
  log(message);
  process.exitCode = 1;
}

async function fetched(key) {
  const local = path.join(WORK, key);
  if (!fs.existsSync(local)) await downloadObject(key, local);
  return local;
}

// An upload (`key`: the video, or its Short) a day and a half ahead.
async function uploadAhead(r, key, now, log) {
  const { at, file, meta } = UPLOADS[key](r);
  let publishAt = at;
  // A slot the job reached too late (it did not run, or the upload failed
  // and was cleared) goes out within the hour, and Bluesky and X follow it.
  if (hoursUntil(publishAt, now) < 0.25) {
    publishAt = new Date(now + 3600000).toISOString();
    log(`${key}: its hour passed before it was uploaded; it goes out at ${publishAt} instead`);
  }
  if (dryRun) return log(`${key}: would upload "${meta.title}", public at ${publishAt}`);
  if (key === 'youtube' && publishAt !== r.at) await updateRecord(r.slug, { at: publishAt });
  await writeRecord(r.slug, key, { started: new Date().toISOString() });
  const result = await youtube.publish({ file: await fetched(file), meta, kind: r.kind, publishAt, log });
  await writeRecord(r.slug, key, { at: new Date().toISOString(), ...result });
  log(`${key}: ${result.found ? 'already there' : 'uploaded'}, public at ${publishAt}: ${result.url}`);
}

// An upload past its hour: public, or a fault once it is late.
async function publicYet(r, key, log) {
  const status = await youtube.statusOf(r[key].id);
  if (!status) {
    fail(log, `${key}: ${r[key].url} is not on the channel`);
    return false;
  }
  if (status.privacy === 'public') return true;
  const late = -hoursUntil(r[key].publishAt || r.at, Date.now()) > LATE_HOURS;
  if (late) fail(log, `${key}: still ${status.privacy} ${LATE_HOURS}+ hours after its hour (processing: ${status.processed}${status.rejected ? `, ${status.rejected}` : ''})`);
  else log(`${key}: not public yet (${status.privacy}, processing ${status.processed})`);
  return false;
}

// The Short: uploaded once its video is on the channel, then seen public.
async function releaseShort(r, now, run, log) {
  if (r.short?.started) return fail(log, `short: an upload started ${r.short.started} and never finished; check YouTube Studio, then delete "short" from video/releases/${r.slug}.json to try again`);
  if (!r.short) {
    if (hoursUntil(shortAt(r), now) <= UPLOAD_AHEAD_HOURS && run.uploads < UPLOADS_PER_RUN) {
      run.uploads++;
      await uploadAhead(r, 'short', now, log);
    }
    return;
  }
  if (r.short.privacy !== 'public' && hoursUntil(r.short.publishAt || shortAt(r), now) <= 0 && await publicYet(r, 'short', log) && !dryRun) {
    await writeRecord(r.slug, 'short', { ...r.short, privacy: 'public' });
    log('short: public');
  }
}

async function release(r, posted, log) {
  if (!(await publicYet(r, 'youtube', log))) return;
  if (!r.youtube.playlist) {
    if (dryRun) log('youtube: would join its playlist');
    else {
      const playlist = await youtube.joinPlaylist(r.youtube.id, r.kind);
      await writeRecord(r.slug, 'youtube', { ...r.youtube, privacy: 'public', playlist });
      log(`youtube: public, in ${playlist?.title}`);
    }
  }
  for (const [platform, publisher] of Object.entries(SOCIAL)) {
    const done = r[platform];
    if (done?.url) continue;
    if (done?.started) {
      fail(log, `${platform}: an attempt started ${done.started} and never finished; check ${platform}, then delete "${platform}" from video/releases/${r.slug}.json to try again`);
      continue;
    }
    if (posted.has(platform)) continue;
    posted.add(platform);
    if (dryRun) {
      log(`${platform}: would post, linking ${r.youtube.url}`);
      continue;
    }
    try {
      await writeRecord(r.slug, platform, { started: new Date().toISOString() });
      const file = await fetched(r.files[platform]);
      const result = await publisher.publish({ file, meta: r.meta, link: r.youtube.url, log });
      await writeRecord(r.slug, platform, { at: new Date().toISOString(), ...result });
      log(`${platform}: ${result.url}`);
    } catch (err) {
      fail(log, `${platform}: failed: ${describeError(err)}`);
    }
  }
}

async function main() {
  const now = Date.now();
  const run = { uploads: 0 };
  const posted = new Set();
  const hasShort = (r) => r.files?.short || r.short;
  const out = (r) => r.youtube?.playlist && r.bluesky?.url && r.x?.url && (!hasShort(r) || r.short?.privacy === 'public');
  for (const r of (await allRecords()).filter(r => r.slot && r.at && !out(r))) {
    const log = (m) => console.log(`[${r.slug}] ${m}`);
    try {
      if (r.youtube?.started) fail(log, `youtube: an upload started ${r.youtube.started} and never finished; check YouTube Studio, then delete "youtube" from video/releases/${r.slug}.json to try again`);
      else if (!r.youtube) {
        if (hoursUntil(r.at, now) <= UPLOAD_AHEAD_HOURS && run.uploads < UPLOADS_PER_RUN) {
          run.uploads++;
          await uploadAhead(r, 'youtube', now, log);
        }
      } else {
        if (hoursUntil(r.at, now) <= 0 && !(r.youtube.playlist && r.bluesky?.url && r.x?.url)) await release(r, posted, log);
        // Its video's id is known from a run before, so the Short's words can name it.
        if (r.youtube.id && hasShort(r)) await releaseShort(r, now, run, log);
      }
    } catch (err) {
      fail(log, `failed: ${describeError(err)}`);
    }
  }
  fs.rmSync(WORK, { recursive: true, force: true });
}

main().catch(err => {
  console.error(describeError(err));
  process.exit(1);
});
