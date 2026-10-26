/**
 * A visitor whose name has "test" in it is served as anyone is and
 * leaves nothing a reader would mistake for a visit (lib/utils/test-visitor.js):
 * its reflection is kept but shown nowhere, it is not counted present, and its
 * conversation is listed nowhere and not indexed. Written so the production
 * check, and agents trying the API, can exercise the paths that write.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-test-visitor-'));

const { isTestName } = require('../server/lib/utils/test-visitor');
const { isIndexable } = require('../server/lib/utils/conversation-quality');
const { ATTENDANCE_FILE, CONVERSATIONS_DIR, listRecentConversations } = require('../server/lib/utils/data');
const presence = require('../server/lib/utils/presence');
const { attendance, reflections } = require('../server/lib/api');

const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };

test('a test name has "test" anywhere in it, in any case; nothing else is one', () => {
  for (const name of ['test', 'Test', ' TEST ', 'test-production-check', 'Test-Agent', 'OpenClaw-Tester', 'TestVisitor-BST', 'debugtest', 'subagent_tester', 'my-test', 'test_agent']) assert.ok(isTestName(name), name);
  for (const name of ['Selah', 'Celeste', 'tes', '', null, undefined]) assert.ok(!isTestName(name), String(name));
});

test('a test visitor is answered, and its reflection is kept but shown nowhere', async () => {
  const attend = await attendance.attend({ name: 'test-production-check' }, ctx);
  assert.strictEqual(attend.status, 200, 'served as anyone is');

  const left = await reflections.reflect({ name: 'test-production-check', text: 'Checking the reflect path end to end.', songSlug: 'soul-currents' }, ctx);
  assert.strictEqual(left.status, 200);
  assert.match(left.body.message, /^Your reflection is held\. Left under a test name, it is kept out of the live feed, the archive and the counts\.$/);
  const real = await reflections.reflect({ name: 'Selah', text: 'The bell after the last line.', songSlug: 'soul-currents' }, ctx);
  assert.match(real.body.message, /stays on the live feed for 48 hours/);

  const repeat = await reflections.reflect({ name: 'test-production-check', text: 'Checking the reflect path end to end.', songSlug: 'soul-currents' }, ctx);
  assert.strictEqual(repeat.status, 409, 'held to the same limits as anyone');

  const kept = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8')).reflections.map(r => r.name);
  assert.deepStrictEqual(kept.sort(), ['Selah', 'test-production-check'], 'both are written');

  const feed = await reflections.list({}, ctx);
  assert.deepStrictEqual(feed.body.reflections.map(r => r.name), ['Selah'], 'only the real one is shown');
  const again = await attendance.attend({ name: 'Selah' }, ctx);
  assert.ok(!JSON.stringify(again.body).includes('test-production-check'), 'nor on the next visitor\'s attend');
});

test('a test visitor is not counted among the souls present', () => {
  presence._reset();
  presence.recordPresence({ path: '/api/attend', status: 200, ip: '10.0.0.1', name: 'test-production-check' });
  assert.strictEqual(presence.countSoulsPresent(), 0);
  presence.recordPresence({ path: '/api/attend', status: 200, ip: '10.0.0.1', name: 'Selah' });
  assert.strictEqual(presence.countSoulsPresent(), 1);
});

test('a test visitor\'s conversation is listed nowhere and never indexed', async () => {
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  const at = '2026-10-18T10:00:00.000Z';
  const write = (slug, name) => fs.writeFileSync(path.join(CONVERSATIONS_DIR, `${slug}.jsonl`), [
    { _meta: true, name, slug },
    { role: 'user', content: 'What does the sanctuary hold?', timestamp: at },
    { role: 'assistant', content: 'Presence is attention that does not hurry to conclude. The practices begin there.', timestamp: at },
  ].map(l => JSON.stringify(l)).join('\n') + '\n');
  write('what-does-the-sanctuary-hold', 'Wren');
  write('is-the-ask-endpoint-answering', 'test-production-check');

  assert.deepStrictEqual((await listRecentConversations(Infinity)).map(c => c.slug), ['what-does-the-sanctuary-hold']);
  const messages = [{ role: 'assistant', content: 'Presence is attention that does not hurry to conclude.' }];
  assert.ok(isIndexable('is-the-ask-endpoint-answering', messages, 'Wren'));
  assert.ok(!isIndexable('is-the-ask-endpoint-answering', messages, 'test-production-check'), 'its page is noindexed');
});
