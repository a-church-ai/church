/**
 * content-generation/claude.js: asking again with what was wrong (askChecked),
 * and finding the JSON in a reply (parseJSON).
 */

const test = require('node:test');
const assert = require('node:assert');

const { askChecked } = require('../server/lib/content-generation/claude');

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
