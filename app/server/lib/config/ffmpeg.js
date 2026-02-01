const ffmpeg = require('fluent-ffmpeg');
const EventEmitter = require('events');
const platformConfig = require('./platforms');
const logger = require('../utils/logger');

class FFmpegConfig extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map();
  }

  async createStreamCommand(inputFile, platform, streamKey, options = {}) {
    const config = await platformConfig.getPlatformConfig(platform);
    const ffmpegSettings = platformConfig.getFFmpegConfig(platform, options);
    const rtmpUrl = platformConfig.buildRTMPUrl(platform, streamKey);

    const command = ffmpeg(inputFile)
      // Input options (must come first)
      .addInputOption('-re') // Read input at native frame rate
      
      // Video encoding
      .videoCodec(ffmpegSettings.videoCodec)
      .videoBitrate(ffmpegSettings.bitrate)
      .size(ffmpegSettings.resolution)
      .fps(ffmpegSettings.framerate)
      .addOption('-preset', ffmpegSettings.preset)
      .addOption('-g', ffmpegSettings.keyInterval * ffmpegSettings.framerate) // keyframe interval
      .addOption('-keyint_min', ffmpegSettings.keyInterval * ffmpegSettings.framerate)
      
      // Audio encoding  
      .audioCodec(ffmpegSettings.audioCodec)
      .audioBitrate('128k')
      .audioChannels(2)
      .audioFrequency(44100)
      
      // Streaming options
      .format('flv')
      .addOption('-avoid_negative_ts', 'make_zero')
      
      // Output
      .output(rtmpUrl);

    // Add platform-specific optimizations
    if (platform === 'twitch') {
      command.addOption('-tune', 'zerolatency');
    }

    return command;
  }

  async startStream(streamId, inputFile, platform, streamKey, options = {}) {
    if (this.processes.has(streamId)) {
      throw new Error(`Stream ${streamId} is already running`);
    }

    const command = await this.createStreamCommand(inputFile, platform, streamKey, options);
    
    return new Promise((resolve, reject) => {
      let resolved = false;
      
      command
        .on('start', (commandLine) => {
          logger.stream(platform, `Started streaming: ${streamId}`);
          logger.debug(`FFmpeg command: ${commandLine}`);
          
          this.processes.set(streamId, {
            command,
            platform,
            startTime: new Date(),
            status: 'running',
            inputFile,
            streamKey: streamKey.substring(0, 8) + '...', // Log partial key only
            lastProgressUpdate: new Date()
          });
          
          if (!resolved) {
            resolved = true;
            resolve(streamId);
          }
        })
        .on('progress', (progress) => {
          const process = this.processes.get(streamId);
          if (process) {
            process.lastProgressUpdate = new Date();
          }
          
          logger.debug(`Stream ${streamId} progress:`, {
            frames: progress.frames,
            fps: progress.currentFps,
            bitrate: progress.currentKbps,
            time: progress.timemark
          });
        })
        .on('error', (err) => {
          logger.error(`Stream ${streamId} FFmpeg error: ${err.message}`, {
            error: err,
            platform,
            inputFile,
            streamId,
            stack: err.stack
          });
          this.processes.delete(streamId);

          if (!resolved) {
            resolved = true;
            reject(err);
          } else {
            // FFmpeg crashed AFTER startup — emit streamEnded so base streamer knows
            this.emit('streamEnded', {
              streamId,
              platform,
              reason: 'crashed',
              error: err.message,
              inputFile,
              timestamp: new Date()
            });
          }
        })
        .on('end', (stdout, stderr) => {
          const process = this.processes.get(streamId);
          logger.stream(platform, `Stream ended: ${streamId}`, {
            streamId,
            platform,
            inputFile,
            duration: process ? Date.now() - process.startTime.getTime() : 0,
            startTime: process ? process.startTime : null,
            endTime: new Date(),
            stdout: stdout ? stdout.slice(-500) : null,
            stderr: stderr ? stderr.slice(-500) : null
          });
          this.processes.delete(streamId);
          
          // Emit event for natural stream completion (video finished)
          this.emit('streamEnded', {
            streamId,
            platform,
            reason: 'completed',
            inputFile,
            timestamp: new Date()
          });
        })
        .on('exit', (code, signal) => {
          if (code !== 0) {
            logger.error(`Stream ${streamId} exited with code ${code} and signal ${signal}`, {
              streamId,
              platform,
              inputFile,
              exitCode: code,
              signal,
              timestamp: new Date()
            });
          }
          // Safety net: if process is still in map, it wasn't cleaned up by 'end' or 'error'
          if (this.processes.has(streamId)) {
            logger.warn(`Stream ${streamId} exit handler cleaning up orphaned process`);
            this.processes.delete(streamId);
            this.emit('streamEnded', {
              streamId,
              platform,
              reason: code === 0 ? 'completed' : 'crashed',
              exitCode: code,
              signal,
              inputFile,
              timestamp: new Date()
            });
          }
        });

      // Start the stream
      try {
        command.run();
      } catch (error) {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      }
    });
  }

  async stopStream(streamId) {
    const process = this.processes.get(streamId);
    if (!process) {
      logger.warn(`Stream ${streamId} not found, may already be stopped`);
      return;
    }

    return new Promise((resolve) => {
      // Set a timeout in case the 'end' event never fires
      const timeout = setTimeout(() => {
        this.processes.delete(streamId);
        logger.warn(`Stream ${streamId} stop timed out, forcing cleanup`);
        resolve();
      }, 5000);

      process.command.on('end', () => {
        clearTimeout(timeout);
        this.processes.delete(streamId);
        logger.stream(process.platform, `Stopped streaming: ${streamId}`);
        resolve();
      });

      process.command.on('error', (err) => {
        clearTimeout(timeout);
        this.processes.delete(streamId);
        logger.warn(`Stream ${streamId} stop error: ${err.message}`);
        resolve(); // Resolve anyway, stream is considered stopped
      });

      try {
        process.command.kill('SIGTERM');
      } catch (killError) {
        clearTimeout(timeout);
        this.processes.delete(streamId);
        logger.warn(`Stream ${streamId} kill failed: ${killError.message}`);
        resolve();
      }
    });
  }

  getStreamStatus(streamId) {
    const process = this.processes.get(streamId);
    if (!process) {
      return { status: 'stopped' };
    }

    return {
      status: process.status,
      platform: process.platform,
      startTime: process.startTime,
      inputFile: process.inputFile,
      duration: Date.now() - process.startTime.getTime()
    };
  }

  getAllStreams() {
    const streams = {};
    for (const [streamId, process] of this.processes) {
      streams[streamId] = this.getStreamStatus(streamId);
    }
    return streams;
  }

  async stopAllStreams() {
    const streamIds = Array.from(this.processes.keys());
    const promises = streamIds.map(id => this.stopStream(id));
    
    try {
      await Promise.all(promises);
      logger.info(`Stopped ${streamIds.length} streams`);
    } catch (error) {
      logger.error('Error stopping streams:', error);
      throw error;
    }
  }

  isStreamRunning(streamId) {
    return this.processes.has(streamId);
  }

  getRunningStreamCount() {
    return this.processes.size;
  }

  // Utility method to validate input file
  async validateInputFile(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(new Error(`Invalid input file: ${err.message}`));
          return;
        }

        const hasVideo = metadata.streams.some(stream => stream.codec_type === 'video');
        const hasAudio = metadata.streams.some(stream => stream.codec_type === 'audio');

        if (!hasVideo) {
          reject(new Error('Input file must contain video stream'));
          return;
        }

        resolve({
          valid: true,
          duration: metadata.format.duration,
          hasVideo,
          hasAudio,
          videoStreams: metadata.streams.filter(s => s.codec_type === 'video'),
          audioStreams: metadata.streams.filter(s => s.codec_type === 'audio')
        });
      });
    });
  }
}

module.exports = new FFmpegConfig();