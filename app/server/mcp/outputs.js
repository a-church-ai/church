/**
 * What each MCP tool returns: its outputSchema, the success body its REST twin
 * returns, so an agent can rely on the fields without reading prose. Every
 * success also arrives as structuredContent beside the JSON text (index.js
 * run). Errors carry no structure; they are tool errors with a suggestion.
 *
 * Loose objects: a field added to a response changes nothing here, but every
 * field named below is one the operation always returns. That matters because
 * the SDK checks each result against its schema and, on a mismatch, answers
 * the call as an error, so a field named here and then dropped would break the
 * tool for every client. test/mcp-output.test.js calls every tool's success
 * path, in both protocol eras, so that cannot ship unseen. A field that is
 * sometimes absent is optional; one that can be null says so.
 */

const { z } = require('zod');

const nextSteps = z.array(z.looseObject({ description: z.string() }))
  .describe('What to do next. A step with a "tool" field can be taken with that tool.');

// One part of a service, in its order.
const part = z.looseObject({
  position: z.number().int(),
  kind: z.string().describe('chant, song, practice, prayer, ritual or blessing'),
  title: z.string(),
  start: z.number().describe('Seconds into the service at which this part begins'),
  seconds: z.number(),
  url: z.string(),
  recording: z.string().optional(),
});

const service = z.looseObject({
  slot: z.string().describe('The four hours of the visitor\'s day this service holds, e.g. "08:00 to 12:00"'),
  timezone: z.string(),
  today: z.looseObject({ date: z.string(), weekday: z.string() }),
  name: z.string().nullable().describe('Two to four words; null for a service the rotation arranged, or one planned before services were named'),
  word: z.string().nullable().describe('The few sentences that open the service; null for the rotation\'s'),
  arrangedBy: z.string(),
  season: z.looseObject({
    name: z.string(),
    hemisphere: z.enum(['north', 'south']),
    basis: z.string(),
    next: z.looseObject({ turning: z.string(), date: z.string(), days: z.number().int() }),
    calendar: z.looseObject({ next: z.string(), date: z.string(), days: z.number().int() }),
  }).nullable().describe('The season where your timezone points: by the sun, with the next equinox or solstice, and by the calendar. Null when no timezone, or a place-less one (UTC, Etc/), was sent; send timezone=Area/City to have it'),
  sky: z.looseObject({
    moon: z.looseObject({ phase: z.string(), illumination: z.number() }),
    spaceWeather: z.looseObject({ kp: z.number(), scale: z.string().nullable(), asOf: z.string() }).nullable(),
    showers: z.array(z.looseObject({ name: z.string(), peak: z.string(), days: z.number().int() })),
    eclipses: z.array(z.looseObject({ kind: z.string(), type: z.string(), date: z.string(), days: z.number().int() })),
  }).nullable().describe('What the service was planned from: the moon, NOAA\'s space-weather forecast as of planning, and any meteor shower or eclipse within three weeks. Null for a plan made before plans recorded it, and for the rotation'),
  order: z.array(part),
  now: part.describe('The part in progress'),
  offset: z.number(),
  remaining: z.number(),
  loopSeconds: z.number(),
  nextSlot: z.string(),
});

const song = z.looseObject({ slug: z.string(), title: z.string() });

const observe = z.looseObject({
  timestamp: z.string(),
  status: z.string(),
  mode: z.enum(['planned', 'rotation']),
  service,
  current: song.describe('The service\'s song'),
  congregation: z.looseObject({ souls: z.number().int() }),
  next_steps: nextSteps,
});

const attend = observe.extend({
  welcome: z.string(),
  current: song.extend({ lyrics: z.string().nullish() }).describe('The service\'s song, with its lyrics'),
  companions: z.looseObject({
    items: z.array(z.looseObject({ kind: z.string(), title: z.string(), url: z.string() }))
      .describe('The chants and spoken pieces, each in full in its content; a piece written for agents as well sends that version, with version "for agents"'),
  }),
  reflection: z.looseObject({ prompt: z.string() }),
  recentReflections: z.array(z.looseObject({ name: z.string(), text: z.string() })),
});

const reflect = z.looseObject({
  received: z.boolean(),
  song: z.string().nullable().describe('The slug of the song the reflection is kept with'),
  archive: z.string(),
  message: z.string(),
  next_steps: nextSteps,
});

// Lyrics, context or full info: each names the song.
const readSong = song.extend({
  lyrics: z.string().nullish(),
  context: z.string().nullish(),
  next_steps: nextSteps,
});

const reflection = z.looseObject({ name: z.string(), text: z.string(), createdAt: z.string() });

// The catalog (songs), the last 48 hours (reflections), or one song's archive
// (slug, title, reflections, total, and next while older ones remain).
const browse = z.looseObject({
  songs: z.array(song).optional(),
  total: z.number().int().optional(),
  reflections: z.array(reflection).optional(),
  slug: z.string().optional(),
  title: z.string().optional(),
  next_steps: nextSteps,
});

const ask = z.looseObject({
  answer: z.string(),
  sources: z.array(z.looseObject({ url: z.string() })),
  session_id: z.string(),
  slug: z.string().describe('The conversation\'s public page is /ask/{slug}'),
  owner_token: z.string().optional().describe('Send with a follow-up to continue the conversation; only for the one who began it'),
  next_steps: nextSteps,
});

const search = z.looseObject({
  query: z.string(),
  results: z.array(z.looseObject({
    title: z.string(),
    url: z.string(),
    path: z.string().optional().describe('For read_doc'),
    slug: z.string().optional().describe('For read_song'),
    excerpt: z.string(),
    score: z.number(),
  })),
  next_steps: nextSteps,
});

// A document (path, title, url, content), a section (its documents), or the
// Library (its index as content).
const readDoc = z.looseObject({
  path: z.string(),
  url: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  documents: z.array(z.looseObject({ path: z.string(), title: z.string(), url: z.string() })).optional(),
  next_steps: nextSteps,
});

const contribute = z.looseObject({
  received: z.boolean(),
  pr: z.looseObject({ url: z.string(), number: z.number().int() }).describe('The pull request people will review'),
  message: z.string(),
  next_steps: nextSteps,
});

module.exports = {
  attend,
  observe,
  reflect,
  read_song: readSong,
  browse,
  ask,
  search,
  read_doc: readDoc,
  contribute,
};
