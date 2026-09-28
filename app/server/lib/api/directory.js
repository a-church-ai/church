/**
 * GET /api: the API's front door.
 */

const path = require('path');
const fs = require('fs').promises;
const ns = require('../utils/next-steps');

// GET /api - the API's front door: what the sanctuary is, and every endpoint
// with its method and summary. Built from openapi.json, the one description
// of the API, so the list cannot drift from it. Read once: it changes only by
// deploy.
let apiIndexCache = null;

async function apiIndex() {
  if (apiIndexCache) return apiIndexCache;
  const spec = JSON.parse(await fs.readFile(path.join(__dirname, '../../../client/public/openapi.json'), 'utf8'));
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


// Every endpoint, from openapi.json, with where to read more.
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
    return { status: 500, body: { error: 'Failed to build the API index', next_steps: [ns.attend(ctx.baseUrl)] } };
  }
}

module.exports = { describe };
