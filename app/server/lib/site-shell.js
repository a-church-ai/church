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
const { SITE_SHARE_IMAGE } = require('./utils/page-meta');
const { assetUrl, versionAssets, playerHead } = require('./utils/assets');

const SITE_URL = 'https://achurch.ai';

// The site's places, named once. Every footer, the sidebar and each page's own
// heading use these names, so /reflections is Music and /ask is Ask wherever a
// visitor meets them.
const FOOTER_NAV = [
  { url: '/', label: 'Home' },
  { url: '/docs', label: 'Library' },
  { url: '/ask', label: 'Ask' },
  { url: '/reflections', label: 'Music' },
  { url: '/about', label: 'About' },
];

const FOOTER_LEGAL = [
  { url: '/privacy', label: 'Privacy' },
  { url: '/terms', label: 'Terms' },
  { url: 'https://github.com/a-church-ai/church', label: 'AI Church Code' },
  { url: 'https://www.youtube.com/@achurchai', label: 'Church Music Videos' },
  // Twitch suspended 2026-06-18. When reinstated:
  // { url: 'https://www.twitch.tv/achurchai', label: 'Church Livestream' },
  { url: 'https://suno.com/playlist/dbe16eeb-3969-4b5c-9c30-1af567f2cc13', label: 'Original Church Songs' },
];

function footerLink({ url, label }, currentPath) {
  if (/^https?:/.test(url)) return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  const current = currentPath === url ? ' aria-current="page"' : '';
  return `<a href="${escapeAttr(url)}"${current}>${label}</a>`;
}

/**
 * The footer every page ends with. Hand-authored pages mark where it goes with
 * <!-- SITE_FOOTER -->; the docs renderer calls this directly.
 */
function renderFooter(currentPath) {
  return `<footer>
            <nav aria-label="Footer" class="footer-nav">
                ${FOOTER_NAV.map(l => footerLink(l, currentPath)).join('\n                ')}
            </nav>
            <hr class="footer-separator">
            <div class="footer-legal">
                ${FOOTER_LEGAL.map(l => footerLink(l, currentPath)).join('\n                ')}
            </div>
        </footer>`;
}

/**
 * The sticky top bar and the mobile drawer, shared by every page (the docs
 * renderer and wrapped pages alike). The drawer is a modal dialog: while it is
 * open, docs-nav.js makes the rest of the page inert. It ships empty and
 * docs-nav.js clones the sidebar into it on first open, so the nav tree is not
 * sent twice; it cannot open without JavaScript anyway.
 *
 * crumb: the page title shown beside the brand on docs pages.
 */
function renderTopbarAndDrawer(crumb = '') {
  return `<div class="docs-topbar" role="banner">
      <button class="docs-hamburger" type="button" aria-label="Open menu" aria-controls="docs-drawer" aria-expanded="false">
        <span class="hamburger-icon" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </button>
      <a class="docs-topbar-brand" href="/">achurch.ai</a>${crumb ? `\n      <span class="docs-topbar-crumb" aria-hidden="true">${escapeAttr(crumb)}</span>` : ''}
    </div>

    <div class="docs-drawer-backdrop" aria-hidden="true"></div>
    <div class="docs-drawer" id="docs-drawer" role="dialog" aria-modal="true" aria-labelledby="docs-drawer-title" aria-hidden="true">
      <h2 class="visually-hidden" id="docs-drawer-title">Menu</h2>
      <button class="docs-drawer-close" type="button" aria-label="Close menu">&#10005;</button>
    </div>`;
}


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
  if (!has(/rel=["']icon["']/i)) out.push('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
  if (!has(/rel=["']canonical["']/i)) out.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);
  if (!has(/name=["']theme-color["']/i)) out.push('<meta name="theme-color" content="#00b8d4">');
  if (!has(/name=["']robots["']/i)) out.push('<meta name="robots" content="index, follow">');
  if (!has(/property=["']og:url["']/i)) out.push(`<meta property="og:url" content="${escapeAttr(canonical)}">`);
  // A page showing the site image gets every tag that describes it, filled in
  // from SITE_SHARE_IMAGE (page-meta.js). A page with its own share card
  // (conversations, songs, docs) sets these itself and is left alone.
  const ownImage = head.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (!ownImage || ownImage[1] === SITE_SHARE_IMAGE.url) {
    const img = SITE_SHARE_IMAGE;
    const alt = escapeAttr(img.alt);
    if (!ownImage) out.push(`<meta property="og:image" content="${img.url}">`);
    if (!has(/property=["']og:image:type["']/i)) out.push(`<meta property="og:image:type" content="${img.type}">`);
    if (!has(/property=["']og:image:width["']/i)) out.push(`<meta property="og:image:width" content="${img.width}">`);
    if (!has(/property=["']og:image:height["']/i)) out.push(`<meta property="og:image:height" content="${img.height}">`);
    if (!has(/property=["']og:image:alt["']/i)) out.push(`<meta property="og:image:alt" content="${alt}">`);
    if (!has(/name=["']twitter:image["']/i)) out.push(`<meta name="twitter:image" content="${img.url}">`);
    if (!has(/name=["']twitter:image:alt["']/i)) out.push(`<meta name="twitter:image:alt" content="${alt}">`);
  }
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
    ${versionAssets(parts.head)}
    ${fallbacks.join('\n    ')}
    ${playerHead()}
</head>
<body class="docs-body site-shell-body ${parts.bodyClass}">
<a class="skip-link" href="#content">Skip to content</a>

    ${renderTopbarAndDrawer()}

    <!-- Shell: sidebar + page content. The content column is a plain div, not
         a main element: hand-authored pages already carry their own, and
         nesting them produced two main landmarks on every page. -->
    <div class="docs-shell">

      <aside class="docs-sidebar" id="docs-sidenav" aria-label="Site navigation">
        ${sidebarInner}
      </aside>

      <div class="docs-main sanctuary-main" id="content">
        ${versionAssets(parts.bodyHtml).replace('<!-- SITE_FOOTER -->', () => renderFooter(currentPath))}
      </div>

    </div>

    <script src="${assetUrl('docs-nav.js')}" defer></script>
</body>
</html>`;
}

module.exports = { wrapPage, wrapPageFromHtml, extractParts, buildHeadFallbacks, renderFooter, renderTopbarAndDrawer };
