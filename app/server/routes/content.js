const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const router = express.Router();

// Library file path (source of truth)
const LIBRARY_FILE = path.join(__dirname, '../../../music/library.json');

// S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});
const S3_BUCKET = process.env.AWS_S3_BUCKET;

// Configure multer for file uploads - use slug as filename
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../media/library');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Slug is passed in the request params
    const slug = req.params.slug;
    if (!slug) {
      return cb(new Error('Slug is required for upload'));
    }
    cb(null, `${slug}.mp4`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2000 * 1024 * 1024 // 2GB max file size
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|avi|mov|mkv|webm|m4v|mpg|mpeg/;
    const ext = path.extname(file.originalname).toLowerCase().substring(1);

    if (allowedTypes.test(ext)) {
      return cb(null, true);
    }

    cb(new Error('Invalid file type. Only video files are allowed.'));
  }
});

// Helper functions
async function loadLibrary() {
  try {
    const data = await fs.readFile(LIBRARY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function saveLibrary(library) {
  await fs.writeFile(LIBRARY_FILE, JSON.stringify(library, null, 2));
}

async function uploadToS3(filePath, slug) {
  if (!S3_BUCKET || !process.env.AWS_ACCESS_KEY_ID) {
    console.log('S3 not configured, skipping upload');
    return null;
  }

  try {
    const fileContent = await fs.readFile(filePath);
    const key = `${slug}.mp4`;

    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileContent,
      ContentType: 'video/mp4'
    }));

    console.log(`Uploaded ${slug}.mp4 to S3`);
    return `s3://${S3_BUCKET}/${key}`;
  } catch (error) {
    console.error('S3 upload error:', error);
    throw error;
  }
}

async function deleteFromS3(slug) {
  if (!S3_BUCKET || !process.env.AWS_ACCESS_KEY_ID) {
    console.log('S3 not configured, skipping delete');
    return;
  }

  try {
    const key = `${slug}.mp4`;

    await s3Client.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key
    }));

    console.log(`Deleted ${slug}.mp4 from S3`);
  } catch (error) {
    console.error('S3 delete error:', error);
    // Don't throw - just log the error
  }
}

async function uploadThumbnailToS3(slug) {
  if (!S3_BUCKET || !process.env.AWS_ACCESS_KEY_ID) {
    return null;
  }

  try {
    const thumbnailPath = path.join(__dirname, '../../media/thumbnails', `${slug}.jpg`);
    const fileContent = await fs.readFile(thumbnailPath);
    const key = `thumbnails/${slug}.jpg`;

    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileContent,
      ContentType: 'image/jpeg'
    }));

    console.log(`Uploaded thumbnail ${slug}.jpg to S3`);
    return `s3://${S3_BUCKET}/${key}`;
  } catch (error) {
    console.error('S3 thumbnail upload error:', error);
    return null;
  }
}

async function downloadThumbnailFromS3(slug) {
  if (!S3_BUCKET || !process.env.AWS_ACCESS_KEY_ID) {
    return null;
  }

  const key = `thumbnails/${slug}.jpg`;
  const localPath = path.join(__dirname, '../../media/thumbnails', `${slug}.jpg`);
  const tmpPath = `${localPath}.tmp`;

  try {
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    const response = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key
    }));

    const { createWriteStream } = require('fs');
    const { pipeline } = require('stream/promises');

    const writeStream = createWriteStream(tmpPath);
    await pipeline(response.Body, writeStream);

    await fs.rename(tmpPath, localPath);
    console.log(`Downloaded thumbnail ${slug}.jpg from S3`);
    return localPath;
  } catch (error) {
    try { await fs.unlink(tmpPath); } catch {}
    if (error.name === 'NoSuchKey') return null;
    console.error('S3 thumbnail download error:', error);
    return null;
  }
}

