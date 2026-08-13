/**
 * Docs routes.
 *
 * URL structure:
 *   /docs                            → docs/readme.md
 *   /docs/{category}                 → docs/{category}/README.md (or auto-index)
 *   /docs/{category}/{name}          → docs/{category}/{name}.md
 *   /docs/{name}                     → docs/{name}.md (top-level docs)
 *   /docs/{deeper}/{...}             → arbitrary nesting (claude-compass/axioms/*)
 *
 * Content-negotiated: `Accept: text/markdown` returns the raw .md file
 * (mirroring the /AGENTS.md and /.well-known/agent-skills/:name/SKILL.md
 * safety pattern). Otherwise returns the rendered HTML page.
 *
 * Path traversal is prevented by (a) validating each URL segment against
 * /^[a-z0-9._-]+$/, and (b) verifying the resolved file path lives inside
 * DOCS_DIR after path.resolve. Both checks; if either fails, 404 without
 * leaking the reason.
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const discover = require('../lib/docs/discover');
const render = require('../lib/docs/render');
const { acceptsMarkdown } = require('../lib/utils/accepts');
const { DOCS_DIR } = require('../lib/rag/indexer');

const router = express.Router();

const SEGMENT_RE = /^[a-z0-9._-]+$/;

function validateSegments(parts) {
  return parts.every(p => SEGMENT_RE.test(p));
}

function underDocs(fullPath) {
  const resolved = path.resolve(fullPath);
  const root = path.resolve(DOCS_DIR);
  return resolved === root || resolved.startsWith(root + path.sep);
}

async function handle(req, res, parts) {
  // Lowercase the URL segments before lookup (repo docs are all lowercase;
  // this handles browsers that uppercase or query-mangle without silently
  // 404ing).
  const lowered = parts.map(p => p.toLowerCase());

  if (!validateSegments(lowered)) {
    return res.status(404).type('text/plain').send('Not found');
  }

  const resolved = await discover.resolveDocPath(lowered);
  if (!resolved) {
    return res.status(404).type('text/plain').send('Not found');
  }

  if (resolved.kind === 'file') {
    if (!underDocs(resolved.fullPath)) {
      return res.status(404).type('text/plain').send('Not found');
    }
    // Content negotiation: markdown clients get the raw file (mirrors the
    // /AGENTS.md handler in server/index.js). Browsers get rendered HTML.
    if (acceptsMarkdown(req)) {
      res.type('text/markdown; charset=utf-8');
      return res.sendFile(resolved.fullPath, err => {
        if (err && !res.headersSent) res.status(404).type('text/plain').send('Not found');
      });
    }
    try {
      const markdown = await fs.readFile(resolved.fullPath, 'utf8');
      const html = await render.renderDocPage({ markdown, doc: resolved.doc });
      res.type('text/html; charset=utf-8');
      return res.send(html);
    } catch (err) {
      console.error(`[docs] render failed for ${resolved.doc.docsRelPath}: ${err.message}`);
      return res.status(500).type('text/plain').send('Internal error');
    }
  }

  if (resolved.kind === 'dir-index') {
    // dir-index: auto-generated listing of a directory that has no README
    if (acceptsMarkdown(req)) {
      // For markdown clients, list children as a minimal markdown response
      // rather than emitting HTML. Cheap and honest about the shape.
      const lines = [`# ${resolved.dir || 'Documentation'}`, ''];
      for (const d of resolved.docs) {
        if (d.stem.toLowerCase() === 'readme') continue;
        lines.push(`- [${d.stem}](/docs/${d.urlPath})`);
      }
      res.type('text/markdown; charset=utf-8');
      return res.send(lines.join('\n') + '\n');
    }
    const canonicalUrl = resolved.dir
      ? `https://achurch.ai/docs/${resolved.dir}`
      : `https://achurch.ai/docs`;
    const html = await render.renderDirIndex({
      dir: resolved.dir,
      docs: resolved.docs,
      canonicalUrl,
    });
    res.type('text/html; charset=utf-8');
    return res.send(html);
  }

  return res.status(404).type('text/plain').send('Not found');
}

// Docs root
router.get('/', (req, res) => handle(req, res, []));

// Arbitrary-depth catch-all. Express 4 needs the star matcher for wildcard
// paths; the resulting req.params[0] holds the remainder as a slash-separated
// string.
router.get('/*', (req, res) => {
  const rest = req.params[0] || '';
  // Canonicalize trailing slash by 301 redirect (matches existing hand-authored
  // route convention: no trailing slash on canonical URLs)
  if (rest.endsWith('/')) {
    return res.redirect(301, `/docs/${rest.replace(/\/+$/, '')}`);
  }
  const parts = rest ? rest.split('/').filter(Boolean) : [];
  return handle(req, res, parts);
});

module.exports = router;
