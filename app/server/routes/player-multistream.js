const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const coordinator = require('../lib/streamers/coordinator');
const logger = require('../lib/utils/logger');
const { downloadFromS3 } = require('./content');
const router = express.Router();

// Data file paths
const SCHEDULE_FILE = path.join(__dirname, '../../data/schedule.json');
const LIBRARY_FILE = path.join(__dirname, '../../../music/library.json');
const HISTORY_FILE = path.join(__dirname, '../../data/history.json');

// Player status
let playerStatus = {
  isPlaying: false,
  currentVideo: null,
  currentIndex: 0,
  timeElapsed: 0,
  totalDuration: 0,
  streamingStatus: {
    youtube: false,
    twitch: false,
    coordinator: false
  },
  platforms: ['youtube', 'twitch', 'all']
};

// Helper functions
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

async function saveSchedule(schedule) {
  await fs.writeFile(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));
}

async function loadLibrary() {
  try {
    const data = await fs.readFile(LIBRARY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { played: [] };
  }
}

async function saveHistory(history) {
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Get video file path from slug (downloads from S3 if not local)
async function getVideoPath(slug) {
  const localPath = path.resolve(path.join(__dirname, '../../media/library', `${slug}.mp4`));

  // Check if file exists locally
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // File doesn't exist locally, try to download from S3
    logger.info(`Video ${slug}.mp4 not found locally, attempting S3 download...`);
    const downloaded = await downloadFromS3(slug);
    if (downloaded) {
      return localPath;
    }
    // Return path anyway - let the caller handle the missing file error
    logger.warn(`Video ${slug}.mp4 not found locally or in S3`);
    return localPath;
  }
}

// Pre-fetch adjacent videos in the schedule (runs in background, doesn't block)
async function prefetchAdjacentVideos(currentIndex) {
  const schedule = await loadSchedule();
  const items = schedule.items;

  if (items.length === 0) return;

  // Determine which indices to prefetch (next and previous)
  const indicesToPrefetch = [];

  // Next video
  let nextIndex = currentIndex + 1;
  if (nextIndex >= items.length && schedule.loop) {
    nextIndex = 0; // Wrap around if looping
  }
  if (nextIndex < items.length) {
    indicesToPrefetch.push(nextIndex);
  }

  // Previous video (in case user goes back)
  if (currentIndex > 0) {
    indicesToPrefetch.push(currentIndex - 1);
  }

  // Prefetch each video in the background (don't await, just fire and forget)
  for (const index of indicesToPrefetch) {
    const slug = items[index].slug;
    const localPath = path.resolve(path.join(__dirname, '../../media/library', `${slug}.mp4`));

    // Check if already exists locally (final or in-progress .tmp)
    const tmpPath = `${localPath}.tmp`;
    Promise.all([
      fs.access(localPath).then(() => true).catch(() => false),
      fs.access(tmpPath).then(() => true).catch(() => false)
    ]).then(async ([exists, downloading]) => {
      if (exists || downloading) return; // Already have it or download in progress
      logger.info(`Prefetching ${slug}.mp4 from S3...`);
      try {
        await downloadFromS3(slug);
        logger.info(`Prefetch complete: ${slug}.mp4`);
      } catch (err) {
        logger.warn(`Prefetch failed for ${slug}.mp4:`, err.message);
      }
    });
  }
}

// Enrich schedule item with library data
async function enrichScheduleItem(item) {
  const library = await loadLibrary();
  const song = library.find(s => s.slug === item.slug);
  if (song) {
    return {
      ...item,
      title: song.title,
      duration: song.duration,
      durationFormatted: song.durationFormatted,
      hasVideo: song.hasVideo,
      thumbnail: song.hasVideo ? `/thumbnails/${song.slug}.jpg` : null
    };
  }
  return item;
}

// Update player status with streaming info
async function updatePlayerStatus() {
  const coordinatorStatus = coordinator.getStatus();
  const youtubeStreamer = coordinator.getStreamer('youtube');
  const twitchStreamer = coordinator.getStreamer('twitch');

  playerStatus.streamingStatus = {
    youtube: youtubeStreamer ? youtubeStreamer.isStreaming : false,
    twitch: twitchStreamer ? twitchStreamer.isStreaming : false,
    coordinator: coordinatorStatus.isCoordinating
  };
}

// Helper function to play next video
async function playNextVideo() {
  const schedule = await loadSchedule();
  const history = await loadHistory();

  if (schedule.items.length === 0) {
    throw new Error('Schedule is empty');
  }

  // Mark current as played
  if (schedule.currentIndex < schedule.items.length) {
    schedule.items[schedule.currentIndex].played = true;
    schedule.items[schedule.currentIndex].playedAt = new Date().toISOString();

    // Add to history
    history.played.push({
      ...schedule.items[schedule.currentIndex],
      playedAt: new Date().toISOString()
    });
    await saveHistory(history);
  }

  // Move to next
  schedule.currentIndex++;

  // Handle end of schedule
  if (schedule.currentIndex >= schedule.items.length) {
    if (schedule.loop) {
      // Loop back to start
      schedule.currentIndex = 0;
      // Reset played status if looping
      schedule.items.forEach(item => {
        item.played = false;
      });
      console.log('Looping back to beginning of schedule');
    } else {
      // Stop at end
      schedule.currentIndex = schedule.items.length - 1;
      schedule.isPlaying = false;
      await saveSchedule(schedule);
      console.log('End of schedule reached, stopping playback');
      return { endReached: true };
    }
  }

  // Play next video
  const nextItem = schedule.items[schedule.currentIndex];
  const videoPath = await getVideoPath(nextItem.slug);

  try {
    // If streaming is active, switch content
    if (coordinator.isAnyStreaming()) {
      await coordinator.switchContent(videoPath);
      logger.info(`Switched streaming content to: ${nextItem.slug}`);
    }
  } catch (streamError) {
    logger.error('Streaming switch error (continuing anyway):', streamError);
  }

  await saveSchedule(schedule);

  const enrichedItem = await enrichScheduleItem(nextItem);
  playerStatus.currentVideo = enrichedItem;
  playerStatus.currentIndex = schedule.currentIndex;
  playerStatus.timeElapsed = 0;

  console.log(`Now playing: ${enrichedItem.title || nextItem.slug}`);

  // Prefetch adjacent videos in background (don't await)
  prefetchAdjacentVideos(schedule.currentIndex);

  return {
    success: true,
    nowPlaying: enrichedItem
  };
}

// Set up auto-progression listener
coordinator.on('allPlatformsCompleted', async (event) => {
  try {
    logger.info('Auto-progressing to next video after content completion', event);

    const result = await playNextVideo();

    if (!result.endReached && result.nowPlaying) {
      // Automatically start streaming the next video
      const videoPath = await getVideoPath(result.nowPlaying.slug);
      await coordinator.startAll(videoPath, { quality: '1080p' });

      logger.info('Auto-progression successful, streaming next video:', result.nowPlaying.title);
    } else {
      logger.info('Auto-progression reached end of schedule or loop disabled');

      // Stop coordination since we've reached the end
      coordinator.isCoordinating = false;
    }

  } catch (error) {
    logger.error('Auto-progression failed:', error);

    // Continue streaming the same content to avoid dead air
    try {
      await coordinator.startAll(coordinator.currentContent, { quality: '1080p' });
      logger.info('Restarted current content after auto-progression failure');
    } catch (restartError) {
      logger.error('Failed to restart content after auto-progression failure:', restartError);
    }
  }
});

// Routes

// Get player status
router.get('/status', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    await updatePlayerStatus();

    playerStatus.isPlaying = schedule.isPlaying;
    playerStatus.currentIndex = schedule.currentIndex;

    if (schedule.items.length > 0 && schedule.currentIndex < schedule.items.length) {
      const currentItem = schedule.items[schedule.currentIndex];
      playerStatus.currentVideo = await enrichScheduleItem(currentItem);
      playerStatus.totalDuration = playerStatus.currentVideo.duration || 0;
    } else {
      playerStatus.currentVideo = null;
      playerStatus.totalDuration = 0;
    }

    // Add streaming information
    const coordinatorStatus = coordinator.getStatus();
    playerStatus.streaming = coordinatorStatus;

    res.json(playerStatus);
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: 'Failed to get player status' });
  }
});