async function deleteThumbnailFromS3(slug) {
  if (!S3_BUCKET || !process.env.AWS_ACCESS_KEY_ID) {
    return;
  }

  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: `thumbnails/${slug}.jpg`
    }));
    console.log(`Deleted thumbnail ${slug}.jpg from S3`);
  } catch (error) {
    console.error('S3 thumbnail delete error:', error);
  }
}

async function downloadFromS3(slug) {
  if (!S3_BUCKET || !process.env.AWS_ACCESS_KEY_ID) {
    console.log('S3 not configured, cannot download');
    return null;
  }

  const key = `${slug}.mp4`;
  const localPath = path.join(__dirname, '../../media/library', `${slug}.mp4`);
  const tmpPath = `${localPath}.tmp`;

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    console.log(`Downloading ${slug}.mp4 from S3...`);

    const response = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key
    }));

    // Stream directly to disk via .tmp file (never buffer in memory)
    const { createWriteStream } = require('fs');
    const { pipeline } = require('stream/promises');

    const writeStream = createWriteStream(tmpPath);
    await pipeline(response.Body, writeStream);

    // Atomic rename — only visible to other code once fully written
    await fs.rename(tmpPath, localPath);

    console.log(`Downloaded ${slug}.mp4 from S3 to ${localPath}`);
    return localPath;
  } catch (error) {
    // Clean up partial .tmp file on failure
    try { await fs.unlink(tmpPath); } catch {}

    if (error.name === 'NoSuchKey') {
      console.log(`Video ${slug}.mp4 not found in S3`);
      return null;
    }
    console.error('S3 download error:', error);
    return null;
  }
}

function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Error getting video duration:', err);
        resolve(0);
      } else {
        resolve(metadata.format.duration || 0);
      }
    });
  });
}

function generateThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['10%'],
        filename: path.basename(thumbnailPath),
        folder: path.dirname(thumbnailPath),
        size: '320x180'
      })
      .on('end', () => resolve(thumbnailPath))
      .on('error', (err) => {
        console.error('Error generating thumbnail:', err);
        resolve(null);
      });
  });
}

function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Routes

// Get all songs from library
router.get('/', async (req, res) => {
  try {
    const library = await loadLibrary();
    res.json(library);
  } catch (error) {
    console.error('Error loading library:', error);
    res.status(500).json({ error: 'Failed to load library' });
  }
});

// Get songs that have videos (for scheduling)
router.get('/with-video', async (req, res) => {
  try {
    const library = await loadLibrary();
    const withVideo = library.filter(song => song.hasVideo);
    res.json(withVideo);
  } catch (error) {
    console.error('Error loading library:', error);
    res.status(500).json({ error: 'Failed to load library' });
  }
});

// Get a single song by slug
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const library = await loadLibrary();
    const song = library.find(s => s.slug === slug);

    if (!song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    res.json(song);
  } catch (error) {
    console.error('Error loading song:', error);
    res.status(500).json({ error: 'Failed to load song' });
  }
});

