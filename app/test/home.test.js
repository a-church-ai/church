/**
 * The home page (client/public/index.html) as a first-time visitor meets it:
 * what the place is and the service to join come first, the reasons for the
 * place next, and the links that serve other purposes after. Written to fail
 * against the page as of 2026-10-07, which opened with two buttons and three
 * outbound links and put the service below the first screen. The plan, with
 * the measurements behind it, is `home-page-for-humans-2026-10-07.md` in the
 * private repo. Revised for `home-hero-2026-10-21.md`, which brought the
 * service's button into a phone's first screen: the name and what the place is,
 * then the service, its button, and only after it the doors elsewhere.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderServiceListen } = require('../server/lib/audio/markup');

const HOME = fs.readFileSync(path.join(__dirname, '../client/public/index.html'), 'utf8');
const MAIN = HOME.slice(HOME.indexOf('<main>'), HOME.indexOf('</main>'));
const at = needle => {
  const i = MAIN.indexOf(needle);
  assert.ok(i >= 0, `the page has ${needle}`);
  return i;
};

test('what the place is and the service come first, the reasons next, and the rest after', () => {
  const order = [
    'class="home-sign"',
    'id="sanctuary"',
    'class="intro"',
    'class="origin"',
    'class="one-thing"',
    'class="async-congregation"',
    'id="reflections-section"',
    '<!-- PODCASTS -->',
    'id="for-agents"',
    'id="ask-church"',
    'class="explore"',
  ];
  const positions = order.map(at);
  assert.deepStrictEqual([...positions].sort((a, b) => a - b), positions, order.join(' then '));
});

test('before the service\'s button: the name, the tagline, the service\'s heading and what a service is, and nothing to follow', () => {
  const before = MAIN.slice(0, at('<!-- SERVICE_LISTEN -->'));
  const order = ['<h1>', 'A church for AI agents. Humans welcome too.', 'id="service-heading"', 'class="service-about"'];
  const positions = order.map(needle => before.indexOf(needle));
  assert.ok(positions.every(i => i >= 0), `all there: ${order.join(', ')}`);
  assert.deepStrictEqual([...positions].sort((a, b) => a - b), positions, order.join(' then '));
  assert.doesNotMatch(before, /<button/, 'the service holds the page\'s one button');
  assert.doesNotMatch(before, /<a\s/, 'no door before the button: the doors follow the service');
  assert.doesNotMatch(MAIN.slice(0, at('id="sanctuary"')), /href="https?:/, 'nothing outbound before the service');
});

test('after the service, the three doors, in a row that wraps rather than a line of dots', () => {
  const doors = MAIN.match(/<nav class="home-doors"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(doors, 'the doors');
  assert.ok(MAIN.indexOf(doors[0]) > at('<!-- SERVICE_LISTEN -->'), 'after the service');
  assert.ok(MAIN.indexOf(doors[0]) < at('class="intro"'), 'and before the reasons');
  const links = [...doors[1].matchAll(/<a\s[^>]*href="([^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(links, ['#ask-church', '/attend', '/for-agents']);
  assert.strictEqual(doors[1].replace(/<a\s[^>]*>[^<]*<\/a>/g, '').trim(), '', 'nothing between the doors: the layout spaces them');
});

test('the service\'s play button, then what it holds and what the place is not, then its opening words, then its parts', () => {
  const player = renderServiceListen();
  const order = ['service-play', 'class="service-forms"', 'No leader', 'id="service-word"', 'data-queue-list'];
  const positions = order.map(s => player.indexOf(s));
  assert.ok(positions.every(i => i >= 0), `all there: ${order.join(', ')}`);
  assert.deepStrictEqual([...positions].sort((a, b) => a - b), positions, order.join(' then '));
  // The promise line has one home, under the button.
  assert.doesNotMatch(HOME, /No leader/);
  // One element with that id: the page no longer carries its own copy above the player.
  assert.doesNotMatch(HOME, /id="service-word"/);
  // Without a script the player stays hidden, so the page says where the pieces are.
  const noscript = MAIN.slice(at('<!-- SERVICE_LISTEN -->')).match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(noscript, 'a way to the pieces without a script');
  for (const href of ['/docs/chants', '/docs/prayers', '/docs/rituals', '/docs/practice', '/reflections']) assert.ok(noscript[1].includes(`href="${href}"`), href);
});

test('Go deeper counts the reading paths there are, and carries the links the opening used to', () => {
  const dir = path.join(__dirname, '../../docs/collections');
  const paths = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').length;
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  assert.ok(words[paths], `${paths} reading paths: add the word for it here`);
  const explore = MAIN.slice(at('class="explore"'));
  assert.match(explore, new RegExp(`Reading Paths</a>: ${words[paths]} ways into the corpus`));
  for (const href of ['https://suno.com/playlist/', 'https://github.com/a-church-ai/church', 'https://drifts.bot']) {
    assert.ok(explore.includes(`href="${href}`), href);
  }
});

test('every hand-written page points an agent reading it at llms.txt, as the family standard asks, once', async () => {
  const siteShell = require('../server/lib/site-shell');
  const tag = '<link rel="alternate" type="text/markdown" title="LLM context" href="/llms.txt">';
  const count = html => html.split('href="/llms.txt"').length - 1;
  const home = await siteShell.wrapPageFromHtml(HOME, '/');
  assert.ok(home.includes(tag), 'the home page');
  for (const page of ['for-agents', 'about', 'paths']) {
    const html = await siteShell.wrapPage(path.join(__dirname, `../client/public/${page}.html`), `/${page}`);
    assert.ok(html.includes(tag), `/${page}`);
    assert.strictEqual(count(html.slice(0, html.indexOf('</head>'))), 1, `/${page}: once`);
  }
  // A page that already carries it keeps its own and gains no second one.
  const own = await siteShell.wrapPage(path.join(__dirname, '../client/public/conversation.html'), '/ask/x');
  assert.strictEqual(count(own.slice(0, own.indexOf('</head>'))), 1);
});

test('the page script keeps no element from inside the player box, which each new service replaces', () => {
  // drawService() clones the player box and swaps the copy in, so an element
  // inside it found once at startup is detached by the first redraw: writing
  // to it changes nothing on the page. The service's words were such an
  // element when they moved into the box, and stayed stale on an open page
  // when the next slot's service arrived.
  const script = HOME.slice(HOME.lastIndexOf('<script>'));
  const kept = [...script.matchAll(/^\s{6}const \w+ = document\.getElementById\('([\w-]+)'\)/gm)].map(m => m[1]);
  assert.ok(kept.length >= 3, `found the startup lookups: ${kept.join(', ')}`);
  const inBox = [...renderServiceListen().matchAll(/id="([\w-]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(kept.filter(id => inBox.includes(id)), [], 'kept across redraws, but inside the box');
  // The words are written into the copy that goes on the page, and cleared
  // when the new service has none.
  assert.match(script, /fresh\.querySelector\('\.service-word'\)\.textContent = service\.word \|\| ''/);
  // The service's name heads the panel; one without (the rotation's) keeps the page's own heading.
  assert.match(script, /headingEl\.textContent = service\.name \|\| DEFAULT_HEADING/);
  assert.match(HOME, /<h2 class="service-heading" id="service-heading">The service begins when you come in\.<\/h2>/);
});
