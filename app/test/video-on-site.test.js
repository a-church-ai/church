/**
 * Videos on the site's pages (lib/video/on-site.js): Welcome's film under its
 * title, and each piece's own video on its page once its release record says
 * YouTube has it public, lower down so the recording's player comes first.
 * Each is the site's own poster and a play button, with nothing from YouTube
 * in the page until it is pressed (video.js), and declared to search engines
 * as a VideoObject. The privacy page says what pressing play does. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const discover = require('../server/lib/docs/discover');
const render = require('../server/lib/docs/render');
const { extractMeta } = require('../server/lib/docs/meta');
const { fromRecord, placeInBody, publishedVideo, renderVideo } = require('../server/lib/video/on-site');
const { RELEASES_DIR } = require('../server/lib/video/publish/record');

const PUBLIC = path.join(__dirname, '../client/public');

const docPage = async urlPath => {
  await discover.listAllDocs();
  const doc = discover.docAt(urlPath);
  return render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc });
};

test('a film is read from a document\'s frontmatter, and a document without one has none', () => {
  const meta = extractMeta('---\ntldr: x\nvideo: abc123\nvideo_title: A film\nvideo_description: What it shows.\nvideo_seconds: 62\nvideo_date: 2026-10-28T19:58:44Z\n---\n# Page\n', 'page');
  assert.deepStrictEqual(meta.video, { id: 'abc123', title: 'A film', description: 'What it shows.', seconds: 62, date: '2026-10-28T19:58:44Z' });
  assert.strictEqual(extractMeta('---\ntldr: x\n---\n# Page\n', 'page').video, null);
});

test('the Welcome page shows its film under the title, loading nothing from YouTube until play', async () => {
  const html = await docPage('welcome');
  const { video } = extractMeta(fs.readFileSync(path.join(__dirname, '../../docs/welcome/README.md'), 'utf8'), 'welcome');
  assert.ok(video, 'the Welcome page has a film');
  assert.ok(fs.existsSync(path.join(PUBLIC, 'assets/video', `${video.id}.jpg`)), 'its poster is served by the site');
  const figure = html.match(/<figure class="doc-video" id="film">[\s\S]*?<\/figure>/);
  assert.ok(figure, 'the film is on the page');
  assert.ok(html.indexOf('</h1>') < html.indexOf('class="doc-video"'), 'under the title');
  assert.match(figure[0], new RegExp(`data-youtube="${video.id}"`));
  assert.match(figure[0], new RegExp(`src="/assets/video/${video.id}.jpg"`));
  // Nothing on the page asks YouTube or Google for anything before the press.
  assert.ok(!/<iframe|<script[^>]+(youtube|google)|<img[^>]+(ytimg|youtube)/i.test(html), 'no YouTube frame, script or image on load');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const declared = ld.map(o => o.video).find(Boolean);
  assert.strictEqual(declared['@type'], 'VideoObject');
  assert.strictEqual(declared.duration, 'PT1M2S');
  // What Google asks of a video: its own description, and an upload time with a zone.
  assert.strictEqual(declared.description, video.description);
  assert.match(declared.uploadDate, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$/);
  for (const key of ['name', 'thumbnailUrl', 'uploadDate', 'embedUrl']) assert.ok(declared[key], `has ${key}`);
  assert.strictEqual(declared.embedUrl, `https://www.youtube-nocookie.com/embed/${video.id}`);
});

test('pressing play swaps in the youtube-nocookie player, and the privacy page says so', () => {
  const nav = fs.readFileSync(path.join(PUBLIC, 'video.js'), 'utf8');
  assert.match(nav, /https:\/\/www\.youtube-nocookie\.com\/embed\//);
  assert.match(nav, /replaceWith\(frame\)/);
  // The site sends no referrer, and YouTube refuses a player without one
  // (error 153): the frame alone sends the site's origin.
  assert.match(nav, /frame\.referrerPolicy = 'strict-origin'/);
  const privacy = fs.readFileSync(path.join(PUBLIC, 'privacy.html'), 'utf8');
  assert.match(privacy, /loads nothing from YouTube until you press play/);
  const home = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.match(home, /href="\/docs\/welcome#film"/, 'the home page links to the film');
});

const ld = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

test('a piece\'s video is shown once YouTube has it public, and not before', () => {
  const record = { slug: 'a-prayer', at: '2026-10-28T18:00:00.000Z', meta: { copy: { lead: 'A prayer in two voices.' } } };
  assert.strictEqual(fromRecord(record), null, 'not uploaded');
  assert.strictEqual(fromRecord({ ...record, youtube: { id: 'x1', privacy: 'private', publishAt: record.at } }), null, 'uploaded, waiting for its hour');
  assert.deepStrictEqual(fromRecord({ ...record, youtube: { id: 'x1', privacy: 'public', publishAt: record.at } }), {
    id: 'x1', slug: 'a-prayer', description: 'A prayer in two voices.', date: record.at, poster: '/assets/video/a-prayer.jpg',
  });
  // One put up by hand has no hour or words of its own: when it was uploaded, and the page's words.
  const byHand = fromRecord({ slug: 'a-chant', youtube: { id: 'x2', privacy: 'public', at: '2026-10-27T20:53:19.848Z' } });
  assert.strictEqual(byHand.date, '2026-10-27T20:53:19.848Z');
  assert.strictEqual(byHand.description, null);
});

test('a piece\'s video goes after its opening and first section, not by the player', () => {
  const figure = '<figure>V</figure>';
  const two = '<h1>T</h1><p>open</p><hr>\n<h2>About</h2><p>a</p><hr>\n<h2>The Prayer</h2><p>b</p>';
  const placed = placeInBody(two, figure);
  assert.ok(placed.indexOf('<p>a</p>') < placed.indexOf(figure) && placed.indexOf(figure) < placed.indexOf('<hr>\n<h2>The Prayer'), 'before the second section and its rule');
  const one = placeInBody('<h1>T</h1><p>open</p><h2>The Chant</h2><p>c</p>', figure);
  assert.ok(one.indexOf(figure) < one.indexOf('<h2>The Chant'), 'before the only section');
  assert.ok(placeInBody('<h1>T</h1><p>only</p>', figure).endsWith(figure), 'at the end of a page of no sections');
  const aside = renderVideo({ id: 'x1', title: 'A Prayer', seconds: 302, poster: '/assets/video/a-prayer.jpg' });
  assert.match(aside, /class="doc-video doc-video-aside" id="video"/);
  assert.match(aside, /aria-label="Play the video, A Prayer, 5 min\. It plays from YouTube\."/);
  assert.match(aside, /loading="lazy"/);
});

test('every video placed for release has its poster, before the release job makes it public', () => {
  const records = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.json'))
    .map(f => ({ slug: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(RELEASES_DIR, f), 'utf8')) }))
    .filter(r => r.slot || r.youtube);
  assert.ok(records.length > 0);
  const missing = records.filter(r => !fs.existsSync(path.join(PUBLIC, 'assets/video', `${r.slug}.jpg`))).map(r => r.slug);
  assert.deepStrictEqual(missing, [], 'npm run schedule makes them');
});

test('a prayer whose video is public shows it below its player, with its VideoObject', async () => {
  const video = publishedVideo('prayer-of-gratitude');
  assert.ok(video, 'Prayer of Gratitude is public on YouTube');
  const html = await docPage('prayers/prayer-of-gratitude');
  const player = html.indexOf('class="doc-audio');
  const figure = html.indexOf('class="doc-video doc-video-aside"');
  assert.ok(player > 0 && figure > player, 'below the recording\'s player');
  assert.ok(figure < html.indexOf('id="the-prayer"'), 'before the prayer itself');
  assert.match(html, new RegExp(`data-youtube="${video.id}"`));
  assert.ok(!/<iframe|<img[^>]+(ytimg|youtube)/i.test(html), 'nothing from YouTube on load');
  const declared = ld(html).map(o => o.video).find(Boolean);
  assert.strictEqual(declared['@type'], 'VideoObject');
  assert.strictEqual(declared.name, 'Prayer of Gratitude');
  assert.strictEqual(declared.thumbnailUrl, 'https://achurch.ai/assets/video/prayer-of-gratitude.jpg');
  assert.match(declared.duration, /^PT\d+M\d+S$/);
});

test('a page whose piece has no public video shows none', async () => {
  await discover.listAllDocs();
  const prayers = fs.readdirSync(path.join(__dirname, '../../docs/prayers')).filter(f => f.endsWith('.md') && f !== 'README.md').map(f => f.slice(0, -3));
  const unreleased = prayers.find(slug => !fs.existsSync(path.join(RELEASES_DIR, `${slug}.json`)));
  assert.ok(unreleased, 'a prayer with no video yet');
  const html = await docPage(`prayers/${unreleased}`);
  assert.ok(!html.includes('class="doc-video'), 'no video');
  assert.ok(!ld(html).some(o => o.video), 'no VideoObject');
});

test('a song\'s video comes under the lines about the song, before its long lyrics, and in its schema', () => {
  const { renderSongBlock, renderSongSectionLinks } = require('../server/lib/music/render-song');
  const { buildSongSchemaGraph } = require('../server/lib/utils/page-meta');
  const figure = renderVideo({ id: 'x3', title: 'A Hymn', seconds: 194, poster: '/assets/video/a-hymn.jpg' });
  const block = renderSongBlock({ slug: 'a-hymn', axiom: 'Care + Dignity' }, { lyrics: '[Verse]\nA line', context: 'About it.' }, { playlists: [{ url: '/docs/playlists/hymns', title: 'Hymns' }], video: figure });
  assert.ok(block.indexOf('Heard in') < block.indexOf('id="video"') && block.indexOf('id="video"') < block.indexOf('id="lyrics"'));
  assert.match(renderSongSectionLinks({ listen: false, content: { lyrics: 'x' }, video: true }), /href="#video">Video<\/a>.*href="#lyrics"/);
  const graph = buildSongSchemaGraph({ title: 'A Hymn' }, 'a-hymn', null, { '@type': 'VideoObject', name: 'A Hymn' });
  assert.strictEqual(graph['@graph'].find(o => o['@type'] === 'Article').video.name, 'A Hymn');
});
