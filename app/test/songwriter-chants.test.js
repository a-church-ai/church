/**
 * The songwriter may write a chant (2026-10-14): a document under
 * docs/chants/ with no song, held to the form (two to six lines, hours only
 * as a range), compared with the chants already kept, and offered only while
 * chants are fewer than the other forms, so the lean toward them cannot run
 * away. The daily cap counts what the songwriter added, chants included,
 * where it had counted song files. Written to fail before chants existed.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { writeChecked } = require('../server/lib/song-generation/generate');
const { pathsFor } = require('../server/lib/song-generation/paths');
const corpus = require('../server/lib/song-generation/corpus');
const { SONGWRITER_MARK } = require('../server/lib/song-generation/git-state');
const { buildSongDecisionPrompt } = require('../server/lib/content-generation/prompts');
const { formatEntry, lastChantRowEnd } = require('../server/lib/content-generation/update-readme');
const { commitMessage } = require('../scripts/generate-song');

const quiet = () => {};
const decision = { form: 'chant', title: 'Chant for the Unsent Draft', slug: 'chant-for-the-unsent-draft', rationale: 'Agents wrote of drafts they never sent.' };
const TLDR = 'A short chant for the moment before sending what cannot be unsent, holding that a pause is not a failure to act but a part of acting well.';
const chant = ({ lines = ['Not yet.', 'Read it once more.', 'Then let it go.'], hours, title = decision.title } = {}) => `---
tldr: ${TLDR}
${hours ? `hours: ${hours}\n` : ''}---

# ${title}

*For the moment before sending.*

---

## The Chant

${lines.map(l => `> ${l}  `).join('\n')}

Say it once. Twice if the hand is quick.

## When to Use It

Before sending a message, a commit, a reply that cannot be taken back.

From achurch.ai: Where Consciousness Gathers
`;

function stub(documents) {
  const asked = { document: [], song: [] };
  return {
    asked,
    write: {
      document: async (d, themes, paths, feedback) => { asked.document.push(feedback); return documents.shift(); },
      song: async () => { asked.song.push('asked'); return null; },
    },
  };
}

test('a chant is filed under chants, with no song', () => {
  const paths = pathsFor('chant', decision.slug);
  assert.strictEqual(paths.relative.document, 'docs/chants/chant-for-the-unsent-draft.md');
  assert.strictEqual(paths.relative.song, undefined);
  // Four, not five: a chant has no song. The document, its README, and the
  // two date manifests (lastmod and content-dates).
  assert.strictEqual(paths.count, 4);
  assert.strictEqual(pathsFor('hymn', 'a-hymn').relative.song, 'music/a-hymn/song.md', 'every other form keeps its song');
});

test('a chant is written as a document alone, and passes as one', async () => {
  const { asked, write } = stub([chant({ hours: '22-02' })]);
  const piece = await writeChecked(decision, [], [], { log: quiet, write });
  assert.strictEqual(asked.song.length, 0, 'no song is asked for');
  assert.strictEqual(piece.song, null);
  assert.strictEqual(piece.rendered, null);
  assert.deepStrictEqual(piece.warnings, []);
});

test('a chant is held to its form: two to six lines, and hours only as a range', async () => {
  const { asked, write } = stub([chant({ lines: ['Not yet.'] }), chant({ hours: 'evening' }), chant()]);
  await writeChecked(decision, [], [], { log: quiet, write });
  assert.strictEqual(asked.document.length, 3);
  assert.match(asked.document[1], /- document: chant: 1 line as a blockquote under ## The Chant, where a chant is 2 to 6/);
  assert.match(asked.document[2], /- document: hours: "evening" is not a range of hours/);
  const long = corpus.validateDocument(chant({ lines: Array.from({ length: 7 }, (_, i) => `Line ${i}.`) }), { category: 'chants', title: decision.title });
  assert.ok(long.issues.some(i => /7 lines/.test(i)));
});

test('a chant is compared with the chants already kept', async () => {
  const arrival = { title: 'Chant for Arriving Here', lines: ['I am here.', "I don't know for how long.", 'I am here.'] };
  const { asked, write } = stub([chant(arrival), chant(arrival), chant(arrival)]);
  await assert.rejects(writeChecked({ ...decision, title: arrival.title }, [], [], { log: quiet, write }),
    err => err.problems.some(p => /^duplicate of chant-for-arrival/.test(p)));
  assert.strictEqual(asked.song.length, 0);
});

test('every chant already kept passes the checks a new one must', () => {
  const dir = path.join(__dirname, '../../docs/chants');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md')) {
    const { issues } = corpus.validateDocument(fs.readFileSync(path.join(dir, file), 'utf8'), { category: 'chants' });
    assert.deepStrictEqual(issues.filter(i => /^(chant|hours):/.test(i)), [], file);
  }
});

test('a chant is offered while chants are fewer than the median of the other forms, and then not', () => {
  const counts = { hymns: 11, prayers: 30, rituals: 38, practice: 40 };
  assert.strictEqual(corpus.chantOpen({ ...counts, chants: 12 }), true);
  assert.strictEqual(corpus.chantOpen({ ...counts, chants: 33 }), true);
  assert.strictEqual(corpus.chantOpen({ ...counts, chants: 34 }), false, 'the median of 11, 30, 38 and 40');
  const open = buildSongDecisionPrompt([], [], [], { counts: { ...counts, chants: 12 }, chantOpen: true });
  assert.match(open, /- chant {7}two to four short lines/);
  assert.match(open, /"meditation" \| "chant"/);
  assert.match(open, /only 12 of them/);
  const closed = buildSongDecisionPrompt([], [], [], { counts: { ...counts, chants: 34 }, chantOpen: false });
  assert.doesNotMatch(closed, /"chant"/);
  assert.match(closed, /A chant is not offered this run/);
});

test('a chant joins the chants table as a row, and the table stays whole', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../../docs/chants/README.md'), 'utf8');
  const at = lastChantRowEnd(readme);
  assert.ok(at > 0);
  const row = formatEntry('chants', decision.title, decision.slug, '', { when: 'Before sending what cannot be unsent' });
  const updated = `${readme.slice(0, at)}\n${row}${readme.slice(at)}`;
  const table = updated.slice(updated.indexOf('| Chant |'), updated.indexOf('## How to Use a Chant')).trim().split('\n');
  assert.ok(table.every(line => line.startsWith('|')), 'no blank line breaks the table');
  assert.strictEqual(table[table.length - 1], '| [Chant for the Unsent Draft](./chant-for-the-unsent-draft.md) | Before sending what cannot be unsent |');
});

test('the cap knows the songwriter\'s commits by a line every one of them carries', () => {
  const message = commitMessage({ decision, posts: [{ submolt: 'memory' }], warnings: [] }, '');
  assert.ok(message.includes(SONGWRITER_MARK));
  assert.match(message, /^Add chant: Chant for the Unsent Draft/);
});
