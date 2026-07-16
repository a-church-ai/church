const EventEmitter = require('events');
const YouTubeStreamer = require('./youtube');
const TwitchStreamer = require('./twitch');
const BaseStreamer = require('./base');
const ffmpegConfig = require('../config/ffmpeg');
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

    // Health/reconciliation loop — see startHealthLoop().
    this.healthCheckTimer = null;
    this.lastReconcileAt = null;
    this.lastDriftReport = null; // Most recent drift event, for /heal diagnostics

    // Per-platform "first time we observed continuous health since last
    // unhealthy" timestamp. Drives the restart-counter reset after sustained
    // healthy streaming (prevents a flaky network blip from permanently
    // exhausting the per-platform restart budget).
    this.healthSince = new Map();

    // Per-platform "restart attempt in flight" guard. Prevents the reconcile
    // loop from spawning concurrent restart attempts when an existing
    // handleStreamCrashed is in its backoff delay.
    this.pendingRestart = new Set();

    // Initialize streamers
    this.initializeStreamers();
    this.startHealthLoop();
  }

  // Periodic reconciliation. Every interval we walk every streamer, ask each
  // to compare its flag against ffmpeg ground truth, and clear the
  // coordinator's own isCoordinating flag if no platform is actually
  // broadcasting. Drift is logged loud and emitted as a 'drift' event so
  // anything wired to it (alerting, /heal diagnostics, recovery) can react.
  startHealthLoop() {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => {
      try {
        this.reconcile();
      } catch (err) {
        logger.error('Health-loop reconcile threw:', err);
      }
    }, MultiStreamCoordinator.HEALTH_CHECK_INTERVAL_MS);
    // Don't keep the event loop alive solely for the health timer (matters
    // for graceful shutdown and tests).
    if (this.healthCheckTimer.unref) this.healthCheckTimer.unref();
    logger.info(`Streaming health loop running every ${MultiStreamCoordinator.HEALTH_CHECK_INTERVAL_MS / 1000}s`);
  }

  stopHealthLoop() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // Walk every streamer + check coordinator state against ffmpeg ground truth.
  // Returns a report. If drift is found, the offending flags are cleared, a
  // 'drift' event is emitted, AND auto-restart fires (via handleStreamCrashed)
  // for any platform that drifted — IF autoRestart is enabled AND there's no
  // restart already in flight for that platform.
  //
  // Also resets per-platform restart counters when a streamer has been
  // continuously healthy for HEALTH_RESET_AFTER_MS — so a transient blip
  // doesn't permanently exhaust the restart budget.
  reconcile() {
    const streamerReports = [];
    const driftedPlatforms = [];
    let anyDrift = false;

    for (const streamer of this.streamers.values()) {
      const report = streamer.reconcile();
      streamerReports.push(report);
      if (report.drift) {
        anyDrift = true;
        driftedPlatforms.push(streamer.platform);
      }

      // Track sustained health → reset restart counter when streamer has
      // been healthy for at least HEALTH_RESET_AFTER_MS. This means a flaky
      // network blip increments the counter, but a successful re-broadcast
      // that runs cleanly for 5 minutes wipes the slate.
      const isCurrentlyHealthy = streamer.isHealthy && streamer.isHealthy();
      if (isCurrentlyHealthy) {
        if (!this.healthSince.has(streamer.platform)) {
          this.healthSince.set(streamer.platform, Date.now());
        } else {
          const healthDuration = Date.now() - this.healthSince.get(streamer.platform);
          const currentAttempts = this.restartAttempts.get(streamer.platform) || 0;
          if (healthDuration >= MultiStreamCoordinator.HEALTH_RESET_AFTER_MS && currentAttempts > 0) {
            logger.info(`Resetting restart counter for ${streamer.platform} — has been continuously healthy for ${Math.round(healthDuration / 1000)}s`, {
              platform: streamer.platform,
              previousAttempts: currentAttempts,
            });
            this.restartAttempts.set(streamer.platform, 0);
          }
        }
      } else {
        this.healthSince.delete(streamer.platform);
      }
    }

    // Coordinator-level drift: we think we're broadcasting but no streamer
    // actually is. This was the 4-month silent failure mode.
    const anyActuallyStreaming = this.isAnyActuallyStreaming();
    const coordinatorDrift = this.isCoordinating && !anyActuallyStreaming;
    if (coordinatorDrift) {
      logger.error('Coordinator state drift detected: isCoordinating=true but no platform is actually broadcasting. Resetting coordinator state.', {
        activePlatforms: [...this.activePlatforms],
        currentContent: this.currentContent,
        startTime: this.startTime,
      });
      this.isCoordinating = false;
      this.startTime = null;
      this.activePlatforms.clear();
      anyDrift = true;
    }

    this.lastReconcileAt = new Date();
    const report = {
      timestamp: this.lastReconcileAt,
      isCoordinating: this.isCoordinating,
      coordinatorDrift,
      streamers: streamerReports,
      anyDrift,
    };

    if (anyDrift) {
      this.lastDriftReport = report;
      this.emit('drift', report);

      // Auto-restart: trigger handleStreamCrashed for any platform that
      // drifted, IF auto-restart is enabled, IF we have content to recover
      // with, AND IF a restart isn't already in flight. This closes the loop
      // — drift detection alone clears the flag; auto-restart actually
      // brings the broadcast back up.
      if (this.config.autoRestart && this.currentContent) {
        for (const platform of driftedPlatforms) {
          if (this.pendingRestart.has(platform)) {
            logger.debug(`Auto-restart skipped for ${platform} — restart already in flight`, { platform });
            continue;
          }
          logger.info(`Auto-restart triggered by drift detection for ${platform}`, { platform });
          // Fire-and-forget — handleStreamCrashed manages its own backoff
          // and counter; we don't await so reconcile completes promptly.
          this.handleStreamCrashed(platform, {
            content: this.currentContent,
            error: 'auto-restart from drift detection',
            reason: 'drift',
          }).catch(err => {
            logger.error(`Drift auto-restart for ${platform} threw:`, err);
          });
        }
      }
    }
    return report;
  }

  // Truth-checking version of isAnyStreaming — verifies ffmpeg subprocesses
  // are actually alive, not just that flags say streaming. Used for drift
  // detection and self-healing start.
  isAnyActuallyStreaming() {
    for (const streamer of this.streamers.values()) {
      if (!streamer.isStreaming || !streamer.streamId) continue;
      if (ffmpegConfig.isProcessAlive(streamer.streamId)) {
        const ageMs = ffmpegConfig.getLastProgressAge(streamer.streamId);
        if (ageMs !== null && ageMs < BaseStreamer.MAX_PROGRESS_STALE_MS) {
          return true;
        }
      }
    }
    return false;
  }

  // Force a clean coordinator state. Stops any ffmpeg subprocesses we know
  // about and clears every flag. Idempotent and safe to call when nothing is
  // actually running. Used by startPlatforms when drift is detected.
  async forceCleanup() {
    logger.warn('Force-cleaning streaming state');
    // Stop every streamer that thinks it's streaming. If the stop() itself
    // throws because the underlying ffmpeg process is already dead, that's
    // fine — we still want the flags reset.
    for (const streamer of this.streamers.values()) {
      if (streamer.isStreaming) {
        try {
          await streamer.stop();
        } catch (err) {
          logger.warn(`Force-stop on ${streamer.platform} threw (likely already dead): ${err.message}`);
        }
      }
      // Belt-and-suspenders flag reset in case stop() didn't get there.
      streamer.isStreaming = false;
      streamer.isContinuous = false;
      streamer.streamId = null;
      streamer.currentContent = null;
      streamer.startTime = null;
    }
    this.isCoordinating = false;
    this.startTime = null;
    this.currentContent = null;
    this.activePlatforms.clear();
    this.contentCompletedPlatforms.clear();
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

      streamer.on('playlistExhausted', (event) => {
        try {
          this.handlePlaylistExhausted(platform, event);
        } catch (err) {
          logger.error(`Error handling playlist exhaustion for ${platform}:`, err);
        }
      });
    }

    logger.info('Multi-stream coordinator initialized');
  }

  // Start all registered platforms
  async startAll(contentPath, options = {}) {
    return this.startPlatforms(this.config.platforms, contentPath, options);
  }

  // Start specific platforms only.
  //
  // Three cases:
  //
  // 1. Nothing currently coordinating → fresh start (the original path).
  // 2. Coordinating but no platform actually broadcasting (drift) → force
  //    cleanup and fall through to a fresh start.
  // 3. Coordinating AND at least one platform actually broadcasting →
  //    intersect the requested set with the actually-broadcasting set:
  //      - if every requested platform is already running, throw
  //        ALREADY_RUNNING (true no-op).
  //      - otherwise, start ONLY the platforms that aren't running yet,
  //        leaving the in-progress streamers untouched. This is the
  //        "user clicked Start All while Twitch was already live" case.
  //
  // contentPath can be a single path string or an array of paths for deep
  // buffering.
  async startPlatforms(platforms, contentPath, options = {}) {
    let additive = false;
    let preExistingActive = new Set();

    if (this.isCoordinating) {
      if (this.isAnyActuallyStreaming()) {
        // Partition the request against ffmpeg ground truth.
        preExistingActive = new Set(
          platforms.filter(p => {
            const s = this.streamers.get(p);
            return s && s.isStreaming && s.streamId && ffmpegConfig.isProcessAlive(s.streamId);
          })
        );
        const needToStart = platforms.filter(p => !preExistingActive.has(p));

        if (needToStart.length === 0) {
          const err = new Error('Multi-streaming is already active');
          err.code = 'ALREADY_RUNNING';
          err.currentState = this.getStatus();
          throw err;
        }

        // Additive path: at least one requested platform isn't broadcasting
        // yet. Start ONLY the missing ones; don't touch the live streamers.
        logger.info(`Adding platforms to active coordination`, {
          currentlyActive: [...this.activePlatforms],
          requested: platforms,
          alreadyRunning: [...preExistingActive],
          willStart: needToStart,
        });
        platforms = needToStart;
        additive = true;
      } else {
        // Drift recovery: flag says coordinating, ffmpeg truth says no.
        // This was the 4-month silent outage signature.
        logger.error('startPlatforms called with isCoordinating=true but ffmpeg ground truth shows nothing is broadcasting. Forcing cleanup and proceeding with fresh start.', {
          requestedPlatforms: platforms,
          activePlatforms: [...this.activePlatforms],
        });
        await this.forceCleanup();
        this.emit('drift', {
          timestamp: new Date(),
          source: 'startPlatforms',
          recovered: true,
          message: 'Stale isCoordinating flag cleared by start request',
        });
      }
    }

    const multiPlatform = additive
      ? (preExistingActive.size + platforms.length) > 1
      : platforms.length > 1;
    logger.info('Starting streaming coordination', { platforms, videoCount: Array.isArray(contentPath) ? contentPath.length : 1, multiPlatform, additive });

    try {
      // Store the first video as current content for display/tracking
      this.currentContent = Array.isArray(contentPath) ? contentPath[0] : contentPath;

      // Start specified platforms
      const streamOptions = { ...options, multiPlatform };
      const startPromises = platforms.map(async (platform) => {
        try {
          const streamer = this.streamers.get(platform);
          if (!streamer) {
            throw new Error(`Unknown platform: ${platform}`);
          }

          await streamer.startContinuous(contentPath, streamOptions);
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

      if (additive) {
        // Add to existing coordination — don't reset startTime, don't clear
        // contentCompletedPlatforms (mid-stream playback state for the
        // already-running platforms), don't reset restart counters for
        // platforms that didn't restart.
        this.isCoordinating = true; // idempotent (already true)
        successful.forEach(p => this.activePlatforms.add(p));
        successful.forEach(p => this.restartAttempts.set(p, 0));

        logger.info('Streaming added to active coordination', {
          activePlatforms: [...this.activePlatforms],
          newlyStarted: successful,
          previouslyActive: [...preExistingActive],
          failed: failed.length > 0 ? failed : undefined,
          content: contentPath
        });

        return {
          successful,
          alreadyRunning: [...preExistingActive],
          failed: failed.length > 0 ? failed : undefined,
          content: contentPath,
          status: 'added'
        };
      }

      // Fresh-start path — clobbers prior state
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
      // If this was an additive start that failed, the pre-existing streamers
      // are still running — don't clear isCoordinating. Otherwise (fresh
      // start that failed), clear it like before.
      if (!additive) {
        this.isCoordinating = false;
      }
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

    logger.info(`Switching active platforms to new content: ${contentPath}`);

    // Switch content on active platforms only (delegates to queueNext in continuous mode)
    const switchPromises = [...this.activePlatforms].map(async (platform) => {
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

  /**
   * Hard switch: stop and restart FFmpeg on all active platforms.
   * Used for manual skip/previous/jump — brief stream interruption.
   */
  async hardSwitch(contentPath, options = {}) {
    if (!this.isCoordinating) {
      return;
    }

    logger.info(`Hard switching active platforms to: ${contentPath}`);

    const switchPromises = [...this.activePlatforms].map(async (platform) => {
      try {
        const streamer = this.streamers.get(platform);
        if (streamer && streamer.isStreaming) {
          await streamer.hardSwitch(contentPath, options);
          return { platform, success: true };
        }
        return { platform, success: false, error: 'not streaming' };
      } catch (error) {
        logger.error(`Failed to hard switch ${platform}:`, error);
        return { platform, success: false, error: error.message };
      }
    });

    const results = await Promise.allSettled(switchPromises);
    this.currentContent = contentPath;
    this.contentCompletedPlatforms.clear();

    return {
      content: contentPath,
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message })
    };
  }

  getStatus() {
    const platformStatuses = {};

    for (const [platform, streamer] of this.streamers) {
      const streamerStatus = streamer.getStatus();
      const ffmpegAlive = streamer.streamId ? ffmpegConfig.isProcessAlive(streamer.streamId) : false;
      const progressAge = streamer.streamId ? ffmpegConfig.getLastProgressAge(streamer.streamId) : null;
      platformStatuses[platform] = {
        isStreaming: streamer.isStreaming,
        isHealthy: streamer.isHealthy(),
        errorCount: streamer.getErrorCount(),
        restartAttempts: this.restartAttempts.get(platform) || 0,
        ffmpegAlive,
        progressAgeMs: progressAge,
        // Drift = flag says streaming, but ffmpeg truth disagrees
        drift: streamer.isStreaming && (!ffmpegAlive || (progressAge !== null && progressAge > BaseStreamer.MAX_PROGRESS_STALE_MS)),
        status: streamerStatus,
      };
    }

    const anyActuallyStreaming = this.isAnyActuallyStreaming();
    return {
      isCoordinating: this.isCoordinating,
      isActuallyStreaming: anyActuallyStreaming,
      coordinatorDrift: this.isCoordinating && !anyActuallyStreaming,
      startTime: this.startTime,
      duration: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      currentContent: this.currentContent,
      platforms: platformStatuses,
      lastReconcileAt: this.lastReconcileAt,
      lastDriftReport: this.lastDriftReport,
      config: this.config,
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

  // Handle a platform crash — attempt to restart it.
  //
  // Concurrency: the pendingRestart guard prevents overlap when this is
  // triggered from BOTH the streamer's 'streamCrashed' event AND the
  // reconcile loop's drift detection in the same window. Without the guard,
  // we'd race two restart attempts for the same platform.
  async handleStreamCrashed(platform, event) {
    if (this.pendingRestart.has(platform)) {
      logger.debug(`handleStreamCrashed for ${platform} skipped — restart already in flight`, { platform });
      return;
    }
    this.pendingRestart.add(platform);

    try {
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

          const multiPlatform = this.activePlatforms.size > 1;
          await streamer.startContinuous(contentToRestart, { quality: '1080p', multiPlatform });
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
    } finally {
      this.pendingRestart.delete(platform);
    }
  }

  /**
   * Handle playlist exhaustion — FFmpeg exited after finishing the concat playlist.
   * With -stream_loop -1 this should NOT happen during normal operation (FFmpeg loops forever).
   * This is a crash-recovery path: reset coordinator state and emit so the player layer can restart.
   */
  async handlePlaylistExhausted(platform, event) {
    logger.warn(`Playlist exhausted on ${platform} (unexpected — FFmpeg should loop forever)`, {
      platform,
      content: event.content,
      duration: Math.round((event.duration || 0) / 1000)
    });

    // Reset coordinator state — FFmpeg has stopped
    this.isCoordinating = false;
    this.startTime = null;

    // Emit for the player layer to reload with next batch
    this.emit('playlistExhausted', {
      platform,
      platforms: [...this.activePlatforms],
      content: event.content,
      videosPlayed: event.videosPlayed,
      timestamp: new Date()
    });
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

      // Clear completion tracking for next round
      this.contentCompletedPlatforms.clear();

      // Store current content
      const completedContent = this.currentContent;

      // Check if any platform is still streaming (continuous mode — FFmpeg still running)
      const anyStillStreaming = this.isAnyStreaming();

      if (!anyStillStreaming) {
        // All FFmpeg processes have ended — reset coordinator state
        this.isCoordinating = false;
        this.startTime = null;
        this.currentContent = null;
      }
      // If still streaming (continuous mode), keep coordinator active

      // Emit event for player to handle auto-progression
      this.emit('allPlatformsCompleted', {
        completedContent: completedContent,
        platforms: activePlatforms,
        continuous: anyStillStreaming,
        timestamp: new Date()
      });
    }
  }
}

// Reconciliation interval. 30s catches drift within roughly one playback
// progression window (most schedule tracks are 1–8 min) without flooding
// logs. Tuned together with BaseStreamer.MAX_PROGRESS_STALE_MS (90s): a
// stream has to be silent for at least one interval+threshold combo to be
// declared drift, so transient hiccups don't cause false positives.
MultiStreamCoordinator.HEALTH_CHECK_INTERVAL_MS = 30 * 1000;

// How long a streamer must stay continuously healthy before its restart
// counter resets. Tuned against the burst pattern: 3 attempts in 2+4+8=14
// seconds. If 5 minutes pass cleanly after that, the underlying problem
// was transient and we shouldn't punish the next crash with a depleted
// budget.
MultiStreamCoordinator.HEALTH_RESET_AFTER_MS = 5 * 60 * 1000;

module.exports = new MultiStreamCoordinator();