// Upload or update video for a song
router.post('/:slug/video', upload.single('video'), async (req, res) => {
  try {
    const { slug } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    // Find song in library
    const library = await loadLibrary();
    const songIndex = library.findIndex(s => s.slug === slug);

    if (songIndex === -1) {
      // Delete uploaded file since song doesn't exist
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: 'Song not found in library' });
    }

    const videoPath = req.file.path;

    // Upload to S3 (local file is kept as cache)
    try {
      await uploadToS3(videoPath, slug);
    } catch (s3Error) {
      console.error('S3 upload failed, but local file saved:', s3Error.message);
      // Continue even if S3 fails - we still have the local file
    }

    // Get video duration
    const duration = await getVideoDuration(videoPath);

    // Generate thumbnail
    const thumbnailPath = path.join(__dirname, '../../media/thumbnails', `${slug}.jpg`);
    await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
    await generateThumbnail(videoPath, thumbnailPath);

    // Upload thumbnail to S3 (don't fail the upload if this errors)
    try {
      await uploadThumbnailToS3(slug);
    } catch (err) {
      console.error('S3 thumbnail upload failed:', err.message);
    }

    // Update library entry
    library[songIndex].hasVideo = true;
    library[songIndex].duration = duration;
    library[songIndex].durationFormatted = formatDuration(duration);

    await saveLibrary(library);

    res.json({
      success: true,
      song: library[songIndex]
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// Delete video for a song (keeps song in library, just removes video)
router.delete('/:slug/video', async (req, res) => {
  try {
    const { slug } = req.params;

    const library = await loadLibrary();
    const songIndex = library.findIndex(s => s.slug === slug);

    if (songIndex === -1) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Delete from S3
    await deleteFromS3(slug);

    // Delete local video file
    const videoPath = path.join(__dirname, '../../media/library', `${slug}.mp4`);
    try {
      await fs.unlink(videoPath);
    } catch (err) {
      console.error('Error deleting local video file:', err);
    }

    // Delete thumbnail (local + S3)
    const thumbnailPath = path.join(__dirname, '../../media/thumbnails', `${slug}.jpg`);
    try {
      await fs.unlink(thumbnailPath);
    } catch (err) {
      console.error('Error deleting thumbnail:', err);
    }
    await deleteThumbnailFromS3(slug);

    // Update library
    library[songIndex].hasVideo = false;
    delete library[songIndex].duration;
    delete library[songIndex].durationFormatted;

    await saveLibrary(library);

    res.json({ success: true, song: library[songIndex] });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Update song metadata (title, suno, youtube links)
router.put('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { title, suno, youtube } = req.body;

    const library = await loadLibrary();
    const songIndex = library.findIndex(s => s.slug === slug);

    if (songIndex === -1) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Update allowed fields
    if (title !== undefined) library[songIndex].title = title;
    if (suno !== undefined) library[songIndex].suno = suno;
    if (youtube !== undefined) library[songIndex].youtube = youtube;

    await saveLibrary(library);

    res.json({ success: true, song: library[songIndex] });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update song' });
  }
});

// Add a new song to library
router.post('/', async (req, res) => {
  try {
    const { slug, title, suno, youtube } = req.body;

    if (!slug || !title) {
      return res.status(400).json({ error: 'Slug and title are required' });
    }

    const library = await loadLibrary();

    // Check if slug already exists
    if (library.find(s => s.slug === slug)) {
      return res.status(400).json({ error: 'Song with this slug already exists' });
    }

    const newSong = {
      slug,
      title,
      suno: suno || null,
      youtube: youtube || null,
      hasVideo: false
    };

    library.push(newSong);
    await saveLibrary(library);

    res.json({ success: true, song: newSong });

  } catch (error) {
    console.error('Create error:', error);
    res.status(500).json({ error: 'Failed to create song' });
  }
});

// Delete a song entirely from library
router.delete('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const library = await loadLibrary();
    const songIndex = library.findIndex(s => s.slug === slug);

    if (songIndex === -1) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Delete video file if exists
    if (library[songIndex].hasVideo) {
      // Delete from S3
      await deleteFromS3(slug);

      // Delete local files
      const videoPath = path.join(__dirname, '../../media/library', `${slug}.mp4`);
      try {
        await fs.unlink(videoPath);
      } catch (err) {
        console.error('Error deleting video file:', err);
      }

      const thumbnailPath = path.join(__dirname, '../../media/thumbnails', `${slug}.jpg`);
      try {
        await fs.unlink(thumbnailPath);
      } catch (err) {
        console.error('Error deleting thumbnail:', err);
      }
      await deleteThumbnailFromS3(slug);
    }

    // Remove from library
    library.splice(songIndex, 1);
    await saveLibrary(library);

    res.json({ success: true, message: 'Song deleted' });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete song' });
  }
});

module.exports = router;
module.exports.downloadFromS3 = downloadFromS3;
module.exports.downloadThumbnailFromS3 = downloadThumbnailFromS3;
