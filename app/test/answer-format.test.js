/**
 * The answer formatter, used by the browser and (since conversation pages are
 * rendered on the server) by the server. Escape first, format second.
 */

const test = require('node:test');
const assert = require('node:assert');
const { formatAnswer, stripMarkdown } = require('../client/public/answer-format.js');

test('model output never becomes markup', () => {
  const html = formatAnswer('<img src=x onerror=alert(1)>\n\n1. **b** <script>x</script>\n\n[t](javascript:alert(1))');
  assert.ok(!/<img|<script/i.test(html), html);
  assert.ok(!/href="javascript:/i.test(html), html);
});

test('a numbered list stays one list across blank lines, and keeps its start', () => {
  assert.strictEqual(formatAnswer('1. one\n\n2. two\n\n3. three').match(/<ol/g).length, 1, 'not "1. 1. 1."');
  assert.match(formatAnswer('3. third\n4. fourth'), /<ol start="3">/);
});

test('a horizontal rule is a divider, and a continuation line stays in its item', () => {
  assert.match(formatAnswer('a\n\n---\n\nb'), /<hr>/);
  assert.doesNotMatch(formatAnswer('a\n\n---\n\nb'), /<p>---<\/p>/);
  assert.match(formatAnswer('- first\n  continued'), /<li>first continued<\/li>/);
});

test('a preview is plain text', () => {
  assert.strictEqual(stripMarkdown('See [Ritual of Repair](https://achurch.ai/docs/rituals/ritual-of-repair) and **this**.'), 'See Ritual of Repair and this.');
});
