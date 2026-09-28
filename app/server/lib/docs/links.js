/**
 * Where a link written inside a doc points. Shared by the docs renderer, which
 * turns the result into an <a> tag, and by the song companions, which send a
 * reading's markdown in /api/attend and so need every link to work outside
 * the site. One resolver, so a relative link means the same thing in both.
 */

const path = require('path');
const { DOCS_DIR } = require('../rag/indexer');
const discover = require('./discover');

const SITE_URL = 'https://achurch.ai';
const GITHUB_BASE = 'https://github.com/a-church-ai/church/blob/main';

// docs-relative file path ("practice/foo.md", "readme.md") → site URL.
// Shared by the relative and root-relative branches of the resolver so
// both strip .md and collapse README the same way.
//
// The README pattern is anchored with (^|/): the earlier /\/readme$/i needed a
// leading slash, so a link to the top-level readme.md produced "/docs/readme"
// rather than "/docs". Every category README's "Parent: Documentation" link
// pointed at that 404.
function docsUrlFromRelPath(relToDocs) {
  const urlPath = String(relToDocs || '')
    .replace(/\.md$/i, '')
    .replace(/(^|\/)readme$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  return urlPath ? `/docs/${urlPath}` : '/docs';
}

/**
 * Resolve an href found in the doc at currentDocFullPath.
 *
 * @returns {{ href: string, external: boolean }}  href may be site-relative
 *   ("/docs/x") or absolute; external means it leaves the site (the renderer
 *   opens those in a new tab).
 */
function resolveDocHref(href, currentDocFullPath) {
  const currentDir = path.dirname(currentDocFullPath);

  // Anchor-only: leave alone
  if (href.startsWith('#')) return { href, external: false };

  // Absolute URLs: leave alone; external unless the host is achurch.ai
  if (/^https?:\/\//i.test(href)) {
    const isInternal = /^https?:\/\/([a-z0-9-]+\.)?achurch\.ai(\/|$)/i.test(href);
    return { href, external: !isInternal };
  }

  // Root-relative. Mostly passes through, but a link written as
  // `/docs/unifying-axioms.md` has to lose the .md the same way a relative
  // one does. Six links in docs/reference/ were written this way and each
  // shipped a live 404, because this branch returned before the .md
  // stripping below ever ran.
  if (href.startsWith('/')) {
    const [rootPath, rootFragment] = href.split('#', 2);
    if (/^\/docs\/.+\.md$/i.test(rootPath)) {
      const cleaned = docsUrlFromRelPath(rootPath.replace(/^\/docs\//i, ''));
      return { href: cleaned + (rootFragment ? `#${rootFragment}` : ''), external: false };
    }
    return { href, external: false };
  }

  // Relative link. Try to resolve against the current doc's dir. Split
  // off any anchor fragment so we can preserve it.
  const [pathPart, fragment] = href.split('#', 2);
  const anchor = fragment ? `#${fragment}` : '';

  // Directory-style link into an internal working category ("plans/",
  // "side-quests/"). These do not end in .md so they never reached the
  // rewriting below, and after those categories stopped being served they
  // resolved to a 404. Point them at the directory in the public repo.
  if (pathPart.endsWith('/')) {
    const dirRel = path.relative(
      path.resolve(DOCS_DIR),
      path.resolve(currentDir, pathPart)
    ).replace(/\\/g, '/');
    if (dirRel && !dirRel.startsWith('..') && discover.isNoindexPath(dirRel)) {
      return { href: `${GITHUB_BASE.replace('/blob/', '/tree/')}/docs/${dirRel}`, external: true };
    }
  }

  // Non-.md relative link (image, other file): leave as-is
  if (!pathPart.toLowerCase().endsWith('.md')) return { href, external: false };

  // Resolve against current dir, then produce a docs URL if the target
  // is inside DOCS_DIR
  const resolved = path.resolve(currentDir, pathPart);
  const docsRoot = path.resolve(DOCS_DIR);
  if (!resolved.startsWith(docsRoot + path.sep) && resolved !== docsRoot) {
    // Escapes DOCS_DIR. Common cases from the corpus:
    //   ../README.md → repo root README. Not routed on the site; the
    //   sanctuary landing is at /. Rewrite to that.
    //   ../CLAUDE.md → build/collaboration doc; not for site visitors.
    //   Rewrite to the GitHub URL so the link still resolves.
    // Anything else (link into music/, up out of repo): leave as-is
    // and accept the potential 404 rather than guess at intent.
    const repoRoot = path.resolve(docsRoot, '..');
    const relToRepo = path.relative(repoRoot, resolved).replace(/\\/g, '/');
    if (relToRepo.toLowerCase() === 'readme.md') return { href: '/', external: false };
    if (relToRepo.toLowerCase() === 'claude.md') return { href: GITHUB_BASE + '/CLAUDE.md', external: true };
    return { href, external: false };
  }

  const relToDocs = path.relative(docsRoot, resolved).replace(/\\/g, '/');

  // Internal working categories (plans, issues, templates, standards,
  // side-quests) are no longer served as pages. Thirty reader-facing links
  // point into them, including core documents citing the corpus audit, so
  // they resolve to the public repository rather than to a 404. The material
  // stays readable; it just is not a page on the site.
  if (discover.isNoindexPath(relToDocs)) {
    return { href: `${GITHUB_BASE}/docs/${relToDocs}${anchor}`, external: true };
  }

  return { href: `${docsUrlFromRelPath(relToDocs)}${anchor}`, external: false };
}

/**
 * Markdown whose links all work outside the site: each [text](href) is
 * resolved as the docs site would resolve it, then made absolute. An anchor
 * alone points into the doc's own page, and a link the resolver leaves
 * relative ("../chants/") is resolved against that page, as a browser on it
 * would.
 */
function absolutizeLinks(markdown, docFullPath) {
  const pageUrl = `${SITE_URL}${docsUrlFromRelPath(path.relative(path.resolve(DOCS_DIR), docFullPath).replace(/\\/g, '/'))}`;
  return String(markdown).replace(/(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (whole, open, href, close) => {
    if (/^(mailto|tel):/i.test(href)) return whole;
    if (href.startsWith('#')) return open + pageUrl + href + close;
    const { href: target } = resolveDocHref(href, docFullPath);
    if (target.startsWith('/')) return open + SITE_URL + target + close;
    if (/^https?:\/\//i.test(target)) return open + target + close;
    return open + new URL(target, pageUrl).href + close;
  });
}

module.exports = { SITE_URL, GITHUB_BASE, docsUrlFromRelPath, resolveDocHref, absolutizeLinks };
