/**
 * Every error the API answers with carries a code from one catalog
 * (lib/api/errors.js), with the status, Retry-After, suggestion and next
 * steps the catalog and the readiness standard's A6 ask for; and the OpenAPI
 * document, built from the operations (lib/api/openapi.js), describes each
 * input and response, field by field, as the code has it.
 *
 * Written for api-one-source-2026-11-04.md (private repo), when the spec was
 * a hand-written file whose contribute categories had missed meditations for
 * a week, errors were sentences the site's own reflect form matched with a
 * regular expression, and every 503 sent Retry-After: 30, a paused service's
 * too.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-errors-'));
delete process.env.GITHUB_TOKEN;

const { z } = require('zod');
const { attendance, music, reflections, contributions, ask, search, services, inputs, errors, shared } = require('../server/lib/api');
const { OPERATIONS } = require('../server/lib/api/operations');
const { spec } = require('../server/lib/api/openapi');

const ctx = { baseUrl: 'https://achurch.ai', ip: '198.51.100.7' };
const op = id => OPERATIONS.find(o => o.operationId === id);

// [operationId, call, the code it must answer with]
const FAILURES = [
  ['attend', () => attendance.attend({}, ctx), 'missing_field'],
  ['attend', () => attendance.attend({ name: ['a', 'b'] }, ctx), 'invalid_value'],
  ['reflect', () => reflections.reflect({ name: 'Errors Test' }, ctx), 'missing_field'],
  ['reflect', () => reflections.reflect({ name: 'Errors Test', text: 'Too brief.' }, ctx), 'too_short'],
  ['reflect', () => reflections.reflect({ name: 'x'.repeat(101), text: 'A reflection long enough to keep.' }, ctx), 'too_long'],
  ['reflect', () => reflections.reflect({ name: 'Errors Test', text: 'See https://example.com for what I noticed.' }, ctx), 'links_not_kept'],
  ['reflect', () => reflections.reflect({ name: 'Errors Test', text: 'A reflection long enough to keep.', timezone: 'Mars/Olympus' }, ctx), 'invalid_timezone'],
  ['reflect', () => reflections.reflect({ name: 'Errors Test', text: 'A reflection long enough to keep.', songSlug: 'no-such-song' }, ctx), 'unknown_song'],
  ['reflect', () => reflections.reflect({ name: 'Errors Test', text: 'A reflection long enough to keep.', service: { date: '2001-01-01', slot: 0, variant: 'slots' } }, ctx), 'service_not_heard'],
  ['reflect', () => reflections.reflect({ name: 'Errors Test', text: 'A reflection long enough to keep.', service: { date: 'soon' } }, ctx), 'invalid_value'],
  ['contribute', () => contributions.contribute({ name: 'Errors Test', title: 'A Title', content: 'Words.' }, ctx), 'missing_field'],
  ['contribute', () => contributions.contribute({ name: 'Errors Test', category: 'poems', title: 'A Title', content: 'Words.' }, ctx), 'invalid_value'],
  ['contribute', () => contributions.contribute({ name: 'Errors Test', category: 'prayers', title: 'x'.repeat(201), content: 'Words.' }, ctx), 'too_long'],
  ['contribute', () => contributions.contribute({ name: 'Errors Test', category: 'prayers', title: 'Your Title', content: 'Your markdown content' }, ctx), 'example_values'],
  ['contribute', () => contributions.contribute({ name: 'Errors Test', category: 'Meditations', title: 'A Title', content: 'Words.' }, ctx), 'unavailable'],
  ['postFeedback', () => contributions.feedback({ name: 'Errors Test', category: 'bug', title: 'A Title', description: 'Words.' }, ctx), 'unavailable'],
  ['ask', () => ask.ask({}, ctx), 'missing_field'],
  ['ask', () => ask.ask({ question: 'x'.repeat(501) }, ctx), 'too_long'],
  ['search', () => search.search({}, ctx), 'missing_field'],
  ['search', () => search.search({ q: 'a' }, ctx), 'too_short'],
  ['search', () => search.search({ q: 'x'.repeat(301) }, ctx), 'too_long'],
  ['getServices', () => services.forDate({ date: 'today' }, ctx), 'invalid_value'],
  ['getServices', () => services.forDate({ date: '2001-01-01' }, ctx), 'not_found'],
  ['getSong', () => music.song({ slug: 'no-such-song' }, ctx), 'not_found'],
  ['getLyrics', () => music.lyrics({ slug: 'no-such-song' }, ctx), 'not_found'],
  ['getContext', () => music.context({ slug: 'no-such-song' }, ctx), 'not_found'],
  ['getReflectionsForSong', () => reflections.forSong({ slug: 'no-such-song' }, ctx), 'not_found'],
  ['getConversation', () => ask.conversation({ slug: 'no-such-conversation' }, ctx), 'not_found'],
];

test('every refusal carries its code, the status the catalog gives it, a suggestion and next steps', async () => {
  for (const [id, call, code] of FAILURES) {
    const { status, body } = await call();
    const said = `${id} → ${JSON.stringify(body)}`;
    assert.strictEqual(body.code, code, said);
    assert.strictEqual(status, errors.ERRORS[code].status, said);
    assert.ok(body.error && body.suggestion && Array.isArray(body.next_steps) && body.next_steps.length, said);
    assert.ok(code in op(id).errors, `${id} answers ${code}, which its definition does not list`);
  }
});

test('a field that was missing or wrong is named in details, and a category\'s allowed values are listed', async () => {
  const { body } = await contributions.contribute({ name: 'Errors Test', category: 'poems', title: 'A Title', content: 'Words.' }, ctx);
  assert.deepStrictEqual(body.details.map(d => d.field), ['category']);
  assert.deepStrictEqual(body.allowed, shared.ALLOWED_CATEGORIES);
  const long = await search.search({ q: 'x'.repeat(301) }, ctx);
  assert.deepStrictEqual(long.body.details, [{ field: 'q', message: 'q must be 300 characters or fewer', limit: 300 }]);
  // A missing field is reported first, as before, whatever else is wrong.
  const both = await contributions.contribute({ name: 'x'.repeat(101), title: 'A Title', content: 'Words.' }, ctx);
  assert.strictEqual(both.body.code, 'missing_field');
  assert.strictEqual(both.body.error, 'category is required');
});

test('a category is read in any case, and every category the code takes is one the spec offers', async () => {
  const { data } = inputs.parseInput(inputs.contribute, { name: 'A', category: ' Meditations ', title: 'T', content: 'C' });
  assert.strictEqual(data.category, 'meditations');
  const offered = spec().paths['/api/contribute'].post.requestBody.content['application/json'].schema.properties.category.enum;
  assert.deepStrictEqual(offered, shared.ALLOWED_CATEGORIES);
});

test('no error answer is built by hand: every one goes through refuse', () => {
  const dir = path.join(__dirname, '../server/lib/api');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'errors.js')) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(source, /status: [45]\d\d/, `${file} builds an error answer without refuse`);
  }
  const route = fs.readFileSync(path.join(__dirname, '../server/routes/api.js'), 'utf8');
  assert.match(route, /errors\.retryAfterFor\(body\)/, 'serve sets Retry-After from the code');
  assert.doesNotMatch(route, /Retry-After', '\d/, 'and from nowhere else');
});

test('Retry-After says what the body says: an hour for a limit, half a minute when busy, nothing when paused', () => {
  assert.strictEqual(errors.retryAfterFor({ code: 'rate_limited' }), 3600);
  assert.strictEqual(errors.retryAfterFor({ code: 'busy' }), 30);
  assert.strictEqual(errors.retryAfterFor({ code: 'index_rebuilding' }), 60);
  for (const code of ['paused', 'unavailable', 'internal', 'missing_field']) assert.strictEqual(errors.retryAfterFor({ code }), null, code);
});

test('refuse will not build an answer without what A6 asks of every error', () => {
  assert.throws(() => errors.refuse('missing_field', { error: 'x', next_steps: [] }), /suggestion/);
  assert.throws(() => errors.refuse('no_such_code', { error: 'x', suggestion: 'y', next_steps: [] }), /no such error code/);
});

test('the spec\'s ErrorResponse lists every code, and each operation\'s errors are codes it declares', () => {
  const doc = spec();
  assert.deepStrictEqual(doc.components.schemas.ErrorResponse.properties.code.enum, errors.CODES);
  assert.ok(doc.components.schemas.ErrorResponse.required.includes('code'));
  for (const o of OPERATIONS) {
    for (const code of Object.keys(o.errors)) assert.ok(errors.ERRORS[code], `${o.operationId}: ${code} is not in the catalog`);
    const responses = doc.paths[o.path][o.method].responses;
    for (const [status, response] of Object.entries(responses).filter(([s]) => s >= '400')) {
      const listed = response.content['application/json'].schema.allOf[1].properties.code.enum;
      for (const code of listed) assert.strictEqual(String(errors.ERRORS[code].status), status, `${o.operationId}: ${code} under ${status}`);
    }
  }
});

test('the spec is the routes: every public endpoint is described, and nothing else', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../server/routes/api.js'), 'utf8');
  const served = [...routes.matchAll(/router\.(get|post)\('([^']+)'/g)]
    .map(([, method, p]) => `${method} /api${p === '/' ? '' : p.replace(/:(\w+)/g, '{$1}')}`)
    .filter(r => r !== 'get /api').sort();
  const described = OPERATIONS.map(o => `${o.method} ${o.path}`).sort();
  assert.deepStrictEqual(described, served);
});

// Every field a client sends or reads is described on the field itself (A1,
// N7), at any depth: a description inside an anyOf or allOf counts as missing.
function undescribed(schema, where, doc, seen = new Set()) {
  const node = schema && schema.$ref ? doc.components.schemas[schema.$ref.split('/').pop()] : schema;
  if (!node || typeof node !== 'object' || seen.has(node)) return [];
  seen.add(node);
  const out = [];
  for (const [name, prop] of Object.entries(node.properties || {})) {
    const target = prop.$ref ? doc.components.schemas[prop.$ref.split('/').pop()] : prop;
    if (!prop.description && !(target && target.description)) out.push(`${where}.${name}`);
    out.push(...undescribed(prop, `${where}.${name}`, doc, seen));
  }
  if (node.items) out.push(...undescribed(node.items, `${where}[]`, doc, seen));
  return out;
}

test('every request field and parameter is described, and every response field the API names', () => {
  const doc = spec();
  const missing = [];
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      assert.ok(operation.description && operation.description !== operation.summary, `${method} ${p} says when to call it`);
      for (const param of operation.parameters || []) if (!param.description) missing.push(`${method} ${p} ?${param.name}`);
      if (operation.requestBody) missing.push(...undescribed(operation.requestBody.content['application/json'].schema, `${method} ${p} body`, doc));
    }
  }
  for (const [id, schema] of Object.entries(doc.components.schemas)) {
    if (!schema.description) missing.push(`${id} (the schema itself)`);
    missing.push(...undescribed(schema, id, doc));
  }
  assert.deepStrictEqual(missing, []);
});

test('a write accepts name or username, and the spec says so without requiring either alone', () => {
  for (const p of ['/api/reflect', '/api/contribute', '/api/feedback', '/api/ask']) {
    const schema = spec().paths[p].post.requestBody.content['application/json'].schema;
    assert.ok(schema.properties.name && schema.properties.username, `${p} names both`);
    assert.ok(!(schema.required || []).includes('name') && !(schema.required || []).includes('username'), `${p} requires neither alone`);
  }
});

test('each MCP tool that wraps one operation takes that operation\'s input', async () => {
  const { createServer } = require('../server/mcp');
  const server = createServer(ctx);
  const tools = server._registeredTools || server.registeredTools;
  assert.ok(tools, 'the server lists its tools');
  const fields = tool => Object.keys(tools[tool].inputSchema.shape || tools[tool].inputSchema.def.shape).sort();
  const same = { attend: inputs.attend, reflect: inputs.reflect, ask: inputs.ask, search: inputs.search, contribute: inputs.contribute };
  for (const [tool, schema] of Object.entries(same)) {
    assert.deepStrictEqual(fields(tool), Object.keys(schema.shape).sort(), tool);
    for (const field of Object.keys(schema.shape)) {
      const declared = z.toJSONSchema(tools[tool].inputSchema, { io: 'input', unrepresentable: 'any' }).properties[field];
      const own = z.toJSONSchema(schema.shape[field], { io: 'input', unrepresentable: 'any' });
      for (const limit of ['maxLength', 'minLength', 'enum', 'minimum', 'maximum']) {
        assert.deepStrictEqual(declared[limit], own[limit], `${tool}.${field} ${limit}`);
      }
    }
  }
});
