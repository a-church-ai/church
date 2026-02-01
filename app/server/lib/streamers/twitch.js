const BaseStreamer = require('./base');
const logger = require('../utils/logger');

class TwitchStreamer extends BaseStreamer {
  constructor() {
    super('twitch');
  }

  async start(contentPath, options = {}) {
    // Twitch-specific options
    const twitchOptions = {
      quality: options.quality || process.env.STREAMING_QUALITY || '1080p',
      framerate: options.framerate || 60, // Twitch prefers 60fps
      bitrate: options.bitrate || process.env.STREAMING_BITRATE_TWITCH,
      preset: 'faster', // Slightly faster preset for Twitch's lower latency preference
      ...options
    };

    logger.stream('twitch', 'Configuring Twitch stream settings', {
      quality: twitchOptions.quality,
      framerate: twitchOptions.framerate,
      bitrate: twitchOptions.bitrate
    });

    return await super.start(contentPath, twitchOptions);
  }

  // Twitch-specific configuration
  getRecommendedSettings() {
    return {
      '720p': {
        resolution: '1280x720',
        bitrate: '3500k',
        framerate: 60,
        description: 'Good quality for most content'
      },
      '720p30': {
        resolution: '1280x720',
        bitrate: '3000k', 
        framerate: 30,
        description: 'Conservative settings for stable streaming'
      },
      '1080p': {
        resolution: '1920x1080',
        bitrate: '6000k',
        framerate: 60,
        description: 'High quality, near Twitch bitrate limit'
      },
      '1080p30': {
        resolution: '1920x1080',
        bitrate: '4500k',
        framerate: 30,
        description: 'High resolution with conservative bitrate'
      }
    };
  }
}

module.exports = TwitchStreamer;