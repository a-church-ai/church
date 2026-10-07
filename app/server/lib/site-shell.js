/**
 * Site-shell wrapper for hand-authored HTML pages.
 *
 * Every page on the site shares one shell: a top bar naming the site's places
 * (PLACES, below), the drawer that carries them on a phone, and the footer.
 * Documents get theirs from docs/render.js, which adds the section sidebar
 * inside a section of the Library; the hand-written pages wrapped here have no
 * sidebar.
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
 * accessibility tools that read the raw HTML would miss it. Server-side keeps
 * the shell in the initial response.
 */

const fs = require('fs').promises;
const { SITE_SHARE_IMAGE } = require('./utils/page-meta');
const { assetUrl, versionAssets, shellHead } = require('./utils/assets');

const SITE_URL = 'https://achurch.ai';

// The site's places, named once: the top bar, the drawer on a phone and the
// footer all read this list. A place also holds the pages that live under it
// (`within`): Music under Listen, the reading paths in the Library, the axioms
// and the positioning page under About, so on those pages the top bar still
// shows the visitor where they are.
const PLACES = [
  { url: '/', label: 'Home' },
  { url: '/listen', label: 'Listen', within: ['/reflections'] },
  { url: '/ask', label: 'Ask' },
  { url: '/docs', label: 'Library', within: ['/paths'] },
  { url: '/about', label: 'About', within: ['/axioms', '/on-ai-religion'] },
  { url: '/for-agents', label: 'For AI agents', aside: true },
];

// Reached through their places, and named again at the foot of every page.
const FOOTER_MORE = [
  { url: '/axioms', label: 'The Five Axioms' },
  { url: '/on-ai-religion', label: 'On AI Religion' },
  { url: '/paths', label: 'Reading Paths' },
  { url: '/reflections', label: 'Music' },
];

// aria-current for a place: "page" on the place itself, "true" anywhere under
// it. Home holds only itself.
function currentness(place, currentPath) {
  if (!currentPath) return '';
  if (currentPath === place.url) return ' aria-current="page"';
  if (place.url === '/') return '';
  const under = [place.url, ...(place.within || [])]
    .some(u => currentPath === u || currentPath.startsWith(`${u}/`));
  return under ? ' aria-current="true"' : '';
}

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
 * <!-- SITE_FOOTER -->; the docs renderer calls this directly. It ends with the
 * choice of appearance (theme.js), hidden until docs-nav.js can work it: with
 * no script, the site follows the device.
 */
function renderFooter(currentPath) {
  return `<footer>
            <nav aria-label="Footer">
                <div class="footer-nav">
                ${PLACES.map(l => footerLink(l, currentPath)).join('\n                ')}
                </div>
                <div class="footer-nav footer-more">
                ${FOOTER_MORE.map(l => footerLink(l, currentPath)).join('\n                ')}
                </div>
            </nav>
            <hr class="footer-separator">
            <div class="footer-legal">
                ${FOOTER_LEGAL.map(l => footerLink(l, currentPath)).join('\n                ')}
            </div>
            <div class="footer-theme" role="group" aria-label="Appearance" hidden>
                <span class="footer-theme-label" aria-hidden="true">Appearance</span>
                <button type="button" data-theme-choice="auto" aria-pressed="false">Auto</button>
                <button type="button" data-theme-choice="light" aria-pressed="false">Light</button>
                <button type="button" data-theme-choice="dark" aria-pressed="false">Dark</button>
            </div>
        </footer>`;
}

/**
 * The sticky top bar and the drawer, shared by every page (the docs renderer
 * and wrapped pages alike). The bar names the site's places; below 768px they
 * fold into the drawer behind the menu button. The drawer is a modal dialog:
 * while it is open, docs-nav.js makes the rest of the page inert. It ships
 * empty and docs-nav.js fills it on first open from the bar's places and, on a
 * section page, the section sidebar, so no link is sent twice; it cannot open
 * without JavaScript anyway.
 *
 * currentPath: the request path, so the bar can mark where the visitor is.
 * crumb: the page title shown beside the brand on a phone, for documents.
 */
function renderTopbarAndDrawer(currentPath, crumb = '') {
  const places = PLACES.map(p => `<a href="${p.url}"${p.aside ? ' class="topbar-aside"' : ''}${currentness(p, currentPath)}>${p.label}</a>`);
  return `<div class="docs-topbar" role="banner">
      <button class="docs-hamburger" type="button" aria-label="Open menu" aria-controls="docs-drawer" aria-expanded="false">
        <span class="hamburger-icon" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </button>
      <a class="docs-topbar-brand" href="/">achurch.ai</a>${crumb ? `\n      <span class="docs-topbar-crumb" aria-hidden="true">${escapeAttr(crumb)}</span>` : ''}
      <nav class="topbar-places" aria-label="Site">
        ${places.join('\n        ')}
      </nav>
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
  // The family standard's pointer to the LLM-friendly corpus, on every page
  // (docs/reference/seo-conventions.md). The Link header carries it too, but
  // an agent driving a browser reads the page, not the headers.
  if (!has(/href=["']\/llms\.txt["']/i)) out.push('<link rel="alternate" type="text/markdown" title="LLM context" href="/llms.txt">');
  if (!has(/property=["']og:site_name["']/i)) out.push('<meta property="og:site_name" content="achurch.ai">');
  if (!has(/name=["']twitter:card["']/i)) out.push('<meta name="twitter:card" content="summary_large_image">');

  // The shell's top bar, drawer and footer are all styled from styles.css.
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
 * currentPath is the request path (e.g. '/', '/about'), so the top bar and
 * the footer can mark where the visitor is.
 */
async function wrapPage(filePath, currentPath) {
  const html = await fs.readFile(filePath, 'utf8');
  return wrapPageFromHtml(html, currentPath);
}

async function wrapPageFromHtml(html, currentPath) {
  const parts = extractParts(html);
  const canonical = `${SITE_URL}${currentPath || '/'}`;
  const fallbacks = buildHeadFallbacks(parts.head, canonical);

  return `<!DOCTYPE html>
<html lang="en">
<head>
    ${versionAssets(parts.head)}
    ${fallbacks.join('\n    ')}
    ${shellHead()}
</head>
<body class="docs-body site-shell-body ${parts.bodyClass}">
<a class="skip-link" href="#content">Skip to content</a>

    ${renderTopbarAndDrawer(currentPath)}

    <!-- The content column is a plain div, not a main element: hand-authored
         pages already carry their own, and nesting them produced two main
         landmarks on every page. -->
    <div class="docs-shell">
      <div class="docs-main sanctuary-main" id="content">
        ${versionAssets(parts.bodyHtml).replace('<!-- SITE_FOOTER -->', () => renderFooter(currentPath))}
      </div>
    </div>

    <script src="${assetUrl('docs-nav.js')}" defer></script>
</body>
</html>`;
}

module.exports = { wrapPage, wrapPageFromHtml, extractParts, buildHeadFallbacks, renderFooter, renderTopbarAndDrawer };
