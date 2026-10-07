/**
 * The shell every page shares: a top bar naming the site's places, and a
 * sidebar only inside a section of the Library. Until 2026-10-07 the sidebar
 * carried every place and every section on every page, the hand-written pages
 * repeated the site's name above their own title, and nothing pinned any of it.
 * Written to fail against the shell as of that date. The plan is
 * `sanctuary-shell-and-reflections-2026-10-07.md` in the private repo.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const discover = require('../server/lib/docs/discover');
const render = require('../server/lib/docs/render');
const siteShell = require('../server/lib/site-shell');

const PUBLIC = path.join(__dirname, '../client/public');
const PLACES = ['/', '/attend', '/ask', '/docs', '/about', '/for-agents'];

const wrap = (file, at) => siteShell.wrapPageFromHtml(fs.readFileSync(path.join(PUBLIC, file), 'utf8'), at);
const docPage = async urlPath => {
  await discover.listAllDocs();
  const doc = discover.docAt(urlPath);
  return render.renderDocPage({ markdown: fs.readFileSync(doc.fullPath, 'utf8'), doc });
};

// The top bar's links, in order, each with its aria-current if it has one.
const topbarPlaces = html => {
  const bar = html.slice(html.indexOf('class="docs-topbar"'), html.indexOf('class="docs-drawer-backdrop"'));
  return [...bar.matchAll(/<a\b[^>]*>/g)].map(([tag]) => [
    tag.match(/href="([^"]*)"/)[1],
    (tag.match(/aria-current="([^"]*)"/) || [])[1] || '',
  ]);
};
const sidebarOf = html => {
  const m = /<nav class="docs-sidebar"[\s\S]*?<\/nav>\s*<main/.exec(html);
  return m ? m[0] : '';
};

async function pages() {
  const { primary } = await discover.listCategoriesForIndex();
  const section = primary.find(c => c.name === 'practice');
  const doc = section.docs.find(d => d.stem.toLowerCase() !== 'readme');
  return {
    '/': await wrap('index.html', '/'),
    '/about': await wrap('about.html', '/about'),
    '/axioms': await wrap('axioms.html', '/axioms'),
    '/ask': await wrap('ask.html', '/ask'),
    '/reflections': await wrap('reflections.html', '/reflections'),
    '/conversations': await siteShell.wrapPageFromHtml('<html><head><title>Conversations</title></head><body><main><h1>Conversations</h1></main></body></html>', '/conversations'),
    '/docs': await render.renderLibrary(),
    '/docs/practice': await docPage('practice'),
    [`/docs/${doc.urlPath}`]: await docPage(doc.urlPath),
  };
}

test('every kind of page names the same places in its top bar, and marks where the visitor is', async () => {
  const all = await pages();
  const expected = {
    '/': ['/', 'page'],
    '/about': ['/about', 'page'],
    '/axioms': ['/about', 'true'],
    '/ask': ['/ask', 'page'],
    '/reflections': ['/attend', 'true'],
    '/conversations': ['/ask', 'true'],
    '/docs': ['/docs', 'page'],
    '/docs/practice': ['/docs', 'true'],
  };
  for (const [at, html] of Object.entries(all)) {
    const links = topbarPlaces(html);
    assert.deepStrictEqual(links.map(l => l[0]), ['/', ...PLACES, '/search'], `${at}: the brand, the places, then search`);
    const marked = links.slice(1, -1).filter(l => l[1]);
    const want = expected[at] || ['/docs', 'true'];
    assert.deepStrictEqual(marked, [want], `${at}: one place marked`);
    assert.match(html, /<meta name="assets"/, `${at} keeps the player across pages`);
  }
});

test('only a section of the Library has a sidebar, and it lists exactly that section', async () => {
  const all = await pages();
  for (const at of ['/', '/about', '/axioms', '/ask', '/reflections', '/docs']) {
    assert.doesNotMatch(all[at], /class="docs-sidebar"/, `${at} has no sidebar`);
    assert.doesNotMatch(all[at], /class="site-mark"/, `${at} does not repeat the site's name`);
  }
  const { primary, meta } = await discover.listCategoriesForIndex();
  const practice = primary.find(c => c.name === 'practice');
  const own = practice.docs.filter(d => d.stem.toLowerCase() !== 'readme').map(d => `/docs/${d.urlPath}`);
  const [docAt] = Object.keys(all).filter(k => k.startsWith('/docs/practice/'));

  for (const at of ['/docs/practice', docAt]) {
    const side = sidebarOf(all[at]);
    assert.ok(side, `${at} has the section sidebar`);
    assert.match(side, /<a class="sidebar-back" href="\/docs">/, 'a way back to the Library');
    const list = side.slice(side.indexOf('class="sidebar-list"'), side.indexOf('class="sidebar-sections"'));
    const links = [...list.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
    assert.deepStrictEqual(links, ['/docs/practice', ...own], `${at}: the section's name, then its documents`);
    const current = [...side.matchAll(/href="([^"]*)" aria-current="page"/g)].map(m => m[1]);
    assert.deepStrictEqual(current, [at], `${at} is marked as the page`);
    // The other sections, folded: every section but this one, once.
    const folded = side.slice(side.indexOf('class="sidebar-sections"'));
    const others = [...folded.matchAll(/href="\/docs\/([^"]*)"/g)].map(m => m[1]);
    assert.deepStrictEqual(others, [...primary, ...meta].map(c => c.name).filter(n => n !== 'practice'));
    assert.match(all[at], /class="section-toggle"[^>]*aria-controls="docs-drawer"/, 'a narrower screen opens it in the drawer');
  }
});

test('a document outside any section has no sidebar', async () => {
  const { topLevel } = await discover.listCategoriesForIndex();
  const doc = topLevel.find(d => d.stem.toLowerCase() !== 'readme');
  assert.doesNotMatch(await docPage(doc.urlPath), /class="docs-sidebar"/);
});

test('the footer names the places, and the pages that live under them', async () => {
  const footer = siteShell.renderFooter('/axioms');
  for (const url of [...PLACES, '/axioms', '/on-ai-religion', '/paths', '/reflections']) {
    assert.match(footer, new RegExp(`href="${url}"`), url);
  }
  assert.match(footer, /href="\/axioms" aria-current="page"/);
});

test('what the old sidebar needed is gone: the glyph rail, the collapse control and the opt-out', () => {
  const sidebar = fs.readFileSync(path.join(__dirname, '../server/lib/docs/sidebar.js'), 'utf8');
  const nav = fs.readFileSync(path.join(PUBLIC, 'docs-nav.js'), 'utf8');
  const css = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');
  const shell = fs.readFileSync(path.join(__dirname, '../server/lib/site-shell.js'), 'utf8');
  assert.doesNotMatch(sidebar, /GLYPH|SANCTUARY_PAGES/);
  assert.doesNotMatch(nav, /NARROW_MQ|sidenav\.collapsed|e\.key !== '\\\\'/);
  assert.doesNotMatch(css, /cat-glyph|docs-sidebar-toggle|\.collapsed|site-mark/);
  assert.doesNotMatch(shell, /no-shell|FOOTER_NAV/);
  for (const file of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(PUBLIC, file), 'utf8'), /site-mark/, file);
  }
});

test('the top bar ends with search and the theme, at every width', async () => {
  const html = await wrap('about.html', '/about');
  const bar = html.slice(html.indexOf('class="docs-topbar"'), html.indexOf('class="docs-drawer-backdrop"'));
  const tools = bar.slice(bar.indexOf('class="topbar-tools"'));
  assert.ok(bar.indexOf('class="topbar-tools"') > bar.indexOf('class="topbar-places"'), 'after the places, outside them, so a phone keeps them');
  assert.match(tools, /<a class="topbar-icon" href="\/search" aria-label="Search">/);
  assert.match(tools, /<button class="topbar-icon topbar-theme" type="button" aria-label="Appearance" hidden>/, 'shown once its script can work it');
  for (const choice of ['auto', 'light', 'dark']) assert.match(tools, new RegExp(`class="[^"]*\\btheme-icon theme-${choice}"`));
  assert.match(await siteShell.wrapPageFromHtml('<html><head></head><body><main><h1>Search</h1></main></body></html>', '/search'), /href="\/search" aria-label="Search" aria-current="page"/);
  assert.doesNotMatch(html, /footer-theme/, 'one place to change it');
});
