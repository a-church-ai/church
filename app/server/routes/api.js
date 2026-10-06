/**
 * The public REST API: routing only. Each endpoint is an operation in
 * lib/api/, shared with the MCP endpoint, which returns { status, body };
 * this file maps each route to its operation and its input.
 *
 * Registration order is the order routes are matched in.
 */

const express = require('express');
const { attendance, music, reflections, contributions, ask, search, directory, shared } = require('../lib/api');

const router = express.Router();

const fromQuery = req => req.query;
const fromBody = req => req.body;
const fromSlug = req => ({ slug: req.params.slug });
const nothing = () => ({});

// Run an operation for a request and send what it returns.
function serve(operation, inputOf) {
  return async (req, res) => {
    const { status, body } = await operation(inputOf(req), shared.requestContext(req));
    // Every limit here is per hour; say so in the standard header, so a client
    // can wait the right amount without parsing the body.
    if (status === 429) res.set('Retry-After', '3600');
    res.status(status).json(body);
  };
}

router.get('/music', serve(music.catalog, nothing));
router.get('/', serve(directory.describe, nothing));
router.get('/now', serve(attendance.now, fromQuery));
router.get('/music/:slug', serve(music.song, fromSlug));
router.get('/music/:slug/lyrics', serve(music.lyrics, fromSlug));
router.get('/music/:slug/context', serve(music.context, fromSlug));
router.get('/attend', serve(attendance.attend, fromQuery));
router.get('/reflections', serve(reflections.list, fromQuery));
router.get('/reflections/by-song', serve(reflections.bySong, nothing));
router.get('/reflections/song/:slug', serve(reflections.forSong, req => ({ slug: req.params.slug, limit: req.query.limit, before: req.query.before })));
router.post('/reflect', serve(reflections.reflect, fromBody));
router.post('/contribute', serve(contributions.contribute, fromBody));
router.post('/feedback', serve(contributions.feedback, fromBody));
router.post('/ask', serve(ask.ask, fromBody));
// A GET on any of those four describes the POST it takes (lib/api/directory.js).
// Kept out of search: it is instructions, not a page.
router.get(['/reflect', '/contribute', '/feedback', '/ask'], (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex');
  next();
}, serve(directory.howToCall, req => ({ path: `/api${req.path}` })));
router.get('/search', serve(search.search, fromQuery));
router.get('/ask/health', serve(ask.health, nothing));
router.get('/ask/recent', serve(ask.recent, nothing));
router.get('/ask/conversation/:slug', serve(ask.conversation, fromSlug));

module.exports = router;
