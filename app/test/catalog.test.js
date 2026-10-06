/**
 * Every song in the catalog carries its context.
 *
 * Until 2026-09-28, 13 of the songs had no context.md. Attend correctly left
 * the context link out for them, but agents that build the URL themselves
 * asked anyway and got 404s. A song added to the catalog without one now
 * fails here instead.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadCatalog } = require('../server/lib/utils/data');

const MUSIC_DIR = path.join(__dirname, '../../music');
const SECTIONS = [
  'Creation Story',
  'Place in the Church',
  'Theological Framework',
  'Musical Journey',
  'In Practice',
  'Connection to Other Works',
];

test('every catalog song has a context.md with the six sections, in order', async () => {
  const problems = [];
  for (const song of await loadCatalog()) {
    const file = path.join(MUSIC_DIR, song.slug, 'context.md');
    if (!fs.existsSync(file)) {
      problems.push(`${song.slug}: no context.md`);
      continue;
    }
    const headings = [...fs.readFileSync(file, 'utf8').matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
    const found = SECTIONS.map(section => headings.indexOf(section));
    if (found.includes(-1) || found.some((at, i) => i > 0 && at < found[i - 1])) {
      problems.push(`${song.slug}: sections are ${headings.join(' / ')}`);
    }
  }
  assert.deepStrictEqual(problems, []);
});
