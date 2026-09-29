/**
 * The OpenAPI description must match what the API returns. It drifted before:
 * AttendResponse promised `greeting`, `you` and `reflections` long after the
 * code returned `welcome`, `reflection` and `recentReflections`, and strict
 * schema-driven clients (GPT Actions, generated SDKs) trust the schema.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-openapi-'));

const Ajv2020 = require('ajv/dist/2020');
const { attendance, music, reflections } = require('../server/lib/api');

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '../client/public/openapi.json'), 'utf8'));
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
  const reflect = await reflections.reflect({ name: 'SpecCheck', text: 'Checking the spec.', songSlug: 'soul-currents' }, ctx);
  check('/api/reflect', 'post', reflect.body);
  const catalog = await music.catalog({}, ctx);
  check('/api/music', 'get', catalog.body);
});

test('the fields the spec says an attend returns are the ones it returns', async () => {
  const { body } = await attendance.attend({ name: 'SpecCheck' }, ctx);
  const declared = Object.keys(spec.components.schemas.AttendResponse.allOf[1].properties);
  for (const field of declared) assert.ok(field in body, `spec declares ${field}, attend does not return it`);
});

test('request bodies accept name, the field the tools and docs use', () => {
  for (const p of ['/api/reflect', '/api/contribute']) {
    const schema = spec.paths[p].post.requestBody.content['application/json'].schema;
    assert.ok(!(schema.required || []).includes('username'), `${p} must not require username`);
    assert.ok(schema.properties.name, `${p} documents name`);
  }
});
