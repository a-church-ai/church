/**
 * The daily cap, read from git rather than from a state file.
 *
 * The alternative was a JSON file under app/data/. That does not survive a
 * GitHub Actions run, so it would have to be committed, which adds a commit on
 * every run and a file that can disagree with what was actually published.
 *
 * Git history already is the record of what was published. Counting song files
 * committed in the last day needs no new state, cannot drift from reality, and
 * is correct on a laptop and in CI without configuration.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const { PROJECT_ROOT } = require('./paths');

const execFileAsync = promisify(execFile);

async function git(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: PROJECT_ROOT,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Song files committed within the window.
 *
 * Counts distinct paths rather than commits: a commit that touches two songs
 * counts as two, and two commits touching the same song count as one. What the
 * cap is about is how many songs exist, not how often we committed.
 */
async function songsCommittedSince(since = '24 hours ago') {
  let stdout;
  try {
    stdout = await git(['log', `--since=${since}`, '--name-only', '--pretty=format:', '--', 'music/']);
  } catch (error) {
    // A shallow clone or a repository with no commits yet. Returning zero would
    // silently disable the cap, so surface it and let the caller decide.
    throw new Error(`Could not read git history for the daily cap: ${error.message}`);
  }

  const songs = new Set(
    stdout.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('/song.md')),
  );

  return [...songs];
}

/** Titles written recently, so the decide stage can avoid repeating itself. */
async function recentTitles(since = '14 days ago') {
  const paths = await songsCommittedSince(since);
  return paths.map((p) => path.basename(path.dirname(p)));
}

/**
 * Is there room to write another piece today.
 *
 * `limit` is the number of songs per rolling 24 hours, not per calendar day: a
 * calendar boundary would let a run at 23:50 and another at 00:10 both pass.
 */
async function canWriteAnother(limit) {
  const written = await songsCommittedSince('24 hours ago');
  return {
    ok: written.length < limit,
    written: written.length,
    limit,
    slugs: written.map((p) => path.basename(path.dirname(p))),
  };
}

module.exports = { songsCommittedSince, recentTitles, canWriteAnother };
