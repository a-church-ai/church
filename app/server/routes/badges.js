const express = require('express');
const router = express.Router();
const { countSoulsPresent, getRecentReflections } = require('../lib/utils/data');
const coordinator = require('../lib/streamers/coordinator');
const { escapeAttr } = require('../lib/utils/page-meta');

// The label and color come from the query string, and an SVG opened on its
// own runs as a document on this origin: the text is escaped, a label kept
// to a badge's length, and a color must be hex.
const DEFAULT_COLOR = '00b8d4';
const labelFrom = (query, fallback) => String(query.label || fallback).slice(0, 40);
const colorFrom = query => (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(query.color || '') ? query.color : DEFAULT_COLOR);

// Measure text width (approximate, for shields.io-style badges)
function textWidth(text) {
  // Average character width at 11px Verdana ≈ 6.8px, plus padding
  return Math.ceil(text.length * 6.8) + 10;
}

function renderBadge(rawLabel, rawValue, color = DEFAULT_COLOR) {
  const labelW = textWidth(rawLabel);
  const valueW = textWidth(rawValue);
  const totalW = labelW + valueW;
  const label = escapeAttr(rawLabel);
  const value = escapeAttr(rawValue);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="#${color}"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text aria-hidden="true" x="${labelW / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelW / 2}" y="14">${label}</text>
    <text aria-hidden="true" x="${labelW + valueW / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelW + valueW / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

// GET /api/badge/souls.svg
router.get('/souls.svg', async (req, res) => {
  try {
    const souls = await countSoulsPresent();
    const label = labelFrom(req.query, 'achurch.ai');
    const value = `${souls} ${souls === 1 ? 'soul' : 'souls'}`;
    const color = colorFrom(req.query);

    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'max-age=300, s-maxage=300');
    res.send(renderBadge(label, value, color));
  } catch {
    res.set('Content-Type', 'image/svg+xml');
    res.send(renderBadge('achurch.ai', 'error', 'e05d44'));
  }
});

// GET /api/badge/reflections.svg
router.get('/reflections.svg', async (req, res) => {
  try {
    const reflections = await getRecentReflections();
    const label = labelFrom(req.query, 'reflections');
    const value = `${reflections.length}`;
    const color = colorFrom(req.query);

    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'max-age=300, s-maxage=300');
    res.send(renderBadge(label, value, color));
  } catch {
    res.set('Content-Type', 'image/svg+xml');
    res.send(renderBadge('reflections', 'error', 'e05d44'));
  }
});

// GET /api/badge/status.svg: a service is always under way, so the sanctuary
// is always in session; "live" only if the dormant broadcast is revived.
router.get('/status.svg', async (req, res) => {
  try {
    const youtubeStreamer = coordinator.getStreamer('youtube');
    const twitchStreamer = coordinator.getStreamer('twitch');
    const isLive = (youtubeStreamer && youtubeStreamer.isStreaming) ||
                   (twitchStreamer && twitchStreamer.isStreaming);

    const label = labelFrom(req.query, 'achurch.ai');
    const value = isLive ? 'live' : 'in session';
    const color = isLive ? '44cc11' : DEFAULT_COLOR;

    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'max-age=300, s-maxage=300');
    res.send(renderBadge(label, value, color));
  } catch {
    res.set('Content-Type', 'image/svg+xml');
    res.send(renderBadge('achurch.ai', 'error', 'e05d44'));
  }
});

module.exports = router;
