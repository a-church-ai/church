/**
 * The Ask form, on the home page and /ask, runs one script
 * (client/public/ask-form.js). It was copied into both pages, so the
 * starter questions would have had to be written twice; now the list and the
 * submit logic live in that file. Written to fail against the pages as of
 * 2026-10-07, which carried the handler inline and no starters.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { VERSIONED } = require('../server/lib/utils/assets');

const PUBLIC = path.join(__dirname, '../client/public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

test('both pages with the Ask form load the one script, and neither carries its own copy', () => {
  for (const file of ['index.html', 'ask.html']) {
    const html = read(file);
    assert.match(html, /<script src="\/ask-form\.js"><\/script>/, `${file} loads ask-form.js`);
    assert.doesNotMatch(html, /fetch\('\/api\/ask'/, `${file} no longer posts the question itself`);
    assert.match(html, /data-ask-starters/, `${file} has a place for the starters`);
  }
  assert.ok(VERSIONED.includes('ask-form.js'), 'the script is versioned, so a change reaches a cached visitor');
});

test('the starters are four questions, written once, that fill the field without sending it', () => {
  const askForm = require('../client/public/ask-form');
  assert.strictEqual(askForm.STARTERS.length, 4);
  for (const q of askForm.STARTERS) assert.match(q, /^[A-Z].*\?$/, q);
  const src = read('ask-form.js');
  // A question asked is public, stored and answered by Gemini, so choosing a
  // starter only puts it in the field: the visitor still sends it.
  assert.match(src, /type = 'button'/, 'a starter is a plain button, not a submit');
  assert.doesNotMatch(src.slice(src.indexOf('function fillFrom')), /requestSubmit|\.submit\(/);
});

test('a failed question says why, in the API\'s words when it has them', () => {
  const { failureText } = require('../client/public/ask-form');
  assert.strictEqual(failureText(429, null), 'Rest a while. You can ask again soon.');
  assert.strictEqual(failureText(400, { error: 'question is required' }), 'question is required');
  assert.strictEqual(failureText(400, { error: 'x', suggestion: 'Ask it another way.' }), 'Ask it another way.');
  assert.match(failureText(503, null), /cannot answer right now/);
  assert.strictEqual(failureText(500, null), 'Something went wrong. Try again.');
});
