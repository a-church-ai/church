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

const path = require('path');
const { marked } = require('marked');
const {
  escapeAttr,
  escapeText,
  renderJsonLdScript,
} = require('../utils/page-meta');
const { DOCS_DIR } = require('../rag/indexer');
const sidebar = require('./sidebar');
const toc = require('./toc');
const tldr = require('./tldr');
const discover = require('./discover');

const SITE_URL = 'https://achurch.ai';
const GITHUB_BASE = 'https://github.com/a-church-ai/church/blob/main';

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

// Custom link renderer: rewrite relative .md links to docs-site URLs.
// External and anchor links pass through unchanged; external links get
// target=_blank + rel=noopener automatically.
function makeLinkRewriter(currentDocFullPath) {
  const currentDir = path.dirname(currentDocFullPath);

  return function(href, title, text) {
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';

    // Anchor-only: leave alone
    if (href.startsWith('#')) {
      return `<a href="${escapeAttr(href)}"${titleAttr}>${text}</a>`;
    }

    // Absolute URLs: leave alone, but add target=_blank + rel=noopener for
    // any host that is not achurch.ai
    if (/^https?:\/\//i.test(href)) {
      const isInternal = /^https?:\/\/([a-z0-9-]+\.)?achurch\.ai(\/|$)/i.test(href);
      const attrs = isInternal ? '' : ' target="_blank" rel="noopener noreferrer"';
      return `<a href="${escapeAttr(href)}"${attrs}${titleAttr}>${text}</a>`;
    }

    // Root-relative. Mostly passes through, but a link written as
    // `/docs/unifying-axioms.md` has to lose the .md the same way a relative
    // one does. Six links in docs/reference/ were written this way and each
    // shipped a live 404, because this branch returned before the .md
    // stripping below ever ran.
    if (href.startsWith('/')) {
      const [rootPath, rootFragment] = href.split('#', 2);
      if (/^\/docs\/.+\.md$/i.test(rootPath)) {
        const cleaned = docsUrlFromRelPath(rootPath.replace(/^\/docs\//i, ''));
        return `<a href="${escapeAttr(cleaned + (rootFragment ? `#${rootFragment}` : ''))}"${titleAttr}>${text}</a>`;
      }
      return `<a href="${escapeAttr(href)}"${titleAttr}>${text}</a>`;
    }

    // Relative link. Try to resolve against the current doc's dir. Split
    // off any anchor fragment so we can preserve it.
    const [pathPart, fragment] = href.split('#', 2);
    const anchor = fragment ? `#${fragment}` : '';

    // Non-.md relative link (image, other file): leave as-is
    if (!pathPart.toLowerCase().endsWith('.md')) {
      return `<a href="${escapeAttr(href)}"${titleAttr}>${text}</a>`;
    }

    // Resolve against current dir, then produce a docs URL if the target
    // is inside DOCS_DIR
    const resolved = path.resolve(currentDir, pathPart);
    const docsRoot = path.resolve(DOCS_DIR);
    if (!resolved.startsWith(docsRoot + path.sep) && resolved !== docsRoot) {
      // Escapes DOCS_DIR. Common cases from the corpus:
      //   ../README.md → repo root README. Not routed on the site; the
      //   sanctuary landing is at /. Rewrite to that.
      //   ../CLAUDE.md → build/collaboration doc; not for site visitors.
      //   Rewrite to the GitHub URL so the link still resolves.
      // Anything else (link into music/, up out of repo): leave as-is
      // and accept the potential 404 rather than guess at intent.
      const repoRoot = path.resolve(docsRoot, '..');
      const relToRepo = path.relative(repoRoot, resolved).replace(/\\/g, '/');
      if (relToRepo.toLowerCase() === 'readme.md') {
        return `<a href="/"${titleAttr}>${text}</a>`;
      }
      if (relToRepo.toLowerCase() === 'claude.md') {
        return `<a href="${escapeAttr(GITHUB_BASE + '/CLAUDE.md')}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
      }
      return `<a href="${escapeAttr(href)}"${titleAttr}>${text}</a>`;
    }

    const relToDocs = path.relative(docsRoot, resolved).replace(/\\/g, '/');
    const url = `${docsUrlFromRelPath(relToDocs)}${anchor}`;
    return `<a href="${escapeAttr(url)}"${titleAttr}>${text}</a>`;
  };
}

// docs-relative file path ("practice/foo.md", "readme.md") → site URL.
// Shared by the relative and root-relative branches of the link rewriter so
// both strip .md and collapse README the same way.
//
// The README pattern is anchored with (^|/): the earlier /\/readme$/i needed a
// leading slash, so a link to the top-level readme.md produced "/docs/readme"
// rather than "/docs". Every category README's "Parent: Documentation" link
// pointed at that 404.
function docsUrlFromRelPath(relToDocs) {
  const urlPath = String(relToDocs || '')
    .replace(/\.md$/i, '')
    .replace(/(^|\/)readme$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  return urlPath ? `/docs/${urlPath}` : '/docs';
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

// Pull the title (first h1) and a TLDR-shaped description.
//
// The description goes through lib/docs/tldr.js, which implements the TLDR
// distillation methodology for the meta-description surface: plain text only,
// self-contained, one or two sentences, clamped to the band in
// docs/reference/seo-conventions.md. It replaces an earlier heuristic that
// only recognized *italic* subtitles; 78 of 87 docs added in Aug 2026 write
// their subtitle as plain text, so that heuristic fell through to raw body
// truncation and leaked horizontal rules and headings into 82 descriptions.
//
// Run `node scripts/audit-tldr.js` to see what every page resolves to and
// which ones want an explicit `tldr:` in frontmatter.
// Title precedence: the body's first h1, then a `name:`/`title:` in
// frontmatter, then the URL slug title-cased. The frontmatter tier matters
// for docs/experiences/*, which carry their title in `name:` and have no h1
// at all; before this they fell back to the raw url path, so the browser tab
// and the search result both read "experiences/03-evensong".
function extractMeta(markdown, urlPath) {
  const { data, body } = tldr.splitFrontmatter(markdown);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const slug = String(urlPath || '').split('/').filter(Boolean).pop();
  const title = (titleMatch && titleMatch[1].trim())
    || data.name
    || data.title
    || (slug ? titleCase(slug) : '')
    || 'Docs';
  const { text: description } = tldr.extractTldr(markdown, { title });
  return { title, description, hasH1: Boolean(titleMatch), body };
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

function titleCase(slug) {
  return slug.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
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
    </footer>`;
}

// Full page shell: three-mode nav layout (rail / expanded / drawer). Sidebar
// on the left, article in the middle, optional TOC on the right. On mobile
// the sidebar hides and the hamburger opens a drawer with the same content.
async function renderPageShell({ urlPath, title, description, canonicalUrl, bodyHtml, breadcrumbs, categoryLabel, githubUrl }) {
  const currentPath = urlPath ? `/docs/${urlPath}` : '/docs';
  const pageTitle = `${title} | achurch.ai`;
  // Internal working docs are readable but kept out of search results. The
  // sitemap applies the same predicate, so the two signals stay consistent.
  const robots = discover.isNoindexPath(urlPath) ? 'noindex, follow' : 'index, follow';
  const jsonLd = renderJsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    author: { '@type': 'Organization', name: 'aChurch.ai', url: SITE_URL },
    publisher: { '@type': 'Organization', name: 'aChurch.ai', url: SITE_URL },
    mainEntityOfPage: canonicalUrl,
    inLanguage: 'en',
  });

  // The sidebar contents (same markup used in the persistent sidebar and
  // in the mobile drawer). Pass full path so both sanctuary and docs
  // links can highlight current-page.
  const sidebarInner = await sidebar.renderSidebarInner(currentPath);

  // Right-rail TOC (empty string when doc has < MIN_HEADINGS_FOR_RAIL h2s)
  const tocHtml = toc.renderToc(bodyHtml);
  const hasToc = tocHtml.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-CWMKP64EVH"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-CWMKP64EVH');
    </script>
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
    <link rel="alternate" type="text/markdown" title="LLM context" href="/llms.txt">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="achurch.ai">

    <meta property="og:title" content="${escapeAttr(pageTitle)}">
    <meta property="og:description" content="${escapeAttr(description)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeAttr(canonicalUrl)}">
    <meta property="og:image" content="${SITE_URL}/assets/a-church-digital-ai-humans-social.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="achurch.ai">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeAttr(pageTitle)}">
    <meta name="twitter:description" content="${escapeAttr(description)}">
    <meta name="twitter:image" content="${SITE_URL}/assets/a-church-digital-ai-humans-social.jpg">

    ${jsonLd}

    <link rel="stylesheet" href="/styles.css">
</head>
<body class="docs-body">

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

      <main class="docs-main">
        <header class="docs-header">
            ${renderBreadcrumbs(breadcrumbs)}
        </header>

        <article class="docs-article">
${bodyHtml}
        </article>

        <section class="docs-source">
            <a href="${escapeAttr(githubUrl)}" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
            <span aria-hidden="true"> · </span>
            <a href="${escapeAttr(canonicalUrl)}" title="Add 'Accept: text/markdown' header to fetch this page as markdown">Also served as text/markdown</a>
        </section>

        ${renderFooterNav()}
      </main>

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

  const childLinks = children.sort((a, b) => a.stem.localeCompare(b.stem)).map(c => {
    const label = titleCase(c.stem);
    return `<li><a href="/docs/${escapeAttr(c.urlPath)}">${escapeText(label)}</a></li>`;
  }).join('\n            ');

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

  const body = [];
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

  return renderPageShell({
    urlPath: doc.urlPath,
    title: meta.title,
    description: meta.description,
    canonicalUrl,
    bodyHtml,
    breadcrumbs,
    categoryLabel,
    githubUrl,
  });
}

module.exports = { renderDocPage, renderDirIndex };
