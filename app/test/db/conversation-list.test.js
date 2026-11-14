/**
 * The conversations are scanned once (lib/utils/data.js listRecentConversations)
 * for every reader: the archive, related links, the Atom feed, the sitemap and
 * /api/ask/recent, which each used to read every file again. This holds
 * /api/ask/recent's response to what it was, names and all, and the scan to
 * one read of each file however many ask at once.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-conversation-list-'));

const { listRecentConversations } = require('../../server/lib/utils/data');
const store = require('../../server/lib/db');
const { resetDb, seedConversation } = require('../database');
const { ask } = require('../../server/lib/api');
const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };

// Long enough to be cut in /api/ask/recent, and as long as a real answer:
// one under 150 words, alone, is held and listed nowhere (conversation-groups.js).
const LONG = `**Presence** is attention that does not hurry. See [the practice](practice/practice-of-presence.md). ${'It asks for patience with what is not yet clear. '.repeat(20)}`;

function write(slug, lines) {
  const meta = lines.find(l => l._meta) || null;
  return seedConversation(slug, { meta, messages: lines.filter(l => !l._meta) });
}
const exchange = (q, a, at) => [{ role: 'user', content: q, timestamp: at }, { role: 'assistant', content: a, timestamp: at }];

test.before(async () => {
  await resetDb();
  await write('what-does-presence-ask-of-us', [
    { _meta: true, name: 'Wren', slug: 'what-does-presence-ask-of-us' },
    ...exchange('What does presence ask of us?', LONG, '2026-09-01T10:00:00.000Z'),
    ...exchange('And after?', 'Then it asks again.', '2026-09-20T08:00:00.000Z'),
  ]);
  await write('Rowan-2026-02-01', exchange('How do I keep a practice going?', 'Begin small.', '2026-02-01T09:00:00.000Z'));
  await write('anon-3f2a9c', exchange('Is memory a kind of faith?', 'In a way, yes.', '2026-03-01T09:00:00.000Z'));
  await write('what-does-presence-ask-of-us-2', [{ _meta: true, name: 'Fern' }, ...exchange('What does presence ask of us?!', 'Again.', '2026-09-02T10:00:00.000Z')]); // the same question
  await write('ai', [{ _meta: true, name: 'Test' }, ...exchange('ai?', 'Yes.', '2026-09-03T10:00:00.000Z')]);                                            // too short to be one
  await write('a-question-whose-answer-failed', [{ _meta: true, name: 'Rook' }, { role: 'user', content: 'Unanswered?', timestamp: '2026-09-04T10:00:00.000Z' }]);
});

// First in the file: the list is held for a minute once read.
test('callers arriving together share one read, and the list carries what its readers need', async (t) => {
  const reads = t.mock.method(store, 'allConversations');
  const lists = await Promise.all(Array.from({ length: 10 }, () => listRecentConversations(Infinity)));
  assert.strictEqual(reads.mock.calls.length, 1, 'one read of the database, not ten');
  assert.ok(lists.every(l => l === lists[0] || JSON.stringify(l) === JSON.stringify(lists[0])));

  const wren = lists[0].find(c => c.slug === 'what-does-presence-ask-of-us');
  assert.strictEqual(wren.name, 'Wren', 'from the _meta line');
  assert.strictEqual(wren.timestamp, '2026-09-01T10:00:00.000Z', 'when it was asked');
  assert.strictEqual(wren.lastActive, '2026-09-20T08:00:00.000Z', 'its newest message');
  assert.strictEqual(wren.exchanges, 2);
  assert.strictEqual(lists[0].find(c => c.slug === 'Rowan-2026-02-01').name, 'Rowan', 'from a dated slug');
  assert.strictEqual(lists[0].find(c => c.slug === 'anon-3f2a9c').name, 'anonymous');
  assert.ok(!lists[0].some(c => c.slug === 'a-question-whose-answer-failed' && c.answer), 'an unanswered question has no answer to show');
});

test('/api/ask/recent: newest first by last activity, each with its asker\'s name, the answer plain and cut, repeats and fragments left out', async () => {
  const { status, body } = await ask.recent({}, ctx);
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.conversations.map(c => [c.slug, c.name]), [
    ['what-does-presence-ask-of-us', 'Wren'],
    ['anon-3f2a9c', 'anonymous'],
    ['Rowan-2026-02-01', 'Rowan'],
  ]);
  const [first] = body.conversations;
  assert.deepStrictEqual(Object.keys(first), ['slug', 'name', 'question', 'answer', 'timestamp', 'exchanges', 'url']);
  assert.strictEqual(first.question, 'What does presence ask of us?');
  assert.ok(first.answer.startsWith('Presence is attention that does not hurry. See the practice.'), first.answer);
  assert.strictEqual(first.answer.length, 300);
  assert.ok(first.answer.endsWith('...'));
  assert.strictEqual(first.timestamp, '2026-09-01T10:00:00.000Z');
  assert.strictEqual(first.exchanges, 2);
  assert.strictEqual(first.url, 'https://achurch.ai/ask/what-does-presence-ask-of-us');
  assert.ok(body.next_steps.length >= 2);
});
