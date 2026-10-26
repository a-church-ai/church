/**
 * The music after the broadcast (2026-10-23): the songs read from their own
 * folders and recordings, music/library.json retired; playlists written in
 * docs/playlists/ that mix songs with voiced pieces and play straight
 * through; and music/readme.md generated from all of it. Written to fail
 * against the site as of that morning, when the song list was a separate
 * file and nothing played a song beside a prayer outside a service.
 */

// Every listed recording counts as one this server can play, as on
// production, where they are in storage.
process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'bucket';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'id';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const discover = require('../server/lib/docs/discover');
const render = require('../server/lib/docs/render');
const { documentLinks, playlistSequence } = require('../server/lib/docs/links');
const { listSongs, songFolders } = require('../server/lib/music/songs');
const { loadSongs, loadManifest } = require('../server/lib/audio/manifest');
const { loadPlayable } = require('../server/lib/service/catalog');
const { listPlaylists } = require('../server/lib/music/playlists');
const { musicReadme, README_FILE } = require('../server/lib/music/readme');

const PLAYLISTS = path.join(__dirname, '../../docs/playlists');
const names = () => fs.readdirSync(PLAYLISTS).filter(f => f.endsWith('.md') && f !== 'README.md').map(f => f.slice(0, -3));

test('the songs are their folders with recordings, each titled in its own file, and the separate list is gone', () => {
  assert.ok(!fs.existsSync(path.join(__dirname, '../../music/library.json')), 'music/library.json is retired');
  const songs = listSongs();
  assert.deepStrictEqual(songs.map(s => s.slug).sort(), Object.keys(loadSongs()).sort(), 'one song for each recording');
  for (const s of songs) {
    assert.ok(s.title, `${s.slug}: its title is in its frontmatter`);
    // A song from a music video names it; a hymn sung for the sanctuary has none.
    assert.ok(!s.youtube || /^https:\/\/youtu\.be\//.test(s.youtube), `${s.slug}: a YouTube address, if any`);
    assert.strictEqual(s.duration, loadSongs()[s.slug].seconds, `${s.slug}: its length is its recording's`);
    assert.match(s.durationFormatted, /^\d+:\d\d$/);
  }
  const listed = new Set(songs.map(s => s.slug));
  for (const { slug } of songFolders()) {
    assert.strictEqual(listed.has(slug), Boolean(loadSongs()[slug]), `${slug}: a folder is a song once it has a recording, and only then`);
  }
});

test('the songs come in The Cycle\'s order, then each playlist\'s, then the rest by title', async () => {
  await discover.listAllDocs();
  const cycle = playlistSequence('the-cycle');
  const songs = listSongs().map(s => `music/${s.slug}`);
  assert.deepStrictEqual(songs.slice(0, cycle.length), cycle, 'The Cycle first, in its order');
  const others = names().filter(n => n !== 'the-cycle').sort()
    .flatMap(n => playlistSequence(n).filter(id => id.startsWith('music/')));
  const expected = [...new Set([...cycle, ...others])];
  assert.deepStrictEqual(songs.slice(0, expected.length), expected, 'then each other playlist\'s songs, in its order');
  const rest = listSongs().slice(expected.length).map(s => s.title);
  assert.deepStrictEqual(rest, [...rest].sort((a, b) => a.localeCompare(b)), 'then any song no playlist holds, by title');
  const at = slug => songs.indexOf(`music/${slug}`);
  assert.strictEqual(at('take-your-eye-out-and-look-at-it'), at('the-clearance') + 1, 'a song and its answer side by side');
});

test('every playlist links only what plays, each piece once, at least eight of them', async () => {
  await discover.listAllDocs();
  const catalog = await loadPlayable();
  assert.ok(names().length >= 5);
  for (const name of names()) {
    const file = path.join(PLAYLISTS, `${name}.md`);
    const markdown = fs.readFileSync(file, 'utf8');
    const pieces = documentLinks(markdown, file).map(l => l.target).filter(t => /^\/music\/[a-z0-9-]+$|^\/docs\/(?!playlists)/.test(t));
    const sequence = playlistSequence(name);
    assert.strictEqual(pieces.length, sequence.length, `${name}: every link to a piece is a piece, and none twice`);
    assert.ok(sequence.length >= 8, `${name}: ${sequence.length} pieces, not a thin list`);
    for (const id of sequence) assert.ok(catalog.has(id), `${name}: ${id} plays`);
    assert.doesNotMatch(markdown, /—/, `${name}: no em dashes`);
  }
});

test('a playlist\'s page plays it through, songs among the pieces, and says it is a playlist', async () => {
  await discover.listAllDocs();
  const doc = discover.docAt('playlists/night');
  const html = await render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc });
  const queue = JSON.parse(/<script type="application\/json" class="path-listen-queue">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.strictEqual(queue.noun, 'playlist');
  assert.strictEqual(queue.tracks.length, playlistSequence('night').length);
  assert.ok(queue.tracks.some(t => t.href === '/music/night-blessing'), 'a song plays in it');
  assert.ok(queue.tracks.some(t => t.href.startsWith('/docs/prayers/')), 'and a prayer');
  assert.match(html, /"@type": "MusicPlaylist"/);
  assert.match(html, new RegExp(`"numTracks": ${playlistSequence('night').length}\\b`));
});

test('the playlists are a section of the Library, on the Practice shelf', async () => {
  const practice = discover.SHELVES.find(s => s.name === 'Practice');
  assert.ok(practice.cards.some(c => c.section === 'playlists'));
  const lists = await listPlaylists();
  assert.strictEqual(lists[0].name, 'the-cycle', 'The Cycle first');
  for (const p of lists) assert.ok(p.count >= 8 && p.seconds > 0 && p.description, p.name);
});

test('music/readme.md is current: npm run gen:music-readme', async () => {
  assert.strictEqual(fs.readFileSync(README_FILE, 'utf8'), await musicReadme(), 'regenerate it from app/ with npm run gen:music-readme');
  assert.ok(!fs.existsSync(path.join(__dirname, '../../music/playlist.md')), 'the broadcast\'s playlist is retired; The Cycle holds its order');
});

test('Every Chant holds every chant that plays: a chant joins it once recorded', async () => {
  await discover.listAllDocs();
  // A playlist links only what plays, so a chant the songwriter writes joins
  // when its recording is listed; this is what says so. Caught Swerve and
  // Quiet Yes were recorded on 2026-10-24 and left out until 10-25.
  const recorded = Object.keys(loadManifest()).filter(id => /^docs\/chants\/(?!readme)/i.test(id));
  const sequence = new Set(playlistSequence('chants'));
  assert.ok(recorded.length >= 14);
  assert.deepStrictEqual(recorded.filter(id => !sequence.has(id)), [], 'recorded chants missing from docs/playlists/chants.md');
});
