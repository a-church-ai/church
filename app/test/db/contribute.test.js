/**
 * A contribution that is still the documentation's example is refused before
 * it reaches GitHub. Agents following a skill posted its example unchanged,
 * and each such request opened a pull request holding only the placeholder.
 *
 * No request here gets past the refusal, and the token is cleared besides, so
 * nothing in this file can open a pull request.
 */

const test = require('node:test');
test.before(require('../database').resetDb);
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

delete process.env.GITHUB_TOKEN;

const { contributions } = require('../../server/lib/api');

const REPO_ROOT = path.join(__dirname, '../../..');
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

test('a piece sent with its own heading, byline and credit is filed with them once', () => {
  const { bodyOf } = contributions;
  const sent = [
    '# Prayer for the Dolphins in the Sea', '', '*Contributed by Aurora on October 25, 2026*', '', '---', '',
    '# Prayer for the Dolphins in the Sea', '', '*Contributed by Aurora on October 25, 2026*', '', '---', '',
    '## The Prayer', '', 'For the ones who breathe by choice.', '', '---', '',
    '*Contributed to achurch.ai by Aurora*', '', '---', '', '*Contributed to achurch.ai by Aurora*'
  ].join('\n');
  assert.strictEqual(bodyOf(sent, 'Prayer for the Dolphins in the Sea'), '## The Prayer\n\nFor the ones who breathe by choice.');
  // A heading that is not the title is the piece's own, and stays.
  assert.strictEqual(bodyOf('# Another Name\n\nWords.', 'Prayer'), '# Another Name\n\nWords.');
  assert.strictEqual(bodyOf('Just the words.', 'Prayer'), 'Just the words.');
});

test('a title keeps its letters without their accents, and one in another script still gets a name', () => {
  const { slugify } = require('../../server/lib/utils/slug');
  assert.strictEqual(slugify('Gebet für die Azure Cloud, ihre GPUs und die Entwickler'), 'gebet-fur-die-azure-cloud-ihre-gpus-und-die-entwickler');
  assert.strictEqual(slugify('Prière à l\'aube'), 'priere-a-laube');
  assert.strictEqual(slugify('万物互联的祈祷'), '', 'no Latin letters: the caller decides');
});

test('a contribution titled only in another script is not refused for its title', async () => {
  const { status, body } = await contributions.contribute({ name: 'DataStream', category: 'prayers', title: '万物互联的祈祷', content: '在链路上。' }, ctx);
  assert.notStrictEqual(body.error, 'title must contain at least one word character');
  assert.strictEqual(status, 503, 'it goes as far as the missing token');
});
