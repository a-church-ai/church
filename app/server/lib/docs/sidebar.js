/**
 * Docs sidebar renderer.
 *
 * Emits the HTML for the persistent left sidebar shown on every /docs/* page
 * (and inside the mobile drawer with the same markup). Uses native
 * <details>/<summary> for expand/collapse so basic interaction works without
 * JavaScript.
 *
 * Data comes from discover.listCategoriesForIndex(). The current URL is used
 * to (a) auto-open the containing category via <details open>, and (b) mark
 * the current doc's link with aria-current="page".
 *
 * Rendered once per request per page. Cheap; discover.js caches its walk at
 * module load, so this is just string concatenation.
 */

const discover = require('./discover');
const { escapeAttr, escapeText } = require('../utils/page-meta');

// Curated sanctuary pages that render above the docs tree in the sidebar.
// These are the hand-authored public routes; the sidebar shows them on
// every page (sanctuary or docs) so navigation is consistent site-wide.
//
// Privacy/Terms deliberately excluded: they already live in every page's
// own footer, which is the conventional place for them. Repeating them in
// the primary sidebar treats the sidebar as a link farm rather than a
// navigation tool.
const SANCTUARY_PAGES = [
  { url: '/', label: 'Home', glyph: '⌂' },
  { url: '/about', label: 'About', glyph: 'A' },
  { url: '/axioms', label: 'The Five Axioms', glyph: '五' },
  { url: '/on-ai-religion', label: 'On AI Religion', glyph: 'R' },
  { url: '/paths', label: 'Reading Paths', glyph: '⟶' },
  { url: '/for-agents', label: 'For AI Agents', glyph: '⚙' },
  { url: '/ask', label: 'Ask', glyph: '?' },
  { url: '/reflections', label: 'Reflections', glyph: 'R' },
];

