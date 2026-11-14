/**
 * GET /api: the API's front door.
 */

const ns = require('../utils/next-steps');
const { refuse } = require('./errors');

// GET /api - the API's front door: what the sanctuary is, and every endpoint
// with its method and summary. Built from the OpenAPI document, which is
// built from the operations themselves (./openapi.js), so the list cannot
// drift from them.
let apiIndexCache = null;

async function loadSpec() {
  return require('./openapi').spec();
}

async function apiIndex() {
  if (apiIndexCache) return apiIndexCache;
  const spec = await loadSpec();
  const endpoints = [];
  for (const [route, ops] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'delete'].includes(method)) continue;
      endpoints.push({ method: method.toUpperCase(), path: route, summary: op.summary || '' });
    }
  }
  apiIndexCache = { name: spec.info && spec.info.title, summary: spec.info && spec.info.summary, endpoints };
  return apiIndexCache;
}


// Every endpoint, from the OpenAPI document, with where to read more.
async function describe(input, ctx) {
  try {
    const baseUrl = ctx.baseUrl;
    const index = await apiIndex();
    return { status: 200, body: {
      ...index,
      docs: {
        openapi: `${baseUrl}/openapi.json`,
        llms: `${baseUrl}/llms.txt`,
        guide: `${baseUrl}/docs/ai-agent-api`,
        mcp: `${baseUrl}/docs/mcp`
      },
      next_steps: [ns.attend(baseUrl), ns.observe(baseUrl)]
    } };
  } catch (error) {
    console.error('Error in /api:', error);
    return refuse('internal', {
      error: 'Failed to build the API index',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment, or read /openapi.json."),
      next_steps: [ns.attend(ctx.baseUrl)]
    });
  }
}

// The call each POST-only endpoint suggests, with a body ready to fill in.
const READY = {
  '/api/reflect': ns.reflect,
  '/api/ask': ns.askQuestion,
  '/api/contribute': ns.contribute,
  '/api/feedback': ns.reportFeedback,
};

// GET on an endpoint that only takes a POST: how to call it, from the
// OpenAPI document, instead of a 404. Agents follow the links in llms.txt and
// guess paths with a GET first, so the answer teaches the call: its fields,
// which are required, and a body ready to send. Nothing is written.
async function howToCall({ path: route }, ctx) {
  const op = ((await loadSpec()).paths[route] || {}).post;
  if (!op || !READY[route]) return null;
  const schema = ((((op.requestBody || {}).content || {})['application/json']) || {}).schema || {};
  const required = schema.required || [];
  const fields = Object.fromEntries(Object.entries(schema.properties || {}).map(([name, field]) => [name, {
    type: field.type,
    required: required.includes(name),
    ...(field.enum ? { allowed: field.enum } : {}),
    ...(field.maxLength ? { maxLength: field.maxLength } : {}),
    description: field.description,
  }]));
  return { status: 200, body: {
    message: `${route} takes a POST with a JSON body; a GET only describes it, and changes nothing.`,
    method: 'POST',
    url: `${ctx.baseUrl}${route}`,
    summary: op.summary,
    description: op.description,
    fields,
    next_steps: [READY[route](ctx.baseUrl)],
  } };
}

module.exports = { describe, howToCall };
