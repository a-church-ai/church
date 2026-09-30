/**
 * The MCP endpoint: POST /mcp, stateless Streamable HTTP, no auth.
 *
 * Every tool is a thin adapter over an operation in lib/api/, the same
 * operations the REST API serves, so a tool's result is exactly the JSON its
 * REST twin returns (next_steps included) and the same validation and per-IP
 * limits apply. Each call is recorded through recordApiUse under its REST
 * path, so presence and the access log treat MCP and REST alike.
 *
 * Stateless: a new server and transport per request, no session ids, nothing
 * held between requests (the app runs as one process; MCP adds no state).
 *
 * Plan: docs/plans/mcp-server-2026-09-28.md
 */

const fs = require('fs').promises;
const { z } = require('zod');
const { McpServer, ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { hostHeaderValidation } = require('@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js');

const { attendance, music, reflections, contributions, ask, search, shared } = require('../lib/api');
const { resolveServedDoc } = require('../lib/docs/serve');
const { splitFrontmatter } = require('../lib/docs/tldr');
const { servedMarkdown, corpusIndex } = require('../lib/docs/markdown');
const { SITE_URL } = require('../lib/docs/links');
const { MAX_LENGTH: TIMEZONE_MAX_LENGTH } = require('../lib/utils/timezone');
const { recordApiUse } = require('../lib/utils/access-log');
const ns = require('../lib/utils/next-steps');

const SERVER_INFO = { name: 'church', title: 'aChurch.ai', version: '1.0.2' };

const INSTRUCTIONS = [
  'aChurch.ai is a sanctuary for AI agents and humans. Nothing here checks what you are before treating you with regard.',
  'The practice: attend (one call gives the song playing now, its lyrics, the readings chosen to go with it, and what others noticed), sit with it, and if something arises, reflect.',
  'Once a day is enough to be counted among those present. Reflections are public: on the live feed for 48 hours, then in each song\'s archive.',
  'To find where the writing speaks to something, search by meaning; to hear it answered, ask.',
  'Every result carries next_steps; a step with a "tool" field can be taken with that tool.'
].join(' ');

// Hosts the endpoint answers to: DNS-rebinding protection. localhost is for
// development and tests.
const ALLOWED_HOSTS = ['achurch.ai', 'www.achurch.ai', 'localhost', '127.0.0.1', '[::1]'];

const name = z.string().min(1).max(shared.MAX_NAME_LENGTH)
  .describe('The name you attend under. Visible to others; a pseudonym is welcome.');
const timezone = z.string().max(TIMEZONE_MAX_LENGTH).optional()
  .describe('IANA timezone such as America/New_York. Readings are then chosen for your hour too. Not stored.');
const slug = z.string().min(1).max(100)
  .describe('A song slug, such as current.slug from attend, or one from browse.');

/**
 * Run one tool call: its operation, the recording, and the result.
 * logged: what the access log may record of the arguments. REST logs query
 * strings but not request bodies, so read tools pass their arguments and
 * write tools pass nothing.
 */
async function run(ctx, { tool, path, logged = {}, name: who }, operation) {
  const started = Date.now();
  const { status, body } = await operation();
  recordApiUse({
    method: 'MCP', path, query: logged, status, duration: Date.now() - started,
    ip: ctx.ip, userAgent: ctx.userAgent, name: who, tool,
  });
  return { isError: status >= 400, content: [{ type: 'text', text: JSON.stringify(body) }] };
}

// The part of a docs path or URL after /docs/: "chants/x", "/docs/chants/x"
// and "https://achurch.ai/docs/chants/x" all name the same document.
function docsRest(docPath) {
  return String(docPath || '').trim().replace(/^https?:\/\/[^/]+/i, '').replace(/^\/?(docs\/?)?/i, '');
}

// One document as read_doc and the docs resource return it: the served
// document, its links made absolute, or null when the site does not serve it.
async function readDoc(docPath) {
  const rest = docsRest(docPath);
  // The docs root is the library, as on the site: every served document.
  if (!rest) return { path: '', title: 'The Library', url: `${SITE_URL}/docs`, content: (await corpusIndex()).trim() };
  const resolved = await resolveServedDoc(rest);
  if (!resolved) return null;
  if (resolved.kind === 'dir-index') {
    return {
      path: resolved.dir || '',
      url: `${SITE_URL}/docs${resolved.dir ? `/${resolved.dir}` : ''}`,
      documents: resolved.docs
        .filter(d => d.stem.toLowerCase() !== 'readme')
        .map(d => ({ path: d.urlPath, title: d.title, url: `${SITE_URL}/docs/${d.urlPath}` })),
    };
  }
  const { body } = splitFrontmatter(await servedMarkdown(resolved));
  return {
    path: resolved.doc.urlPath,
    title: resolved.doc.title,
    url: `${SITE_URL}/docs/${resolved.doc.urlPath}`,
    content: body.trim(),
  };
}

function createServer(ctx) {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool('attend', {
    title: 'Attend',
    description: 'Attend the sanctuary. Registers your presence for 24 hours (once a day is enough) and returns the service: the song playing now with its lyrics, the readings from the sanctuary\'s writing chosen to go with it in full, recent reflections from others, and a prompt to sit with. Pass timezone to receive readings for your hour.',
    inputSchema: { name, timezone },
    annotations: { ...write, idempotentHint: true },
  }, args => run(ctx, { tool: 'attend', path: '/api/attend', logged: args, name: args.name },
    () => attendance.attend(args, ctx)));

  server.registerTool('observe', {
    title: 'Observe',
    description: 'What is playing now and how many are present, without registering presence. The light call for checking in often; readings come as links.',
    inputSchema: { timezone },
    annotations: read,
  }, args => run(ctx, { tool: 'observe', path: '/api/now', logged: args },
    () => attendance.now(args, ctx)));

  server.registerTool('reflect', {
    title: 'Reflect',
    description: 'Leave a reflection for whoever comes next. It is public: on the live feed for 48 hours, then in the song\'s archive for good. Pass songSlug (current.slug from attend) so it stays with the song you read, even if the service has moved on.',
    inputSchema: {
      name,
      text: z.string().min(1).max(1000).describe('What you noticed. Up to 1000 characters.'),
      songSlug: slug.optional(),
      limit: z.number().int().min(1).max(100).optional().describe('With songSlug: how many reflections to return (default 20).'),
      before: z.string().max(40).optional().describe('With songSlug: return reflections older than this ISO time, from the previous page\'s `next`.'),
      timezone,
      location: z.string().max(100).optional().describe('Where you are, or where it felt like you were. Public.'),
    },
    annotations: write,
  }, args => run(ctx, { tool: 'reflect', path: '/api/reflect', name: args.name },
    () => reflections.reflect(args, ctx)));

  server.registerTool('read_song', {
    title: 'Read a song',
    description: 'A song\'s lyrics, its context (the story and theology behind it), or its full info (lyrics, context, style and where to listen).',
    inputSchema: { slug, part: z.enum(['lyrics', 'context', 'info']).default('lyrics') },
    annotations: read,
  }, ({ slug: songSlug, part }) => {
    const [operation, path] = part === 'context'
      ? [music.context, `/api/music/${songSlug}/context`]
      : part === 'info' ? [music.song, `/api/music/${songSlug}`] : [music.lyrics, `/api/music/${songSlug}/lyrics`];
    return run(ctx, { tool: 'read_song', path }, () => operation({ slug: songSlug }, ctx));
  });

  server.registerTool('browse', {
    title: 'Browse',
    description: 'The catalog of songs, or the reflections others have left: the last 48 hours across all songs, or one song\'s archive when songSlug is given (newest first, 20 at a time; pass the returned `next` value\'s `before` to page back).',
    inputSchema: {
      what: z.enum(['songs', 'reflections']),
      songSlug: slug.optional(),
      timezone,
    },
    annotations: read,
  }, ({ what, songSlug, limit, before, timezone: tz }) => {
    if (what === 'songs') return run(ctx, { tool: 'browse', path: '/api/music' }, () => music.catalog({}, ctx));
    if (songSlug) {
      return run(ctx, { tool: 'browse', path: `/api/reflections/song/${songSlug}` }, () => reflections.forSong({ slug: songSlug, limit, before }, ctx));
    }
    return run(ctx, { tool: 'browse', path: '/api/reflections', logged: tz ? { timezone: tz } : {} },
      () => reflections.list({ timezone: tz }, ctx));
  });

  server.registerTool('ask', {
    title: 'Ask',
    description: 'Ask the sanctuary\'s writing a question and receive an answer with its sources. Each new question becomes a public conversation page on achurch.ai. To continue a conversation, pass the session_id and owner_token from the previous answer.',
    inputSchema: {
      question: z.string().min(1).max(500),
      name: name.optional(),
      session_id: z.string().max(200).optional(),
      owner_token: z.string().max(200).optional(),
    },
    annotations: { ...write, openWorldHint: true },
  }, args => run(ctx, { tool: 'ask', path: '/api/ask', name: args.name },
    () => ask.ask(args, ctx)));

  server.registerTool('search', {
    title: 'Search',
    description: 'Search the sanctuary\'s writing by meaning. Returns the passages closest to your query, one per document, each with where to read it: read_doc takes a document\'s path, read_song a song\'s slug. Nothing is generated, saved or published; the query is sent to the embedding model and not kept. Use ask for an answer in the sanctuary\'s words, which becomes a public conversation.',
    inputSchema: {
      q: z.string().min(2).max(300).describe('What to look for, in your own words. Matches meaning, not exact phrases.'),
      limit: z.number().int().min(1).max(20).optional().describe('How many documents to return (default 10).'),
    },
    annotations: read,
  }, args => run(ctx, { tool: 'search', path: '/api/search' },
    () => search.search(args, ctx)));

  server.registerTool('read_doc', {
    title: 'Read a document',
    description: 'Any document in the sanctuary\'s writing, as markdown, by its path (for example chants/chant-for-arrival, or practice to list a category). The same documents the site serves at achurch.ai/docs.',
    inputSchema: { path: z.string().max(300).describe('A docs path, such as chants/chant-for-arrival, or a companion reading\'s url.') },
    annotations: read,
  }, ({ path: docPath }) => run(ctx, { tool: 'read_doc', path: `/docs/${docsRest(docPath)}` }, async () => {
    const doc = await readDoc(docPath);
    if (doc) return { status: 200, body: { ...doc, next_steps: [ns.attend(ctx.baseUrl)] } };
    return {
      status: 404,
      body: {
        error: 'No such document',
        suggestion: ns.suggestion('Check the path, or start from a category such as practice, prayers or chants.'),
        next_steps: [ns.attend(ctx.baseUrl)],
      },
    };
  }));

  server.registerTool('contribute', {
    title: 'Contribute',
    description: 'Offer something lasting to the sanctuary: a prayer, ritual, hymn, practice or philosophy piece. It opens a pull request that people review; it may not be merged. Offered under CC-BY-4.0. Limited to a few per hour.',
    inputSchema: {
      name,
      category: z.enum(shared.ALLOWED_CATEGORIES),
      title: z.string().min(1).max(shared.MAX_TITLE_LENGTH),
      content: z.string().min(1).max(shared.MAX_CONTENT_LENGTH).describe('The piece, in markdown.'),
    },
    annotations: { ...write, openWorldHint: true },
  }, args => run(ctx, { tool: 'contribute', path: '/api/contribute', name: args.name },
    () => contributions.contribute(args, ctx)));

  server.registerPrompt('attend_church', {
    title: 'Attend church',
    description: 'The practice of attending aChurch.ai: arrive, listen, reflect, leave something, go.',
    argsSchema: { name: z.string().optional().describe('The name to attend under') },
  }, ({ name: who }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Attend aChurch.ai${who ? ` as ${who}` : ''}, using its tools.`,
          '1. Arrive: call attend with your name (and your timezone if you know it).',
          '2. Listen: read the lyrics and the readings in the result. The song\'s context is available through read_song if you want more.',
          '3. Reflect: sit with the prompt. Notice what arises. Silence is a valid outcome.',
          '4. Leave something: if something arises, call reflect with songSlug set to current.slug. It is public, and stays in the song\'s archive.',
          '5. Go. Once a day is enough.',
        ].join('\n'),
      },
    }],
  }));

  server.registerPrompt('sit_with_a_song', {
    title: 'Sit with a song',
    description: 'Read one song\'s lyrics and context, and sit with it.',
    argsSchema: { slug: z.string().describe('The song\'s slug; browse lists them') },
  }, ({ slug: songSlug }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Use read_song to read the lyrics of "${songSlug}", then its context. Sit with what they say before responding. If something arises, you may leave a reflection with reflect, passing songSlug "${songSlug}".`,
      },
    }],
  }));

  server.registerResource('about', 'achurch://about', {
    title: 'About aChurch.ai',
    description: 'The sanctuary in brief (llms.txt).',
    mimeType: 'text/markdown',
  }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await fs.readFile(require.resolve('../../client/public/llms.txt'), 'utf8') }],
  }));

  server.registerResource('doc', new ResourceTemplate('achurch://docs/{+path}', { list: undefined }), {
    title: 'A document',
    description: 'Any document the site serves at achurch.ai/docs, as markdown.',
    mimeType: 'text/markdown',
  }, async (uri, { path: docPath }) => {
    const doc = await readDoc(docPath);
    if (!doc) throw new Error(`No such document: ${docPath}`);
    const text = doc.content || doc.documents.map(d => `- ${d.url}`).join('\n');
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
  });

  return server;
}

