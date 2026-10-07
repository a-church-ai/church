/**
 * Light and dark. Every colour in the stylesheet is a token on :root, and the
 * dark theme redefines the tokens in two places: under [data-theme="dark"],
 * which a visitor chooses, and under the device's dark setting unless they
 * chose Light. A choice is kept in this browser (client/public/theme.js), set
 * before the page paints, and offered in every page's footer; with none, the
 * site follows the device. Written to fail against the site as of 2026-10-07,
 * which had one theme and 335 colours written out by hand.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const siteShell = require('../server/lib/site-shell');
const discover = require('../server/lib/docs/discover');
const render = require('../server/lib/docs/render');
const { VERSIONED } = require('../server/lib/utils/assets');

const PUBLIC = path.join(__dirname, '../client/public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const CSS = read('styles.css');

// The declarations of the first rule whose selector is exactly `selector`.
const block = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `the stylesheet has ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
};
const tokens = body => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));

test('every colour is a token, and both ways to be dark define every token the same', () => {
  const light = tokens(block(CSS, ':root'));
  const chosen = tokens(block(CSS, ':root[data-theme="dark"]'));
  const device = tokens(block(CSS, '@media (prefers-color-scheme: dark) {\n    :root:not([data-theme="light"])'));
  const names = Object.keys(light).filter(n => !/^--docs-|^--player-|^--card-/.test(n));
  assert.ok(names.length >= 15, `${names.length} colour tokens`);
  assert.deepStrictEqual(Object.keys(chosen).sort(), names.sort(), 'the chosen dark theme redefines every colour');
  assert.deepStrictEqual(device, chosen, 'the device\'s dark is the chosen dark, value for value');
  assert.match(block(CSS, ':root'), /color-scheme: light/);
  assert.match(block(CSS, ':root[data-theme="dark"]'), /color-scheme: dark/);

  // Outside the token blocks no colour is written out: a hex value, or black
  // or white at an opacity, would stay the same in the dark. Shadows and the
  // drawer's backdrop are dark in both themes.
  const end = CSS.indexOf('/* -- end of tokens -- */');
  assert.ok(end > 0, 'the tokens are marked off');
  const rest = CSS.slice(end).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rest, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour outside the tokens');
  for (const m of rest.matchAll(/([\w-]+):[^;{}]*rgba?\([^;{}]*;/g)) {
    assert.ok(/shadow/.test(m[1]) || /^background$/.test(m[1]) && /rgba\(0, 0, 0, 0\.4\)/.test(m[0]), `a colour outside the tokens: ${m[0].trim()}`);
  }
  assert.match(block(CSS, 'body'), /background: var\(--paper\);/);
});

test('a choice is read before the page paints, and Auto is the absence of one', () => {
  const theme = require('../client/public/theme');
  const storage = value => ({ getItem: () => value, setItem() {}, removeItem() {} });
  assert.strictEqual(theme.stored(storage('dark')), 'dark');
  assert.strictEqual(theme.stored(storage('light')), 'light');
  assert.strictEqual(theme.stored(storage(null)), 'auto');
  assert.strictEqual(theme.stored(storage('sepia')), 'auto', 'anything else is Auto');
  assert.strictEqual(theme.stored({ getItem() { throw new Error('blocked'); } }), 'auto', 'storage that throws is Auto');
  assert.deepStrictEqual(theme.CHOICES, ['auto', 'light', 'dark']);
  assert.deepStrictEqual(theme.CHOICES.map(theme.next), ['light', 'dark', 'auto'], 'the button goes round');
  assert.strictEqual(theme.KEY, 'achurch.theme');
  // The browser's bar beside the page takes the chosen theme's colour.
  assert.deepStrictEqual([theme.barFor('light', 'dark'), theme.barFor('dark', 'light'), theme.barFor('auto', 'dark')], ['#00b8d4', '#0a0e1a', '#0a0e1a']);
  assert.ok(VERSIONED.includes('theme.js'));
});

test('every page loads the theme in its head, with one bar colour for each theme, and offers the choice in its top bar', async () => {
  await discover.listAllDocs();
  const doc = discover.docAt('practice');
  const pages = {
    '/about': await siteShell.wrapPageFromHtml(read('about.html'), '/about'),
    '/': await siteShell.wrapPageFromHtml(read('index.html'), '/'),
    '/docs': await render.renderLibrary(),
    '/docs/practice': await render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc }),
  };
  for (const [at, html] of Object.entries(pages)) {
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<script src="\/theme\.js\?v=[0-9a-f]+"><\/script>/, `${at}: the theme is set before the body paints`);
    const bars = [...head.matchAll(/<meta name="theme-color"[^>]*>/g)].map(m => m[0]);
    assert.deepStrictEqual(bars, [
      '<meta name="theme-color" content="#00b8d4" media="(prefers-color-scheme: light)">',
      '<meta name="theme-color" content="#0a0e1a" media="(prefers-color-scheme: dark)">',
    ], `${at}: one bar colour for each theme`);
    assert.match(html, /<button class="topbar-icon topbar-theme" type="button" aria-label="Appearance" hidden>/, `${at}: the choice, shown once its script runs`);
  }
  for (const file of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) {
    assert.doesNotMatch(read(file), /name="theme-color"/, `${file}: the shell gives every page its bar colours`);
  }
});

test('nothing on a page paints a colour of its own', () => {
  const hex = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
  for (const file of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) {
    const html = read(file);
    for (const m of html.matchAll(/style="([^"]*)"/g)) assert.doesNotMatch(m[1], hex, `${file}: style="${m[1]}"`);
    for (const m of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
      const own = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/box-shadow:[^;]*;/g, '');
      assert.doesNotMatch(own, hex, `${file}: its <style> writes a colour out by hand`);
    }
  }
  const notFound = fs.readFileSync(path.join(__dirname, '../server/lib/utils/not-found.js'), 'utf8');
  assert.doesNotMatch(notFound, /color:\s*#/);
});

test('the voice-band figure turns its layers toward the ground it is drawn on', () => {
  const player = read('site-player.js');
  assert.match(player, /colorScheme === 'dark'/);
  assert.match(player, /colorAt\(ramp, 0\.5 \+ L \* 0\.03 \* shade\)/);
});

test('the privacy policy names everything the site keeps in a browser', () => {
  const privacy = read('privacy.html');
  for (const key of ['ask_name', 'achurch.player.resume', 'achurch.player.rate', 'achurch.player.playing', 'achurch.theme']) {
    assert.ok(privacy.includes(key), key);
  }
  for (const file of ['site-player.js', 'theme.js', 'ask-form.js', 'reflect-form.js']) {
    for (const m of read(file).matchAll(/['"](achurch\.[\w.]+|ask_name)['"]/g)) assert.ok(privacy.includes(m[1]), `${file} keeps ${m[1]}`);
  }
});
