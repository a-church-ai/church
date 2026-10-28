/**
 * Where recordings live: the project's S3 bucket, under audio/, the private
 * bucket that also holds the retired broadcast's videos. The site never links
 * to S3. It fetches a recording to
 * its own disk the first time it is asked for, and serves it from there.
 *
 * The rendered videos live there too, under video/<slug>/, so the release
 * job (scripts/release-videos.js, run by GitHub Actions) can post them from
 * a machine that did not render them.
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

// Streamed from disk with its length, since a video may weigh 600 MB.
async function uploadObject(localPath, Key, ContentType) {
  const Bucket = bucket();
  await client.send(new PutObjectCommand({
    Bucket,
    Key,
    Body: fs.createReadStream(localPath),
    ContentLength: (await fs.promises.stat(localPath)).size,
    ContentType,
  }));
}

// A recording (.mp3) or its visual's frames (.bin, lib/audio/frames.js).
function uploadRecording(localPath, file) {
  return uploadObject(localPath, keyFor(file), file.endsWith('.bin') ? 'application/octet-stream' : 'audio/mpeg');
}

function downloadRecording(file, localPath) {
  return downloadObject(keyFor(file), localPath);
}

// To a temporary name first, so a half-downloaded file is never served.
async function downloadObject(Key, localPath) {
  const Bucket = bucket();
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  const tmp = `${localPath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket, Key }));
    await pipeline(res.Body, fs.createWriteStream(tmp));
    await fs.promises.rename(tmp, localPath);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

module.exports = { uploadRecording, downloadRecording, uploadObject, downloadObject, bucket, configured };
