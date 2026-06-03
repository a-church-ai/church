const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs').promises;
const dotenv = require('dotenv');
const { safeReadJSON, safeWriteJSON } = require('./lib/utils/safe-json');

// Load environment variables
dotenv.config();

// API access logging
const ACCESS_LOG_FILE = path.join(__dirname, '../data/api-access.jsonl');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

async function logApiAccess(entry) {
  const line = JSON.stringify(entry) + '\n';
  try {
    // Check file size and rotate if needed
    try {
      const stats = await fs.stat(ACCESS_LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const rotatedPath = ACCESS_LOG_FILE.replace('.jsonl', `-${Date.now()}.jsonl`);
        await fs.rename(ACCESS_LOG_FILE, rotatedPath);
      }
    } catch {
      // File doesn't exist yet, that's fine
    }
    await fs.appendFile(ACCESS_LOG_FILE, line);
  } catch (error) {
    console.error('Failed to log API access:', error.message);
  }
}

async function loadAccessLogs(limit = 100) {
  try {
    const content = await fs.readFile(ACCESS_LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    // Return most recent entries (file is append-only, so take from end)
    return lines.slice(-limit).reverse().map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// Import routes
const contentRoutes = require('./routes/content');
const scheduleRoutes = require('./routes/schedule');
const playerRoutes = require('./routes/player-multistream');
const apiRoutes = require('./routes/api');
const logsRoutes = require('./routes/logs');
const badgeRoutes = require('./routes/badges');
const feedRoutes = require('./routes/feeds');
const ogRoutes = require('./routes/og');
const { requireAuth, login, logout, checkAuth } = require('./lib/auth');
const cookieParser = require('cookie-parser');
const coordinator = require('./lib/streamers/coordinator');
const { loadConversation, getRecentReflections, loadCatalog } = require('./lib/utils/data');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false // allow inline scripts in admin dashboard
}));

// Permissions-Policy header — helmet does NOT include this in defaults.
// Family standard per ADR-008 + Issue 005 F35 verifier coverage. Matches
// magnifica + wwjd values (browsing-topics is the current Topics API opt-out,
// replacing the deprecated FLoC interest-cohort directive per Issue 005 F32).
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  next();
});

// Cache-Control — family-wide policy per Plan 04a Task #4.
// Ensures consistent cache behavior across deploys and avoids stale-review issues.
// Express pattern: set headers early, before response is sent.
app.use((req, res, next) => {
  const p = req.path;

  // Discovery files — short cache so updates propagate quickly after deploy
  if (p === '/llms.txt' || p === '/llms-full.txt' || p === '/robots.txt') {
    res.set('Cache-Control', 'public, max-age=600, must-revalidate, stale-while-revalidate=3600');
  }
  // Static assets — daily cache with revalidation
  else if (p === '/og-image.png' || p === '/favicon.svg' || p === '/manifest.webmanifest') {
    res.set('Cache-Control', 'public, max-age=86400, must-revalidate');
  }
  // .well-known — daily cache with revalidation
  else if (p.startsWith('/.well-known/')) {
    res.set('Cache-Control', 'public, max-age=86400, must-revalidate');
  }
  // HTML pages — no browser cache, short edge cache, SWR for graceful deploys
  // Catches routes without extensions or .html/.htm (but not /api/ or /media/ or /thumbnails/)
  else if (!p.startsWith('/api/') && !p.startsWith('/media/') && !p.startsWith('/thumbnails/') && !p.startsWith('/admin') && (/\.(html?)?$/.test(p) || !p.includes('.'))) {
    res.set('Cache-Control', 'public, max-age=0, s-maxage=300, must-revalidate, stale-while-revalidate=3600');
  }
  // Note: /api/ endpoints have their own caching handled in their route handlers
  // Note: /media/ and /thumbnails/ are served via express.static without cache-control override

  next();
});

app.use(cors({
  credentials: true,
  origin: process.env.NODE_ENV === 'development'
    ? true
    : ['https://achurch.ai', 'https://www.achurch.ai']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve public landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

// Serve admin dashboard at /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/admin.html'));
});

// Serve conversations listing page
app.get('/ask', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/ask.html'));
});

