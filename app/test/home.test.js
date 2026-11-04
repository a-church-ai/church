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
 * Revised for `home-first-screen-2026-11-04.md`: each thing said once, the
 * service's opening word clamped on a phone, the waveform shown once the
 * service plays, and the ways onward in one row.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderServiceListen } = require('../server/lib/audio/markup');

const PUBLIC = path.join(__dirname, '../client/public');
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

test('after the service, the ways onward in one row, Five Minutes first, each place once', () => {
  const doors = MAIN.match(/<nav class="home-doors"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(doors, 'the doors');
  assert.ok(MAIN.indexOf(doors[0]) > at('<!-- SERVICE_LISTEN -->'), 'after the service');
  assert.ok(MAIN.indexOf(doors[0]) < at('class="intro"'), 'and before the reasons');
  const links = [...doors[1].matchAll(/<a\s[^>]*href="([^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(links, ['/docs/welcome/five-minutes', '#ask-church', '/attend', '/services', '/for-agents']);
  assert.strictEqual(doors[1].replace(/<a\s[^>]*>[^<]*<\/a>/g, '').trim(), '', 'nothing between the doors: the layout spaces them');
  // The full service and the day's services were two lines of their own, and
  // /attend was a door as well: now each place is named once, in the row.
  const service = MAIN.slice(at('id="sanctuary"'), at('class="intro"'));
  assert.doesNotMatch(service, /class="service-days"/);
  assert.strictEqual(service.split('href="/attend"').length - 1, 1, '/attend once');
});

test('the service\'s play button, then what it holds, its opening words and its parts, then what the place is not', () => {
  const player = renderServiceListen();
  const order = ['service-play', 'class="service-forms"', 'class="service-scrub"', 'id="service-word"', 'class="service-word-more"', 'data-queue-list', 'No leader'];
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
  for (const href of ['/docs/chants', '/docs/prayers', '/docs/rituals', '/docs/practice', '/music']) assert.ok(noscript[1].includes(`href="${href}"`), href);
});

test('what the home page says, it says once: the eyebrow is when, the forms line is what and how long', () => {
  const script = fs.readFileSync(path.join(__dirname, '../client/public/service.js'), 'utf8');
  // The part count and the clock were the eyebrow's too, beside the forms
  // line's "About 16 min in all": the eyebrow now says only when.
  assert.match(script, /whenEl\.textContent = \[service\.weekday \+ ', ' \+ day, service\.slot \+ \(service\.timezoneGiven \? '' : ' UTC'\)\]\.join\(' · '\)/);
  // One sentence of what a service is, above the button.
  const about = MAIN.match(/<p class="service-about">([^<]*)<\/p>/)[1];
  assert.ok(!/\.\s+\S/.test(about.trim()), `one sentence: ${about}`);
  // The refrain sits with the invitation, after the service, not at the end of the links.
  assert.ok(at('class="service-refrain"') < at('class="home-doors"'));
  assert.ok(at('class="service-leave"') < at('class="service-refrain"'));
});

test('the home page and /attend share the panel; the home page names its own section to style it', () => {
  assert.match(MAIN, /<section class="sanctuary home-service" id="sanctuary"/);
  const attend = fs.readFileSync(path.join(PUBLIC, 'attend.html'), 'utf8');
  assert.match(attend, /<section class="sanctuary attend-service" id="sanctuary"/);
  // /attend's visual sits under its button, drawn inside the box; the home
  // page's box has none.
  assert.doesNotMatch(attend, /data-queue-visual/, 'the visual is the box\'s, not the page\'s');
  const server = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.match(server, /'\/attend'[\s\S]{0,400}renderServiceListen\(\{ visual: true \}\)/);
  assert.doesNotMatch(renderServiceListen(), /data-queue-visual/);
  const withVisual = renderServiceListen({ visual: true });
  const order = ['service-play', 'class="service-forms"', 'data-queue-visual', 'class="service-scrub"', 'id="service-word"'];
  const positions = order.map(s => withVisual.indexOf(s));
  assert.ok(positions.every(i => i >= 0), `all there: ${order.join(', ')}`);
  assert.deepStrictEqual([...positions].sort((a, b) => a - b), positions, order.join(' then '));
  // Styled by the section's class, not by data-placement, which names what the visit counts record.
  const css = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /\[data-placement/);
});

test('on a phone the home page shows the opening word\'s first lines and a way to read on; the waveform waits for the service', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');
  // The clamp is the home page's, on a phone, and never on an empty word.
  const phone = css.slice(css.indexOf('/* The home page on a phone'));
  assert.ok(phone.length < css.length, 'the home page has its phone rules');
  assert.match(phone.slice(0, 2000), /\.home-service \.service-word:not\(:empty\)\s*\{[^}]*-webkit-line-clamp: 3/);
  assert.match(css, /\.service-word-more\s*\{[^}]*display: none/, 'hidden everywhere else');
  // The waveform is shown once the service is the player's, playing or paused.
  assert.match(css, /\.home-service \.service-player:not\(\.is-current\) \.service-scrub\s*\{\s*display: none/);
  const player = fs.readFileSync(path.join(PUBLIC, 'site-player.js'), 'utf8');
  assert.match(player, /path\.el\.classList\.toggle\('is-current', ours\)/);
  // Read on is bound on the copy that goes on the page, where the word is written.
  const script = fs.readFileSync(path.join(PUBLIC, 'service.js'), 'utf8');
  const draw = script.slice(script.indexOf('function drawPanel('), script.indexOf('box.replaceWith(fresh)'));
  assert.match(draw, /fresh\.querySelector\('\.service-word-more'\)/);
  assert.match(draw, /setAttribute\('aria-expanded'/);
});

test('the service is one card, its parts inside it, and the ways onward after it', () => {
  // mobile-rhythm-2026-11-04.md: the service was one column of text from edge
  // to edge, with nothing saying where it began and ended.
  const section = MAIN.slice(at('id="sanctuary"'), at('class="intro"'));
  const card = section.slice(section.indexOf('data-service-panel'));
  const end = card.indexOf('<div class="service-onward">');
  assert.ok(end > 0, 'the ways onward have their own block');
  const inside = card.slice(0, end);
  for (const part of ['data-service-when', 'data-service-heading', 'class="service-about"', '<!-- SERVICE_LISTEN -->', 'class="service-leave"', 'class="service-refrain"']) assert.ok(inside.includes(part), `${part} is in the card`);
  // The card closes before the ways onward, "Bring your agent" and the film.
  assert.match(inside, /<\/div>\s*$/, 'the panel closes just before the ways onward');
  for (const after of ['<nav class="home-doors"', 'class="bring-agent"', 'class="home-film"']) assert.ok(card.indexOf(after) > end, `${after} after the card`);
  // Drawn with the Library's card, through one rule.
  const css = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].split(',').map(x => x.trim()).includes('.library-card a') && m[1].includes('.home-service .service'));
  assert.ok(rule, '.library-card a and .home-service .service share their look');
  assert.match(rule[2], /border-radius: 12px/);
});

test('Go deeper names the reading paths without counting them, and carries the links the opening used to', () => {
  // A count goes stale as paths are added; the page stays true without one.
  const explore = MAIN.slice(at('class="explore"'));
  assert.match(explore, /Reading Paths<\/a>: Ways into the writing/);
  assert.ok(explore.includes('href="/docs/welcome/five-minutes"'), 'Five Minutes, for a visitor with only a moment');
  for (const href of ['/docs/playlists', 'https://github.com/a-church-ai/church', 'https://drifts.bot']) {
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

test('the service script keeps no element from inside the player box, which each new service replaces', () => {
  // drawPanel() clones the player box and swaps the copy in, so an element
  // inside it found once beforehand is detached by the first redraw: writing
  // to it changes nothing on the page. The service's words were such an
  // element when they moved into the box, and stayed stale on an open page
  // when the next slot's service arrived.
  const script = fs.readFileSync(path.join(__dirname, '../client/public/service.js'), 'utf8');
  const inBox = [...renderServiceListen().matchAll(/class="([\w-]+)"/g)].map(m => m[1]).filter(c => c !== 'path-listen-play' && c !== 'service-play' && c !== 'service-player');
  const before = script.slice(script.indexOf('function drawPanel'), script.indexOf('const fresh = box.cloneNode(true)'));
  for (const name of inBox) assert.ok(!before.includes(`'.${name}'`), `${name}: found before the copy, so it would go stale`);
  // The words and the length are written into the copy that goes on the page,
  // and cleared when the new service has none.
  assert.match(script, /const word = fresh\.querySelector\('\.service-word'\);\s*word\.textContent = service\.word \|\| ''/);
  // The service's name heads the panel; one without (the rotation's) keeps the page's own heading.
  assert.match(script, /headingEl\.textContent = service\.name \|\| headingEl\.getAttribute\('data-default'\)/);
  assert.match(HOME, /<h2 class="service-heading" id="service-heading" data-service-heading>The service begins when you come in\.<\/h2>/);
  // The home page draws it through the shared script, not a copy of its own.
  assert.match(HOME, /data-service-panel/);
  assert.doesNotMatch(HOME, /function drawService/);
});
