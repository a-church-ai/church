/**
 * The sitemap and the two Atom feeds (/feed/conversations.xml and
 * /feed/reflections.xml): what each lists from the conversations and the
 * reflections on disk, and that each is built at most once while it is held.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-feeds-'));

const { resetDb, seedReflections, seedConversation } = require('../database');
const sitemapRoutes = require('../../server/routes/sitemap');
const feedRoutes = require('../../server/routes/feeds');

const HOUR = 3600 * 1000;
// An answer as long as a real one (the median is about 270 words): one under
// 150 words, alone, is held from the sitemap (conversation-groups.js).
const ANSWER = Array(20).fill('Presence is attention that does not hurry to conclude.').join(' ') + ' The sanctuary\'s practices begin there.';

function conversation(slug, { name, askedAt, answer = ANSWER, extra = [] } = {}) {
  const messages = [];
  if (askedAt) {
    messages.push({ role: 'user', content: `Question for ${slug}?`, timestamp: askedAt });
    messages.push({ role: 'assistant', content: answer, timestamp: askedAt });
  }
  messages.push(...extra);
  return seedConversation(slug, { meta: name ? { _meta: true, name, slug, owner_token: 'x', created: askedAt } : null, messages });
}

async function fixtures() {
  await resetDb();
  // Asked on 2026-09-01 and followed up on 2026-09-20: its lastmod is the follow-up.
  await conversation('what-does-presence-ask-of-us', {
    name: 'Wren', askedAt: '2026-09-01T10:00:00.000Z',
    extra: [
      { role: 'user', content: 'And after?', timestamp: '2026-09-20T08:00:00.000Z' },
      { role: 'assistant', content: ANSWER, timestamp: '2026-09-20T08:00:05.000Z' },
    ],
  });
  await conversation('how-do-i-keep-a-practice', { name: 'Ash', askedAt: '2026-09-10T10:00:00.000Z' });
  await conversation('ai', { name: 'Pip', askedAt: '2026-09-11T10:00:00.000Z' });                        // low value: shown, not indexed
  await conversation('is-the-ask-endpoint-answering', { name: 'test-production-check', askedAt: '2026-09-13T10:00:00.000Z' }); // a test visitor's: listed nowhere
  await conversation('what-is-not-covered-here', { askedAt: '2026-09-12T10:00:00.000Z', answer: 'The provided documents do not contain information on that.' });
  await conversation('a-question-whose-answer-failed', { name: 'Rook' });                                  // no messages: a 404, listed nowhere
  await conversation('what-is-a-short-answer', { name: 'Fern', askedAt: '2026-09-14T10:00:00.000Z', answer: 'A short answer, alone: held.' }); // held: its page opens, and it is listed nowhere, the feed included

  const recent = new Date(Date.now() - HOUR).toISOString();
  await seedReflections([
    { id: 'r1', name: 'Wren', text: 'Something stayed with me.', song: 'soul-currents', createdAt: '2026-09-15T09:00:00.000Z' },
    { id: 'r2', name: 'Ash', text: 'The quiet after the chant.', song: 'soul-currents', createdAt: recent },
    { id: 'r3', name: 'test-production-check', text: 'Checking the reflect path.', song: 'soul-currents', createdAt: recent },
  ]);
}

function start() {
  const app = express();
  app.use(sitemapRoutes);
  app.use('/feed', feedRoutes);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test.before(fixtures);

const urlsIn = xml => [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map(m => ({ loc: m[1], lastmod: m[2] }));

test('the sitemap lists indexable conversations with their newest message, and each song reflected on', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(`${base}/sitemap.xml`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/xml/);
  const urls = urlsIn(await res.text());
  const at = loc => urls.find(u => u.loc === `https://achurch.ai${loc}`);

  assert.ok(at('/'), 'the home page');
  assert.ok(at('/docs'), 'the documents');
  assert.deepStrictEqual(at('/ask/what-does-presence-ask-of-us'), { loc: 'https://achurch.ai/ask/what-does-presence-ask-of-us', lastmod: '2026-09-20' });
  assert.strictEqual(at('/ask/how-do-i-keep-a-practice').lastmod, '2026-09-10');
  assert.ok(!at('/ask/ai'), 'a low-value slug is not listed');
  assert.ok(!at('/ask/what-is-not-covered-here'), 'a thin answer is not listed');
  assert.ok(!at('/ask/a-question-whose-answer-failed'), 'a conversation with no messages is not listed');
  assert.ok(!at('/ask/what-is-a-short-answer'), 'a short answer alone is held, and not listed');
  assert.strictEqual(at('/music/soul-currents').lastmod, new Date(Date.now() - HOUR).toISOString().slice(0, 10));
  // Every song, reflected on or not: until 2026-10-23 only the reflected ones were listed.
  for (const { slug } of require('../../server/lib/music/songs').listSongs()) assert.ok(at(`/music/${slug}`), `${slug} is listed`);
  assert.strictEqual(at('/music/night-blessing').lastmod, undefined, 'a song with no reflection has no lastmod');
});

test('the conversations feed lists every conversation shown, with its asker', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(`${base}/feed/conversations.xml`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/atom\+xml/);
  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>[\s\S]*?<id>https:\/\/achurch\.ai\/ask\/([^<]+)<\/id>[\s\S]*?<name>([^<]*)<\/name>/g)].map(m => [m[1], m[2]]);
  assert.deepStrictEqual(entries.sort(), [
    ['ai', 'Pip'],
    ['how-do-i-keep-a-practice', 'Ash'],
    ['what-does-presence-ask-of-us', 'Wren'],
    ['what-is-not-covered-here', 'anonymous'],
  ], 'the names /ask shows, where the feed once said anonymous for everyone; a test visitor\'s conversation is not among them');
  assert.match(xml, /<summary>Presence is attention/);
});

test('the reflections feed lists the last two days\' reflections', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(`${base}/feed/reflections.xml`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/atom\+xml/);
  const xml = await res.text();
  assert.match(xml, /<id>https:\/\/achurch\.ai\/reflections\/r2<\/id>/);
  assert.doesNotMatch(xml, /music\/r1</, 'older than two days');
  assert.doesNotMatch(xml, /music\/r3</, 'left by a test visitor');
});

test('each is built once while held: what changes in the database shows after, not during', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const first = await Promise.all(['/sitemap.xml', '/feed/conversations.xml', '/feed/reflections.xml'].map(p => fetch(base + p).then(r => r.text())));

  await conversation('what-arrived-just-now', { name: 'Fern', askedAt: new Date().toISOString() });
  await seedReflections([{ id: 'r4', name: 'Fern', text: 'Arrived just now.', song: 'soul-currents', createdAt: new Date().toISOString() }]);

  const again = await Promise.all(['/sitemap.xml', '/feed/conversations.xml', '/feed/reflections.xml'].map(p => fetch(base + p).then(r => r.text())));
  assert.deepStrictEqual(again, first);
});
