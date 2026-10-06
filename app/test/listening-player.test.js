/**
 * The listening player: the waveform's peaks and the visual's frames measured
 * from each recording, the markup drawn on the server, the pure parts of the
 * two browser modules (site-nav.js, site-player.js), the pages that carry
 * them, the lock screen's square artwork, and the rule that keeps page
 * scripts from outliving their page.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { peaksFromPcm, BUCKETS } = require('../server/lib/audio/peaks');
const { framesFromPcm, parseFrames, FPS, BANDS, LOW_HZ, HIGH_HZ } = require('../server/lib/audio/frames');
const { renderRecording, renderPathListen, fitPeaks: serverFitPeaks } = require('../server/lib/audio/markup');
const { loadManifest } = require('../server/lib/audio/manifest');
const { SPEECH } = require('../server/lib/audio/house');
const nav = require('../client/public/site-nav');
const player = require('../client/public/site-player');

const PUBLIC = path.join(__dirname, '../client/public');

// A tone burst of `seconds` at `hz`, into `samples` at `at` seconds.
function burst(samples, rate, at, seconds, hz, amplitude = 16000) {
  const from = Math.round(at * rate);
  for (let i = 0; i < seconds * rate && from + i < samples.length; i++) {
    samples[from + i] = Math.round(amplitude * Math.sin((2 * Math.PI * hz * i) / rate));
  }
}

test('peaks: a burst lands in its own bucket, and silence is zeros, not an absence', () => {
  const rate = 8000;
  const samples = new Int16Array(rate * 16);
  const bucket = samples.length / BUCKETS;
  burst(samples, rate, (64 * bucket) / rate, bucket / rate, 300);
  const peaks = peaksFromPcm(samples);
  assert.strictEqual(peaks.length, 128);
  assert.strictEqual(peaks.indexOf(Math.max(...peaks)), 64);
  assert.ok(peaks.every((p, i) => i === 64 || p === 0), 'nothing outside the burst');
  assert.deepStrictEqual(peaksFromPcm(new Int16Array(rate * 4)), new Array(128).fill(0));
});

test('peaks: one plosive does not flatten the rest of the waveform', () => {
  const rate = 8000;
  const samples = new Int16Array(rate * 16);
  burst(samples, rate, 0, 16, 220, 4000);
  burst(samples, rate, 8, 0.02, 220, 32000);
  const peaks = peaksFromPcm(samples);
  const sorted = [...peaks].sort((a, b) => a - b);
  assert.ok(sorted[64] > 200, `the typical bar stays near full height (median ${sorted[64]})`);
});

test('frames: each frame is centred on its own time, so a click lands in its frame, not before it', () => {
  const rate = 16000;
  const samples = new Int16Array(rate * 6);
  const clicks = [1.0, 2.5, 4.0];
  for (const at of clicks) burst(samples, rate, at, 0.01, 300, 30000);
  const frames = parseFrames(framesFromPcm(samples, rate));
  assert.strictEqual(frames.fps, FPS);
  assert.strictEqual(frames.bands, BANDS);
  assert.strictEqual(frames.count, Math.ceil(6 * FPS));
  // The loudness centroid of the frames around each click. A window starting
  // at its frame's time instead of centred on it reads 32 ms ahead, which
  // puts the centroid half a frame early: inside a one-frame tolerance, so the
  // check is a quarter frame.
  for (const at of clicks) {
    const expected = at * FPS;
    let weight = 0;
    let sum = 0;
    for (let f = Math.round(expected) - 3; f <= Math.round(expected) + 3; f++) {
      weight += frames.loud(f);
      sum += f * frames.loud(f);
    }
    const centroid = sum / weight;
    assert.ok(Math.abs(centroid - expected) < 0.25, `click at ${at}s centred on frame ${centroid.toFixed(2)}, expected ${expected}`);
  }
});

test('frames: a tone lights the band it falls in, and silence stays dark', () => {
  const rate = 16000;
  const samples = new Int16Array(rate * 3);
  burst(samples, rate, 0, 2, 300, 12000);
  const frames = parseFrames(framesFromPcm(samples, rate));
  const band = Math.floor(((300 - LOW_HZ) / (HIGH_HZ - LOW_HZ)) * BANDS);
  const mid = 20;
  const values = Array.from({ length: BANDS }, (_, b) => frames.band(mid, b));
  assert.strictEqual(values.indexOf(Math.max(...values)), band);
  assert.strictEqual(frames.loud(Math.round(2.6 * FPS)), 0, 'the silent tail is zero');
  assert.throws(() => parseFrames(new Uint8Array([1, 2, 3, 4, 5, 6])), /Not a frames file/);
});

test('the server draws a recording as bars before any script runs, with the native player beside them', () => {
  const peaks = Array.from({ length: 128 }, (_, i) => (i * 2) % 256);
  const html = renderRecording(
    { file: 'prayers/x-12345678.mp3', frames: 'prayers/x-12345678.bin', seconds: 125, peaks, cues: [[0, 2, 1]], voices: ['matthew', 'luca'] },
    { title: 'A <Prayer>', href: '/docs/prayers/x', category: 'prayers' },
  );
  assert.strictEqual((html.match(/doc-audio-bars-wide[\s\S]*?<\/span><\/span>/) || [''])[0].split('<i></i>').length - 1, 128);
  assert.strictEqual((html.match(/<span style="--i:/g) || []).length, 128 + 64);
  assert.match(html, /<audio class="doc-audio-native" controls preload="none" src="\/audio\/prayers\/x-12345678\.mp3"/);
  assert.match(html, /aria-label="Play A &lt;Prayer&gt;" hidden/);
  const track = JSON.parse(html.match(/class="doc-audio-track">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(track.title, 'A <Prayer>');
  assert.strictEqual(track.artwork, '/og/v1/square/prayers.png');
  assert.deepStrictEqual(track.order, Object.keys(SPEECH.voices));
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ''), /<Prayer>/, 'the title is escaped outside the JSON');
  assert.match(html, />2 min\. AI voices from ElevenLabs: Matthew Schmitz and Luca\.</);
  assert.deepStrictEqual(serverFitPeaks([1, 9, 3, 4, 8, 2], 3), [9, 4, 8]);
});

test('a reading path offers its voiced readings as one queue, and says how many are voiced', () => {
  const html = renderPathListen({ name: 'p', title: 'A Path', href: '/docs/collections/p', tracks: [{ seconds: 60 }, { seconds: 125 }], readings: 5 });
  assert.match(html, /<section class="path-listen" data-path-listen hidden>/);
  assert.match(html, /2 of its 5 readings are voiced, about 3 min in all/);
});

test('site-nav: only this site\'s pages load in place; files, APIs, feeds and other sites load as before', () => {
  const origin = 'https://achurch.ai';
  for (const ok of ['/', '/docs/prayers/x', '/docs/prayers/x?path=y', '/reflections/a-song', '/about', '/ask/abc', '/old.html']) {
    assert.strictEqual(nav.isSoftNavigable(`${origin}${ok}`, origin), true, ok);
  }
  for (const no of ['/api/now', '/audio/prayers/x.mp3', '/og/v1/docs/x.png', '/docs/prayers/x.md', '/sitemap.xml', '/feed', '/admin', '/mcp', '/.well-known/x', '/styles.css']) {
    assert.strictEqual(nav.isSoftNavigable(`${origin}${no}`, origin), false, no);
  }
  assert.strictEqual(nav.isSoftNavigable('https://example.com/docs', origin), false);
});

test('site-nav: leaving a page stops the timers it started', () => {
  const running = new Set();
  let id = 0;
  const timers = { setInterval: () => { running.add(++id); return id; }, clearInterval: i => running.delete(i) };
  const page = nav.createPage(timers);
  page.every(30000, () => {});
  page.every(30000, () => {});
  assert.strictEqual(running.size, 2);
  page.leave();
  assert.strictEqual(running.size, 0);
  assert.strictEqual(page.signal.aborted, true);
});

test('site-player: times read as words, and the slider keys move as the APG media seek slider does', () => {
  assert.strictEqual(player.clock(0), '0:00');
  assert.strictEqual(player.clock(243.9), '4:03');
  assert.strictEqual(player.clock(3723), '1:02:03');
  assert.strictEqual(player.spoken(0), '0 seconds');
  assert.strictEqual(player.spoken(61), '1 minute, 1 second');
  assert.strictEqual(player.spoken(243), '4 minutes, 3 seconds');
  assert.strictEqual(player.spoken(3600), '1 hour');
  const d = 100;
  assert.strictEqual(player.seekForKey('ArrowRight', 50, d), 55);
  assert.strictEqual(player.seekForKey('ArrowLeft', 2, d), 0);
  assert.strictEqual(player.seekForKey('PageUp', 90, d), 100);
  assert.strictEqual(player.seekForKey('PageDown', 50, d), 35);
  assert.strictEqual(player.seekForKey('Home', 50, d), 0);
  assert.strictEqual(player.seekForKey('End', 50, d), 100);
  assert.strictEqual(player.seekForKey('a', 50, d), null);
});

test('site-player: frames are read between frames, cues by who speaks, colours along a ramp', () => {
  const header = [65, 67, 70, 49, 20, 2];
  const bytes = new Uint8Array([...header, 0, 0, 0, 255, 255, 255]);
  const frames = player.parseFrames(bytes.buffer);
  assert.strictEqual(frames.count, 2);
  const half = player.frameAt(frames, 0.025);
  assert.ok(Math.abs(half.loud - 0.625) < 0.01, `halfway is halfway (${half.loud})`);
  assert.strictEqual(player.frameAt(frames, 99).loud, 1.25, 'past the end holds the last frame');
  assert.strictEqual(player.parseFrames(new Uint8Array([1, 2, 3, 4, 5, 6]).buffer), null);

  const cues = [[0, 2, 1], [3, 5, 2], [6, 9, 7]];
  assert.deepStrictEqual(player.cueAt(cues, 4), cues[1]);
  assert.deepStrictEqual(player.cueAt(cues, 5.5), cues[1], 'a silence keeps the last voice');
  assert.deepStrictEqual(player.cueAt(cues, -1), cues[0]);
  assert.strictEqual(player.cueAt([], 1), null);

  assert.deepStrictEqual(player.colorAt(['#000000', '#ffffff'], 0), [0, 0, 0]);
  assert.deepStrictEqual(player.colorAt(['#000000', '#ffffff'], 0.5), [128, 128, 128]);
  assert.deepStrictEqual(player.colorAt(['#000000', '#ff0000', '#ffffff'], 1), [255, 255, 255]);
  assert.deepStrictEqual(player.fitPeaks([1, 9, 3, 4], 2), [9, 4]);
});

test('every recording carries the peaks, frames and cues its player draws', () => {
  const order = Object.keys(SPEECH.voices);
  for (const [source, rec] of Object.entries(loadManifest())) {
    assert.ok(Array.isArray(rec.peaks) && rec.peaks.length === 128 && rec.peaks.every(p => Number.isInteger(p) && p >= 0 && p <= 255), `${source}: peaks`);
    assert.strictEqual(rec.frames, rec.file.replace(/\.mp3$/, '.bin'), `${source}: frames`);
    assert.ok(rec.cues.length > 0, `${source}: cues`);
    let last = -1;
    for (const [start, end, mask] of rec.cues) {
      assert.ok(start >= last && end > start && end <= rec.seconds + 0.5, `${source}: cue ${start}-${end} in order and inside the recording`);
      assert.ok(mask > 0 && mask < 1 << order.length, `${source}: cue voices`);
      last = start;
    }
  }
});

test('the manifest keeps number arrays on one line, so a re-render diffs as a few lines', () => {
  const { serialize } = require('../server/lib/audio/manifest');
  const data = { 'docs/a.md': { file: 'a.mp3', peaks: [1, 2, 255], cues: [[0, 1.5, 1], [2, 3.25, 6]], voices: ['luca'] } };
  const text = serialize(data);
  assert.match(text, /"peaks": \[1, 2, 255\]/);
  assert.match(text, /\n {6}\[0, 1\.5, 1\],\n {6}\[2, 3\.25, 6\]\n/);
  assert.deepStrictEqual(JSON.parse(text), data);
  const onDisk = fs.readFileSync(require('../server/lib/audio/manifest').MANIFEST_FILE, 'utf8');
  assert.strictEqual(onDisk, serialize(JSON.parse(onDisk)), 'audio/manifest.json is written in this form');
});

function serve(app) {
  return new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
}

test('pages carry the player: the build, both scripts and the versioned stylesheet; a voiced page its bars', async (t) => {
  const voiced = Object.entries(loadManifest())[0];
  if (!voiced) return t.skip('no recordings yet');
  process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'bucket';
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'id';
  const docsRoutes = require('../server/routes/docs');
  const app = express();
  app.use('/docs', docsRoutes);
  const server = await serve(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const [source, rec] = voiced;
  const page = await (await fetch(`${base}/docs/${source.replace(/^docs\//, '').replace(/\.md$/, '')}`)).text();
  assert.match(page, /<meta name="assets" content="[0-9a-f]{12}">/);
  assert.match(page, /<script src="\/site-nav\.js\?v=[0-9a-f]{8}"><\/script>/, 'blocking, before any page script');
  assert.match(page, /<script src="\/site-player\.js\?v=[0-9a-f]{8}" defer><\/script>/);
  assert.match(page, /<link rel="stylesheet" href="\/styles\.css\?v=[0-9a-f]{8}">/);
  assert.match(page, /<\/h1>\s*<figure class="doc-audio has-wave">/);
  const track = JSON.parse(page.match(/class="doc-audio-track">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(track.file, rec.file);
  assert.deepStrictEqual(track.peaks, rec.peaks);
});

test('a reading path with voiced readings offers them in its own order', async (t) => {
  const { readingSequence } = require('../server/lib/docs/links');
  const discover = require('../server/lib/docs/discover');
  await discover.listAllDocs();
  const manifest = loadManifest();
  const collections = fs.readdirSync(path.join(__dirname, '../../docs/collections')).filter(f => f.endsWith('.md') && f !== 'README.md').map(f => f.slice(0, -3));
  const withVoice = collections.map(name => ({ name, voiced: (readingSequence(name) || []).filter(u => { const d = discover.docAt(u); return d && manifest[`docs/${d.docsRelPath}`]; }) })).find(c => c.voiced.length);
  if (!withVoice) return t.skip('no reading path has a voiced reading');
  const docsRoutes = require('../server/routes/docs');
  const app = express();
  app.use('/docs', docsRoutes);
  const server = await serve(app);
  t.after(() => server.close());
  const page = await (await fetch(`http://127.0.0.1:${server.address().port}/docs/collections/${withVoice.name}`)).text();
  const queue = JSON.parse(page.match(/class="path-listen-queue">([\s\S]*?)<\/script>/)[1]);
  assert.deepStrictEqual(queue.tracks.map(tr => tr.href), withVoice.voiced.map(u => `/docs/${u}?path=${withVoice.name}`));
});

test('the lock screen gets a 512px square for each voiced section, and nothing for any other', async (t) => {
  const ogRoutes = require('../server/routes/og');
  const app = express();
  app.use('/og', ogRoutes);
  const server = await serve(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/og/v1/square`;
  const res = await fetch(`${base}/prayers.png`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/png/);
  const png = Buffer.from(await res.arrayBuffer());
  assert.strictEqual(png.readUInt32BE(16), 512);
  assert.strictEqual(png.readUInt32BE(20), 512);
  assert.strictEqual((await fetch(`${base}/philosophy.png`)).status, 404);
  // Every section with a recording has its square, or its lock screen shows a broken image.
  const voiced = new Set(Object.keys(loadManifest()).map(source => source.split('/')[1]));
  for (const section of voiced) assert.strictEqual((await fetch(`${base}/${section}.png`)).status, 200, section);
});

test('page scripts bind their window listeners and timers to the page, so none outlives it', () => {
  const docsNav = fs.readFileSync(path.join(PUBLIC, 'docs-nav.js'), 'utf8');
  const listeners = (docsNav.match(/(?:window|_MQ)\.addEventListener\(/g) || []).length;
  assert.ok(listeners >= 4, 'docs-nav.js still listens on window and its media queries');
  assert.strictEqual((docsNav.match(/\{ signal: pageSignal \}/g) || []).length, listeners, 'each window and media-query listener is bound to the page');
  const home = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.match(home, /page\.every\(30000, fetchNowPlaying\)/);
  assert.match(home, /page\.every\(30000, fetchReflections\)/);
  for (const file of fs.readdirSync(PUBLIC).filter(f => /\.(js|html)$/.test(f) && !['site-nav.js', 'site-player.js', 'index.html'].includes(f))) {
    assert.doesNotMatch(fs.readFileSync(path.join(PUBLIC, file), 'utf8'), /setInterval\(/, `${file} starts a timer that would outlive its page`);
  }
});
