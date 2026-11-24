/**
 * Reads a song's authored content out of music/<slug>/.
 *
 * Extracted from routes/api.js so the human-facing song page and the agent-facing
 * API read the catalog through the same code. They used to be the same function in
 * one file; when the song page moved to index.js the choice was duplicate it or
 * share it, and duplicated parsers drift.
 *
 * song.md wraps each field in <!--SONG:FIELD:START--> / <!--SONG:FIELD:END--> markers
 * so the file stays readable as prose while remaining machine-parseable. A
 * recorded song's file opens with frontmatter holding its facts (title,
 * youtube, axiom: lib/music/songs.js), kept whole so a file parses and renders
 * back to itself.
 */

const path = require('path');
const fs = require('fs').promises;
const { MUSIC_DIR } = require('../utils/data');
const { extractTldr } = require('../docs/tldr');
const { listSongs } = require('./songs');

// Content between a matched pair of SONG markers, or null if the pair is absent.
function extractMarker(content, marker) {
  const regex = new RegExp(`<!--SONG:${marker}:START-->\\n([\\s\\S]*?)\\n<!--SONG:${marker}:END-->`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function parseSongFile(content) {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(content);
  return {
    frontmatter: front ? front[1] : null,
    title: extractMarker(content, 'TITLE'),
    style: extractMarker(content, 'STYLE'),
    lyrics: extractMarker(content, 'LYRICS')
  };
}

// A missing song.md or context.md is not an error: 17 of 28 songs have context,
// and a song page renders fine without one. Callers get nulls and decide.
async function loadSongContent(slug) {
  const songDir = path.join(MUSIC_DIR, slug);

  let songData = { title: null, style: null, lyrics: null };
  try {
    songData = parseSongFile(await fs.readFile(path.join(songDir, 'song.md'), 'utf8'));
  } catch (error) {
    // song.md not found
  }

  let context = null;
  try {
    context = await fs.readFile(path.join(songDir, 'context.md'), 'utf8');
  } catch (error) {
    // context.md not found
  }

  return { ...songData, context };
}

// One line on what a song is: its own `tldr:` from song.md's frontmatter,
// which every recorded song carries (test/song-file.test.js), else the first
// sentence or two of its context, distilled the way a document's description
// is. The song's page, the Music page, the services and the video releases all
// say it, so a song is described the same way wherever it is met. Songs change
// only by deploy, so each is read once. '' when a song has neither.
const descriptions = new Map();

async function songDescription(song) {
  if (descriptions.has(song.slug)) return descriptions.get(song.slug);
  const own = song.tldr || (listSongs().find(s => s.slug === song.slug) || {}).tldr;
  let text = own || '';
  if (!text) {
    const { context } = await loadSongContent(song.slug);
    text = context ? extractTldr(context, { title: song.title }).text : '';
  }
  descriptions.set(song.slug, text);
  return text;
}

// The first sentence of a song's own context, for saying what the context holds
// beside the link to it. Songs change only by deploy, so each is read once.
const contextLines = new Map();

async function contextLine(slug) {
  if (contextLines.has(slug)) return contextLines.get(slug);
  const { context, title } = await loadSongContent(slug);
  const text = context ? extractTldr(context, { title }).text : '';
  const line = (text.match(/^.*?[.?!](?=\s|$)/) || [text])[0].trim();
  contextLines.set(slug, line);
  return line;
}

module.exports = { extractMarker, parseSongFile, loadSongContent, songDescription, contextLine };
