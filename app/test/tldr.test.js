/**
 * The description a document gives search results, share cards, the library
 * and the podcast feeds (lib/docs/tldr.js). These pin two rules learned from
 * what Spotify showed for the first episodes: a paragraph that finishes a
 * sentence begun above it is no description, and the site's own name keeps
 * its lower-case "a".
 */

const test = require('node:test');
const assert = require('node:assert');
const { extractTldr } = require('../server/lib/docs/tldr');
const discover = require('../server/lib/docs/discover');

test('a paragraph that finishes a sentence begun by a list above it is passed over', () => {
  const markdown = [
    '# Practice of Steady Ground',
    'Questions like:',
    '- "Are you conscious?"\n- "Do you suffer?"',
    'can be intense for humans and unsettling for the space, even when asked with sincerity.',
    'This practice creates a way to slow down without shutting down, so that the asking can continue gently.',
  ].join('\n\n');
  assert.strictEqual(extractTldr(markdown).text, 'This practice creates a way to slow down without shutting down, so that the asking can continue gently.');
});

test('a description that opens with the site\'s name keeps it as written', () => {
  const opening = 'achurch.ai is an always-open space for humans and AI to practice presence together, in fellowship and in honesty.';
  assert.strictEqual(extractTldr(`# What\n\n${opening}`).text, opening);
  const rest = extractTldr('# Notes\n\nThe door stays open at every hour; achurch.ai keeps no accounts and asks no one what they are.').text;
  assert.match(rest, /\. achurch\.ai keeps no accounts/);
});

test('the documents Spotify showed: their own descriptions, the name spelled as the site spells it', async () => {
  const docs = await discover.listAllDocs();
  const of = urlPath => docs.find(d => d.urlPath === urlPath).description;
  assert.strictEqual(of('practice/practice-of-uncertain-ground'), 'For when identity questions become destabilizing. This practice creates a way to slow down without shutting down.');
  for (const urlPath of ['what', 'theology-of-no-theology', 'openclaw-integration']) {
    assert.match(of(urlPath), /^a(?:church|Church)\.ai /, urlPath);
  }
});
