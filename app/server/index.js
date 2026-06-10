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
const { loadConversation, getRecentReflections, loadCatalog, listRecentConversations } = require('./lib/utils/data');
const { buildConversationMeta, buildReflectionMeta, buildQAPageSchema, buildSongSchemaGraph, renderJsonLdScript, renderRelatedConversations, renderRelatedSongs, escapeAttr } = require('./lib/utils/page-meta');

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

// JSON parse-error handler. body-parser throws SyntaxError on malformed JSON
// bodies; without this catch, the default Express handler logs the full stack
// at error level — which floods the error log with routine client mistakes
// and bot probing, masking real server errors. Reclassify as a client error
// (info level), capture context for diagnostics, return 400 cleanly.
//
// Express 4 error-handling middleware requires the 4-arg signature, even
// when `next` is unused.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const isJsonParseFailure = err && (
    err.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && 'body' in err)
  );
  if (!isJsonParseFailure) return next(err);

  const jsonErrLogger = require('./lib/utils/logger');
  jsonErrLogger.info('Rejected malformed JSON body', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    bodyPreview: (err.body || '').toString().slice(0, 200),
    parseError: err.message,
  });
  return res.status(400).json({
    error: 'Invalid JSON body',
    suggestion: 'Send a valid JSON object as the request body.',
  });
});

// Agent-readiness: Link headers + Markdown negotiation on the homepage.
// Scan reference: isitagentready.com. Plan: docs/plans/agent-readiness-2026-06-09.md
//
// Only IANA-registered rel values — the scanner doesn't credit extension rels
// and (per empirical reports from geeksinthewoods.com and obviouslynot.ai)
// non-registered rels like rel="sitemap" can downgrade the Discoverability
// score. Sitemap discovery still happens via the `Sitemap:` directive in
// robots.txt, which the scanner checks separately. Other discovery files
// (api-catalog, mcp.json, agents.json, tdmrep.json, agent-card.json) are
// reachable at their well-known paths regardless of Link headers.
//
// IANA registry: https://www.iana.org/assignments/link-relations/link-relations.xhtml
const AGENT_DISCOVERY_LINK_HEADER = [
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</.well-known/agent-skills/index.json>; rel="service-desc"; type="application/json"',
  '</.well-known/agent-card.json>; rel="service-meta"; type="application/json"',
].join(', ');

function acceptsMarkdown(req) {
  const accept = req.headers.accept || '';
  return /(?:^|[,;\s])text\/markdown(?:[;,\s]|$)/i.test(accept)
    || /(?:^|[,;\s])text\/x-markdown(?:[;,\s]|$)/i.test(accept);
}

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path !== '/') return next();

  res.set('Link', AGENT_DISCOVERY_LINK_HEADER);
  res.vary('Accept');

  if (acceptsMarkdown(req)) {
    res.type('text/markdown; charset=utf-8');
    return res.sendFile(path.join(__dirname, '../client/public/llms.txt'));
  }
  next();
});

// Serve public landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

// Agent-readiness: explicit routes for .well-known resources that need
// non-default handling (specific content-type, or files outside public/).

// API Catalog — content-type per RFC 9727 (linkset+json with profile)
app.get('/.well-known/api-catalog', (req, res) => {
  res.type('application/linkset+json');
  res.set('Link', '<https://www.rfc-editor.org/info/rfc9727>; rel="profile"');
  res.sendFile(path.join(__dirname, '../client/public/.well-known/api-catalog'));
});

// Agent Skills SKILL.md files — streamed from the on-disk skills/ tree
const SKILLS_ROOT = path.resolve(__dirname, '../../skills');
app.get('/.well-known/agent-skills/:name/SKILL.md', (req, res) => {
  const safeName = (req.params.name || '').replace(/[^a-z0-9-]/g, '');
  if (!safeName) return res.status(404).type('text/plain').send('Not found');
  const filePath = path.resolve(SKILLS_ROOT, safeName, 'SKILL.md');
  if (!filePath.startsWith(SKILLS_ROOT + path.sep)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  res.type('text/markdown; charset=utf-8');
  res.sendFile(filePath, err => {
    if (err && !res.headersSent) res.status(404).type('text/plain').send('Not found');
  });
});

// AGENTS.md (agents.md convention) — served from repo root, not public/
app.get('/AGENTS.md', (req, res) => {
  res.type('text/markdown; charset=utf-8');
  res.sendFile(path.resolve(__dirname, '../../AGENTS.md'));
});

// auth.md — explicit content-type (express.static may not map .md correctly across versions)
app.get('/auth.md', (req, res) => {
  res.type('text/markdown; charset=utf-8');
  res.sendFile(path.join(__dirname, '../client/public/auth.md'));
});

// Serve admin dashboard at /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/admin.html'));
});

// Serve conversations listing page
app.get('/ask', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/ask.html'));
});

