/**
 * /search: the Library and the conversations, searched together in the
 * browser by site-search.js, so nothing typed leaves the page. The top bar's
 * icon opens it, and the field takes the cursor, on a full load and when the
 * page arrives in place. Written to fail against the site as of 2026-10-07,
 * which had a search box on /docs and one on /conversations, and no page for
 * both.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderSearchBox } = require('../server/lib/utils/page-lists');

const PUBLIC = path.join(__dirname, '../client/public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');

test('the page searches both indexes, is not itself indexed, and is not in the sitemap', () => {
  const page = read('search.html');
  assert.ok(page.includes('<!-- SEARCH_BOX -->'));
  assert.match(page, /<meta name="robots" content="noindex, follow">/);
  assert.match(page, /<script src="\/site-search\.js" defer><\/script>/);
  assert.match(INDEX, /app\.get\('\/search'/);
  assert.match(INDEX, /renderSearchBox\(\{ index: '\/docs\/index\.json \/conversations\/index\.json'[^)]*autofocus: true/);
  assert.doesNotMatch(INDEX, /<loc>https:\/\/achurch\.ai\/search<\/loc>/);
});

test('a search box can read several indexes, and can take the cursor', () => {
  const box = renderSearchBox({ index: '/a.json /b.json', label: 'Search', noun: 'entries', autofocus: true });
  assert.match(box, /data-index="\/a\.json \/b\.json"/);
  assert.match(box, /<input type="search" id="site-search-input"[^>]* autofocus>/);
  assert.doesNotMatch(renderSearchBox({ index: '/a.json', label: 'Search', noun: 'entries' }), /autofocus/);
  const { indexesOf } = require('../client/public/site-search');
  assert.deepStrictEqual(indexesOf('/docs/index.json  /conversations/index.json'), ['/docs/index.json', '/conversations/index.json']);
  assert.deepStrictEqual(indexesOf('/docs/index.json'), ['/docs/index.json']);
});

test('a conversation in mixed results says what it is', () => {
  assert.match(INDEX, /label: c\.timestamp \? `Asked \$\{c\.timestamp\.slice\(0, 10\)\}` : 'Asked'/);
});

test('a page that names its first focus gets it when it arrives in place, as on a full load', () => {
  const nav = read('site-nav.js');
  assert.match(nav, /document\.querySelector\('\[autofocus\]'\) \|\| document\.querySelector\('#content h1, main h1, h1'\)/);
});
