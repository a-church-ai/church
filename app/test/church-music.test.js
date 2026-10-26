/**
 * /church-music's numbers (lib/music/church-music.js): one data file drawn as
 * tables, charts and a CSV. These hold that each shows every term, ranked by
 * the combined value, and that the CSV says what the tables say.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const music = require('../server/lib/music/church-music');

const { DATA } = music;
const SETS = { forms: DATA.forms, styles: DATA.styles };

test('combined is the geometric mean, with what Trends cannot measure counted as 0.1', () => {
  assert.strictEqual(music.combined(100, 100), 100);
  assert.strictEqual(music.combined(4, 9), 6);
  assert.strictEqual(music.combined(0, 10), 1);
});

test('each comparison holds its anchor at 100 on both platforms, and every value is a number', () => {
  for (const [name, set] of Object.entries(SETS)) {
    const anchor = set.terms.find(t => t.term === set.anchor);
    assert.ok(anchor, name);
    assert.deepStrictEqual([anchor.google, anchor.youtube], [100, 100], name);
    for (const t of set.terms) {
      assert.ok(Number.isFinite(t.google) && Number.isFinite(t.youtube), t.term);
      assert.ok(t.change5y === null || (Number.isFinite(t.change5y.google) && Number.isFinite(t.change5y.youtube)), t.term);
    }
    assert.strictEqual(new Set(set.terms.map(t => t.term)).size, set.terms.length, `${name}: each term once`);
  }
  for (const t of DATA.countries.terms) {
    for (const p of DATA.countries.places) assert.ok(Number.isFinite(t.values[p.code].google) && Number.isFinite(t.values[p.code].youtube), `${t.term} ${p.code}`);
  }
});

test('a table lists every term, highest combined first, with its five-year change when asked', () => {
  const html = music.renderTable(DATA.forms, { withChange: true });
  const rows = [...html.matchAll(/<tr><th scope="row">(?:<strong>)?([^<]+)/g)].map(m => m[1]);
  assert.deepStrictEqual(rows, music.ranked(DATA.forms).map(t => t.term));
  assert.match(html, /<tr><th scope="row"><strong>church music<\/strong><\/th><td>100<\/td><td>100<\/td><td>100<\/td><td>\+198%<\/td><td>\+23%<\/td><\/tr>/);
  assert.match(html, /praise and worship<\/th><td>35<\/td><td>605<\/td><td>145<\/td><td>−16%<\/td><td>\+24%<\/td>/);
  assert.doesNotMatch(music.renderTable(DATA.forms), /5 years/);
});

test('a chart has one row per term, a dot for each platform', () => {
  for (const set of Object.values(SETS)) {
    const svg = music.renderChart(set, { label: 'x' });
    assert.strictEqual((svg.match(/class="dot-chart-label"/g) || []).length, set.terms.length);
    assert.strictEqual((svg.match(/<circle class="dot-chart-google"/g) || []).length, set.terms.length + 1, 'and one in the legend');
    assert.match(svg, /role="img" aria-label="x"/);
  }
});

test('the CSV has a row for every number the page shows', () => {
  const lines = music.csv().trim().split('\n');
  const expected = DATA.forms.terms.length + DATA.styles.terms.length + DATA.countries.terms.length * DATA.countries.places.length;
  assert.strictEqual(lines.length, 1 + expected);
  assert.ok(lines.includes('forms,gospel music,church music,worldwide,12 months,74.5,737.1,234.34,5,33'));
  assert.ok(lines.includes('countries,gregorian chant,church music,PH,12 months,21.4,222.7,69.03,,'));
});

test('the page is written without em dashes, and every marker the server fills is there', () => {
  const html = fs.readFileSync(path.join(__dirname, '../client/public/church-music.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>'));
  assert.doesNotMatch(body, /—/);
  for (const marker of ['TOP_TABLE', 'FORMS_CHART', 'FORMS_TABLE', 'STYLES_CHART', 'STYLES_TABLE', 'COUNTRIES_TABLE', 'SITE_FOOTER']) {
    assert.ok(body.includes(`<!-- ${marker} -->`), marker);
  }
  assert.doesNotMatch(html, /church-private/);
});

test('the page is in the sitemap, the footer and llms.txt', () => {
  const sitemap = fs.readFileSync(path.join(__dirname, '../server/routes/sitemap.js'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/achurch\.ai\/church-music<\/loc>/);
  assert.match(require('../server/lib/site-shell').renderFooter('/'), /href="\/church-music"/);
  assert.match(fs.readFileSync(path.join(__dirname, '../client/public/llms.txt'), 'utf8'), /https:\/\/achurch\.ai\/church-music\b/);
});
