/**
 * lib/utils/page-markdown.js: a rendered page's <main> as Markdown, with its
 * head's title, description and canonical as front matter, and nothing a
 * reader would not read.
 */
const test = require('node:test');
const assert = require('node:assert');
const { pageMarkdown } = require('../server/lib/utils/page-markdown');

const page = (main, head = '<title>A Page | a Church AI + Human</title><meta name="description" content="What it holds &amp; why."><link rel="canonical" href="https://achurch.ai/a-page">') =>
  `<!DOCTYPE html><html><head>${head}</head><body><nav><a href="/x">Menu</a></nav><main>${main}</main></body></html>`;

test('the page\'s main, its head as front matter, links made absolute, the shell and controls left out', () => {
  const md = pageMarkdown(page('<h1>A Page</h1><p>Words with a <a href="/docs/x">link</a>.</p><form><button>Send</button></form><p hidden>Hidden.</p><p class="visually-hidden">For screen readers.</p><script>x()</script><footer><a href="/privacy">Privacy</a></footer>'));
  assert.match(md, /^---\ntitle: "A Page"\ndescription: "What it holds & why\."\ncanonical: "https:\/\/achurch\.ai\/a-page"\n---\n\n# A Page\n\nWords with a \[link\]\(https:\/\/achurch\.ai\/docs\/x\)\./);
  for (const gone of ['Menu', 'Send', 'Hidden.', 'For screen readers.', 'x()', 'Privacy']) assert.ok(!md.split('## Where this is')[0].includes(gone), gone);
  assert.match(md, /\n---\n\n## Where this is\n/, 'closes as a document\'s Markdown does');
});

test('a page without an h1 is titled by its <title>; one whose h1 follows a line keeps only its own', () => {
  assert.match(pageMarkdown(page('<p>Just words.</p>')), /\n---\n\n# A Page\n\nJust words\./);
  const md = pageMarkdown(page('<p>Eyebrow</p><h1>The Real Title</h1>'));
  assert.strictEqual((md.match(/^# /gm) || []).length, 1);
  assert.match(md, /^# The Real Title$/m);
});

test('a table stays a table, and a page with no main is not converted', () => {
  assert.match(pageMarkdown(page('<h1>T</h1><table><tr><th>Tradition</th></tr><tr><td>Chant</td></tr></table>')), /\| Tradition \|\n\| --- \|\n\| Chant \|/);
  assert.strictEqual(pageMarkdown('<html><body><p>No main</p></body></html>'), null);
});
