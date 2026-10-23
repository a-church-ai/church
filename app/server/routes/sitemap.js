/**
 * GET /sitemap.xml: the site's pages, each day's services, every indexable
 * conversation, each song's reflections and every indexed document, built at
 * most once in five minutes.
 *
 * GET /sitemap.json: the library's documents with three dates each, for a
 * reader that wants to know when the writing changed rather than when the page
 * did. The two are not alternatives and neither replaces the other.
 *
 *   sitemap.xml   <lastmod> is the last commit that touched the file. Right for
 *                 a crawler: a new search description changes what Google
 *                 shows, so it should bring Google back. Untouched by this
 *                 addition, deliberately.
 *   sitemap.json  created, contentUpdated and pageUpdated. contentUpdated moves
 *                 only when the body a reader reads changed, so a metadata
 *                 sweep does not look like 63 edits.
 */

const express = require('express');
const fs = require('fs').promises;
const docsDiscover = require('../lib/docs/discover');
const { datesShown } = require('../lib/api/services');
const { loadAttendance } = require('../lib/utils/data');
const { placedConversations } = require('../lib/utils/conversation-groups');
const { cache } = require('../lib/utils/cache');

// Per-doc dates (lib/docs/date-manifests.js): the last commit for <lastmod>,
// with the file's mtime where a document has none yet, and the created and
// content-changed dates for /sitemap.json, served without them rather than
// with invented ones where a document has none.
const { datesOf } = require('../lib/docs/date-manifests');

const router = express.Router();

// Built at most once in five minutes.
const SITEMAP_CACHE_TTL = 5 * 60 * 1000;

