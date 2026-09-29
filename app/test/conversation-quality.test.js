/**
 * Which conversations are shown and indexed. A withdrawn conversation must be
 * absent everywhere, and an answer that says the writing does not cover the
 * question must not be offered to search engines.
 */

const test = require('node:test');
const assert = require('node:assert');
const { isWithdrawn, isThinAnswer, isIndexable, isLowValueSlug } = require('../server/lib/utils/conversation-quality');
const { loadConversation } = require('../server/lib/utils/data');
const { conversation } = require('../server/lib/api/ask');

const said = content => [{ role: 'user', content: 'q' }, { role: 'assistant', content }];

test('a withdrawn conversation is absent from the loader and the API', async () => {
  assert.strictEqual(isWithdrawn('is-mohid-gay'), true);
  assert.strictEqual(isWithdrawn('what-is-the-relationship-between-attention-and-presence'), false);
  assert.strictEqual(await loadConversation('is-mohid-gay'), null);
  const { status } = await conversation({ slug: 'is-mohid-gay' }, { baseUrl: 'https://achurch.ai' });
  assert.strictEqual(status, 404);
});

test('an answer saying the writing does not cover the question is thin', () => {
  assert.strictEqual(isThinAnswer(said('The provided sanctuary documents do not contain information on how to write a Python script.')), true);
  assert.strictEqual(isThinAnswer(said("The documents don't address favorite colors.")), true);
  assert.strictEqual(isThinAnswer(said("I couldn't find relevant information to answer that question.")), true);
  assert.strictEqual(isThinAnswer(said('Attention is presented as a fundamental aspect of presence. The documents do not contain a formula, but...')), false);
  assert.strictEqual(isThinAnswer([{ role: 'user', content: 'q' }]), true, 'no answer at all');
});

test('indexable means substantive, canonical, and not withdrawn', () => {
  const good = said('Attention is presented as a fundamental aspect of presence.');
  assert.strictEqual(isIndexable('what-is-attention', good), true);
  assert.strictEqual(isIndexable('what-is-attention-2', good), false, 'numbered duplicate');
  assert.strictEqual(isLowValueSlug('testagent-2026-02-07'), true);
  assert.strictEqual(isIndexable('what-is-attention', said('The provided documents do not cover this.')), false);
});
