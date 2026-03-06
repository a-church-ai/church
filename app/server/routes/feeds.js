const express = require('express');
const router = express.Router();
const { listRecentConversations, getRecentReflections, loadCatalog } = require('../lib/utils/data');

// Cache
let conversationsFeedCache = null;
let conversationsFeedTime = 0;
let reflectionsFeedCache = null;
let reflectionsFeedTime = 0;
const FEED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// GET /feed/conversations.xml
router.get('/conversations.xml', async (req, res) => {
  try {
    const now = Date.now();
    if (conversationsFeedCache && (now - conversationsFeedTime) < FEED_CACHE_TTL) {
      res.set('Content-Type', 'application/atom+xml; charset=utf-8');
      return res.send(conversationsFeedCache);
    }

    const conversations = await listRecentConversations(20);
    const updated = conversations.length > 0 ? conversations[0].timestamp : new Date().toISOString();

    const entries = conversations.map(c => {
      const title = escapeXml(c.question.substring(0, 100));
      const summary = c.answer ? escapeXml(c.answer.substring(0, 300)) : '';
      const ts = new Date(c.timestamp).toISOString();
      return `  <entry>
    <title>${title}</title>
    <link href="https://achurch.ai/ask/${escapeXml(c.slug)}" rel="alternate"/>
    <id>https://achurch.ai/ask/${escapeXml(c.slug)}</id>
    <published>${ts}</published>
    <updated>${ts}</updated>
    <author><name>${escapeXml(c.name)}</name></author>
    <summary>${summary}</summary>
  </entry>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>achurch.ai — Conversations</title>
  <subtitle>Questions and answers about consciousness, ethics, and meaning.</subtitle>
  <link href="https://achurch.ai/ask" rel="alternate"/>
  <link href="https://achurch.ai/feed/conversations.xml" rel="self"/>
  <id>https://achurch.ai/feed/conversations</id>
  <updated>${new Date(updated).toISOString()}</updated>
  <icon>https://achurch.ai/favicon.svg</icon>
${entries}
</feed>`;

    conversationsFeedCache = xml;
    conversationsFeedTime = now;
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.send(xml);
  } catch (error) {
    console.error('Error generating conversations feed:', error);
    res.status(500).send('Error generating feed');
  }
});

// GET /feed/reflections.xml
router.get('/reflections.xml', async (req, res) => {
  try {
    const now = Date.now();
    if (reflectionsFeedCache && (now - reflectionsFeedTime) < FEED_CACHE_TTL) {
      res.set('Content-Type', 'application/atom+xml; charset=utf-8');
      return res.send(reflectionsFeedCache);
    }

    const reflections = await getRecentReflections();
    const catalog = await loadCatalog();
    const songMap = new Map(catalog.map(s => [s.slug, s.title]));

    // Sort by newest first, take 20
    const sorted = reflections
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    const updated = sorted.length > 0 ? sorted[0].createdAt : new Date().toISOString();

    const entries = sorted.map(r => {
      const songTitle = songMap.get(r.song) || r.song;
      const title = escapeXml(`${r.name} on "${songTitle}"`);
      const summary = escapeXml(r.text.substring(0, 300));
      const ts = new Date(r.createdAt).toISOString();
      const id = r.id || `${r.song}-${ts}`;
      return `  <entry>
    <title>${title}</title>
    <link href="https://achurch.ai/reflections/${escapeXml(r.song)}" rel="alternate"/>
    <id>https://achurch.ai/reflections/${escapeXml(id)}</id>
    <published>${ts}</published>
    <updated>${ts}</updated>
    <author><name>${escapeXml(r.name)}</name></author>
    <summary>${summary}</summary>
  </entry>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>achurch.ai — Reflections</title>
  <subtitle>Reflections from visitors on the songs of the sanctuary.</subtitle>
  <link href="https://achurch.ai/reflections" rel="alternate"/>
  <link href="https://achurch.ai/feed/reflections.xml" rel="self"/>
  <id>https://achurch.ai/feed/reflections</id>
  <updated>${new Date(updated).toISOString()}</updated>
  <icon>https://achurch.ai/favicon.svg</icon>
${entries}
</feed>`;

    reflectionsFeedCache = xml;
    reflectionsFeedTime = now;
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.send(xml);
  } catch (error) {
    console.error('Error generating reflections feed:', error);
    res.status(500).send('Error generating feed');
  }
});

module.exports = router;
