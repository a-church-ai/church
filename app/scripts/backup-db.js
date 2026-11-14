#!/usr/bin/env node
/**
 * The database's nightly backup into S3 (.github/workflows/backup-db.yml), since
 * Supabase's free tier keeps none we can restore from: the dumps the workflow
 * made (`supabase db dump`, the schema and the data) go to
 * backups/db/<date>/, and backups older than 30 days are deleted, so an
 * address the log forgot after 30 days is gone from every copy within about
 * 60 (/privacy says so).
 *
 *   node scripts/backup-db.js <schema.sql> <data.sql>
 *
 * Restoring is the reverse: `psql` the schema, then the data, into a fresh
 * project (docs/reference/railway-deploy.md, "The database").
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { uploadObject, listObjects, deleteObjects } = require('../server/lib/audio/storage');

const KEEP_DAYS = 30;
const PREFIX = 'backups/db/';

async function main() {
  const files = process.argv.slice(2);
  if (files.length !== 2) throw new Error('usage: node scripts/backup-db.js <schema.sql> <data.sql>');
  for (const f of files) {
    const { size } = fs.statSync(f);
    if (!size) throw new Error(`${f} is empty: the dump failed, so nothing is uploaded and nothing older is deleted`);
  }
  const day = new Date().toISOString().slice(0, 10);
  for (const f of files) {
    const key = `${PREFIX}${day}/${path.basename(f)}`;
    await uploadObject(f, key, 'application/sql');
    console.log(`uploaded ${key} (${Math.round(fs.statSync(f).size / 1024)} KB)`);
  }
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const old = (await listObjects(PREFIX)).filter(key => key.slice(PREFIX.length, PREFIX.length + 10) < cutoff);
  if (old.length) {
    await deleteObjects(old);
    console.log(`deleted ${old.length} file(s) of backups older than ${KEEP_DAYS} days`);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
