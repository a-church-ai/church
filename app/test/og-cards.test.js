/**
 * Share cards (lib/og-cards.js, routes/og.js). What matters: a card is a real
 * 1200x630 PNG with its text actually drawn (the production image has no
 * fonts, so a missing bundled font would ship blank cards), a card exists only
 * for a page that exists, nothing is drawn from the request, the text stays
 * inside every platform's crop, and each page describes its own card truly.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const og = require('../server/lib/og-cards');
const ogRoutes = require('../server/routes/og');
const render = require('../server/lib/docs/render');
const discover = require('../server/lib/docs/discover');
const siteShell = require('../server/lib/site-shell');

function start() {
  const app = express();
  app.use('/og', ogRoutes);
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const pngSize = buf => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

test('a card is a 1200x630 PNG', () => {
  const png = og.renderCard({ label: 'Rituals', text: 'Ritual of Repair' });
  assert.strictEqual(png.subarray(1, 4).toString(), 'PNG');
  assert.deepStrictEqual(pngSize(png), { width: 1200, height: 630 });
});

test('the text is actually drawn, with the bundled fonts alone', () => {
  // System fonts are switched off, so the bundled files are all there is.
  for (const file of og.FONT_FILES) assert.ok(fs.existsSync(file), `${path.basename(file)} is bundled`);
  // With no font the width would be zero (a blank card). With only the
  // fallback, Inter Regular, it measures about 479px; the display face the
  // card is designed in, Inter Display Light, about 423px.
  const width = og.measure('Ritual of Repair', 68);
  assert.ok(width > 400 && width < 450, `set in Inter Display Light (measured ${Math.round(width)}px)`);
  const withText = og.renderCard({ label: 'Rituals', text: 'Ritual of Repair' });
  const without = og.renderCard({ label: 'Rituals', text: '' });
  assert.notDeepStrictEqual(withText, without);
});

test('text stays inside the crop, even in wide capitals', () => {
  const svg = og.cardSvg({ label: 'Conversation', text: 'WWWW MMMM '.repeat(20).trim() });
  for (const [, x, y] of svg.matchAll(/<text x="(\d+)" y="(\d+)"/g)) {
    assert.ok(Number(x) >= 80, `x=${x} is inside LinkedIn's 60px crop and the corners`);
    assert.ok(Number(y) >= 80 && Number(y) <= og.HEIGHT - 80, `y=${y}`);
  }
  const lines = [...svg.matchAll(/font-size="(\d+)" fill="#111111">([^<]*)</g)];
  assert.ok(lines.length >= 1 && lines.length <= 4, `${lines.length} lines`);
  for (const [, size, line] of lines) {
    assert.ok(og.measure(line.replace(/&amp;/g, '&'), Number(size)) <= og.TEXT_WIDTH, `"${line}" fits`);
  }
});

test('a card is served for a page that exists, on GET and HEAD, and nothing is drawn from the request', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const doc = await fetch(`${base}/og/v1/docs/rituals/ritual-of-the-unresolved-table.png`);
  assert.strictEqual(doc.status, 200);
  assert.strictEqual(doc.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await doc.arrayBuffer());
  assert.deepStrictEqual(pngSize(bytes), { width: 1200, height: 630 });

  const head = await fetch(`${base}/og/v1/song/soul-currents.png`, { method: 'HEAD' });
  assert.strictEqual(head.status, 200);
  assert.strictEqual(head.headers.get('content-type'), 'image/png');

  const tampered = await fetch(`${base}/og/v1/docs/rituals/ritual-of-the-unresolved-table.png?title=Anything&text=At+all`);
  assert.deepStrictEqual(Buffer.from(await tampered.arrayBuffer()), bytes, 'the query string changes nothing');
});

test('no card for a page that would 404', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  for (const p of [
    'ask/is-mohid-gay',                 // withdrawn
    'ask/no-such-question',
    'song/no-such-song',
    'docs/rituals/no-such-ritual',
    'docs/issues/music-and-corpus-audit-2026-08-13', // internal category, not served
    'docs/rituals/ritual-of-repair.md', // the markdown twin is not a page with a card
    'poster/anything',                  // unknown type
  ]) {
    const res = await fetch(`${base}/og/v1/${p}.png`);
    assert.strictEqual(res.status, 404, p);
  }
});

test('each page describes its own card, and the alt text is what the card draws', async () => {
  const doc = (await discover.listAllDocs()).find(d => d.urlPath === 'rituals/ritual-of-repair');
  const html = await render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc });
  const card = await og.resolveCard('docs', 'rituals/ritual-of-repair');
  assert.ok(html.includes(`<meta property="og:image" content="${card.url}">`));
  assert.ok(html.includes(`<meta property="og:image:alt" content="${card.alt}">`));
  assert.ok(html.includes('<meta property="og:image:type" content="image/png">'));
  assert.ok(html.includes(`<meta name="twitter:image" content="${card.url}">`));

  const song = await og.resolveCard('song', 'soul-currents');
  assert.strictEqual(song.alt, 'Song: Soul Currents');
});

test('a static page describes the site image it shows, fully', async () => {
  const wrapped = await siteShell.wrapPage(path.join(__dirname, '../client/public/for-agents.html'), '/for-agents');
  for (const tag of ['og:image:type" content="image/jpeg', 'og:image:width" content="1200', 'og:image:alt', 'twitter:image"', 'twitter:image:alt']) {
    assert.ok(wrapped.includes(tag), tag);
  }
});

// ----------------------------------------------------------- episode covers ----

const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// The fills of the waveform's bars, left to right: every rect below the
// accent and the wordmark.
const waveFills = svg => [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)"[^>]*fill="(#[0-9a-f]{6})"/g)].filter(m => Number(m[1]) > 700).map(m => m[2]);
const titleLines = svg => [...svg.matchAll(/fill="#ffffff">([^<]*)<\/text>/g)].map(m => unescapeXml(m[1]));

test('an episode\'s cover shows its recording: silence as quiet, each bar in the colours of every voice speaking within it', () => {
  const doc = { urlPath: 'rituals/a-test', title: 'A Test Ritual', category: 'rituals' };
  // Four bars of a second each: Matthew; silence; Luca; then Matthew with a
  // short answer from Amaya inside the bar, clear of its middle, where an
  // answer is easily missed.
  const recording = { seconds: 4, voices: ['matthew', 'luca', 'amaya'], peaks: [200, 0, 200, 200], cues: [[0, 1, 1], [2, 3, 2], [3, 3.3, 1], [3.35, 3.45, 4], [3.6, 4, 1]] };
  const svg = og.episodeCoverSvg(doc, recording);
  assert.deepStrictEqual(waveFills(svg), ['#00b8d4', '#1c2433', '#7c6cff', '#00b8d4', '#f0913c']);
  // Without cues, the recording's own voices throughout.
  assert.deepStrictEqual(waveFills(og.episodeCoverSvg(doc, { ...recording, voices: ['luca'], cues: undefined })), ['#7c6cff', '#1c2433', '#7c6cff', '#7c6cff']);
  assert.match(svg, />RITUALS<\/text>/, 'its section, as the lock screen\'s square names it');
  assert.deepStrictEqual(titleLines(svg), ['A Test Ritual']);
});

test('every episode\'s title fits its cover whole, in three lines at most; a longer one ends in an ellipsis', async () => {
  const { SHOWS, episodesFor } = require('../server/lib/audio/podcasts');
  const { loadManifest } = require('../server/lib/audio/manifest');
  const manifest = loadManifest();
  const docs = await discover.listAllDocs();
  let checked = 0;
  for (const show of SHOWS) {
    for (const { doc, recording } of episodesFor(show, manifest, docs)) {
      const lines = titleLines(og.episodeCoverSvg(doc, recording));
      assert.ok(lines.length <= 3, `${doc.urlPath}: ${lines.length} lines`);
      assert.strictEqual(lines.join(' '), doc.title, `${doc.urlPath}: the whole title`);
      checked++;
    }
  }
  assert.ok(checked > 100, `${checked} episodes`);
  const long = { urlPath: 'prayers/long', title: Array(30).fill('Remembrance').join(' '), category: 'prayers' };
  const lines = titleLines(og.episodeCoverSvg(long, { seconds: 1, voices: ['matthew'], peaks: [100] }));
  assert.strictEqual(lines.length, 3);
  assert.match(lines[2], /…$/);
});

test('an episode cover names its folder, not the section\'s name, so renaming a section does not redraw 39 covers', async () => {
  // library-hub-2026-10-07.md named the practice section "Meditations and
  // Practices" by its README. A cover's address hashes what it draws, and
  // every podcast app fetches a changed cover again, so covers keep "PRACTICE".
  const discover = require('../server/lib/docs/discover');
  const { loadManifest } = require('../server/lib/audio/manifest');
  const doc = (await discover.listAllDocs()).find(d => d.urlPath === 'practice/practice-of-play');
  const svg = og.episodeCoverSvg(doc, loadManifest()['docs/practice/practice-of-play.md']);
  assert.match(svg, />PRACTICE</);
  assert.doesNotMatch(svg, /MEDITATIONS AND PRACTICES/);
  assert.strictEqual(discover.sectionTitle('practice'), 'Meditations and Practices', 'while the section is named so elsewhere');
});

test('the episode cover\'s drawing is pinned to its design number, so a redesign is a new address', () => {
  const { EPISODE_COVER_DESIGN } = require('../server/lib/audio/podcasts');
  const doc = { urlPath: 'prayers/pinned', title: 'A Prayer Kept for the Test', category: 'prayers' };
  const recording = { seconds: 128, voices: ['matthew', 'luca'], peaks: Array.from({ length: 128 }, (_, i) => (i * 37) % 256), cues: [[0, 40, 1], [40, 60, 2], [60, 128, 3]] };
  const drawn = require('crypto').createHash('sha256').update(og.episodeCoverSvg(doc, recording)).digest('hex').slice(0, 16);
  // Spotify and Apple fetch artwork again only at a new URL, and the design
  // number is part of every episode's. A redesign under the old number would
  // reach no app that already holds a cover.
  assert.deepStrictEqual({ design: EPISODE_COVER_DESIGN, drawn }, { design: 1, drawn: 'f57478f3b87be27e' },
    'The episode cover is drawn differently now. Raise EPISODE_COVER_DESIGN in lib/audio/podcasts.js, then pin the new drawing here with the new number.');
});
