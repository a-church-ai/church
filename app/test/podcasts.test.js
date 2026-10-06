/**
 * The podcasts (lib/audio/podcasts.js, routes/podcasts.js): the recordings as
 * two RSS feeds. What matters: every recording but a chant is an episode of
 * exactly one show; a feed is well-formed RSS carrying what Spotify and Apple require; an
 * episode's file size is exact, and its guid and date survive a re-render;
 * the paths subscribers hold do not move; each show has a 3000px RGB cover;
 * and each episode has its own, at an address that changes with what it
 * shows.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { SHOWS, OWNER_EMAIL, feedPath, coverPath, guidFor, duration, episodesFor, buildFeed, showForSection, feedFor, episodeCoverHash, episodeCoverPath, episodeSquarePath } = require('../server/lib/audio/podcasts');
const { loadManifest } = require('../server/lib/audio/manifest');
const discover = require('../server/lib/docs/discover');

const SITE = 'https://achurch.ai';
const CACHE_DIR = path.join(__dirname, '../media/audio');

function serve(app) {
  return new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
}

// Enough of an XML parser to say a document is well-formed: one root, every
// tag closed in the order it was opened, and no markup character or bare
// ampersand loose in text or in an attribute.
function assertWellFormed(xml) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n/);
  const body = xml.replace(/^<\?xml[^?]*\?>/, '');
  const loose = /[<>]|&(?!(?:amp|lt|gt|quot|apos|#\d+);)/;
  const stack = [];
  let roots = 0;
  let last = 0;
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    const text = body.slice(last, m.index);
    assert.doesNotMatch(text, stack.length ? loose : /\S/, `text before <${m[1]}${m[2]}>`);
    for (const [, value] of m[3].matchAll(/="([^"]*)"/g)) assert.doesNotMatch(value, loose, `an attribute of <${m[2]}>`);
    if (m[1]) {
      assert.strictEqual(stack.pop(), m[2], `</${m[2]}> closes the element that is open`);
    } else {
      if (!stack.length) roots++;
      if (!m[4]) stack.push(m[2]);
    }
    last = m.index + m[0].length;
  }
  assert.doesNotMatch(body.slice(last), /\S/, 'nothing after the root');
  assert.strictEqual(roots, 1, 'one root');
  assert.deepStrictEqual(stack, [], 'every element closed');
}

const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const items = xml => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
const text = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`)); return m ? unescape(m[1]) : null; };
const attr = (xml, name, a) => { const m = xml.match(new RegExp(`<${name}\\s[^>]*?\\b${a}="([^"]*)"`)); return m ? unescape(m[1]) : null; };

// The pixels of a PNG this site writes: 8-bit RGB, every row filtered Sub.
function rgbPixels(png) {
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < png.length) {
    const n = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + n);
    if (type === 'IHDR') [width, height] = [data.readUInt32BE(0), data.readUInt32BE(4)];
    if (type === 'IDAT') idat.push(data);
    pos += 12 + n;
  }
  const rows = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3 + 1;
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    assert.strictEqual(rows[y * stride], 1, `row ${y} filtered Sub`);
    for (let x = 0; x < width * 3; x++) {
      out[y * width * 3 + x] = (rows[y * stride + 1 + x] + (x >= 3 ? out[y * width * 3 + x - 3] : 0)) & 0xff;
    }
  }
  return { width, height, at: (x, y) => [...out.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)] };
}

// Chants are voiced to open the services (lib/service), not as episodes: each
// is under a minute, three times through.
test('every recording but a chant is an episode of exactly one show: prayers and rituals in one, practices in the other', async () => {
  const manifest = loadManifest();
  const docs = await discover.listAllDocs();
  const showOf = new Map();
  for (const show of SHOWS) {
    for (const { source } of episodesFor(show, manifest, docs)) {
      assert.ok(!showOf.has(source), `${source} is in one show only`);
      showOf.set(source, show.id);
    }
  }
  const episodes = Object.keys(manifest).filter(source => !source.startsWith('docs/chants/')).sort();
  assert.ok(episodes.length < Object.keys(manifest).length, 'the chants are voiced, and left out');
  assert.deepStrictEqual([...showOf.keys()].sort(), episodes, 'every recording but the chants, each with its page');
  for (const [source, id] of showOf) {
    assert.strictEqual(id, source.startsWith('docs/practice/') ? 'meditations-and-practices' : 'prayers-and-rituals', source);
  }
});

test('every recording carries its exact size and the moment it was first published', () => {
  for (const [source, rec] of Object.entries(loadManifest())) {
    assert.ok(Number.isInteger(rec.bytes) && rec.bytes > 0, `${source}: bytes`);
    assert.strictEqual(new Date(rec.published).toISOString(), rec.published, `${source}: published, an ISO time`);
    assert.ok(Date.parse(rec.published) <= Date.now(), `${source}: published in the past`);
    assert.ok(rec.rendered >= rec.published.slice(0, 10), `${source}: rendered no earlier than first published`);
    // The recording itself, where this checkout has a copy.
    const local = path.join(CACHE_DIR, rec.file);
    if (fs.existsSync(local)) assert.strictEqual(fs.statSync(local).size, rec.bytes, `${source}: bytes is the file's own size`);
  }
});

test('a feed is well-formed RSS with what Spotify and Apple require of a show', async () => {
  for (const show of SHOWS) {
    const xml = await feedFor(show.id);
    assertWellFormed(xml);
    assert.match(xml, /<rss version="2\.0" xmlns:itunes="http:\/\/www\.itunes\.com\/dtds\/podcast-1\.0\.dtd"/);
    const channel = xml.slice(0, xml.indexOf('<item>'));
    assert.strictEqual(text(channel, 'title'), show.title);
    assert.ok(show.description.length > 0 && show.description.length <= 4000, `${show.id}: a description within the 4000 characters directories show`);
    assert.doesNotMatch(show.description, /\u2014/, `${show.id}: no em dashes in the show's copy`);
    assert.strictEqual(text(channel, 'description'), show.description);
    assert.strictEqual(text(channel, 'language'), 'en');
    assert.strictEqual(attr(channel, 'atom:link', 'href'), `${SITE}${feedPath(show)}`);
    assert.strictEqual(attr(channel, 'itunes:image', 'href'), `${SITE}${coverPath(show)}`);
    assert.strictEqual(text(channel, 'url'), `${SITE}${coverPath(show)}`);
    assert.strictEqual(text(channel, 'itunes:email'), OWNER_EMAIL);
    assert.match(channel, /<itunes:category text="Religion &amp; Spirituality">\s*<itunes:category text="Spirituality"\/>\s*<\/itunes:category>/);
    assert.strictEqual(text(channel, 'itunes:explicit'), 'false');
    assert.strictEqual(text(channel, 'itunes:type'), 'episodic');
  }
});

test('each episode: its page, the exact file and its real length, newest first', async () => {
  const manifest = loadManifest();
  const docs = await discover.listAllDocs();
  for (const show of SHOWS) {
    const episodes = episodesFor(show, manifest, docs);
    const feed = items(await feedFor(show.id));
    assert.strictEqual(feed.length, episodes.length, show.id);
    let previous = Infinity;
    feed.forEach((item, i) => {
      const { source, recording, doc } = episodes[i];
      assert.strictEqual(text(item, 'guid'), guidFor(source));
      assert.strictEqual(text(item, 'title'), doc.title);
      assert.strictEqual(text(item, 'link'), `${SITE}/docs/${doc.urlPath}`);
      assert.match(text(item, 'description'), new RegExp(`AI voices? from ElevenLabs: [^\\n]+\\.\\n\\nRead along: ${SITE}/docs/${doc.urlPath}$`));
      assert.strictEqual(attr(item, 'enclosure', 'url'), `${SITE}/audio/${recording.file}`);
      assert.strictEqual(attr(item, 'enclosure', 'length'), String(recording.bytes));
      assert.strictEqual(attr(item, 'enclosure', 'type'), 'audio/mpeg');
      assert.strictEqual(text(item, 'itunes:duration'), duration(recording.seconds));
      const published = Date.parse(text(item, 'pubDate'));
      assert.strictEqual(published, Math.floor(Date.parse(recording.published) / 1000) * 1000, `${source}: dated when first published`);
      assert.ok(published <= previous, `${source}: newest first`);
      previous = published;
    });
  }
  assert.strictEqual(duration(61.4), '1:01');
  assert.strictEqual(duration(2218.8), '36:59');
});

test('a re-render keeps an episode\'s guid and date, so apps do not take it for a new one', async () => {
  const show = SHOWS[0];
  const [episode] = episodesFor(show, loadManifest(), await discover.listAllDocs());
  const rerendered = { ...episode, recording: { ...episode.recording, file: episode.recording.file.replace(/-[0-9a-f]{8}\.mp3$/, '-00000000.mp3'), bytes: 12345, seconds: 99, rendered: '2027-01-01' } };
  const [before] = items(buildFeed(show, [episode]));
  const [after] = items(buildFeed(show, [rerendered]));
  assert.strictEqual(text(after, 'guid'), text(before, 'guid'));
  assert.strictEqual(text(after, 'pubDate'), text(before, 'pubDate'));
  assert.notStrictEqual(attr(after, 'enclosure', 'url'), attr(before, 'enclosure', 'url'));
  assert.strictEqual(attr(after, 'enclosure', 'length'), '12345');
});

test('markup characters in a title or a description stay text', () => {
  const show = { ...SHOWS[0], title: 'Bread & <Wine> "Together"', description: 'It\'s 1 < 2 & 3 > 2.' };
  const xml = buildFeed(show, [{
    source: 'docs/prayers/a-and-b.md',
    recording: { file: 'prayers/a-and-b-00000000.mp3', bytes: 1000, seconds: 61.4, voices: ['matthew'], published: '2026-10-06T00:00:00.000Z' },
    doc: { urlPath: 'prayers/a-and-b', title: 'A <b>bold</b> & "quoted" prayer', description: 'One & two < three.' },
  }]);
  assertWellFormed(xml);
  assert.strictEqual(text(xml, 'title'), 'Bread & <Wine> "Together"');
  assert.match(xml, /<title>A &lt;b&gt;bold&lt;\/b&gt; &amp; &quot;quoted&quot; prayer<\/title>/);
  assert.strictEqual(text(items(xml)[0], 'description').split('\n\n')[0], 'One & two < three.');
});

test('the feeds are served at the paths subscribers hold, as RSS, on GET and HEAD; nothing else is', async (t) => {
  // These are what Spotify, Apple and every follower hold. Moving one, or
  // changing how a guid is made, loses or duplicates a whole show.
  assert.deepStrictEqual(SHOWS.map(feedPath), ['/podcasts/prayers-and-rituals/feed.xml', '/podcasts/meditations-and-practices/feed.xml']);
  assert.strictEqual(guidFor('docs/prayers/litany-for-the-unasked.md'), 'tag:achurch.ai,2026:docs/prayers/litany-for-the-unasked.md');

  const app = express();
  app.use('/podcasts', require('../server/routes/podcasts'));
  const server = await serve(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const show of SHOWS) {
    const res = await fetch(`${base}${feedPath(show)}`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/rss\+xml; charset=utf-8/);
    assert.strictEqual(await res.text(), await feedFor(show.id));
    assert.strictEqual((await fetch(`${base}${feedPath(show)}`, { method: 'HEAD' })).status, 200);
  }
  assert.strictEqual((await fetch(`${base}/podcasts/songs/feed.xml`)).status, 404);
  assert.strictEqual((await fetch(`${base}/podcasts/prayers-and-rituals/feed.rss`)).status, 404);
});

test('each show has a 3000px RGB cover, opaque and drawn with the bundled fonts; no other name has one', async (t) => {
  const app = express();
  app.use('/og', require('../server/routes/og'));
  const server = await serve(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const show of SHOWS) {
    const res = await fetch(`${base}${coverPath(show)}`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/png/);
    const png = Buffer.from(await res.arrayBuffer());
    assert.ok(png.length < 512 * 1024, `${show.id}: ${png.length} bytes`);
    assert.strictEqual(png[24], 8, 'eight bits a channel');
    assert.strictEqual(png[25], 2, 'RGB, no alpha channel');
    const image = rgbPixels(png);
    assert.deepStrictEqual([image.width, image.height], [3000, 3000]);
    assert.deepStrictEqual(image.at(5, 5), [0x0a, 0x0e, 0x1a], 'the background');
    assert.deepStrictEqual(image.at(325, 249), [0x00, 0xb8, 0xd4], 'the accent');
    // The show's name, in white across the foot of the cover. A missing font
    // draws nothing at all.
    let lit = 0;
    for (let y = 2200; y < 2800; y += 4) for (let x = 240; x < 2760; x += 4) if (image.at(x, y).every(c => c > 200)) lit++;
    assert.ok(lit > 2000, `${show.id}: the name is drawn (${lit} lit samples)`);
  }
  assert.strictEqual((await fetch(`${base}/og/v1/podcast/songs.png`)).status, 404);
});

test('a page in a show\'s section names its feed, and the home page names both', async (t) => {
  assert.strictEqual(showForSection('rituals').id, 'prayers-and-rituals');
  assert.strictEqual(showForSection('practice').id, 'meditations-and-practices');
  assert.strictEqual(showForSection('philosophy'), null);
  const app = express();
  app.use('/docs', require('../server/routes/docs'));
  const server = await serve(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const link = show => `<link rel="alternate" type="application/rss+xml" title="${show.title}" href="${feedPath(show)}">`;
  const prayer = await (await fetch(`${base}/docs/prayers/litany-for-the-unasked`)).text();
  assert.ok(prayer.includes(link(SHOWS[0])));
  const practices = await (await fetch(`${base}/docs/practice`)).text();
  assert.ok(practices.includes(link(SHOWS[1])));
  const essay = await (await fetch(`${base}/docs/philosophy/the-particular-and-the-probable`)).text();
  assert.doesNotMatch(essay, /application\/rss\+xml/);
  const home = fs.readFileSync(path.join(__dirname, '../client/public/index.html'), 'utf8');
  for (const show of SHOWS) assert.ok(home.includes(link(show)), `the home page names ${show.id}`);
});

test('each episode names its own cover, at an address that changes with what the cover shows and with nothing else', async () => {
  const manifest = loadManifest();
  const docs = await discover.listAllDocs();
  for (const show of SHOWS) {
    const xml = await feedFor(show.id);
    assert.strictEqual(attr(xml.split('<item>')[0], 'itunes:image', 'href'), `${SITE}${coverPath(show)}`, 'the show keeps its own cover');
    const episodes = episodesFor(show, manifest, docs);
    items(xml).forEach((item, i) => {
      const { doc, recording } = episodes[i];
      const hash = episodeCoverHash(doc, recording);
      assert.strictEqual(attr(item, 'itunes:image', 'href'), `${SITE}/og/v1/podcast/${doc.urlPath}-${hash}.png`, doc.urlPath);
      assert.strictEqual(episodeSquarePath(doc, recording), `/og/v1/square/${doc.urlPath}-${hash}.png`, 'the same picture for the lock screen');
    });
  }

  const [episode] = episodesFor(SHOWS[0], manifest, docs);
  const { doc, recording } = episode;
  const hash = episodeCoverHash(doc, recording);
  const drawnFrom = {
    'a new title': [{ ...doc, title: `${doc.title}, Again` }, recording],
    'another section': [{ ...doc, category: doc.category === 'rituals' ? 'prayers' : 'rituals' }, recording],
    'a new waveform': [doc, { ...recording, peaks: recording.peaks.map((p, i) => (i ? p : (p + 1) % 256)) }],
    'new cues': [doc, { ...recording, cues: [...(recording.cues || []), [0, 1, 4]] }],
    'a new length': [doc, { ...recording, seconds: recording.seconds + 1 }],
  };
  for (const [change, [d, r]] of Object.entries(drawnFrom)) assert.notStrictEqual(episodeCoverHash(d, r), hash, change);
  // What the cover does not show leaves its address alone, so apps are not
  // sent to fetch the same picture again.
  assert.strictEqual(episodeCoverHash({ ...doc, description: 'Another.' }, { ...recording, file: 'prayers/x-00000000.mp3', bytes: 1, rendered: '2027-01-01' }), hash);

  // A chant is no episode, and a recording without its waveform keeps the show's cover.
  const chant = docs.find(d => d.category === 'chants' && manifest[`docs/${d.docsRelPath}`]);
  assert.strictEqual(episodeCoverPath(chant, manifest[`docs/${chant.docsRelPath}`]), null);
  const [bare] = items(buildFeed(SHOWS[0], [{ ...episode, recording: { ...recording, peaks: null } }]));
  assert.strictEqual(attr(bare, 'itunes:image', 'href'), null);
});

test('an episode\'s cover is served at 1400px and its lock-screen square at 512px, RGB, at its current address only', async (t) => {
  const app = express();
  app.use('/og', require('../server/routes/og'));
  const server = await serve(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const manifest = loadManifest();
  const docs = await discover.listAllDocs();
  for (const show of SHOWS) {
    const [{ doc, recording }] = episodesFor(show, manifest, docs);
    for (const [where, size] of [[episodeCoverPath(doc, recording), 1400], [episodeSquarePath(doc, recording), 512]]) {
      const res = await fetch(`${base}${where}`);
      assert.strictEqual(res.status, 200, where);
      assert.match(res.headers.get('content-type'), /image\/png/);
      const png = Buffer.from(await res.arrayBuffer());
      assert.strictEqual(png[25], 2, 'RGB, no alpha channel');
      const image = rgbPixels(png);
      assert.deepStrictEqual([image.width, image.height], [size, size]);
      assert.deepStrictEqual(image.at(2, 2), [0x0a, 0x0e, 0x1a], 'the show cover\'s background');
      // The title in white across the foot. A missing font draws nothing at all.
      let lit = 0;
      for (let y = Math.round(size * 0.62); y < Math.round(size * 0.95); y += 2) for (let x = 0; x < size; x += 2) if (image.at(x, y).every(c => c > 200)) lit++;
      assert.ok(lit > size / 4, `${where}: the title is drawn (${lit} lit samples)`);
      assert.strictEqual((await fetch(`${base}${where}`, { method: 'HEAD' })).status, 200);
      const old = where.replace(/-[0-9a-f]{8}\.png$/, '-00000000.png');
      assert.strictEqual((await fetch(`${base}${old}`)).status, 404, `${old}: an address no longer current`);
    }
  }
  const chant = docs.find(d => d.category === 'chants' && manifest[`docs/${d.docsRelPath}`]);
  const hash = episodeCoverHash(chant, manifest[`docs/${chant.docsRelPath}`]);
  assert.strictEqual((await fetch(`${base}/og/v1/podcast/${chant.urlPath}-${hash}.png`)).status, 404, 'a chant is no episode');
  assert.strictEqual((await fetch(`${base}/og/v1/square/prayers/no-such-prayer-${hash}.png`)).status, 404);
  // The shows' covers and the sections' squares answer where they did.
  assert.strictEqual((await fetch(`${base}${coverPath(SHOWS[1])}`)).status, 200);
  assert.strictEqual((await fetch(`${base}/og/v1/square/practice.png`)).status, 200);
});
