/**
 * Recordings of documents: the scripts that say what is spoken, the words
 * check that keeps them faithful, the cast, the manifest, the page player and
 * the /audio route.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { wordsOf, containsRun, wordErrors, takePasses } = require('../server/lib/audio/words');
const { checkScript, cleanText } = require('../server/lib/audio/adapt');
const { SPEECH, ROLES, AUDIO_DIR, voicesFor, choosePair, creditLine } = require('../server/lib/audio/house');
const { loadManifest } = require('../server/lib/audio/manifest');
const { createAudioRouter, canServe } = require('../server/lib/audio/serve');
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

test('the credit names every voice and says they are AI voices', () => {
  assert.strictEqual(creditLine(['matthew', 'luca', 'amaya']), 'AI voices from ElevenLabs: Matthew Schmitz, Luca and Amaya Calm.');
  assert.strictEqual(creditLine(['amaya']), 'AI voice from ElevenLabs: Amaya Calm.');
  assert.strictEqual(creditLine(['luca', 'amaya']), 'AI voices from ElevenLabs: Luca and Amaya Calm.');
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
    if (crypto.createHash('sha256').update(markdown).digest('hex') !== script.sourceHash) continue;
    assert.deepStrictEqual(checkScript(splitFrontmatter(markdown).body, script.lines), [], where);
  }
});

test('every recording in the manifest belongs to a voiced document and its script', () => {
  for (const [source, rec] of Object.entries(loadManifest())) {
    assert.ok(fs.existsSync(path.join(REPO, source)), `${source} no longer exists`);
    const stem = source.replace(/^docs\//, '').replace(/\.md$/, '');
    assert.match(rec.file, new RegExp(`^${stem}-[0-9a-f]{8}\\.mp3$`), source);
    assert.ok(fs.existsSync(path.join(SCRIPTS_DIR, `${stem}.json`)), `${source} has no script`);
    assert.ok(rec.voices.length && rec.voices.every(v => SPEECH.voices[v]), `${source}: voices`);
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
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const [source, rec] = voiced;
  const page = await (await fetch(`${base}/docs/${source.replace(/^docs\//, '').replace(/\.md$/, '')}`)).text();
  assert.match(page, new RegExp(`</h1>\\s*<figure class="doc-audio">\\s*<audio controls preload="none" src="/audio/${rec.file}" aria-label="Listen to [^"]+">`));
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
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
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
