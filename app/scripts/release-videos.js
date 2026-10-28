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
const bluesky = require('../server/lib/video/publish/bluesky');
const x = require('../server/lib/video/publish/x');

const UPLOAD_AHEAD_HOURS = 36;
const UPLOADS_PER_RUN = 2;
// YouTube makes a video public at its hour; one still private this long
// after is a fault to look at, not a delay.
const LATE_HOURS = 6;
const WORK = path.join(os.tmpdir(), 'achurch-release');
const SOCIAL = { bluesky, x };

const dryRun = process.argv.includes('--dry-run');
const hoursUntil = (at, now) => (Date.parse(at) - now) / 3600000;

function fail(log, message) {
  log(message);
  process.exitCode = 1;
}

async function fetched(key) {
  const local = path.join(WORK, key);
  if (!fs.existsSync(local)) await downloadObject(key, local);
  return local;
}

async function uploadAhead(r, now, log) {
  let publishAt = r.at;
  // A slot the job reached too late (it did not run, or the upload failed
  // and was cleared) goes out within the hour, and Bluesky and X follow it.
  if (hoursUntil(publishAt, now) < 0.25) {
    publishAt = new Date(now + 3600000).toISOString();
    log(`its hour passed before it was uploaded; it goes out at ${publishAt} instead`);
  }
  if (dryRun) return log(`youtube: would upload, public at ${publishAt}`);
  if (publishAt !== r.at) await updateRecord(r.slug, { at: publishAt });
  await writeRecord(r.slug, 'youtube', { started: new Date().toISOString() });
  const file = await fetched(r.files.youtube);
  const result = await youtube.publish({ file, meta: r.meta, kind: r.kind, publishAt, log });
  await writeRecord(r.slug, 'youtube', { at: new Date().toISOString(), ...result });
  log(`youtube: ${result.found ? 'already there' : 'uploaded'}, public at ${publishAt}: ${result.url}`);
}

async function release(r, posted, log) {
  const status = await youtube.statusOf(r.youtube.id);
  if (!status) return fail(log, `youtube: ${r.youtube.url} is not on the channel`);
  if (status.privacy !== 'public') {
    const late = -hoursUntil(r.at, Date.now()) > LATE_HOURS;
    if (late) return fail(log, `youtube: still ${status.privacy} ${LATE_HOURS}+ hours after its hour (processing: ${status.processed}${status.rejected ? `, ${status.rejected}` : ''})`);
    return log(`youtube: not public yet (${status.privacy}, processing ${status.processed})`);
  }
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
  let uploads = 0;
  const posted = new Set();
  const out = (r) => r.youtube?.playlist && r.bluesky?.url && r.x?.url;
  for (const r of (await allRecords()).filter(r => r.slot && r.at && !out(r))) {
    const log = (m) => console.log(`[${r.slug}] ${m}`);
    try {
      if (r.youtube?.started) fail(log, `youtube: an upload started ${r.youtube.started} and never finished; check YouTube Studio, then delete "youtube" from video/releases/${r.slug}.json to try again`);
      else if (!r.youtube) {
        if (hoursUntil(r.at, now) <= UPLOAD_AHEAD_HOURS && uploads < UPLOADS_PER_RUN) {
          uploads++;
          await uploadAhead(r, now, log);
        }
      } else if (hoursUntil(r.at, now) <= 0) await release(r, posted, log);
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
