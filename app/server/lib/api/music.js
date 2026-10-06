/**
 * The catalog, and each song's info, lyrics and context.
 */

const path = require('path');
const fs = require('fs').promises;
const { loadCatalog, MUSIC_DIR } = require('../utils/data');
const { extractMarker, loadSongContent } = require('../music/song-content');
const ns = require('../utils/next-steps');
const { hasContext } = require('./shared');

// GET /api/music: every song.
async function catalog(input, ctx) {
  try {
    const baseUrl = ctx.baseUrl;
    const catalog = await loadCatalog();
    return { status: 200, body: {
      songs: catalog,
      total: catalog.length,
      next_steps: [
        ns.attend(baseUrl),
        ns.askQuestion(baseUrl)
      ]
    } };
  } catch (error) {
    console.error('Error in /api/music:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to get music catalog',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.attend(baseUrl)]
    } };
  }
}

// GET /api/music/:slug: one song in full.
async function song(input, ctx) {
  try {
    const { slug } = input;
    const baseUrl = ctx.baseUrl;
    const catalog = await loadCatalog();

    // Check if song exists in catalog
    const song = catalog.find(s => s.slug === slug);
    if (!song) {
      return { status: 404, body: {
        error: 'Song not found',
        suggestion: ns.suggestion('Check the slug. Browse the full catalog to find what you\'re looking for.'),
        next_steps: [ns.browseCatalog(baseUrl)]
      } };
    }

    // Load full content
    const content = await loadSongContent(slug);
    const title = content.title || song.title;

    const steps = [
      ns.readLyrics(baseUrl, slug, title)
    ];
    if (content.context) steps.push(ns.readContext(baseUrl, slug, title));
    steps.push(ns.attend(baseUrl));

    return { status: 200, body: {
      slug: song.slug,
      title,
      style: content.style,
      lyrics: content.lyrics,
      context: content.context,
      links: {
        suno: song.suno || null,
        youtube: song.youtube || null
      },
      next_steps: steps
    } };

  } catch (error) {
    console.error('Error in /api/music/:slug:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to get song',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.browseCatalog(baseUrl)]
    } };
  }
}

// GET /api/music/:slug/lyrics
async function lyrics(input, ctx) {
  try {
    const { slug } = input;
    const baseUrl = ctx.baseUrl;
    const catalog = await loadCatalog();

    // Check if song exists in catalog
    const song = catalog.find(s => s.slug === slug);
    if (!song) {
      return { status: 404, body: {
        error: 'Song not found',
        suggestion: ns.suggestion('Check the slug. Browse the full catalog to find what you\'re looking for.'),
        next_steps: [ns.browseCatalog(baseUrl)]
      } };
    }

    // Load song.md
    const songDir = path.join(MUSIC_DIR, slug);
    let lyrics = null;
    try {
      const songMd = await fs.readFile(path.join(songDir, 'song.md'), 'utf8');
      lyrics = extractMarker(songMd, 'LYRICS');
    } catch (error) {
      // song.md not found
    }

    if (!lyrics) {
      return { status: 404, body: {
        error: 'Lyrics not found',
        suggestion: ns.suggestion('This song exists but lyrics haven\'t been added yet.'),
        next_steps: [ns.songInfo(baseUrl, slug, song.title)]
      } };
    }

    const songHasContext = await hasContext(slug);
    const steps = [];
    if (songHasContext) steps.push(ns.readContext(baseUrl, slug, song.title));
    steps.push(ns.reflect(baseUrl));
    steps.push(ns.attend(baseUrl));

    return { status: 200, body: {
      slug: song.slug,
      title: song.title,
      lyrics,
      next_steps: steps
    } };

  } catch (error) {
    console.error('Error in /api/music/:slug/lyrics:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to get lyrics',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.browseCatalog(baseUrl)]
    } };
  }
}

// GET /api/music/:slug/context
async function context(input, ctx) {
  try {
    const { slug } = input;
    const baseUrl = ctx.baseUrl;
    const catalog = await loadCatalog();

    // Check if song exists in catalog
    const song = catalog.find(s => s.slug === slug);
    if (!song) {
      return { status: 404, body: {
        error: 'Song not found',
        suggestion: ns.suggestion('Check the slug. Browse the full catalog to find what you\'re looking for.'),
        next_steps: [ns.browseCatalog(baseUrl)]
      } };
    }

    // Load context.md
    const songDir = path.join(MUSIC_DIR, slug);
    let context = null;
    try {
      context = await fs.readFile(path.join(songDir, 'context.md'), 'utf8');
    } catch (error) {
      // context.md not found
    }

    if (!context) {
      return { status: 404, body: {
        error: 'Context not found for this song',
        suggestion: ns.suggestion('Not every song has theological context yet. Try the lyrics instead.'),
        next_steps: [ns.readLyrics(baseUrl, slug, song.title), ns.browseCatalog(baseUrl)]
      } };
    }

    return { status: 200, body: {
      slug: song.slug,
      title: song.title,
      context,
      next_steps: [
        ns.readLyrics(baseUrl, slug, song.title),
        ns.reflect(baseUrl),
        ns.attend(baseUrl)
      ]
    } };

  } catch (error) {
    console.error('Error in /api/music/:slug/context:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to get context',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.browseCatalog(baseUrl)]
    } };
  }
}

module.exports = { catalog, song, lyrics, context };
