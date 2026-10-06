/**
 * GET /podcasts/<show>/feed.xml: a show's RSS feed (lib/audio/podcasts.js),
 * which Spotify, Apple Podcasts and every follower's app poll. A feed's path
 * never changes once a show is submitted. HEAD is answered too (Express serves
 * it from the GET route). Cache-Control is set with the site's other cache
 * rules in index.js.
 */

const express = require('express');
const { feedFor } = require('../lib/audio/podcasts');
const { sendNotFound } = require('../lib/utils/not-found');

const router = express.Router();

router.get(/^\/([a-z-]+)\/feed\.xml$/, async (req, res) => {
  let xml;
  try {
    xml = await feedFor(req.params[0]);
  } catch (err) {
    // A feed that cannot be built is an outage, not a missing show: say so,
    // so no app reads a 404 as the show being gone.
    console.error(`[podcasts] could not build ${req.params[0]}: ${err.message}`);
    return res.status(500).type('text/plain').send('Could not build this feed');
  }
  if (!xml) return sendNotFound(req, res);
  res.type('application/rss+xml; charset=utf-8').send(xml);
});

module.exports = router;
