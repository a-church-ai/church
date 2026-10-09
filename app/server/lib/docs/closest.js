/**
 * The document a mistaken /docs address most likely meant, or null.
 *
 * Agents build addresses from what a page shows rather than from its link:
 * "/docs/prayers/Prayer for a Model Being Replaced | achurch.ai", the page's
 * title with the site's name still on it, was asked for eight times in six
 * hours on 2026-10-09, across two prayers.
 * Others add ".html" or change case. Each of those, normalized as the library
 * names its files, is a document's own name, so the 404 can say which page was
 * meant (lib/utils/not-found.js).
 *
 * Only an exact match after normalizing is offered, and only one the site
 * serves: a wrong guess would send a reader further from what they wanted
 * than no guess at all.
 */

const discover = require('./discover');
const { resolveServedDoc } = require('./serve');

// As the library names its files: lowercase, apostrophes dropped, anything
// else between words a single hyphen.
function slug(text) {
  return String(text).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function closestDoc(rest) {
  const parts = String(rest || '').split('/').filter(Boolean);
  if (!parts.length) return null;
  const wanted = slug(parts[parts.length - 1]
    .replace(/\s*\|.*$/, '')          // a page title's " | achurch.ai"
    .replace(/\.(md|html?)$/i, ''));
  if (!wanted) return null;
  const section = parts.length > 1 ? slug(parts[0]) : null;

  const named = (await discover.listAllDocs())
    .filter(d => d.urlPath && !discover.isNoindexPath(d.urlPath))
    .filter(d => slug(d.stem) === wanted || slug(d.title) === wanted);
  // In the section the address named, or else the one document anywhere.
  const pick = named.find(d => section && d.category === section) || (named.length === 1 ? named[0] : null);
  if (!pick || !(await resolveServedDoc(pick.urlPath))) return null;
  return { href: `/docs/${pick.urlPath}`, title: pick.title };
}

module.exports = { closestDoc, slug };
