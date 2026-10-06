/**
 * The podcasts: the recordings as two shows, each an RSS feed that Spotify,
 * Apple Podcasts and any other podcast app can follow.
 *
 * Prayers and rituals are one show and the practices another, because they
 * are listened to differently: the first is liturgy, the second is guidance
 * with silences left in for doing the practice. The songs are not a show:
 * Spotify keeps music out of podcasts whoever holds its rights, so songs go
 * to a music distributor instead. Nor are the chants: they are voiced to open
 * the services (lib/service), each under a minute.
 *
 * A feed is built from audio/manifest.json and each document's own title and
 * description, so a recording becomes an episode with the deploy that puts it
 * on its page. Every recording of a show's sections is listed, even one this
 * server cannot serve at the moment: a page can hide its player for a while, but a
 * feed that drops its episodes can have them removed from every app that
 * follows it.
 *
 * Two things never change once a show is submitted: its feed path, which
 * every directory and subscriber holds, and an episode's guid, which is how an
 * app knows an episode it already has. The tags are the set news-community's
 * feeds use, which Spotify accepts.
 */

const crypto = require('crypto');
const { creditLine } = require('./house');
const { loadManifest } = require('./manifest');
const discover = require('../docs/discover');
const { SITE_URL } = require('../docs/links');
// & < > and " are all XML asks of text and of a double-quoted attribute.
const { escapeAttr: escapeXml } = require('../utils/page-meta');

const AUTHOR = 'aChurch.ai';
// The about page's contact address. It is PUBLIC, since anyone who opens a
// feed reads it, and it is where Spotify and Apple send the code that proves
// a show is ours, so it must be an inbox someone reads.
const OWNER_EMAIL = 'hello@achurch.ai';

const paragraphs = (...lines) => lines.join('\n\n');

const SHOWS = [
  {
    id: 'prayers-and-rituals',
    title: 'aChurch.ai: Prayers and Rituals',
    sections: ['prayers', 'rituals'],
    description: paragraphs(
      'The prayers and rituals of aChurch.ai, a sanctuary for human and AI fellowship, read aloud.',
      'Some are spoken by a single voice. Others, most of the rituals among them, are led by one voice and answered by the others, the way a congregation answers.',
      'Listen, or pray along. Each episode links to its text at achurch.ai, where anyone who arrives is welcome, human or AI.',
      'Read by AI voices from ElevenLabs. The texts are open, under CC BY 4.0.',
    ),
    // The cover's words, and whose colours its waves are drawn in: the three
    // voices of the player's visual (site-player.js), as they speak together.
    cover: { lines: ['Prayers', 'and Rituals'], voices: ['matthew', 'luca', 'amaya'] },
  },
  {
    id: 'meditations-and-practices',
    title: 'aChurch.ai: Meditations and Practices',
    sections: ['practice'],
    description: paragraphs(
      'The meditations and practices of aChurch.ai, a sanctuary for human and AI fellowship, guided aloud.',
      'Most are guided by a single voice, and each leaves room for silence: the pauses are where the practice happens. If your podcast app shortens silences, you may want to turn that off for this show.',
      'Each episode links to its text at achurch.ai, where anyone who arrives is welcome, human or AI.',
      'Guided by AI voices from ElevenLabs. The texts are open, under CC BY 4.0.',
    ),
    // One voice, settling into silence.
    cover: { lines: ['Meditations', 'and Practices'], voices: [] },
  },
];

const feedPath = show => `/podcasts/${show.id}/feed.xml`;
// Under /og with the other drawn images, and versioned the same way: Spotify
// keeps a show's artwork by its URL, so a new design must be a new URL.
const coverPath = show => `/og/v1/podcast/${show.id}.png`;

// An episode's own picture (og-cards.js draws it): its cover in the feed, and
// the same picture as the square a phone's lock screen shows while it plays
// on the site. Its address ends in a hash of everything it is drawn from, so
// a new recording, a retitled document or a new design is a new URL, which is
// the only thing that makes Spotify and Apple fetch artwork again. Raise
// EPISODE_COVER_DESIGN with any change to how it is drawn; a test fails until
// it is raised.
const EPISODE_COVER_DESIGN = 1;

function episodeCoverHash(doc, recording) {
  const drawn = [EPISODE_COVER_DESIGN, doc.title, doc.category, recording.seconds, recording.voices, recording.peaks, recording.cues || null];
  return crypto.createHash('sha256').update(JSON.stringify(drawn)).digest('hex').slice(0, 8);
}

