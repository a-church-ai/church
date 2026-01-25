const BaseStreamer = require('./base');
const logger = require('../utils/logger');

class YouTubeStreamer extends BaseStreamer {
  constructor() {
    super('youtube');
  }

  async start(contentPath, options = {}) {
    // YouTube-specific options
    const youtubeOptions = {
      quality: options.quality || process.env.STREAMING_QUALITY || '1080p',
      framerate: options.framerate || 30, // YouTube prefers 30fps for stability
      bitrate: options.bitrate || process.env.STREAMING_BITRATE_YOUTUBE,
      preset: 'fast', // Good balance for YouTube
      ...options
    };

    logger.stream('youtube', 'Configuring YouTube stream settings', {
      quality: youtubeOptions.quality,
      framerate: youtubeOptions.framerate,
      bitrate: youtubeOptions.bitrate
    });

    return await super.start(contentPath, youtubeOptions);
  }

  // YouTube-specific configuration
  getRecommendedSettings() {
    return {
      '720p': {
        resolution: '1280x720',
        bitrate: '3500k',
        framerate: 30,
        description: 'Recommended for stable 24/7 streaming'
      },
      '1080p': {
        resolution: '1920x1080', 
        bitrate: '4500k',
        framerate: 30,
        description: 'High quality, requires stable connection'
      },
      '1080p60': {
        resolution: '1920x1080',
        bitrate: '6000k',
        framerate: 60,
        description: 'Premium quality, high bandwidth required'
      }
    };
  }
}

module.exports = YouTubeStreamer;