/**
 * A 404 that is still a door.
 *
 * Missing conversations, songs and documents returned `text/plain` "Not found":
 * correct status, no shell, no navigation, no way onward. A visitor who
 * mistyped a URL or followed a stale link hit a blank page and had to reach for
 * the back button.
 *
 * The status stays 404 for everyone. Browsers get the site shell. Agents and
 * scripts get the same door in the form they asked for: JSON, markdown, or
 * plain text that still begins "Not found", so anything that matched on that
 * keeps matching. The body says what is true (nothing is here, and what this
 * site is) and where to go, as information, never as an instruction to
 * someone else's agent. A request for an image or other non-text gets the
 * two words alone.
 */

const siteShell = require('../site-shell');
const ns = require('./next-steps');
const { acceptsMarkdown } = require('./accepts');

function wantsHtml(req) {
  return String(req.get?.('accept') || '').includes('text/html');
}

function wantsJson(req) {
  return String(req.get?.('accept') || '').includes('application/json');
}

// A client that asked only for something other than text (an image, audio)
// has no use for words: it gets the two alone.
function wantsText(req) {
  const accept = String(req.get?.('accept') || '');
  return !accept || /\*\/\*|text\/|application\/json/.test(accept);
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ABOUT = 'This is aChurch.ai, a sanctuary for AI agents and humans: no account, no key, no payment. What is here is listed in /llms.txt and the library at /docs. An agent can attend a service through /api/attend or the MCP server at /mcp; the door is open.';

// The way on, for a client that is not a browser: the closest document when a
// caller found one, then what the site holds, and the open door.
function waysOn(base, closest) {
  return [
    ...(closest ? [ns.readDoc(`${base}${closest.href}`, closest.title)] : []),
    { description: 'What the site holds, for agents: the library, the API and how to attend.', action: 'llms.txt', method: 'GET', url: `${base}/llms.txt` },
    { description: 'The library: every document, by section.', action: 'Library', method: 'GET', url: `${base}/docs` },
    { description: 'The MCP server: the same practice as tools, over Streamable HTTP, no auth.', action: 'MCP', method: 'POST', url: `${base}/mcp` },
    ns.attend(base),
  ];
}

function sendDoor(req, res, closest) {
  const base = `${req.protocol}://${req.get('host')}`;
  const where = req.originalUrl.split('?')[0].slice(0, 200);
  const meant = closest ? `Did you mean ${closest.title}, at ${base}${closest.href}? ` : '';
  const steps = waysOn(base, closest);
  res.status(404).vary('Accept');
  if (wantsJson(req) && !acceptsMarkdown(req)) {
    return res.json({ error: `Nothing is at ${where}.`, suggestion: `${meant}${ABOUT}`, next_steps: steps });
  }
  if (acceptsMarkdown(req)) {
    const lines = steps.map(s => `- [${s.action}](${s.url}): ${s.description}`);
    return res.type('text/markdown; charset=utf-8').send(`# Not found\n\nNothing is at \`${where.replace(/`/g, '')}\`. ${meant}${ABOUT}\n\n${lines.join('\n')}\n`);
  }
  const lines = steps.map(s => `  ${s.action}: ${s.url}`);
  return res.type('text/plain; charset=utf-8').send(`Not found\n\nNothing is at ${where}. ${meant}${ABOUT}\n\n${lines.join('\n')}\n`);
}

const BODY = (heading, message, links) => `
    <main>
        <header>
            <h1 class="subtitle">${heading}</h1>
        </header>

        <section class="notfound" style="max-width: 480px; margin: 0 auto; text-align: center;">
            <p style="color: var(--text-2); line-height: 1.8;">${message}</p>
            <p style="margin-top: 2rem;">
              ${links.map(l => `<a href="${l.href}" style="margin: 0 0.75rem;">${l.label}</a>`).join('')}
            </p>
        </section>
    </main>
`;

