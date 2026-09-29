/**
 * Every URL a discovery file names must resolve.
 *
 * Until 2026-09-28 /.well-known/mcp.json advertised MCP tools at /api, a path
 * that returned an HTML 404, and the A2A agent card named an endpoint nothing
 * served. Agents read these files before anything else, so a dead pointer in
 * one is a door that is not there. This checks each achurch.ai URL they name
 * against what the server actually serves: a static file, a docs page, a page
 * route in index.js, or a route on the API router.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../client/public');
const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
// Routes the MCP module mounts on the app (POST /mcp, and GET/DELETE answering 405).
const MCP_SOURCE = fs.readFileSync(path.join(__dirname, '../server/mcp/index.js'), 'utf8');
// Fixed routes on the docs router, such as /docs/index.md.
const DOCS_ROUTES = [...fs.readFileSync(path.join(__dirname, '../server/routes/docs.js'), 'utf8').matchAll(/router\.get\('(\/[^'*:]+)'/g)]
  .map(m => `/docs${m[1]}`);
const apiRouter = require('../server/routes/api');
const discover = require('../server/lib/docs/discover');

// Routes declared on the app, parameters and all
// ("/.well-known/agent-skills/:name/SKILL.md"), in index.js and the MCP module.
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch);
const PAGE_ROUTES = [...(INDEX_SOURCE + MCP_SOURCE).matchAll(/app\.(?:get|post|delete)\('([^']+)'/g)]
  .map(m => new RegExp('^' + escapeRegExp(m[1]).replace(/:\w+/g, '[^/]+') + '$'));

function discoveryFiles() {
  const files = ['llms.txt', 'llms-full.txt', 'auth.md', 'openapi.json'].map(f => path.join(PUBLIC, f));
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (!entry.name.endsWith('.md')) files.push(full); // skills' SKILL.md files are content, not pointers
  });
  walk(path.join(PUBLIC, '.well-known'));
  return files;
}

// achurch.ai URLs, and site paths written as markdown links or code spans.
function namedPaths(text) {
  const found = new Set();
  for (const m of text.matchAll(/https:\/\/achurch\.ai(\/[^\s)"'`<>\]]*)?/g)) found.add(m[1] || '/');
  for (const m of text.matchAll(/\]\((\/[^)\s]*)\)/g)) found.add(m[1]);
  for (const m of text.matchAll(/`(\/(?:\.well-known\/[^`\s]+|[\w./-]+\.(?:json|txt|xml|md)))`/g)) found.add(m[1]);
  return [...found]
    .map(p => p.split(/[?#]/)[0].replace(/[.,;:]+$/, ''))
    .filter(p => p && !p.includes('{'));
}

async function resolves(urlPath) {
  if (/^\/api(\/|$)/.test(urlPath)) {
    const sub = urlPath.replace(/^\/api/, '') || '/';
    return apiRouter.stack.some(layer => layer.route && layer.match(sub));
  }
  if (DOCS_ROUTES.includes(urlPath)) return true;
  if (/^\/docs(\/|$)/.test(urlPath)) {
    // A trailing .md asks for the same document as markdown (routes/docs.js).
    const parts = urlPath.replace(/\.md$/i, '').split('/').filter(Boolean).slice(1);
    return parts.length === 0 || Boolean(await discover.resolveDocPath(parts));
  }
  const file = path.join(PUBLIC, urlPath);
  if (urlPath !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) return true;
  if (fs.existsSync(`${file}.html`)) return true;
  return PAGE_ROUTES.some(route => route.test(urlPath)) || (urlPath === '/' && INDEX_SOURCE.includes("req.path !== '/'"));
}

test('every achurch.ai URL named in a discovery file resolves', async () => {
  const dead = [];
  for (const file of discoveryFiles()) {
    for (const urlPath of namedPaths(fs.readFileSync(file, 'utf8'))) {
      if (!(await resolves(urlPath))) dead.push(`${path.relative(PUBLIC, file)}: ${urlPath}`);
    }
  }
  assert.deepStrictEqual(dead, []);
});

test('no discovery file advertises a protocol endpoint the site does not serve', () => {
  // MCP is described by the server card alone; there is no A2A endpoint.
  assert.ok(!fs.existsSync(path.join(PUBLIC, '.well-known/mcp.json')), 'one MCP discovery file: the server card');
  assert.ok(!fs.existsSync(path.join(PUBLIC, '.well-known/agent-card.json')), 'no A2A endpoint, so no agent card');
  const card = JSON.parse(fs.readFileSync(path.join(PUBLIC, '.well-known/mcp/server-card.json'), 'utf8'));
  for (const transport of card.transports) {
    assert.ok(PAGE_ROUTES.some(route => route.test(new URL(transport.url).pathname)), transport.url);
  }
});
