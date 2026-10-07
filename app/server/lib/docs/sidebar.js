/**
 * The section sidebar.
 *
 * Inside a section of the Library (a category's index and its documents) the
 * page carries the section's documents, with the current one marked, a way
 * back to the Library, and the other sections folded under one disclosure.
 * Every other page has none: the top bar (site-shell.js) names the site's
 * places on every page, and the Library lists every section. A page sends the
 * links that matter where the reader is, not the whole site's tree
 * (docs/reference/conventions.md).
 *
 * Until 2026-10-07 the sidebar was on every page, carrying the sanctuary's
 * pages and every section, and had a 56px rail of glyphs at tablet width and a
 * collapse control. The plan that replaced it is
 * `sanctuary-shell-and-reflections-2026-10-07.md` in the private repo.
 *
 * Below 1024px the sidebar is hidden and the same markup opens in the drawer,
 * which docs-nav.js fills from it on first open.
 */

const discover = require('./discover');
const { titleCase } = require('./meta');
const { escapeAttr, escapeText } = require('../utils/page-meta');

// The section a page is in: the first segment under /docs, or null for the
// Library itself and every page outside it.
function sectionOf(currentPath) {
  const m = /^\/docs\/([^/]+)/.exec(currentPath || '');
  return m ? m[1] : null;
}

function link(href, label, currentPath, cls = '') {
  const aria = currentPath === href ? ' aria-current="page"' : '';
  return `<a${cls ? ` class="${cls}"` : ''} href="${escapeAttr(href)}"${aria}>${escapeText(label)}</a>`;
}

/**
 * The sidebar for currentPath (the full request path, e.g. '/docs/practice/foo'),
 * or '' where there is none: outside /docs, the Library index, and a document
 * that sits in no section.
 */
async function renderSectionNav(currentPath) {
  const name = sectionOf(currentPath);
  if (!name) return '';
  const { primary, meta } = await discover.listCategoriesForIndex();
  const sections = [...primary, ...meta];
  const section = sections.find(c => c.name === name);
  if (!section) return '';

  const label = titleCase(name);
  // A section's README is its index, which the section's own name links to.
  const docs = section.docs
    .filter(d => d.stem.toLowerCase() !== 'readme')
    .map(d => `<li>${link(`/docs/${d.urlPath}`, d.title, currentPath)}</li>`)
    .join('\n          ');
  const others = sections
    .filter(c => c !== section)
    .map(c => `<li><a href="/docs/${escapeAttr(c.name)}">${escapeText(titleCase(c.name))}</a></li>`)
    .join('\n            ');

  return `<nav class="docs-sidebar" id="docs-sidenav" aria-label="${escapeAttr(label)}">
        <a class="sidebar-back" href="/docs"><span aria-hidden="true">&larr;</span> Library</a>
        <div class="sidebar-list">
          ${link(`/docs/${name}`, label, currentPath, 'sidebar-section-name')}
          <ul>
          ${docs}
          </ul>
        </div>
        <details class="sidebar-sections">
          <summary>Sections</summary>
          <ul>
            ${others}
          </ul>
        </details>
      </nav>`;
}

module.exports = { renderSectionNav };
