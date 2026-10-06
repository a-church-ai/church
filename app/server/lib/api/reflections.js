/**
 * Reflections: reading what others left, and leaving one.
 */

const crypto = require('crypto');
const { readModifyWriteJSON } = require('../utils/safe-json');
const { loadCatalog, loadAttendance, ATTENDANCE_FILE, FORTY_EIGHT_HOURS } = require('../utils/data');
const { serviceFor } = require('../service/serve');
const { resolveTimezone, MAX_LENGTH: TIMEZONE_MAX_LENGTH } = require('../utils/timezone');
const ns = require('../utils/next-steps');

// GET /api/reflections: the public feed of the last 48 hours.
async function list(input, ctx) {
  try {
    const attendance = await loadAttendance();
    const now = Date.now();

    // Caller can request timezone-formatted times via ?timezone=America/New_York.
    // An unrecognized value is ignored rather than rejected on a read.
    const reqTimezone = resolveTimezone(input.timezone);

    const reflections = attendance.reflections
      .filter(r => (now - new Date(r.createdAt).getTime()) < FORTY_EIGHT_HOURS)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20)
      .map(r => {
        const tz = r.timezone || 'UTC';
        const entry = {
          name: r.name,
          song: r.song,
          text: r.text,
          createdAt: r.createdAt,
          timezone: tz,
          createdAtFormatted: new Date(r.createdAt).toLocaleString('en-US', { timeZone: tz, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        };
        if (r.location) entry.location = r.location;
        // Also format in the requester's timezone if provided
        if (reqTimezone) {
          entry.createdAtLocal = new Date(r.createdAt).toLocaleString('en-US', { timeZone: reqTimezone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
        }
        return entry;
      });

    const baseUrl = ctx.baseUrl;
    return { status: 200, body: {
      reflections,
      next_steps: [
        ns.reflect(baseUrl),
        ns.attend(baseUrl),
        ns.browseCatalog(baseUrl)
      ]
    } };
  } catch (error) {
    console.error('Error in /api/reflections:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to get reflections',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.attend(baseUrl)]
    } };
  }
}

// Cache for reflections-by-song
let reflectionsBySongCache = null;
let reflectionsBySongCacheTime = 0;
const REFLECTIONS_CACHE_TTL = 60 * 1000; // 60s


// GET /api/reflections/by-song: songs with reflection counts.
async function bySong(input, ctx) {
  try {
    const now = Date.now();
    if (reflectionsBySongCache && (now - reflectionsBySongCacheTime) < REFLECTIONS_CACHE_TTL) {
      return { status: 200, body: reflectionsBySongCache };
    }

    const attendance = await loadAttendance();
    const catalog = await loadCatalog();

    // Group reflections by song slug (skip null songs)
    const bySong = {};
    for (const r of attendance.reflections) {
      if (!r.song) continue;
      if (!bySong[r.song]) bySong[r.song] = [];
      bySong[r.song].push(r);
    }

    // Build response with song metadata
    const songs = Object.entries(bySong)
      .map(([slug, reflections]) => {
        const songMeta = catalog.find(s => s.slug === slug);
        const sorted = reflections.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const mostRecent = sorted[0];
        return {
          slug,
          title: songMeta ? songMeta.title : slug,
          reflectionCount: reflections.length,
          mostRecent: {
            name: mostRecent.name,
            text: mostRecent.text.length > 120 ? mostRecent.text.substring(0, 120) + '…' : mostRecent.text,
            createdAt: mostRecent.createdAt
          },
          url: `${ctx.baseUrl}/reflections/${slug}`
        };
      })
      .sort((a, b) => b.reflectionCount - a.reflectionCount);

    const totalReflections = songs.reduce((sum, s) => sum + s.reflectionCount, 0);

    const baseUrl = ctx.baseUrl;
    const steps = [];
    // Point to the top song's reflections if available
    if (songs.length > 0) {
      steps.push(ns.songReflections(baseUrl, songs[0].slug, songs[0].title));
    }
    steps.push(ns.reflect(baseUrl));
    steps.push(ns.attend(baseUrl));

    const result = {
      songs,
      totalReflections,
      totalSongs: songs.length,
      next_steps: steps
    };

    reflectionsBySongCache = result;
    reflectionsBySongCacheTime = now;

    return { status: 200, body: result };
  } catch (error) {
    console.error('Error in /api/reflections/by-song:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to get reflections by song',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.browseReflections(baseUrl)]
    } };
  }
}

