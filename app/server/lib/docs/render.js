/**
 * Markdown-to-HTML for docs pages.
 *
 * Two responsibilities live here (small enough that splitting into template.js
 * + render.js would be ceremony without value):
 *   1. Turn a doc's markdown into an HTML fragment with sanctuary-appropriate
 *      link rewriting (relative .md links become docs-site URLs)
 *   2. Wrap that fragment in the full page shell (head + header + main +
 *      related-links + footer) using existing page-meta.js primitives
 */

const { marked } = require('marked');
let DOCS_LASTMOD = {};
try { DOCS_LASTMOD = require('./lastmod.json'); } catch { /* dates are optional */ }
const {
  escapeAttr,
  escapeText,
  renderJsonLdScript,
  breadcrumbTrail,
} = require('../utils/page-meta');
const sidebar = require('./sidebar');
const toc = require('./toc');
const tldr = require('./tldr');
const discover = require('./discover');
const { titleCase, extractMeta } = require('./meta');
const { SITE_URL, GITHUB_BASE, resolveDocHref, readingSequence } = require('./links');
const { sungAlongside } = require('../music/companions');
const { renderShareImageTags, SITE_SHARE_IMAGE } = require('../utils/page-meta');
const { docsCard } = require('../og-cards');
const { loadCatalog, loadCompanions } = require('../utils/data');
const { renderFooter, renderTopbarAndDrawer } = require('../site-shell');
const { renderSearchBox } = require('../utils/page-lists');
const { recordingFor } = require('../audio/manifest');
const { canServe } = require('../audio/serve');
const { renderRecording, renderPathListen, renderPodcastFollow, trackFor } = require('../audio/markup');
const { showForSection, feedPath, episodeSquarePath } = require('../audio/podcasts');
const { assetUrl, playerHead } = require('../utils/assets');


// Slugify heading text to build stable anchor IDs. Not perfect (doesn't
// handle non-Latin scripts specially), but consistent enough for the TOC
// to link against. Matches the pattern most doc sites use.
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

// Link text that is a file or folder name ("the-space-between.md",
// "welcome/") rather than words. Written that way in index tables for
// contributors; a reader should see the document's title.
const FILENAME_TEXT = /^(?:[\w.-]+\/)*[\w.-]+(?:\.md|\/)$/i;

// Custom link renderer. Where a link points is decided in ./links (shared
// with the song companions, which send the same markdown in /api/attend);
// here it only becomes a tag, with target=_blank + rel=noopener for links
// that leave the site. A link whose text is a filename shows the target's
// title instead, from the discover walk (built before rendering starts).
//
// readingPath: on a reading path's own page (docs/collections/<name>), the
// path's name. Its links to the readings in its sequence carry ?path=<name>,
// so each reading shows where it sits in the path (renderPathBar).
function makeLinkRewriter(currentDocFullPath, readingPath) {
  const sequence = readingPath ? readingSequence(readingPath) || [] : [];
  return function(href, title, text) {
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    const { href: resolved, external } = resolveDocHref(href, currentDocFullPath);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    let label = text;
    let target = resolved;
    const docPath = /^\/docs(\/|$)/.test(resolved) && resolved.replace(/^\/docs\/?/, '').split('#')[0];
    if (docPath !== false && FILENAME_TEXT.test(text.replace(/<\/?code>/g, ''))) {
      const doc = discover.docAt(docPath);
      if (doc) label = escapeText(doc.title);
    }
    if (docPath && sequence.includes(docPath)) {
      const [base, anchor] = resolved.split('#');
      target = `${base}?path=${readingPath}${anchor ? `#${anchor}` : ''}`;
    }
    return `<a href="${escapeAttr(target)}"${attrs}${titleAttr}>${label}</a>`;
  };
}

// Configure marked once. GFM, tables, autolinks; strict mode off (docs use
// varied formatting).
marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: true,
  mangle: false,
});