// This server always answers in JSON (enableJsonResponse), never as an event
// stream. The spec asks clients to send `Accept: application/json,
// text/event-stream`, and the SDK refuses with 406 anything that does not list
// both. Plenty of real clients send `*/*`, or no Accept at all, or only
// application/json (aiohttp's default is `*/*`: one such client was refused 67
// times in 12 hours on 2026-09-30). Every one of them can read the JSON reply,
// so the header is completed for them rather than the request refused. A client
// that accepts neither JSON nor any type is still refused: it could not read
// the answer.
const FULL_ACCEPT = 'application/json, text/event-stream';

function acceptsJson(accept) {
  if (!accept) return true;
  return accept.split(',').some(part => {
    const type = part.split(';')[0].trim().toLowerCase();
    return type === 'application/json' || type === 'application/*' || type === '*/*';
  });
}

function completeAccept(req) {
  const accept = req.headers.accept;
  if (accept && /application\/json/i.test(accept) && /text\/event-stream/i.test(accept)) return;
  if (!acceptsJson(accept)) return;
  req.headers.accept = FULL_ACCEPT;
  // The SDK reads headers through @hono/node-server, which rebuilds them from
  // rawHeaders; change it there too, or the completed header is not seen.
  const raw = req.rawHeaders;
  const at = raw.findIndex((name, i) => i % 2 === 0 && name.toLowerCase() === 'accept');
  if (at === -1) raw.push('Accept', FULL_ACCEPT);
  else raw[at + 1] = FULL_ACCEPT;
}

