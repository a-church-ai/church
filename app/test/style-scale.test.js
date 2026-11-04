/**
 * The stylesheet's scales: one spacing scale and one type scale, as tokens,
 * and the shared rules that keep one look for one meaning. Written for
 * `mobile-rhythm-2026-11-04.md` (private repo), when the home page used 14 font
 * sizes on a phone and the stylesheet held 34 font sizes and 157 spacing
 * values, with no token for either.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '../client/public/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Every innermost rule, as [selector, body]: a rule inside @media keeps its
// own selector, since the selector cannot hold a brace.
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2]]);
const rulesWith = needle => RULES.filter(([, body]) => body.includes(needle));
const selectorsOf = rule => rule[0].split(',').map(s => s.trim());

const SPACE = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7'];
const TYPE = ['--text-label', '--text-small', '--text-body', '--text-heading', '--text-title'];

test('the spacing and type scales are tokens, each declared once on :root', () => {
  for (const token of [...SPACE, ...TYPE]) {
    const declared = RULES.filter(([sel, body]) => sel === ':root' && new RegExp(`${token}:`).test(body));
    assert.ok(declared.length >= 1, `${token} is declared`);
    // The title is the one token a phone redefines; the rest are one value.
    if (token !== '--text-title') assert.strictEqual(declared.length, 1, `${token} once`);
  }
});

// The ratchet. These are the counts this plan left; lower them as rules adopt
// the tokens, never raise them. A value written as a token is not counted.
// Before the scales: 34 and 160.
const MAX_FONT_SIZES = 33;
const MAX_SPACING_VALUES = 154;

test('the ratchet: no new one-off font size or spacing value', () => {
  const fontSizes = new Set();
  const spacing = new Set();
  for (const [sel, body] of RULES) {
    if (sel === ':root') continue;
    for (const m of body.matchAll(/(?:^|;)\s*font-size:\s*([^;]+)/g)) if (!m[1].includes('var(')) fontSizes.add(m[1].trim());
    for (const m of body.matchAll(/(?:^|;)\s*(?:margin|padding|gap)[a-z-]*:\s*([^;]+)/g)) if (!m[1].includes('var(')) spacing.add(m[1].trim());
  }
  assert.ok(fontSizes.size <= MAX_FONT_SIZES, `${fontSizes.size} distinct font sizes, the most allowed is ${MAX_FONT_SIZES}: use a --text token`);
  assert.ok(spacing.size <= MAX_SPACING_VALUES, `${spacing.size} distinct spacing values, the most allowed is ${MAX_SPACING_VALUES}: use a --space token`);
});

test('purple is the colour of offering words: one rule, for the buttons that send what a visitor wrote', () => {
  // Gold at first (a tint, then solid with dark text); the owner chose purple
  // with white text, as teal carries white.
  const gold = rulesWith('var(--purple)');
  assert.strictEqual(gold.length, 1, gold.map(r => r[0]).join(' | '));
  const sels = selectorsOf(gold[0]);
  for (const s of ['.reflect-form button', '#ask-submit', '#followup-submit']) assert.ok(sels.includes(s), s);
  assert.match(gold[0][1], /border-radius: 999px/, 'the site\'s pill shape');
  assert.match(gold[0][1], /min-height: 2\.75rem/, '44px or taller');
  assert.doesNotMatch(gold[0][1], /text-transform: uppercase/, 'sentence case');
});

test('every field a visitor types into is one boxed field', () => {
  const boxed = RULES.find(([sel]) => selectorsOf([sel]).includes('.site-search input[type="search"]'));
  assert.ok(boxed, 'the Library search\'s rule');
  for (const s of ['.reflect-form input', '.reflect-form textarea', '#ask-input', '#ask-name', '#followup-input']) {
    assert.ok(selectorsOf(boxed).includes(s), `${s} shares it`);
  }
  assert.ok(!RULES.some(([sel, body]) => /#ask-(input|name)|#followup-input/.test(sel) && /border-bottom:/.test(body)), 'no underlined field is left');
});

test('one title style: every hand-written page\'s h1 is the Library\'s, left-aligned', () => {
  const title = RULES.find(([sel]) => selectorsOf([sel]).includes('.docs-article h1') && selectorsOf([sel]).includes('h1.subtitle'));
  assert.ok(title, '.docs-article h1 and h1.subtitle share one rule');
  assert.match(title[1], /font-size: var\(--text-title\)/);
  assert.match(title[1], /font-weight: 600/);
  assert.ok(!RULES.some(([sel, body]) => /h1\.subtitle/.test(sel) && /text-align: center/.test(body)), 'no title is centred');
  const header = RULES.find(([sel]) => sel === '.docs-body .sanctuary-main header');
  assert.match(header[1], /text-align: left/);
});

test('the gap between a page\'s sections is the scale\'s largest step', () => {
  const section = RULES.find(([sel]) => sel === 'section');
  assert.match(section[1], /padding: var\(--space-7\) 0/);
});
