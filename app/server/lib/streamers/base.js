const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const ffmpegConfig = require('../config/ffmpeg');
const ConcatPlaylist = require('../utils/concat-playlist');

class BaseStreamer extends EventEmitter {
  constructor(platform) {
    super();
    this.platform = platform;
    this.streamId = null;
    this.isStreaming = false;
    this.currentContent = null;
    this.startTime = null;
    this.errors = [];

    // Continuous mode state
    this.isContinuous = false;
    this.playlist = new ConcatPlaylist(platform);
    this.durationTimer = null;
    this.currentVideoDuration = null;
    this.pendingNext = null;

    // Listen for FFmpeg stream events
    ffmpegConfig.on('streamEnded', (event) => {
      if (event.platform === this.platform && event.streamId === this.streamId) {
        this.handleStreamEnded(event);
      }
    });
  }

  async validateStreamKey() {
    const envKey = `${this.platform.toUpperCase()}_STREAM_KEY`;
    const streamKey = process.env[envKey];

    if (!streamKey) {
      throw new Error(`Stream key not found in environment variable: ${envKey}`);
    }

    if (streamKey.length < 10) {
      throw new Error(`Stream key appears invalid (too short): ${envKey}`);
    }

    return streamKey;
  }

  async start(contentPath, options = {}) {
    if (this.isStreaming) {
      throw new Error(`${this.platform} stream is already running`);
    }

    try {
      // Validate inputs
      const streamKey = await this.validateStreamKey();
      await ffmpegConfig.validateInputFile(contentPath);

      // Generate unique stream ID
      this.streamId = `${this.platform}-${uuidv4()}`;

      logger.stream(this.platform, `Starting stream with content: ${contentPath}`);

      // Start FFmpeg stream
      await ffmpegConfig.startStream(this.streamId, contentPath, this.platform, streamKey, options);

      // Update state
      this.isStreaming = true;
      this.currentContent = contentPath;
      this.startTime = new Date();
      this.errors = [];

      // Emit events
      this.emit('started', {
        streamId: this.streamId,
        platform: this.platform,
        content: contentPath,
        startTime: this.startTime
      });

      logger.stream(this.platform, `Stream started successfully: ${this.streamId}`);
      return this.streamId;

    } catch (error) {
      this.errors.push({
        timestamp: new Date(),
        error: error.message
      });

      logger.error(`Failed to start ${this.platform} stream: ${error.message}`, error);

      this.emit('error', {
        platform: this.platform,
        error: error.message,
        content: contentPath
      });

      throw error;
    }
  }

  /**
   * Start in continuous mode using the concat demuxer.
   * A single FFmpeg process + RTMP connection persists across videos.
   */
  async startContinuous(contentPath, options = {}) {
    if (this.isStreaming) {
      throw new Error(`${this.platform} stream is already running`);
    }

    try {
      const streamKey = await this.validateStreamKey();
      const fileInfo = await ffmpegConfig.validateInputFile(contentPath);

      this.streamId = `${this.platform}-${uuidv4()}`;
      this.isContinuous = true;
      this.currentContent = contentPath;
      this.currentVideoDuration = fileInfo.duration;
      this.pendingNext = null;

      logger.stream(this.platform, `Starting continuous stream with content: ${contentPath}`);

      // Initialize concat playlist with first video
      this.playlist.init(contentPath);

      // Start FFmpeg with concat demuxer input
      await ffmpegConfig.startConcatStream(
        this.streamId,
        this.playlist.getPath(),
        this.platform,
        streamKey,
        options
      );

      // Update state
      this.isStreaming = true;
      this.startTime = new Date();
      this.errors = [];

      // Start duration timer to detect when this video entry finishes
      this._startDurationTimer();

      this.emit('started', {
        streamId: this.streamId,
        platform: this.platform,
        content: contentPath,
        startTime: this.startTime,
        continuous: true
      });

      logger.stream(this.platform, `Continuous stream started: ${this.streamId}`);
      return this.streamId;

    } catch (error) {
      this.isContinuous = false;
      this.errors.push({ timestamp: new Date(), error: error.message });
      logger.error(`Failed to start continuous ${this.platform} stream: ${error.message}`, error);
      this.emit('error', { platform: this.platform, error: error.message, content: contentPath });
      throw error;
    }
  }