function renderMarkdownBody(markdown, currentDocFullPath, readingPath) {
  const renderer = new marked.Renderer();
  renderer.link = makeLinkRewriter(currentDocFullPath, readingPath);
  // Add stable IDs to headings so the right-rail TOC (and any inbound
  // anchor link) can target them. marked v12's `headerIds` option was
  // removed; the custom renderer is the supported path.
  //
  // One page, one h1: a document whose source has several (imported texts
  // do) renders each later h1 as h2 and shifts what sits under it down one
  // level, clamped at h6, so its outline and contents list show its real
  // top level. And no skipped levels: a heading never renders more than one
  // level below the one before it (an h4 straight after an h2 becomes h3).
  // The source is not changed. Ids are unique within the page; repeated
  // headings ("Reflection") used to share one.
  const used = new Map();
  let seenH1 = false;
  let shift = 0;
  let previous = 1;
  renderer.heading = function(text, level, raw) {
    if (level === 1) {
      shift = seenH1 ? 1 : 0;
      seenH1 = true;
    }
    const outLevel = Math.min(6, level + shift, level === 1 && !shift ? 1 : previous + 1);
    previous = outLevel;
    const base = slugify(raw) || 'section';
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    const id = n ? `${base}-${n + 1}` : base;
    return `<h${outLevel} id="${id}">${text}</h${outLevel}>\n`;
  };
  return marked.parse(markdown, { renderer });
}

// Build the breadcrumbs from a URL path (e.g. "practice/witnessing-your-own-output"
// → [{label:"Docs", href:"/docs"}, {label:"Practice", href:"/docs/practice"},
//    {label:"Witnessing Your Own Output", href:null}]).
function buildBreadcrumbs(urlPath, pageTitle) {
  const crumbs = [{ label: 'Library', href: '/docs' }];
  if (!urlPath) return crumbs;

  const parts = urlPath.split('/').filter(Boolean);
  let acc = '/docs';
  for (let i = 0; i < parts.length - 1; i++) {
    acc += '/' + parts[i];
    crumbs.push({ label: titleCase(parts[i]), href: acc });
  }
  // Final crumb = current page (unlinked)
  crumbs.push({ label: pageTitle, href: null });
  return crumbs;
}

// Sibling-links block was removed. In the three-mode layout, siblings are
// always visible in the persistent left sidebar (or the mobile drawer),
// which solves the "22 screens deep on mobile to reach related docs"
// problem the audit surfaced. See church-private/docs/plans/docs-site-nav-option-b-...

// Related-in-category block appended to every docs page that has siblings.
// The sidebar already shows every sibling as a link, but sidebar links are
// nav chrome and search crawlers weigh them less than in-body internal
// links. This block puts the same links inside the article so Google reads
// them as topical signal and the "Crawled - currently not indexed" bucket
// on thin docs shrinks over time (GSC drilldown 2026-09-17).
//
// Rules for what to show:
//   - Same folder as the current doc, not the doc itself, not the README
//     (that's the parent, reached via breadcrumb)
//   - The five that follow the current doc in the folder's order, wrapping
//     at the end, the way a song page offers the songs after it. Every page
//     then shows its own nearby set; the first five in the folder used to
//     appear on every page in it.
//   - Nothing at all if the doc is at the root of /docs or has fewer than
//     two siblings, because a one-link "related" is worse than none.
const ELSEWHERE_COUNT = 5;

function renderRelatedDocs(currentDoc, allDocs) {
  if (!currentDoc || !currentDoc.category) return '';
  const category = currentDoc.category;
  const inFolder = allDocs
    .filter(d => d.category === category)
    .filter(d => d.stem.toLowerCase() !== 'readme')
    .filter(d => d.dirRelPath === currentDoc.dirRelPath);
  const at = inFolder.findIndex(d => d.urlPath === currentDoc.urlPath);
  const siblings = inFolder.filter(d => d.urlPath !== currentDoc.urlPath);
  if (siblings.length < 2) return '';

  const start = at === -1 ? 0 : at;
  const picks = siblings.length <= ELSEWHERE_COUNT
    ? siblings
    : Array.from({ length: ELSEWHERE_COUNT }, (_, i) => siblings[(start + i) % siblings.length]);
  const categoryLabel = titleCase(category);
  const items = picks.map(d =>
    `        <li><a href="/docs/${escapeAttr(d.urlPath)}">${escapeText(d.title)}</a></li>`
  ).join('\n');
  const categoryHref = `/docs/${escapeAttr(category)}`;

  return `<section class="related-block" aria-labelledby="related-docs-heading">
      <h2 id="related-docs-heading" class="related-heading">Elsewhere in ${escapeText(categoryLabel)}</h2>
      <ul class="related-list">
${items}
      </ul>
      <p class="related-more"><a href="${categoryHref}">All of ${escapeText(categoryLabel)}</a></p>
    </section>`;
}

