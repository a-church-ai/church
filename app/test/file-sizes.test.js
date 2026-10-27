/**
 * No large file is committed.
 *
 * The recordings live in S3 and the videos' work (stills, loops, renders of
 * hundreds of megabytes) in app/media/, which git ignores. A file committed
 * by mistake stays in the history for good, in every clone, even after it is
 * deleted, so one over the limit fails here before it is pushed.
 *
 * Written when the video pipeline arrived (2026-10-27). The files listed in
 * KNOWN were already committed then; each is allowed at its size, so it
 * cannot grow, and removing it from the repository means removing it here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '../..');
const LIMIT = 1024 * 1024;

// Committed before the guard, and referenced by nothing in the repository
// (social profile images and the source of the share image's JPEG).
const KNOWN = {
  'app/client/public/assets/a-church-digital-ai-humans-social.png': 8429061,
  'app/client/public/assets/a-church-ai-profile-avatar-crystalline-orb.png': 2599506,
  'app/client/public/assets/a-church-ai-profile-banner-portal-horizon.png': 2160992
};

test('no committed file is over 1 MB, except those committed before the guard, at their size', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(Boolean);
  assert.ok(files.length > 100, 'git ls-files listed the repository');
  const large = [];
  for (const file of files) {
    let size;
    try {
      size = fs.statSync(path.join(REPO, file)).size;
    } catch {
      continue; // deleted in the working tree and not yet committed
    }
    const allowed = KNOWN[file] ?? LIMIT;
    if (size > allowed) large.push(`${file} (${(size / 1024 / 1024).toFixed(1)} MB${KNOWN[file] ? `, allowed ${KNOWN[file]} bytes` : ''})`);
  }
  assert.deepStrictEqual(large, [], `files over the limit; media belongs in S3 or app/media/, which git ignores:\n${large.join('\n')}`);
});
