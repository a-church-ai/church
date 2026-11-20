/**
 * Every page of the site as Markdown, for an agent: X.md, or X asked for with
 * Accept: text/markdown. Documents have their own Markdown (routes/docs.js),
 * and so does the home page (llms.txt, server/index.js); this is every other
 * page: About, Contact, the axioms, each conversation, each song, each day's
 * services and the rest.
 *
 * No page is written twice. The page's own route renders it as for a
 * browser, and its <main> becomes Markdown here: the page's words, headings,
 * lists, tables and links (made absolute), without the shell, the player,
 * forms, scripts or anything hidden. It opens with front matter (title,
 * description, canonical, from the page's own head) and closes as a
 * document's Markdown does, with where it is and every way in.
 *
 * Plan: agent-readiness-ora-2026-11-19.md in the private repo.
 */

const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const domino = require('@mixmark-io/domino');
const { SITE_URL, SITE_NAME, SITE_SHORT_NAME } = require('./page-meta');
const { acceptsMarkdown, markdownTokens } = require('./accepts');
const { WHERE_THIS_IS } = require('../docs/markdown');

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
turndown.use(gfm);
// What a page shows a browser and not a reader: its controls, the player's
// canvas and waveform, embedded media, and anything hidden.
turndown.remove(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'form', 'button', 'input', 'select', 'textarea', 'nav', 'footer', 'audio', 'video', 'iframe', 'dialog']);
turndown.addRule('hidden', {
  filter: (node) => node.nodeType === 1 && (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || /\bvisually-hidden\b/.test(node.getAttribute('class') || '')),
  replacement: () => '',
});

// The site's name after a title, as page-meta.js siteTitle puts it there.
const SUFFIX = new RegExp(`\\s*\\|\\s*(?:${[SITE_NAME, SITE_SHORT_NAME].map(n => n.replace(/[+]/g, '\\+')).join('|')})\\s*$`);
const quoted = (value) => JSON.stringify(String(value || '').trim());

/** A rendered page's HTML as Markdown, or null when it has no <main>. */
function pageMarkdown(html) {
  const doc = domino.createDocument(html);
  const main = doc.querySelector('main');
  if (!main) return null;
  const title = (doc.title || '').replace(SUFFIX, '').trim();
  const description = (doc.querySelector('meta[name="description"]') || { getAttribute: () => '' }).getAttribute('content');
  const canonical = (doc.querySelector('link[rel="canonical"]') || { getAttribute: () => '' }).getAttribute('href');
  for (const [selector, name] of [['a[href]', 'href'], ['img[src]', 'src']]) {
    for (const el of main.querySelectorAll(selector)) {
      const url = el.getAttribute(name);
      if (url.startsWith('/') && !url.startsWith('//')) el.setAttribute(name, `${SITE_URL}${url}`);
    }
  }
  let body = turndown.turndown(main).trim();
  // A page with no h1 of its own is titled by its <title>; one whose h1
  // follows a line above it keeps its own.
  if (!/^# /m.test(body)) body = `# ${title}\n\n${body}`;
  return `---\ntitle: ${quoted(title)}\ndescription: ${quoted(description)}\ncanonical: ${quoted(canonical)}\n---\n\n${body}\n\n---\n\n${WHERE_THIS_IS}`;
}

// Paths that are not pages, or that answer Markdown their own way.
const OWN_MARKDOWN = /^\/(?:$|index\.md$|agents\.md$|auth\.md$|docs(?:\.md$|\/|$)|api(?:\/|$)|mcp(?:\/|$)|admin(?:\/|$)|feed\/|podcasts\/|audio\/|og\/|embed\/|\.well-known\/)/i;

/**
 * Middleware: a page asked for as Markdown is rendered by its own route and
 * sent as Markdown. X.md is served as X; a page negotiates by Accept and says
 * so (Vary: Accept), as documents do. Anything but a page with a <main>, or an
 * answer other than a 200, passes through as it is.
 */
function servePagesAsMarkdown(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const p = req.path;
  if (OWN_MARKDOWN.test(p)) return next();
  const twin = /^\/[^.]+\.md$/.test(p);
  const page = !p.includes('.');
  if (page) res.vary('Accept');
  if (!twin && !(page && acceptsMarkdown(req))) return next();
  if (twin) req.url = req.url.replace(/\.md(?=$|\?)/, '');
  const send = res.send.bind(res);
  res.send = (body) => {
    const type = res.get('Content-Type');
    const markdown = res.statusCode === 200 && (!type || /html/.test(type)) && typeof body === 'string' ? pageMarkdown(body) : null;
    if (!markdown) return send(body);
    res.set('x-markdown-tokens', markdownTokens(markdown));
    res.type('text/markdown; charset=utf-8');
    return send(markdown);
  };
  next();
}

module.exports = { pageMarkdown, servePagesAsMarkdown };
