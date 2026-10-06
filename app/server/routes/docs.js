/**
 * Docs routes.
 *
 * URL structure:
 *   /docs                            → the library (render.renderLibrary),
 *                                      generated; /docs/index.md and
 *                                      /docs/index.json are the same list for
 *                                      agents and for search
 *   /docs/{category}                 → docs/{category}/README.md (or auto-index)
 *   /docs/{category}/{name}          → docs/{category}/{name}.md
 *   /docs/{name}                     → docs/{name}.md (top-level docs)
 *   /docs/{deeper}/{...}             → arbitrary nesting (claude-compass/axioms/*)
 *
 * Content-negotiated: `Accept: text/markdown` returns the raw .md file
 * (mirroring the /AGENTS.md and /.well-known/agent-skills/:name/SKILL.md
 * safety pattern). Otherwise returns the rendered HTML page.
 *
 * Which document a URL serves, and the path-traversal checks that decide it,
 * live in lib/docs/serve.js, shared with the MCP read_doc tool. A path it
 * refuses 404s here without leaking the reason.
 */

const express = require('express');
const fs = require('fs').promises;
const { resolveServedDoc } = require('../lib/docs/serve');
const { sendNotFound } = require('../lib/utils/not-found');
const render = require('../lib/docs/render');
const { servedMarkdown, corpusIndex, servedDocs } = require('../lib/docs/markdown');
const { acceptsMarkdown, markdownTokens } = require('../lib/utils/accepts');
const { titleCase } = require('../lib/docs/meta');

const router = express.Router();

// Every 404 in this file is the same 404: the document is not there. A reading
// path is usually a better way into 250+ documents than guessing a URL.
function docsNotFound(req, res) {
  return sendNotFound(req, res, {
    heading: 'No such document',
    message: 'That document is not here. The corpus holds over two hundred; a reading path is often a better way in than a URL.',
    links: [
      { href: '/docs', label: 'All docs' },
      { href: '/paths', label: 'Reading paths' },
      { href: '/', label: 'Home' },
    ],
  });
}

// Serve what resolveServedDoc found for this URL, or the 404. asMarkdown: the
// URL ended in .md, which asks for the source whatever the Accept header says;
// that response points back at the page as canonical.
async function handle(req, res, rest) {
  const resolved = await resolveServedDoc(rest);
  if (!resolved) {
    return docsNotFound(req, res);
  }
  const { asMarkdown } = resolved;

  if (resolved.kind === 'file') {
    // Content negotiation: markdown clients get the raw file (mirrors the
    // /AGENTS.md handler in server/index.js). Browsers get rendered HTML.
    //
    // Vary: Accept is required because one URL serves two representations. The
    // homepage set it (index.js res.vary('Accept')) and the docs routes did not,
    // so a cache that saw HTML first could serve it to an agent asking for
    // Markdown, and the reverse. Set before the branch so both paths carry it.
    res.vary('Accept');
    if (asMarkdown || acceptsMarkdown(req)) {
      if (asMarkdown) res.set('Link', `<https://achurch.ai${resolved.doc.urlPath ? `/docs/${resolved.doc.urlPath}` : '/docs'}>; rel="canonical"`);
      try {
        const markdown = await servedMarkdown(resolved);
        res.set('x-markdown-tokens', markdownTokens(markdown));
        res.type('text/markdown; charset=utf-8');
        return res.send(markdown);
      } catch {
        return docsNotFound(req, res);
      }
    }
    try {
      const markdown = await fs.readFile(resolved.fullPath, 'utf8');
      // ?path=<reading path> shows where this reading sits in that path. It
      // changes nothing else, and the canonical URL never carries it.
      const readingPath = typeof req.query.path === 'string' ? req.query.path : undefined;
      const html = await render.renderDocPage({ markdown, doc: resolved.doc, readingPath });
      res.type('text/html; charset=utf-8');
      return res.send(html);
    } catch (err) {
      console.error(`[docs] render failed for ${resolved.doc.docsRelPath}: ${err.message}`);
      return res.status(500).type('text/plain').send('Internal error');
    }
  }

  if (resolved.kind === 'dir-index') {
    // dir-index: auto-generated listing of a directory that has no README.
    // Same URL, two representations, so the same Vary applies here.
    res.vary('Accept');
    if (asMarkdown || acceptsMarkdown(req)) {
      if (asMarkdown) res.set('Link', `<https://achurch.ai/docs${resolved.dir ? `/${resolved.dir}` : ''}>; rel="canonical"`);
      // For markdown clients, list children as a minimal markdown response
      // rather than emitting HTML. Cheap and honest about the shape.
      const lines = [`# ${resolved.dir || 'Documentation'}`, ''];
      for (const d of resolved.docs) {
        if (d.stem.toLowerCase() === 'readme') continue;
        lines.push(`- [${d.title}](https://achurch.ai/docs/${d.urlPath})`);
      }
      const markdown = lines.join('\n') + '\n';
      res.set('x-markdown-tokens', markdownTokens(markdown));
      res.type('text/markdown; charset=utf-8');
      return res.send(markdown);
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

  return docsNotFound(req, res);
}

// The library: every served document, for readers. Agents asking for markdown
// get the same list as markdown. docs/README.md is the repository's map for
// contributors and is not a page here; the library links to it on GitHub.
async function library(req, res) {
  res.vary('Accept');
  if (acceptsMarkdown(req)) return libraryMarkdown(req, res);
  try {
    res.type('text/html; charset=utf-8').send(await render.renderLibrary());
  } catch (err) {
    console.error(`[docs] library render failed: ${err.message}`);
    res.status(500).type('text/plain').send('Internal error');
  }
}

// Every served document in one markdown list, for agents enumerating the corpus.
async function libraryMarkdown(req, res) {
  const markdown = await corpusIndex();
  res.set('Link', '<https://achurch.ai/docs>; rel="canonical"');
  res.set('x-markdown-tokens', markdownTokens(markdown));
  res.type('text/markdown; charset=utf-8').send(markdown);
}

router.get('/', library);
router.get('/index.md', libraryMarkdown);

// The API reference at the paths agents guess for it: /docs/api.md is
// docs/ai-agent-api.md as markdown, pointing back at its page as canonical,
// and /docs/api is that page.
router.get('/api.md', (req, res) => handle(req, res, 'ai-agent-api.md'));
router.get('/api', (req, res) => res.redirect(301, '/docs/ai-agent-api'));

// The same list as JSON, for the library's search, which runs in the browser.
// Here rather than under /api/, where every request is logged: fetched once
// and searched locally, the library's search leaves no record of what was
// typed. Search by meaning (/api/search) has to send its query to the
// embedding model, so it lives under /api/ with the query redacted from the
// log.
router.get('/index.json', async (req, res) => {
  const docs = await servedDocs();
  res.json(docs.map(d => ({ title: d.title, description: d.description, url: `/docs/${d.urlPath}`, label: d.category ? titleCase(d.category) : '' })));
});

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
  return handle(req, res, rest);
});

module.exports = router;
module.exports.libraryMarkdown = libraryMarkdown;
