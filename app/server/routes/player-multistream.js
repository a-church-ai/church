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

// Schedule progress tracker — keeps currentIndex in sync with what FFmpeg is actually playing.
// Since FFmpeg uses -stream_loop -1 on the concat playlist, it never exits and never fires
// completion events. This tracker watches elapsed time vs video durations to advance the schedule.
let progressTracker = {
  interval: null,
  videoStartTime: null,   // When the current video started playing (ms)
  currentDuration: 0,     // Duration of current video in seconds
  isTracking: false
};

async function startProgressTracker() {
  stopProgressTracker();
  progressTracker.isTracking = true;

  const schedule = await loadSchedule();
  if (schedule.items.length === 0) return;

  // Set up the current video's start time and duration
  const currentItem = schedule.items[schedule.currentIndex];
  const enriched = await enrichScheduleItem(currentItem);
  progressTracker.currentDuration = enriched.duration || 0;
  progressTracker.videoStartTime = Date.now();

  // Update playerStatus
  playerStatus.currentVideo = enriched;
  playerStatus.currentIndex = schedule.currentIndex;
  playerStatus.totalDuration = progressTracker.currentDuration;
  playerStatus.timeElapsed = 0;

  // Check every second if the current video has finished
  progressTracker.interval = setInterval(async () => {
    if (!progressTracker.isTracking || !progressTracker.videoStartTime) return;

    const elapsed = (Date.now() - progressTracker.videoStartTime) / 1000;
    playerStatus.timeElapsed = Math.floor(elapsed);

    // Has the current video finished?
    if (progressTracker.currentDuration > 0 && elapsed >= progressTracker.currentDuration) {
      try {
        await advanceScheduleIndex();
      } catch (err) {
        logger.error('Progress tracker: failed to advance schedule:', err);
      }
    }
  }, 1000);

  logger.info(`Progress tracker started for "${enriched.title}" (${progressTracker.currentDuration}s)`);
}

async function advanceScheduleIndex() {
  const schedule = await loadSchedule();
  const history = await loadHistory();

  if (schedule.items.length === 0) return;

  // Mark current as played
  if (schedule.currentIndex < schedule.items.length) {
    schedule.items[schedule.currentIndex].played = true;
    schedule.items[schedule.currentIndex].playedAt = new Date().toISOString();

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
      schedule.currentIndex = 0;
      schedule.items.forEach(item => { item.played = false; });
      logger.info('Progress tracker: looping back to beginning of schedule');
    } else {
      schedule.currentIndex = schedule.items.length - 1;
      schedule.isPlaying = false;
      await saveSchedule(schedule);
      stopProgressTracker();
      logger.info('Progress tracker: end of schedule reached, stopping');
      return;
    }
  }

  await saveSchedule(schedule);

  // Set up next video tracking
  const nextItem = schedule.items[schedule.currentIndex];
  const enriched = await enrichScheduleItem(nextItem);
  progressTracker.currentDuration = enriched.duration || 0;
  progressTracker.videoStartTime = Date.now();

  // Update playerStatus
  playerStatus.currentVideo = enriched;
  playerStatus.currentIndex = schedule.currentIndex;
  playerStatus.totalDuration = progressTracker.currentDuration;
  playerStatus.timeElapsed = 0;

  logger.info(`Progress tracker: now playing "${enriched.title}" (index ${schedule.currentIndex}, ${progressTracker.currentDuration}s)`);

  // Prefetch adjacent videos
  prefetchAdjacentVideos(schedule.currentIndex);
}

function stopProgressTracker() {
  if (progressTracker.interval) {
    clearInterval(progressTracker.interval);
    progressTracker.interval = null;
  }
  progressTracker.isTracking = false;
  progressTracker.videoStartTime = null;
  progressTracker.currentDuration = 0;
}

