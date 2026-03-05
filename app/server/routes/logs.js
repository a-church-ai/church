const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const router = express.Router();

// Log directory
const LOG_DIR = process.env.LOG_DIRECTORY || path.join(__dirname, '../../logs');

// Strict filename validation — only allow streaming log files
const VALID_FILENAME = /^streaming-(error-)?[\d-]+\.log(\.gz)?$/;

// GET /api/logs — list all log files with metadata
router.get('/', async (req, res) => {
  try {
    const files = await fs.readdir(LOG_DIR);

    // Filter to only log files (skip audit JSON files)
    const logFiles = files.filter(f => VALID_FILENAME.test(f));

    // Get metadata for each file
    const logs = await Promise.all(
      logFiles.map(async (filename) => {
        const filePath = path.join(LOG_DIR, filename);
        const stat = await fs.stat(filePath);

        // Parse date and type from filename
        const isError = filename.includes('-error-');
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : null;

        return {
          filename,
          date,
          type: isError ? 'error' : 'main',
          size: stat.size,
          sizeFormatted: formatBytes(stat.size),
          modified: stat.mtime.toISOString()
        };
      })
    );

    // Sort by date descending, errors after main for same date
    logs.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.type !== b.type) return a.type === 'main' ? -1 : 1;
      return 0;
    });

    res.json({ logs, directory: LOG_DIR });

  } catch (error) {
    console.error('Error listing logs:', error);
    res.status(500).json({ error: 'Failed to list log files' });
  }
});

// GET /api/logs/:filename — download a specific log file
router.get('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;

    // Validate filename strictly
    if (!VALID_FILENAME.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Resolve path and verify it's within log directory
    const filePath = path.resolve(LOG_DIR, filename);
    const resolvedLogDir = path.resolve(LOG_DIR);

    if (!filePath.startsWith(resolvedLogDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Check file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Log file not found' });
    }

    // Set appropriate headers for download
    const isGzip = filename.endsWith('.gz');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', isGzip ? 'application/gzip' : 'text/plain; charset=utf-8');

    // Stream the file
    const { createReadStream } = require('fs');
    createReadStream(filePath).pipe(res);

  } catch (error) {
    console.error('Error downloading log:', error);
    res.status(500).json({ error: 'Failed to download log file' });
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

module.exports = router;
