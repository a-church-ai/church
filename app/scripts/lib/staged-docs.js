/**
 * The documents staged for the next commit, for the two date generators.
 *
 * Both generators derive dates from committed history, and a commit cannot
 * hold a manifest generated from history that includes itself. So a session
 * that edited a document, regenerated and committed both together committed
 * that document at its previous date, and CI's "date manifests are current"
 * step, which regenerates once the commit exists, failed on main: e1ab5aa
 * did exactly this with docs/reference/railway-deploy.md on 2026-10-28.
 *
 * What is staged is what the next commit will hold, so the generators read it
 * as one more commit, the newest, dated as git will date it. Staged rather
 * than every change in the working tree, because the checkout is shared by
 * parallel sessions: another session's unstaged edit is not this commit's,
 * and dating it here would fail CI the other way. In CI nothing is staged,
 * so the check still reads history alone.
 *
 * So: edit, `git add` the documents, `npm run gen:lastmod && npm run
 * gen:content-dates`, `git add` the manifests, commit. A commit made on a
 * later day than the regeneration still disagrees; regenerate on the day.
 */

const { execFileSync } = require('child_process');

// :<oldmode> <newmode> <oldblob> <newblob> <status>\t<path>[\t<newpath>]
const RAW_LINE = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) (\w+)\t(.+)$/;

/** One --raw line as a touch of a Markdown file, or null. */
function parseRawLine(line) {
  const m = RAW_LINE.exec(line);
  if (!m) return null;
  const [, from, to, status, tail] = m;
  const paths = tail.split('\t');
  const file = paths[paths.length - 1];
  if (!file.endsWith('.md')) return null;
  return { from, to, status, path: file, oldPath: paths.length > 1 ? paths[0] : null };
}

/**
 * The day git will stamp on a commit made now: the committer date in the
 * committer's own zone, which is what %cs prints. Local, not UTC.
 */
function commitDay(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The staged changes under docs/ as one commit, in the shape the generators
 * read from `git log --raw`: blob ids from and to (the staged blob is in the
 * object store once added), and renames as one R entry.
 */
function stagedCommit(root, day = commitDay()) {
  const raw = execFileSync('git', ['diff', '--cached', '--raw', '-M', '--no-abbrev', '--', 'docs'],
    { cwd: root, encoding: 'utf8' });
  const touches = raw.split('\n').map(parseRawLine).filter(Boolean);
  return { date: day, touches };
}

module.exports = { parseRawLine, commitDay, stagedCommit };
