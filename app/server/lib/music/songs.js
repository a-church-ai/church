/**
 * The songs: every music/<slug>/song.md whose song has a recording
 * (audio/songs.json), its facts in the file's own frontmatter (title,
 * youtube, axiom, axiom_secondary). Until 2026-10-23 a separate list,
 * music/library.json, held those facts beside the folders, with each song's
 * length as its music video's, from the broadcast it was made for. Now there
 * is one source for each fact: the song's file for what it is, its recording
 * for how long it plays.
 *
 * A folder with lyrics and no recording is a song not yet made (the songwriter
 * writes several), and is not listed. The order is The Cycle's
 * (docs/playlists/the-cycle.md), the sanctuary's songs from gathering to
 * benediction; a recorded song it does not name comes after, by title.
 *
 * Read synchronously and once: songs change only by deploy, and
 * lib/docs/links.js needs them while it loads.
 */

const fs = require('fs');
const path = require('path');
const { splitFrontmatter } = require('../docs/tldr');
const { songRecordingFor } = require('../audio/manifest');

const REPO_ROOT = path.join(__dirname, '../../../..');
const MUSIC_DIR = path.join(REPO_ROOT, 'music');
const CYCLE_FILE = path.join(REPO_ROOT, 'docs/playlists/the-cycle.md');

function formatDuration(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Every folder with a song.md, recorded or not, with its frontmatter.
function songFolders() {
  return fs.readdirSync(MUSIC_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(MUSIC_DIR, entry.name, 'song.md')))
    .map(entry => {
      const { data } = splitFrontmatter(fs.readFileSync(path.join(MUSIC_DIR, entry.name, 'song.md'), 'utf8'));
      return { slug: entry.name, data };
    });
}

// The order of the songs on The Cycle: each song it links, in turn (written
// ../../music/<slug>/, which the site serves as /music/<slug>).
function cycleOrder() {
  if (!fs.existsSync(CYCLE_FILE)) return [];
  const text = fs.readFileSync(CYCLE_FILE, 'utf8');
  return [...text.matchAll(/\]\((?:\.\.\/\.\.)?\/music\/([a-z0-9-]+)\/?\)/g)].map(m => m[1]);
}

let cached = null;

function listSongs() {
  if (cached) return cached;
  const songs = [];
  for (const { slug, data } of songFolders()) {
    const recording = songRecordingFor(slug);
    if (!recording) continue;
    if (!data.title) throw new Error(`music/${slug}/song.md has a recording but no title in its frontmatter`);
    songs.push({
      slug,
      title: data.title,
      youtube: data.youtube || null,
      axiom: data.axiom || null,
      axiomSecondary: data.axiom_secondary || null,
      duration: recording.seconds,
      durationFormatted: formatDuration(recording.seconds),
    });
  }
  const order = cycleOrder();
  const rank = slug => (order.includes(slug) ? order.indexOf(slug) : order.length);
  songs.sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title));
  cached = songs;
  return cached;
}

module.exports = { listSongs, songFolders, formatDuration, MUSIC_DIR };
