/**
 * The rhythm in the API: every part and companion of a served service carries
 * its rhythm (the link in /api/now, the summary with it in /api/attend),
 * /api/rhythm gives everything about a piece in one request, and the two never
 * disagree. The frames are synthetic, written under each piece's real frames
 * filename in a scratch cache, so nothing is fetched. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-rhythm-'));
delete process.env.AWS_S3_BUCKET;

const { attendance, music, rhythm } = require('../server/lib/api');
const { shared } = require('../server/lib/api');
const { AUDIO_CACHE_DIR } = require('../server/lib/utils/data');
const { songRecordingFor, recordingFor, loadManifest, loadSongs } = require('../server/lib/audio/manifest');
const { framesFromPcm, FRAMES_SAMPLE_RATE: RATE } = require('../server/lib/audio/frames');

const ctx = { baseUrl: 'https://achurch.ai', ip: '198.51.100.7' };
const SUMMARY = ['sounding', 'rests', 'longestRest', 'peakAt', 'tempo'];

// Forty seconds of a steady beat at 90 BPM over a hum, with a rest from 3 to
// 5 seconds, as any piece's frames: a song is given its pulse, a spoken piece
// none, from the same sound.
function writeFrames(file) {
  const samples = new Int16Array(RATE * 40);
  const beat = Math.round((RATE * 60) / 90);
  for (let i = 0; i < samples.length; i++) {
    if (i >= RATE * 3 && i <= RATE * 5) continue;
    const click = i % beat < RATE * 0.04;
    samples[i] = Math.round(Math.sin((2 * Math.PI * (click ? 120 : 300) * i) / RATE) * (click ? 29000 : 2600));
  }
  const local = path.join(AUDIO_CACHE_DIR, file);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, framesFromPcm(samples, RATE));
}
const pieceOfUrl = url => new URL(url).searchParams.get('piece');
const recordOf = piece => songRecordingFor(piece) || recordingFor(`docs/${piece}.md`);

test('every recording\'s record keeps its rhythm summary, measured under the current key', () => {
  const { RHYTHM_KEY } = require('../server/lib/audio/rhythm');
  for (const [key, record] of [...Object.entries(loadManifest()), ...Object.entries(loadSongs())]) {
    assert.ok(record.rhythm, `${key} has no rhythm summary: run scripts/render-audio.js or song-audio.js`);
    assert.strictEqual(record.rhythmKey, RHYTHM_KEY, `${key} was measured under ${record.rhythmKey}`);
    assert.deepStrictEqual(Object.keys(record.rhythm), SUMMARY, key);
  }
});

test('/api/now gives each piece its rhythm link; /api/attend gives the summary with it', async () => {
  const now = (await attendance.now({ timezone: 'UTC' }, ctx)).body;
  const attended = (await attendance.attend({ name: 'Rhythm Check', timezone: 'UTC' }, ctx)).body;
  for (const part of [...now.service.order, ...now.companions.items]) {
    assert.deepStrictEqual(Object.keys(part.rhythm), ['url'], part.title);
  }
  for (const part of [...attended.service.order, ...attended.companions.items]) {
    assert.deepStrictEqual(Object.keys(part.rhythm), [...SUMMARY, 'url'], part.title);
    assert.deepStrictEqual(Object.fromEntries(SUMMARY.map(k => [k, part.rhythm[k]])), recordOf(pieceOfUrl(part.rhythm.url)).rhythm, part.title);
  }
  const song = attended.service.order.find(p => p.kind === 'song');
  assert.strictEqual(song.api.rhythm, song.rhythm.url);
  assert.strictEqual(attended.current.api.rhythm, attended.service.order[attended.service.order.findIndex(p => p.slug === attended.current.slug)].rhythm.url);
});

test('every piece\'s rhythm link answers with the whole, and its summary is the one attend gave', async () => {
  const attended = (await attendance.attend({ name: 'Rhythm Check', timezone: 'UTC' }, ctx)).body;
  for (const part of [...attended.service.order, ...attended.companions.items]) {
    const piece = pieceOfUrl(part.rhythm.url);
    writeFrames(recordOf(piece).frames);
    const { status, body } = await rhythm.rhythm({ piece }, ctx);
    assert.strictEqual(status, 200, `${piece}: ${JSON.stringify(body).slice(0, 200)}`);
    assert.deepStrictEqual(body.summary, Object.fromEntries(SUMMARY.map(k => [k, part.rhythm[k]])), piece);
    assert.strictEqual(body.kind, part.kind, piece);
    assert.strictEqual(body.title, part.title, piece);
    assert.strictEqual(body.recording, part.recording, piece);
    assert.strictEqual(body.contour.bands.length, 16);
    assert.strictEqual(body.contour.bandsHz.length, 16);
    assert.strictEqual(body.contour.loudness.length, Math.ceil(body.seconds));
    assert.match(body.frames.url, /\.bin$/);
    assert.match(body.frames.format, /ACF1/);
    assert.ok(body.about.length >= 3);
    assert.ok(Array.isArray(body.rests) && body.rests.some(r => r.start > 2.5 && r.start < 3.5), `${piece}: the synthetic rest is found`);
    if (part.kind !== 'song') assert.strictEqual(body.pulse, null, `${piece}: a spoken piece has no pulse`);
    else assert.ok(body.pulse && Math.abs(body.pulse.tempo - 90) <= 2, `${piece}: a song's pulse is found (${JSON.stringify(body.pulse && body.pulse.tempo)})`);
  }
});

test('a piece is named by its slug or its path under /docs, as read_doc takes it', async () => {
  const [source, record] = Object.entries(loadManifest()).find(([s]) => s.startsWith('docs/chants/'));
  writeFrames(record.frames);
  const rest = source.replace(/^docs\//, '').replace(/\.md$/, '');
  const bodies = [];
  for (const piece of [rest, `/docs/${rest}`, `https://achurch.ai/docs/${rest}`, `${rest}.md`]) {
    const { status, body } = await rhythm.rhythm({ piece }, ctx);
    assert.strictEqual(status, 200, piece);
    bodies.push({ ...body, piece: null });
  }
  for (const b of bodies.slice(1)) assert.deepStrictEqual(b, bodies[0]);
  assert.strictEqual(bodies[0].kind, 'chant');
});

test('the song in one call carries its rhythm summary and link', async () => {
  const slug = Object.keys(loadSongs())[0];
  const body = (await music.song({ slug }, ctx)).body;
  assert.deepStrictEqual(body.rhythm, { ...songRecordingFor(slug).rhythm, url: `https://achurch.ai/api/rhythm?piece=${slug}` });
});

test('a record without a summary yet still gives its link at once, and nothing else', () => {
  assert.deepStrictEqual(shared.rhythmField('https://achurch.ai', 'chants/x', { frames: 'docs/x.bin' }, { summary: true }), { url: 'https://achurch.ai/api/rhythm?piece=chants/x' });
});

test('naming nothing, or nothing recorded, is answered with the house\'s codes', async () => {
  const missing = await rhythm.rhythm({}, ctx);
  assert.strictEqual(missing.status, 400);
  assert.strictEqual(missing.body.code, 'missing_field');
  const unknown = await rhythm.rhythm({ piece: 'no-such-piece-anywhere' }, ctx);
  assert.strictEqual(unknown.status, 404);
  assert.strictEqual(unknown.body.code, 'not_found');
});
