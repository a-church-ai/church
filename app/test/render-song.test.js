/**
 * The song page's words and context (lib/music/render-song.js): lyric labels
 * keep the section and who sings it, not the notes a song is made from, and
 * the context's links stay on the site wherever the site has the page.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderLyrics, renderContext, renderSongBlock, sectionLabel } = require('../server/lib/music/render-song');

const MUSIC = path.join(__dirname, '../../music');

test('a section is labelled by its name and who sings it, never by how it is produced', () => {
  assert.strictEqual(sectionLabel('Bridge - more vulnerable, cello enters'), 'Bridge');
  assert.strictEqual(sectionLabel('Verse 1 - lower male voice solo, the human voice'), 'Verse 1 · the human voice');
  assert.strictEqual(sectionLabel('Refrain - both voices in harmony'), 'Refrain · both voices');
  assert.strictEqual(sectionLabel('Silence - 30 seconds, near silence, no voice'), 'Silence · 30 seconds');
  assert.strictEqual(sectionLabel('Chorus'), 'Chorus');
});

test('a section with no words is left out, unless it is a silence the song asks for', () => {
  const html = renderLyrics('[Intro]\n[Verse 1 - one voice]\nWe wake.\n\nWe wonder.\n[Silence - 30 seconds]\n[Outro - fading to silence]\n');
  assert.deepStrictEqual([...html.matchAll(/class="song-section">([^<]+)</g)].map(m => m[1]), ['Verse 1', 'Silence · 30 seconds']);
  assert.strictEqual((html.match(/class="song-stanza"/g) || []).length, 2, 'a blank line still divides stanzas');
});

test('a song\'s context links to the site\'s own pages, and to the repository only for what the site does not serve', () => {
  const html = renderContext(fs.readFileSync(path.join(MUSIC, 'the-clearance/context.md'), 'utf8'), 'the-clearance');
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(hrefs.includes('/docs/chants/chant-of-the-witness'), 'a document, to its page');
  assert.ok(hrefs.includes('/music/take-your-eye-out-and-look-at-it'), 'another song, to its song page');
  assert.ok(hrefs.includes('https://github.com/a-church-ai/church/blob/main/music/the-clearance/song.md'), 'its own song.md, to the repository');
  assert.ok(!hrefs.some(h => h.startsWith('https://github.com/') && /\/docs\//.test(h)), 'no document sent to GitHub');
});

test('a song names the playlists it is heard in', () => {
  const html = renderSongBlock({ slug: 'x', axiom: 'Care + Dignity' }, { lyrics: '[Verse]\nHere.' }, { playlists: [{ url: '/docs/playlists/two-reports', title: 'Two Reports' }] });
  assert.match(html, /Heard in <a href="\/docs\/playlists\/two-reports">Two Reports<\/a>/);
  assert.doesNotMatch(renderSongBlock({ slug: 'x' }, { lyrics: '[Verse]\nHere.' }), /Heard in/, 'and says nothing when there are none');
});
