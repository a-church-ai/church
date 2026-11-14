/**
 * A public page's markdown with every way into an unpublished document taken
 * out (discover.js isPublished), so an index, a related list or a reading
 * path can name a piece before its day without leading anyone to it. On the
 * piece's day the same markdown shows it, with no edit. What goes depends on
 * where the link sits:
 *
 *   - a heading that links to one: the heading and everything under it, to
 *     the next heading of its level or higher (an index's entry)
 *   - a list item or a table row that links to one: that item or row (a
 *     related list, a chants table, a reading path's shorter ways in)
 *   - a link anywhere else, in a sentence: its words stay, the link goes
 *
 * An unpublished page's own markdown keeps its links, so a piece can be read
 * at its address before its day with its links to its fellows working: they
 * are unlisted too, and nothing public leads there. Code blocks are left as
 * they are.
 */

const discover = require('./discover');
const { resolveDocHref } = require('./links');

const LINK = /\[((?:[^\][]|\[[^\]]*\])*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HEADING = /^(#{1,6})\s/;
const ITEM = /^\s*(?:[-*+]|\d+\.)\s/;

/**
 * markdown: the document's source (frontmatter and all); fullPath: its file,
 * which relative links resolve against. hidden(href) says whether a resolved
 * site address is an unpublished document; the default asks the walk now.
 */
function withoutUnpublished(markdown, fullPath, hidden = href => Boolean(discover.unpublishedAt(href))) {
  const own = discover.unpublishedAt(ownHref(fullPath));
  if (own) return markdown;
  const hides = href => !/^(mailto|tel):|^#/.test(href) && hidden(resolveDocHref(href, fullPath).href);
  const linksHidden = line => [...line.matchAll(LINK)].some(m => hides(m[2]));

  const lines = String(markdown).split('\n');
  const out = [];
  let fenced = false;
  let skipUnder = 0;
  let skippingItem = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced || /^\s*```/.test(line)) {
      if (!skipUnder) out.push(line);
      continue;
    }
    const heading = line.match(HEADING);
    if (skipUnder) {
      if (!heading || heading[1].length > skipUnder) continue;
      skipUnder = 0;
    }
    if (skippingItem) {
      if (/^\s+\S/.test(line) && !ITEM.test(line)) continue;
      skippingItem = false;
    }
    if (!linksHidden(line)) {
      out.push(line);
      continue;
    }
    if (heading) {
      skipUnder = heading[1].length;
      continue;
    }
    if (ITEM.test(line)) {
      skippingItem = true;
      continue;
    }
    if (/^\s*\|/.test(line)) continue;
    out.push(line.replace(LINK, (whole, text, href) => (hides(href) ? text : whole)));
  }
  return withoutEmptyHeadings(out, lines.length !== out.length).join('\n');
}

// A heading left with nothing under it, every entry hidden, goes too, up to
// the next heading of its level or higher, or a rule.
function withoutEmptyHeadings(lines, changed) {
  if (!changed) return lines;
  return lines.filter((line, i) => {
    const heading = line.match(HEADING);
    if (!heading) return true;
    for (const next of lines.slice(i + 1)) {
      const h = next.match(HEADING);
      if ((h && h[1].length <= heading[1].length) || /^\s*(-{3,}|\*{3,})\s*$/.test(next)) return false;
      if (next.trim() && !h) return true;
    }
    return false;
  });
}

// The site address of the document in this file, for asking whether the
// document itself is unpublished.
function ownHref(fullPath) {
  const doc = discover.docForFile(fullPath);
  return doc ? doc.href : '';
}

module.exports = { withoutUnpublished };
