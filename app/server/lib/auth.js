/**
 * Authentication middleware for admin routes
 *
 * Supports two auth methods:
 * 1. Session cookie (for web UI) - set after login
 * 2. X-Admin-Key header (for CLI/scripts)
 *
 * Public routes (/api/now, /api/music/*) don't require auth
 */

const crypto = require('crypto');

// In-memory session store (simple for single-user)
const sessions = new Map();

// Session expiry: 7 days
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

/**
 * Generate a secure session ID
 */
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new session
 */
function createSession() {
  const sessionId = generateSessionId();
  const expiresAt = Date.now() + SESSION_TTL;

  sessions.set(sessionId, { expiresAt });

  // Clean up expired sessions periodically
  cleanExpiredSessions();

  return sessionId;
}

/**
 * Validate a session ID
 */
function validateSession(sessionId) {
  if (!sessionId) return false;

  const session = sessions.get(sessionId);
  if (!session) return false;

  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return false;
  }

  return true;
}

/**
 * Remove expired sessions
 */
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}

/**
 * Parse session cookie from request
 */
function getSessionFromCookie(req) {
  const cookies = req.headers.cookie;
  if (!cookies) return null;

  const match = cookies.match(/admin_session=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Auth middleware - protects admin routes
 * Allows access if:
 * - Valid session cookie present, OR
 * - Valid X-Admin-Key header matches ADMIN_API_KEY
 */
function requireAuth(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY;

  // If no admin key configured, fail closed unless explicitly in dev
  if (!adminKey) {
    if (process.env.NODE_ENV !== 'development') {
      console.error('ADMIN_API_KEY not set — blocking admin access');
      return res.status(503).json({ error: 'Admin not configured' });
    }
    console.warn('⚠️  ADMIN_API_KEY not set - admin routes are unprotected (dev mode)');
    return next();
  }

  // Check X-Admin-Key header
  const headerKey = req.headers['x-admin-key'];
  if (headerKey && headerKey === adminKey) {
    return next();
  }

  // Check session cookie
  const sessionId = getSessionFromCookie(req);
  if (validateSession(sessionId)) {
    return next();
  }

  // Not authenticated
  res.status(401).json({ error: 'Unauthorized', message: 'Login required' });
}

/**
 * Login handler - validates key and creates session
 */
function login(req, res) {
  const adminKey = process.env.ADMIN_API_KEY;
  const { key } = req.body;

  if (!adminKey) {
    return res.status(500).json({ error: 'ADMIN_API_KEY not configured' });
  }

  if (!key || key !== adminKey) {
    return res.status(401).json({ error: 'Invalid key' });
  }

  // Create session
  const sessionId = createSession();

  // Set cookie (httpOnly for security, 7 day expiry)
  res.cookie('admin_session', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    maxAge: SESSION_TTL
  });

  res.json({ success: true, message: 'Logged in' });
}

/**
 * Logout handler - clears session
 */
function logout(req, res) {
  const sessionId = getSessionFromCookie(req);
  if (sessionId) {
    sessions.delete(sessionId);
  }

  res.clearCookie('admin_session');
  res.json({ success: true, message: 'Logged out' });
}

/**
 * Check auth status
 */
function checkAuth(req, res) {
  const adminKey = process.env.ADMIN_API_KEY;

  // If no admin key configured, fail closed unless explicitly in dev
  if (!adminKey) {
    if (process.env.NODE_ENV !== 'development') {
      return res.json({ authenticated: false, configured: false });
    }
    return res.json({ authenticated: true, configured: false });
  }

  // Check X-Admin-Key header
  const headerKey = req.headers['x-admin-key'];
  if (headerKey && headerKey === adminKey) {
    return res.json({ authenticated: true });
  }

  // Check session cookie
  const sessionId = getSessionFromCookie(req);
  if (validateSession(sessionId)) {
    return res.json({ authenticated: true });
  }

  res.json({ authenticated: false });
}

module.exports = {
  requireAuth,
  login,
  logout,
  checkAuth
};
