/**
 * Which document a docs URL serves, if any. Shared by the docs route (HTML
 * and markdown pages) and the MCP read_doc tool, so the tool can never serve
 * what the site refuses to.
 *
 * Path traversal is prevented by three independent checks, and the order
 * matters because the first one is weaker than it looks:
 *
 *   1. Each URL segment must match /^[a-z0-9._-]+$/. Note that ".." satisfies
 *      this pattern, since "." is in the class. This check screens out
 *      slashes and encoded separators; it does NOT stop traversal on its own.
 *   2. Lookups resolve against a prebuilt cache of real docs by exact
 *      (lowercased) urlPath, so a traversal segment simply matches nothing.
 *   3. Any resolved file is run through path.resolve and rejected unless it
 *      still lives inside DOCS_DIR.
 *
 * Checks 2 and 3 are what actually hold. Do not remove either on the
 * assumption that the segment regex covers traversal.
 *
 * Internal working categories (plans, issues, ...) are not pages on this site.
 * They remain in the public repository, which is where links to them point.
 * Serving them while declaring them noindex and hiding them from navigation
 * would be the same inconsistency in a third place.
 *
 * Appending .md is how many agents ask for a page's source, so a trailing .md
 * resolves to the same document, marked asMarkdown.
 */

const path = require('path');
const discover = require('./discover');
const { DOCS_DIR } = require('../rag/indexer');

const SEGMENT_RE = /^[a-z0-9._-]+$/;

function validateSegments(parts) {
  return parts.every(p => SEGMENT_RE.test(p));
}

function underDocs(fullPath) {
  const resolved = path.resolve(fullPath);
  const root = path.resolve(DOCS_DIR);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * @param {string} rest  the path after /docs/, e.g. "chants/chant-for-arrival.md"
 * @returns {Promise<null | { kind: 'file'|'dir-index', asMarkdown: boolean, ... }>}
 *   the resolved document (see discover.resolveDocPath), or null when the site
 *   does not serve that path. asMarkdown is true when the path ended in .md,
 *   which asks for the source whatever the Accept header says.
 */
async function resolveServedDoc(rest) {
  if (discover.isNoindexPath(rest)) return null;

  const parts = rest ? rest.split('/').filter(Boolean) : [];
  const last = parts[parts.length - 1] || '';
  const asMarkdown = /\.md$/i.test(last);
  if (asMarkdown) parts[parts.length - 1] = last.replace(/\.md$/i, '');

  // Lowercase the segments before lookup (repo docs are all lowercase; this
  // handles browsers that uppercase or query-mangle without silently 404ing).
  const lowered = parts.map(p => p.toLowerCase());
  if (!validateSegments(lowered)) return null;

  const resolved = await discover.resolveDocPath(lowered);
  if (!resolved) return null;
  if (resolved.kind === 'file' && !underDocs(resolved.fullPath)) return null;

  return { ...resolved, asMarkdown };
}

module.exports = { resolveServedDoc };
