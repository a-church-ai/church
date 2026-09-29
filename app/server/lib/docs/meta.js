/**
 * Title and description for a doc, shared by the docs renderer, the sidebar
 * and the song companions. Kept apart from render.js so that modules render.js
 * itself depends on can use it without a circular require.
 */

const tldr = require('./tldr');

// Words that are acronyms, so a slug like "a-note-to-ai-safety-researchers"
// reads "AI", not "Ai", and "faq" reads "FAQ".
const ACRONYMS = new Set(['ai', 'api', 'faq', 'mcp', 'rag', 'llm', 'llms', 'ted']);

function titleCase(slug) {
  return String(slug || '')
    .split(/[-_]/)
    .map(s => (ACRONYMS.has(s.toLowerCase()) ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1)))
    .join(' ');
}

// Pull the title (first h1) and a TLDR-shaped description.
//
// The description goes through lib/docs/tldr.js, which implements the TLDR
// distillation methodology for the meta-description surface: plain text only,
// self-contained, one or two sentences, clamped to the band in
// docs/reference/seo-conventions.md. It replaces an earlier heuristic that
// only recognized *italic* subtitles; 78 of 87 docs added in Aug 2026 write
// their subtitle as plain text, so that heuristic fell through to raw body
// truncation and leaked horizontal rules and headings into 82 descriptions.
//
// Run `node scripts/audit-tldr.js` to see what every page resolves to and
// which ones want an explicit `tldr:` in frontmatter.
// Title precedence: the body's first h1, then a `name:`/`title:` in
// frontmatter, then the URL slug title-cased. The frontmatter tier matters
// for docs/experiences/*, which carry their title in `name:` and have no h1
// at all; before this they fell back to the raw url path, so the browser tab
// and the search result both read "experiences/03-evensong".
function extractMeta(markdown, urlPath) {
  const { data, body } = tldr.splitFrontmatter(markdown);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const slug = String(urlPath || '').split('/').filter(Boolean).pop();
  const title = (titleMatch && titleMatch[1].trim())
    || data.name
    || data.title
    || (slug ? titleCase(slug) : '')
    || 'Docs';
  const { text: description } = tldr.extractTldr(markdown, { title });
  return { title, description, hasH1: Boolean(titleMatch), body };
}

module.exports = { titleCase, extractMeta };