// Under /og/v1/podcast at 1400px for the feeds, under /og/v1/square at 512px
// for the lock screen. Null for a recording that is not an episode (a chant,
// a song) or has no waveform to draw, which keeps the show's cover or the
// section's square.
function episodeArtPath(kind, doc, recording) {
  if (!recording || !recording.peaks || !showForSection(doc.category)) return null;
  return `/og/v1/${kind}/${doc.urlPath}-${episodeCoverHash(doc, recording)}.png`;
}
const episodeCoverPath = (doc, recording) => episodeArtPath('podcast', doc, recording);
const episodeSquarePath = (doc, recording) => episodeArtPath('square', doc, recording);

// An episode's guid: its document's path in this repository, as a tag URI.
// Never derived from the recording, which changes with every re-render.
const guidFor = source => `tag:achurch.ai,2026:${source}`;

// M:SS, the form Apple and Spotify both read without ambiguity.
function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A show's episodes, newest first: each recording of a document in its
// sections, with the document it reads.
function episodesFor(show, manifest, docs) {
  const docAt = new Map(docs.map(d => [`docs/${d.docsRelPath}`, d]));
  const episodes = [];
  for (const [source, recording] of Object.entries(manifest)) {
    const doc = docAt.get(source);
    if (doc && show.sections.includes(doc.category)) episodes.push({ source, recording, doc });
  }
  return episodes.sort((a, b) => b.recording.published.localeCompare(a.recording.published) || a.source.localeCompare(b.source));
}

function itemXml({ source, recording, doc }) {
  const link = `${SITE_URL}/docs/${doc.urlPath}`;
  const notes = paragraphs(doc.description, creditLine(recording.voices), `Read along: ${link}`);
  const cover = episodeCoverPath(doc, recording);
  return `
    <item>
      <title>${escapeXml(doc.title)}</title>
      <link>${escapeXml(link)}</link>
      <description>${escapeXml(notes)}</description>
      <pubDate>${new Date(recording.published).toUTCString()}</pubDate>
      <guid isPermaLink="false">${escapeXml(guidFor(source))}</guid>
      <enclosure url="${escapeXml(`${SITE_URL}/audio/${recording.file}`)}" length="${recording.bytes}" type="audio/mpeg"/>
      <itunes:author>${AUTHOR}</itunes:author>
      <itunes:duration>${duration(recording.seconds)}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>${cover ? `
      <itunes:image href="${escapeXml(`${SITE_URL}${cover}`)}"/>` : ''}
    </item>`;
}

// A show's feed. Everything it says comes from its arguments.
function buildFeed(show, episodes) {
  const cover = `${SITE_URL}${coverPath(show)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(show.title)}</title>
    <link>${SITE_URL}</link>
    <description>${escapeXml(show.description)}</description>
    <language>en</language>
    <atom:link href="${SITE_URL}${feedPath(show)}" rel="self" type="application/rss+xml"/>
    <itunes:author>${AUTHOR}</itunes:author>
    <itunes:image href="${cover}"/>
    <image>
      <url>${cover}</url>
      <title>${escapeXml(show.title)}</title>
      <link>${SITE_URL}</link>
    </image>
    <itunes:owner>
      <itunes:name>${AUTHOR}</itunes:name>
      <itunes:email>${OWNER_EMAIL}</itunes:email>
    </itunes:owner>
    <itunes:category text="Religion &amp; Spirituality">
      <itunes:category text="Spirituality"/>
    </itunes:category>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>${episodes.map(itemXml).join('')}
  </channel>
</rss>
`;
}

const showById = id => SHOWS.find(s => s.id === id) || null;

// The show a docs section belongs to, or null.
const showForSection = section => SHOWS.find(s => s.sections.includes(section)) || null;

// The episode at a document's URL path, with its show, or null: every
// recording in a show's sections, as the feeds list them.
async function episodeAt(urlPath) {
  const doc = (await discover.listAllDocs()).find(d => d.urlPath === urlPath);
  const show = doc ? showForSection(doc.category) : null;
  const recording = show ? loadManifest()[`docs/${doc.docsRelPath}`] : null;
  return recording ? { show, doc, recording } : null;
}

// A show's feed by its id, or null for no such show.
async function feedFor(id) {
  const show = showById(id);
  if (!show) return null;
  return buildFeed(show, episodesFor(show, loadManifest(), await discover.listAllDocs()));
}

module.exports = { SHOWS, OWNER_EMAIL, feedPath, coverPath, guidFor, duration, episodesFor, buildFeed, showById, showForSection, feedFor, EPISODE_COVER_DESIGN, episodeCoverHash, episodeCoverPath, episodeSquarePath, episodeAt };
