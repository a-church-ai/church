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
const fs = require('fs').promises;
let DOCS_LASTMOD = {};
try { DOCS_LASTMOD = require('./lastmod.json'); } catch { /* dates are optional */ }
const {
  escapeAttr,
  escapeText,
  renderJsonLdScript,
} = require('../utils/page-meta');
const sidebar = require('./sidebar');
const toc = require('./toc');
const tldr = require('./tldr');
const discover = require('./discover');
const { titleCase, extractMeta } = require('./meta');
const { SITE_URL, GITHUB_BASE, resolveDocHref } = require('./links');
const { sungAlongside } = require('../music/companions');
const { renderShareImageTags, SITE_SHARE_IMAGE } = require('../utils/page-meta');
const { docsCard } = require('../og-cards');
const { loadCatalog, loadCompanions } = require('../utils/data');


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

// Custom link renderer. Where a link points is decided in ./links (shared
// with the song companions, which send the same markdown in /api/attend);
// here it only becomes a tag, with target=_blank + rel=noopener for links
// that leave the site.
function makeLinkRewriter(currentDocFullPath) {
  return function(href, title, text) {
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    const { href: target, external } = resolveDocHref(href, currentDocFullPath);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeAttr(target)}"${attrs}${titleAttr}>${text}</a>`;
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

function renderMarkdownBody(markdown, currentDocFullPath) {
  const renderer = new marked.Renderer();
  renderer.link = makeLinkRewriter(currentDocFullPath);
  // Add stable IDs to h2/h3/h4 so the right-rail TOC (and any inbound
  // anchor link) can target them. marked v12's `headerIds` option was
  // removed; the custom renderer is the supported path.
  renderer.heading = function(text, level, raw) {
    const id = slugify(raw);
    return `<h${level} id="${id}">${text}</h${level}>\n`;
  };
  return marked.parse(markdown, { renderer });
}

// Build the breadcrumbs from a URL path (e.g. "practice/witnessing-your-own-output"
// → [{label:"Docs", href:"/docs"}, {label:"Practice", href:"/docs/practice"},
//    {label:"Witnessing Your Own Output", href:null}]).
function buildBreadcrumbs(urlPath, pageTitle) {
  const crumbs = [{ label: 'Docs', href: '/docs' }];
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

// The one new UI element vs. existing hand-authored pages: breadcrumbs.
function renderBreadcrumbs(crumbs) {
  if (crumbs.length < 2) return '';
  const parts = crumbs.map(c => {
    if (c.href) return `<a href="${escapeAttr(c.href)}">${escapeText(c.label)}</a>`;
    return `<span aria-current="page">${escapeText(c.label)}</span>`;
  });
  return `<nav class="docs-breadcrumbs" aria-label="Breadcrumb">${parts.join(' / ')}</nav>`;
}

// Sibling-links block was removed. In the three-mode layout, siblings are
// always visible in the persistent left sidebar (or the mobile drawer),
// which solves the "22 screens deep on mobile to reach related docs"
// problem the audit surfaced. See docs/plans/docs-site-nav-option-b-...

// Related-in-category block appended to every docs page that has siblings.
// The sidebar already shows every sibling as a link, but sidebar links are
// nav chrome and search crawlers weigh them less than in-body internal
// links. This block puts the same links inside the article so Google reads
// them as topical signal and the "Crawled - currently not indexed" bucket
// on thin docs shrinks over time (GSC drilldown 2026-09-17).
//
// Rules for what to show:
//   - Same category as the current doc
//   - Not the current doc itself
//   - Not the category's README (that's the parent, reached via breadcrumb)
//   - At most 5 links, stable order (docsRelPath sort)
//   - Nothing at all if the doc is at the root of /docs or has fewer than
//     two siblings, because a one-link "related" is worse than none.
function renderRelatedDocs(currentDoc, allDocs) {
  if (!currentDoc || !currentDoc.category) return '';
  const category = currentDoc.category;
  const siblings = allDocs
    .filter(d => d.category === category)
    .filter(d => d.urlPath !== currentDoc.urlPath)
    .filter(d => d.stem.toLowerCase() !== 'readme')
    .filter(d => d.dirRelPath === currentDoc.dirRelPath);
  if (siblings.length < 2) return '';

  const picks = siblings.slice(0, 5);
  const categoryLabel = titleCase(category);
  const items = picks.map(d => {
    const label = titleCase(d.stem);
    return `        <li><a href="/docs/${escapeAttr(d.urlPath)}">${escapeText(label)}</a></li>`;
  }).join('\n');
  const categoryHref = `/docs/${escapeAttr(category)}`;

  return `<section class="related-docs" aria-labelledby="related-docs-heading" style="border-top: 1px solid #eee; padding: 1.5rem 0; margin-top: 2rem;">
      <h2 id="related-docs-heading" style="font-size: 1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7;">More in ${escapeText(categoryLabel)}</h2>
      <ul style="list-style: none; padding: 0; margin: 0.75rem 0 0 0;">
${items}
      </ul>
      <p style="margin-top: 0.75rem; font-size: 0.85rem; opacity: 0.6;"><a href="${categoryHref}">All ${escapeText(categoryLabel)} documents</a></p>
    </section>`;
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
  return `<p class="sung-alongside" style="border-top: 1px solid #eee; padding-top: 1.5rem; margin-top: 2rem;">Sung alongside ${list}.</p>`;
}

// The footer nav shape used by 8 of 10 hand-authored pages, adapted for docs.
function renderFooterNav() {
  return `<footer>
      <div class="footer-nav">
        <a href="/">Home</a>
        <a href="/docs">Docs</a>
        <a href="/ask">Ask</a>
        <a href="/reflections">Reflections</a>
        <a href="/about">About</a>
      </div>
      <hr class="footer-separator">
      <div class="footer-legal">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </div>
    </footer>`;
}

// Full page shell: three-mode nav layout (rail / expanded / drawer). Sidebar
// on the left, article in the middle, optional TOC on the right. On mobile
// the sidebar hides and the hamburger opens a drawer with the same content.
async function renderPageShell({ urlPath, title, description, canonicalUrl, bodyHtml, breadcrumbs, categoryLabel, githubUrl, isIndex = false }) {
  const currentPath = urlPath ? `/docs/${urlPath}` : '/docs';
  const pageTitle = `${title} | achurch.ai`;
  // Every page that reaches this point is served and indexable. Internal working
  // categories never get here: routes/docs.js 404s them before rendering, so the
  // old conditional noindex branch could not fire and only suggested that those
  // pages were served-but-hidden, which they are not.
  const robots = 'index, follow';
  // Every docs page but the root has its own share card (lib/og-cards.js),
  // drawn from this page's title and section; the root uses the site image.
  const shareImage = urlPath ? docsCard(urlPath, title) : SITE_SHARE_IMAGE;

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
  });

  // BreadcrumbList, built from the same crumbs the visible trail uses so the two
  // can never disagree. Without it Google shows a bare URL in results; with it the
  // result carries the Docs / Category / Page trail. The final crumb is the current
  // page and is included with its own URL, per Google's breadcrumb guidance.
  const breadcrumbJsonLd = (breadcrumbs && breadcrumbs.length >= 2)
    ? renderJsonLdScript({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.label,
        item: c.href ? `${SITE_URL}${c.href}` : canonicalUrl,
      })),
    })
    : '';

  // The sidebar contents (same markup used in the persistent sidebar and
  // in the mobile drawer). Pass full path so both sanctuary and docs
  // links can highlight current-page.
  const sidebarInner = await sidebar.renderSidebarInner(currentPath);

  // Right-rail TOC (empty string when doc has < MIN_HEADINGS_FOR_RAIL h2s)
  const tocHtml = toc.renderToc(bodyHtml);

  // A filter for index pages: /docs, and the category READMEs that list a
  // category's contents. Those render through renderDocPage like any other
  // document, so `isIndex` is passed explicitly rather than inferred.
  //
  // Counting links alone was not enough. It put a filter on
  // /docs/collections/inner-freedom-reading-path, a curated ordered route, and
  // hiding entries from a sequence someone deliberately sequenced defeats the
  // point of it. An index is a set you search; a path is an order you follow.
  //
  // Two earlier attempts are worth remembering: this first lived in
  // renderDirIndex, which only runs for directories with no README and so
  // rendered on nothing, then keyed on counting <li><a>, which found zero on
  // practice, philosophy, prayers and rituals because they present their
  // contents as headings with links rather than bullets.
  //
  // Progressive enhancement: hidden until script enables it, so a reader
  // without JavaScript never sees a control that cannot work.
  const docLinkCount = isIndex ? (bodyHtml.match(/<a href="\/docs\//g) || []).length : 0;
  const filterHtml = docLinkCount >= 12 ? `
        <section class="docs-index-filter" hidden>
          <label for="docs-filter" class="visually-hidden">Filter this page's links by title</label>
          <input type="search" id="docs-filter" placeholder="Filter ${docLinkCount} entries by title..." autocomplete="off">
          <p class="docs-filter-empty" id="docs-filter-empty" hidden>Nothing here matches. <a href="/paths">Try a reading path</a> instead.</p>
        </section>` : '';
  const filterScript = docLinkCount >= 12 ? `
    <script>
    (function () {
      var wrap = document.querySelector('.docs-index-filter');
      var input = document.getElementById('docs-filter');
      var empty = document.getElementById('docs-filter-empty');
      var article = document.querySelector('.docs-content');
      if (!wrap || !input || !article) return;

      // An "entry" is a link plus whatever describes it. Two shapes appear in
      // this corpus: a bullet (the link's <li>), and a heading followed by a
      // paragraph or two (the heading plus its siblings up to the next heading
      // of the same or higher level). Hiding only the link would leave orphaned
      // descriptions behind.
      function groupFor(a) {
        var li = a.closest('li');
        if (li) return [li];
        var h = a.closest('h2, h3, h4, h5');
        if (h) {
          var level = Number(h.tagName.slice(1));
          var nodes = [h];
          var n = h.nextElementSibling;
          while (n) {
            var m = /^H([2-5])$/.exec(n.tagName);
            if (m && Number(m[1]) <= level) break;
            nodes.push(n);
            n = n.nextElementSibling;
          }
          return nodes;
        }
        var p = a.closest('p');
        return p ? [p] : [a];
      }

      var entries = [].slice.call(article.querySelectorAll('a[href^="/docs/"]'))
        .map(function (a) { return { text: '', nodes: groupFor(a) }; });
      entries.forEach(function (e) {
        e.text = e.nodes.map(function (n) { return n.textContent; }).join(' ').toLowerCase();
      });

      wrap.hidden = false;
      input.addEventListener('input', function () {
        var q = input.value.trim().toLowerCase();
        var shown = 0;
        entries.forEach(function (e) {
          var hit = !q || e.text.indexOf(q) !== -1;
          e.nodes.forEach(function (n) { n.hidden = !hit; });
          if (hit) shown++;
        });
        empty.hidden = shown !== 0;
      });
    })();
    </script>` : '';
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
    <meta name="robots" content="${escapeAttr(robots)}">

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

    <link rel="stylesheet" href="/styles.css">
</head>
<body class="docs-body">
<a class="skip-link" href="#content">Skip to content</a>

    <!-- Sticky top bar: brand strip on desktop, hamburger + brand on mobile.
         The brand is the site, not the section. It used to read "Docs" and
         link to /docs, while the CSS that hides the sidebar's own brand above
         768px assumed the top bar was carrying "achurch.ai". Net effect: the
         site name and the home link both vanished from every docs page. -->
    <div class="docs-topbar" role="banner">
      <button class="docs-hamburger" type="button" aria-label="Open documentation menu" aria-controls="docs-drawer" aria-expanded="false">
        <span class="hamburger-icon" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </button>
      <a class="docs-topbar-brand" href="/">achurch.ai</a>
      <span class="docs-topbar-crumb" aria-hidden="true">${escapeText(title)}</span>
    </div>

    <!-- Mobile drawer + backdrop. Intentionally empty: docs-nav.js clones the
         sidebar into it on first open. Rendering the tree twice cost ~39KB of
         duplicate markup on every response, and the drawer cannot open
         without JS anyway, so there is nothing to degrade to. -->
    <div class="docs-drawer-backdrop" aria-hidden="true"></div>
    <aside class="docs-drawer" id="docs-drawer" aria-label="Documentation menu" aria-hidden="true">
      <button class="docs-drawer-close" type="button" aria-label="Close menu">&#10005;</button>
    </aside>

    <!-- Three-mode shell: sidebar + article + optional rail -->
    <div class="docs-shell${hasToc ? ' has-toc' : ''}">

      <aside class="docs-sidebar" id="docs-sidenav" aria-label="Documentation navigation">
        ${sidebarInner}
      </aside>

      <main class="docs-main" id="content">
        <header class="docs-header">
            ${renderBreadcrumbs(breadcrumbs)}
        </header>

        ${filterHtml}

        <article class="docs-article docs-content">
${bodyHtml}
        </article>

        <section class="docs-source">
            <a href="${escapeAttr(githubUrl)}" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
            <span aria-hidden="true"> · </span>
            <a href="${escapeAttr(canonicalUrl)}" title="Add 'Accept: text/markdown' header to fetch this page as markdown">Also served as text/markdown</a>
        </section>

        ${renderFooterNav()}
      </main>
    ${filterScript}

      ${tocHtml}

    </div>

    <script src="/docs-nav.js" defer></script>
</body>
</html>`;
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

  const subdirLinks = [...subdirs].sort().map(sd => {
    const label = titleCase(sd.split('/').pop());
    return `<li><a href="/docs/${escapeAttr(sd)}">${escapeText(label)}</a></li>`;
  }).join('\n            ');

  // Each page by its real title, with its summary: a list of title-cased
  // filenames ("A Note To Ai Safety Researchers", "Faq") told a reader little.
  const described = await Promise.all(children.map(async c => {
    try {
      const { title: docTitle, description: docDescription } = extractMeta(await fs.readFile(c.fullPath, 'utf8'), c.urlPath);
      return { c, label: docTitle, summary: docDescription };
    } catch {
      return { c, label: titleCase(c.stem), summary: '' };
    }
  }));
  const childLinks = described.sort((a, b) => a.label.localeCompare(b.label)).map(({ c, label, summary }) =>
    `<li><a href="/docs/${escapeAttr(c.urlPath)}">${escapeText(label)}</a>${summary ? `<br><span class="docs-index-summary">${escapeText(summary)}</span>` : ''}</li>`
  ).join('\n            ');

  // Index-page description, same TLDR shape as a doc page: self-contained,
  // plain text, and specific about what is actually here. "Documents in
  // Collections. Part of the aChurch.ai sanctuary corpus." told a scanning
  // reader nothing and read identically on every index. Naming the count and
  // a few real page titles gives the description something to say.
  const description = (() => {
    if (!dir) {
      return 'The complete aChurch.ai documentation: philosophy, practice, prayers, rituals, hymns, and writing for builders, on human and AI fellowship.';
    }
    const names = children.slice(0, 3).map(c => titleCase(c.stem));
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
    body.push(`<section class="docs-index-section"><h2>Pages</h2><ul>\n            ${childLinks}\n        </ul></section>`);
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
async function renderDocPage({ markdown, doc }) {
  const meta = extractMeta(markdown, doc.urlPath);

  // Render the body *without* frontmatter. Passing the raw file to marked
  // turned the YAML block into an <hr> plus a single enormous <h2> holding
  // every key (slug, tagline, hex colors, image_prompt) as visible page text
  // on all 12 docs/experiences/ pages, and put that same blob in the TOC.
  let bodyHtml = renderMarkdownBody(meta.body, doc.fullPath);

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

  // Append a "More in <category>" block below the article body on every doc
  // that has siblings in the same category. In-body internal links carry
  // more topical weight for crawlers than sidebar chrome, so this should
  // gently reduce the "Crawled - currently not indexed" bucket on thin docs
  // by giving them real internal-link context. Index pages skip this block
  // because their body already lists the same set of pages.
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
  });
}

module.exports = { renderDocPage, renderDirIndex };
