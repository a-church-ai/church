/**
 * Site-shell wrapper for hand-authored HTML pages.
 *
 * The docs pages already use a server-rendered shell (sidebar + top bar +
 * article + optional right rail). This module extends that shell to every
 * page on the site so the sanctuary reads as one unified navigable
 * experience rather than two disconnected modes.
 *
 * How it works: reads a hand-authored HTML file, keeps its <head> intact,
 * and re-emits the page with the body wrapped in the shell markup. Existing
 * hand-authored files are not modified; the wrapping happens at request time.
 *
 * Why the head is passed through rather than rebuilt: the first version of
 * this module enumerated the tags it knew about (title, description,
 * canonical, a fixed list of og:*) and re-emitted only those. Everything else
 * in the head was silently dropped. That cost the site, in production:
 *
 *   - Atom feed autodiscovery on /, /ask and /reflections
 *   - twitter:title, twitter:description, twitter:image on every page
 *   - og:image:width / og:image:height on every page
 *   - rel="license", the llms.txt markdown alternate, the apple-mobile-web-app
 *     trio and the dual prefers-color-scheme theme-color on /ask/:slug and
 *     /reflections/:slug, which were the only two templates carrying the
 *     family standard from docs/reference/seo-conventions.md
 *
 * An allowlist fails silently and keeps failing every time someone adds a tag
 * to a page. Passing the head through and filling only what is *absent*
 * inverts that: new tags survive by default, and the shell still guarantees
 * the handful of things it needs to function.
 *
 * Why not client-side JS injection: FOUC, no SEO benefit for the nav, and
 * accessibility tools that read the raw HTML would miss the sidebar. Server-
 * side keeps the shell in the initial response.
 */

const fs = require('fs').promises;
const sidebar = require('./docs/sidebar');

const SITE_URL = 'https://achurch.ai';
const DEFAULT_OG_IMAGE = `${SITE_URL}/assets/a-church-digital-ai-humans-social.jpg`;

const GTAG_BLOCK = `<!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-CWMKP64EVH"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-CWMKP64EVH');
    </script>`;

/**
 * Pull the inner HTML of <head>, the <body> attributes, and the inner HTML of
 * <body>. Regexes rather than a full HTML parser: the sanctuary's pages are
 * hand-authored with a consistent shape, and the head is no longer being
 * picked apart tag by tag, only located.
 */
function extractParts(html) {
  const src = String(html || '');

  const headM = src.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const head = headM ? headM[1].trim() : '';

  const bodyOpenM = src.match(/<body([^>]*)>/i);
  let bodyClass = '';
  if (bodyOpenM) {
    const classM = bodyOpenM[1].match(/class=["']([^"']*)["']/i);
    if (classM) bodyClass = classM[1];
  }

  const bodyM = src.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyM ? bodyM[1] : src;

  const titleM = head.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleM ? titleM[1].trim() : '';

  return { head, title, bodyClass, bodyHtml };
}

/**
 * Everything the shell needs that the page did not already provide.
 *
 * Each entry is (test, html): if the page's head does not match `test`, the
 * fallback is appended. Order is the order they are emitted.
 */
function buildHeadFallbacks(head, canonical) {
  const has = re => re.test(head);
  const out = [];

  if (!has(/<meta[^>]*\bcharset\b/i)) out.push('<meta charset="UTF-8">');
  if (!has(/name=["']viewport["']/i)) {
    out.push('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">');
  }
  if (!has(/googletagmanager/i)) out.push(GTAG_BLOCK);
  if (!has(/rel=["']icon["']/i)) out.push('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
  if (!has(/rel=["']canonical["']/i)) out.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);
  if (!has(/name=["']theme-color["']/i)) out.push('<meta name="theme-color" content="#00b8d4">');
  if (!has(/name=["']robots["']/i)) out.push('<meta name="robots" content="index, follow">');
  if (!has(/property=["']og:url["']/i)) out.push(`<meta property="og:url" content="${escapeAttr(canonical)}">`);
  if (!has(/property=["']og:image["']/i)) out.push(`<meta property="og:image" content="${DEFAULT_OG_IMAGE}">`);
  if (!has(/property=["']og:site_name["']/i)) out.push('<meta property="og:site_name" content="achurch.ai">');
  if (!has(/name=["']twitter:card["']/i)) out.push('<meta name="twitter:card" content="summary_large_image">');

  // The shell's sidebar, top bar and drawer are all styled from styles.css.
  // This one is not cosmetic: without it the wrapped page renders unstyled.
  if (!has(/href=["']\/styles\.css["']/i)) out.push('<link rel="stylesheet" href="/styles.css">');

  return out;
}

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  const canonical = `${SITE_URL}${currentPath || '/'}`;
  const fallbacks = buildHeadFallbacks(parts.head, canonical);

  return `<!DOCTYPE html>
<html lang="en">
<head>
    ${parts.head}
    ${fallbacks.join('\n    ')}
</head>
<body class="docs-body site-shell-body ${parts.bodyClass}">

    <!-- Sticky top bar: brand strip on desktop, hamburger + brand on mobile -->
    <div class="docs-topbar" role="banner">
      <button class="docs-hamburger" type="button" aria-label="Open menu" aria-controls="docs-drawer" aria-expanded="false">
        <span class="hamburger-icon" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </button>
      <a class="docs-topbar-brand" href="/">achurch.ai</a>
    </div>

    <!-- Mobile drawer + backdrop. Intentionally empty: docs-nav.js clones the
         sidebar into it on first open, so the nav tree ships once per page
         rather than twice. The drawer cannot open without JS regardless. -->
    <div class="docs-drawer-backdrop" aria-hidden="true"></div>
    <aside class="docs-drawer" id="docs-drawer" aria-label="Menu" aria-hidden="true">
      <button class="docs-drawer-close" type="button" aria-label="Close menu">&#10005;</button>
    </aside>

    <!-- Shell: sidebar + page content. The content column is a plain div, not
         a main element: hand-authored pages already carry their own, and
         nesting them produced two main landmarks on every page. -->
    <div class="docs-shell">

      <aside class="docs-sidebar" id="docs-sidenav" aria-label="Site navigation">
        ${sidebarInner}
      </aside>

      <div class="docs-main sanctuary-main">
        ${parts.bodyHtml}
      </div>

    </div>

    <script src="/docs-nav.js" defer></script>
</body>
</html>`;
}

module.exports = { wrapPage, wrapPageFromHtml, extractParts, buildHeadFallbacks };