  /**
   * Queue the next video for seamless playback (continuous mode only).
   * Appends to the concat playlist — FFmpeg reads it when current video ends.
   */
  async queueNext(contentPath) {
    if (!this.isContinuous || !this.isStreaming) {
      throw new Error(`Cannot queue next: ${this.platform} is not in continuous streaming mode`);
    }

    const fileInfo = await ffmpegConfig.validateInputFile(contentPath);

    // Append to playlist file — FFmpeg will read it when current entry ends
    this.playlist.appendNext(contentPath);

    // Store pending info for when duration timer fires
    this.pendingNext = {
      contentPath,
      duration: fileInfo.duration
    };

    logger.stream(this.platform, `Queued next video: ${contentPath} (${Math.round(fileInfo.duration)}s)`);
  }

  /**
   * Duration timer: fires when the current video should be done.
   * Emits contentCompleted so coordinator can trigger auto-progression.
   *
   * Uses a conservative buffer because the timer must fire AFTER FFmpeg has
   * started reading the next concat entry (if one exists). Firing too early
   * means the next pre-queue hasn't happened yet → playlist exhaustion.
   */
  _startDurationTimer() {
    if (this.durationTimer) clearTimeout(this.durationTimer);
    if (!this.currentVideoDuration) return;

    // Add 5s buffer to account for timing variance and ensure FFmpeg
    // has transitioned to the next concat entry before we fire.
    // The concat demuxer reads the next entry lazily, so we need to
    // be sure it has already opened the next file.
    const durationMs = (this.currentVideoDuration * 1000) + 5000;

    this.durationTimer = setTimeout(() => {
      this._onVideoEntryCompleted();
    }, durationMs);
  }

  _onVideoEntryCompleted() {
    const completedContent = this.currentContent;

    if (this.pendingNext) {
      // Transition to next video tracking
      this.currentContent = this.pendingNext.contentPath;
      this.currentVideoDuration = this.pendingNext.duration;
      this.pendingNext = null;

      // Restart duration timer for the new video
      this._startDurationTimer();
    } else {
      // No next video queued — FFmpeg will exhaust the playlist and exit naturally
      logger.warn(`[${this.platform.toUpperCase()}] No next video queued, FFmpeg will end when current video finishes`);
    }

    // Emit per-video completion (NOT stream end — FFmpeg is still running)
    this.emit('contentCompleted', {
      streamId: this.streamId,
      platform: this.platform,
      content: completedContent,
      duration: this.currentVideoDuration,
      endTime: new Date(),
      reason: 'natural_completion'
    });
  }

  /**
   * Hard switch: stop FFmpeg, reinitialize playlist, restart.
   * Used for manual skip/previous/jump — brief stream interruption is acceptable.
   */
  async hardSwitch(newContentPath, options = {}) {
    logger.stream(this.platform, `Hard switching content to: ${newContentPath}`);
    const wasContinuous = this.isContinuous;
    if (this.durationTimer) clearTimeout(this.durationTimer);
    this.pendingNext = null;

    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Re-enter continuous mode if we were in it before the hard switch
    if (wasContinuous) {
      return await this.startContinuous(newContentPath, options);
    }
    return await this.start(newContentPath, options);
  }

  async stop() {
    if (!this.isStreaming) {
      logger.warn(`${this.platform} stream is not running`);
      return;
    }

    try {
      logger.stream(this.platform, `Stopping stream: ${this.streamId}`);

      // Clean up continuous mode resources
      if (this.durationTimer) {
        clearTimeout(this.durationTimer);
        this.durationTimer = null;
      }
      this.pendingNext = null;
      this.playlist.destroy();

      await ffmpegConfig.stopStream(this.streamId);

      // Update state
      this.isStreaming = false;
      const wasContinuous = this.isContinuous;
      this.isContinuous = false;
      const endTime = new Date();
      const duration = endTime.getTime() - this.startTime.getTime();

      // Emit events
      this.emit('stopped', {
        streamId: this.streamId,
        platform: this.platform,
        duration,
        endTime,
        wasContinuous
      });

      logger.stream(this.platform, `Stream stopped: ${this.streamId} (duration: ${Math.round(duration / 1000)}s)`);

      // Reset state
      this.streamId = null;
      this.currentContent = null;
      this.startTime = null;
      this.currentVideoDuration = null;

    } catch (error) {
      this.errors.push({
        timestamp: new Date(),
        error: error.message
      });

      logger.error(`Failed to stop ${this.platform} stream: ${error.message}`, error);

      this.emit('error', {
        platform: this.platform,
        error: error.message
      });

      throw error;
    }
  }