// Start streaming (replaces OBS connect)
router.post('/start-stream', async (req, res) => {
  try {
    const { platform = 'all', quality = '1080p' } = req.body;
    const schedule = await loadSchedule();

    // Get current video
    if (schedule.items.length === 0) {
      return res.status(400).json({ error: 'Schedule is empty - add content first' });
    }

    const currentItem = schedule.items[schedule.currentIndex];
    const videoPath = await getVideoPath(currentItem.slug);

    let result;

    if (platform === 'all') {
      result = await coordinator.startAll(videoPath, { quality });
    } else {
      const streamer = coordinator.getStreamer(platform);
      if (!streamer) {
        return res.status(400).json({ error: `Unknown platform: ${platform}` });
      }
      await streamer.start(videoPath, { quality });
      result = { platform, status: 'started', content: currentItem.slug };
    }

    // Mark as playing
    schedule.isPlaying = true;
    await saveSchedule(schedule);

    playerStatus.isPlaying = true;
    await updatePlayerStatus();

    const enrichedItem = await enrichScheduleItem(currentItem);
    logger.info(`Streaming started on ${platform}`, result);

    // Prefetch adjacent videos in background
    prefetchAdjacentVideos(schedule.currentIndex);

    res.json({
      success: true,
      streaming: result,
      nowPlaying: enrichedItem
    });

  } catch (error) {
    logger.error('Error starting stream:', error);
    res.status(500).json({ error: `Failed to start streaming: ${error.message}` });
  }
});

