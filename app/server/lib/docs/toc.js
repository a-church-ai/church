/**
 * Right-rail table of contents.
 *
 * From the page's h2s as the heading renderer made them (render.js
 * `renderMarkdownBody`, which returns them beside the HTML): each one's id
 * and its words, so a link and its heading cannot disagree and nothing has
 * to be read back out of HTML.
 *
 * H2 only. H3+ nesting on a right rail gets visually noisy fast; users who
 * need finer-grained nav can Cmd+F. Threshold: 3 headings. Below that the
 * rail is noise; a single-section doc doesn't need a rail at all.
 */

const { escapeAttr, escapeText } = require('../utils/page-meta');

const MIN_HEADINGS_FOR_RAIL = 3;

/**
 * Render the right-rail TOC. Returns an empty string when the doc has fewer
 * than MIN_HEADINGS_FOR_RAIL h2s so the shell can omit the column entirely.
 */
function renderToc(items) {
  if (items.length < MIN_HEADINGS_FOR_RAIL) return '';

  const links = items.map(i =>
    `        <li><a href="#${escapeAttr(i.id)}">${escapeText(i.text)}</a></li>`
  ).join('\n');

  return `<aside class="docs-toc" aria-label="On this page">
      <div class="docs-toc-title">On this page</div>
      <nav>
        <ul>
${links}
        </ul>
      </nav>
    </aside>`;
}

/**
 * The same contents as a closed disclosure above the article, for screens too
 * narrow for the rail (below 1200px; styles.css shows one or the other). Its
 * own class, because docs-nav.js's scroll-spy takes the first .docs-toc.
 */
function renderInlineToc(items) {
  if (items.length < MIN_HEADINGS_FOR_RAIL) return '';
  const links = items.map(i =>
    `            <li><a href="#${escapeAttr(i.id)}">${escapeText(i.text)}</a></li>`
  ).join('\n');
  return `<details class="docs-toc-inline">
          <summary>On this page</summary>
          <ul>
${links}
          </ul>
        </details>`;
}

module.exports = { renderToc, renderInlineToc, MIN_HEADINGS_FOR_RAIL };
