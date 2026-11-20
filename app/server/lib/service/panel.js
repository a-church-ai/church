/**
 * The service in the page itself, before any script runs: the home page's
 * panel and /attend's, drawn for a place unknown (UTC's service, as an agent
 * without a timezone attends it) by the browser's own drawing (service.js
 * fillPanel), run here in a DOM. A reader without JavaScript, and an agent
 * reading the page or its Markdown, gets the service: its name, its word, each
 * part with its Lyrics or Read link, and on /attend what it was made from and
 * what visitors left. In a browser, service.js draws the visitor's own
 * service over it, as it always has.
 *
 * The page then holds the service until UTC's slot ends (endsAt), and is kept
 * at the edge until then (server/index.js).
 *
 * Plan: site-monitor-findings-2026-11-20.md in the private repo.
 */

const domino = require('@mixmark-io/domino');
const { fillPanel, drawCount } = require('../../../client/public/service.js');
const { listeningService } = require('./listen');

/** A page's HTML with its service panels drawn, and when that service ends. */
async function withService(html, { at = new Date() } = {}) {
  if (!html.includes('data-service-panel')) return { html, endsAt: null };
  const service = await listeningService({ at });
  const doc = domino.createDocument(html);
  doc.querySelectorAll('[data-service-panel]').forEach(panel => fillPanel(panel, service));
  drawCount(doc, service.souls);
  return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, endsAt: service.endsAt };
}

module.exports = { withService };
