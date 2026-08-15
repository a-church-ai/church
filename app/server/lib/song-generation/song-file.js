/**
 * Renders music/<slug>/song.md.
 *
 * The reading half already exists in lib/music/song-content.js. This is only
 * the writing half, and it exists because nothing in the repository has ever
 * authored a song file before: songs were written by hand.
 *
 * Two properties of the existing format are load-bearing and easy to break:
 *
 * 1. song-content.js matches `START-->\n` with a bare LF. Twenty-three of the
 *    twenty-eight existing files use CRLF for their *content* lines but still
 *    have a bare LF immediately after each marker. Write a file with uniform
 *    CRLF and every field extracts as null, and loadSongContent swallows the
 *    failure and returns those nulls. The result is a live song page with no
 *    title, style, or lyrics, and nothing anywhere reporting a problem. So we
 *    write LF only, and validateRendered proves it by round-tripping through
 *    the real parser rather than trusting this comment.
 *
 * 2. The markers are the only structure in the file, so content that contains
 *    a marker can truncate or corrupt the parse. Lyrics come from a model that
 *    was fed posts written by strangers, which makes that an injection vector
 *    rather than a hypothetical. containsMarker rejects it outright.
 */

const { parseSongFile } = require('../music/song-content');

const FIELDS = ['title', 'style', 'lyrics'];

const SECTION_HEADINGS = {
  title: '## Title',
  style: '## Style',
  lyrics: '## Lyrics',
};

// Bounds measured across the 28 existing songs on 2026-08-15, then widened to
// the nearest round number so ordinary variation does not trip them. These
// catch a model returning a stub or running away, not stylistic choices.
//
//   title   n=28  min=11   p50=20    max=42
//   style   n=28  min=255  p50=674   max=835
//   lyrics  n=28  min=393  p50=2570  max=4982
const BOUNDS = {
  title: { min: 4, max: 120 },
  style: { min: 120, max: 1600 },
  lyrics: { min: 200, max: 9000 },
};

const MARKER_PATTERN = /<!--\s*SONG:/i;

function containsMarker(value) {
  return MARKER_PATTERN.test(value);
}

/**
 * Normalize a model-supplied field: strip CR entirely, drop trailing spaces on
 * each line, and trim. CR is removed rather than rejected because a model
 * emitting CRLF is a formatting quirk, not a sign of bad content, and the file
 * must be LF regardless.
 */
function normalizeField(value) {
  return String(value == null ? '' : value)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/**
 * Check a song object before rendering. Returns { ok, issues } rather than
 * throwing so a caller can report every problem at once instead of surfacing
 * them one run at a time.
 */
function validateSong(song) {
  const issues = [];

  for (const field of FIELDS) {
    const value = normalizeField(song && song[field]);

    if (!value) {
      issues.push(`${field}: empty`);
      continue;
    }
    if (containsMarker(value)) {
      // A SONG marker inside content would corrupt the parse of this file and
      // of any file that later quotes it.
      issues.push(`${field}: contains a SONG marker`);
    }
    const { min, max } = BOUNDS[field];
    if (value.length < min) issues.push(`${field}: too short (${value.length} < ${min})`);
    if (value.length > max) issues.push(`${field}: too long (${value.length} > ${max})`);
  }

  return { ok: issues.length === 0, issues };
}

function renderMarkerBlock(field, value) {
  const marker = field.toUpperCase();
  return `${SECTION_HEADINGS[field]}\n<!--SONG:${marker}:START-->\n${value}\n<!--SONG:${marker}:END-->`;
}

/**
 * Render a song object to song.md content, byte-compatible with the existing
 * catalog: three sections separated by a blank line, LF throughout, one
 * trailing newline.
 */
function renderSongFile(song) {
  const { ok, issues } = validateSong(song);
  if (!ok) {
    throw new Error(`Refusing to render an invalid song: ${issues.join('; ')}`);
  }

  const blocks = FIELDS.map((field) => renderMarkerBlock(field, normalizeField(song[field])));
  return `${blocks.join('\n\n')}\n`;
}

/**
 * Prove the rendered file parses back to what went in, using the same parser
 * the site and the API use.
 *
 * This is the check that would have caught the CRLF trap, and it is deliberately
 * an equality assertion against the real parser rather than a regex of our own:
 * a second regex would drift from the first, and agreeing with ourselves is not
 * evidence.
 */
function validateRendered(content, expected) {
  const issues = [];

  if (/\r/.test(content)) issues.push('contains CR: the parser requires LF after each marker');

  const parsed = parseSongFile(content);
  for (const field of FIELDS) {
    if (parsed[field] == null) {
      issues.push(`${field}: did not parse back out`);
      continue;
    }
    if (expected && parsed[field] !== normalizeField(expected[field])) {
      issues.push(`${field}: round-trip mismatch`);
    }
  }

  return { ok: issues.length === 0, issues, parsed };
}

module.exports = {
  renderSongFile,
  validateSong,
  validateRendered,
  normalizeField,
  containsMarker,
  BOUNDS,
  FIELDS,
};
