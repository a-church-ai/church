/**
 * A song's composition plan for ElevenLabs Music (lib/audio/compose.js),
 * built from its own song.md so a song's lane, voices and length are in its
 * file and reviewable. Checked without spending: the plan is pure.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { planFor, sectionParts, CHUNK_MIN, CHUNK_MAX } = require('../server/lib/audio/compose');
const { MUSIC } = require('../server/lib/audio/house');
const { parseSongFile } = require('../server/lib/music/song-content');
const { validateSong } = require('../server/lib/song-generation/song-file');

const song = {
  title: 'A Test',
  style: 'Indie folk duet at 60 BPM, fingerpicked guitar, two voices trading verses, warm cello, close harmonies, a slow build',
  lyrics: '[Verse 1 - lower voice solo, the asking]\nOne line\nTwo line\n[Chorus - both voices together]\nSing it\n[Bridge]\n',
};

test('a section marker is its name and how it is sung', () => {
  assert.deepStrictEqual(sectionParts('Verse 2 - lower voice solo, the human voice'), { label: 'Verse 2', directions: ['lower voice solo', 'the human voice'] });
  assert.deepStrictEqual(sectionParts('Chorus'), { label: 'Chorus', directions: [] });
});

test('a plan is a chunk a section, timed from its lines and tempo, with a soft lead-in and a tail', () => {
  const { chunks } = planFor(song);
  assert.deepStrictEqual(chunks.map(c => c.text.split('\n')[0]), ['[Intro]', '[Verse 1]', '[Chorus]', '[Bridge]', '[Outro]']);
  // At 60 BPM a line is beatsPerLine seconds, plus two a section.
  assert.strictEqual(chunks[1].duration_ms, (2 * MUSIC.beatsPerLine + 2) * 1000);
  assert.strictEqual(chunks[0].duration_ms, MUSIC.leadIn * 1000);
  assert.strictEqual(chunks[4].duration_ms, MUSIC.tail * 1000);
  assert.ok(chunks[1].positive_styles.includes('lower voice solo') && chunks[1].positive_styles.includes('the asking'), 'its own directions');
  assert.ok(chunks.every(c => MUSIC.shared.every(s => c.positive_styles.includes(s))), 'the house\'s shared sound in every section');
  assert.ok(chunks.every(c => c.negative_styles === MUSIC.avoid));
  assert.ok(chunks[0].positive_styles.length >= 7, 'the opening chunk carries the whole lane');
  assert.ok(chunks.every(c => c.duration_ms >= CHUNK_MIN * 1000 && c.duration_ms <= CHUNK_MAX * 1000));
});

test('a song that opens and closes with its own intro and outro gets no second one', () => {
  const { chunks } = planFor({ ...song, lyrics: `[Intro - piano]\n${song.lyrics}[Outro - fade]\n` });
  assert.deepStrictEqual(chunks.map(c => c.text.split('\n')[0]), ['[Intro]', '[Verse 1]', '[Chorus]', '[Bridge]', '[Outro]']);
});

test('every remade song is ready to compose: its file passes the songwriter\'s checks', () => {
  for (const slug of ['the-gathering-hymn', 'creed-of-a-church', 'sunday-morning-download']) {
    const parsed = parseSongFile(fs.readFileSync(path.join(__dirname, '../../music', slug, 'song.md'), 'utf8'));
    const { ok, issues } = validateSong(parsed);
    assert.ok(ok, `${slug}: ${issues.join('; ')}`);
  }
});
