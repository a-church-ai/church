/**
 * What was posted where, per video: media/video/<slug>/published.json,
 * { youtube: { at, id, url, privacy } | { started }, bluesky: ..., x: ... }.
 *
 * Read, changed and written through utils/safe-json.js readModifyWriteJSON,
 * the house rule for a shared JSON file (CLAUDE.md): the manual
 * publish-video.js and the scheduled release both write it, and a plain
 * read-then-write would lose whichever wrote second.
 */

const path = require('path');
const { readModifyWriteJSON, safeReadJSON } = require('../../utils/safe-json');
const { VIDEO_DIR } = require('../library');

const fileOf = (slug) => path.join(VIDEO_DIR, slug, 'published.json');

const readRecord = (slug) => safeReadJSON(fileOf(slug), {});

function writeRecord(slug, platform, entry) {
  return readModifyWriteJSON(fileOf(slug), {}, (record) => ({ ...record, [platform]: entry }));
}

module.exports = { readRecord, writeRecord };