  getStatus() {
    const baseStatus = {
      platform: this.platform,
      isStreaming: this.isStreaming,
      isContinuous: this.isContinuous,
      streamId: this.streamId,
      currentContent: this.currentContent,
      startTime: this.startTime,
      errors: this.errors.slice(-5) // Last 5 errors
    };

    if (this.isStreaming && this.startTime) {
      baseStatus.duration = Date.now() - this.startTime.getTime();
      baseStatus.ffmpegStatus = ffmpegConfig.getStreamStatus(this.streamId);
    }

    return baseStatus;
  }

  async switchContent(newContentPath, options = {}) {
    if (!this.isStreaming) {
      throw new Error(`Cannot switch content: ${this.platform} stream is not running`);
    }

    // In continuous mode, queue the next video seamlessly
    if (this.isContinuous) {
      return await this.queueNext(newContentPath);
    }

    // Legacy: stop and restart
    logger.stream(this.platform, `Switching content from ${this.currentContent} to ${newContentPath}`);
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
    return await this.start(newContentPath, options);
  }

  clearErrors() {
    this.errors = [];
  }

  getErrorCount() {
    return this.errors.length;
  }

  getLastError() {
    return this.errors.length > 0 ? this.errors[this.errors.length - 1] : null;
  }

  // Handle stream ending (natural completion or crash)
  handleStreamEnded(event) {
    if (!this.isStreaming) return;

    const endTime = new Date();
    const duration = this.startTime ? endTime.getTime() - this.startTime.getTime() : 0;

    // Clean up continuous mode resources
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
    this.pendingNext = null;

    if (event.reason === 'completed') {
      const wasContinuous = this.isContinuous;

      if (wasContinuous) {
        // In continuous mode, FFmpeg ending means the playlist was exhausted
        // (no next video was queued in time). This is a failure case —
        // emit 'playlistExhausted' instead of 'contentCompleted' to avoid
        // triggering duplicate auto-progression (the duration timer already
        // handles normal video transitions).
        logger.stream(this.platform, `Continuous playlist exhausted: ${event.streamId}`);

        // Update state
        this.isStreaming = false;
        this.isContinuous = false;

        this.emit('playlistExhausted', {
          streamId: this.streamId,
          platform: this.platform,
          content: this.currentContent,
          duration,
          endTime,
          reason: 'playlist_exhausted'
        });
      } else {
        logger.stream(this.platform, `Video completed naturally: ${event.streamId}`);

        // Update state
        this.isStreaming = false;
        this.isContinuous = false;

        // Emit content completion event for coordinator
        this.emit('contentCompleted', {
          streamId: this.streamId,
          platform: this.platform,
          content: this.currentContent,
          duration,
          endTime,
          reason: 'natural_completion'
        });
      }
    } else {
      // Stream crashed or exited unexpectedly
      logger.error(`Stream crashed on ${this.platform}: ${event.error || `exit code ${event.exitCode}`}`, {
        streamId: this.streamId,
        platform: this.platform,
        content: this.currentContent,
        reason: event.reason,
        error: event.error,
        exitCode: event.exitCode,
        signal: event.signal,
        duration
      });

      this.errors.push({
        timestamp: endTime,
        error: event.error || `Stream crashed (exit code: ${event.exitCode}, signal: ${event.signal})`
      });

      // Update state
      this.isStreaming = false;
      this.isContinuous = false;

      // Emit crash event so coordinator can attempt recovery
      this.emit('streamCrashed', {
        streamId: this.streamId,
        platform: this.platform,
        content: this.currentContent,
        duration,
        endTime,
        reason: event.reason,
        error: event.error
      });
    }

    // Reset state
    this.streamId = null;
    this.currentContent = null;
    this.startTime = null;
    this.currentVideoDuration = null;
  }

  // Health check method
  isHealthy() {
    const recentErrors = this.errors.filter(
      err => Date.now() - err.timestamp.getTime() < 300000 // Last 5 minutes
    );

    return recentErrors.length < 3; // Healthy if less than 3 errors in 5 minutes
  }
}

module.exports = BaseStreamer;
