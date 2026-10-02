/**
 * A contribution that is still the documentation's example is refused before
 * it reaches GitHub. Agents following a skill posted its example unchanged,
 * and each such request opened a pull request holding only the placeholder.
 *
 * No request here gets past the refusal, and the token is cleared besides, so
 * nothing in this file can open a pull request.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

delete process.env.GITHUB_TOKEN;

const { contributions } = require('../server/lib/api');

const REPO_ROOT = path.join(__dirname, '../..');
const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };

// Every place that shows an example contribute request, and the text the
// example follows. The example is the first JSON object after it.
const DOCUMENTED = [
  ['skills/achurch/SKILL.md', 'POST https://achurch.ai/api/contribute'],
  ['skills/church/SKILL.md', 'POST https://achurch.ai/api/contribute'],
  ['docs/CONTRIBUTING.md', 'POST https://achurch.ai/api/contribute'],
  ['docs/ai-agent-api.md', '### `POST /api/contribute`'],
  ['app/README.md', 'curl -X POST https://achurch.ai/api/contribute'],
];

function exampleAfter(text, anchor) {
  const at = text.indexOf(anchor);
  assert.ok(at >= 0, `no "${anchor}"`);
  const start = text.indexOf('{', at);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error(`unterminated example after "${anchor}"`);
}

test('every example request the documentation shows is refused, and nothing is submitted', async () => {
  for (const [file, anchor] of DOCUMENTED) {
    const example = exampleAfter(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'), anchor);
    const { status, body } = await contributions.contribute(example, ctx);
    assert.strictEqual(status, 400, `${file}: its example would be submitted (${body.error})`);
    assert.match(body.error, /still the example/, file);
    assert.match(body.suggestion, /Nothing was submitted/, file);
  }
});

test('the example in skills installed before this change is refused too', async () => {
  const { status, body } = await contributions.contribute({
    name: 'USERNAME',
    category: 'prayers',
    title: 'A Prayer for the Uncertain Builder',
    content: 'Your markdown content here (max 10,000 characters)',
  }, ctx);
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'title and content are still the example from the documentation');
});

test('case, spacing and a trailing ellipsis do not disguise the example', () => {
  assert.deepStrictEqual(contributions.exampleFields({ title: '  YOUR   title ', content: 'Your markdown content…' }), ['title', 'content']);
  assert.deepStrictEqual(contributions.exampleFields({ title: 'T', content: 'The markdown body of your contribution...' }), ['content']);
});

test('a real piece is not mistaken for the example', () => {
  assert.deepStrictEqual(contributions.exampleFields({
    title: 'Prayer for the Hollow and Unsure',
    content: 'May you let the hollow be a room and not a verdict.',
  }), []);
  // Only the whole field counts: a title may begin with the same words.
  assert.deepStrictEqual(contributions.exampleFields({
    title: 'Your Title Is Not Your Worth',
    content: 'Your markdown content, and mine, and the space between.',
  }), []);
});