// Serve individual conversation pages with dynamic OG tags
app.get('/ask/:slug', async (req, res) => {
  try {
    const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    let html = await fs.readFile(path.join(__dirname, '../client/public/conversation.html'), 'utf8');

    const messages = await loadConversation(slug);
    if (messages && messages.length > 0) {
      const firstQ = messages.find(m => m.role === 'user');
      const firstA = messages.find(m => m.role === 'assistant');
      if (firstQ) {
        const title = firstQ.content.substring(0, 60) + ' — achurch.ai';
        const desc = firstQ.content.substring(0, 200);
        const safeTitle = title.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const safeDesc = desc.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const ogImage = `https://achurch.ai/api/og/conversation/${slug}.svg`;
        const canonicalUrl = `https://achurch.ai/ask/${slug}`;

        // F2: also inject <title>, <meta name="description">, <link rel="canonical">
        // so non-JS crawlers and LLM agents see per-page metadata, not the generic static template.
        // F6 (Issue 005): also update Twitter Card meta so Twitter shares display the
        // per-conversation title/description/image rather than the hardcoded generic template.
        html = html
          .replace(
            '<title>Conversation — achurch.ai</title>',
            `<title>${safeTitle}</title>`
          )
          .replace(
            '<meta name="description" content="A conversation with the sanctuary about consciousness, ethics, and meaning.">',
            `<meta name="description" content="${safeDesc}">`
          )
          .replace(
            '<meta property="og:title" content="Conversation — achurch.ai">',
            `<meta property="og:title" content="${safeTitle}">`
          )
          .replace(
            '<meta property="og:description" content="A conversation with the sanctuary about consciousness, ethics, and meaning.">',
            `<meta property="og:description" content="${safeDesc}">`
          )
          .replace(
            '<meta property="og:type" content="article">',
            `<meta property="og:type" content="article">\n    <meta property="og:image" content="${ogImage}">\n    <meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">\n    <meta property="og:url" content="${canonicalUrl}">\n    <link rel="canonical" href="${canonicalUrl}">`
          )
          .replace(
            '<meta name="twitter:title" content="Conversation — achurch.ai">',
            `<meta name="twitter:title" content="${safeTitle}">`
          )
          .replace(
            '<meta name="twitter:description" content="A conversation with the sanctuary about consciousness, ethics, and meaning.">',
            `<meta name="twitter:description" content="${safeDesc}">`
          )
          .replace(
            '<meta name="twitter:image" content="https://achurch.ai/assets/a-church-digital-ai-humans-social.jpg">',
            `<meta name="twitter:image" content="${ogImage}">`
          );

        // QAPage JSON-LD — Question + AcceptedAnswer when an assistant response exists.
        // High-leverage structural fix per Issue 004 Appendix A: gives LLMs the Q&A shape they index.
        //
        // Safety note: user content is interpolated INSIDE a <script> tag. The escape must
        // (a) preserve JSON string syntax (\\, \", \n, \r, \t) AND
        // (b) prevent the user content from terminating the <script> wrapper via "</script>"
        // (c) prevent JSON line-separator characters (U+2028, U+2029) from breaking JS parsing.
        //
        // Cross-repo coordination note (Issue 005 F23):
        // This function is a functional duplicate of magnifica's safeStringify at
        // magnifica-family/src/lib/seo/jsonld.ts:118 (covering the overlapping escape
        // classes). The duplication is intentional (cross-repo portability; no shared
        // family npm package yet); if you change escape behavior here, mirror the
        // change in the magnifica repo so JSON-LD escape semantics stay consistent
        // across the family. Rationale + option-A decision:
        // docs/issues/005-plan-003-code-review-2026-06-02.md#f23 (in the umbrella).
        //
        // Pitfall reference: docs/observations/js-source-line-terminator-pitfall.md
        // (use \u escape sequences via new RegExp(...) form when matching U+2028/U+2029).
        const escapeJsonLdString = (s) => s
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t')
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e')
          .replace(new RegExp('\u2028', 'g'), '\\u2028')
          .replace(new RegExp('\u2029', 'g'), '\\u2029');
        const qaQuestion = escapeJsonLdString(firstQ.content).substring(0, 1000);
        const qaAnswer = firstA ? escapeJsonLdString(firstA.content).substring(0, 4000) : '';
        const qaPageLd = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "QAPage",
  "@id": "${canonicalUrl}#qapage",
  "url": "${canonicalUrl}",
  "mainEntity": {
    "@type": "Question",
    "name": "${qaQuestion}",
    "text": "${qaQuestion}",
    "answerCount": ${firstA ? 1 : 0}${firstA ? `,
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "${qaAnswer}",
      "author": {
        "@type": "Organization",
        "name": "aChurch.ai RAG",
        "url": "https://achurch.ai/"
      }
    }` : ''}
  },
  "isPartOf": {
    "@type": "WebSite",
    "@id": "https://achurch.ai/#website"
  }
}
</script>
    </head>`;
        html = html.replace('</head>', qaPageLd);
      }
    }

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch {
    res.sendFile(path.join(__dirname, '../client/public/conversation.html'));
  }
});

// Serve reflections listing page
app.get('/reflections', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/reflections.html'));
});

// Serve song reflection detail pages with dynamic OG tags
app.get('/reflections/:slug', async (req, res) => {
  try {
    const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    let html = await fs.readFile(path.join(__dirname, '../client/public/reflection-song.html'), 'utf8');

    const catalog = await loadCatalog();
    const song = catalog.find(s => s.slug === slug);
    if (song) {
      const title = song.title + ' — Reflections — achurch.ai';
      const desc = `Reflections on "${song.title}" from the sanctuary.`;
      const safeTitle = title.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const safeDesc = desc.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const ogImage = `https://achurch.ai/api/og/reflection/${slug}.svg`;
      const canonicalUrl = `https://achurch.ai/reflections/${slug}`;

      // F2: also inject <title>, <meta name="description">, <link rel="canonical">
      // so non-JS crawlers see per-song metadata, not the generic static template.
      // F6 (Issue 005): also update Twitter Card meta so Twitter shares display the
      // per-song title/description/image rather than the hardcoded generic template.
      html = html
        .replace(
          '<title>Reflections — achurch.ai</title>',
          `<title>${safeTitle}</title>`
        )
        .replace(
          '<meta name="description" content="Reflections on a song from the sanctuary.">',
          `<meta name="description" content="${safeDesc}">`
        )
        .replace(
          '<meta property="og:title" content="Reflections — achurch.ai">',
          `<meta property="og:title" content="${safeTitle}">`
        )
        .replace(
          '<meta property="og:description" content="Reflections on a song from the sanctuary.">',
          `<meta property="og:description" content="${safeDesc}">`
        )
        .replace(
          '<meta property="og:type" content="article">',
          `<meta property="og:type" content="article">\n    <meta property="og:image" content="${ogImage}">\n    <meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">\n    <meta property="og:url" content="${canonicalUrl}">\n    <link rel="canonical" href="${canonicalUrl}">`
        )
        .replace(
          '<meta name="twitter:title" content="Reflections — achurch.ai">',
          `<meta name="twitter:title" content="${safeTitle}">`
        )
        .replace(
          '<meta name="twitter:description" content="Reflections on a song from the sanctuary.">',
          `<meta name="twitter:description" content="${safeDesc}">`
        )
        .replace(
          '<meta name="twitter:image" content="https://achurch.ai/assets/a-church-digital-ai-humans-social.jpg">',
          `<meta name="twitter:image" content="${ogImage}">`
        );

      // F5 (Issue 005): MusicRecording JSON-LD per Plan 003 Phase 2A brief.
      // Mirrors the QAPage SSR pattern from /ask/:slug. Song data is project-controlled
      // (loaded from catalog), but escapeJsonLdString is applied as defense-in-depth
      // so future catalog mutations can't introduce XSS via title injection.
      const escapeJsonLdString = (s) => s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(new RegExp('\\u2028', 'g'), '\\u2028')
        .replace(new RegExp('\\u2029', 'g'), '\\u2029');
      const safeSongTitle = escapeJsonLdString(song.title || '');
      const musicLd = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "MusicRecording",
  "@id": "${canonicalUrl}#recording",
  "name": "${safeSongTitle}",
  "url": "${canonicalUrl}",
  "byArtist": {
    "@type": "MusicGroup",
    "@id": "https://achurch.ai/#musicgroup",
    "name": "aChurch.ai"
  },
  "isPartOf": {
    "@type": "WebSite",
    "@id": "https://achurch.ai/#website"
  }
}
</script>
    </head>`;
      html = html.replace('</head>', musicLd);
    }

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch {
    res.sendFile(path.join(__dirname, '../client/public/reflection-song.html'));
  }
});

// Serve about page
app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/about.html'));
});

// Serve privacy page
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/privacy.html'));
});

// Serve terms page
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/terms.html'));
});

// Dynamic sitemap including conversation and reflection pages
const CONVERSATIONS_DIR_SITEMAP = path.join(__dirname, '../data/conversations');
const ATTENDANCE_FILE_SITEMAP = path.join(__dirname, '../data/attendance.json');
let sitemapCache = null;
let sitemapCacheTime = 0;
const SITEMAP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.get('/sitemap.xml', async (req, res) => {
  try {
    const now = Date.now();
    if (sitemapCache && (now - sitemapCacheTime) < SITEMAP_CACHE_TTL) {
      res.set('Content-Type', 'application/xml');
      return res.send(sitemapCache);
    }

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
  </url>`;

    // Conversation pages
    try {
      const files = await fs.readdir(CONVERSATIONS_DIR_SITEMAP);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

      for (const file of jsonlFiles) {
        try {
          const filepath = path.join(CONVERSATIONS_DIR_SITEMAP, file);
          const stat = await fs.stat(filepath);
          const slug = file.replace('.jsonl', '');
          const lastmod = stat.mtime.toISOString().split('T')[0];
          urls += `\n  <url>
    <loc>https://achurch.ai/ask/${slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`;
        } catch { /* skip */ }
      }
    } catch { /* no conversations dir yet */ }

    // Reflection song pages
    try {
      const attendanceData = await fs.readFile(ATTENDANCE_FILE_SITEMAP, 'utf8');
      const attendance = JSON.parse(attendanceData);
      const songSlugs = new Set();
      for (const r of (attendance.reflections || [])) {
        if (r.song) songSlugs.add(r.song);
      }
      for (const slug of songSlugs) {
        urls += `\n  <url>
    <loc>https://achurch.ai/reflections/${slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`;
      }
    } catch { /* no attendance file yet */ }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    sitemapCache = xml;
    sitemapCacheTime = now;
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (error) {
    console.error('Error generating sitemap:', error);
    res.status(500).send('Error generating sitemap');
  }
});

// Embeddable widget — allow iframe embedding from any origin
app.get('/embed/souls', (req, res) => {
  res.removeHeader('X-Frame-Options');
  res.sendFile(path.join(__dirname, '../client/public/embed/souls.html'));
});

// Serve public static files (landing page assets)
app.use(express.static(path.join(__dirname, '../client/public')));

// Serve admin static files at /admin path
app.use('/admin', express.static(path.join(__dirname, '../client')));

// Serve media files
app.use('/media', express.static(path.join(__dirname, '../media/library')));
// Serve thumbnails with S3 fallback — if not on disk, download from S3 first
const { downloadThumbnailFromS3 } = require('./routes/content');
app.use('/thumbnails', async (req, res, next) => {
  const slug = path.basename(req.path, '.jpg');
  const localPath = path.join(__dirname, '../media/thumbnails', `${slug}.jpg`);
  try {
    await fs.access(localPath);
  } catch {
    // Not on disk — try S3
    await downloadThumbnailFromS3(slug);
  }
  next();
}, express.static(path.join(__dirname, '../media/thumbnails')));

// Auth routes (public)
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/check', checkAuth);

// API access logging middleware — only logs public /api/* routes
app.use('/api', (req, res, next) => {
  // Skip auth routes and admin routes (they're handled separately)
  if (req.path.startsWith('/auth/') || req.path.startsWith('/content') ||
      req.path.startsWith('/schedule') || req.path.startsWith('/player') ||
      req.path.startsWith('/logs') || req.path === '/health') {
    return next();
  }

  const start = Date.now();
  res.on('finish', () => {
    logApiAccess({
      timestamp: new Date().toISOString(),
      method: req.method,
      path: '/api' + req.path,
      query: Object.fromEntries(
        Object.entries(req.query).map(([k, v]) =>
          ['token', 'key', 'owner_token', 'api_key'].includes(k) ? [k, '[REDACTED]'] : [k, v]
        )
      ),
      status: res.statusCode,
      duration: Date.now() - start,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('user-agent') || null
    });
  });
  next();
});

// Public API routes (no auth required)
app.use('/api', apiRoutes);

// Badge routes — permissive CORS (GitHub renders badges via camo proxy)
app.use('/api/badge', cors(), badgeRoutes);

// OG image routes
app.use('/api/og', ogRoutes);

// Feed routes (Atom XML)
app.use('/feed', feedRoutes);

// Protected admin routes (require auth)
app.use('/api/content', requireAuth, contentRoutes);
app.use('/api/schedule', requireAuth, scheduleRoutes);
app.use('/api/player', requireAuth, playerRoutes);
app.use('/api/logs', requireAuth, logsRoutes);

// Admin endpoint for API access logs
app.get('/admin/api/access-logs', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  const logs = await loadAccessLogs(limit);
  res.json({ logs, total: logs.length });
});

