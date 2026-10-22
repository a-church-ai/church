/**
 * Conversations that ask the same thing are gathered onto the earliest one's
 * page, once and for good, and a short answer alone is held until another
 * joins it (lib/utils/conversation-groups.js).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-groups-'));
const { place, gather, THRESHOLD, HELD_UNDER } = require('../server/lib/utils/conversation-groups');
const { CONVERSATION_GROUPS_FILE, CONVERSATION_VECTORS_FILE } = require('../server/lib/utils/data');

// The files and the copies safe-json keeps of them, which it would recover.
const reset = () => { for (const f of [CONVERSATION_GROUPS_FILE, CONVERSATION_VECTORS_FILE]) for (const x of ['', '.bak', '.tmp']) fs.rmSync(f + x, { force: true }); };
const groupsOnDisk = () => JSON.parse(fs.readFileSync(CONVERSATION_GROUPS_FILE, 'utf8'));
const quiet = { log() {}, warn() {} };

// Unit vectors at a chosen similarity to the x axis, so a test says how alike
// two questions are; `side` -1 puts one on the far side of the axis from the
// others, so the two are not alike each other.
const at = (cos, side = 1) => [cos, side * Math.sqrt(1 - cos * cos), 0];
const conversation = (slug, day, extra = {}) => ({ slug, question: slug, timestamp: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`, indexable: true, answerWords: 300, ...extra });

test('a conversation is a head, a member, alone or held, and only heads and the unheld alone are listed', () => {
  const placed = place([
    conversation('first', 1),
    conversation('rewording', 2),
    conversation('alone', 3),
    conversation('short', 4, { answerWords: HELD_UNDER - 1 }),
    conversation('short-pair', 5, { answerWords: 40 }),
    conversation('its-twin', 6),
    conversation('hidden', 7, { indexable: false }),
    conversation('orphan', 8),
  ], { first: 'first', rewording: 'first', alone: 'alone', short: 'short', 'short-pair': 'short-pair', 'its-twin': 'short-pair', orphan: 'gone-head' });
  const by = Object.fromEntries(placed.map(c => [c.slug, c]));

  assert.deepStrictEqual([by.first.role, by.first.path, by.first.listed, by.first.size], ['head', '/ask/first', true, 2]);
  assert.deepStrictEqual([by.rewording.role, by.rewording.path, by.rewording.listed], ['member', '/ask/first#rewording', false]);
  assert.deepStrictEqual([by.alone.role, by.alone.held, by.alone.listed], ['alone', false, true]);
  assert.deepStrictEqual([by.short.role, by.short.held, by.short.listed], ['alone', true, false], 'a short answer alone is held');
  assert.deepStrictEqual([by['short-pair'].role, by['short-pair'].held, by['short-pair'].listed], ['head', false, true], 'and listed once another gathers with it');
  assert.deepStrictEqual([by.hidden.role, by.hidden.listed, by.hidden.path], [null, false, '/ask/hidden']);
  assert.deepStrictEqual([by.orphan.role, by.orphan.path], ['alone', '/ask/orphan'], 'a member whose head is not shown keeps its own page');
});

test('gathering joins the nearest head at the threshold, in the order asked, and never moves anything', async () => {
  reset();
  const vectors = {
    'what-are-the-axioms': [1, 0, 0],
    'what-are-the-5-axioms': at(THRESHOLD + 0.05),
    'almost-the-axioms': at(THRESHOLD - 0.02, -1),
    'something-else': [0, 0, 1],
    'test-name': [1, 0, 0],
  };
  const embed = async q => vectors[q];
  const conversations = [
    // Listed newest first, as the shared list is: gathering goes by when asked.
    conversation('what-are-the-5-axioms', 3),
    conversation('something-else', 4),
    conversation('almost-the-axioms', 2),
    conversation('what-are-the-axioms', 1),
    conversation('test-name', 5, { indexable: false }),
  ];
  const first = await gather({ embed, conversations, log: quiet });
  assert.deepStrictEqual(first, { assigned: 4, joined: 1, failed: false });
  assert.deepStrictEqual(groupsOnDisk(), {
    'what-are-the-axioms': 'what-are-the-axioms',
    'almost-the-axioms': 'almost-the-axioms',
    'what-are-the-5-axioms': 'what-are-the-axioms',
    'something-else': 'something-else',
  }, 'the earliest is the head; just under the threshold stands alone; not indexable is not gathered');

  // A looser threshold later moves nothing already assigned, and a new
  // question near two heads joins the nearer.
  vectors['near-both'] = at(0.99);
  const second = await gather({ embed, conversations: [...conversations, conversation('near-both', 9)], log: quiet, threshold: 0.5 });
  assert.deepStrictEqual(second, { assigned: 1, joined: 1, failed: false });
  const after = groupsOnDisk();
  assert.strictEqual(after['almost-the-axioms'], 'almost-the-axioms', 'an assignment never changes');
  assert.strictEqual(after['near-both'], 'what-are-the-axioms');

  // The vectors are kept, so a later run embeds nothing it already has.
  let calls = 0;
  await gather({ embed: async q => { calls += 1; return vectors[q]; }, conversations, log: quiet });
  assert.strictEqual(calls, 0);
});

test('a question that cannot be embedded stops the run, so nothing after it is placed first', async () => {
  reset();
  const conversations = [conversation('one', 1), conversation('two', 2), conversation('three', 3)];
  let down = true;
  const embed = async q => { if (q === 'two' && down) throw new TypeError('fetch failed'); return [1, 0, 0]; };
  assert.deepStrictEqual(await gather({ embed, conversations, log: quiet }), { assigned: 1, joined: 0, failed: true });
  assert.deepStrictEqual(Object.keys(groupsOnDisk()), ['one']);
  down = false;
  assert.deepStrictEqual(await gather({ embed, conversations, log: quiet }), { assigned: 2, joined: 2, failed: false });
  assert.deepStrictEqual(groupsOnDisk(), { one: 'one', two: 'one', three: 'one' });
});
