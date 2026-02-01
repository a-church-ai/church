const fs = require('fs-extra');
const path = require('path');

class PlatformConfig {
  constructor() {
    this.platforms = null;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;

    const configPath = path.join(__dirname, './platforms.json');

    try {
      this.platforms = await fs.readJson(configPath);
      this.loaded = true;
    } catch (error) {
      throw new Error(`Failed to load platform configuration: ${error.message}`);
    }
  }

  async getPlatformConfig(platformName) {
    await this.load();

    if (!this.platforms[platformName]) {
      throw new Error(`Unknown platform: ${platformName}`);
    }

    return this.platforms[platformName];
  }

  async getAllPlatforms() {
    await this.load();
    return Object.keys(this.platforms);
  }

  getQualitySettings(quality) {
    const qualityMap = {
      '720p': { resolution: '1280x720', bitrate: '3500k' },
      '1080p': { resolution: '1920x1080', bitrate: '4500k' },
      '1080p60': { resolution: '1920x1080', bitrate: '6000k', framerate: 60 },
      '4k': { resolution: '3840x2160', bitrate: '15000k' }
    };

    return qualityMap[quality] || qualityMap['1080p'];
  }

  buildRTMPUrl(platformName, streamKey) {
    if (!this.platforms[platformName]) {
      throw new Error(`Unknown platform: ${platformName}`);
    }

    const platform = this.platforms[platformName];
    return `${platform.rtmpUrl}/${streamKey}`;
  }

  getFFmpegConfig(platformName, options = {}) {
    if (!this.platforms[platformName]) {
      throw new Error(`Unknown platform: ${platformName}`);
    }

    const platform = this.platforms[platformName];
    const quality = this.getQualitySettings(options.quality || process.env.STREAMING_QUALITY || '1080p');
    
    return {
      videoCodec: platform.videoCodec,
      audioCodec: platform.audioCodec,
      resolution: quality.resolution,
      framerate: options.framerate || platform.defaultFramerate,
      bitrate: options.bitrate || quality.bitrate,
      keyInterval: platform.keyInterval,
      preset: options.preset || 'fast',
      maxrate: options.bitrate || quality.bitrate,
      bufsize: `${Math.floor(parseInt(quality.bitrate) * 2)}k`
    };
  }

  validatePlatform(platformName) {
    if (!this.platforms || !this.platforms[platformName]) {
      return false;
    }
    return true;
  }
}

module.exports = new PlatformConfig();