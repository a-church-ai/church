/**
 * The songs: every music/<slug>/song.md whose song has a recording
 * (audio/songs.json), its facts in the file's own frontmatter (title,
 * youtube, axiom, axiom_secondary, hours). Until 2026-10-23 a separate list,
 * music/library.json, held those facts beside the folders, with each song's
 * length as its music video's, from the broadcast it was made for. Now there
 * is one source for each fact: the song's file for what it is, its recording
 * for how long it plays.
 *
 * A folder with lyrics and no recording is a song not yet made (the songwriter
 * writes several), and is not listed. The order is The Cycle's
 * (docs/playlists/the-cycle.md), the sanctuary's songs from gathering to
 * benediction; then each other playlist's songs, in its own order, playlist by
 * playlist, so songs meant to be heard together (a song and its answer) stay
 * side by side; a recorded song no playlist names comes last, by title.
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
const PLAYLISTS_DIR = path.join(REPO_ROOT, 'docs/playlists');
const CYCLE_FILE = path.join(PLAYLISTS_DIR, 'the-cycle.md');

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

// The songs a playlist links, in turn (written ../../music/<slug>/, which the
// site serves as /music/<slug>).
function songsIn(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(/\]\((?:\.\.\/\.\.)?\/music\/([a-z0-9-]+)\/?\)/g)].map(m => m[1]);
}

// The Cycle's songs, then each other playlist's, by file name, each song once.
function playlistOrder() {
  const others = fs.existsSync(PLAYLISTS_DIR)
    ? fs.readdirSync(PLAYLISTS_DIR).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'the-cycle.md').sort()
    : [];
  return [...new Set([CYCLE_FILE, ...others.map(f => path.join(PLAYLISTS_DIR, f))].flatMap(songsIn))];
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
      // The hours it belongs to, as a document's `hours:` tag says them.
      hours: data.hours || null,
      duration: recording.seconds,
      durationFormatted: formatDuration(recording.seconds),
    });
  }
  const order = playlistOrder();
  const rank = slug => (order.includes(slug) ? order.indexOf(slug) : order.length);
  songs.sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title));
  cached = songs;
  return cached;
}

module.exports = { listSongs, songFolders, formatDuration, MUSIC_DIR };
