/**
 * GET /og/v1/<type>/<key>.png: a page's share card (lib/og-cards.js).
 *
 * Types are ask (a conversation), song, and docs (a document's path, which may
 * contain slashes). A card exists only for a page that exists: anything else
 * is a 404, and nothing is ever drawn from the request's own text. HEAD is
 * answered too (Express serves it from the GET route), because some scrapers
 * ask HEAD first. Cache-Control is set with the site's other cache rules in
 * index.js. v1 is the design version: a redesign moves to v2, so platforms
 * that cached the old card fetch the new one.
 *
 * This replaces /api/og/*.svg, which no share platform could display.
 */

const express = require('express');
const { resolveCard, cardPng, squarePng } = require('../lib/og-cards');
const { sendNotFound } = require('../lib/utils/not-found');

const router = express.Router();

// The 512px square a recording shows on a lock screen (site-player.js), one
// per voiced section.
router.get(/^\/v1\/square\/([a-z]+)\.png$/, (req, res) => {
  const png = squarePng(req.params[0]);
  if (!png) return sendNotFound(req, res);
  res.type('image/png').send(png);
});

router.get(/^\/v1\/(ask|song|docs)\/(.+)\.png$/, async (req, res) => {
  const [type, key] = [req.params[0], req.params[1]];
  let card;
  try {
    card = await resolveCard(type, key);
  } catch (err) {
    console.error(`[og] could not resolve ${type}/${key}: ${err.message}`);
    return res.status(500).type('text/plain').send('Could not load this card');
  }
  if (!card) return sendNotFound(req, res);

  try {
    res.type('image/png').send(cardPng(card));
  } catch (err) {
    // A failed render is not a missing page: log it and say so, rather than
    // letting a broken card look like a 404 from outside.
    console.error(`[og] could not render ${type}/${key}: ${err.message}`);
    res.status(500).type('text/plain').send('Could not render this card');
  }
});

module.exports = router;