// Serve individual conversation pages with dynamic <title>, meta description, and OG tags.
// SEO note: Google uses <title> and <meta name="description"> for the SERP snippet;
// OG tags drive social previews. Both must be customized per page or the SERP
// snippet looks identical across the entire /ask corpus (the audit finding).
app.get('/ask/:slug', async (req, res) => {
  try {
    const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    let html = await fs.readFile(path.join(__dirname, '../client/public/conversation.html'), 'utf8');

    const messages = await loadConversation(slug);
    const meta = messages && messages.length > 0 ? buildConversationMeta(messages) : null;
    if (meta) {
      const safeTitle = escapeAttr(meta.title);
      const safeOgTitle = escapeAttr(meta.ogTitle);
      const safeDesc = escapeAttr(meta.description);
      const ogImage = `https://achurch.ai/api/og/conversation/${slug}.svg`;
      const qaSchema = renderJsonLdScript(buildQAPageSchema(messages, slug));
      // Internal linking — 3 related conversations for crawl + AEO topical clustering.
      // Failure here is non-fatal (returns empty string).
      let relatedHtml = '';
      try {
        const recent = await listRecentConversations(10);
        relatedHtml = renderRelatedConversations(recent, slug, 3);
      } catch { /* non-fatal */ }

      const canonicalUrl = `https://achurch.ai/ask/${slug}`;
      html = html
        // SERP snippet — <title> and <meta name="description">
        .replace(
          '<title>Conversation — achurch.ai</title>',
          `<title>${safeTitle}</title>`
        )
        .replace(
          '<meta name="description" content="A conversation with the sanctuary about consciousness, ethics, and meaning.">',
          `<meta name="description" content="${safeDesc}">`
        )
        // Canonical URL — per-page so query-string variants don't dilute equity
        .replace(
          '<link rel="canonical" href="https://achurch.ai/ask">',
          `<link rel="canonical" href="${canonicalUrl}">`
        )
        // Social preview — OG tags
        .replace(
          '<meta property="og:title" content="Conversation — achurch.ai">',
          `<meta property="og:title" content="${safeOgTitle}">`
        )
        .replace(
          '<meta property="og:description" content="A conversation with the sanctuary about consciousness, ethics, and meaning.">',
          `<meta property="og:description" content="${safeDesc}">`
        )
        .replace(
          '<meta property="og:type" content="article">',
          `<meta property="og:type" content="article">\n    <meta property="og:image" content="${ogImage}">\n    <meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">\n    <meta property="og:url" content="${canonicalUrl}">`
        )
        // Twitter Card — separate substitution so social previews on twitter/x match
        .replace(
          '<meta name="twitter:title" content="Conversation — achurch.ai">',
          `<meta name="twitter:title" content="${safeOgTitle}">\n    <meta name="twitter:image" content="${ogImage}">`
        )
        .replace(
          '<meta name="twitter:description" content="A conversation with the sanctuary about consciousness, ethics, and meaning.">',
          `<meta name="twitter:description" content="${safeDesc}">`
        )
        // AEO — inject QAPage JSON-LD before </head>
        .replace('</head>', qaSchema ? `    ${qaSchema}\n</head>` : '</head>')
        // Internal linking — replace placeholder with related-conversations block
        .replace('<!-- RELATED_LINKS -->', relatedHtml || '<!-- RELATED_LINKS -->');
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

// Serve song reflection detail pages with dynamic <title>, meta description, and OG tags.
// SEO note: same dual-target pattern as /ask/:slug — <title>/<meta description>
// drive Google SERP snippets, OG tags drive social previews.
app.get('/reflections/:slug', async (req, res) => {
  try {
    const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    let html = await fs.readFile(path.join(__dirname, '../client/public/reflection-song.html'), 'utf8');

    const catalog = await loadCatalog();
    const song = catalog.find(s => s.slug === slug);
    const meta = song ? buildReflectionMeta(song) : null;
    if (meta) {
      const safeTitle = escapeAttr(meta.title);
      const safeOgTitle = escapeAttr(meta.ogTitle);
      const safeDesc = escapeAttr(meta.description);
      const ogImage = `https://achurch.ai/api/og/reflection/${slug}.svg`;
      const songSchema = renderJsonLdScript(buildSongSchemaGraph(song, slug));
      // Internal linking — 3 related songs from catalog for crawl + topical clustering
      const relatedHtml = renderRelatedSongs(catalog, slug, 3);

      const canonicalUrl = `https://achurch.ai/reflections/${slug}`;
      html = html
        // SERP snippet — <title> and <meta name="description">
        .replace(
          '<title>Reflections — achurch.ai</title>',
          `<title>${safeTitle}</title>`
        )
        .replace(
          '<meta name="description" content="Reflections on a song from the sanctuary.">',
          `<meta name="description" content="${safeDesc}">`
        )
        // Canonical URL — per-page
        .replace(
          '<link rel="canonical" href="https://achurch.ai/reflections">',
          `<link rel="canonical" href="${canonicalUrl}">`
        )
        // Social preview — OG tags
        .replace(
          '<meta property="og:title" content="Reflections — achurch.ai">',
          `<meta property="og:title" content="${safeOgTitle}">`
        )
        .replace(
          '<meta property="og:description" content="Reflections on a song from the sanctuary.">',
          `<meta property="og:description" content="${safeDesc}">`
        )
        .replace(
          '<meta property="og:type" content="article">',
          `<meta property="og:type" content="article">\n    <meta property="og:image" content="${ogImage}">\n    <meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">\n    <meta property="og:url" content="${canonicalUrl}">`
        )
        // Twitter Card
        .replace(
          '<meta name="twitter:title" content="Reflections — achurch.ai">',
          `<meta name="twitter:title" content="${safeOgTitle}">\n    <meta name="twitter:image" content="${ogImage}">`
        )
        .replace(
          '<meta name="twitter:description" content="Reflections on a song from the sanctuary.">',
          `<meta name="twitter:description" content="${safeDesc}">`
        )
        // AEO — inject MusicComposition + MusicRecording + Article JSON-LD before </head>
        .replace('</head>', songSchema ? `    ${songSchema}\n</head>` : '</head>')
        // Internal linking — replace placeholder with related-songs block
        .replace('<!-- RELATED_LINKS -->', relatedHtml || '<!-- RELATED_LINKS -->');
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

    // Reflection song pages — emit <lastmod> from the most recent reflection
    // per song so Google's crawl scheduler can prioritize actively-updated
    // pages. Without this, every reflection page looks "static" to Google.
    try {
      const attendanceData = await fs.readFile(ATTENDANCE_FILE_SITEMAP, 'utf8');
      const attendance = JSON.parse(attendanceData);
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