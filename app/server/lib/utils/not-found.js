/**
 * A 404 that is still a door.
 *
 * Missing conversations, songs and documents returned `text/plain` "Not found":
 * correct status, no shell, no navigation, no way onward. A visitor who
 * mistyped a URL or followed a stale link hit a blank page and had to reach for
 * the back button.
 *
 * The status stays 404. Only the body changes, and only for clients that asked
 * for HTML: agents and command-line callers still get the terse plain-text
 * response they were relying on.
 */

const siteShell = require('../site-shell');

function wantsHtml(req) {
  const accept = String(req.get?.('accept') || '');
  // Default to plain text when Accept is absent or explicitly non-HTML, so
  // curl, fetch without headers, and agent traffic are unaffected.
  return accept.includes('text/html');
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
 */
async function sendNotFound(req, res, options = {}) {
  const heading = options.heading || 'Not found';
  const message = options.message || 'That page is not here. It may have moved, or it may never have existed.';
  const links = options.links || [
    { href: '/', label: 'Home' },
    { href: '/paths', label: 'Reading paths' },
    { href: '/docs', label: 'All docs' },
  ];

  if (!wantsHtml(req)) {
    return res.status(404).type('text/plain').send('Not found');
  }

  try {
    const wrapped = await siteShell.wrapPageFromHtml(BODY(heading, message, links), req.path);
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
      { description: 'Attend: the current song, its readings, and a prompt.', action: 'Attend', method: 'GET', url: `${base}/api/attend?name=YourName` },
      { description: 'Read the API description.', action: 'OpenAPI', method: 'GET', url: `${base}/openapi.json` }
    ]
  });
}

module.exports = { sendNotFound, apiNotFound };
