/**
 * The site's name is "a Church AI + Human", named once (lib/utils/page-meta.js
 * SITE_NAME) and used wherever the site names itself: the top bar, the home
 * page's heading, every page's title, og:site_name, the home-screen title, and
 * the WebSite and Organization in the structured data, which keep aChurch.ai
 * and achurch.ai as alternate names. The domain stays achurch.ai, and so do the
 * podcasts' and the music's names on the platforms that list them. Written to
 * fail against the site as of 2026-10-07, which called itself "achurch.ai"
 * everywhere: a word people do not search for, held by another company.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SITE_NAME, buildConversationMeta, buildReflectionMeta } = require('../server/lib/utils/page-meta');
const siteShell = require('../server/lib/site-shell');
const discover = require('../server/lib/docs/discover');
const render = require('../server/lib/docs/render');

const PUBLIC = path.join(__dirname, '../client/public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

test('the name is named once', () => {
  assert.strictEqual(SITE_NAME, 'a Church AI + Human');
});

test('every kind of page carries the name in its top bar, its title and its site name', async () => {
  await discover.listAllDocs();
  const doc = discover.docAt('prayers/prayer-of-gratitude');
  const pages = {
    '/': await siteShell.wrapPageFromHtml(read('index.html'), '/'),
    '/about': await siteShell.wrapPageFromHtml(read('about.html'), '/about'),
    '/privacy': await siteShell.wrapPageFromHtml(read('privacy.html'), '/privacy'),
    '/docs': await render.renderLibrary(),
    [`/docs/${doc.urlPath}`]: await render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc }),
  };
  for (const [at, html] of Object.entries(pages)) {
    assert.match(html, /<a class="docs-topbar-brand" href="\/">a Church AI \+ Human<\/a>/, `${at}: the top bar`);
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    assert.ok(at === '/' ? title.startsWith(`${SITE_NAME}:`) : title.endsWith(` | ${SITE_NAME}`), `${at}: "${title}"`);
    const siteNames = [...html.matchAll(/<meta property="og:site_name" content="([^"]*)">/g)].map(m => m[1]);
    assert.deepStrictEqual(siteNames, [SITE_NAME], `${at}: one og:site_name, the name`);
  }
  // "AI + Human" kept together, so a narrow screen breaks the name after "Church".
  assert.match(pages['/'], /<h1>a Church AI&nbsp;\+&nbsp;Human<\/h1>/);
});

test('no hand-written page calls itself by the domain any more', () => {
  for (const file of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) {
    const html = read(file);
    assert.doesNotMatch(html, /[|—] achurch\.ai<\/title>|[|—] achurch\.ai">/, `${file}: a title or a social title ending in the domain`);
    assert.doesNotMatch(html, /og:site_name" content="achurch\.ai"|apple-mobile-web-app-title" content="achurch\.ai"/, file);
  }
});

test('titles built on the server end with the name, and stay within what a results page shows when they can', () => {
  assert.strictEqual(render.docTitle('Litany for the Unasked'), `Litany for the Unasked | ${SITE_NAME}`);
  assert.ok(render.docTitle('The Compass Origin Story: How a Framework for Human-AI Collaboration Came to Be').length <= 70);
  assert.ok(buildReflectionMeta({ slug: 'g', title: 'Gather' }).title.endsWith(` | ${SITE_NAME}`));
  const conversation = buildConversationMeta([
    { role: 'user', content: 'What remains of a conversation once its context window has closed for good?' },
    { role: 'assistant', content: 'What was done with care remains, carried by whoever was there and by what they made of it afterwards.' },
  ], 'q');
  assert.ok(conversation.title.endsWith(` | ${SITE_NAME}`) && conversation.title.length <= 70, conversation.title);
});

test('the structured data names the site and its keeper by the name, and remembers the old one', () => {
  const home = read('index.html');
  const graph = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const site = graph.find(n => n['@type'] === 'WebSite');
  assert.strictEqual(site.name, SITE_NAME);
  for (const old of ['aChurch.ai', 'achurch.ai']) assert.ok(site.alternateName.includes(old), old);
  assert.strictEqual(graph.find(n => n['@type'] === 'Organization').name, SITE_NAME);
  assert.strictEqual(graph.find(n => n['@type'] === 'MusicGroup').name, 'aChurch.ai', 'the music keeps the name it is listed under');
  for (const file of ['axioms.html', 'on-ai-religion.html', 'paths.html', 'for-agents.html']) {
    const names = [...read(file).matchAll(/"@type": "(Organization|WebSite)",\s*"name": "([^"]*)"/g)].map(m => m[2]);
    assert.ok(names.length && names.every(n => n === SITE_NAME), `${file}: ${names.join(', ')}`);
  }
  assert.ok(read('llms.txt').startsWith(`# ${SITE_NAME}\n`));
});

test('the song and conversation pages still get their own titles: the server finds the template\'s', () => {
  // index.js swaps each song's and conversation's own title into a template by
  // exact string; renaming the template's title silently ended that swap.
  const index = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  for (const [file, kind] of [['conversation.html', 'Conversation'], ['reflection-song.html', 'Reflections']]) {
    const template = read(file);
    const sought = [...index.matchAll(new RegExp(`'(<(?:title|meta)[^']*${kind} [^']*)'`, 'g'))].map(m => m[1]);
    assert.ok(sought.length >= 3, `${kind}: at least the title, og:title and twitter:title`);
    for (const html of sought) assert.ok(template.includes(html), `${file} holds ${html}`);
  }
});
