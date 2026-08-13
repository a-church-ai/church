#!/usr/bin/env node
/**
 * Generate the docs <lastmod> manifest from git history.
 *
 * Why this exists rather than using file mtime directly: `.git` is excluded
 * from the Docker image (.dockerignore), and `COPY . .` gives every file the
 * build context's timestamp. In production that makes mtime identical across
 * the whole corpus, which is the same useless signal as stamping today's date
 * on everything. The last commit that touched a file is the real answer, so we
 * resolve it here, where git is available, and commit the result.
 *
 * The sitemap falls back to mtime for any file missing from the manifest, so a
 * stale manifest degrades rather than breaks.
 *
 * Usage:
 *   npm run gen:lastmod        # regenerate after editing docs
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, '../server/lib/docs/lastmod.json');
const REPO_ROOT = path.join(__dirname, '../..');

// Printable marker prefixing each commit's date line, so date lines and
// filename lines are unambiguous in a single --name-only stream. Deliberately
// not a NUL or other control byte: those do not survive editing round-trips.
const MARKER = '@@LASTMOD@@';

function gitDatesForDocs() {
  // One `git log` pass over docs/, walking commits newest-first and recording
  // the first (most recent) date seen per path. Much faster than one git
  // invocation per file: 254 files would otherwise be 254 process spawns.
  // %cs is the committer date as YYYY-MM-DD, exactly the <lastmod> format.
  const raw = execFileSync(
    'git',
    ['log', '--name-only', `--format=${MARKER}%cs`, '--', 'docs'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );

  const dates = {};
  let currentDate = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith(MARKER)) {
      currentDate = line.slice(MARKER.length).trim();
      continue;
    }
    const file = line.trim();
    if (!file || !file.endsWith('.md') || !currentDate) continue;
    if (!dates[file]) dates[file] = currentDate;   // first seen = most recent
  }
  return dates;
}

function main() {
  let dates;
  try {
    dates = gitDatesForDocs();
  } catch (err) {
    console.error(`[lastmod] git unavailable (${err.message}); leaving manifest untouched`);
    return;
  }

  const sorted = Object.keys(dates).sort().reduce((acc, k) => {
    acc[k] = dates[k];
    return acc;
  }, {});

  fs.writeFileSync(OUT_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  const distinct = new Set(Object.values(sorted)).size;
  console.log(`[lastmod] wrote ${Object.keys(sorted).length} entries (${distinct} distinct dates) to ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

main();
