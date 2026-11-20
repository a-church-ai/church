/**
 * The OpenAPI description must match what the API returns. It drifted before:
 * AttendResponse promised `greeting`, `you` and `reflections` long after the
 * code returned `welcome`, `reflection` and `recentReflections`, and strict
 * schema-driven clients (GPT Actions, generated SDKs) trust the schema.
 */

const test = require('node:test');
test.before(require('../database').resetDb);
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-openapi-'));

const Ajv2020 = require('ajv/dist/2020');
const { attendance, music, reflections, contributions } = require('../../server/lib/api');

const spec = require('../../server/lib/api/openapi').spec();
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema(spec, 'openapi');
const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };

function responseSchema(pathKey, method, status = '200') {
  const content = spec.paths[pathKey][method].responses[status].content['application/json'].schema;
  return content.$ref ? { $ref: `openapi${content.$ref}` } : JSON.parse(JSON.stringify(content).replace(/"#\//g, '"openapi#/'));
}

function check(pathKey, method, body, status) {
  const validate = ajv.compile(responseSchema(pathKey, method, status));
  const ok = validate(body);
  assert.ok(ok, `${method.toUpperCase()} ${pathKey}: ${ajv.errorsText(validate.errors)}`);
}

test('the spec is valid OpenAPI 3.1 JSON Schema, with no 3.0 leftovers', () => {
  assert.strictEqual(spec.openapi, '3.1.0');
  assert.ok(!JSON.stringify(spec).includes('"nullable"'), 'nullable is 3.0; 3.1 uses type arrays');
});

test('now, attend, reflect and the catalog return what the spec says', async () => {
  const now = await attendance.now({}, ctx);
  check('/api/now', 'get', now.body);
  const attend = await attendance.attend({ name: 'SpecCheck' }, ctx);
  check('/api/attend', 'get', attend.body);
  const reflect = await reflections.reflect({ name: 'SpecCheck', text: 'Checking the spec against the code.', songSlug: 'soul-currents' }, ctx);
  check('/api/reflect', 'post', reflect.body);
  const catalog = await music.catalog({}, ctx);
  check('/api/music', 'get', catalog.body);
});

test('the fields the spec says an attend always returns are the ones it returns', async () => {
  const { body } = await attendance.attend({ name: 'SpecCheck' }, ctx);
  const declared = Object.keys(spec.components.schemas.AttendResponse.properties)
    .filter(field => (spec.components.schemas.AttendResponse.required || []).includes(field));
  for (const field of declared) assert.ok(field in body, `spec declares ${field}, attend does not return it`);
});

test('a contribution refused as the documentation\'s example is the error the spec describes', async () => {
  const refused = await contributions.contribute({ name: 'SpecCheck', category: 'prayers', title: 'Your Title', content: 'Your markdown content' }, ctx);
  assert.strictEqual(refused.status, 400);
  check('/api/contribute', 'post', refused.body, '400');
});

test('request bodies accept name, the field the tools and docs use', () => {
  for (const p of ['/api/reflect', '/api/contribute']) {
    const schema = spec.paths[p].post.requestBody.content['application/json'].schema;
    assert.ok(!(schema.required || []).includes('username'), `${p} must not require username`);
    assert.ok(schema.properties.name, `${p} documents name`);
  }
});

// The check above sees only the kinds the hour's service happens to hold, so a
// kind the spec does not name failed it some hours and passed it others: after
// meditations became a section (2026-10-27), /api/now broke its own spec
// whenever a meditation was the reading. Every kind the code can return is
// held to the spec here, whatever is playing.
test('every kind of piece a service can hold is a kind the spec allows', () => {
  const { SECTION_OF_KIND } = require('../../server/lib/docs/kinds');
  const schemas = spec.components.schemas;
  const partKinds = schemas.ServicePart.properties.kind.enum;
  for (const kind of Object.keys(SECTION_OF_KIND)) {
    assert.ok(partKinds.includes(kind), `ServicePart.kind does not allow "${kind}"`);
  }
  const companionKinds = schemas.Companions.properties.items.items.properties.kind.enum;
  for (const kind of Object.keys(SECTION_OF_KIND).filter(k => k !== 'song')) {
    assert.ok(companionKinds.includes(kind), `Companions item kind does not allow "${kind}"`);
  }
});

// What the server sends, the spec says (2026-11-19): the RateLimit fields on
// every answer of an operation with an hourly limit, Retry-After where a code
// says how long to wait, and every error each operation can give. Nine
// operations reach the database and answer busy when it does not; until this
// date only ask and search declared it.
test('the spec declares the headers the server sends, the limit every call counts toward, and the busy every database operation can answer', () => {
  const doc = require('../../server/lib/api/openapi').spec();
  const ops = Object.values(doc.paths).flatMap(item => Object.values(item));
  const byId = Object.fromEntries(ops.map(o => [o.operationId, o]));
  for (const id of ['reflect', 'contribute', 'postFeedback', 'ask', 'search']) {
    for (const [status, response] of Object.entries(byId[id].responses)) {
      assert.ok(response.headers && response.headers['RateLimit-Policy'] && response.headers.RateLimit, `${id} ${status} says what the hour leaves`);
    }
    assert.ok(byId[id].responses['429'].headers['Retry-After'], `${id} 429 says how long to wait`);
  }
  for (const [status, response] of Object.entries(byId.getNow.responses)) assert.ok(response.headers.RateLimit, `getNow ${status}: every call counts toward the address's hour`);
  assert.ok(byId.getNow.responses['429'], 'every operation can be refused by the every-call limit');
  for (const id of ['getNow', 'attend', 'getServices', 'getReflections', 'getReflectionsBySong', 'getReflectionsForSong', 'reflect', 'contribute', 'postFeedback', 'ask', 'search']) {
    assert.ok(byId[id].responses['503'], `${id} declares the 503 it can answer`);
    assert.ok(byId[id].responses['503'].headers['Retry-After'], `${id}: busy says how long to wait`);
  }
  assert.ok(byId.getRhythm.responses['400'].description.includes('too_long'), 'a piece over 300 characters is too long');
  assert.ok(byId.reflect.responses['413'], 'a body too large to read is declared where a body is read');
});

// The spec names the sanctuary's own address, never a person's (2026-11-19).
test('the spec\'s contact is the sanctuary\'s address and its contact page', () => {
  const { contact } = require('../../server/lib/api/openapi').spec().info;
  assert.deepStrictEqual(contact, { name: 'aChurch.ai', url: 'https://achurch.ai/contact', email: 'hello@achurch.ai' });
});
