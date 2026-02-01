const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

class Logger {
  constructor() {
    this.logger = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return this.logger;

    const logLevel = process.env.LOG_LEVEL || 'info';
    const logDirectory = process.env.LOG_DIRECTORY || path.join(__dirname, '../../../logs');

    // Ensure log directory exists
    const fs = require('fs-extra');
    fs.ensureDirSync(logDirectory);

    // Create file transport with rotation
    const fileTransport = new DailyRotateFile({
      filename: path.join(logDirectory, 'streaming-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d'
    });

    // Create error file transport
    const errorTransport = new DailyRotateFile({
      filename: path.join(logDirectory, 'streaming-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d'
    });

    // Create console transport
    const consoleTransport = new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    });

    // Create logger
    this.logger = winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'simple-streamer' },
      transports: [
        fileTransport,
        errorTransport,
        consoleTransport
      ]
    });

    this.initialized = true;
    return this.logger;
  }

  info(message, meta = {}) {
    this.init().info(message, meta);
  }

  error(message, error = null) {
    const meta = error ? { error: error.message, stack: error.stack } : {};
    this.init().error(message, meta);
  }

  warn(message, meta = {}) {
    this.init().warn(message, meta);
  }

  debug(message, meta = {}) {
    this.init().debug(message, meta);
  }

  stream(platform, message, meta = {}) {
    this.init().info(`[${platform.toUpperCase()}] ${message}`, meta);
  }

  getLogger() {
    return this.init();
  }
}

module.exports = new Logger();