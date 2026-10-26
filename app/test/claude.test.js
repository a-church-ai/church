/**
 * content-generation/claude.js: asking again with what was wrong (askChecked),
 * and finding the JSON in a reply (parseJSON).
 */

const test = require('node:test');
const assert = require('node:assert');

const { askChecked, parseJSON } = require('../server/lib/content-generation/claude');

// A check that wants an even number, as the callers' checks want a valid piece.
const even = reply => ({ value: reply.n, problems: reply.n % 2 ? [`${reply.n} is odd`] : [], shown: JSON.stringify(reply) });

test('a clean first answer is returned without asking again', async () => {
  const asked = [];
  const value = await askChecked({ label: 'number', tries: 3, check: even, attempt: async (feedback, problems) => { asked.push({ feedback, problems }); return { n: 4 }; } });
  assert.strictEqual(value, 4);
  assert.deepStrictEqual(asked, [{ feedback: '', problems: [] }]);
});

test('an answer with problems is asked for again with the answer and its problems named', async () => {
  const answers = [{ n: 3 }, { n: 8 }];
  const asked = [];
  const value = await askChecked({ label: 'number', tries: 3, check: even, attempt: async (feedback, problems) => { asked.push({ feedback, problems }); return answers.shift(); } });
  assert.strictEqual(value, 8);
  assert.strictEqual(asked.length, 2);
  assert.deepStrictEqual(asked[1].problems, ['3 is odd']);
  assert.strictEqual(asked[1].feedback, '\n\nYour previous number was:\n{"n":3}\n\nIt has these problems. Fix them and return the whole number again.\n- 3 is odd');
});

test('after the last try it throws, naming the last problems', async () => {
  let calls = 0;
  await assert.rejects(
    askChecked({ label: 'number', tries: 3, check: even, attempt: async () => ({ n: 2 * ++calls + 1 }) }),
    /^Error: the number still has problems after 3 tries: 7 is odd$/,
  );
  assert.strictEqual(calls, 3);
});

test('a failing call is not asked again: it is the caller\'s', async () => {
  let calls = 0;
  await assert.rejects(askChecked({ label: 'number', tries: 3, check: even, attempt: async () => { calls++; throw new Error('overloaded'); } }), /overloaded/);
  assert.strictEqual(calls, 1);
});

test('a clean reply parses as before: an object, an array, a fenced reply', () => {
  assert.deepStrictEqual(parseJSON('{"a": 1}'), { a: 1 });
  assert.deepStrictEqual(parseJSON('[1, 2]'), [1, 2]);
  assert.deepStrictEqual(parseJSON('```json\n{"a": {"b": [1, {"c": 2}]}}\n```'), { a: { b: [1, { c: 2 }] } });
});

test('a sentence before or after the JSON is passed over', () => {
  assert.deepStrictEqual(parseJSON('Here is the arrangement:\n{"pieces": ["a", "b"]}'), { pieces: ['a', 'b'] });
  assert.deepStrictEqual(parseJSON('{"pieces": ["a"]}\n\nI chose these for the morning.'), { pieces: ['a'] });
});

test('a reply that corrects itself is read for its last object', () => {
  // The digest of 2026-10-12 15:57 UTC, in shape: five themes, the model
  // noticing the limit, and a corrected copy.
  const reply = '{"groups": {"g1": ["a", "b", "c", "d", "e"]}}\n\nWait, that gives five themes where the limit is four. Corrected output:\n\n{"groups": {"g1": ["a", "b", "c", "d"]}}';
  assert.deepStrictEqual(parseJSON(reply), { groups: { g1: ['a', 'b', 'c', 'd'] } });
});

test('braces and brackets inside strings, and escaped quotes, do not confuse it', () => {
  const reply = 'Note: {not json}\n{"word": "a } brace, a ] bracket and a \\"quoted { word\\"", "n": [1]} [1]';
  assert.deepStrictEqual(parseJSON(reply), { word: 'a } brace, a ] bracket and a "quoted { word"', n: [1] }, 'an object is preferred to a trailing footnote');
  assert.deepStrictEqual(parseJSON('Draft: { never closed, then {"a": 1}'), { a: 1 }, 'an opening never closed hides nothing after it');
  assert.deepStrictEqual(parseJSON('Two lists: [1, 2] and [3]'), [3], 'with no object, the last array');
});

test('a reply with no JSON in it throws', () => {
  assert.throws(() => parseJSON('I could not arrange this service.'), /JSON/);
  assert.throws(() => parseJSON('{"unfinished": ['), /JSON/);
});
