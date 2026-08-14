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

module.exports = { extractMarker, parseSongFile, loadSongContent };