// Reset tracker to a specific index (for next/previous/jump)
async function resetProgressTracker(index) {
  if (!progressTracker.isTracking) return;

  const schedule = await loadSchedule();
  if (index < 0 || index >= schedule.items.length) return;

  const item = schedule.items[index];
  const enriched = await enrichScheduleItem(item);
  progressTracker.currentDuration = enriched.duration || 0;
  progressTracker.videoStartTime = Date.now();

  playerStatus.currentVideo = enriched;
  playerStatus.currentIndex = index;
  playerStatus.totalDuration = progressTracker.currentDuration;
  playerStatus.timeElapsed = 0;

  logger.info(`Progress tracker: reset to "${enriched.title}" (index ${index}, ${progressTracker.currentDuration}s)`);
}

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

  // Normalize currentIndex into valid range (callers may pass index beyond items.length)
  if (schedule.loop) {
    currentIndex = currentIndex % items.length;
  } else {
    currentIndex = Math.min(currentIndex, items.length - 1);
  }

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

/**
 * Build an array of video file paths from the schedule starting at startIndex.
 * Loads ALL remaining items from startIndex to end of schedule (one full pass).
 * FFmpeg loops the playlist forever via -stream_loop -1, so no batching needed.
 * Downloads from S3 if needed. Returns { videoPaths, endIndex, videoCount }.
 */
async function buildPlaylistBuffer(startIndex) {
  const schedule = await loadSchedule();
  const items = schedule.items;
  if (items.length === 0) return { videoPaths: [], endIndex: startIndex, videoCount: 0 };

  const videoPaths = [];
  // Load from startIndex through end, then wrap from 0 to startIndex (full schedule)
  const totalToLoad = items.length;

  for (let i = 0; i < totalToLoad; i++) {
    const index = (startIndex + i) % items.length;

    try {
      const slug = items[index].slug;
      const videoPath = await getVideoPath(slug);
      videoPaths.push(videoPath);
    } catch (err) {
      logger.warn(`Failed to get video for ${items[index].slug}, skipping:`, err.message);
    }
  }

  return { videoPaths, endIndex: (startIndex + totalToLoad) % items.length, videoCount: videoPaths.length };
}

// Playlist-exhausted listener: With -stream_loop -1, this should NOT fire during normal
// operation (FFmpeg loops the playlist forever). This only fires if FFmpeg exits unexpectedly.
// Treat it as crash recovery: restart the stream with the full schedule.
coordinator.on('playlistExhausted', async (event) => {
  const platforms = event.platforms || [event.platform];

  try {
    logger.warn('Playlist exhausted unexpectedly (FFmpeg should loop forever). Restarting stream.', { platforms });

    const schedule = await loadSchedule();

    if (!schedule.isPlaying) {
      logger.info('Schedule not playing, not restarting');
      return;
    }

    const { videoPaths, videoCount } = await buildPlaylistBuffer(schedule.currentIndex);

    if (videoCount === 0) {
      logger.warn('No videos available, cannot restart');
      return;
    }

    // Update player status
    const enrichedItem = await enrichScheduleItem(schedule.items[schedule.currentIndex]);
    playerStatus.currentVideo = enrichedItem;
    playerStatus.currentIndex = schedule.currentIndex;

    // Restart with full schedule and progress tracker
    await coordinator.startPlatforms(platforms, videoPaths, { quality: '1080p' });
    await startProgressTracker();
    logger.info(`Crash recovery: restarted stream with ${videoCount} videos at index ${schedule.currentIndex}`);

  } catch (error) {
    logger.error('Crash recovery failed after playlist exhaustion:', error);
  }
});

// Legacy: handle non-continuous content completion (single video mode)
coordinator.on('allPlatformsCompleted', async (event) => {
  const platforms = event.platforms || [];

  try {
    logger.info('Content completed (non-continuous), advancing to next video', {
      platforms,
      completedContent: event.completedContent
    });

    const result = await playNextVideo();

    if (!result.endReached && result.nowPlaying) {
      const schedule = await loadSchedule();
      const { videoPaths, videoCount } = await buildPlaylistBuffer(schedule.currentIndex);
      await coordinator.startPlatforms(platforms, videoPaths, { quality: '1080p' });
      logger.info('Started next batch:', result.nowPlaying.title);
    } else {
      logger.info('End of schedule reached');
      await coordinator.stopAll();
    }

  } catch (error) {
    logger.error('Auto-progression failed:', error);
  }
});

// Routes