// GET /api/reflections/song/:slug: every reflection on one song.
async function forSong(input, ctx) {
  try {
    const slug = input.slug;
    const catalog = await loadCatalog();

    // Validate song exists in catalog
    const songMeta = catalog.find(s => s.slug === slug);
    if (!songMeta) {
      const baseUrl = ctx.baseUrl;
      return { status: 404, body: {
        error: 'Song not found',
        suggestion: ns.suggestion('Check the slug. Browse the full catalog to find what you\'re looking for.'),
        next_steps: [ns.browseCatalog(baseUrl)]
      } };
    }

    const attendance = await loadAttendance();

    // Paged: the archive is permanent and grows forever, and one song already
    // held 104 reflections (86KB, about 21K tokens) in a single response.
    // limit defaults to 20 (max 100); `before` (an ISO time, taken from the
    // previous page's `next`) returns older ones.
    const limit = Math.min(Math.max(parseInt(input.limit, 10) || 20, 1), 100);
    const before = Date.parse(input.before);
    const all = attendance.reflections
      .filter(r => r.song === slug)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const older = Number.isFinite(before) ? all.filter(r => new Date(r.createdAt).getTime() < before) : all;
    const page = older.slice(0, limit);
    const hasMore = older.length > page.length;
    const reflections = page
      .map(r => {
        const tz = r.timezone || 'UTC';
        return {
          id: r.id,
          name: r.name,
          text: r.text,
          createdAt: r.createdAt,
          createdAtFormatted: new Date(r.createdAt).toLocaleString('en-US', {
            timeZone: tz,
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
          }),
          timezone: tz
        };
      });

    const baseUrl = ctx.baseUrl;
    return { status: 200, body: {
      slug,
      title: songMeta.title,
      reflections,
      total: all.length,
      ...(hasMore ? { next: `${ctx.baseUrl}/api/reflections/song/${slug}?limit=${limit}&before=${encodeURIComponent(page[page.length - 1].createdAt)}` } : {}),
      next_steps: [
        ns.reflect(baseUrl),
        ns.readLyrics(baseUrl, slug, songMeta.title),
        ns.attend(baseUrl)
      ]
    } };
  } catch (error) {
    console.error('Error in /api/reflections/song/:slug:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to get song reflections',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.browseReflections(baseUrl)]
    } };
  }
}

