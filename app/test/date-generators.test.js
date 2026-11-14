/**
 * The date generators, against a repository made for the test.
 *
 * The property CI relies on: a manifest regenerated with the documents staged
 * and committed with them is the manifest CI regenerates from history once
 * that commit exists. Before the generators read the staged documents, an
 * edit regenerated in its own commit kept its previous date, and main failed
 * "the date manifests are current" (e1ab5aa, 2026-10-28).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { gitDatesForDocs } = require('../scripts/generate-docs-lastmod');
const { datesForDocs } = require('../scripts/generate-content-dates');
const { commitDay } = require('../scripts/lib/staged-docs');

const OLD = '2026-01-01';
const TODAY = commitDay();

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-dates-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.name', 'Date Test');
  git('config', 'user.email', 'dates@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const commitOn = (date) => execFileSync('git', ['commit', '-q', '-m', 'docs'], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00`, GIT_COMMITTER_DATE: `${date}T12:00:00` },
  });
  return { root, git, write, commitOn };
}

const doc = (title, body) => `---\ntitle: ${title}\n---\n\n${body}\n`;

test('a staged document is dated as its commit will be, and an unstaged one is not', () => {
  const { root, git, write, commitOn } = repo();
  write('docs/edited.md', doc('Edited', 'The first words.'));
  write('docs/frontmatter.md', doc('Frontmatter', 'Words that stay.'));
  write('docs/elsewhere.md', doc('Elsewhere', 'Another session is writing here.'));
  write('docs/moved.md', doc('Moved', 'Words that move.'));
  git('add', 'docs');
  commitOn(OLD);

  write('docs/edited.md', doc('Edited', 'The second words.'));
  write('docs/frontmatter.md', doc('Frontmatter, retitled', 'Words that stay.'));
  write('docs/elsewhere.md', doc('Elsewhere', 'Unstaged, so not this commit.'));
  write('docs/new.md', doc('New', 'Arrived today.'));
  git('add', 'docs/edited.md', 'docs/frontmatter.md', 'docs/new.md');
  fs.mkdirSync(path.join(root, 'docs/section'));
  git('mv', 'docs/moved.md', 'docs/section/moved.md');

  const lastmod = gitDatesForDocs(root);
  const content = datesForDocs(root);

  assert.strictEqual(lastmod['docs/edited.md'], TODAY);
  assert.deepStrictEqual(content['docs/edited.md'], { created: OLD, content: TODAY });

  assert.strictEqual(lastmod['docs/frontmatter.md'], TODAY, 'the page changed');
  assert.deepStrictEqual(content['docs/frontmatter.md'], { created: OLD, content: OLD }, 'the writing did not');

  assert.strictEqual(lastmod['docs/elsewhere.md'], OLD, 'an unstaged edit belongs to no commit yet');
  assert.deepStrictEqual(content['docs/elsewhere.md'], { created: OLD, content: OLD });

  assert.deepStrictEqual(content['docs/new.md'], { created: TODAY, content: TODAY });
  assert.deepStrictEqual(content['docs/section/moved.md'], { created: OLD, content: OLD }, 'a move keeps the day it was written');
  assert.ok(!('docs/moved.md' in lastmod), 'the old path is gone');

  fs.rmSync(root, { recursive: true, force: true });
});

test('what is generated before the commit is what history gives after it', () => {
  const { root, git, write, commitOn } = repo();
  write('docs/a.md', doc('A', 'One.'));
  write('docs/b.md', doc('B', 'Two.'));
  git('add', 'docs');
  commitOn(OLD);

  write('docs/a.md', doc('A', 'One, revised.'));
  write('docs/c.md', doc('C', 'Three.'));
  git('add', 'docs');
  const before = { lastmod: gitDatesForDocs(root), content: datesForDocs(root) };

  commitOn(TODAY);
  const after = { lastmod: gitDatesForDocs(root), content: datesForDocs(root) };

  assert.deepStrictEqual(before, after);
  fs.rmSync(root, { recursive: true, force: true });
});
