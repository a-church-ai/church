#!/usr/bin/env node
/**
 * Writes music/readme.md, all the sanctuary's music, from the catalog
 * (lib/music/readme.js). Run after adding a song, a recording or a playlist;
 * a test fails while it is stale.
 *
 * Usage, from app/: npm run gen:music-readme
 */

const { writeMusicReadme, README_FILE } = require('../server/lib/music/readme');

writeMusicReadme().then(() => console.log(`Wrote ${README_FILE}`)).catch(err => {
  console.error(err);
  process.exit(1);
});
