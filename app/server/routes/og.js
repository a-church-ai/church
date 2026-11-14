/**
 * GET /og/v1/<type>/<key>.png: a page's share card (lib/og-cards.js), and
 * the squares and covers the player and the podcasts show.
 *
 * Types are ask (a conversation), song, docs (a document's path, which may
 * contain slashes) and page (a page written by hand that has a card of its
 * own: for-agents). A card exists only for a page that exists: anything else
 * is a 404, and nothing is ever drawn from the request's own text. HEAD is
 * answered too (Express serves it from the GET route), because some scrapers
 * ask HEAD first. Cache-Control is set with the site's other cache rules in
 * index.js. The number is the design version: v2 (2026-10-27) brought the
 * listen card for every page with a recording, so platforms that cached the
 * old card fetch the new one. An address still asking for v1, held in a post
 * or a cache, is given the current card rather than nothing.
 *
 * This replaces /api/og/*.svg, which no share platform could display.
 */

const express = require('express');
const { resolveCard, cardPng, squarePng, podcastCoverPng, episodeCoverPng, EPISODE_COVER, SQUARE } = require('../lib/og-cards');
const { episodeAt, episodeCoverHash } = require('../lib/audio/podcasts');
const { sendNotFound } = require('../lib/utils/not-found');

const router = express.Router();

// The 512px square a recording shows on a lock screen (site-player.js), one
// per voiced section.
router.get(/^\/v1\/square\/([a-z]+)\.png$/, (req, res) => {
  const png = squarePng(req.params[0]);
  if (!png) return sendNotFound(req, res);
  res.type('image/png').send(png);
});

// A podcast's 3000px cover, one per show (lib/audio/podcasts.js coverPath).
// The v2 address, which the directories fetched before 2026-10-27, still
// answers, with the current cover, until they read the feed's v3.
router.get(/^\/v[23]\/podcast\/([a-z-]+)\.png$/, (req, res) => {
  const png = podcastCoverPng(req.params[0]);
  if (!png) return sendNotFound(req, res);
  res.type('image/png').send(png);
});

// An episode's own picture (lib/audio/podcasts.js episodeCoverPath): its
// 1400px cover under /podcast, the same picture as a 512px lock-screen square
// under /square. The address ends in a hash of what it is drawn from, and
// only the current one is served: an old hash is a 404, so an app that held
// it shows the show's cover rather than a picture of something else.
router.get(/^\/v1\/(podcast|square)\/(.+)-([0-9a-f]{8})\.png$/, async (req, res) => {
  const [kind, urlPath, hash] = [req.params[0], req.params[1], req.params[2]];
  let episode;
  try {
    episode = await episodeAt(urlPath);
  } catch (err) {
    console.error(`[og] could not resolve episode ${urlPath}: ${err.message}`);
    return res.status(500).type('text/plain').send('Could not load this picture');
  }
  if (!episode || !episode.recording.peaks || episodeCoverHash(episode.doc, episode.recording) !== hash) return sendNotFound(req, res);

  try {
    res.type('image/png').send(episodeCoverPng(episode.doc, episode.recording, kind === 'podcast' ? EPISODE_COVER : SQUARE));
  } catch (err) {
    console.error(`[og] could not render episode ${urlPath}: ${err.message}`);
    res.status(500).type('text/plain').send('Could not render this picture');
  }
});

router.get(/^\/v[12]\/(ask|song|docs|page)\/(.+)\.png$/, async (req, res) => {
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