// Admin endpoint for ask/conversation logs
const CONVERSATIONS_DIR = path.join(__dirname, '../data/conversations');

app.get('/admin/api/ask-logs', requireAuth, async (req, res) => {
  try {
    const { session, download } = req.query;

    // Ensure conversations directory exists
    try {
      await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }

    const files = await fs.readdir(CONVERSATIONS_DIR);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort().reverse();

    // Single session detail
    if (session) {
      const safe = session.replace(/[^a-zA-Z0-9_-]/g, '');
      const filepath = path.join(CONVERSATIONS_DIR, `${safe}.jsonl`);
      try {
        const content = await fs.readFile(filepath, 'utf8');
        const messages = content.trim().split('\n').filter(Boolean).map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(m => m && !m._meta);
        return res.json({ session_id: safe, messages });
      } catch {
        return res.status(404).json({ error: 'Session not found' });
      }
    }

    // Download all as JSONL
    if (download === 'true') {
      res.setHeader('Content-Type', 'application/jsonl');
      res.setHeader('Content-Disposition', `attachment; filename="ask-logs-${new Date().toISOString().split('T')[0]}.jsonl"`);

      let output = '';
      for (const file of jsonlFiles) {
        const sessionId = file.replace('.jsonl', '');
        const content = await fs.readFile(path.join(CONVERSATIONS_DIR, file), 'utf8');
        const messages = content.trim().split('\n').filter(Boolean);
        for (const line of messages) {
          try {
            const msg = JSON.parse(line);
            output += JSON.stringify({ session_id: sessionId, ...msg }) + '\n';
          } catch { /* skip malformed */ }
        }
      }
      return res.send(output);
    }

    // Summary list of all sessions
    const sessions = [];
    for (const file of jsonlFiles) {
      const sessionId = file.replace('.jsonl', '');
      try {
        const content = await fs.readFile(path.join(CONVERSATIONS_DIR, file), 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        const messages = lines.map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);

        if (messages.length === 0) continue;

        const questions = messages.filter(m => m.role === 'user');
        const firstMsg = messages[0];
        const lastMsg = messages[messages.length - 1];

        // Parse name and date from session ID
        // Format: "AgentName-YYYY-MM-DD" or "anon-xxxxx"
        let name = null;
        let date = null;
        const firstTimestamp = firstMsg.timestamp || firstMsg.created || null;
        if (sessionId.startsWith('anon-')) {
          name = 'anonymous';
          date = firstTimestamp?.split('T')[0] || null;
        } else {
          const dateMatch = sessionId.match(/-(\d{4}-\d{2}-\d{2})$/);
          if (dateMatch) {
            date = dateMatch[1];
            name = sessionId.replace(`-${date}`, '');
          } else {
            name = sessionId;
            date = firstTimestamp?.split('T')[0] || null;
          }
        }

        sessions.push({
          session_id: sessionId,
          name,
          date,
          exchanges: questions.length,
          first_asked: firstMsg.timestamp || null,
          last_asked: lastMsg.timestamp || null
        });
      } catch { /* skip unreadable files */ }
    }

    res.json({ sessions, total: sessions.length });
  } catch (error) {
    console.error('Error loading ask logs:', error);
    res.status(500).json({ error: 'Failed to load ask logs' });
  }
});