// Stop streaming
router.post('/stop-stream', async (req, res) => {
  try {
    const { platform = 'all' } = req.body;

    let result;

    if (platform === 'all') {
      result = await coordinator.stopAll();
    } else {
      const streamer = coordinator.getStreamer(platform);
      if (!streamer) {
        return res.status(400).json({ error: `Unknown platform: ${platform}` });
      }
      await streamer.stop();
      result = { platform, status: 'stopped' };
    }

    await updatePlayerStatus();

    logger.info(`Streaming stopped on ${platform}`, result);

    res.json({
      success: true,
      streaming: result
    });

  } catch (error) {
    logger.error('Error stopping stream:', error);
    res.status(500).json({ error: `Failed to stop streaming: ${error.message}` });
  }
});

// Get streaming status
router.get('/streaming-status', async (req, res) => {
  try {
    await updatePlayerStatus();
    const coordinatorStatus = coordinator.getStatus();

    res.json({
      status: coordinatorStatus,
      platforms: playerStatus.streamingStatus
    });
  } catch (error) {
    logger.error('Error getting streaming status:', error);
    res.status(500).json({ error: 'Failed to get streaming status' });
  }
});

// Play current video
router.post('/play', async (req, res) => {
  try {
    const schedule = await loadSchedule();

    if (schedule.items.length === 0) {
      return res.status(400).json({ error: 'Schedule is empty' });
    }

    const currentItem = schedule.items[schedule.currentIndex];
    const videoPath = await getVideoPath(currentItem.slug);

    // If streaming is active, switch to current content
    if (coordinator.isAnyStreaming()) {
      await coordinator.switchContent(videoPath);
    }

    // Mark as playing
    schedule.isPlaying = true;
    await saveSchedule(schedule);

    const enrichedItem = await enrichScheduleItem(currentItem);
    playerStatus.isPlaying = true;
    playerStatus.currentVideo = enrichedItem;
    playerStatus.timeElapsed = 0;

    // Prefetch adjacent videos in background
    prefetchAdjacentVideos(schedule.currentIndex);

    res.json({
      success: true,
      nowPlaying: enrichedItem
    });

  } catch (error) {
    console.error('Error playing video:', error);
    res.status(500).json({ error: 'Failed to play video' });
  }
});