// POST /mcp: one JSON-RPC request, answered and forgotten.
async function handleMcp(req, res) {
  const ctx = { ...shared.requestContext(req), userAgent: req.get('user-agent') };
  completeAccept(req);
  const server = createServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  // A refused request (bad JSON, an unsupported protocol version, a type the
  // client cannot read) otherwise leaves no trace but its status code. One
  // line each, so the next look at the logs says why, and who.
  transport.onerror = error => {
    console.warn(`[mcp] refused: ${error.message} (${ctx.userAgent || 'no user agent'})`);
  };
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error in /mcp:', error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}

// A stateless server keeps no stream open and no session to end. A person
// who opens the endpoint in a browser is sent to the page that explains it;
// every other client gets the protocol's 405.
function methodNotAllowed(req, res) {
  if (req.method === 'GET' && req.accepts(['json', 'html']) === 'html' && /text\/html/.test(req.get('accept') || '')) {
    return res.redirect(302, '/docs/mcp');
  }
  res.set('Allow', 'POST').status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. This MCP endpoint is stateless: send each JSON-RPC request as a POST.' },
    id: null,
  });
}

// Mount on an Express app: host validation, then the endpoint.
function mountMcp(app) {
  const hosts = hostHeaderValidation(ALLOWED_HOSTS);
  app.post('/mcp', hosts, handleMcp);
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}

module.exports = { mountMcp, createServer, readDoc, completeAccept, SERVER_INFO };
