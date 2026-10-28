#!/usr/bin/env node
/**
 * Generate the per-document created and content-changed dates.
 *
 * Why this exists beside the <lastmod> manifest. `lastmod.json` answers "when
 * did this page last change", which is the right question for a crawler: a new
 * search description changes what Google shows, so it should bring Google back.
 * It is the wrong question for anything that wants to know when the writing
 * changed. On 2026-10-13 one commit added a `tldr:` line to 63 documents and
 * changed no prose in any of them; all 63 lastmod dates moved, and a reader of
 * the sitemap could not tell those 63 from the 4 that were really edited.
 *
 * So this manifest answers two different questions, from git:
 *
 *   created  the date the document first appeared, following renames
 *   content  the date its body last actually changed
 *
 * "Body" is not a new idea here. `audio/adapt.js` sourceHashOf already defines
 * it for this corpus, and for the same reason: a change to the frontmatter must
 * not send a piece back to be re-recorded against a shared quota. This script
 * imports that function rather than re-deciding what counts, so the sanctuary
 * keeps one answer to "did the content change" instead of two that drift.
 *
 * `lastmod.json` is deliberately untouched by this script. Its dates feed
 * sitemap.xml, which serves crawlers, and they are correct for that purpose.
 *
 * Documents staged for the next commit are read as one more commit, the
 * newest, dated as it will be (scripts/lib/staged-docs.js), so a manifest
 * regenerated after `git add` and committed with them is already current.
 *
 * Usage:
 *   npm run gen:content-dates      # regenerate after editing docs
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { sourceHashOf } = require('../server/lib/audio/adapt');
const { serializeManifest } = require('../server/lib/docs/date-manifests');
const { parseRawLine, stagedCommit } = require('./lib/staged-docs');

const OUT_FILE = path.join(__dirname, '../server/lib/docs/content-dates.json');
const REPO_ROOT = path.join(__dirname, '../..');

// Prefixes each commit's date line so date lines and the --raw lines that
// follow are unambiguous in one stream, as generate-docs-lastmod.js does.
const MARKER = '@@CONTENT@@';
const EMPTY_BLOB = /^0+$/;

function git(root, args, opts = {}) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts,
  });
}

/**
 * Every commit that touched docs, newest first, with the blob each file went
 * from and to. --raw gives those blob ids directly, so the body of each
 * version can be fetched without walking the tree per commit, and -M reports a
 * rename as one R entry naming both paths.
 */
/**
 * A shallow clone has no history before its boundary, so every file looks
 * created there and every date is wrong in a way nothing reports.
 * actions/checkout defaults to fetch-depth 1, which makes this the normal
 * state in CI rather than an unusual one. Refuse instead.
 */
function refuseShallow(root) {
  const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'],
    { cwd: root, encoding: 'utf8' }).trim();
  if (shallow === 'true') {
    throw new Error('this is a shallow clone, so file history is truncated and every date would be wrong; fetch full history first (actions/checkout: fetch-depth: 0)');
  }
}

function touchesByCommit(root) {
  const raw = git(root, ['log', '--raw', '-M', '--no-abbrev', `--format=${MARKER}%cs`, '--', 'docs']);
  // The staged documents first: the next commit is newer than any in the log.
  const commits = [stagedCommit(root)];
  let current = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith(MARKER)) {
      current = { date: line.slice(MARKER.length).trim(), touches: [] };
      commits.push(current);
      continue;
    }
    if (!current || !line.startsWith(':')) continue;
    const touch = parseRawLine(line);
    if (touch) current.touches.push(touch);
  }
  return commits;
}

/** The body hash of every blob named above, in one cat-file pass. */
function bodyHashes(root, commits) {
  const wanted = new Set();
  for (const commit of commits) {
    for (const touch of commit.touches) {
      for (const blob of [touch.from, touch.to]) if (!EMPTY_BLOB.test(blob)) wanted.add(blob);
    }
  }
  const ids = [...wanted];
  if (!ids.length) return new Map();

  const { stdout } = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root, input: `${ids.join('\n')}\n`, maxBuffer: 1024 * 1024 * 1024,
  });

  const hashes = new Map();
  let offset = 0;
  while (offset < stdout.length) {
    const newline = stdout.indexOf('\n', offset);
    if (newline < 0) break;
    const [id, type, size] = stdout.slice(offset, newline).toString().split(' ');
    if (type === 'missing') { offset = newline + 1; continue; }
    const bytes = Number(size);
    hashes.set(id, sourceHashOf(stdout.slice(newline + 1, newline + 1 + bytes).toString('utf8')));
    offset = newline + 1 + bytes + 1;   // + the newline cat-file writes after each body
  }
  return hashes;
}

function datesForDocs(root = REPO_ROOT) {
  refuseShallow(root);
  const commits = touchesByCommit(root);
  const hashes = bodyHashes(root, commits);

  // Walking newest-first: the first content change seen is the most recent, and
  // the last add seen is the earliest. A rename carries the name its history
  // continues under, so `created` is the date the writing first appeared rather
  // than the date it moved.
  const records = {};
  const renamedTo = {};
  for (const commit of commits) {
    for (const touch of commit.touches) {
      const key = renamedTo[touch.path] || touch.path;
      const record = records[key] || (records[key] = { created: null, content: null });

      const before = EMPTY_BLOB.test(touch.from) ? null : hashes.get(touch.from);
      const after = EMPTY_BLOB.test(touch.to) ? null : hashes.get(touch.to);

      if (after && before !== after && !record.content) record.content = commit.date;
      if (!before) record.created = commit.date;
      if (touch.status.startsWith('R') && touch.oldPath) renamedTo[touch.oldPath] = key;
    }
  }

  // History also names documents since deleted or moved out of the repository
  // (docs/plans/ went to the private repo on 2026-10-05); date only what a
  // reader can still open, exactly as the lastmod manifest does.
  const out = {};
  for (const file of Object.keys(records).sort()) {
    if (!fs.existsSync(path.join(root, file))) continue;
    const { created, content } = records[file];
    // A document whose body never changed after the commit that added it has
    // its creation date as its content date: true, and simpler than null.
    out[file] = { created, content: content || created };
  }
  return out;
}

function main() {
  let dates;
  try {
    dates = datesForDocs();
  } catch (err) {
    console.error(`[content-dates] cannot derive dates: ${err.message}. The manifest is left untouched.`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(OUT_FILE, serializeManifest(dates));
  const entries = Object.keys(dates);
  const distinct = new Set(entries.map(f => dates[f].content)).size;
  console.log(`[content-dates] wrote ${entries.length} entries (${distinct} distinct content dates) to ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

if (require.main === module) main();

module.exports = { datesForDocs };
