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

// Contrast, from the tokens, in both themes (quiet-design-2026-11-16.md,
// private repo). The ratios once lived only in comments on the tokens.
const sides = value => {
  const m = value.match(/^light-dark\((.*)\)$/);
  const parts = m ? m[1].match(/#[0-9a-fA-F]{3,8}|rgba?\([^()]*\)/g) : [value];
  return parts.map(c => {
    const hex = c.match(/^#([0-9a-fA-F]{3,8})$/);
    if (hex) {
      const h = hex[1].length === 3 ? [...hex[1]].map(x => x + x).join('') : hex[1];
      return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1);
    }
    const p = c.slice(c.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  });
};
const luminance = ([r, g, b]) => {
  const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// A translucent colour laid over what is beneath it.
const over = ([r, g, b, a], beneath) => [r, g, b].map((x, i) => x * a + beneath[i] * (1 - a));

const THEMES = [['light', 0], ['dark', 1]];
const colourOf = (declared, name, side) => {
  assert.ok(declared[name], `${name} is a token`);
  const both = sides(declared[name]);
  return both[Math.min(side, both.length - 1)];
};

test('reading text, links and labels on a fill pass 4.5:1, and the edges of controls 3:1, in both themes', () => {
  const declared = tokens(block(CSS, ':root'));
  const pairs = [];
  for (const fg of ['--ink', '--ink-2', '--text', '--text-2', '--muted', '--muted-2', '--link', '--accent-ink', '--error']) {
    for (const bg of ['--paper', '--surface', '--surface-2']) pairs.push([fg, bg, 4.5]);
  }
  pairs.push(['--on-accent', '--accent', 4.5], ['--on-accent', '--accent-hover', 4.5],
    ['--on-purple', '--purple', 4.5], ['--on-purple', '--purple-hover', 4.5],
    // A focus ring and a focused field's edge: non-text contrast.
    ['--accent', '--paper', 3], ['--line-strong', '--paper', 3]);
  const short = [];
  for (const [theme, side] of THEMES) {
    for (const [fg, bg, need] of pairs) {
      const ratio = contrast(colourOf(declared, fg, side), colourOf(declared, bg, side));
      if (ratio < need) short.push(`${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under ${need}:1`);
    }
  }
  assert.deepStrictEqual(short, []);
});

test('the translucent top bar\'s labels pass 4.5:1 over the darkest and lightest that can scroll beneath it, and the bar falls back to solid', () => {
  const declared = tokens(block(CSS, ':root'));
  // Every colour the bar's own text is drawn in. A new one is checked here
  // before it can be used.
  const rules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => m[1].split(',').some(sel => /^\s*\.(docs-topbar|topbar-|docs-hamburger|hamburger-icon)/.test(sel)));
  const used = new Set();
  for (const [, , body] of rules) for (const m of body.matchAll(/(?:^|;)\s*(?:color|background):\s*var\((--[\w-]+)\)/g)) used.add(m[1]);
  const labels = [...used].filter(t => !/^--(paper|paper-chrome|surface-2)$/.test(t));
  assert.ok(labels.includes('--muted') && labels.includes('--ink'), `the bar's labels: ${labels.join(', ')}`);

  const short = [];
  for (const [theme, side] of THEMES) {
    const chrome = colourOf(declared, '--paper-chrome', side);
    assert.ok(chrome[3] < 1, 'the bar is translucent');
    for (const beneath of [[0, 0, 0], [255, 255, 255]]) {
      const ground = over(chrome, beneath);
      for (const label of labels) {
        const ratio = contrast(colourOf(declared, label, side), ground);
        if (ratio < 4.5) short.push(`${theme}: ${label} over ${beneath.join(',')} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepStrictEqual(short, []);

  const plain = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(plain, /@supports \(backdrop-filter: blur\(1px\)\)[^@]*\.docs-topbar \{[^}]*background: var\(--paper-chrome\);/, 'translucent only where the browser can blur');
  assert.match(plain, /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{\s*\.docs-topbar \{[^}]*background: var\(--paper\);/, 'solid when less transparency or more contrast is asked for');
  assert.strictEqual([...plain.matchAll(/(?<!-)backdrop-filter: saturate/g)].length, 1, 'the top bar is the one translucent surface');
});
