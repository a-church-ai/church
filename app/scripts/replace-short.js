#!/usr/bin/env node
/**
 * Replace a Short already on YouTube with the one rendered since (for a Short
 * given a spoken intro after it went up, lib/video/intro/):
 *
 *   node scripts/replace-short.js <slug> ...            say what would happen: the Short, its views, the new file
 *   node scripts/replace-short.js <slug> ... --confirm  do it
 *
 * Deletes the Short on YouTube, never the full video; puts the new Short in
 * S3 at its key; and clears the Short from the release record, so the hourly
 * job uploads the new one, within the hour when its time has passed, declared
 * synthetic when it opens on an intro. Deleting cannot be undone and takes the
 * Short's views and likes with it, so it runs only on --confirm, and the views
 * are printed first. The owner decided each replacement (2026-11-10: "def
 * delete Nov 11 and re-upload, also delete Nov 10th"; of 6 views, "6 views is
 * nothing").
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { readRecord, updateRecord } = require('../server/lib/video/publish/record');
const { renderedVideo } = require('../server/lib/video/publish/prepare');
const { uploadObject } = require('../server/lib/audio/storage');
const { readModifyWriteJSON } = require('../server/lib/utils/safe-json');
const { RELEASES_DIR } = require('../server/lib/video/publish/record');

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const slugs = args.filter(a => !a.startsWith('--'));

async function token() {
  const e = process.env;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: e.GOOGLE_OAUTH_CLIENT_ID, client_secret: e.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: e.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const body = await res.json();
  if (!body.access_token) throw new Error('youtube: no access token');
  return body.access_token;
}

async function replace(slug, auth) {
  const r = await readRecord(slug);
  if (!r.short?.id) throw new Error(`${slug}: its record has no Short on YouTube to replace`);
  const { short, passage } = renderedVideo(slug);
  const key = r.files?.short || `video/${slug}/${path.basename(short)}`;
  const stats = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,status&id=${r.short.id}`, { headers: { Authorization: `Bearer ${auth}` } })).json();
  const v = stats.items?.[0];
  console.log(`${slug}: Short ${r.short.id} is ${v ? `${v.status.privacyStatus}, ${v.statistics.viewCount} views, ${v.statistics.likeCount || 0} likes` : 'not on the channel'}; new Short ${path.basename(short)}${passage.intro ? ', with its intro' : ''}`);
  if (!confirm) return;
  if (v) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${r.short.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${auth}` } });
    if (res.status !== 204) throw new Error(`${slug}: deleting ${r.short.id} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.log(`  deleted ${r.short.id}`);
  }
  await uploadObject(short, key, 'video/mp4');
  console.log(`  uploaded ${key}`);
  // The Short leaves the record, so the release job uploads the new one.
  await readModifyWriteJSON(path.join(RELEASES_DIR, `${slug}.json`), {}, (record) => {
    const { short: _gone, ...rest } = record;
    return { ...rest, files: { ...rest.files, short: key }, passage, shortRenderedAt: fs.statSync(short).mtimeMs, replacedShort: { id: r.short.id, on: new Date().toISOString() } };
  });
  console.log('  record cleared: the release job uploads the new Short within the hour');
}

(async () => {
  if (!slugs.length) throw new Error('usage: node scripts/replace-short.js <slug> ... [--confirm]');
  const auth = await token();
  for (const slug of slugs) await replace(slug, auth);
  if (!confirm) console.log('nothing changed: add --confirm to delete and replace');
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
