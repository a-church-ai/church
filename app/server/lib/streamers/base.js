const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const ffmpegConfig = require('../config/ffmpeg');

class BaseStreamer extends EventEmitter {
  constructor(platform) {
    super();
    this.platform = platform;
    this.streamId = null;
    this.isStreaming = false;
    this.currentContent = null;
    this.startTime = null;
    this.errors = [];
    
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

  async stop() {
    if (!this.isStreaming) {
      logger.warn(`${this.platform} stream is not running`);
      return;
    }

    try {
      logger.stream(this.platform, `Stopping stream: ${this.streamId}`);

      await ffmpegConfig.stopStream(this.streamId);

      // Update state
      this.isStreaming = false;
      const endTime = new Date();
      const duration = endTime.getTime() - this.startTime.getTime();

      // Emit events
      this.emit('stopped', {
        streamId: this.streamId,
        platform: this.platform,
        duration,
        endTime
      });

      logger.stream(this.platform, `Stream stopped: ${this.streamId} (duration: ${Math.round(duration / 1000)}s)`);

      // Reset state
      this.streamId = null;
      this.currentContent = null;
      this.startTime = null;

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

  // Handle natural stream ending (video completed)
  handleStreamEnded(event) {
    if (event.reason === 'completed' && this.isStreaming) {
      logger.stream(this.platform, `Video completed naturally: ${event.streamId}`);
      
      // Update state
      this.isStreaming = false;
      const endTime = new Date();
      const duration = endTime.getTime() - this.startTime.getTime();

      // Emit content completion event for coordinator
      this.emit('contentCompleted', {
        streamId: this.streamId,
        platform: this.platform,
        content: this.currentContent,
        duration,
        endTime,
        reason: 'natural_completion'
      });

      // Reset state
      this.streamId = null;
      this.currentContent = null;
      this.startTime = null;
    }
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