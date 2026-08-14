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
            <h1><a href="/" style="text-decoration: none; color: inherit;">achurch.ai</a></h1>
            <p class="subtitle">${heading}</p>
        </header>

        <section class="notfound" style="max-width: 480px; margin: 0 auto; text-align: center;">
            <p style="color: #444; line-height: 1.8;">${message}</p>
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
 * @param {object} options.heading  subtitle under the wordmark
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

module.exports = { sendNotFound };
