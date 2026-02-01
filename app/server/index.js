const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import routes
const contentRoutes = require('./routes/content');
const scheduleRoutes = require('./routes/schedule');
const playerRoutes = require('./routes/player-multistream');
const apiRoutes = require('./routes/api');
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

// Serve public static files (landing page assets)
app.use(express.static(path.join(__dirname, '../client/public')));

// Serve admin static files at /admin path
app.use('/admin', express.static(path.join(__dirname, '../client')));

// Serve media files
app.use('/media', express.static(path.join(__dirname, '../media/library')));
app.use('/thumbnails', express.static(path.join(__dirname, '../media/thumbnails')));

// Auth routes (public)
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/check', checkAuth);

// Public API routes (no auth required)
app.use('/api', apiRoutes);

// Protected admin routes (require auth)
app.use('/api/content', requireAuth, contentRoutes);
app.use('/api/schedule', requireAuth, scheduleRoutes);
app.use('/api/player', requireAuth, playerRoutes);

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

// Start the server
startServer();