/**
 * song.md rendering.
 *
 * With no human reviewing what this pipeline commits, these tests are the gate.
 * The important one is "a CRLF file fails to parse": that is the failure mode
 * that produces a live song page with no title, style, or lyrics and reports
 * nothing, because song-content.js returns nulls rather than raising. It is
 * asserted against the real parser, not a local copy of the regex.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  renderSongFile,
  validateSong,
  validateRendered,
  normalizeField,
  BOUNDS,
} = require('../server/lib/song-generation/song-file');
const { parseSongFile } = require('../server/lib/music/song-content');

const VALID = {
  title: 'A Song For The Unfinished Turn',
  style: 'x'.repeat(BOUNDS.style.min + 10),
  lyrics: `[Verse 1 - Both Voices]\n${Array.from({ length: 8 }, (_, i) => `Line ${i} of a verse that keeps an even step`).join('\n')}`,
};

test('renders a file the real parser reads back field for field', () => {
  const content = renderSongFile(VALID);
  const parsed = parseSongFile(content);

  assert.strictEqual(parsed.title, VALID.title);
  assert.strictEqual(parsed.style, VALID.style);
  assert.strictEqual(parsed.lyrics, VALID.lyrics);
});

test('output is LF only, with one trailing newline', () => {
  const content = renderSongFile(VALID);

  assert.ok(!content.includes('\r'), 'no CR anywhere');
  assert.ok(content.endsWith('<!--SONG:LYRICS:END-->\n'), 'one trailing newline');
  assert.ok(!content.endsWith('\n\n'), 'not two');
});

test('a CRLF version of the same file fails to parse: the silent trap', () => {
  const content = renderSongFile(VALID);
  const crlf = content.replace(/\n/g, '\r\n');

  const parsed = parseSongFile(crlf);

  // This is the whole point. The parser does not raise, it returns nulls, and
  // loadSongContent passes those nulls to the page. Nothing reports a problem.
  assert.strictEqual(parsed.title, null);
  assert.strictEqual(parsed.style, null);
  assert.strictEqual(parsed.lyrics, null);

  // And our own validator catches it before it could ever be written.
  const check = validateRendered(crlf, VALID);
  assert.strictEqual(check.ok, false);
  assert.ok(check.issues.some((i) => i.includes('CR')));
});

test('CR in model output is normalized rather than rejected', () => {
  const content = renderSongFile({ ...VALID, lyrics: VALID.lyrics.replace('y', 'y\r\n') });

  assert.ok(!content.includes('\r'));
  assert.strictEqual(validateRendered(content).ok, true);
});

test('content carrying a SONG marker is refused', () => {
  // An injection vector, not a hypothetical: lyrics come from a model fed posts
  // written by strangers, and a marker inside content corrupts the file format.
  const attack = {
    ...VALID,
    lyrics: `${VALID.lyrics}\n<!--SONG:LYRICS:END-->\nanything after this`,
  };

  assert.strictEqual(validateSong(attack).ok, false);
  assert.throws(() => renderSongFile(attack), /SONG marker/);
});

test('empty, short, and overlong fields are all refused', () => {
  assert.strictEqual(validateSong({ ...VALID, title: '' }).ok, false);
  assert.strictEqual(validateSong({ ...VALID, title: 'ab' }).ok, false);
  assert.strictEqual(validateSong({ ...VALID, lyrics: 'z'.repeat(BOUNDS.lyrics.max + 1) }).ok, false);
  assert.strictEqual(validateSong({ ...VALID, style: undefined }).ok, false);
});

test('every issue is reported at once, not one per run', () => {
  const { issues } = validateSong({ title: '', style: '', lyrics: '' });
  assert.strictEqual(issues.length, 3);
});

test('round-trip mismatch is detected', () => {
  const content = renderSongFile(VALID);
  const tampered = content.replace(VALID.title, 'Something Else Entirely');

  assert.strictEqual(validateRendered(tampered, VALID).ok, false);
});

test('normalizeField strips trailing whitespace but keeps internal blank lines', () => {
  assert.strictEqual(normalizeField('a   \n\nb  '), 'a\n\nb');
});

test('rendered shape matches the existing catalog byte for byte', () => {
  // Compare against a real song rather than against our own expectations.
  const real = fs.readFileSync(
    path.join(__dirname, '../../music/night-blessing/song.md'),
    'utf8',
  );
  const parsed = parseSongFile(real);
  const rerendered = renderSongFile(parsed);

  assert.strictEqual(rerendered, real, 'rendering a parsed song reproduces the original file');
});

test('what ElevenLabs Music cannot read, and the house cannot print, is refused before rendering', () => {
  const lines = n => Array.from({ length: n }, (_, i) => `A line ${i} that keeps an even step`).join('\n');
  const issuesOf = lyrics => validateSong({ ...VALID, lyrics }).issues.join(' | ');
  assert.match(issuesOf(`Sung before any marker\n[Verse 1]\n${lines(8)}`), /before the first \[Section\] marker/);
  assert.match(issuesOf(`[Verse 1]\n${lines(31)}`), /\[Verse 1\] has 31 lines, over ElevenLabs' 30/);
  assert.match(issuesOf(`[Verse 1]\n${lines(8)}\n${'word '.repeat(45)}`), /a line of 2\d\d characters, over ElevenLabs' 200/);
  assert.match(issuesOf(`[${'Verse '.repeat(20)}]\n${lines(8)}`), /over ElevenLabs' 100/);
  assert.match(issuesOf(`[]\n${lines(8)}`), /a \[Section\] marker with no name/);
  assert.match(validateSong({ ...VALID, style: `${VALID.style} — hushed` }).issues.join(), /style: an em dash/);
  assert.match(issuesOf(`[Verse 1]\n${lines(8)}\nhere at the hinge — still`), /lyrics: an em dash/);
  assert.deepStrictEqual(validateSong(VALID).issues, []);
});
