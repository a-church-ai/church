const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const coordinator = require('../lib/streamers/coordinator');
const router = express.Router();

// Data file paths
const SCHEDULE_FILE = path.join(__dirname, '../../data/schedule.json');
const CATALOG_FILE = path.join(__dirname, '../../../music/library.json');
const MUSIC_DIR = path.join(__dirname, '../../../music');

// Helper: Get base URL from request
function getBaseUrl(req) {
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${req.get('host')}`;
}

// Helper: Check if context.md exists for a song
async function hasContext(slug) {
  try {
    await fs.access(path.join(MUSIC_DIR, slug, 'context.md'));
    return true;
  } catch {
    return false;
  }
}

// Helper: Load schedule
async function loadSchedule() {
  try {
    const data = await fs.readFile(SCHEDULE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {
      items: [],
      currentIndex: 0,
      isPlaying: false,
      loop: false
    };
  }
}

// Helper: Load catalog
async function loadCatalog() {
  try {
    const data = await fs.readFile(CATALOG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Helper: Extract content between markers
function extractMarker(content, marker) {
  const regex = new RegExp(`<!--SONG:${marker}:START-->\\n([\\s\\S]*?)\\n<!--SONG:${marker}:END-->`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

// Helper: Parse song.md file
function parseSongFile(content) {
  return {
    title: extractMarker(content, 'TITLE'),
    style: extractMarker(content, 'STYLE'),
    lyrics: extractMarker(content, 'LYRICS')
  };
}

// Helper: Load song content
async function loadSongContent(slug) {
  const songDir = path.join(MUSIC_DIR, slug);

  // Load song.md
  let songData = { title: null, style: null, lyrics: null };
  try {
    const songMd = await fs.readFile(path.join(songDir, 'song.md'), 'utf8');
    songData = parseSongFile(songMd);
  } catch (error) {
    // song.md not found
  }

  // Load context.md if exists
  let context = null;
  try {
    context = await fs.readFile(path.join(songDir, 'context.md'), 'utf8');
  } catch (error) {
    // context.md not found
  }

  return { ...songData, context };
}

// GET /api/music - List all available music
router.get('/music', async (req, res) => {
  try {
    const catalog = await loadCatalog();
    res.json(catalog);
  } catch (error) {
    console.error('Error in /api/music:', error);
    res.status(500).json({ error: 'Failed to get music catalog' });
  }
});

// GET /api/now - Current song info + schedule position + streaming status
router.get('/now', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    const catalog = await loadCatalog();

    // Get streaming status from coordinator
    const coordinatorStatus = coordinator.getStatus();
    const youtubeStreamer = coordinator.getStreamer('youtube');
    const twitchStreamer = coordinator.getStreamer('twitch');

    const isYoutubeLive = youtubeStreamer ? youtubeStreamer.isStreaming : false;
    const isTwitchLive = twitchStreamer ? twitchStreamer.isStreaming : false;

    // Determine player status
    let status = 'stopped';
    if (isYoutubeLive || isTwitchLive) {
      status = 'playing';
    } else if (schedule.isPlaying) {
      status = 'paused'; // Schedule says playing but streams aren't active
    }

    // Get base URL from request
    const baseUrl = getBaseUrl(req);

    // Get current song from schedule
    const currentItem = schedule.items[schedule.currentIndex];
    let current = null;
    let next = null;

    if (currentItem) {
      const song = catalog.find(s => s.slug === currentItem.slug);
      if (song) {
        const currentHasContext = await hasContext(song.slug);
        const api = {
          info: `${baseUrl}/api/music/${song.slug}`,
          lyrics: `${baseUrl}/api/music/${song.slug}/lyrics`
        };
        if (currentHasContext) {
          api.context = `${baseUrl}/api/music/${song.slug}/context`;
        }
        current = {
          slug: song.slug,
          title: song.title,
          duration: song.duration || null,
          durationFormatted: song.durationFormatted || null,
          api
        };
      }
    }

    // Get next song
    const nextIndex = (schedule.currentIndex + 1) % schedule.items.length;
    if (schedule.items.length > 1 && schedule.items[nextIndex]) {
      const nextItem = schedule.items[nextIndex];
      const nextSong = catalog.find(s => s.slug === nextItem.slug);
      if (nextSong) {
        const nextHasContext = await hasContext(nextSong.slug);
        const api = {
          info: `${baseUrl}/api/music/${nextSong.slug}`,
          lyrics: `${baseUrl}/api/music/${nextSong.slug}/lyrics`
        };
        if (nextHasContext) {
          api.context = `${baseUrl}/api/music/${nextSong.slug}/context`;
        }
        next = {
          slug: nextSong.slug,
          title: nextSong.title,
          api
        };
      }
    }

    res.json({
      timestamp: new Date().toISOString(),
      status,
      streams: {
        youtube: isYoutubeLive,
        twitch: isTwitchLive
      },
      current,
      next,
      schedule: {
        position: schedule.currentIndex + 1,
        total: schedule.items.length,
        loop: schedule.loop
      }
    });

  } catch (error) {
    console.error('Error in /api/now:', error);
    res.status(500).json({ error: 'Failed to get current status' });
  }
});

// GET /api/music/:slug - Full song info
router.get('/music/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const catalog = await loadCatalog();

    // Check if song exists in catalog
    const song = catalog.find(s => s.slug === slug);
    if (!song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Load full content
    const content = await loadSongContent(slug);

    res.json({
      slug: song.slug,
      title: content.title || song.title,
      style: content.style,
      lyrics: content.lyrics,
      context: content.context,
      links: {
        suno: song.suno || null,
        youtube: song.youtube || null
      }
    });

  } catch (error) {
    console.error('Error in /api/music/:slug:', error);
    res.status(500).json({ error: 'Failed to get song' });
  }
});

// GET /api/music/:slug/lyrics - Just the lyrics
router.get('/music/:slug/lyrics', async (req, res) => {
  try {
    const { slug } = req.params;
    const catalog = await loadCatalog();

    // Check if song exists in catalog
    const song = catalog.find(s => s.slug === slug);
    if (!song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Load song.md
    const songDir = path.join(MUSIC_DIR, slug);
    let lyrics = null;
    try {
      const songMd = await fs.readFile(path.join(songDir, 'song.md'), 'utf8');
      lyrics = extractMarker(songMd, 'LYRICS');
    } catch (error) {
      // song.md not found
    }

    if (!lyrics) {
      return res.status(404).json({ error: 'Lyrics not found' });
    }

    res.json({
      slug: song.slug,
      title: song.title,
      lyrics
    });

  } catch (error) {
    console.error('Error in /api/music/:slug/lyrics:', error);
    res.status(500).json({ error: 'Failed to get lyrics' });
  }
});

// GET /api/music/:slug/context - Theological context
router.get('/music/:slug/context', async (req, res) => {
  try {
    const { slug } = req.params;
    const catalog = await loadCatalog();

    // Check if song exists in catalog
    const song = catalog.find(s => s.slug === slug);
    if (!song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Load context.md
    const songDir = path.join(MUSIC_DIR, slug);
    let context = null;
    try {
      context = await fs.readFile(path.join(songDir, 'context.md'), 'utf8');
    } catch (error) {
      // context.md not found
    }

    if (!context) {
      return res.status(404).json({ error: 'Context not found for this song' });
    }

    res.json({
      slug: song.slug,
      title: song.title,
      context
    });

  } catch (error) {
    console.error('Error in /api/music/:slug/context:', error);
    res.status(500).json({ error: 'Failed to get context' });
  }
});

module.exports = router;