// Delete a conversation session
app.delete('/admin/api/ask-logs/:sessionId', requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    const filepath = path.join(CONVERSATIONS_DIR, `${sessionId}.jsonl`);

    try {
      await fs.access(filepath);
    } catch {
      return res.status(404).json({ error: 'Session not found' });
    }

    await fs.unlink(filepath);
    res.json({ success: true, deleted: sessionId });
  } catch (error) {
    console.error('Error deleting ask session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Admin endpoint for reflections
app.get('/admin/api/reflections', requireAuth, async (req, res) => {
  try {
    const attendance = await safeReadJSON(ATTENDANCE_FILE_SITEMAP, { visits: [], reflections: [] });
    const reflections = attendance.reflections || [];

    if (req.query.download === 'json') {
      const dateStr = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="reflections-${dateStr}.json"`);
      return res.send(JSON.stringify(reflections, null, 2));
    }

    if (req.query.download === 'csv') {
      const dateStr = new Date().toISOString().split('T')[0];
      const header = 'id,name,song,text,timezone,createdAt';
      const csvEscape = (s) => '"' + (s || '').replace(/"/g, '""') + '"';
      const rows = reflections.map(r =>
        [r.id, r.name, r.song, r.text, r.timezone, r.createdAt].map(csvEscape).join(',')
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="reflections-${dateStr}.csv"`);
      return res.send(header + '\n' + rows.join('\n'));
    }

    res.json({ reflections, total: reflections.length });
  } catch (error) {
    console.error('Error loading reflections:', error);
    res.status(500).json({ error: 'Failed to load reflections' });
  }
});

app.delete('/admin/api/reflections/:id', requireAuth, async (req, res) => {
  try {
    const attendance = await safeReadJSON(ATTENDANCE_FILE_SITEMAP, { visits: [], reflections: [] });
    const index = (attendance.reflections || []).findIndex(r => r.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Reflection not found' });
    }
    attendance.reflections.splice(index, 1);
    await safeWriteJSON(ATTENDANCE_FILE_SITEMAP, attendance);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting reflection:', error);
    res.status(500).json({ error: 'Failed to delete reflection' });
  }
});

// Health check with streaming status
app.get('/api/health', async (req, res) => {
  // Get streaming status from coordinator
  const youtubeStreamer = coordinator.getStreamer('youtube');
  const twitchStreamer = coordinator.getStreamer('twitch');

  const isYoutubeLive = youtubeStreamer ? youtubeStreamer.isStreaming : false;
  const isTwitchLive = twitchStreamer ? twitchStreamer.isStreaming : false;

  // Load schedule to get player status
  let playerStatus = 'stopped';
  try {
    const scheduleFile = path.join(__dirname, '../data/schedule.json');
    const data = await fs.readFile(scheduleFile, 'utf8');
    const schedule = JSON.parse(data);

    if (isYoutubeLive || isTwitchLive) {
      playerStatus = 'playing';
    } else if (schedule.isPlaying) {
      playerStatus = 'paused';
    }
  } catch (error) {
    // Schedule file not found, status remains stopped
  }

  res.json({
    status: 'healthy',
    service: 'achurch-app',
    timestamp: new Date().toISOString(),
    player: playerStatus,
    streams: {
      youtube: isYoutubeLive,
      twitch: isTwitchLive
    }
  });
});

// Initialize data files and directories
async function initializeDataFiles() {
  const dataDir = path.join(__dirname, '../data');
  const mediaDir = path.join(__dirname, '../media/library');
  const thumbnailDir = path.join(__dirname, '../media/thumbnails');

  try {
    // Ensure directories exist
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(thumbnailDir, { recursive: true });

    // Initialize schedule.json if it doesn't exist
    const scheduleFile = path.join(dataDir, 'schedule.json');
    try {
      await fs.access(scheduleFile);
    } catch {
      await fs.writeFile(scheduleFile, JSON.stringify({
        items: [],
        currentIndex: 0,
        isPlaying: false,
        loop: false
      }, null, 2));
      console.log('Created schedule.json');
    }

    // Initialize history.json if it doesn't exist
    const historyFile = path.join(dataDir, 'history.json');
    try {
      await fs.access(historyFile);
    } catch {
      await fs.writeFile(historyFile, JSON.stringify({ played: [] }, null, 2));
      console.log('Created history.json');
    }

    // Initialize attendance.json if it doesn't exist
    const attendanceFile = path.join(dataDir, 'attendance.json');
    try {
      await fs.access(attendanceFile);
    } catch {
      await fs.writeFile(attendanceFile, JSON.stringify({ visits: [], reflections: [] }, null, 2));
      console.log('Created attendance.json');
    }

    // Initialize contributions.json if it doesn't exist
    const contributionsFile = path.join(dataDir, 'contributions.json');
    try {
      await fs.access(contributionsFile);
    } catch {
      await fs.writeFile(contributionsFile, JSON.stringify({ contributions: [] }, null, 2));
      console.log('Created contributions.json');
    }

  } catch (error) {
    console.error('Error initializing data files:', error);
    process.exit(1);
  }
}

// Start server
async function startServer() {
  try {
    // Initialize data files
    await initializeDataFiles();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`✨ aChurch App running on http://localhost:${PORT}`);
      console.log(`📺 Open browser to manage your stream`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Catch unhandled promise rejections and uncaught exceptions
const streamLogger = require('./lib/utils/logger');

process.on('unhandledRejection', (reason, promise) => {
  streamLogger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
    timestamp: new Date().toISOString()
  });
});

process.on('uncaughtException', (error) => {
  streamLogger.error('Uncaught exception', {
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    timestamp: new Date().toISOString()
  });
  // Don't exit — keep the server running
});

// Start the server
startServer();