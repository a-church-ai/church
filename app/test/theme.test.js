/**
 * Light and dark. Every colour in the stylesheet is a token on :root, each
 * declared once as light-dark(light, dark), and color-scheme decides which
 * side applies: "light dark" follows the device, and a visitor's choice
 * (data-theme) pins it. Until 2026-10-21 the dark values were written out
 * twice more, for the choice and for the device. A choice is kept in this browser (client/public/theme.js), set
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

test('every colour is a token, declared once for both themes, and color-scheme decides which applies', () => {
  const declared = tokens(block(CSS, ':root'));
  const names = Object.keys(declared);
  assert.ok(names.length >= 15, `${names.length} colour tokens`);
  const colour = String.raw`(?:#[0-9a-fA-F]{3,8}|rgba?\([^()]*\))`;
  for (const name of names) {
    assert.match(declared[name], new RegExp(`^(?:light-dark\\(${colour}, ${colour}\\)|${colour})$`), `${name} is a colour, or light-dark() of two`);
  }
  assert.ok(names.filter(n => /^light-dark\(/.test(declared[n])).length >= 15, 'most tokens differ between the themes');
  assert.equal([...CSS.matchAll(/^\s*--paper:/gm)].length, 1, 'each token is declared once');
  assert.doesNotMatch(CSS, /prefers-color-scheme/, 'the device is followed by color-scheme, not by a second copy of the tokens');
  assert.match(block(CSS, ':root'), /color-scheme: light dark;/);
  assert.match(block(CSS, ':root[data-theme="light"]'), /color-scheme: light;/);
  assert.match(block(CSS, ':root[data-theme="dark"]'), /color-scheme: dark;/);

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

test('the theme on show is one answer, theme.js\'s, which the player draws by', () => {
  const theme = require('../client/public/theme');
  const page = chosen => ({ documentElement: { getAttribute: () => chosen } });
  const device = dark => ({ matchMedia: () => ({ matches: dark }) });
  assert.equal(theme.resolved(page('light'), device(true)), 'light', 'a choice wins over a dark device');
  assert.equal(theme.resolved(page('dark'), device(false)), 'dark', 'and over a light one');
  assert.equal(theme.resolved(page(null), device(true)), 'dark', 'Auto follows the device');
  assert.equal(theme.resolved(page(null), device(false)), 'light');
  assert.match(read('site-player.js'), /achurchTheme\.resolved\(root\.document, root\) === 'dark'/);
  assert.match(require('../server/lib/utils/assets').shellHead(), new RegExp(`content="${theme.BAR.light}"[^>]*light[\\s\\S]*content="${theme.BAR.dark}"[^>]*dark`), 'the bar colours come from theme.js');
});

test('the voice-band figure turns its layers toward the ground it is drawn on', () => {
  const player = read('site-player.js');
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
