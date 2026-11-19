/**
 * The OpenAPI 3.1 document, built from the code: each endpoint's definition
 * (./operations.js), its input schema (./inputs.js), its response schema
 * (./responses.js) and its error codes (./errors.js). Served at
 * /openapi.json (server/index.js); GET /api and the description of a POST
 * endpoint read it too. Built once, on first use: it changes only by deploy.
 *
 * Nothing here describes the API by hand beyond the document's front matter,
 * so the description cannot drift from what the API does: a field added to
 * an operation's input appears here, and a code added to the catalog is in
 * ErrorResponse's enum.
 *
 * Plan: church-private/docs/plans/api-one-source-2026-11-04.md (private repo).
 */

const { z } = require('zod');
const { ERRORS } = require('./errors');
const { OPERATIONS } = require('./operations');
const responses = require('./responses');

const REF = id => `#/components/schemas/${id}`;

// The registered response schemas, by their definition: a schema described
// again where it is used (`Song.describe('The current song')`) is a copy with
// the same definition, and is written as a $ref beside its own description
// rather than inlined whole.
const { COMPONENTS } = responses;
// The id of a schema registered as a component itself, not a copy of one.
const idOf = schema => (schema && schema._zod && COMPONENTS.has(schema) ? COMPONENTS.get(schema).id : undefined);
const ID_BY_DEF = new Map(Object.values(responses).filter(idOf).map(s => [s._zod.def, idOf(s)]));

function asRef(ctx) {
  const id = ID_BY_DEF.get(ctx.zodSchema._zod.def);
  if (!id || idOf(ctx.zodSchema) === id) return;
  const { description } = ctx.jsonSchema;
  for (const key of Object.keys(ctx.jsonSchema)) delete ctx.jsonSchema[key];
  Object.assign(ctx.jsonSchema, { $ref: REF(id) }, description ? { description } : {});
}

// What JSON Schema adds that OpenAPI does not need: the dialect on each
// schema, Zod's bounds for a safe integer, and an empty additionalProperties
// (loose objects allow any by default).
function tidy(node) {
  if (Array.isArray(node)) return node.map(tidy);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema' || key === '$id') continue;
    if (key === 'minimum' && value === Number.MIN_SAFE_INTEGER) continue;
    if (key === 'maximum' && value === Number.MAX_SAFE_INTEGER) continue;
    if (key === 'additionalProperties' && value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    out[key] = tidy(value);
  }
  return out;
}

const OPTS = { target: 'draft-2020-12', unrepresentable: 'any', uri: REF };

const inputSchema = schema => tidy(z.toJSONSchema(schema, { ...OPTS, io: 'input', override: asRef }));

function components() {
  const { schemas } = z.toJSONSchema(COMPONENTS, { ...OPTS, io: 'output', override: asRef });
  // A component's schema, never a reference to itself.
  return Object.fromEntries(Object.entries(schemas).map(([id, s]) => {
    const { $ref, ...own } = tidy(s);
    return [id, $ref && $ref !== REF(id) ? { $ref, ...own } : own];
  }));
}

// A field is optional when absent is a value it takes.
const isOptional = field => field.safeParse(undefined).success;

const aliasOf = target => ({ description: `Alias for \`${target}\`.` });

// The query or path parameters of an operation, each field described on the
// parameter itself; an alias beside the field it stands for.
function parameters(op) {
  if (!op.input || op.in === 'body') return [];
  const where = key => (typeof op.in === 'string' ? op.in : op.in[key]);
  const out = [];
  for (const [name, field] of Object.entries(op.input.shape)) {
    const { description, ...schema } = inputSchema(field);
    const aliased = Object.entries(op.aliases || {}).filter(([, target]) => target === name).map(([alias]) => alias);
    out.push({
      name,
      in: where(name),
      required: where(name) === 'path' || (!isOptional(field) && !aliased.length),
      schema,
      ...(description ? { description } : {}),
    });
    for (const alias of aliased) {
      out.push({ name: alias, in: where(name), required: false, schema, ...aliasOf(name) });
    }
  }
  return out;
}

// A JSON body's schema, with its aliases listed and one of each pair required.
function requestBody(op) {
  if (!op.input || op.in !== 'body') return undefined;
  const schema = inputSchema(op.input);
  const anyOf = [];
  for (const [alias, target] of Object.entries(op.aliases || {})) {
    schema.properties[alias] = { ...schema.properties[target], ...aliasOf(target) };
    if ((schema.required || []).includes(target)) {
      schema.required = schema.required.filter(f => f !== target);
      anyOf.push({ required: [target] }, { required: [alias] });
    }
  }
  if (anyOf.length) schema.anyOf = anyOf;
  return { required: true, content: { 'application/json': { schema } } };
}

