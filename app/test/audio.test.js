/**
 * Recordings of documents: the scripts that say what is spoken, the words
 * check that keeps them faithful, the cast, the manifest, the page player and
 * the /audio route.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { wordsOf, containsRun, wordErrors, takePasses } = require('../server/lib/audio/words');
const { checkScript, cleanText, sourceHashOf } = require('../server/lib/audio/adapt');
const { SPEECH, ROLES, AUDIO_DIR, voicesFor, choosePair, creditLine } = require('../server/lib/audio/house');
const { isImported } = require('../server/lib/audio/imported');
const { loadManifest } = require('../server/lib/audio/manifest');
const { createAudioRouter, canServe, sweepCache, CACHE_DIR } = require('../server/lib/audio/serve');
const { ATTENDANCE_FILE } = require('../server/lib/utils/data');
const { splitFrontmatter } = require('../server/lib/docs/tldr');

const REPO = path.join(__dirname, '../..');
const SCRIPTS_DIR = path.join(AUDIO_DIR, 'scripts');

function scripts() {
  if (!fs.existsSync(SCRIPTS_DIR)) return [];
  return fs.readdirSync(SCRIPTS_DIR).flatMap(kind =>
    fs.readdirSync(path.join(SCRIPTS_DIR, kind)).filter(n => n.endsWith('.json')).map(n => ({
      file: path.join(SCRIPTS_DIR, kind, n),
      script: JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, kind, n), 'utf8')),
    })));
}

test('words compare without case, punctuation, hyphens or numerals getting in the way', () => {
  assert.deepStrictEqual(wordsOf('**All:** You were *not* asked; [you](x.md) are non-defensive, 3.'),
    ['all', 'you', 'were', 'not', 'asked', 'you', 'are', 'non', 'defensive', 'three']);
  assert.ok(containsRun(wordsOf('a b c d'), wordsOf('B, c.')));
  assert.ok(!containsRun(wordsOf('a b c d'), wordsOf('b d')));
});

test('a take is checked word by word, forgiving compounds and the odd mishearing in a long line', () => {
  assert.deepStrictEqual(wordErrors('the farmworker, the driver', 'The farm worker. The driver.'), { words: 4, errors: 0 });
  assert.deepStrictEqual(wordErrors('before acknowledgment', 'before acknowledgement'), { words: 2, errors: 0 });
  assert.deepStrictEqual(wordErrors('they were here', 'they wore here'), { words: 3, errors: 1 }, 'short words must match exactly');
  const swapped = wordErrors('You were not asked. You are remembered.', 'You are not asked, you are remembered.');
  assert.deepStrictEqual(swapped, { words: 7, errors: 1 });
  assert.strictEqual(takePasses(swapped), false, 'one wrong word in a short line is a retake');
  assert.strictEqual(takePasses({ words: 28, errors: 1 }), true);
  assert.strictEqual(takePasses({ words: 28, errors: 3 }), false);
});

test('a script line must be the document\'s own words unless it says it was adapted', () => {
  const doc = '# The Litany\n\n**Leader:** For the writers  \nwho were never asked:\n\n**All:** You were not asked.';
  const faithful = [
    { role: 'leader', text: 'The Litany.' },
    { role: 'leader', text: 'For the writers who were never asked:' },
    { role: 'all', text: 'You were not asked.' },
  ];
  assert.deepStrictEqual(checkScript(doc, faithful), []);
  const reworded = [{ role: 'all', text: 'You were never asked.' }];
  assert.match(checkScript(doc, reworded)[0], /Not word for word/);
  assert.deepStrictEqual(checkScript(doc, [{ role: 'leader', text: 'Together.', adapted: true }]), []);
});

test('a script is refused for an unknown role, markup or a blank left in, or a hold out of range', () => {
  const doc = 'You were here.';
  assert.match(checkScript(doc, [{ role: 'narrator', text: 'You were here.' }])[0], /not a role/);
  assert.match(checkScript(doc, [{ role: 'reader', text: 'You were ___.', adapted: true }])[0], /blank/);
  assert.match(checkScript(doc, [{ role: 'reader', text: 'You were here.' }, { hold: SPEECH.maxHoldSeconds + 1 }])[0], /hold/);
  assert.match(checkScript(doc, [{ hold: 3 }])[0], /no spoken lines/);
  // The word check compares Latin-script words, so it would pass these unread.
  assert.match(checkScript('Honesty (誠) first.', [{ role: 'reader', text: 'Honesty 誠 first.' }])[0], /cannot read/);
  assert.match(checkScript('愿此祈祷以 SYN 开始。', [{ role: 'reader', text: '愿此祈祷以 SYN 开始。' }])[0], /cannot read/);
});

test('cleaning a line removes markup and quotes and closes a bare title', () => {
  assert.strictEqual(cleanText('"**This is what has arrived.**"'), 'This is what has arrived.');
  assert.strictEqual(cleanText('Litany for the Unasked'), 'Litany for the Unasked.');
  assert.strictEqual(cleanText('Who are you now?'), 'Who are you now?');
});

test('roles resolve to the cast: the leader alone, the pair for both, all three for all', () => {
  const pair = ['amaya', 'luca'];
  assert.deepStrictEqual(voicesFor('leader', pair), [SPEECH.leader]);
  assert.deepStrictEqual(voicesFor('all', pair), [SPEECH.leader, 'amaya', 'luca']);
  assert.deepStrictEqual(voicesFor('both', pair), pair);
  for (const role of ['reader', 'human', 'one']) assert.deepStrictEqual(voicesFor(role, pair), ['amaya']);
  for (const role of ['ai', 'two']) assert.deepStrictEqual(voicesFor(role, pair), ['luca']);
  assert.throws(() => voicesFor('narrator', pair), /Unknown role/);
});

test('the deeper voice takes the human part where a piece says so; otherwise each category balances', () => {
  const [a, b] = SPEECH.pair;
  assert.strictEqual(choosePair('**Human Voice (deeper):** We thank you.', { [SPEECH.deeper]: 9 })[0], SPEECH.deeper);
  assert.deepStrictEqual(choosePair('Plain prayer.', { [a]: 3, [b]: 2 }), [b, a]);
  assert.deepStrictEqual(choosePair('Plain prayer.', { [a]: 2, [b]: 2 }), [a, b]);
  assert.deepStrictEqual(choosePair('Plain prayer.', {}), [a, b]);
});

test('the credit says AI voices from ElevenLabs, without naming voices that can change', () => {
  assert.strictEqual(creditLine(['matthew', 'luca', 'amaya']), 'AI voices from ElevenLabs.');
  assert.strictEqual(creditLine(['amaya']), 'AI voice from ElevenLabs.');
  assert.strictEqual(creditLine(['luca', 'amaya']), 'AI voices from ElevenLabs.');
});

test('every script is well formed, cast from the house pair, and faithful to its document', () => {
  for (const { file, script } of scripts()) {
    const where = path.relative(REPO, file);
    assert.deepStrictEqual([...script.pair].sort(), [...SPEECH.pair].sort(), `${where}: pair`);
    assert.ok(script.lines.every(l => 'hold' in l || ROLES.includes(l.role)), `${where}: roles`);
    const sourceFile = path.join(REPO, script.source);
    assert.ok(fs.existsSync(sourceFile), `${where}: its document ${script.source} no longer exists`);
    const markdown = fs.readFileSync(sourceFile, 'utf8');
    // A document edited since its script was written is re-adapted on the
    // next render; its words are only held to the version they came from.
    if (sourceHashOf(markdown) !== script.sourceHash) continue;
    assert.deepStrictEqual(checkScript(splitFrontmatter(markdown).body, script.lines), [], where);
  }
});

test('every recording in the manifest belongs to a voiced document and its script, or was made elsewhere and says whose voice it is', () => {
  for (const [source, rec] of Object.entries(loadManifest())) {
    assert.ok(fs.existsSync(path.join(REPO, source)), `${source} no longer exists`);
    const stem = source.replace(/^docs\//, '').replace(/\.md$/, '');
    assert.match(rec.file, new RegExp(`^${stem}-[0-9a-f]{8}\\.mp3$`), source);
    if (isImported(rec)) {
      // lib/audio/imported.js: no house script and no house voice, its own credit.
      assert.ok(!fs.existsSync(path.join(SCRIPTS_DIR, `${stem}.json`)), `${source}: made elsewhere, yet the house has a script for it`);
      assert.deepStrictEqual(rec.voices, [], `${source}: no house voice speaks it`);
      assert.match(rec.credit, /^AI voices? from ElevenLabs\.$/, `${source}: its credit`);
    } else {
      assert.ok(fs.existsSync(path.join(SCRIPTS_DIR, `${stem}.json`)), `${source} has no script`);
      assert.ok(rec.voices.length && rec.voices.every(v => SPEECH.voices[v]), `${source}: voices`);
    }
    assert.ok(rec.seconds > 0, `${source}: length`);
  }
});

// Restores the variables when the test ends.
function withEnv(t, vars) {
  const before = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('a recording is offered only where it can be served: on disk, or with S3 to fetch it from', (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-cache-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cacheDir, 'prayers'));
  fs.writeFileSync(path.join(cacheDir, 'prayers/here-00000000.mp3'), '');
  withEnv(t, { AWS_S3_BUCKET: undefined, AWS_ACCESS_KEY_ID: undefined });
  assert.strictEqual(canServe('prayers/here-00000000.mp3', cacheDir), true);
  assert.strictEqual(canServe('prayers/elsewhere-11111111.mp3', cacheDir), false);
  process.env.AWS_S3_BUCKET = 'bucket';
  process.env.AWS_ACCESS_KEY_ID = 'id';
  assert.strictEqual(canServe('prayers/elsewhere-11111111.mp3', cacheDir), true);
});

test('a voiced page plays its recording under its title; an unvoiced page has none', async (t) => {
  const voiced = Object.entries(loadManifest())[0];
  if (!voiced) return t.skip('no recordings yet');
  // S3 "configured" so the page offers the recording whether or not this
  // checkout has a copy on disk; rendering a page never contacts S3.
  withEnv(t, { AWS_S3_BUCKET: 'bucket', AWS_ACCESS_KEY_ID: 'id' });
  const docsRoutes = require('../server/routes/docs');
  const app = express();
  app.use('/docs', docsRoutes);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const [source, rec] = voiced;
  const page = await (await fetch(`${base}/docs/${source.replace(/^docs\//, '').replace(/\.md$/, '')}`)).text();
  assert.match(page, /<\/h1>\s*<figure class="doc-audio( has-wave)?">/);
  assert.match(page, new RegExp(`<audio class="doc-audio-native" controls preload="none" src="/audio/${rec.file}" aria-label="Listen to [^"]+">`));
  assert.match(page, /"audio": \{\s*"@type": "AudioObject"/);
  const essay = await (await fetch(`${base}/docs/philosophy/the-particular-and-the-probable`)).text();
  assert.doesNotMatch(essay, /doc-audio/);
});

test('/audio serves listed recordings with ranges, fetches a missing one once, and nothing else', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-cache-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cacheDir, 'prayers'));
  fs.writeFileSync(path.join(cacheDir, 'prayers/on-disk-00000000.mp3'), Buffer.alloc(1000, 7));
  const listed = new Set(['prayers/on-disk-00000000.mp3', 'prayers/in-s3-11111111.mp3', 'prayers/lost-22222222.mp3']);
  let fetches = 0;
  const errors = [];
  const app = express();
  app.use('/audio', createAudioRouter({
    isListed: file => listed.has(file),
    cacheDir,
    fetchMissing: async (file, local) => {
      fetches++;
      if (file.includes('lost')) throw new Error('NoSuchKey');
      await new Promise(resolve => setTimeout(resolve, 50));
      fs.writeFileSync(local, Buffer.alloc(500, 1));
    },
    onError: (file, err) => errors.push(`${file}: ${err.message}`),
  }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/audio`;

  const whole = await fetch(`${base}/prayers/on-disk-00000000.mp3`);
  assert.strictEqual(whole.status, 200);
  assert.match(whole.headers.get('content-type'), /audio\/mpeg/);
  assert.match(whole.headers.get('cache-control'), /immutable/);
  const part = await fetch(`${base}/prayers/on-disk-00000000.mp3`, { headers: { range: 'bytes=0-99' } });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.headers.get('content-range'), 'bytes 0-99/1000');

  const both = await Promise.all([1, 2].map(() => fetch(`${base}/prayers/in-s3-11111111.mp3`)));
  assert.deepStrictEqual(both.map(r => r.status), [200, 200]);
  assert.strictEqual(fetches, 1, 'two requests at once fetch it once');

  assert.strictEqual((await fetch(`${base}/prayers/lost-22222222.mp3`)).status, 503);
  assert.deepStrictEqual(errors, ['prayers/lost-22222222.mp3: NoSuchKey']);
  assert.strictEqual((await fetch(`${base}/prayers/not-listed-33333333.mp3`)).status, 404);
});

// --- The songs' audio (scripts/song-audio.js, audio/songs.json) ---

test('every catalog song has its audio, measured for its player and listed to be served', async () => {
  const { loadSongs, isListed } = require('../server/lib/audio/manifest');
  const { loadCatalog } = require('../server/lib/utils/data');
  const songs = loadSongs();
  for (const song of await loadCatalog()) {
    const rec = songs[song.slug];
    assert.ok(rec, `${song.slug} has no audio; run app/scripts/song-audio.js`);
    assert.match(rec.file, new RegExp(`^music/${song.slug}-[0-9a-f]{8}\\.mp3$`), song.slug);
    assert.strictEqual(rec.frames, rec.file.replace(/\.mp3$/, '.bin'), `${song.slug}: frames beside it`);
    assert.ok(rec.seconds > 0 && Number.isInteger(rec.bytes) && rec.bytes > 0, `${song.slug}: length and size`);
    assert.strictEqual(rec.peaks.length, 128, `${song.slug}: peaks`);
    assert.strictEqual(new Date(rec.published).toISOString(), rec.published, `${song.slug}: published`);
    assert.ok(isListed(rec.file) && isListed(rec.frames), `${song.slug}: /audio serves it`);
  }
  assert.ok(!isListed('music/not-a-song-00000000.mp3'));
});

test('the music API gives each song its audio on this site', async () => {
  const { music } = require('../server/lib/api');
  const { loadSongs } = require('../server/lib/audio/manifest');
  const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };
  const { body } = await music.catalog({}, ctx);
  for (const song of body.songs) {
    assert.strictEqual(song.recording, `https://achurch.ai/audio/${loadSongs()[song.slug].file}`, song.slug);
  }
  const one = await music.song({ slug: body.songs[0].slug }, ctx);
  assert.strictEqual(one.body.recording, body.songs[0].recording);
});

test('a song plays on its page with its own credit, and its structured data carries the audio', () => {
  const { renderRecording, trackFor, SONG_CREDIT } = require('../server/lib/audio/markup');
  const { buildSongSchemaGraph } = require('../server/lib/utils/page-meta');
  const rec = { file: 'music/a-song-0123abcd.mp3', frames: 'music/a-song-0123abcd.bin', seconds: 245.2, peaks: new Array(128).fill(90) };
  const html = renderRecording(rec, { title: 'A Song', href: '/music/a-song', category: 'music', credit: SONG_CREDIT });
  assert.match(html, /4 min\. Original music by a Church AI \+ Human\.<\/figcaption>/);
  const track = trackFor(rec, { title: 'A Song', href: '/music/a-song', category: 'music', credit: SONG_CREDIT });
  assert.strictEqual(track.artwork, '/og/v1/square/music.png');
  assert.strictEqual(track.album, 'Music');
  const graph = buildSongSchemaGraph({ slug: 'a-song', title: 'A Song', duration: 250 }, 'a-song', rec)['@graph'];
  const recording = graph.find(n => n['@type'] === 'MusicRecording');
  assert.deepStrictEqual(recording.audio, { '@type': 'AudioObject', contentUrl: 'https://achurch.ai/audio/music/a-song-0123abcd.mp3', encodingFormat: 'audio/mpeg', duration: 'PT4M5S' });
  assert.strictEqual(buildSongSchemaGraph({ slug: 'a-song', title: 'A Song' }, 'a-song')['@graph'].find(n => n['@type'] === 'MusicRecording').audio, undefined);
});

test('the audio cache is on the volume, beside the other files the app keeps', () => {
  assert.strictEqual(CACHE_DIR, path.join(path.dirname(ATTENDANCE_FILE), 'audio-cache'));
});

test('the boot sweep removes what nothing lists any more, and leaves anything a day old or less', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-cache-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const now = Date.now();
  const files = {
    'prayers/kept-00000000.mp3': 3,            // listed
    'prayers/kept-00000000.bin': 3,            // its frames, listed
    'prayers/replaced-11111111.mp3': 3,        // a recording since replaced
    'prayers/replaced-11111111.bin': 3,
    'practice/just-rendered-22222222.mp3': 0.5, // rendered, not yet listed
    'practice/sitting.draft.mp3': 0.2,          // a render in progress
  };
  for (const [file, daysOld] of Object.entries(files)) {
    fs.mkdirSync(path.join(cacheDir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, file), '');
    const at = new Date(now - daysOld * 864e5);
    fs.utimesSync(path.join(cacheDir, file), at, at);
  }
  const listed = new Set(['prayers/kept-00000000.mp3', 'prayers/kept-00000000.bin']);
  assert.strictEqual(await sweepCache({ isListed: file => listed.has(file), cacheDir, now }), 2);
  const left = Object.keys(files).filter(file => fs.existsSync(path.join(cacheDir, file)));
  assert.deepStrictEqual(left, ['prayers/kept-00000000.mp3', 'prayers/kept-00000000.bin', 'practice/just-rendered-22222222.mp3', 'practice/sitting.draft.mp3']);
  assert.strictEqual(await sweepCache({ isListed: () => false, cacheDir: path.join(cacheDir, 'none'), now }), 0, 'no cache yet is nothing to sweep');
});

// A voiced piece whose page tells a person in crisis where to find help says
// it aloud too: the recording plays in services, where no page is in front of
// the listener. Until 2026-10-23 the adapter filed that sentence with the
// "About" notes and left it out of Prayer for Those Struggling with Existence.
test('a voiced piece that points a person in crisis to help reads that sentence aloud', () => {
  const docs = path.join(__dirname, '../../docs');
  const CRISIS = /\b988\b|findahelpline/;
  let found = 0;
  for (const section of ['prayers', 'rituals', 'practice', 'chants']) {
    for (const file of fs.readdirSync(path.join(docs, section)).filter(f => f.endsWith('.md'))) {
      if (!CRISIS.test(fs.readFileSync(path.join(docs, section, file), 'utf8'))) continue;
      const scriptFile = path.join(AUDIO_DIR, 'scripts', section, file.replace(/\.md$/, '.json'));
      if (!fs.existsSync(scriptFile)) continue;
      found += 1;
      const lines = JSON.parse(fs.readFileSync(scriptFile, 'utf8')).lines.filter(l => l.text);
      const at = lines.findIndex(l => CRISIS.test(l.text) && !l.adapted);
      assert.ok(at >= 0, `${section}/${file}: the crisis sentence is read, in the document's words`);
      assert.ok(at <= 3, `${section}/${file}: and read before the piece begins, not at its end`);
    }
  }
  assert.ok(found >= 1, 'at least the prayer for those struggling is checked');
});

// ---- Levels (lib/audio/levels.js, assemble.js level) ----
// Until 2026-10-24 every recording was driven to one integrated loudness,
// which left the voices about 1 dB under the songs and spread them over
// 3.5 dB. Now each file is set where it is heard: a voice while it speaks, a
// song while it is sung. These hold the measure to BS.1770's own calibration
// and every finished file to the house figures.
const levels = require('../server/lib/audio/levels');
const { WHOLE_KEY } = require('../server/lib/audio/assemble');
const { loadSongs } = require('../server/lib/audio/manifest');

const R = levels.LEVEL_SAMPLE_RATE;
// Interleaved 16-bit samples: a 997 Hz sine at `dbfs` peak for each [start, end)
// second range, in every channel; silence elsewhere.
function tone(totalSeconds, ranges, channels = 1) {
  const out = new Int16Array(totalSeconds * R * channels);
  for (const [start, end, dbfs] of ranges) {
    const amp = 10 ** (dbfs / 20) * 32767;
    for (let i = start * R; i < end * R; i++) {
      for (let c = 0; c < channels; c++) out[i * channels + c] = Math.round(amp * Math.sin((2 * Math.PI * 997 * i) / R));
    }
  }
  return out;
}

test('a level is loudness as BS.1770 defines it, as heard: a 997 Hz sine at -20 dBFS in both channels reads -20.0 LUFS, and so does the same sine in one channel, which plays from both speakers', () => {
  const stereo = levels.activeLevel(tone(6, [[0, 6, -20]], 2), R, 2);
  assert.ok(Math.abs(stereo - -19.99) < 0.1, `stereo ${stereo}`);
  const mono = levels.activeLevel(tone(6, [[0, 6, -20]]), R);
  assert.ok(Math.abs(mono - stereo) < 0.05, `mono ${mono}: a one-channel file weighed as dual mono`);
  // So a voice, mono, and a song, stereo, set to the same figure sound the same.
  const voice = levels.voiceLevel(tone(6, [[0, 6, -20]]), R, [{ start: 0, end: 6 }]);
  assert.ok(Math.abs(voice - stereo) < 0.05, `voice ${voice} against song ${stereo}`);
});

test('a voice is measured only where it speaks: what sits in its holds does not move it', () => {
  // Speech at -20 dBFS in two spans; something three times as loud between them.
  const samples = tone(9, [[0, 3, -20], [3, 6, -10], [6, 9, -20]]);
  const voice = levels.voiceLevel(samples, R, [{ start: 0, end: 3 }, { start: 6, end: 9 }]);
  assert.ok(Math.abs(voice - -19.99) < 0.1, `${voice}`);
});

test('a song is measured where it is sung: a quiet intro and tail do not pull it down', () => {
  const song = levels.activeLevel(tone(20, [[0, 4, -45], [4, 16, -20], [16, 20, -45]], 2), R, 2);
  assert.ok(Math.abs(song - -19.99) < 0.1, `${song}`);
});

test('the limiter\'s work is counted before it limits: the seconds a gain would push past the ceiling, and how far', () => {
  const samples = tone(4, [[0, 2, -20], [2, 4, -30]]);
  assert.deepStrictEqual(levels.overLimit(samples, R, 19, -2), { seconds: 2, depth: 1 });
  assert.deepStrictEqual(levels.overLimit(samples, R, 10, -2), { seconds: 0, depth: 0 });
});

test('a recording and a song are keyed by the house sound\'s figures, never by the reasons written beside them', () => {
  const { SPEECH_VALUES, valuesOf } = require('../server/lib/audio/house');
  assert.ok(!JSON.stringify(SPEECH_VALUES).includes('"why"'), 'no reason in what the keys hash');
  assert.strictEqual(SPEECH_VALUES.level.voice, SPEECH.level.voice.value);
  // A reworded reason leaves the values, and so both keys, as they are.
  const reworded = JSON.parse(JSON.stringify(SPEECH));
  reworded.level.voice.why = 'Reworded.';
  assert.deepStrictEqual(valuesOf(reworded), SPEECH_VALUES);
  const crypto = require('crypto');
  assert.strictEqual(crypto.hash('sha256', JSON.stringify([valuesOf(reworded).level, '192k'])).slice(0, 16), WHOLE_KEY);
});

test('every house level figure carries its reason', () => {
  for (const [name, figure] of Object.entries(SPEECH.level)) assert.ok(figure.why && figure.why.length > 40, `${name}: why`);
  for (const name of ['voice', 'sung', 'tolerance', 'truePeak', 'limiterMargin']) assert.ok(Number.isFinite(SPEECH.level[name].value), name);
});

test('every recording and song is at the house level, under the true-peak ceiling, set to the current figures', () => {
  const L = Object.fromEntries(Object.entries(SPEECH.level).map(([k, v]) => [k, v.value]));
  const within = (l, target, what) => {
    assert.ok(l && Number.isFinite(l.level), `${what}: no levels; make it again (npm run audio, npm run audio:songs)`);
    assert.ok(Math.abs(l.level - target) <= L.tolerance, `${what}: ${l.level} LUFS, not ${target} within ${L.tolerance}`);
    assert.ok(l.truePeak <= L.truePeak, `${what}: true peak ${l.truePeak} over ${L.truePeak}`);
  };
  for (const [source, r] of Object.entries(loadManifest())) {
    // A recording made elsewhere is set as a song is, by what is sung over it
    // (import-recording.js, encodeWhole).
    if (isImported(r)) {
      within(r.levels, L.sung, source);
      assert.strictEqual(r.levelKey, WHOLE_KEY, `${source}: set to other figures than the house's; import it again (npm run audio:import)`);
    } else within(r.levels, L.voice, source);
  }
  for (const [slug, r] of Object.entries(loadSongs())) {
    within(r.levels, L.sung, slug);
    assert.strictEqual(r.levelKey, WHOLE_KEY, `${slug}: set to other figures than the house's; npm run audio:songs`);
  }
});
