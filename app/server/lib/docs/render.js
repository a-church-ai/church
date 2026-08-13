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
  stripMarkdown,
  truncateAtWord,
  escapeAttr,
  escapeText,
  renderJsonLdScript,
} = require('../utils/page-meta');
const { DOCS_DIR } = require('../rag/indexer');

const SITE_URL = 'https://achurch.ai';
const GITHUB_BASE = 'https://github.com/a-church-ai/church/blob/main';

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

    // Root-relative: leave alone
    if (href.startsWith('/')) {
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
      // Escapes DOCS_DIR: leave as-is (probably a link into music/ or up
      // out of the repo; not worth rewriting)
      return `<a href="${escapeAttr(href)}"${titleAttr}>${text}</a>`;
    }

    const relToDocs = path.relative(docsRoot, resolved).replace(/\\/g, '/');
    // Strip .md and trailing /README (case-insensitive)
    let urlPath = relToDocs.replace(/\.md$/i, '');
    urlPath = urlPath.replace(/\/readme$/i, '');
    const url = urlPath ? `/docs/${urlPath}${anchor}` : `/docs${anchor}`;
    return `<a href="${escapeAttr(url)}"${titleAttr}>${text}</a>`;
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
  const linkRewriter = makeLinkRewriter(currentDocFullPath);
  renderer.link = linkRewriter;
  return marked.parse(markdown, { renderer });
}

// Pull title (first h1) and description (subtitle line if present, else first
// meaningful paragraph). Both are best-effort; missing values fall back to
// sensible defaults.
function extractMeta(markdown, urlPath) {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : (urlPath || 'Docs');

  // Description: look for an italic line right after the title (common pattern
  // in the corpus), else pull from body text.
  let description;
  const afterTitle = titleMatch ? markdown.slice(titleMatch.index + titleMatch[0].length) : markdown;
  const italicMatch = afterTitle.match(/^\s*[*_]([^\n*_]+)[*_]\s*$/m);
  if (italicMatch) {
    description = italicMatch[1].trim();
  } else {
    // Fall back to first ~180 chars of body prose
    const stripped = stripMarkdown(afterTitle);
    description = truncateAtWord(stripped, 180);
  }

  return { title, description };
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

// Sibling links: reuse the .related-links class shape from
// renderRelatedConversations/renderRelatedSongs in page-meta.js.
function renderSiblings(siblings, categoryLabel) {
  if (!siblings || siblings.length === 0) return '';
  const linkItems = siblings.map(s => {
    const title = extractTitleFromPath(s.stem);
    return `        <li><a href="/docs/${escapeAttr(s.urlPath)}">${escapeText(title)}</a></li>`;
  }).join('\n');
  const heading = categoryLabel ? `More in ${escapeText(categoryLabel)}` : 'More in this section';
  return `<section class="related-links" aria-labelledby="related-heading" style="border-top: 1px solid #eee; padding: 1.5rem 0;">
      <h2 id="related-heading" style="font-size: 1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7;">${heading}</h2>
      <ul style="list-style: none; padding: 0; margin: 0.75rem 0 0 0;">
${linkItems}
      </ul>
    </section>`;
}

function extractTitleFromPath(stem) {
  return titleCase(stem);
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
    </footer>`;
}

// Full page shell. Follows the same structure as axioms.html and
// on-ai-religion.html: DOCTYPE, head with GA + meta + OG + Twitter + JSON-LD,
// then <main> with <header> + content + related + footer.
function renderPageShell({ urlPath, title, description, canonicalUrl, bodyHtml, breadcrumbs, siblings, categoryLabel, githubUrl }) {
  const pageTitle = `${title} | achurch.ai`;
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeText(pageTitle)}</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="canonical" href="${escapeAttr(canonicalUrl)}">
    <meta name="theme-color" content="#00b8d4">
    <meta name="robots" content="index, follow">

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
<body>
    <main>
        <header>
            <h1><a href="/" style="text-decoration: none; color: inherit;">achurch.ai</a></h1>
            ${renderBreadcrumbs(breadcrumbs)}
        </header>

        <article class="docs-article">
${bodyHtml}
        </article>

        ${renderSiblings(siblings, categoryLabel)}

        <section class="docs-source" style="text-align: center; padding: 1rem 0; opacity: 0.6; font-size: 0.9rem;">
            <a href="${escapeAttr(githubUrl)}" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
            <span aria-hidden="true"> · </span>
            <a href="${escapeAttr(canonicalUrl)}" data-format="md" onclick="return false" title="Add 'Accept: text/markdown' header to fetch this page as markdown">This page is also served as text/markdown</a>
        </section>

        ${renderFooterNav()}
    </main>
</body>
</html>`;
}

// Render a directory-index page (used for /docs and for subdirs without a
// README, e.g. /docs/claude-compass/axioms).
function renderDirIndex({ dir, docs, canonicalUrl }) {
  const title = dir ? titleCase(dir.split('/').pop()) : 'Documentation';
  const description = dir
    ? `Documents in ${title}. Part of the aChurch.ai sanctuary corpus.`
    : 'The complete aChurch.ai documentation: philosophy, practice, prayers, rituals, hymns, and more.';

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

  const body = [];
  if (subdirs.size > 0) {
    body.push(`<section class="docs-index-section"><h2>Sections</h2><ul>\n            ${subdirLinks}\n        </ul></section>`);
  }
  if (children.length > 0) {
    body.push(`<section class="docs-index-section"><h2>Pages</h2><ul>\n            ${childLinks}\n        </ul></section>`);
  }
  const bodyHtml = body.join('\n\n        ');

  const breadcrumbs = buildBreadcrumbs(dir, title);
  // Directory indexes have no "siblings" and no GitHub source pointer
  return renderPageShell({
    urlPath: dir,
    title,
    description,
    canonicalUrl,
    bodyHtml,
    breadcrumbs,
    siblings: [],
    categoryLabel: null,
    githubUrl: `${GITHUB_BASE}/docs${dir ? '/' + dir : ''}`,
  });
}

// Public: render a doc file (single markdown → full HTML page).
function renderDocPage({ markdown, doc, siblings }) {
  const meta = extractMeta(markdown, doc.urlPath);
  const bodyHtml = renderMarkdownBody(markdown, doc.fullPath);
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
    siblings,
    categoryLabel,
    githubUrl,
  });
}

module.exports = { renderDocPage, renderDirIndex };