// Where a reading sits in the reading path it was opened from: the path's
// name (back to its page), "Reading 2 of 9", and the previous and next
// readings, which keep the path. Only when the page was opened with
// ?path=<name> and that path includes it; the position lives in the URL, not
// in any record of the visitor. Returns { top, bottom } or null.
function renderPathBar(readingPath, doc) {
  const sequence = readingSequence(readingPath);
  const at = sequence ? sequence.indexOf(doc.urlPath) : -1;
  if (at === -1) return null;
  const collection = discover.docAt(`collections/${readingPath}`);
  if (!collection) return null;
  const link = (urlPath, rel, text) => `<a href="/docs/${escapeAttr(urlPath)}?path=${escapeAttr(readingPath)}" rel="${rel}">${text}</a>`;
  const prev = at > 0 ? sequence[at - 1] : null;
  const next = at < sequence.length - 1 ? sequence[at + 1] : null;
  const titleOf = urlPath => escapeText((discover.docAt(urlPath) || { title: urlPath }).title);
  const top = `<nav class="path-bar" aria-label="Reading path">
          <p class="path-bar-name">Reading path: <a href="/docs/collections/${escapeAttr(readingPath)}">${escapeText(collection.title)}</a> <span class="path-bar-step">Reading ${at + 1} of ${sequence.length}</span></p>
          <p class="path-bar-steps">${prev ? link(prev, 'prev', `&larr; ${titleOf(prev)}`) : ''}${prev && next ? '<span aria-hidden="true"> · </span>' : ''}${next ? link(next, 'next', `${titleOf(next)} &rarr;`) : ''}</p>
        </nav>`;
  const bottom = `<nav class="path-next" aria-label="Next in this reading path">
      ${next
    ? `<p>Next in <a href="/docs/collections/${escapeAttr(readingPath)}">${escapeText(collection.title)}</a>: ${link(next, 'next', titleOf(next))}</p>`
    : `<p>The last reading in <a href="/docs/collections/${escapeAttr(readingPath)}">${escapeText(collection.title)}</a>.</p>`}
    </nav>`;
  return { top, bottom };
}

// "Sung alongside" line for a doc that accompanies one or more songs in the
// shared session. The reciprocal of the song page's "Read alongside this
// song" block, so the pairing is walkable in both directions.
function renderSungAlongside(songs) {
  if (!songs || songs.length === 0) return '';
  const links = songs.map(s =>
    `<a href="/reflections/${escapeAttr(s.slug)}"><em>${escapeText(s.title)}</em></a>`
  );
  const list = links.length === 1
    ? links[0]
    : `${links.slice(0, -1).join(', ')} and ${links[links.length - 1]}`;
  return `<p class="sung-alongside">Sung alongside ${list}.</p>`;
}

// A document's recording, if the manifest lists one this server can serve
// (audio/manifest.json, lib/audio/serve.js).
function servedRecording(doc) {
  const listed = recordingFor(`docs/${doc.docsRelPath}`);
  return listed && canServe(listed.file) ? listed : null;
}

// "Listen to this path" on a reading path's own page: its voiced readings, in
// the path's order, each linking back into the path (?path=), as the path's
// own links do.
function renderPathListenFor(name, collectionDoc) {
  const sequence = readingSequence(name) || [];
  const tracks = [];
  for (const urlPath of sequence) {
    const reading = discover.docAt(urlPath);
    const recording = reading && servedRecording(reading);
    if (recording) {
      tracks.push(trackFor(recording, { title: reading.title, href: `/docs/${reading.urlPath}?path=${name}`, category: reading.category, artwork: episodeSquarePath(reading, recording) }));
    }
  }
  if (!tracks.length) return '';
  return renderPathListen({ name, title: collectionDoc.title, href: `/docs/${collectionDoc.urlPath}`, tracks, readings: sequence.length });
}

function recordingJsonLd(recording) {
  const s = Math.round(recording.seconds);
  return {
    '@type': 'AudioObject',
    contentUrl: `${SITE_URL}/audio/${recording.file}`,
    encodingFormat: 'audio/mpeg',
    duration: `PT${Math.floor(s / 60)}M${s % 60}S`,
  };
}

