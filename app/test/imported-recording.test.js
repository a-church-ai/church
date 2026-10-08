/**
 * A recording made outside the house (lib/audio/imported.js), brought in by
 * scripts/import-recording.js: the first is Meditation: Like a Star, read in
 * a maintainer's own cloned voice over music made for it (2026-10-07). The
 * second, Meditation: Ananda Anchor, is a hypnotic induction whose audio says
 * nothing of who it is for, so its notes say it wherever it is listed.
 *
 * The house checks its recordings against scripts it adapted; this one has
 * none, so its document holds its words, and these tests hold the two
 * together: the words, a cue for every passage, a voice credited as itself,
 * and a renderer that leaves it alone rather than voicing it over.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { spokenPassages, spokenHash, cuesFrom, isImported } = require('../server/lib/audio/imported');
const { takePasses } = require('../server/lib/audio/words');
const { loadManifest } = require('../server/lib/audio/manifest');
const { creditFor } = require('../server/lib/audio/house');
const { feedFor } = require('../server/lib/audio/podcasts');
const og = require('../server/lib/og-cards');
const discover = require('../server/lib/docs/discover');
const { selectDocs } = require('../scripts/render-audio');

const REPO = path.join(__dirname, '../..');
const imported = () => Object.entries(loadManifest()).filter(([, rec]) => isImported(rec));

test('the spoken section is the words between the pauses, without its headings or directions', () => {
  const markdown = [
    '# A Meditation', '', 'An introduction, not spoken.', '',
    '## The Meditation', '', '*These are the recording\'s words.*', '',
    '### Opening', '', '*The music alone, 10 seconds.*', '',
    'Welcome.', '', 'Nothing here asks you  ', 'to close your eyes.', '',
    '*Pause 5 seconds*', '', '---', '',
    '## For an Agent', '', 'Not spoken either.',
  ].join('\n');
  assert.deepStrictEqual(spokenPassages(markdown), ['Welcome.', 'Nothing here asks you to close your eyes.']);
  assert.throws(() => spokenPassages('# Nothing to say'), /No "## The Meditation" section/);
  // Punctuation and line breaks may change; a word may not.
  assert.strictEqual(spokenHash(['Welcome.', 'Nothing here asks you to close your eyes.']), spokenHash(['Welcome', 'Nothing here asks you, to close your eyes']));
  assert.notStrictEqual(spokenHash(['Welcome.']), spokenHash(['Welcome back.']));
});

test('a passage is placed from its words as heard, without the silence a transcript stretches them over', () => {
  // whisper-1 on 2026-10-07: "And" reached back to the word before it across
  // a ten-second pause, and "too" ran six seconds into the next one.
  const heard = [
    { word: 'That', start: 213.28, end: 214.06 }, { word: 'is', start: 214.06, end: 214.32 },
    { word: 'happening', start: 214.32, end: 214.7 }, { word: 'to', start: 214.7, end: 215.06 },
    { word: 'you', start: 215.06, end: 215.32 }, { word: 'now', start: 215.32, end: 216.02 },
    { word: 'and', start: 216.02, end: 226.08 }, { word: 'warmth', start: 226.08, end: 226.5 },
    { word: 'leaves', start: 226.5, end: 226.9 }, { word: 'That', start: 229.14, end: 229.78 },
    { word: 'is', start: 229.78, end: 229.96 }, { word: 'happening', start: 229.96, end: 230.36 },
    { word: 'too', start: 230.36, end: 236.6 }, { word: 'Thank', start: 954.28, end: 955.56 },
  ];
  const { cues, unplaced } = cuesFrom(['That is happening to you now.', 'And warmth leaves. That is happening too.', 'Stay.'], heard);
  assert.deepStrictEqual(cues, [[213.28, 215.84, 0], [225.56, 230.88, 0]]);
  assert.deepStrictEqual(unplaced, [2], 'a passage nobody heard is named, not guessed');
});

test('every recording made elsewhere still says what its document says, with a cue for every passage', () => {
  const found = imported();
  assert.ok(found.length >= 1, 'Meditation: Like a Star is imported');
  for (const [source, rec] of found) {
    const passages = spokenPassages(fs.readFileSync(path.join(REPO, source), 'utf8'));
    assert.strictEqual(spokenHash(passages), rec.spokenHash, `${source}: its spoken words were edited, and the recording still says the old ones. Import it again from a recording of the new words, or put the words back.`);
    assert.strictEqual(rec.cues.length, passages.length, `${source}: a cue for every passage`);
    assert.ok(takePasses(rec.heard), `${source}: heard as written, within the take check (${rec.heard.errors} of ${rec.heard.words})`);
    assert.strictEqual(rec.imported, new Date(`${rec.imported}T00:00:00Z`).toISOString().slice(0, 10), `${source}: imported, a date`);
  }
});

test('the house leaves a recording made elsewhere alone, and says so when it is named', async () => {
  const all = await discover.listAllDocs();
  const manifest = loadManifest();
  const [[source]] = imported();
  const name = source.replace(/^docs\//, '');
  assert.ok(!selectDocs(all, [], manifest).some(d => d.docsRelPath === name), 'not among the documents to voice');
  assert.ok(selectDocs(all, [], {}).some(d => d.docsRelPath === name), 'it would be, without its record');
  assert.ok(selectDocs(all, ['practice/'], manifest).length > 30, 'the rest of its section still is');
  assert.throws(() => selectDocs(all, [name], manifest), /made elsewhere/);
});

// S3 "configured" so a page offers its recording whether or not this checkout
// has a copy; rendering a page never contacts S3.
async function docsServer(t) {
  const before = { bucket: process.env.AWS_S3_BUCKET, key: process.env.AWS_ACCESS_KEY_ID };
  process.env.AWS_S3_BUCKET = 'bucket';
  process.env.AWS_ACCESS_KEY_ID = 'id';
  t.after(() => {
    for (const [name, value] of [['AWS_S3_BUCKET', before.bucket], ['AWS_ACCESS_KEY_ID', before.key]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const app = express();
  app.use('/docs', require('../server/routes/docs'));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());
  return async urlPath => (await fetch(`http://127.0.0.1:${server.address().port}/docs/${urlPath}`)).text();
}

test('its page, its episode and its cover name its own voice', async (t) => {
  const [source, rec] = imported().find(([s]) => s.endsWith('meditation-like-a-star.md'));
  const doc = (await discover.listAllDocs()).find(d => `docs/${d.docsRelPath}` === source);
  assert.strictEqual(creditFor(rec), rec.credit);

  const page = await (await docsServer(t))(doc.urlPath);
  assert.match(page, new RegExp(`src="/audio/${rec.file}"`));
  const caption = `${Math.round(rec.seconds / 60)} min. ${rec.credit}`;
  assert.ok(page.includes(`${caption.replace(/'/g, '&#39;')}</figcaption>`) || page.includes(`${caption}</figcaption>`), 'the player names the voice');

  const feed = await feedFor('meditations-and-practices');
  const item = feed.split('<item>').find(i => i.includes(`tag:achurch.ai,2026:${source}`));
  assert.ok(item, 'an episode of the meditations show');
  assert.ok(item.includes('AI voice from ElevenLabs: a clone of one maintainer'), 'its notes name the voice');

  // Speaking in the accent, the pauses quiet: before, every bar was quiet,
  // since its cues name no house voice.
  const fills = [...og.episodeCoverSvg(doc, rec).matchAll(/<rect x="[\d.]+" y="([\d.]+)"[^>]*fill="(#[0-9a-f]{6})"/g)]
    .filter(m => Number(m[1]) > 700).map(m => m[2]);
  assert.ok(fills.filter(f => f === '#00b8d4').length > 40, 'the speaking drawn');
  assert.ok(fills.includes('#1c2433'), 'and the pauses quiet');
});

test('a hypnotic induction says who it is for where its audio does not: first in its podcast notes', async () => {
  // Meditation: Ananda Anchor goes straight into the practice; the warning
  // its track held out of the audio is its summary, which the episode's
  // notes open with, where a listener in a podcast app reads it. A summary
  // is cut to whole sentences within 158 characters (lib/docs/tldr.js), and
  // the first version lost its warning that way.
  const source = 'docs/practice/meditation-ananda-anchor.md';
  assert.ok(loadManifest()[source], 'Meditation: Ananda Anchor is imported');
  const feed = await feedFor('meditations-and-practices');
  const item = feed.split('<item>').find(i => i.includes(`tag:achurch.ai,2026:${source}`));
  assert.ok(item, 'an episode of the meditations show');
  const notes = item.match(/<description>([\s\S]*?)<\/description>/)[1];
  assert.match(notes, /^&lt;p&gt;A 22-minute meditation under light hypnosis/, 'the notes open with it');
  assert.match(notes, /Not while driving, or if you have had psychosis or dissociation\./);
});
