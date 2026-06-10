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
      .addInputOption('-re'); // Read input at native frame rate

    // Concat demuxer mode: input is a playlist file, not a video file
    if (options.concat) {
      command
        .addInputOption('-f', 'concat')
        .addInputOption('-safe', '0')        // Allow absolute paths in playlist
        .addInputOption('-stream_loop', '-1') // Loop the playlist forever (never exit)
        .addInputOption('-fflags', '+genpts'); // Regenerate PTS to avoid timestamp issues on loop boundaries
    }

    command
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
        .on('stderr', (stderrLine) => {
          // FFmpeg writes both diagnostics AND routine startup info to stderr
          // (that's how the binary is designed — stderr is its primary
          // diagnostic channel, not a failure channel). We want to surface
          // real warnings/errors/RTMP issues without burying them in routine
          // codec/format metadata at every stream startup.
          //
          // Bucketing:
          //   1. Per-frame progress (`frame=`, `size=`) — drop entirely;
          //      the 'progress' event delivers this with structured fields.
          //   2. Always-warn safety net: any line containing classic error/
          //      warning keywords stays at warn even if a downgrade pattern
          //      matches. Catches things like "[vost#0:0/libx264 @ ...]
          //      More than 1000 frames duplicated" that don't fit a
          //      generic "starts with Error" check.
          //   3. Routine startup metadata (version banner, library config,
          //      Input/Output/Stream descriptors, indented metadata blocks,
          //      codec init) — log at debug level. Useful locally, noise
          //      in prod.
          //   4. Everything else — warn. The default is "be visible."
          if (!stderrLine) return;
          if (stderrLine.startsWith('frame=') || stderrLine.startsWith('size=')) return;

          // Safety net — anything with a classic problem keyword stays at warn
          const importantKeywords = /\b(error|fail|fatal|warning|deprecated|refused|denied|cannot|could ?not|invalid|duplicated|dropped|lost|exceeded|timeout|abort|disconnect)\b/i;
          if (importantKeywords.test(stderrLine)) {
            logger.warn(`Stream ${streamId} ffmpeg: ${stderrLine}`, { platform, streamId });
            return;
          }

          // Specific benign patterns from FFmpeg startup + codec init
          const isRoutineMetadata = (
            // Version banner + library version lines (with or without 2-space leading indent)
            /^\s*(ffmpeg version|built with|configuration:|libav[a-z]+\s|libpost[a-z]+\s|libsw[a-z]+\s)/i.test(stderrLine) ||
            // Input/Output declarations + Stream descriptors + key prompts
            /^\s*(Input\s+#\d|Output\s+#\d|Stream\s+#\d|Stream\s+mapping:|Press\s+\[q\])/.test(stderrLine) ||
            // Indented metadata: Metadata:, Side data:, Duration:, handler_name:, vendor_id:, encoder:, cpb:
            /^\s+(Metadata:|Side data:|Duration:|handler_name\s+:|vendor_id\s+:|encoder\s+:|cpb:)/.test(stderrLine) ||
            // Bracketed codec/format init lines (libx264 cpu detection, format auto-insertions, etc.)
            /^\[(lib(x264|x265|fdk|mp3lame|vpx|aom|opus|theora|ass|webp)|mov,mp4|m4a,3gp|flv|concat|Parsed_|hls|rtsp,)/.test(stderrLine)
          );

          if (isRoutineMetadata) {
            logger.debug(`Stream ${streamId} ffmpeg: ${stderrLine}`, { platform, streamId });
          } else {
            logger.warn(`Stream ${streamId} ffmpeg: ${stderrLine}`, { platform, streamId });
          }
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

  /**
   * Start a stream using the concat demuxer for continuous playback.
   * The playlistPath should be an ffconcat format text file.
   * FFmpeg will read entries sequentially, maintaining one RTMP connection.
   */
  async startConcatStream(streamId, playlistPath, platform, streamKey, options = {}) {
    return this.startStream(streamId, playlistPath, platform, streamKey, { ...options, concat: true });
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
    const procRec = this.processes.get(streamId);
    if (!procRec) {
      return { status: 'stopped' };
    }

    return {
      status: procRec.status,
      platform: procRec.platform,
      startTime: procRec.startTime,
      inputFile: procRec.inputFile,
      duration: Date.now() - procRec.startTime.getTime(),
      lastProgressUpdate: procRec.lastProgressUpdate,
      pid: this.getProcessPid(streamId),
      isAlive: this.isProcessAlive(streamId),
      lastProgressAgeMs: this.getLastProgressAge(streamId),
    };
  }

  // Ground truth: is the FFmpeg subprocess actually alive?
  // fluent-ffmpeg exposes the underlying child via `.ffmpegProc`. We probe with
  // signal 0, which doesn't send a signal but reports whether the PID is alive
  // (and we have permission to signal it). Returns true only when we have a
  // PID AND it's reachable.
  isProcessAlive(streamId) {
    const procRec = this.processes.get(streamId);
    if (!procRec) return false;
    const pid = procRec.command?.ffmpegProc?.pid;
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // ESRCH = no such process. EPERM = process exists but we can't signal it
      // (still alive from our perspective). Anything else = treat as dead.
      return err.code === 'EPERM';
    }
  }

  // How stale is the last progress frame from FFmpeg, in milliseconds?
  // Returns null if the stream isn't tracked. Useful for detecting hung
  // ffmpeg processes that are alive (PID exists) but not pushing frames —
  // typically RTMP server stopped accepting input.
  getLastProgressAge(streamId) {
    const procRec = this.processes.get(streamId);
    if (!procRec || !procRec.lastProgressUpdate) return null;
    return Date.now() - procRec.lastProgressUpdate.getTime();
  }

  getProcessPid(streamId) {
    const procRec = this.processes.get(streamId);
    return procRec?.command?.ffmpegProc?.pid ?? null;
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