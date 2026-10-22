const express = require('express');
const router = express.Router();
const { getRecentReflections, loadCatalog } = require('../lib/utils/data');
const { placedConversations } = require('../lib/utils/conversation-groups');
const { cache } = require('../lib/utils/cache');

// Each feed is built at most once in five minutes.
const FEED_CACHE_TTL = 5 * 60 * 1000;

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function buildConversationsFeed() {
  // Each links to where it lives (a gathered one, its place on its group's
  // page); its id is its own address, which never changes, so a reader never
  // sees an entry twice.
  // A held one (alone, its answer too short) is listed nowhere, here included.
  const conversations = (await placedConversations()).filter(c => !c.held).slice(0, 20);
  const updated = conversations.length > 0 ? conversations[0].timestamp : new Date().toISOString();

  const entries = conversations.map(c => {
    const title = escapeXml(c.question.substring(0, 100));
    const summary = c.answer ? escapeXml(c.answer.substring(0, 300)) : '';
    const ts = new Date(c.timestamp).toISOString();
    return `  <entry>
    <title>${title}</title>
    <link href="https://achurch.ai${escapeXml(c.path)}" rel="alternate"/>
    <id>https://achurch.ai/ask/${escapeXml(c.slug)}</id>
    <published>${ts}</published>
    <updated>${ts}</updated>
    <author><name>${escapeXml(c.name)}</name></author>
    <summary>${summary}</summary>
  </entry>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
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
}
const conversationsFeed = cache({ name: 'conversations feed', ttl: FEED_CACHE_TTL, load: buildConversationsFeed });

// GET /feed/conversations.xml
router.get('/conversations.xml', async (req, res) => {
  try {
    const xml = await conversationsFeed.get();
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.send(xml);
  } catch (error) {
    console.error('Error generating conversations feed:', error);
    res.status(500).send('Error generating feed');
  }
});

async function buildReflectionsFeed() {
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

  return `<?xml version="1.0" encoding="UTF-8"?>
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
}
const reflectionsFeed = cache({ name: 'reflections feed', ttl: FEED_CACHE_TTL, load: buildReflectionsFeed });

// GET /feed/reflections.xml
router.get('/reflections.xml', async (req, res) => {
  try {
    const xml = await reflectionsFeed.get();
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.send(xml);
  } catch (error) {
    console.error('Error generating reflections feed:', error);
    res.status(500).send('Error generating feed');
  }
});

module.exports = router;
