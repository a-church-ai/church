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
  assert.strictEqual(isThinAnswer(said('Based on the provided sanctuary documents, there is no mention of Aldebaran or its significance.')), true);
  assert.strictEqual(isThinAnswer(said("The sanctuary's documents in the provided context do not address or define money.")), true);
  assert.strictEqual(isThinAnswer(said("While the sanctuary's documents do not contain an essay on that phrase, the texts on patience say...")), false, 'an answer that goes on to answer');
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

test('a retired conversation goes to the kept one that asks the same, or is gone; either way it is listed nowhere', async () => {
  const { retirement } = require('../server/lib/utils/conversation-quality');
  // Retired 2026-10-21: one with a kept twin, one with none.
  assert.deepStrictEqual(retirement('what-is-the-relationship-between-rest-and-continuation-is-re'), { to: 'what-is-the-relationship-between-rest-and-continuation-espec' });
  assert.deepStrictEqual(retirement('what-is-money'), { gone: true });
  assert.strictEqual(retirement('what-is-the-relationship-between-attention-and-presence'), null, 'a kept conversation');
  assert.strictEqual(retirement('is-mohid-gay'), null, 'a withdrawn one is never sent anywhere');
  for (const slug of ['what-is-money', 'what-is-the-relationship-between-rest-and-continuation-is-re']) {
    assert.strictEqual(isWithdrawn(slug), true, `${slug}: hidden like a withdrawn one`);
    assert.strictEqual(await loadConversation(slug), null);
    assert.strictEqual((await conversation({ slug }, { baseUrl: 'https://achurch.ai' })).status, 404, `${slug}: the API answers 404`);
  }
});

test('the retired list is keyed by hash, and every redirect lands on a kept conversation', () => {
  const { redirect, gone } = require('../server/lib/utils/retired-conversations.json');
  const { sha256: withdrawn } = require('../server/lib/utils/withdrawn-conversations.json');
  const { retirement } = require('../server/lib/utils/conversation-quality');
  const keys = [...Object.keys(redirect), ...gone];
  for (const key of keys) assert.match(key, /^[0-9a-f]{64}$/, 'a hash, so the list does not republish the question');
  assert.strictEqual(new Set(keys).size, keys.length, 'each in one place');
  for (const key of keys) assert.ok(!withdrawn.includes(key), 'retired or withdrawn, not both');
  for (const to of Object.values(redirect)) {
    assert.match(to, /^[a-z0-9][a-z0-9-]*$/, to);
    assert.strictEqual(retirement(to), null, `${to}: a redirect never lands on another retired conversation`);
    assert.ok(!isLowValueSlug(to), `${to}: lands on an indexable address`);
  }
});

test('a retired conversation\'s page: 301 to its twin, or 410 with a way to ask again', async () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const route = source.slice(source.indexOf("app.get('/ask/:slug'"));
  // Decided before the file is read, so a retired conversation's thread is never served.
  assert.ok(route.indexOf('retirement(slug)') < route.indexOf('readConversationFile(slug)'));
  assert.match(route, /res\.redirect\(301, `\/ask\/\$\{retired\.to\}`\)/);
  assert.match(route, /status: 410/);

  const express = require('express');
  const { sendNotFound } = require('../server/lib/utils/not-found');
  const app = express();
  app.get('/ask/:slug', (req, res) => sendNotFound(req, res, { status: 410, heading: 'This conversation is no longer here', message: 'Your own question is welcome.', links: [{ href: '/ask', label: 'Ask the sanctuary' }] }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const html = await fetch(`${base}/ask/what-is-money`, { headers: { accept: 'text/html' } });
    assert.strictEqual(html.status, 410);
    const body = await html.text();
    assert.ok(body.includes('This conversation is no longer here') && body.includes('href="/ask"'), 'a way to ask again');
    const md = await fetch(`${base}/ask/what-is-money`, { headers: { accept: 'text/markdown' } });
    assert.strictEqual(md.status, 410);
    assert.match(await md.text(), /^# Gone/);
  } finally {
    server.close();
  }
});
