const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');

/**
 * Manages an FFmpeg concat demuxer playlist file for continuous streaming.
 *
 * The concat demuxer reads entries lazily — it opens the next file only when
 * the current one finishes. We can safely append entries while FFmpeg is
 * processing earlier ones.
 *
 * Playlist format (ffconcat):
 *   ffconcat version 1.0
 *   file '/absolute/path/to/video1.mp4'
 *   file '/absolute/path/to/video2.mp4'
 */
class ConcatPlaylist {
  constructor(platform) {
    this.platform = platform;
    this.playlistPath = path.join(os.tmpdir(), `achurch-${platform}-concat.txt`);
    this.entries = [];
  }

  /**
   * Initialize playlist with the first video
   */
  init(filePath) {
    this.entries = [filePath];
    this._write();
    logger.info(`[${this.platform.toUpperCase()}] Concat playlist initialized`, { path: this.playlistPath, firstVideo: filePath });
  }

  /**
   * Append next video to the playlist. FFmpeg will read it when current video ends.
   * Must be called BEFORE FFmpeg finishes the current entry.
   */
  appendNext(filePath) {
    this.entries.push(filePath);
    this._write();
    logger.info(`[${this.platform.toUpperCase()}] Queued next video in concat playlist`, { video: filePath, totalEntries: this.entries.length });
  }

  /**
   * Get the playlist file path for FFmpeg input
   */
  getPath() {
    return this.playlistPath;
  }

  /**
   * Write the playlist file in ffconcat format
   */
  _write() {
    const lines = ['ffconcat version 1.0'];
    for (const entry of this.entries) {
      // Escape single quotes in file paths
      const escaped = entry.replace(/'/g, "'\\''");
      lines.push(`file '${escaped}'`);
    }
    fs.writeFileSync(this.playlistPath, lines.join('\n') + '\n');
  }

  /**
   * Clean up the playlist temp file
   */
  destroy() {
    try {
      fs.unlinkSync(this.playlistPath);
    } catch {
      // File may already be gone
    }
    this.entries = [];
  }
}

module.exports = ConcatPlaylist;
