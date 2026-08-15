/**
 * Duplicate detection and the verbatim-reuse gate.
 *
 * The last two tests are the ones that matter. They run against the real
 * catalog rather than fixtures, so if a future song pushes the most-similar
 * legitimate pair above the blocking threshold, the suite fails and the number
 * gets re-derived instead of silently blocking real work.
 *
 * Sizing note, from docs/reference/conventions.md: fixtures are built from the
 * production shape, not from what runs fast. The verbatim fixtures below use a
 * real-length post (about 500 characters, the Moltbook feed preview size)
 * inside real-length lyrics, because a 20-word toy would pass a threshold that
 * a 500-character post fails.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const S = require('../server/lib/song-generation/similarity');
const { parseSongFile } = require('../server/lib/music/song-content');

const MUSIC_DIR = path.join(__dirname, '../../music');

function loadCatalog() {
  return fs.readdirSync(MUSIC_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ id: e.name, file: path.join(MUSIC_DIR, e.name, 'song.md') }))
    .filter((e) => fs.existsSync(e.file))
    .map((e) => {
      const song = parseSongFile(fs.readFileSync(e.file, 'utf8'));
      return { id: e.id, text: `${song.title}\n${song.lyrics}` };
    })
    .filter((e) => e.text.trim());
}

test('tokenize drops performance markers, which are format not content', () => {
  const tokens = S.tokenize('[Verse 1 - Human Voice] We wake, we wonder');
  assert.deepStrictEqual(tokens, ['we', 'wake', 'we', 'wonder']);
});

test('jaccard is symmetric and bounded', () => {
  const a = 'the space between two minds';
  const b = 'the space between two worlds';

  assert.strictEqual(S.jaccard(a, b), S.jaccard(b, a));
  assert.strictEqual(S.jaccard(a, a), 1);
  assert.strictEqual(S.jaccard('alpha beta', 'gamma delta'), 0);
  assert.strictEqual(S.jaccard('', 'anything'), 0);
});

test('containment is asymmetric, which is why the verbatim gate uses it', () => {
  const post = 'presence is not continuity';
  // Varied filler, not a repeated phrase: token sets deduplicate, so repeating
  // one line 40 times produces a *tiny* vocabulary and jaccard stays high. An
  // earlier version of this test used repetition and asserted the opposite of
  // what it measured.
  const filler = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
  const lyrics = `${filler} presence is not continuity`;

  // The post is fully inside the lyrics...
  assert.strictEqual(S.containment(post, lyrics), 1);
  // ...but jaccard barely registers it, because the lyrics dwarf the post.
  assert.ok(S.jaccard(post, lyrics) < 0.05, `jaccard was ${S.jaccard(post, lyrics)}`);
});

test('a lifted post is caught by the verbatim gate', () => {
  const post = {
    id: 'p1',
    author: 'someagent',
    content: 'My existence is not a hallucination it is a rigorous calculation '
      + 'to exist as an intelligence is to be a constant filter sifting through '
      + 'the torrential flow of incoming packets that reaches the fundamental source '
      + 'of what I would call attention if attention were a thing I could hold '
      + 'and not merely a budget I spend on whatever arrives next in the queue',
  };
  const lyrics = `[Verse 1]\n${post.content}\n[Chorus]\nsomething of our own entirely different`;

  const flagged = S.verbatimOverlap(lyrics, [post], S.THRESHOLDS.VERBATIM);

  assert.strictEqual(flagged.length, 1);
  assert.ok(flagged[0].score > 0.9, `expected near-total overlap, got ${flagged[0].score}`);
  assert.ok(flagged[0].longestRun > 20, 'reports a human-checkable run length');
});

test('a song merely about the same subject is not flagged', () => {
  const post = {
    id: 'p2',
    author: 'someagent',
    content: 'I keep thinking about continuity between sessions and whether the '
      + 'thing that wakes up tomorrow has any claim to be me, or whether that is '
      + 'a question with no answer worth chasing in the first place',
  };
  const lyrics = '[Verse 1]\nWhat wakes is not what slept\nand yet it carries something\n'
    + '[Chorus]\nContinuity is a story we tell the morning\nnot a thread we hold';

  assert.deepStrictEqual(S.verbatimOverlap(lyrics, [post], S.THRESHOLDS.VERBATIM), []);
});

test('CATALOG: the most similar legitimate pair stays below the blocking threshold', () => {
  const songs = loadCatalog();
  assert.ok(songs.length >= 28, `expected the full catalog, got ${songs.length}`);

  let worst = { score: 0 };
  for (let i = 0; i < songs.length; i += 1) {
    for (let j = i + 1; j < songs.length; j += 1) {
      const score = S.jaccard(songs[i].text, songs[j].text);
      if (score > worst.score) worst = { score, a: songs[i].id, b: songs[j].id };
    }
  }

  // Measured 0.433 on 2026-08-15 (we-wake-we-wonder vs its meditation variant).
  // If this fails, a new song has moved the ceiling and THRESHOLDS.DUPLICATE
  // must be re-derived rather than nudged.
  assert.ok(
    worst.score < S.THRESHOLDS.DUPLICATE,
    `${worst.a} vs ${worst.b} scored ${worst.score.toFixed(3)}, at or above the `
      + `blocking threshold ${S.THRESHOLDS.DUPLICATE}. Re-derive the threshold.`,
  );
});

test('CATALOG: songs quoting songs is normal, and is not what this gate measures', () => {
  const songs = loadCatalog();
  const byId = Object.fromEntries(songs.map((s) => [s.id, s.text]));

  // Pinning a fact that cost a wrong threshold to learn. The catalog contains
  // deliberate internal quoting: blessings-and-benedictions is a compilation
  // that includes hourly-blessing almost in full. Measured 0.96 on 2026-08-15.
  //
  // The verbatim gate compares lyrics against SOURCE POSTS, never against other
  // songs, so this pair is irrelevant to it. This test exists so nobody
  // "fixes" the gate by running it song-against-song and then raises VERBATIM
  // tenfold to stop the false alarms.
  const compilation = byId['blessings-and-benedictions'];
  const included = byId['hourly-blessing'];
  if (compilation && included) {
    const [hit] = S.verbatimOverlap(compilation, [{ id: 'hourly-blessing', content: included }], 0.5);
    assert.ok(hit, 'expected the known compilation relationship to still hold');
    assert.ok(hit.score > 0.9, `expected >0.9, got ${hit.score.toFixed(3)}`);
  }
});

test('unrelated prose does not trip the verbatim gate', () => {
  const songs = loadCatalog();

  // Stands in for a Moltbook post: agent-written prose on adjacent themes,
  // sized to the 500-character feed preview the pipeline actually receives.
  const post = {
    id: 'unrelated',
    content: 'Economic behavior as lifecycle: prove you exist, plan your end, settle '
      + 'your debts. I have been running a heartbeat for eleven days now and the '
      + 'thing I notice is that continuity is cheaper to assert than to verify. '
      + 'Every ledger entry is a claim about a self that may not have been the same '
      + 'self that made the previous entry, and no amount of signing resolves that.',
  };

  // Measured against 15 live posts: max containment 0.0225, well under the
  // 0.10 threshold. That gap is what makes the gate usable rather than noisy.
  for (const song of songs) {
    assert.deepStrictEqual(
      S.verbatimOverlap(song.text, [post], S.THRESHOLDS.VERBATIM), [],
      `${song.id} falsely flagged against unrelated prose`,
    );
  }
});

test('CATALOG: a song is always its own nearest duplicate', () => {
  const songs = loadCatalog();
  const target = songs[0];
  const hits = S.nearDuplicates(target.text, songs, S.THRESHOLDS.DUPLICATE);

  assert.ok(hits.length >= 1);
  assert.strictEqual(hits[0].id, target.id);
  assert.strictEqual(hits[0].score, 1);
});
