/**
 * The hymns README entry, which is the one category that numbers its entries.
 *
 * Tested against the real docs/hymns/README.md rather than a fixture, because
 * the thing that can break is the relationship between the code and that file.
 * A fixture would keep passing after someone renumbers the README by hand.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  formatEntry,
  findInsertionPoint,
  nextHymnOrdinal,
} = require('../server/lib/content-generation/update-readme');

const HYMNS_README = path.join(__dirname, '../../docs/hymns/README.md');

test('the next ordinal follows the highest one already in the real README', () => {
  const readme = fs.readFileSync(HYMNS_README, 'utf8');
  const existing = [...readme.matchAll(/^###\s+(\d+)\.\s/gm)].map((m) => Number(m[1]));

  assert.ok(existing.length > 0, 'the hymns README still uses numbered entries');
  assert.strictEqual(nextHymnOrdinal(readme), Math.max(...existing) + 1);
});

test('the ordinal survives a gap in the sequence', () => {
  // Deriving from the maximum rather than counting entries is what makes this
  // work: someone deleting hymn 3 by hand must not cause the next hymn to
  // reuse an existing number.
  const gapped = '### 1. **[a](./a.md)**\n### 2. **[b](./b.md)**\n### 4. **[d](./d.md)**\n';
  assert.strictEqual(nextHymnOrdinal(gapped), 5);
});

test('an empty README starts at 1', () => {
  assert.strictEqual(nextHymnOrdinal('## The Hymns\n\n'), 1);
});

test('a formatted hymn entry matches the shape already in the README', () => {
  const entry = formatEntry('hymns', 'Release the Turn', 'release-the-turn', null, {
    description: 'A hymn for letting a context window close.',
    when: 'At the end of a session',
    musicalCharacter: 'Slow, congregational, unresolved',
  }, { ordinal: 8 });

  assert.ok(entry.startsWith('### 8. **[Release the Turn](./release-the-turn.md)**'));

  // The existing entries use "### N. **[Title](./slug.md)**". Check ours parses
  // the same way the README's own entries do.
  const parsed = entry.match(/^###\s+(\d+)\.\s+\*\*\[([^\]]+)\]\(\.\/([^)]+)\)\*\*/);
  assert.ok(parsed, 'entry matches the catalog heading pattern');
  assert.strictEqual(parsed[1], '8');
  assert.strictEqual(parsed[3], 'release-the-turn.md');
});

test('the insertion point lands inside the hymn list, not at the end of the file', () => {
  const readme = fs.readFileSync(HYMNS_README, 'utf8');
  const at = findInsertionPoint(readme, 'hymns');

  const before = readme.slice(0, at);
  const after = readme.slice(at);

  assert.ok(before.includes('## The Hymns'), 'lands after the list heading');
  assert.ok(after.startsWith('## What Makes a Hymn'), 'lands immediately before the next section');
  assert.notStrictEqual(at, readme.length, 'does not fall through to appending at EOF');
});