// Get player status
router.get('/status', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    await updatePlayerStatus();

    playerStatus.isPlaying = schedule.isPlaying;

    // If the progress tracker is running, it keeps playerStatus in sync.
    // Otherwise, read currentIndex from the schedule file.
    if (!progressTracker.isTracking) {
      playerStatus.currentIndex = schedule.currentIndex;

      if (schedule.items.length > 0 && schedule.currentIndex < schedule.items.length) {
        const currentItem = schedule.items[schedule.currentIndex];
        playerStatus.currentVideo = await enrichScheduleItem(currentItem);
        playerStatus.totalDuration = playerStatus.currentVideo.duration || 0;
      } else {
        playerStatus.currentVideo = null;
        playerStatus.totalDuration = 0;
      }
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

    // Build full schedule playlist — FFmpeg loops it forever via -stream_loop -1
    const { videoPaths, videoCount } = await buildPlaylistBuffer(schedule.currentIndex);

    if (videoCount === 0) {
      return res.status(400).json({ error: 'No playable videos found in schedule' });
    }

    let result;
    const platforms = platform === 'all' ? ['youtube', 'twitch'] : [platform];

    result = await coordinator.startPlatforms(platforms, videoPaths, { quality });

    // Mark as playing
    schedule.isPlaying = true;
    await saveSchedule(schedule);

    playerStatus.isPlaying = true;
    await updatePlayerStatus();

    // Start tracking schedule progress (advances currentIndex based on video durations)
    await startProgressTracker();

    const enrichedItem = await enrichScheduleItem(currentItem);
    logger.info(`Streaming started on ${platform} with ${videoCount} videos (loops forever)`, result);

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
      stopProgressTracker();
    } else {
      const streamer = coordinator.getStreamer(platform);
      if (!streamer) {
        return res.status(400).json({ error: `Unknown platform: ${platform}` });
      }
      await streamer.stop();
      result = { platform, status: 'stopped' };
      // Stop tracker only if no platforms are still streaming
      if (!coordinator.isAnyStreaming()) {
        stopProgressTracker();
      }
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

    // Start progress tracker if streaming (resumes tracking from current position)
    if (coordinator.isAnyStreaming()) {
      await startProgressTracker();
    }

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

    stopProgressTracker();
    playerStatus.isPlaying = false;

    res.json({ success: true });
  } catch (error) {
    console.error('Error pausing:', error);
    res.status(500).json({ error: 'Failed to pause' });
  }
});

// Play next video (manual skip — hard switches FFmpeg)
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

    // Manual skip: hard switch FFmpeg with a deep buffer (brief stream interruption is acceptable)
    if (coordinator.isAnyStreaming() && result.nowPlaying) {
      const schedule = await loadSchedule();
      const { videoPaths, videoCount } = await buildPlaylistBuffer(schedule.currentIndex);
      await coordinator.hardSwitch(videoPaths);
      await resetProgressTracker(schedule.currentIndex);
      logger.info(`Manual skip: hard switched to ${result.nowPlaying.slug} (${videoCount} videos buffered)`);
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

    // If streaming is active, hard switch with deep buffer (going backwards requires FFmpeg restart)
    if (coordinator.isAnyStreaming()) {
      const { videoPaths, videoCount } = await buildPlaylistBuffer(schedule.currentIndex);
      await coordinator.hardSwitch(videoPaths);
      logger.info(`Previous: hard switched to index ${schedule.currentIndex} (${videoCount} videos buffered)`);
    }

    await saveSchedule(schedule);

    const enrichedItem = await enrichScheduleItem(prevItem);
    await resetProgressTracker(schedule.currentIndex);
    playerStatus.currentVideo = enrichedItem;
    playerStatus.currentIndex = schedule.currentIndex;
    playerStatus.timeElapsed = 0;

    // Prefetch adjacent videos from S3
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

    // If streaming is active, hard switch with deep buffer (jumping requires FFmpeg restart)
    if (coordinator.isAnyStreaming()) {
      const { videoPaths, videoCount } = await buildPlaylistBuffer(index);
      await coordinator.hardSwitch(videoPaths);
      logger.info(`Jump: hard switched to index ${index} (${videoCount} videos buffered)`);
    }

    await saveSchedule(schedule);

    const enrichedItem = await enrichScheduleItem(item);
    await resetProgressTracker(index);
    playerStatus.currentVideo = enrichedItem;
    playerStatus.currentIndex = index;
    playerStatus.timeElapsed = 0;

    // Prefetch adjacent videos from S3
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

    // Stop progress tracker and streaming
    stopProgressTracker();

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