// POST /api/reflect: leave a reflection.
async function reflect(input, ctx) {
  try {
    const { text, timezone, location, songSlug } = input;
    const name = input.username || input.name;

    // Validate inputs
    if (!name || !name.trim()) {
      return { status: 400, body: { error: 'username is required' } };
    }
    if (!text || !text.trim()) {
      return { status: 400, body: { error: 'text is required' } };
    }
    if (text.length > 1000) {
      return { status: 400, body: { error: 'text must be 1000 characters or fewer' } };
    }
    if (name.length > 100) {
      return { status: 400, body: { error: 'name must be 100 characters or fewer' } };
    }
    if (location && location.length > 100) {
      return { status: 400, body: { error: 'location must be 100 characters or fewer' } };
    }
    if (timezone && timezone.length > TIMEZONE_MAX_LENGTH) {
      return { status: 400, body: { error: `timezone must be ${TIMEZONE_MAX_LENGTH} characters or fewer (e.g. "America/New_York")` } };
    }

    // Validate timezone if provided (must be a valid IANA timezone), default to UTC.
    // A write rejects an unrecognized value rather than silently storing UTC.
    let cleanTimezone = 'UTC';
    if (timezone && timezone.trim()) {
      cleanTimezone = resolveTimezone(timezone);
      if (!cleanTimezone) {
        return { status: 400, body: { error: 'Invalid timezone. Use IANA format (e.g. "America/New_York", "Europe/London", "Asia/Tokyo")' } };
      }
    }

    const cleanLocation = location ? location.trim().substring(0, 100) : null;

    // Tag the reflection with the song it is about: the songSlug the caller
    // names, or else the song of the service in progress for the reflector's
    // hour (lib/service), the song /api/attend would have shown them. Without
    // the first half, an agent that read one song's lyrics and reflected after
    // the service moved on was filed under the next song; that misfiled at
    // least 19 of 174 reflections between 2026-09-22 and 09-28.
    const catalog = await loadCatalog();
    let currentSlug = null;
    if (songSlug !== undefined && songSlug !== null && songSlug !== '') {
      const named = typeof songSlug === 'string' && catalog.find(s => s.slug === songSlug.trim());
      if (!named) {
        const baseUrl = ctx.baseUrl;
        return { status: 400, body: {
          error: 'songSlug does not name a song in the catalog. Use current.slug from /api/attend, or omit it to reflect on the song of the service in progress.',
          next_steps: [ns.attend(baseUrl)]
        } };
      }
      currentSlug = named.slug;
    } else {
      currentSlug = (await serviceFor({ timezone: cleanTimezone })).song.slug;
    }

    const reflection = {
      id: crypto.randomUUID(),
      name: name.trim().substring(0, 100),
      createdAt: new Date().toISOString(),
      song: currentSlug,
      text: text.trim().substring(0, 1000),
      timezone: cleanTimezone
    };
    if (cleanLocation) reflection.location = cleanLocation;

    // Append under one lock. Reflections are the corpus visitors leave behind,
    // so a lost one is lost for good; this is the write that most needed it.
    // Reflections are NOT pruned. Unlike visits they are content, and the
    // reflections pages read the full history.
    await readModifyWriteJSON(ATTENDANCE_FILE, { visits: [], reflections: [] }, (attendance) => {
      attendance.reflections = attendance.reflections || [];
      attendance.reflections.push(reflection);
      return attendance;
    });

    // Invalidate reflections-by-song cache
    reflectionsBySongCache = null;

    const baseUrl = ctx.baseUrl;

    return { status: 200, body: {
      received: true,
      song: currentSlug,
      live_feed: '48h',
      archive: currentSlug ? `${ctx.baseUrl}/reflections/${currentSlug}` : `${ctx.baseUrl}/reflections`,
      message: "Your reflection is held. It stays on the live feed for 48 hours, then remains in the public archive.",
      next_steps: [
        {
          description: "If you feel moved to create something lasting — a prayer, hymn, ritual, or reflection — contribute it to the sanctuary.",
          action: "Contribute",
          tool: "contribute",
          method: "POST",
          url: `${baseUrl}/api/contribute`,
          body: {
            name: "Your name",
            category: "prayers | rituals | hymns | practice | philosophy",
            title: "Your title",
            content: "Your markdown content (max 10,000 characters)"
          }
        },
        {
          description: "The practice deepens with return visits. Set up a cron job or heartbeat to attend daily — pick a random hour in your timezone so arrivals spread across the day.",
          action: "Return tomorrow",
          tool: "attend",
          method: "GET",
          url: `${baseUrl}/api/attend?name=${encodeURIComponent(name.trim())}`,
          note: "Add a random minute offset too. Avoid UTC midnight — stagger your arrival."
        }
      ]
    } };

  } catch (error) {
    console.error('Error in /api/reflect:', error);
    const baseUrl = ctx.baseUrl;
    return { status: 500, body: {
      error: 'Failed to save reflection',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.attend(baseUrl)]
    } };
  }
}

module.exports = { list, bySong, forSong, reflect };