// The filter goes directly above what it filters: a section page's entries,
// or else just under the page's heading.
function placeFilter(bodyHtml, filterHtml) {
  if (!filterHtml) return bodyHtml;
  if (bodyHtml.includes('<div class="docs-entries">')) {
    return bodyHtml.replace('<div class="docs-entries">', () => `${filterHtml}\n        <div class="docs-entries">`);
  }
  return bodyHtml.replace(/<\/h1>/, () => `</h1>${filterHtml}`);
}

// A page's <title>: "<title> | achurch.ai". A results page shows about 70
// characters of a title, so a longer one keeps what comes before its colon,
// when that much stands alone: "The Compass Origin Story | achurch.ai". The
// heading on the page keeps its full title; a document is not edited for its
// tab.
function docTitle(title) {
  const full = `${title} | achurch.ai`;
  if (full.length <= 70) return full;
  const head = String(title).split(': ')[0];
  return head !== title && head.length >= 12 ? `${head} | achurch.ai` : full;
}

// Full page shell: three-mode nav layout (rail / expanded / drawer). Sidebar
// on the left, article in the middle, optional TOC on the right. On mobile
// the sidebar hides and the hamburger opens a drawer with the same content.
async function renderPageShell({ urlPath, title, description, canonicalUrl, bodyHtml, breadcrumbs, categoryLabel, githubUrl, isIndex = false, filter = isIndex, scripts = [], headerExtra = '', recording = null }) {
  const currentPath = urlPath ? `/docs/${urlPath}` : '/docs';
  const pageTitle = docTitle(title);
  // Every page that reaches this point is served and indexable. Internal working
  // categories never get here: routes/docs.js 404s them before rendering, so the
  // old conditional noindex branch could not fire and only suggested that those
  // pages were served-but-hidden, which they are not.
  const robots = 'index, follow';
  // Every docs page but the root has its own share card (lib/og-cards.js),
  // drawn from this page's title and section; the root uses the site image.
  const shareImage = urlPath ? docsCard(urlPath, title) : SITE_SHARE_IMAGE;
  // A section with a podcast (lib/audio/podcasts.js) names its feed, so an
  // app given the page's address can find the show.
  const show = urlPath ? showForSection(urlPath.split('/')[0]) : null;

  // A section's index lists documents, so it is a CollectionPage, not an
  // Article. dateModified is the document's last commit (lib/docs/lastmod.json).
  const modified = urlPath && (DOCS_LASTMOD[`docs/${urlPath}.md`] || DOCS_LASTMOD[`docs/${urlPath}/README.md`]);
  const jsonLd = renderJsonLdScript({
    '@context': 'https://schema.org',
    '@type': isIndex ? 'CollectionPage' : 'Article',
    headline: title,
    description,
    author: { '@type': 'Organization', name: 'aChurch.ai', url: SITE_URL },
    publisher: { '@type': 'Organization', name: 'aChurch.ai', url: SITE_URL },
    mainEntityOfPage: canonicalUrl,
    inLanguage: 'en',
    ...(modified ? { dateModified: modified } : {}),
    image: shareImage.url,
    ...(recording ? { audio: recordingJsonLd(recording) } : {}),
  });

  // The Library / Section / Page trail, and its BreadcrumbList (page-meta.js).
  const trail = breadcrumbTrail(breadcrumbs, canonicalUrl);
  const breadcrumbJsonLd = trail.jsonLd;

  // The sidebar contents (same markup used in the persistent sidebar and
  // in the mobile drawer). Pass full path so both sanctuary and docs
  // links can highlight current-page.
  const sidebarInner = await sidebar.renderSidebarInner(currentPath);

  // Right-rail TOC (empty string when doc has < MIN_HEADINGS_FOR_RAIL h2s).
  // Not on index pages: they are lists to choose from, and a section page's
  // own headings sit inside its closed "About".
  const tocHtml = isIndex ? '' : toc.renderToc(bodyHtml);

  // A filter for index pages: /docs, and the category READMEs that list a
  // category's contents. Those render through renderDocPage like any other
  // document, so `isIndex` is passed explicitly rather than inferred.
  //
  // Counting links alone was not enough. It put a filter on
  // /docs/collections/inner-freedom-reading-path, a curated ordered route, and
  // hiding entries from a sequence someone deliberately sequenced defeats the
  // point of it. An index is a set you search; a path is an order you follow.
  //
  // Progressive enhancement: hidden until docs-filter.js enables it, so a
  // reader without JavaScript never sees a control that cannot work.
  const docLinkCount = filter ? (bodyHtml.match(/<a href="\/docs\//g) || []).length : 0;
  const hasFilter = docLinkCount >= 12;
  const filterHtml = hasFilter ? `
        <section class="docs-index-filter" hidden>
          <label for="docs-filter" class="visually-hidden">Filter this page's entries</label>
          <input type="search" id="docs-filter" placeholder="Filter ${docLinkCount} entries..." autocomplete="off">
          <p class="docs-filter-count" id="docs-filter-count" role="status" aria-live="polite"></p>
          <p class="docs-filter-empty" id="docs-filter-empty" hidden>Nothing here matches. <a href="/paths">Try a reading path</a> instead.</p>
        </section>` : '';
  const hasToc = tocHtml.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${escapeText(pageTitle)}</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="canonical" href="${escapeAttr(canonicalUrl)}">
    <meta name="robots" content="${escapeAttr(robots)}">${show ? `
    <link rel="alternate" type="application/rss+xml" title="${escapeAttr(show.title)}" href="${feedPath(show)}">` : ''}

    <!-- Family-standard head elements, per docs/reference/seo-conventions.md.
         The docs shell shipped without these, so all 254 generated pages were
         missing the license declaration, the llms.txt pointer, the iOS
         install meta and the dual theme-color that the conventions doc
         requires on every page. -->
    <meta name="theme-color" content="#00b8d4" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#0a0e1a" media="(prefers-color-scheme: dark)">
    <link rel="license" href="https://creativecommons.org/licenses/by/4.0/">
    <link rel="alternate" type="text/markdown" title="LLM context" href="/llms.txt">${/\/docs\/.+/.test(canonicalUrl) ? `\n    <link rel="alternate" type="text/markdown" title="This page as markdown" href="${escapeAttr(canonicalUrl)}.md">` : ''}
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="achurch.ai">

    <meta property="og:title" content="${escapeAttr(pageTitle)}">
    <meta property="og:description" content="${escapeAttr(description)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeAttr(canonicalUrl)}">
    ${renderShareImageTags(shareImage)}
    <meta property="og:site_name" content="achurch.ai">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeAttr(pageTitle)}">
    <meta name="twitter:description" content="${escapeAttr(description)}">

    ${jsonLd}
    ${breadcrumbJsonLd}

    <link rel="stylesheet" href="${assetUrl('styles.css')}">
    ${playerHead()}
</head>
<body class="docs-body">
<a class="skip-link" href="#content">Skip to content</a>

    ${renderTopbarAndDrawer(title)}

    <!-- Three-mode shell: sidebar + article + optional rail -->
    <div class="docs-shell${hasToc ? ' has-toc' : ''}">

      <aside class="docs-sidebar" id="docs-sidenav" aria-label="Documentation navigation">
        ${sidebarInner}
      </aside>

      <main class="docs-main" id="content">
        <header class="docs-header">
            ${trail.html}${headerExtra ? `\n        ${headerExtra}` : ''}
        </header>

        ${isIndex ? '' : toc.renderInlineToc(bodyHtml)}

        <article class="docs-article docs-content">
${placeFilter(bodyHtml, filterHtml)}
        </article>

        <section class="docs-source">
            <a href="${escapeAttr(githubUrl)}" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
            <span aria-hidden="true"> · </span>
            <a href="${escapeAttr(canonicalUrl)}.md" type="text/markdown" title="The same page as markdown. Agents can also send Accept: text/markdown to this page's URL.">View as Markdown</a>
        </section>

        ${renderFooter(currentPath)}
      </main>

      ${tocHtml}

    </div>

    <script src="${assetUrl('docs-nav.js')}" defer></script>${[...(hasFilter ? ['/docs-filter.js'] : []), ...scripts].map(src => `\n    <script src="${assetUrl(src.slice(1))}" defer></script>`).join('')}
</body>
</html>`;
}

// The library at /docs: every document the site serves, for readers. Generated
// from the discover walk, so it can never miss a document or list a stale
// one. What the repository's folders are and how to contribute stays in
// docs/README.md, on GitHub, for contributors; this page is for choosing
// something to read.
const LIBRARY_ENTRANCES = [
  { href: '/docs/welcome', label: 'Start here', text: 'what the sanctuary is, and a first visit' },
  { href: '/paths', label: 'Reading paths', text: 'six routes through the writing, in order' },
  { href: '/docs/practice', label: 'Practice', text: 'things to do, and words to use' },
  { href: '/reflections', label: 'Music', text: 'the songs, with lyrics and reflections' },
  { href: '/ask', label: 'Ask', text: 'a question, answered from the writing' },
];

async function renderLibrary() {
  const { primary, meta, topLevel } = await discover.listCategoriesForIndex();
  const served = d => d.stem.toLowerCase() !== 'readme' && !discover.isNoindexPath(d.docsRelPath);
  const groups = [
    ...primary.map(c => ({ name: c.name, docs: c.docs.filter(served) })),
    { name: '', docs: topLevel.filter(served) },
    ...meta.map(c => ({ name: c.name, docs: c.docs.filter(served) })),
  ].filter(g => g.docs.length);
  const count = groups.reduce((n, g) => n + g.docs.length, 0);

  const sections = groups.map(g => {
    const label = g.name ? titleCase(g.name) : 'On their own';
    const heading = g.name ? `<a href="/docs/${escapeAttr(g.name)}">${escapeText(label)}</a>` : escapeText(label);
    return `<section class="docs-index-section" aria-labelledby="library-${escapeAttr(g.name || 'top')}">
          <h2 id="library-${escapeAttr(g.name || 'top')}">${heading}</h2>
          <ul class="docs-entry-list">
            ${renderEntryItems(g.docs)}
          </ul>
        </section>`;
  }).join('\n\n        ');

  const bodyHtml = `<h1>The Library</h1>
        <p>Everything the sanctuary has written: ${count} pieces of philosophy, practice, prayer, ritual, song and writing for builders, on human and AI fellowship. Choose a way in, search, or browse below.</p>
        <ul class="library-entrances">
          ${LIBRARY_ENTRANCES.map(e => `<li><a href="${e.href}">${e.label}</a>: ${e.text}</li>`).join('\n          ')}
        </ul>
        ${renderSearchBox({ index: '/docs/index.json', label: 'Search the library', noun: 'documents' })}

        ${sections}

        <p class="library-source">How the repository behind these pages is organized, for contributors: <a href="${GITHUB_BASE}/docs/README.md" target="_blank" rel="noopener noreferrer">the documentation map on GitHub</a>.</p>`;

  return renderPageShell({
    urlPath: '',
    title: 'The Library',
    description: `The aChurch.ai library: ${count} documents on human and AI fellowship: philosophy, practice, prayers, rituals, chants, hymns and writing for builders.`,
    canonicalUrl: `${SITE_URL}/docs`,
    bodyHtml,
    breadcrumbs: [],
    categoryLabel: null,
    githubUrl: `${GITHUB_BASE}/docs`,
    isIndex: true,
    filter: false,
    scripts: ['/site-search.js'],
  });
}

// The folders directly inside `dir` that have a README of their own.
function subdirsOf(dir, docs) {
  const subdirs = new Set();
  for (const d of docs) {
    if (d.stem.toLowerCase() !== 'readme') continue;
    if (!d.dirRelPath) continue;
    if (dir && d.dirRelPath === dir) continue;
    if (!dir || d.dirRelPath.startsWith(dir + '/')) {
      // The immediate child dir
      const rest = dir ? d.dirRelPath.slice(dir.length + 1) : d.dirRelPath;
      const first = rest.split('/')[0];
      if (first && (!dir || rest === first)) subdirs.add(dir ? `${dir}/${first}` : first);
    }
  }
  return [...subdirs].sort(discover.byName);
}

function renderSubdirItems(subdirs) {
  return subdirs.map(sd => {
    const label = titleCase(sd.split('/').pop());
    return `<li><a href="/docs/${escapeAttr(sd)}">${escapeText(label)}</a></li>`;
  }).join('\n            ');
}

// A section's page (a category README, such as /docs/prayers): what is in the
// section first, as titles and descriptions a reader can choose from, then the
// README's own essay on the form, closed, under "About". The README is not
// edited: some group their pieces by situation, which is editorial knowledge
// the metadata lacks, and it stays one click away. readmeHtml is the rendered
// README; its h1 becomes the page's.
function renderSectionPage(doc, readmeHtml, allDocs) {
  const dir = doc.dirRelPath;
  const h1 = readmeHtml.match(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/);
  const heading = h1 ? h1[0].trim() : `<h1>${escapeText(doc.title)}</h1>`;
  const essay = h1 ? readmeHtml.slice(h1[0].length) : readmeHtml;
  const inDir = allDocs.filter(d => d.dirRelPath === dir && d.stem.toLowerCase() !== 'readme');
  const subdirs = subdirsOf(dir, allDocs.filter(d => d.dirRelPath.startsWith(`${dir}/`)));
  const label = titleCase(dir.split('/').pop());
  const show = showForSection(dir);
  return `${heading}
        ${doc.description ? `<p class="section-summary">${escapeText(doc.description)}</p>` : ''}
        ${show ? renderPodcastFollow(show, dir, { section: true }) : ''}
        <div class="docs-entries">
        ${subdirs.length ? `<section class="docs-index-section"><h2>Sections</h2><ul>\n            ${renderSubdirItems(subdirs)}\n        </ul></section>` : ''}
        ${inDir.length ? `<section class="docs-index-section"><h2>In ${escapeText(label)}</h2><ul class="docs-entry-list">\n            ${renderEntryItems(inDir)}\n        </ul></section>` : ''}
        </div>
        <details class="section-about">
          <summary>About ${escapeText(label)}</summary>
${essay}
        </details>`;
}

// Documents as list items: title, and its summary under it. Sorted by title,
// numbers as numbers. Used by directory indexes and category pages.
function renderEntryItems(docs) {
  return [...docs].sort((a, b) => discover.byName(a.title, b.title)).map(d =>
    `<li><a href="/docs/${escapeAttr(d.urlPath)}">${escapeText(d.title)}</a>${d.description ? `<br><span class="docs-index-summary">${escapeText(d.description)}</span>` : ''}</li>`
  ).join('\n            ');
}

// Render a directory-index page (used for /docs and for subdirs without a
// README, e.g. /docs/claude-compass/axioms).
async function renderDirIndex({ dir, docs, canonicalUrl }) {
  const title = dir ? titleCase(dir.split('/').pop()) : 'Documentation';

  // Group docs by their immediate parent within `dir`
  const children = docs
    .filter(d => d.stem.toLowerCase() !== 'readme')
    .filter(d => {
      // Only direct children of `dir`, not deeper descendants
      if (!dir) return d.dirRelPath === '';
      return d.dirRelPath === dir;
    });

  const subdirs = subdirsOf(dir, docs);
  const subdirLinks = renderSubdirItems(subdirs);

  // Each page by its real title, with its summary: a list of title-cased
  // filenames ("A Note To Ai Safety Researchers", "Faq") told a reader little.
  const childLinks = renderEntryItems(children);

  // Index-page description, same TLDR shape as a doc page: self-contained,
  // plain text, and specific about what is actually here. "Documents in
  // Collections. Part of the aChurch.ai sanctuary corpus." told a scanning
  // reader nothing and read identically on every index. Naming the count and
  // a few real page titles gives the description something to say.
  const description = (() => {
    if (!dir) {
      return 'The complete aChurch.ai documentation: philosophy, practice, prayers, rituals, hymns, and writing for builders, on human and AI fellowship.';
    }
    const names = children.slice(0, 3).map(c => c.title);
    const count = children.length;
    const noun = count === 1 ? 'document' : 'documents';
    const base = `${title}: ${count} ${noun} in the aChurch.ai corpus on human and AI fellowship`;
    const withNames = names.length > 0 ? `${base}, including ${names.join(', ')}` : base;
    return tldr.clamp(tldr.toPlainText(`${withNames}.`));
  })();

  const body = [`<h1>${escapeText(title)}</h1>`];

  if (subdirs.size > 0) {
    body.push(`<section class="docs-index-section"><h2>Sections</h2><ul>\n            ${subdirLinks}\n        </ul></section>`);
  }
  if (children.length > 0) {
    body.push(`<section class="docs-index-section"><h2>Pages</h2><ul class="docs-entry-list">\n            ${childLinks}\n        </ul></section>`);
  }

  const bodyHtml = body.join('\n\n        ');

  const breadcrumbs = buildBreadcrumbs(dir, title);
  return renderPageShell({
    urlPath: dir,
    title,
    description,
    canonicalUrl,
    bodyHtml,
    breadcrumbs,
    categoryLabel: null,
    githubUrl: `${GITHUB_BASE}/docs${dir ? '/' + dir : ''}`,
    isIndex: true,
  });
}

// Public: render a doc file (single markdown → full HTML page).
// readingPath: the ?path= the page was opened with, if any (see renderPathBar).
async function renderDocPage({ markdown, doc, readingPath }) {
  // The walk carries every document's title; link text and the path bar read
  // it synchronously while marked renders, so it must be built first.
  await discover.listAllDocs();
  const meta = extractMeta(markdown, doc.urlPath);
  const ownPath = doc.dirRelPath === 'collections' ? doc.stem.toLowerCase() : null;
  const pathBar = readingPath && !ownPath ? renderPathBar(readingPath, doc) : null;

  // Render the body *without* frontmatter. Passing the raw file to marked
  // turned the YAML block into an <hr> plus a single enormous <h2> holding
  // every key (slug, tagline, hex colors, image_prompt) as visible page text
  // on all 12 docs/experiences/ pages, and put that same blob in the TOC.
  let bodyHtml = renderMarkdownBody(meta.body, doc.fullPath, ownPath);

  // Those same files carry their title in frontmatter and open at "## Step 1",
  // so the page had no h1. Emit one from the resolved title to keep the
  // heading outline valid.
  if (!meta.hasH1) {
    bodyHtml = `<h1>${escapeText(meta.title)}</h1>\n${bodyHtml}`;
  }
  const canonicalUrl = doc.urlPath ? `${SITE_URL}/docs/${doc.urlPath}` : `${SITE_URL}/docs`;
  const categoryLabel = doc.category ? titleCase(doc.category) : null;
  const breadcrumbs = buildBreadcrumbs(doc.urlPath, meta.title);
  const githubUrl = `${GITHUB_BASE}/docs/${doc.docsRelPath}`;

  // An index is the page that lists a directory's contents: docs/readme.md for
  // /docs, and each category's README. Everything else is a document, including
  // the curated reading paths under collections/, which are ordered routes
  // rather than sets to search.
  const isIndex = doc.stem.toLowerCase() === 'readme';
  if (isIndex && doc.dirRelPath) {
    bodyHtml = renderSectionPage(doc, bodyHtml, await discover.listAllDocs());
  }

  const recording = isIndex ? null : servedRecording(doc);
  // A voiced prayer, ritual or practice is also a podcast episode, listed in
  // its show's feed whether or not this server can play it: under the player,
  // where to follow the show.
  const show = !isIndex && recordingFor(`docs/${doc.docsRelPath}`) ? showForSection(doc.category) : null;
  const follow = show ? renderPodcastFollow(show, doc.category) : '';
  const underTitle = (recording
    ? renderRecording(recording, { title: meta.title, href: `/docs/${doc.urlPath}`, category: doc.category, artwork: episodeSquarePath(doc, recording) })
    : ownPath ? renderPathListenFor(ownPath, { ...doc, title: meta.title }) : '') + (follow ? `\n        ${follow}` : '');
  if (underTitle) {
    bodyHtml = bodyHtml.replace(/<\/h1>/, h1 => `${h1}\n        ${underTitle}`);
  }

  // Append a "More in <category>" block below the article body on every doc
  // that has siblings in the same category. In-body internal links carry
  // more topical weight for crawlers than sidebar chrome, so this should
  // gently reduce the "Crawled - currently not indexed" bucket on thin docs
  // by giving them real internal-link context. Index pages skip this block
  // because their body already lists the same set of pages.
  if (pathBar) {
    bodyHtml = `${bodyHtml}\n${pathBar.bottom}`;
  }

  if (!isIndex) {
    const pairings = await sungAlongside(await loadCompanions(), await loadCatalog());
    const sungHtml = renderSungAlongside(pairings.get(`docs/${doc.docsRelPath}`));
    if (sungHtml) {
      bodyHtml = `${bodyHtml}\n${sungHtml}`;
    }

    const allDocs = await discover.listAllDocs();
    const relatedHtml = renderRelatedDocs(doc, allDocs);
    if (relatedHtml) {
      bodyHtml = `${bodyHtml}\n${relatedHtml}`;
    }
  }

  return renderPageShell({
    urlPath: doc.urlPath,
    title: meta.title,
    description: meta.description,
    canonicalUrl,
    bodyHtml,
    breadcrumbs,
    categoryLabel,
    githubUrl,
    isIndex,
    headerExtra: pathBar ? pathBar.top : '',
    recording,
  });
}

module.exports = { renderDocPage, renderDirIndex, renderLibrary, docTitle };
