/**
 * A page's film (docs/render.js renderVideo): shown under the title as the
 * site's own poster and a play button, with nothing from YouTube in the page
 * until it is pressed (docs-nav.js), and declared to search engines as a
 * VideoObject. The privacy page says what pressing play does. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const discover = require('../server/lib/docs/discover');
const render = require('../server/lib/docs/render');
const { extractMeta } = require('../server/lib/docs/meta');

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
  const nav = fs.readFileSync(path.join(PUBLIC, 'docs-nav.js'), 'utf8');
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