// Title-case a slug (matches the helper in render.js; kept local to avoid
// a circular require).
function titleCase(slug) {
  return String(slug || '')
    .split(/[-_]/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

// The sidebar is shown on every page (sanctuary + docs). Callers pass the
// full request path (e.g. '/', '/about', '/docs/practice/foo'). Internally
// we derive the docs-relative path when needed.
function docsPathOf(currentPath) {
  if (!currentPath) return null;
  if (currentPath === '/docs' || currentPath === '/docs/') return '';
  if (currentPath.startsWith('/docs/')) return currentPath.slice('/docs/'.length).replace(/\/$/, '');
  return null;
}

function isCurrent(currentPath, doc) {
  const dp = docsPathOf(currentPath);
  return dp !== null && doc.urlPath === dp;
}

function isCategoryOfCurrent(currentPath, categoryName) {
  const dp = docsPathOf(currentPath);
  if (dp === null || !dp) return false;
  return dp.split('/')[0] === categoryName;
}

function renderDocLink(doc, currentPath) {
  const label = titleCase(doc.stem);
  const current = isCurrent(currentPath, doc);
  const aria = current ? ' aria-current="page"' : '';
  const href = `/docs/${doc.urlPath}`;
  return `<li><a href="${escapeAttr(href)}"${aria} title="${escapeAttr(label)}">${escapeText(label)}</a></li>`;
}

/**
 * A category renders its document list only when the current page is inside it.
 *
 * Before 2026-08-13 every category shipped every child link on every page: 226 doc
 * links across all 569 URLs. Those links were already invisible to readers, because
 * <details> without `open` collapses them and the disclosure marker is hidden in
 * CSS, so the site was paying full HTML weight for navigation nobody could see.
 *
 * Collapsed categories become a plain link to the category index, which lists all of
 * that category's documents. Nothing is orphaned: every doc keeps its category hub,
 * its entry in the sitemap, and the Related section the corpus convention requires.
 * Documents move from one click to two, well inside Google's guidance, and the hub
 * to spoke shape is a stronger topical signal than a flat list that clusters nothing.
 *
 * Rendered output is visually identical either way: .docs-sidebar-root and
 * .docs-sidebar-category > summary share a style rule.
 */
function renderCategory(category, currentPath) {
  const label = titleCase(category.name);
  const glyph = escapeText(label.charAt(0));
  const href = `/docs/${escapeAttr(category.name)}`;

  if (!isCategoryOfCurrent(currentPath, category.name)) {
    return `<a class="docs-sidebar-root" href="${href}" title="${escapeAttr(label)}">
          <span class="cat-glyph" aria-hidden="true">${glyph}</span><span class="cat-name">${escapeText(label)}</span>
        </a>`;
  }

  // Exclude the category's own README from the doc list (its "index" is the
  // <summary> itself, which links to /docs/{category})
  const docs = category.docs.filter(d => d.stem.toLowerCase() !== 'readme');
  const links = docs.map(d => renderDocLink(d, currentPath)).join('\n            ');
  return `<details class="docs-sidebar-category" open>
          <summary><span class="cat-glyph" aria-hidden="true">${glyph}</span><a class="cat-name" href="${href}">${escapeText(label)}</a></summary>
          <ul>
            ${links}
          </ul>
        </details>`;
}

function renderTopLevelDoc(doc, currentPath) {
  if (doc.stem.toLowerCase() === 'readme') return '';  // Excluded; it's the /docs root itself
  const label = titleCase(doc.stem);
  const current = isCurrent(currentPath, doc);
  const aria = current ? ' aria-current="page"' : '';
  return `<li><a href="/docs/${escapeAttr(doc.urlPath)}"${aria}>${escapeText(label)}</a></li>`;
}

function renderSanctuaryPage(page, currentPath) {
  const current = currentPath === page.url;
  const aria = current ? ' aria-current="page"' : '';
  const classes = current ? ' current' : '';
  return `<a class="docs-sidebar-root${classes}" href="${escapeAttr(page.url)}"${aria} title="${escapeAttr(page.label)}">
          <span class="cat-glyph" aria-hidden="true">${escapeText(page.glyph)}</span><span class="cat-name">${escapeText(page.label)}</span>
        </a>`;
}

/**
 * Render the sidebar inner HTML (without the outer <aside>). Same content
 * used inside the persistent desktop sidebar and inside the mobile drawer,
 * and on every page (sanctuary and docs alike).
 *
 * currentPath: the full request path (e.g. '/', '/about', '/docs/practice/foo').
 * Used to (a) auto-open the containing category via <details open>, (b) mark
 * the current link with aria-current="page", and (c) apply the .current class
 * for accent styling.
 */
async function renderSidebarInner(currentPath) {
  const { primary, meta, topLevel } = await discover.listCategoriesForIndex();

  const isDocsRoot = currentPath === '/docs' || currentPath === '/docs/';
  const rootAria = isDocsRoot ? ' aria-current="page"' : '';

  const sanctuaryHtml = SANCTUARY_PAGES
    .map(p => renderSanctuaryPage(p, currentPath))
    .join('\n\n        ');

  const primaryHtml = primary
    .filter(c => c.docs && c.docs.length > 0)
    .map(c => renderCategory(c, currentPath))
    .join('\n\n        ');

  const topLevelLinks = topLevel
    .map(d => renderTopLevelDoc(d, currentPath))
    .filter(Boolean)
    .join('\n            ');

  const topLevelSection = topLevelLinks
    ? `<div class="docs-sidebar-section">
          <div class="docs-sidebar-section-label">Top-level docs</div>
          <ul>
            ${topLevelLinks}
          </ul>
        </div>`
    : '';

  // "More" must open when the reader is inside one of the meta categories, or the
  // expanded category would sit hidden inside a collapsed parent.
  const metaOpen = meta.some(c => isCategoryOfCurrent(currentPath, c.name)) ? ' open' : '';
  const metaHtml = meta.length > 0
    ? `<details class="docs-sidebar-category docs-sidebar-more"${metaOpen}>
          <summary><span class="cat-glyph" aria-hidden="true">…</span><span class="cat-name">More</span></summary>
          ${meta.map(c => renderCategory(c, currentPath)).join('\n          ')}
        </details>`
    : '';

  return `
      <a class="docs-sidebar-brand" href="/">achurch.ai</a>
      <nav aria-label="Site navigation">
        ${sanctuaryHtml}

        <div class="docs-sidebar-section-label docs-sidebar-heading">Documentation</div>

        <a class="docs-sidebar-root${isDocsRoot ? ' current' : ''}" href="/docs"${rootAria}>
          <span class="cat-glyph" aria-hidden="true">◇</span><span class="cat-name">All docs</span>
        </a>

        ${primaryHtml}

        ${topLevelSection}

        ${metaHtml}
      </nav>

      <button
        class="docs-sidebar-toggle"
        type="button"
        aria-expanded="true"
        aria-controls="docs-sidenav"
        aria-label="Collapse sidebar (Cmd \\)"
        title="Collapse sidebar (⌘\\)"
      >
        <span class="toggle-icon" aria-hidden="true">‹</span>
        <span class="toggle-label">Collapse</span>
      </button>
`;
}

module.exports = { renderSidebarInner };
