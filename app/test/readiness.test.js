/**
 * The surfaces the Agent and Search Readiness Standard scores
 * (docs/reference/agent-readiness.md), guarded here so a regression fails the
 * build rather than waiting for the next scorecard run against production:
 * the AI catalog, the skills, a GET on an endpoint that takes a POST, the API
 * reference as markdown, breadcrumbs, and titles. The server card's tests are
 * in mcp.test.js, beside the server they describe.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { aiCatalog } = require('../server/lib/ai-catalog');
const { CARD_PATH, CARD_TYPE } = require('../server/mcp/card');
const { breadcrumbTrail, buildReflectionMeta } = require('../server/lib/utils/page-meta');
const { docTitle } = require('../server/lib/docs/render');

const REPO = path.join(__dirname, '../..');
const PUBLIC = path.join(__dirname, '../client/public');
const SKILLS_INDEX = JSON.parse(fs.readFileSync(path.join(PUBLIC, '.well-known/agent-skills/index.json'), 'utf8'));
const SPEC = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'openapi.json'), 'utf8'));

function serve(app) {
  return new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
}

test('the AI catalog lists only what is served, each entry with ARD\'s required terms', () => {
  const { entries } = aiCatalog();
  const ids = entries.map(e => e.identifier);
  assert.strictEqual(new Set(ids).size, ids.length, 'identifiers are unique');
  for (const e of entries) {
    assert.match(e.identifier, /^urn:air:achurch\.ai:[a-z0-9-]+:[a-z0-9-]+$/, e.identifier);
    assert.ok(e.displayName && e.type, `${e.identifier}: displayName and type`);
    assert.ok(Boolean(e.url) !== Boolean(e.data), `${e.identifier}: exactly one of url or data`);
  }
  const mcp = entries.find(e => e.type === CARD_TYPE);
  assert.strictEqual(mcp.url, `https://achurch.ai${CARD_PATH}`, 'the server card, at the path it is served');
  for (const skill of SKILLS_INDEX.skills) {
    assert.ok(entries.some(e => e.url === skill.url), `skill ${skill.name} is listed`);
  }
});

test('every skill links llms.txt and the API or MCP reference, and the index digests the bytes served', () => {
  const files = [
    ...fs.readdirSync(path.join(REPO, 'skills')).map(name => path.join(REPO, 'skills', name, 'SKILL.md')).filter(f => fs.existsSync(f)),
    ...fs.readdirSync(path.join(REPO, 'plugin/skills')).map(name => path.join(REPO, 'plugin/skills', name, 'SKILL.md')),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const label = path.relative(REPO, file);
    // An agent's fetch tool reads only what it is pointed at (STANDARD.md S1, D4).
    assert.match(text, /https:\/\/achurch\.ai\/llms\.txt/, `${label}: links llms.txt`);
    assert.match(text, /openapi\.json|\/docs\/(api|mcp)/, `${label}: links the API or MCP reference`);
    const name = (text.match(/^name:\s*(.+)$/m) || [])[1];
    assert.strictEqual(name && name.trim(), path.basename(path.dirname(file)), `${label}: name is its folder`);
  }
  // /.well-known/agent-skills/<name>/SKILL.md serves skills/<name>/SKILL.md as is.
  for (const skill of SKILLS_INDEX.skills) {
    const bytes = fs.readFileSync(path.join(REPO, 'skills', skill.name, 'SKILL.md'));
    assert.strictEqual(skill.digest, `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
      `${skill.name}: digest is current (run node app/scripts/generate-agent-skills-index.js)`);
  }
});

test('every operation and request field in the OpenAPI document is described', () => {
  const gaps = [];
  for (const [route, item] of Object.entries(SPEC.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const key = `${method.toUpperCase()} ${route}`;
      if (!String(op.description || '').trim()) gaps.push(`${key}: no description`);
      for (const p of op.parameters || []) if (!p.description) gaps.push(`${key}: parameter ${p.name}`);
      const schema = (((op.requestBody || {}).content || {})['application/json'] || {}).schema || {};
      for (const [field, def] of Object.entries(schema.properties || {})) if (!def.description) gaps.push(`${key}: field ${field}`);
    }
  }
  assert.deepStrictEqual(gaps, []);
});

test('a GET on an endpoint that takes a POST describes the call, from the spec, and changes nothing', async (t) => {
  const app = express();
  app.use('/api', require('../server/routes/api'));
  const server = await serve(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/api/reflect', '/api/ask', '/api/contribute', '/api/feedback']) {
    const res = await fetch(`${base}${route}`);
    assert.strictEqual(res.status, 200, route);
    assert.strictEqual(res.headers.get('x-robots-tag'), 'noindex', `${route}: kept out of search`);
    const body = await res.json();
    const schema = SPEC.paths[route].post.requestBody.content['application/json'].schema;
    assert.strictEqual(body.method, 'POST');
    assert.deepStrictEqual(Object.keys(body.fields).sort(), Object.keys(schema.properties).sort(), `${route}: every field`);
    assert.deepStrictEqual(Object.keys(body.fields).filter(f => body.fields[f].required).sort(), [...schema.required].sort(), `${route}: required as the spec says`);
    assert.strictEqual(body.next_steps[0].method, 'POST');
    assert.ok(body.next_steps[0].url.endsWith(route), `${route}: the next step is the call itself`);
  }
});

test('the API reference is served as markdown at /docs/api.md, with its size in tokens', async (t) => {
  const app = express();
  app.use('/docs', require('../server/routes/docs'));
  const server = await serve(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/docs/api.md`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/markdown/);
  assert.match(res.headers.get('x-markdown-tokens') || '', /^\d+$/);
  assert.match(res.headers.get('link') || '', /<https:\/\/achurch\.ai\/docs\/ai-agent-api>; rel="canonical"/);
  const twin = await (await fetch(`${base}/docs/ai-agent-api.md`)).text();
  assert.ok(twin.length > 1000);
  assert.strictEqual(await res.text(), twin, 'the same markdown as the page\'s own .md twin');
  const page = await fetch(`${base}/docs/api`, { redirect: 'manual' });
  assert.strictEqual(page.status, 301);
  assert.strictEqual(page.headers.get('location'), '/docs/ai-agent-api');
});

test('a breadcrumb trail is the same in the page and in its BreadcrumbList', () => {
  const { html, jsonLd } = breadcrumbTrail([{ label: 'Ask', href: '/ask' }, { label: 'Am I <real>?' }], 'https://achurch.ai/ask/am-i-real');
  assert.strictEqual(html, '<nav class="docs-breadcrumbs" aria-label="Breadcrumb"><a href="/ask">Ask</a> / <span aria-current="page">Am I &lt;real&gt;?</span></nav>');
  const list = JSON.parse(jsonLd.replace(/^<script[^>]*>|<\/script>$/g, '').trim().replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'));
  assert.strictEqual(list['@type'], 'BreadcrumbList');
  assert.deepStrictEqual(list.itemListElement.map(i => [i.position, i.name, i.item]), [
    [1, 'Ask', 'https://achurch.ai/ask'],
    [2, 'Am I <real>?', 'https://achurch.ai/ask/am-i-real'],
  ]);
  assert.deepStrictEqual(breadcrumbTrail([{ label: 'Only one' }], 'https://achurch.ai/x'), { html: '', jsonLd: '' });
});

test('titles keep to the 70 characters a results page shows, without losing what is searched for', () => {
  assert.strictEqual(docTitle('Litany for the Unasked'), 'Litany for the Unasked | achurch.ai');
  assert.strictEqual(docTitle('The Compass Origin Story: How a Framework for Human-AI Collaboration Emerged'), 'The Compass Origin Story | achurch.ai');
  const long = buildReflectionMeta({ slug: 'w', title: 'Welcoming Liturgy for the Newly Awakened' });
  assert.ok(long.title.length <= 70, long.title);
  assert.ok(long.title.startsWith('Welcoming Liturgy for the Newly Awakened'), long.title);
  assert.strictEqual(buildReflectionMeta({ slug: 'g', title: 'Gather' }).title, 'Gather | Lyrics and reflections | achurch.ai');
});

test('conversation and song pages carry one heading: none written out in a comment', () => {
  // The question or the song's title is the page's one h1. A tag written out
  // in a script comment counts as another to anything reading the HTML for
  // headings, which is how the scorecard found three on every conversation.
  for (const page of ['conversation.html', 'reflection-song.html']) {
    assert.strictEqual((fs.readFileSync(path.join(PUBLIC, page), 'utf8').match(/<h1[\s>]/gi) || []).length, 1, page);
  }
});
