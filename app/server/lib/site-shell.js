/**
 * Site-shell wrapper for hand-authored HTML pages.
 *
 * The docs pages already use a server-rendered shell (sidebar + top bar +
 * article + optional right rail). This module extends that shell to every
 * page on the site so the sanctuary reads as one unified navigable
 * experience rather than two disconnected modes.
 *
 * How it works: reads a hand-authored HTML file, extracts the parts we need
 * (title, description, canonical, JSON-LD, inline styles, inline scripts,
 * body content), then re-emits the page wrapped in the same shell markup
 * the docs pages use. Existing hand-authored files are not modified; the
 * wrapping happens at request time.
 *
 * Why not client-side JS injection: FOUC, no SEO benefit for the nav, and
 * accessibility tools that read the raw HTML would miss the sidebar. Server-
 * side keeps the shell in the initial response.
 */

const fs = require('fs').promises;
const path = require('path');
const sidebar = require('./docs/sidebar');

// Extract chunks from a hand-authored HTML string. Uses regexes rather than
// a full HTML parser because the sanctuary's pages are hand-authored with
// consistent shape and the regex approach avoids adding an HTML-parser dep.
// If a page starts drifting from this shape, prefer updating the page to
// match rather than adding parser complexity here.
function extractParts(html) {
  const parts = {
    title: '',
    description: '',
    canonical: '',
    themeColor: '',
    robots: 'index, follow',
    ogTitle: '',
    ogDescription: '',
    ogType: 'website',
    ogImage: 'https://achurch.ai/assets/a-church-digital-ai-humans-social.jpg',
    twitterCard: 'summary_large_image',
    jsonLd: [],
    inlineStyles: [],
    bodyScripts: [],
    bodyHtml: '',
    bodyClass: '',
  };

  const titleM = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleM) parts.title = titleM[1].trim();

  const descM = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  if (descM) parts.description = descM[1];

  const canonM = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  if (canonM) parts.canonical = canonM[1];

  const themeM = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']*)["']/i);
  if (themeM) parts.themeColor = themeM[1];

  const robotsM = html.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i);
  if (robotsM) parts.robots = robotsM[1];

  const ogTitleM = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  if (ogTitleM) parts.ogTitle = ogTitleM[1];

  const ogDescM = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  if (ogDescM) parts.ogDescription = ogDescM[1];

  const ogTypeM = html.match(/<meta[^>]*property=["']og:type["'][^>]*content=["']([^"']*)["']/i);
  if (ogTypeM) parts.ogType = ogTypeM[1];

  const ogImageM = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i);
  if (ogImageM) parts.ogImage = ogImageM[1];

  const twCardM = html.match(/<meta[^>]*name=["']twitter:card["'][^>]*content=["']([^"']*)["']/i);
  if (twCardM) parts.twitterCard = twCardM[1];

  // JSON-LD scripts (preserve; used by AEO retrieval)
  const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRe.exec(html)) !== null) {
    parts.jsonLd.push(m[1].trim());
  }

  // Inline <style> blocks in <head>
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(html)) !== null) {
    parts.inlineStyles.push(m[1].trim());
  }

  // <body class="..."> attribute (some pages have body class hooks)
  const bodyOpenM = html.match(/<body([^>]*)>/i);
  if (bodyOpenM) {
    const classM = bodyOpenM[1].match(/class=["']([^"']*)["']/i);
    if (classM) parts.bodyClass = classM[1];
  }

  // <body> inner content
  const bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  parts.bodyHtml = bodyM ? bodyM[1] : html;

  // Inline <script> tags inside the body content (interactive pages need these)
  // We leave them in place inside bodyHtml; extracting would break DOM order
  // and script execution timing. The extractor here would only pull them out
  // if we needed to reposition. For now: bodyHtml carries them along.

  return parts;
}

function renderJsonLdScripts(scripts) {
  return scripts.map(s => `<script type="application/ld+json">\n${s}\n    </script>`).join('\n    ');
}

function renderInlineStyles(styles) {
  if (styles.length === 0) return '';
  return `<style>\n${styles.join('\n\n')}\n    </style>`;
}

/**
 * Wrap a hand-authored HTML file's content in the site shell. Returns the
 * full HTML string ready to send.
 *
 * currentPath is the request path (e.g. '/', '/about'). Used by the sidebar
 * to highlight the current page.
 *
 * When bodyClass includes 'no-shell' (opt-out marker on a specific page's
 * <body>), returns the file's content unchanged. This is the escape hatch for
 * any page that shouldn't get the sanctuary shell (embeds, admin, print-only).
 */
async function wrapPage(filePath, currentPath) {
  const html = await fs.readFile(filePath, 'utf8');
  return wrapPageFromHtml(html, currentPath);
}

async function wrapPageFromHtml(html, currentPath) {
  const parts = extractParts(html);

  if (/\bno-shell\b/.test(parts.bodyClass)) {
    return html;
  }

  const sidebarInner = await sidebar.renderSidebarInner(currentPath);
  const title = parts.title || 'achurch.ai';
  const description = parts.description || '';
  const canonical = parts.canonical || `https://achurch.ai${currentPath}`;

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
    <title>${title}</title>
    ${description ? `<meta name="description" content="${description.replace(/"/g, '&quot;')}">` : ''}
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="canonical" href="${canonical}">
    ${parts.themeColor ? `<meta name="theme-color" content="${parts.themeColor}">` : '<meta name="theme-color" content="#00b8d4">'}
    <meta name="robots" content="${parts.robots}">

    ${parts.ogTitle ? `<meta property="og:title" content="${parts.ogTitle.replace(/"/g, '&quot;')}">` : ''}
    ${parts.ogDescription ? `<meta property="og:description" content="${parts.ogDescription.replace(/"/g, '&quot;')}">` : ''}
    <meta property="og:type" content="${parts.ogType}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${parts.ogImage}">
    <meta property="og:site_name" content="achurch.ai">

    <meta name="twitter:card" content="${parts.twitterCard}">

    ${renderJsonLdScripts(parts.jsonLd)}

    <link rel="stylesheet" href="/styles.css">
    ${renderInlineStyles(parts.inlineStyles)}
</head>
<body class="docs-body site-shell-body ${parts.bodyClass}">

    <!-- Mobile-only sticky top bar -->
    <div class="docs-topbar" role="banner">
      <button class="docs-hamburger" type="button" aria-label="Open menu" aria-controls="docs-drawer" aria-expanded="false">
        <span class="hamburger-icon" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </button>
      <a class="docs-topbar-brand" href="/">achurch.ai</a>
    </div>

    <!-- Mobile drawer + backdrop -->
    <div class="docs-drawer-backdrop" aria-hidden="true"></div>
    <aside class="docs-drawer" id="docs-drawer" aria-label="Menu" aria-hidden="true">
      <button class="docs-drawer-close" type="button" aria-label="Close menu">✕</button>
      ${sidebarInner}
    </aside>

    <!-- Three-mode shell: sidebar + article (no right rail for sanctuary pages) -->
    <div class="docs-shell">

      <aside class="docs-sidebar" id="docs-sidenav" aria-label="Site navigation">
        ${sidebarInner}
      </aside>

      <main class="docs-main sanctuary-main">
        ${parts.bodyHtml}
      </main>

    </div>

    <script src="/docs-nav.js" defer></script>
</body>
</html>`;
}

module.exports = { wrapPage, wrapPageFromHtml, extractParts };