// Pause playback
router.post('/pause', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    schedule.isPlaying = false;
    await saveSchedule(schedule);

    playerStatus.isPlaying = false;

    res.json({ success: true });
  } catch (error) {
    console.error('Error pausing:', error);
    res.status(500).json({ error: 'Failed to pause' });
  }
});

// Play next video
router.post('/next', async (req, res) => {
  try {
    const result = await playNextVideo();

    if (result.endReached) {
      return res.json({
        success: true,
        message: 'End of schedule reached',
        endReached: true
      });
    }

    res.json(result);

  } catch (error) {
    console.error('Error playing next:', error);

    if (error.message === 'Schedule is empty') {
      return res.status(400).json({ error: 'Schedule is empty' });
    }

    res.status(500).json({ error: 'Failed to play next video' });
  }
});

// Play previous video
router.post('/previous', async (req, res) => {
  try {
    const schedule = await loadSchedule();

    if (schedule.items.length === 0) {
      return res.status(400).json({ error: 'Schedule is empty' });
    }

    // Move to previous
    schedule.currentIndex--;

    if (schedule.currentIndex < 0) {
      schedule.currentIndex = 0;
    }

    // Play previous video
    const prevItem = schedule.items[schedule.currentIndex];
    const videoPath = await getVideoPath(prevItem.slug);

    // If streaming is active, switch content
    if (coordinator.isAnyStreaming()) {
      await coordinator.switchContent(videoPath);
    }

    await saveSchedule(schedule);

    const enrichedItem = await enrichScheduleItem(prevItem);
    playerStatus.currentVideo = enrichedItem;
    playerStatus.currentIndex = schedule.currentIndex;
    playerStatus.timeElapsed = 0;

    // Prefetch adjacent videos in background
    prefetchAdjacentVideos(schedule.currentIndex);

    res.json({
      success: true,
      nowPlaying: enrichedItem
    });

  } catch (error) {
    console.error('Error playing previous:', error);
    res.status(500).json({ error: 'Failed to play previous video' });
  }
});

// Jump to specific item
router.post('/jump/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const schedule = await loadSchedule();

    if (index < 0 || index >= schedule.items.length) {
      return res.status(400).json({ error: 'Invalid index' });
    }

    schedule.currentIndex = index;
    const item = schedule.items[index];
    const videoPath = await getVideoPath(item.slug);

    // If streaming is active, switch content
    if (coordinator.isAnyStreaming()) {
      await coordinator.switchContent(videoPath);
    }

    await saveSchedule(schedule);

    const enrichedItem = await enrichScheduleItem(item);
    playerStatus.currentVideo = enrichedItem;
    playerStatus.currentIndex = index;
    playerStatus.timeElapsed = 0;

    // Prefetch adjacent videos in background
    prefetchAdjacentVideos(index);

    res.json({
      success: true,
      nowPlaying: enrichedItem
    });

  } catch (error) {
    console.error('Error jumping to item:', error);
    res.status(500).json({ error: 'Failed to jump to item' });
  }
});

// Stop playback
router.post('/stop', async (req, res) => {
  try {
    const schedule = await loadSchedule();

    schedule.isPlaying = false;
    schedule.currentIndex = 0;
    await saveSchedule(schedule);

    // Also stop streaming if active
    if (coordinator.isAnyStreaming()) {
      await coordinator.stopAll();
      logger.info('Stopped streaming along with playback');
    }

    playerStatus.isPlaying = false;
    playerStatus.currentVideo = null;
    playerStatus.timeElapsed = 0;
    await updatePlayerStatus();

    res.json({ success: true });

  } catch (error) {
    console.error('Error stopping:', error);
    res.status(500).json({ error: 'Failed to stop' });
  }
});

module.exports = router;
