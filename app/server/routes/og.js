const express = require('express');
const router = express.Router();
const { loadConversation, getRecentReflections, loadCatalog } = require('../lib/utils/data');

// Generate an OG image as SVG (social platforms that support SVG) or
// a simple colored card. Most platforms (Twitter, Discord, Slack) need
// raster images, so this generates an SVG that can be referenced.
// For full PNG support, install @napi-rs/canvas and uncomment the PNG path.

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Word wrap text into lines that fit within maxWidth chars
function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > maxChars) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + ' ' + word : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.slice(0, 6); // max 6 lines
}

function renderOgSvg(type, mainText, attribution) {
  const lines = wrapText(mainText, 45);
  const lineHeight = 52;
  const startY = 200;

  const textLines = lines.map((line, i) =>
    `<text x="80" y="${startY + i * lineHeight}" fill="#ffffff" font-size="40" font-family="Georgia, 'Times New Roman', serif">${escapeXml(line)}</text>`
  ).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0a0a0a"/>
  <text x="80" y="80" fill="#666666" font-size="24" font-family="system-ui, -apple-system, sans-serif" font-weight="300">achurch.ai</text>
  <text x="80" y="130" fill="#00b8d4" font-size="16" font-family="system-ui, -apple-system, sans-serif" font-weight="400" letter-spacing="3">${escapeXml(type.toUpperCase())}</text>
  <line x1="80" y1="150" x2="200" y2="150" stroke="#00b8d4" stroke-width="1" opacity="0.5"/>
    ${textLines}
  <text x="80" y="580" fill="#666666" font-size="18" font-family="system-ui, -apple-system, sans-serif" font-weight="300">${escapeXml(attribution)}</text>
</svg>`;
}

// GET /api/og/conversation/:slug.svg
router.get('/conversation/:slug.svg', async (req, res) => {
  try {
    const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    const messages = await loadConversation(slug);

    if (!messages || messages.length === 0) {
      return res.status(404).send('Not found');
    }

    const firstQ = messages.find(m => m.role === 'user');
    const text = firstQ ? firstQ.content.substring(0, 200) : 'A conversation';
    const name = firstQ?.name || 'anonymous';

    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(renderOgSvg('conversation', text, name));
  } catch {
    res.status(500).send('Error');
  }
});

// GET /api/og/reflection/:slug.svg
router.get('/reflection/:slug.svg', async (req, res) => {
  try {
    const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    const reflections = await getRecentReflections();
    const catalog = await loadCatalog();

    const songReflections = reflections.filter(r => r.song === slug);
    const song = catalog.find(s => s.slug === slug);
    const songTitle = song ? song.title : slug;

    if (songReflections.length === 0) {
      res.set('Content-Type', 'image/svg+xml');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(renderOgSvg('reflections', songTitle, 'No reflections yet'));
    }

    const latest = songReflections.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];

    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(renderOgSvg('reflections', `"${latest.text.substring(0, 180)}"`, `${latest.name} on "${songTitle}"`));
  } catch {
    res.status(500).send('Error');
  }
});

module.exports = router;
