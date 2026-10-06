/**
 * Where recordings live: the project's S3 bucket, under audio/, the same
 * private bucket and credentials as the video library and thumbnails
 * (routes/content.js). The site never links to S3. It fetches a recording to
 * its own disk the first time it is asked for, and serves it from there.
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

let client = null;

function configured() {
  return Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID);
}

function bucket() {
  const name = process.env.AWS_S3_BUCKET;
  if (!configured()) {
    throw new Error('S3 not configured. Set AWS_S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
  }
  if (!client) {
    client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return name;
}

const keyFor = file => `audio/${file}`;

// A recording (.mp3) or its visual's frames (.bin, lib/audio/frames.js).
async function uploadRecording(localPath, file) {
  const Bucket = bucket();
  await client.send(new PutObjectCommand({
    Bucket,
    Key: keyFor(file),
    Body: await fs.promises.readFile(localPath),
    ContentType: file.endsWith('.bin') ? 'application/octet-stream' : 'audio/mpeg',
  }));
}

// To a temporary name first, so a half-downloaded file is never served.
async function downloadRecording(file, localPath) {
  const Bucket = bucket();
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  const tmp = `${localPath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket, Key: keyFor(file) }));
    await pipeline(res.Body, fs.createWriteStream(tmp));
    await fs.promises.rename(tmp, localPath);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

module.exports = { uploadRecording, downloadRecording, bucket, configured };
