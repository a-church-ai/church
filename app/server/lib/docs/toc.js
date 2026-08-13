/**
 * Right-rail table of contents.
 *
 * Extracts H2 headings from the rendered doc HTML (renderer emits `id`
 * attributes on every heading; see render.js `renderer.heading`), then
 * emits the rail HTML if there are enough headings to justify it.
 *
 * H2 only. H3+ nesting on a right rail gets visually noisy fast; users who
 * need finer-grained nav can Cmd+F. Threshold: 3 headings. Below that the
 * rail is noise; a single-section doc doesn't need a rail at all.
 */

const { escapeAttr, escapeText } = require('../utils/page-meta');

const MIN_HEADINGS_FOR_RAIL = 3;

// Match <h2 id="foo">inner</h2> and pull out id + text. inner may contain
// nested tags (e.g. inline code from a heading); we strip those for the
// TOC link label so it reads cleanly.
const H2_RE = /<h2\s+id="([^"]+)">([\s\S]*?)<\/h2>/gi;

function stripInlineTags(html) {
  return String(html).replace(/<[^>]+>/g, '').trim();
}

function extractH2s(bodyHtml) {
  const items = [];
  let m;
  H2_RE.lastIndex = 0;
  while ((m = H2_RE.exec(bodyHtml)) !== null) {
    const id = m[1];
    const text = stripInlineTags(m[2]);
    if (id && text) items.push({ id, text });
  }
  return items;
}

/**
 * Render the right-rail TOC. Returns an empty string when the doc has fewer
 * than MIN_HEADINGS_FOR_RAIL h2s so the shell can omit the column entirely.
 */
function renderToc(bodyHtml) {
  const items = extractH2s(bodyHtml);
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

module.exports = { renderToc, extractH2s, MIN_HEADINGS_FOR_RAIL };
