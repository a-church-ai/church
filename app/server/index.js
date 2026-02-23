const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const dotenv = require('dotenv');

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
const { requireAuth, login, logout, checkAuth } = require('./lib/auth');
const cookieParser = require('cookie-parser');
const coordinator = require('./lib/streamers/coordinator');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ credentials: true, origin: true }));
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

// Serve individual conversation pages
app.get('/ask/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/conversation.html'));
});

// Serve reflections listing page
app.get('/reflections', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/reflections.html'));
});

// Serve song reflection detail pages
app.get('/reflections/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/reflection-song.html'));
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
      query: req.query,
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
        }).filter(Boolean);
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
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  // Don't exit — keep the server running
});

// Start the server
startServer();