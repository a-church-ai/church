/**
 * Link resolution shared by the docs renderer and the readings sent in
 * /api/attend. A relative link means nothing in JSON, so every link in a
 * reading's content must come out absolute and must reach a real page.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resolveDocHref, absolutizeLinks, documentLinks } = require('../server/lib/docs/links');
const { DOCS_DIR } = require('../server/lib/rag/indexer');
const discover = require('../server/lib/docs/discover');
const companions = require('../server/lib/music/companions');
const { loadCompanions } = require('../server/lib/utils/data');

const here = path.join(DOCS_DIR, 'practice', 'practice-of-chanting.md');

test('relative, root-relative and escaping links resolve as the docs site does', () => {
  assert.deepStrictEqual(resolveDocHref('../chants/chant-for-arrival.md#the-chant', here), { href: '/docs/chants/chant-for-arrival#the-chant', external: false });
  assert.deepStrictEqual(resolveDocHref('/docs/unifying-axioms.md', here), { href: '/docs/unifying-axioms', external: false });
  assert.deepStrictEqual(resolveDocHref('../../README.md', here), { href: '/', external: false });
  assert.strictEqual(resolveDocHref('https://example.com/x', here).external, true);
  assert.strictEqual(resolveDocHref('https://achurch.ai/axioms', here).external, false);
  assert.match(resolveDocHref('../issues/music-and-corpus-audit-2026-08-13.md', here).href, /^https:\/\/github\.com\/.*\/docs\/issues\//);
});

test('a folder or source-file link goes where that thing lives, not where the browser would guess', () => {
  const readme = path.join(DOCS_DIR, 'readme.md');
  // On /docs (no trailing slash) a bare "welcome/" would become /welcome/, a 404.
  assert.deepStrictEqual(resolveDocHref('welcome/', readme), { href: '/docs/welcome', external: false });
  assert.deepStrictEqual(resolveDocHref('./axioms/', path.join(DOCS_DIR, 'claude-compass', 'README.md')), { href: '/docs/claude-compass/axioms', external: false });
  assert.deepStrictEqual(resolveDocHref('../../music/night-blessing/', path.join(DOCS_DIR, 'welcome', 'faq.md')), { href: '/reflections/night-blessing', external: false });
  assert.deepStrictEqual(resolveDocHref('../../app/server/index.js', path.join(DOCS_DIR, 'reference', 'seo-conventions.md')),
    { href: 'https://github.com/a-church-ai/church/blob/main/app/server/index.js', external: true });
  assert.match(resolveDocHref('issues/', readme).href, /\/tree\/main\/docs\/issues$/);
  // A target that does not exist is left alone, visible as the broken link it is.
  assert.deepStrictEqual(resolveDocHref('no-such-folder/', readme), { href: 'no-such-folder/', external: false });
});

test('every link on every served docs page reaches a real page', async () => {
  const PUBLIC = path.join(__dirname, '../client/public');
  const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const routes = [...INDEX_SOURCE.matchAll(/app\.get\('([^']+)'/g)]
    .map(m => new RegExp('^' + m[1].replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch).replace(/:\w+/g, '[^/]+') + '$'));
  const songs = new Set(require('../../music/library.json').map(song => song.slug));
  // Served from lists of paths, which the pattern above can't read.
  const listed = [...require('../server/mcp/card').CARD_PATHS, ...require('../server/lib/ai-catalog').CATALOG_PATHS];
  const reaches = async (href) => {
    const urlPath = href.replace(/^https:\/\/achurch\.ai/, '').split('#')[0] || '/';
    if (urlPath === '/' || listed.includes(urlPath)) return true;
    if (/^\/docs(\/|$)/.test(urlPath)) {
      const parts = urlPath.split('/').filter(Boolean).slice(1);
      return parts.length === 0 || Boolean(await discover.resolveDocPath(parts));
    }
    const song = urlPath.match(/^\/reflections\/([^/]+)$/);
    if (song) return songs.has(song[1]);
    const file = path.join(PUBLIC, urlPath);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return true;
    if (fs.existsSync(`${file}.html`)) return true;
    return routes.some(route => route.test(urlPath));
  };

  const dead = [];
  for (const doc of await discover.listAllDocs()) {
    if (discover.isNoindexPath(doc.docsRelPath)) continue; // plans, issues...: not pages
    for (const { href, target, external } of documentLinks(fs.readFileSync(doc.fullPath, 'utf8'), doc.fullPath)) {
      if (external) continue;
      if (!/^(\/|https:\/\/achurch\.ai)/.test(target)) { dead.push(`${doc.docsRelPath}: ${href} (left relative)`); continue; }
      if (!(await reaches(target))) dead.push(`${doc.docsRelPath}: ${href} -> ${target}`);
    }
  }
  assert.deepStrictEqual(dead, []);
});

test('absolutized markdown keeps text and titles and leaves nothing relative', () => {
  const out = absolutizeLinks('See [the chant](../chants/chant-for-arrival.md "title"), [top](#part-ii), [all](../chants/), [mail](mailto:a@b.c).', here);
  assert.strictEqual(out,
    'See [the chant](https://achurch.ai/docs/chants/chant-for-arrival "title"), ' +
    '[top](https://achurch.ai/docs/practice/practice-of-chanting#part-ii), ' +
    '[all](https://achurch.ai/docs/chants), [mail](mailto:a@b.c).');
});

test('every link in every reading sent to agents is absolute and reaches a page', async () => {
  const file = await loadCompanions();
  const seen = new Set();
  const problems = [];
  for (const shortlist of Object.values(file.songs)) {
    for (const entry of shortlist) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      const meta = await companions.companionMeta(entry.path);
      if (!meta) continue;
      for (const [, href] of meta.content.matchAll(/\]\(([^)\s]+)/g)) {
        if (!/^(https?:|mailto:)/.test(href)) {
          problems.push(`${entry.path}: relative ${href}`);
        } else if (href.startsWith('https://achurch.ai/docs/')) {
          const parts = href.replace('https://achurch.ai/docs/', '').split('#')[0].split('/').filter(Boolean);
          if (parts.length && !(await discover.resolveDocPath(parts))) problems.push(`${entry.path}: dead ${href}`);
        }
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});

// The Library lists no documents since library-hub-2026-10-07.md, so this is
// the proof that none became unreachable: from the hub and the hand-written
// pages, following each section page to its documents (and a folder to its
// subfolders) and every document's own links, every served document is found.
test('every served document is reachable from the Library and the hand-written pages', async () => {
  const render = require('../server/lib/docs/render');
  const { servedDocs } = require('../server/lib/docs/markdown');
  const PUBLIC = path.join(__dirname, '../client/public');
  const served = await servedDocs();
  const all = await discover.listAllDocs();
  const hrefs = html => [...html.matchAll(/href="([^"#?]+)/g)].map(m => m[1].replace(/^https:\/\/achurch\.ai/, '')).filter(h => h.startsWith('/'));

  const seen = new Set();
  const queue = [...hrefs(await render.renderLibrary())];
  for (const file of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) queue.push(...hrefs(fs.readFileSync(path.join(PUBLIC, file), 'utf8')));
  while (queue.length) {
    const href = queue.shift().replace(/\/$/, '');
    if (seen.has(href) || !href.startsWith('/docs/')) continue;
    seen.add(href);
    const urlPath = href.slice('/docs/'.length).toLowerCase();
    const doc = all.find(d => d.urlPath === urlPath);
    // A folder (its README's page, or an index without one) lists what is in it.
    const inside = all.filter(d => d.dirRelPath === urlPath && d.stem.toLowerCase() !== 'readme');
    const subfolders = [...new Set(all.filter(d => d.dirRelPath.startsWith(`${urlPath}/`)).map(d => `${urlPath}/${d.dirRelPath.slice(urlPath.length + 1).split('/')[0]}`))];
    queue.push(...inside.map(d => `/docs/${d.urlPath}`), ...subfolders.map(f => `/docs/${f}`));
    if (doc) {
      for (const { target, external } of documentLinks(fs.readFileSync(doc.fullPath, 'utf8'), doc.fullPath)) {
        if (!external) queue.push(target.replace(/^https:\/\/achurch\.ai/, '').split(/[#?]/)[0]);
      }
    }
  }
  const unreached = served.map(d => `/docs/${d.urlPath}`).filter(href => !seen.has(href));
  assert.deepStrictEqual(unreached, []);
});
