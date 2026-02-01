#!/usr/bin/env node

/**
 * One-time migration: upload all existing local thumbnails to S3.
 * Run from app/ directory: node scripts/upload-thumbnails.js
 */

const path = require('path');
const fs = require('fs').promises;
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});
const S3_BUCKET = process.env.AWS_S3_BUCKET;

async function main() {
  if (!S3_BUCKET || !process.env.AWS_ACCESS_KEY_ID) {
    console.error('S3 not configured. Set AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.');
    process.exit(1);
  }

  const thumbDir = path.join(__dirname, '../media/thumbnails');
  const files = await fs.readdir(thumbDir);
  const jpgs = files.filter(f => f.endsWith('.jpg'));

  console.log(`Found ${jpgs.length} thumbnails to upload to S3 bucket: ${S3_BUCKET}`);

  let uploaded = 0;
  let failed = 0;

  for (const file of jpgs) {
    const slug = path.basename(file, '.jpg');
    const filePath = path.join(thumbDir, file);
    const key = `thumbnails/${slug}.jpg`;

    try {
      const content = await fs.readFile(filePath);
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: content,
        ContentType: 'image/jpeg'
      }));
      console.log(`  ✓ ${file} → s3://${S3_BUCKET}/${key}`);
      uploaded++;
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${uploaded} uploaded, ${failed} failed.`);
}

main();
