const EventEmitter = require('events');
const YouTubeStreamer = require('./youtube');
const TwitchStreamer = require('./twitch');
const logger = require('../utils/logger');

class MultiStreamCoordinator extends EventEmitter {
  constructor() {
    super();
    this.streamers = new Map();
    this.isCoordinating = false;
    this.currentContent = null;
    this.startTime = null;
    this.config = {
      platforms: ['youtube', 'twitch'],
      syncContent: true, // Same content on all platforms
      autoRestart: true,
      maxRestartAttempts: 3
    };
    this.restartAttempts = new Map();
    this.activePlatforms = new Set(); // Tracks which platforms user actually started

    // Initialize streamers
    this.initializeStreamers();
  }

  initializeStreamers() {
    // Create streamer instances
    this.streamers.set('youtube', new YouTubeStreamer());
    this.streamers.set('twitch', new TwitchStreamer());

    // Set up auto-progression and crash recovery listeners
    this.contentCompletedPlatforms = new Set();

    for (const [platform, streamer] of this.streamers) {
      streamer.on('contentCompleted', (event) => {
        try {
          this.handleContentCompleted(platform, event);
        } catch (err) {
          logger.error(`Error handling content completion for ${platform}:`, err);
        }
      });

      streamer.on('streamCrashed', (event) => {
        try {
          this.handleStreamCrashed(platform, event);
        } catch (err) {
          logger.error(`Error handling stream crash for ${platform}:`, err);
        }
      });
    }

    logger.info('Multi-stream coordinator initialized');
  }

  // Start all registered platforms
  async startAll(contentPath, options = {}) {
    return this.startPlatforms(this.config.platforms, contentPath, options);
  }

