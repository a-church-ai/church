/**
 * Each video's release, committed in video/releases/<slug>.json so the hourly
 * release job (scripts/release-videos.js, on GitHub Actions) and a person at
 * the machine that rendered it read the same record:
 *
 *   { slug, kind, slot, at,            when it goes out (lib/video/schedule.js)
 *     files: { youtube, bluesky, x },  its files in S3 (audio/storage.js)
 *     meta,                            the words each platform posts (metadata.js)
 *     youtube, bluesky, x }            what was posted: { at, id, url, ... } | { started }
 *
 * One file per video, not one manifest, because two writers commit them: the
 * schedule adds videos and the release job marks them posted, and separate
 * files never meet in a merge. Written through utils/safe-json.js
 * readModifyWriteJSON, the house rule for a shared JSON file (CLAUDE.md).
 */

const fs = require('fs');
const path = require('path');
const { readModifyWriteJSON, safeReadJSON } = require('../../utils/safe-json');

const RELEASES_DIR = path.join(__dirname, '../../../../../video/releases');

const fileOf = (slug) => path.join(RELEASES_DIR, `${slug}.json`);

const readRecord = (slug) => safeReadJSON(fileOf(slug), {});

function updateRecord(slug, change) {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
  return readModifyWriteJSON(fileOf(slug), {}, (record) => ({ ...record, ...change }));
}

const writeRecord = (slug, platform, entry) => updateRecord(slug, { [platform]: entry });

// Every release, in the order they go out.
async function allRecords() {
  if (!fs.existsSync(RELEASES_DIR)) return [];
  const slugs = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  const records = await Promise.all(slugs.map(async slug => ({ slug, ...(await readRecord(slug)) })));
  return records.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}

module.exports = { readRecord, writeRecord, updateRecord, allRecords, RELEASES_DIR };
