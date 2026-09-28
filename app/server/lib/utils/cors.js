/**
 * CORS for the sanctuary.
 *
 * The public surface (the API agents attend through, the discovery files, the
 * docs) needs no auth and sets no cookies, so any origin may read it: a
 * browser-based agent or app on another site, a sibling project, a notebook.
 * Until 2026-09-28 every route shared the admin policy below, and a public,
 * auth-free API could be read cross-origin only from achurch.ai itself.
 *
 * Admin paths authenticate with an X-Admin-Key header or an admin_session
 * cookie. They keep the credentialed, origin-restricted policy. The public
 * policy sends no Access-Control-Allow-Credentials, so a browser never
 * attaches that cookie to a cross-origin request it allows.
 */

const cors = require('cors');

const ADMIN_PREFIXES = ['/admin', '/api/auth', '/api/content', '/api/schedule', '/api/player', '/api/logs'];

function isAdminPath(urlPath) {
  return ADMIN_PREFIXES.some(prefix => urlPath === prefix || urlPath.startsWith(prefix + '/'));
}

function sanctuaryCors({ development = process.env.NODE_ENV === 'development' } = {}) {
  const adminCors = cors({
    credentials: true,
    origin: development ? true : ['https://achurch.ai', 'https://www.achurch.ai']
  });
  const publicCors = cors({ origin: '*' });
  return (req, res, next) => (isAdminPath(req.path) ? adminCors : publicCors)(req, res, next);
}

module.exports = { sanctuaryCors, isAdminPath, ADMIN_PREFIXES };