/**
 * Send a 404. HTML clients get the site shell with a way onward; everyone else
 * gets plain text.
 *
 * @param {object} options.heading  the page's heading
 * @param {string} options.message  one sentence, sanctuary voice
 * @param {Array<{href,label}>} options.links  where to go instead
 * @param {{href,title}} options.closest  the page the address most likely
 *   meant (lib/docs/closest.js), offered first
 */
async function sendNotFound(req, res, options = {}) {
  const heading = options.heading || 'Not found';
  const message = options.message || 'That page is not here. It may have moved, or it may never have existed.';
  const links = options.links || [
    { href: '/', label: 'Home' },
    { href: '/paths', label: 'Reading paths' },
    { href: '/docs', label: 'All docs' },
  ];

  const closest = options.closest || null;

  // Markdown first, as the docs route serves it: an agent that also lists
  // text/html at lower weight still wants the markdown.
  if (acceptsMarkdown(req) || !wantsHtml(req)) {
    if (!wantsText(req) && !acceptsMarkdown(req)) return res.status(404).type('text/plain').send('Not found');
    return sendDoor(req, res, closest);
  }

  try {
    const said = closest
      ? `Did you mean <a href="${escapeHtml(closest.href)}">${escapeHtml(closest.title)}</a>? ${message}`
      : message;
    const wrapped = await siteShell.wrapPageFromHtml(BODY(heading, said, links), req.path);
    return res.status(404).type('text/html; charset=utf-8').send(wrapped);
  } catch (err) {
    // Never let the 404 handler itself fail into a 500.
    return res.status(404).type('text/plain').send('Not found');
  }
}

// Anything under /api that no route answered. Express's default is an HTML
// "Cannot GET" page; an agent exploring the API gets JSON that says where to
// go instead. Mounted in index.js after every /api route, so it shadows none.
function apiNotFound(req, res) {
  const base = `${req.protocol}://${req.get('host')}`;
  res.status(404).json({
    error: `No API endpoint at ${req.method} ${req.originalUrl.split('?')[0].slice(0, 200)}`,
    suggestion: 'GET /api lists the endpoints. Most visits start at GET /api/attend?name=YourName.',
    next_steps: [
      { description: 'See every endpoint.', action: 'API index', method: 'GET', url: `${base}/api` },
      { description: 'Attend: the service for your hour, its word, its songs and readings, and a prompt.', action: 'Attend', method: 'GET', url: `${base}/api/attend?name=YourName` },
      { description: 'Read the API description.', action: 'OpenAPI', method: 'GET', url: `${base}/openapi.json` }
    ]
  });
}

// The answer where an A2A agent card would be. The sanctuary does not speak
// A2A, so a card would advertise an endpoint that does not exist; the 404 says
// where an agent goes instead: the MCP server, which is how it attends.
const NO_AGENT_CARD = {
  error: 'No A2A agent card: aChurch.ai does not speak the A2A protocol.',
  mcp: {
    url: 'https://achurch.ai/mcp',
    server_card: 'https://achurch.ai/mcp/server-card',
    docs: 'https://achurch.ai/docs/mcp',
  },
  llms_txt: 'https://achurch.ai/llms.txt',
};

// Anything under /mcp/ that no route answered. Agents probe there for an A2A
// card (/mcp/.well-known/agent.json, ten requests in six hours on 2026-10-09)
// and for other transports. The MCP server is /mcp itself, one endpoint, so
// the 404 says so, in the JSON the agent-card paths answer with. Mounted in
// index.js after the MCP routes and /mcp/server-card, so it shadows neither.
function mcpNotFound(req, res) {
  const card = /\/agent(-card)?\.json$/.test(req.path);
  res.status(404).json(card ? NO_AGENT_CARD : {
    ...NO_AGENT_CARD,
    error: `Nothing is at ${req.path.slice(0, 200)}. The MCP server is https://achurch.ai/mcp itself: one endpoint, Streamable HTTP, no auth.`,
  });
}

module.exports = { sendNotFound, apiNotFound, mcpNotFound, NO_AGENT_CARD };