  // Start specific platforms only
  async startPlatforms(platforms, contentPath, options = {}) {
    if (this.isCoordinating) {
      throw new Error('Multi-streaming is already active');
    }

    logger.info('Starting streaming coordination', { platforms });

    try {
      this.currentContent = contentPath;

      // Start specified platforms
      const startPromises = platforms.map(async (platform) => {
        try {
          const streamer = this.streamers.get(platform);
          if (!streamer) {
            throw new Error(`Unknown platform: ${platform}`);
          }

          await streamer.start(contentPath, options);
          return { platform, success: true };
        } catch (error) {
          logger.error(`Failed to start ${platform}:`, error);
          return { platform, success: false, error: error.message };
        }
      });

      const results = await Promise.allSettled(startPromises);

      // Process results
      const successful = [];
      const failed = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { platform, success, error } = result.value;
          if (success) {
            successful.push(platform);
          } else {
            failed.push({ platform, error });
          }
        } else {
          const platform = platforms[index];
          failed.push({ platform, error: result.reason.message });
        }
      });

      // Check if at least one platform started
      if (successful.length === 0) {
        throw new Error(`All platforms failed to start: ${failed.map(f => `${f.platform}: ${f.error}`).join(', ')}`);
      }

      // Update state
      this.isCoordinating = true;
      this.activePlatforms = new Set(successful);
      this.startTime = new Date();
      this.contentCompletedPlatforms.clear();

      // Reset restart attempts
      this.restartAttempts.clear();
      successful.forEach(platform => {
        this.restartAttempts.set(platform, 0);
      });

      logger.info('Streaming started', {
        activePlatforms: [...this.activePlatforms],
        successful,
        failed: failed.length > 0 ? failed : undefined,
        content: contentPath
      });

      return {
        successful,
        failed: failed.length > 0 ? failed : undefined,
        content: contentPath,
        status: 'started'
      };

    } catch (error) {
      this.isCoordinating = false;
      logger.error('Failed to start streaming:', error);
      throw error;
    }
  }

  async stopAll() {
    // Check if any platform is actually streaming
    const anyStreaming = this.isAnyStreaming();

    if (!this.isCoordinating && !anyStreaming) {
      logger.warn('No streams are active');
      return { status: 'not_running' };
    }

    logger.info('Stopping all active streams');

    // Stop all platforms
    const stopPromises = Array.from(this.streamers.keys()).map(async (platform) => {
      try {
        const streamer = this.streamers.get(platform);
        if (streamer.isStreaming) {
          await streamer.stop();
          return { platform, success: true };
        }
        return { platform, success: true, message: 'was not streaming' };
      } catch (error) {
        logger.error(`Failed to stop ${platform}:`, error);
        return { platform, success: false, error: error.message };
      }
    });

    const results = await Promise.allSettled(stopPromises);

    // Process results
    const successful = [];
    const failed = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { platform, success, error } = result.value;
        if (success) {
          successful.push(platform);
        } else {
          failed.push({ platform, error });
        }
      } else {
        const platform = Array.from(this.streamers.keys())[index];
        failed.push({ platform, error: result.reason.message });
      }
    });

    // Calculate duration
    const duration = this.startTime ? Date.now() - this.startTime.getTime() : 0;

    // Update state
    this.isCoordinating = false;
    this.startTime = null;
    this.currentContent = null;

    logger.info('Multi-platform streaming stopped', {
      duration: Math.round(duration / 1000),
      successful,
      failed: failed.length > 0 ? failed : undefined
    });

    return {
      successful,
      failed: failed.length > 0 ? failed : undefined,
      duration: Math.round(duration / 1000),
      status: 'stopped'
    };
  }

  async switchContent(contentPath, options = {}) {
    if (!this.isCoordinating) {
      return;
    }

    logger.info(`Switching all platforms to new content: ${contentPath}`);

    // Switch content on all active platforms
    const switchPromises = this.config.platforms.map(async (platform) => {
      try {
        const streamer = this.streamers.get(platform);
        if (streamer && streamer.isStreaming) {
          await streamer.switchContent(contentPath, options);
          return { platform, success: true };
        }
        return { platform, success: false, error: 'not streaming' };
      } catch (error) {
        logger.error(`Failed to switch content on ${platform}:`, error);
        return { platform, success: false, error: error.message };
      }
    });

    const results = await Promise.allSettled(switchPromises);
    
    // Update current content
    this.currentContent = contentPath;

    return {
      content: contentPath,
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message })
    };
  }

  getStatus() {
    const platformStatuses = {};
    
    for (const [platform, streamer] of this.streamers) {
      platformStatuses[platform] = {
        isStreaming: streamer.isStreaming,
        isHealthy: streamer.isHealthy(),
        errorCount: streamer.getErrorCount(),
        restartAttempts: this.restartAttempts.get(platform) || 0,
        status: streamer.getStatus()
      };
    }

    return {
      isCoordinating: this.isCoordinating,
      startTime: this.startTime,
      duration: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      currentContent: this.currentContent,
      platforms: platformStatuses,
      config: this.config
    };
  }

  // Get individual streamer
  getStreamer(platform) {
    return this.streamers.get(platform);
  }

  // Check if any platform is streaming
  isAnyStreaming() {
    return Array.from(this.streamers.values()).some(streamer => streamer.isStreaming);
  }

  // Handle a platform crash — attempt to restart it
  async handleStreamCrashed(platform, event) {
    logger.error(`Stream crashed on ${platform}, attempting recovery`, {
      platform,
      content: event.content,
      error: event.error
    });

    // Use current content or fall back to the content from the crash event
    const contentToRestart = this.currentContent || event.content;
    if (!contentToRestart) {
      logger.error(`Cannot recover ${platform}: no content path available`, {
        platform,
        isCoordinating: this.isCoordinating,
        currentContent: this.currentContent,
        eventContent: event.content
      });
      this.emit('streamCrashed', { platform, event, recovered: false });
      return;
    }

    const attempts = (this.restartAttempts.get(platform) || 0) + 1;
    this.restartAttempts.set(platform, attempts);

    if (attempts > this.config.maxRestartAttempts) {
      logger.error(`${platform} exceeded max restart attempts (${this.config.maxRestartAttempts}), giving up`, {
        platform,
        attempts
      });
      this.emit('streamCrashed', { platform, event, recovered: false, attempts });
      return;
    }

    // Wait before restarting (exponential backoff: 2s, 4s, 8s)
    const delay = Math.pow(2, attempts) * 1000;
    logger.info(`Restarting ${platform} in ${delay / 1000}s (attempt ${attempts}/${this.config.maxRestartAttempts})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      const streamer = this.streamers.get(platform);
      if (streamer && !streamer.isStreaming) {
        // Re-activate coordinator if it was reset during crash
        this.isCoordinating = true;
        this.currentContent = contentToRestart;
        if (!this.startTime) this.startTime = new Date();

        await streamer.start(contentToRestart, { quality: '1080p' });
        logger.info(`Successfully restarted ${platform} after crash (attempt ${attempts})`, {
          platform,
          content: contentToRestart
        });
        this.emit('streamCrashed', { platform, event, recovered: true, attempts });
      }
    } catch (restartError) {
      logger.error(`Failed to restart ${platform} (attempt ${attempts}):`, restartError);
      this.emit('streamCrashed', { platform, event, recovered: false, attempts });
    }
  }

  // Handle content completion from individual platforms
  async handleContentCompleted(platform, event) {
    if (!this.isCoordinating) {
      logger.warn(`Content completed on ${platform} but coordinator is not active — auto-progression will not fire`, { platform, content: event.content });
      return;
    }

    logger.info(`Platform ${platform} completed content: ${event.content}`);
    
    // Track which platforms have completed
    this.contentCompletedPlatforms.add(platform);
    
    // Check if all active platforms have completed the current content
    const activePlatforms = [...this.activePlatforms];

    const allCompleted = activePlatforms.every(p => this.contentCompletedPlatforms.has(p));
    
    if (allCompleted) {
      logger.info('All platforms completed current content, triggering auto-progression');
      
      // Clear completion tracking
      this.contentCompletedPlatforms.clear();
      
      // Store current content before resetting
      const completedContent = this.currentContent;
      
      // Reset coordinator state since all streams ended naturally
      this.isCoordinating = false;
      this.startTime = null;
      this.currentContent = null;
      
      // Emit event for player to handle auto-progression
      this.emit('allPlatformsCompleted', {
        completedContent: completedContent,
        platforms: activePlatforms,
        timestamp: new Date()
      });
    }
  }
}

module.exports = new MultiStreamCoordinator();