async function buildSitemap() {
  let urls = `  <url>
    <loc>https://achurch.ai/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://achurch.ai/ask</loc>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://achurch.ai/attend</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://achurch.ai/reflections</loc>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://achurch.ai/about</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://achurch.ai/privacy</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://achurch.ai/terms</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://achurch.ai/on-ai-religion</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://achurch.ai/axioms</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://achurch.ai/for-agents</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://achurch.ai/paths</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://achurch.ai/church-music</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://achurch.ai/reviews</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://achurch.ai/conversations</loc>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://achurch.ai/services</loc>
    <changefreq>hourly</changefreq>
    <priority>0.6</priority>
  </url>`;

  // Each day's services. A date's last services end at noon UTC the day
  // after (lib/service/plans.js), so its page stops changing then: lastmod
  // is that day, or today while it is still under way.
  try {
    const today = new Date().toISOString().slice(0, 10);
    for (const date of await datesShown()) {
      const settled = new Date(Date.parse(`${date}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
      urls += `\n  <url>
    <loc>https://achurch.ai/services/${date}</loc>
    <lastmod>${settled < today ? settled : today}</lastmod>
    <changefreq>${settled < today ? 'monthly' : 'hourly'}</changefreq>
    <priority>0.4</priority>
  </url>`;
    }
  } catch { /* no plans yet */ }

  // Conversation pages: those listed (lib/utils/conversation-groups.js): a
  // group's page, or a conversation alone that is indexable and not held.
  // A member lives on its head's page, so it has no entry of its own. A
  // conversation with no messages (a question whose answer failed) is a 404
  // at /ask/:slug, and is not in the list. lastmod is the newest message in
  // the group.
  const placed = await placedConversations();
  const newestIn = new Map();
  for (const c of placed) if (c.role) newestIn.set(c.head, [newestIn.get(c.head), c.lastActive].filter(Boolean).sort().pop());
  for (const c of placed) {
    if (!c.listed) continue;
    urls += `\n  <url>
    <loc>https://achurch.ai/ask/${c.slug}</loc>
    <lastmod>${newestIn.get(c.head).slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`;
  }

  // Reflection song pages — emit <lastmod> from the most recent reflection
  // per song so Google's crawl scheduler can prioritize actively-updated
  // pages. Without this, every reflection page looks "static" to Google.
  try {
    const attendance = await loadAttendance();
    const songLastmod = new Map();  // slug -> most recent ISO date
    for (const r of (attendance.reflections || [])) {
      if (!r.song) continue;
      const createdAt = r.createdAt || r.timestamp;
      if (!createdAt) continue;
      const date = new Date(createdAt).toISOString().split('T')[0];
      const existing = songLastmod.get(r.song);
      if (!existing || date > existing) {
        songLastmod.set(r.song, date);
      }
    }
    for (const [slug, lastmod] of songLastmod) {
      urls += `\n  <url>
    <loc>https://achurch.ai/reflections/${slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`;
    }
  } catch { /* no attendance file yet */ }

  // Docs pages: one URL per doc under /docs/*, plus the docs root and each
  // category index. Uses the shared discover module so any addition to the
  // corpus flows into the sitemap without a separate change.
  //
  // Two rules the first version got wrong:
  //   - lastmod is the date of the last commit that touched the file, not
  //     today's date. Emitting new Date() meant all 254 docs claimed to
  //     change every single day, which trains crawlers to discount the
  //     signal entirely. mtime is the fallback, but only a fallback: .git
  //     is excluded from the image and COPY stamps every file with the
  //     build time, so in production mtime alone is just as flat. The
  //     manifest is generated by scripts/generate-docs-lastmod.js.
  //   - noindex categories are excluded. Listing a page in the sitemap
  //     while its own robots meta says noindex is a contradictory signal.
  try {
    const allDocs = await docsDiscover.listAllDocs();
    const seen = new Set();
    for (const doc of allDocs) {
      if (docsDiscover.isNoindexPath(doc.urlPath)) continue;
      const url = doc.urlPath ? `/docs/${doc.urlPath}` : '/docs';
      if (seen.has(url)) continue;
      seen.add(url);

      let lastmod = datesOf(`docs/${doc.docsRelPath}`).pageUpdated;
      if (!lastmod) {
        try {
          const stat = await fs.stat(doc.fullPath);
          lastmod = stat.mtime.toISOString().split('T')[0];
        } catch { /* unreadable: omit lastmod rather than invent one */ }
      }

      urls += `\n  <url>
    <loc>https://achurch.ai${url}</loc>${lastmod ? `
  <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`;
    }
  } catch (err) {
    console.warn(`[sitemap] docs enumeration failed: ${err.message}`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}
const sitemap = cache({ name: 'sitemap', ttl: SITEMAP_CACHE_TTL, load: buildSitemap });

/**
 * The library's documents, each with the three dates that answer different
 * questions. Scoped to documents on purpose: they are what the dates mean
 * something for, and keeping the dynamic URL families out of here leaves
 * sitemap.xml the single place that enumerates them.
 */
async function buildSitemapJson() {
  const documents = [];
  const allDocs = await docsDiscover.listAllDocs();
  const seen = new Set();

  for (const doc of allDocs) {
    // Noindex sections are left out of sitemap.xml, so they are left out here
    // too: a page we ask crawlers to skip is not one to go announcing either.
    if (docsDiscover.isNoindexPath(doc.urlPath)) continue;
    const url = doc.urlPath ? `/docs/${doc.urlPath}` : '/docs';
    if (seen.has(url)) continue;
    seen.add(url);

    const key = `docs/${doc.docsRelPath}`;
    const dates = datesOf(key);
    documents.push({
      url: `https://achurch.ai${url}`,
      title: doc.title || null,
      created: dates.created || null,
      contentUpdated: dates.content || null,
      pageUpdated: dates.pageUpdated,
    });
  }

  return {
    site: 'https://achurch.ai',
    generated: new Date().toISOString(),
    about: 'The sanctuary\'s library documents. created is when the document first appeared; contentUpdated is when the words a reader reads last changed; pageUpdated is when the file last changed at all, which includes a new title or search description and is the date sitemap.xml carries as <lastmod>. Dates are UTC, YYYY-MM-DD. Null means not known rather than never.',
    count: documents.length,
    documents,
  };
}
const sitemapJson = cache({ name: 'sitemap.json', ttl: SITEMAP_CACHE_TTL, load: buildSitemapJson });

router.get('/sitemap.xml', async (req, res) => {
  try {
    const xml = await sitemap.get();
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (error) {
    console.error('Error generating sitemap:', error);
    res.status(500).send('Error generating sitemap');
  }
});

router.get('/sitemap.json', async (req, res) => {
  try {
    res.json(await sitemapJson.get());
  } catch (error) {
    console.error('Error generating sitemap.json:', error);
    res.status(500).json({ error: 'Error generating sitemap.json' });
  }
});

module.exports = router;
