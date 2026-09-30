/**
 * Reads a song's authored content out of music/<slug>/.
 *
 * Extracted from routes/api.js so the human-facing song page and the agent-facing
 * API read the catalog through the same code. They used to be the same function in
 * one file; when the song page moved to index.js the choice was duplicate it or
 * share it, and duplicated parsers drift.
 *
 * song.md wraps each field in <!--SONG:FIELD:START--> / <!--SONG:FIELD:END--> markers
 * so the file stays readable as prose while remaining machine-parseable.
 */

const path = require('path');
const fs = require('fs').promises;
const { MUSIC_DIR } = require('../utils/data');
const { extractTldr } = require('../docs/tldr');

// Content between a matched pair of SONG markers, or null if the pair is absent.
function extractMarker(content, marker) {
  const regex = new RegExp(`<!--SONG:${marker}:START-->\\n([\\s\\S]*?)\\n<!--SONG:${marker}:END-->`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function parseSongFile(content) {
  return {
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

// One line on what a song is, for the Music page: the first sentence or two of
// its context, distilled the way a document's description is. Songs change
// only by deploy, so each is read once. '' when a song has no context.
const descriptions = new Map();

async function songDescription(song) {
  if (descriptions.has(song.slug)) return descriptions.get(song.slug);
  const { context } = await loadSongContent(song.slug);
  const text = context ? extractTldr(context, { title: song.title }).text : '';
  descriptions.set(song.slug, text);
  return text;
}

module.exports = { extractMarker, parseSongFile, loadSongContent, songDescription };
