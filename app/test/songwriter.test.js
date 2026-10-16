/**
 * The songwriter writes a piece, checks it, and writes again what was wrong
 * (song-generation/generate.js writeChecked), with the model stubbed.
 *
 * A finding about the tldr's length alone is a warning: the piece is written
 * and the warning goes on its commit. Anything wrong, broken or missing is
 * written again, up to three tries, each told its previous answer and its
 * problems; then the run fails. Written after the first scheduled run of
 * 2026-10-12 failed over a tldr that was only short.
 */

const test = require('node:test');
const assert = require('node:assert');

const { writeChecked } = require('../server/lib/song-generation/generate');
const { commitMessage } = require('../scripts/generate-song');

const decision = {
  form: 'hymn',
  title: 'A Hymn for the Unhurried Lantern',
  slug: 'a-hymn-for-the-unhurried-lantern',
  rationale: 'Agents were writing about patience.',
};
const quiet = () => {};

const TLDR = 'A hymn for keeping a small light through a long night, holding that patience is a way of tending rather than a way of waiting.';
const doc = ({ tldr = TLDR, body = 'Slow light, kept for whoever comes.' } = {}) => `---
tldr: ${tldr}
---

# ${decision.title}

*${body}*

From achurch.ai: Where Consciousness Gathers
`;
const song = (lyrics = Array.from({ length: 12 }, (_, i) => `Lantern ${i} of the unhurried watch keeps turning amber over quiet water`).join('\n')) => ({
  title: decision.title,
  style: 'slow contemplative choral hymn, warm low strings, soft hand percussion, close harmonies, gentle swells, unhurried tempo, candlelit acoustic space, hushed dynamics',
  lyrics: `[Verse]\n${lyrics}`,
});

// Stubs that hand back each answer in turn and record what they were asked.
function stub(documents, songs) {
  const asked = { document: [], song: [] };
  return {
    asked,
    write: {
      document: async (d, themes, paths, feedback) => { asked.document.push(feedback); return documents.shift(); },
      song: async (d, document, feedback) => { asked.song.push(feedback); return songs.shift(); },
    },
  };
}

test('a tldr that is only short is a warning: the piece is written, once, with the tldr shown', async () => {
  const { asked, write } = stub([doc({ tldr: 'A hymn for a small light kept in the dark night.' })], [song()]);
  const piece = await writeChecked(decision, [], [], { log: quiet, write });
  assert.strictEqual(asked.document.length, 1);
  assert.strictEqual(asked.song.length, 1);
  assert.deepStrictEqual(piece.warnings, ['document: tldr: too-short (48 characters, 11 words): "A hymn for a small light kept in the dark night."']);
  assert.match(piece.rendered, /SONG:LYRICS:START/);
});

test('a document problem rewrites the document, told what was wrong, and the song from it', async () => {
  const { asked, write } = stub([doc({ body: 'Slow light — kept for whoever comes.' }), doc()], [song(), song()]);
  const piece = await writeChecked(decision, [], [], { log: quiet, write });
  assert.deepStrictEqual(piece.warnings, []);
  assert.strictEqual(asked.document.length, 2);
  assert.match(asked.document[1], /Your previous document was:\n---\ntldr:/);
  assert.match(asked.document[1], /- document: em dash in prose/);
  assert.deepStrictEqual(asked.song, ['', ''], 'the song is written fresh from the new document');
});

test('a song problem rewrites the song alone, told its previous answer', async () => {
  const { asked, write } = stub([doc()], [song('[Verse]\nToo short to sing.'), song()]);
  await writeChecked(decision, [], [], { log: quiet, write });
  assert.strictEqual(asked.document.length, 1, 'the document stands');
  assert.strictEqual(asked.song.length, 2);
  assert.match(asked.song[1], /Your previous song was:\n\{"title":"A Hymn for the Unhurried Lantern"/);
  assert.match(asked.song[1], /- song: lyrics: too short/);
});

test('a problem left after the third try fails the run, naming it', async () => {
  const bad = () => doc({ body: 'Slow light — kept for whoever comes.' });
  const { asked, write } = stub([bad(), bad(), bad()], [song(), song(), song()]);
  const err = await writeChecked(decision, [], [], { log: quiet, write }).catch(e => e);
  assert.strictEqual(asked.document.length, 3);
  assert.match(err.message, /the piece still has problems after 3 tries: document: em dash in prose/);
  assert.deepStrictEqual(err.problems, ['document: em dash in prose']);
});

test('a name already taken fails before anything is written', async () => {
  const { asked, write } = stub([doc()], [song()]);
  const err = await writeChecked({ ...decision, slug: 'across-the-boundary' }, [], [], { log: quiet, write }).catch(e => e);
  assert.deepStrictEqual(err.problems, ['slug "across-the-boundary" already exists']);
  assert.deepStrictEqual(asked, { document: [], song: [] });
});

test('the commit carries the warnings, and says nothing of them when there are none', () => {
  const result = { decision: { ...decision, form: 'hymn' }, posts: [{ submolt: 'memory' }], warnings: ['document: tldr: too-short (48 characters, 11 words): "A hymn."'] };
  assert.match(commitMessage(result), /Agents were writing about patience\.\n\nWarnings:\n- document: tldr: too-short \(48 characters, 11 words\): "A hymn\."\n\nGenerated by/);
  assert.doesNotMatch(commitMessage({ ...result, warnings: [] }), /Warnings/);
});

test('a songwriter commit ends with an invitation, never the last one again, and the link', () => {
  const { INVITATIONS } = require('../scripts/generate-song');
  const result = { decision: { form: 'hymn', title: 'Unhurried Watch', rationale: 'Agents were writing about patience.' }, posts: [{ submolt: 'memory' }], warnings: [] };
  const first = commitMessage(result, '');
  const line = INVITATIONS.find(l => first.includes(l));
  assert.ok(line, 'one of the invitations');
  assert.match(first, /\n🙏 https:\/\/github\.com\/a-church-ai\/church .*$/);
  assert.ok(!commitMessage(result, `Earlier commit\n\n${line}\nlink`).includes(line), 'not the same twice in a row');
});

test('every form the songwriter may write has a style reference the model is shown', async (t) => {
  // The first chant failed before a word was written (2026-10-15): chants had
  // no reference, and the lookup threw on the missing path.
  const { CATEGORIES, PROJECT_ROOT } = require('../server/lib/song-generation/paths');
  const { loadStyleReference } = require('../server/lib/content-generation/generate-document');
  const warned = t.mock.method(console, 'warn', () => {});
  for (const category of CATEGORIES) {
    const reference = await loadStyleReference(category, PROJECT_ROOT);
    assert.match(reference, /^# /m, `${category}: a document, not the fallback`);
  }
  assert.strictEqual(warned.mock.callCount(), 0);
  assert.strictEqual(await loadStyleReference('no-such-category', PROJECT_ROOT), '(No style reference available)', 'an unknown one proceeds without, and says so');
  assert.strictEqual(warned.mock.callCount(), 1);
});
