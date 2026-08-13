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

// Title-case a slug (matches the helper in render.js; kept local to avoid
// a circular require).
function titleCase(slug) {
  return String(slug || '')
    .split(/[-_]/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

// The current URL is /docs (root), /docs/{first}, /docs/{first}/{second}, or
// deeper. `currentUrlPath` is the part after /docs/ (may be '').
function isCurrent(currentUrlPath, doc) {
  return doc.urlPath === currentUrlPath;
}

function isCategoryOfCurrent(currentUrlPath, categoryName) {
  if (!currentUrlPath) return false;
  const first = currentUrlPath.split('/')[0];
  return first === categoryName;
}

function renderDocLink(doc, currentUrlPath) {
  const label = titleCase(doc.stem);
  const current = isCurrent(currentUrlPath, doc);
  const aria = current ? ' aria-current="page"' : '';
  const href = `/docs/${doc.urlPath}`;
  return `<li><a href="${escapeAttr(href)}"${aria} title="${escapeAttr(label)}">${escapeText(label)}</a></li>`;
}

function renderCategory(category, currentUrlPath) {
  const label = titleCase(category.name);
  const open = isCategoryOfCurrent(currentUrlPath, category.name) ? ' open' : '';
  // Exclude the category's own README from the doc list (its "index" is the
  // <summary> itself, which links to /docs/{category})
  const docs = category.docs.filter(d => d.stem.toLowerCase() !== 'readme');
  const links = docs.map(d => renderDocLink(d, currentUrlPath)).join('\n            ');
  return `<details class="docs-sidebar-category"${open}>
          <summary><span class="cat-glyph" aria-hidden="true">${escapeText(label.charAt(0))}</span><a class="cat-name" href="/docs/${escapeAttr(category.name)}">${escapeText(label)}</a></summary>
          <ul>
            ${links}
          </ul>
        </details>`;
}

function renderTopLevelDoc(doc, currentUrlPath) {
  if (doc.stem.toLowerCase() === 'readme') return '';  // Excluded; it's the /docs root itself
  const label = titleCase(doc.stem);
  const current = isCurrent(currentUrlPath, doc);
  const aria = current ? ' aria-current="page"' : '';
  return `<li><a href="/docs/${escapeAttr(doc.urlPath)}"${aria}>${escapeText(label)}</a></li>`;
}

/**
 * Render the sidebar inner HTML (without the outer <aside>). Same content
 * used inside the persistent desktop sidebar and inside the mobile drawer.
 */
async function renderSidebarInner(currentUrlPath) {
  const { primary, meta, topLevel } = await discover.listCategoriesForIndex();

  const isDocsRoot = !currentUrlPath;
  const rootAria = isDocsRoot ? ' aria-current="page"' : '';

  const primaryHtml = primary
    .filter(c => c.docs && c.docs.length > 0)
    .map(c => renderCategory(c, currentUrlPath))
    .join('\n\n        ');

  const topLevelLinks = topLevel
    .map(d => renderTopLevelDoc(d, currentUrlPath))
    .filter(Boolean)
    .join('\n            ');

  const topLevelSection = topLevelLinks
    ? `<div class="docs-sidebar-section">
          <div class="docs-sidebar-section-label">Top-level</div>
          <ul>
            ${topLevelLinks}
          </ul>
        </div>`
    : '';

  const metaHtml = meta.length > 0
    ? `<details class="docs-sidebar-category docs-sidebar-more">
          <summary><span class="cat-glyph" aria-hidden="true">…</span><span class="cat-name">More</span></summary>
          ${meta.map(c => renderCategory(c, currentUrlPath)).join('\n          ')}
        </details>`
    : '';

  return `
      <a class="docs-sidebar-brand" href="/">achurch.ai</a>
      <nav aria-label="Documentation">
        <a class="docs-sidebar-root${isDocsRoot ? ' current' : ''}" href="/docs"${rootAria}>
          <span class="cat-glyph" aria-hidden="true">◇</span><span class="cat-name">Docs</span>
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