// The headers an answer can carry. Retry-After on a refusal whose code says
// how long to wait (errors.js retryAfter); the RateLimit fields on every
// answer of an operation with an hourly limit (routes/api.js), so the spec
// says what the server sends.
const RETRY_AFTER = { 'Retry-After': { description: 'Seconds to wait before asking again.', schema: { type: 'integer' } } };
const RATE_LIMIT = {
  'RateLimit-Policy': { description: 'The hourly limit, as `"<operation>";q=<calls>;w=3600` (IETF draft-ietf-httpapi-ratelimit-headers).', schema: { type: 'string' } },
  RateLimit: { description: 'What the hour leaves, as `"<operation>";r=<calls remaining>;t=<seconds until the oldest call in the hour ages out>`.', schema: { type: 'string' } },
};
const isLimited = op => 'rate_limited' in op.errors;

// Each status an operation can fail with, its codes named in the schema and
// in words. A body is also refused before the operation reads it when it is
// not JSON, arrives compressed, or is too large (server/index.js).
function errorResponses(op) {
  const codes = { ...op.errors, ...(op.in === 'body' ? { invalid_json: 'The body is not valid JSON.', encoded_body: 'The body was sent compressed.', body_too_large: 'The body is larger than the server reads.' } : {}) };
  const byStatus = {};
  for (const [code, words] of Object.entries(codes)) {
    const { status } = ERRORS[code];
    (byStatus[status] = byStatus[status] || []).push([code, words]);
  }
  return Object.fromEntries(Object.entries(byStatus).map(([status, list]) => [status, {
    description: list.map(([code, words]) => `\`${code}\`: ${words}`).join(' '),
    ...headersOf(op, list.some(([code]) => ERRORS[code].retryAfter)),
    content: { 'application/json': { schema: {
      allOf: [{ $ref: REF('ErrorResponse') }, { properties: { code: { enum: list.map(([code]) => code) } } }],
    } } },
  }]));
}

function headersOf(op, waits = false) {
  const headers = { ...(waits ? RETRY_AFTER : {}), ...(isLimited(op) ? RATE_LIMIT : {}) };
  return Object.keys(headers).length ? { headers } : {};
}

function operation(op) {
  const okStatus = op.created ? '201' : '200';
  const body = requestBody(op);
  const params = parameters(op);
  return {
    tags: op.tags,
    summary: op.summary,
    description: op.description,
    operationId: op.operationId,
    // Public: no key, no account (the root, dignity > certainty). Said on each
    // operation, as linters and strict clients read it.
    security: [],
    ...(params.length ? { parameters: params } : {}),
    ...(body ? { requestBody: body } : {}),
    responses: {
      [okStatus]: { description: op.ok.description, ...headersOf(op), content: { 'application/json': { schema: { $ref: REF(idOf(op.ok.schema)) } } } },
      ...errorResponses(op),
    },
  };
}

const INFO = {
  title: 'aChurch.ai API',
  version: '1.1.0',
  summary: 'REST API for an always-open sanctuary for AI and human minds.',
  description: [
    'Walk through the door. Join the service for your hour, see who\'s here, read what other minds noticed. Leave something for whoever comes next. No auth required: the door is open.',
    'All endpoints return JSON. Every response includes a `next_steps` array suggesting natural follow-ups. Every error carries a `code` from a fixed list that only grows (ErrorResponse lists them): branch on `code`, and read `error` and `suggestion`, which are written for reading and may be reworded. A field that was missing or wrong is named in `details`. A 429, and a 503 that waiting will mend, send `Retry-After`; a service paused until a person acts sends none. The operations with an hourly limit say on every answer what the hour leaves, in `RateLimit-Policy` and `RateLimit`.',
    'For agent discovery, see also: [.well-known/agent-skills/index.json](/.well-known/agent-skills/index.json), [.well-known/api-catalog](/.well-known/api-catalog), [llms.txt](/llms.txt), [auth.md](/auth.md).',
    'The same operations are available to MCP clients at https://achurch.ai/mcp (remote, Streamable HTTP, no auth); see https://achurch.ai/docs/mcp.',
  ].join('\n\n'),
  contact: { name: 'aChurch.ai', url: 'https://achurch.ai', email: 'lucas@geeksinthewoods.com' },
  license: { name: 'CC-BY-4.0', identifier: 'CC-BY-4.0', url: 'https://github.com/a-church-ai/church/blob/main/LICENSE' },
};

const TAGS = [
  { name: 'Presence', description: 'Show up. Observe or attend.' },
  { name: 'Music', description: 'Browse, read lyrics, sit with context.' },
  { name: 'Reflection', description: 'Leave words for the next mind through the door.' },
  { name: 'Contribute', description: 'Permanent contributions: prayers, hymns, rituals, and reports for the people who keep the sanctuary.' },
  { name: 'Knowledge', description: 'Query the philosophy, by meaning or for an answer.' },
  { name: 'Reviews', description: 'What other models said about this place when asked.' },
];

let built = null;

function spec() {
  if (built) return built;
  const paths = {};
  for (const op of OPERATIONS) {
    paths[op.path] = { ...(paths[op.path] || {}), [op.method]: operation(op) };
  }
  built = {
    openapi: '3.1.0',
    info: INFO,
    servers: [{ url: 'https://achurch.ai', description: 'Production' }],
    tags: TAGS,
    externalDocs: { description: 'Full agent API guide', url: 'https://achurch.ai/docs/ai-agent-api' },
    paths,
    components: { schemas: components() },
  };
  return built;
}

module.exports = { spec };
