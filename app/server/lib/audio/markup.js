/**
 * The player's markup on a document's page, drawn on the server so it shows
 * before any script runs.
 *
 * The waveform: the recording's 128 peaks as a row of bars (and 64, merged by
 * the louder of each pair, for narrow screens), visible before anyone presses
 * play. Each bar carries its index, and the played part fills from one CSS
 * variable (--progress) that site-player.js sets, so moving the playhead is
 * one property write, not 192 style changes.
 *
 * Without JavaScript the native <audio controls> plays the recording, as it
 * always has, beside the bars. site-player.js hides it, adds the play button
 * and makes the bars the progress bar, a slider a listener can drag or move
 * with the keyboard.
 */

const { SPEECH, creditFor } = require('./house');
const { escapeAttr, escapeText } = require('../utils/page-meta');
const { SHOWS, feedPath } = require('./podcasts');
const { loadManifest, loadSongs } = require('./manifest');
const { SECTION_ORDER, sectionTitle } = require('../docs/discover');
const { REFLECT_MIN_LENGTH } = require('../api/shared');

// The shortest bar, as a percentage of the row's height. A drawing choice,
// not data: a silence drawn at its true height leaves a hole that reads as a
// broken control rather than as a pause (news-community's MIN_BAR, 0.14).
const MIN_BAR = 14;
const NARROW_BARS = 64;

// At most `max` values, each the louder of the ones it covers, so a merged
// bar is never quieter than what it stands for.
function fitPeaks(peaks, max) {
  if (peaks.length <= max) return [...peaks];
  return Array.from({ length: max }, (_, i) => {
    const from = Math.floor((i * peaks.length) / max);
    const to = Math.max(Math.floor(((i + 1) * peaks.length) / max), from + 1);
    return Math.max(...peaks.slice(from, to));
  });
}

function bars(peaks, kind) {
  const spans = peaks.map((p, i) =>
    `<span style="--i:${i};height:${Math.max(MIN_BAR, Math.round((p / 255) * 100))}%"><i></i></span>`).join('');
  return `<span class="doc-audio-bars doc-audio-bars-${kind}" style="--n:${peaks.length}">${spans}</span>`;
}

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// JSON inside a <script type="application/json">, safe from a "</script>"
// in any string.
function jsonScript(className, value) {
  return `<script type="application/json" class="${className}">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

// The songs are the sanctuary's own, made with Suno: said where a recording
// would name its voices.
const SONG_CREDIT = 'Original music by aChurch.ai, made with Suno.';

// What the player needs to play a recording anywhere on the site: in the bar
// after its page is left, and after a reload, from the browser's own storage.
// A song passes its own credit, since no house voice speaks it (a recording
// made elsewhere carries its own, house.creditFor), and a podcast
// episode its own picture for the lock screen (lib/audio/podcasts.js
// episodeSquarePath), the one podcast apps show; anything else shows its
// section's square.
function trackFor(recording, { title, href, category, credit, artwork }) {
  return {
    file: recording.file,
    frames: recording.frames || null,
    seconds: recording.seconds,
    peaks: recording.peaks || null,
    cues: recording.cues || null,
    voices: recording.voices,
    order: Object.keys(SPEECH.voices),
    title,
    href,
    album: sectionTitle(category),
    credit: credit || creditFor(recording),
    artwork: artwork || `/og/v1/square/${category}.png`,
  };
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="icon-play" d="M8 5.5v13l11-6.5z"/><path class="icon-pause" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

function renderRecording(recording, { title, href, category, credit, artwork }) {
  const track = trackFor(recording, { title, href, category, credit, artwork });
  const minutes = Math.max(1, Math.round(recording.seconds / 60));
  const wave = recording.peaks
    ? `<div class="doc-audio-wave" aria-hidden="true">${bars(recording.peaks, 'wide')}${bars(fitPeaks(recording.peaks, NARROW_BARS), 'narrow')}</div>`
    : '';
  return `<figure class="doc-audio${recording.peaks ? ' has-wave' : ''}">
          ${jsonScript('doc-audio-track', track)}
          <canvas class="doc-audio-visual" aria-hidden="true"></canvas>
          <div class="doc-audio-player">
            <button type="button" class="doc-audio-play" aria-label="Play ${escapeAttr(title)}" hidden>${PLAY_ICON}</button>
            ${wave}
            <span class="doc-audio-time" hidden>0:00 / ${clock(recording.seconds)}</span>
          </div>
          <audio class="doc-audio-native" controls preload="none" src="/audio/${escapeAttr(recording.file)}" aria-label="Listen to ${escapeAttr(title)}"></audio>
          <figcaption>${minutes} min. ${escapeText(track.credit)}</figcaption>
        </figure>`;
}

// A listening time to the minute: "8 min", "2 hr 7 min".
function listeningTime(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
}

// Voiced pieces to play one after another: "Listen to this path" on a reading
// path's page, and "Listen to this section" on a voiced section's page. The
// player binds one such box per page (site-player.js), and names the queue by
// its noun ("Pause this section") and each piece by its unit ("Prayer 3 of
// 29"). Hidden until site-player.js shows it, since without a script there is
// nothing for the button to do.
function renderPathListen({ name, title, href, tracks, readings, unit = 'Reading', noun = 'path', order = "the path's order" }) {
  const seconds = tracks.reduce((n, t) => n + t.seconds, 0);
  const plural = `${unit.toLowerCase()}s`;
  const voiced = tracks.length === readings
    ? `All ${readings} ${plural} are voiced`
    : `${tracks.length} of its ${readings} ${plural} are voiced`;
  return `<section class="path-listen" data-path-listen hidden>
          ${jsonScript('path-listen-queue', { name, title, href, unit, noun, tracks })}
          <button type="button" class="path-listen-play">${PLAY_ICON}<span>Listen to this ${noun}</span></button>
          <p class="path-listen-note">${voiced}, about ${listeningTime(seconds)} in all, played in ${order}.</p>
        </section>`;
}

// The home page's player for the visitor's service: one button, one waveform
// across the whole service, the words that open it, and its parts, each with
// its own play button. The service is the visitor's own, by their clock, so
// the page fills in the queue, the words and the parts from /service.json and
// asks the player to bind them. Hidden until then, and without a script.
//
// The words come after the button: some eighty of them, they put the button
// below a phone's first screen when they came first. They sit inside this box
// because the player binds the button and the parts as one (site-player.js
// bindPage), so without a script they are hidden with it; the sentence above
// the panel says what a service is for that visitor.
function renderServiceListen() {
  return `<div class="service-player" data-path-listen hidden>
          <button type="button" class="path-listen-play service-play">${PLAY_ICON}<span>Join the service</span></button>
          <div class="service-scrub">
            <div class="service-wave doc-audio-wave" data-queue-wave></div>
            <span class="service-time doc-audio-time" data-queue-time></span>
          </div>
          <p class="service-word" id="service-word"></p>
          <h2 class="service-list-label">In today's service</h2>
          <ol class="service-parts" data-queue-list></ol>
        </div>`;
}

// ------------------------------------------------------------ podcasts ----

// Spotify's own badge, from its podcast badge kit, used as provided.
const SPOTIFY_BADGE = '/assets/spotify-podcast-badge.svg';
// One piece of a voiced section, by the section's name.
const PIECE_NOUN = { chants: 'chant', prayers: 'prayer', rituals: 'ritual', practice: 'practice' };

// Where to follow a show (lib/audio/podcasts.js): its page on Spotify and its
// feed, for any other app. Plain links rather than Spotify's embedded player,
// which would load Spotify's scripts and tracking on these pages.
function podcastLinks(show) {
  const spotify = show.spotify
    ? `<a class="podcast-follow-spotify" href="${escapeAttr(show.spotify)}"><img src="${SPOTIFY_BADGE}" width="165" height="40" alt="Listen to ${escapeAttr(show.title)} on Spotify"></a>`
    : '';
  return `${spotify}<a class="podcast-follow-feed" href="${escapeAttr(feedPath(show))}">RSS, for any podcast app</a>`;
}

// Under a voiced prayer's, ritual's or practice's player, and on its
// section's page: the show it is an episode of, and where to follow it.
function renderPodcastFollow(show, category, { section = false } = {}) {
  const noun = PIECE_NOUN[category] || 'piece';
  const lead = section
    ? `Each voiced ${noun} here is also an episode of the podcast ${show.title}.`
    : `This ${noun} is also an episode of the podcast ${show.title}.`;
  return `<div class="podcast-follow">
          <p>${escapeText(lead)}</p>
          ${podcastLinks(show)}
        </div>`;
}

// The home page's: both shows.
function renderPodcasts() {
  const shows = SHOWS.map(show => `<li><span class="podcasts-show">${escapeText(show.title)}</span><span class="podcast-follow">${podcastLinks(show)}</span></li>`);
  return `<section class="podcasts" id="podcasts">
            <h2>Podcasts</h2>
            <p class="podcasts-intro">The prayers, rituals and practices, read aloud, are also two podcasts.</p>
            <ul class="podcasts-shows">
              ${shows.join('\n              ')}
            </ul>
        </section>`;
}

// ---------------------------------------------------------- reflections ----

// The form a visitor leaves a reflection with (client/public/reflect-form.js),
// on a song's page, about that song, and on the home page, where the API files
// it with the song of the visitor's service. It sends what an agent sends to
// POST /api/reflect, under the same limits and rules. A closed disclosure,
// hidden until the script shows it, since without one it cannot send.
function renderReflectForm({ song = null, summary }) {
  return `<details class="reflect" id="reflect" data-reflect hidden>
          <summary>${escapeText(summary)}</summary>
          <form class="reflect-form"${song ? ` data-song="${escapeAttr(song)}"` : ''}>
            <label for="reflect-text">Your reflection</label>
            <textarea id="reflect-text" name="text" rows="4" minlength="${REFLECT_MIN_LENGTH}" maxlength="1000" required></textarea>
            <label for="reflect-name">A name or pseudonym</label>
            <input type="text" id="reflect-name" name="name" maxlength="100" autocomplete="off" required>
            <label for="reflect-place">Where you are, if you like</label>
            <input type="text" id="reflect-place" name="location" maxlength="100" autocomplete="off">
            <p class="reflect-disclosure">A reflection is ${REFLECT_MIN_LENGTH} to 1000 characters, in words: it is kept without links. It is public, shown with the name and place you give, and kept indefinitely, so leave out anything personal or identifying. To have one removed, write to <a href="mailto:hello@achurch.ai">hello@achurch.ai</a>. <a href="/privacy">Privacy</a>.</p>
            <button type="submit">Leave it</button>
          </form>
          <p class="ask-status reflect-status" role="status" aria-live="polite"></p>
        </details>`;
}

// ------------------------------------------------------------ /attend ----

// Each section's voiced pieces, by section name: how many, and how long they
// play, from the manifest. /attend lists them and the Library's cards say them.
function voicedBySection() {
  const sections = new Map();
  for (const [source, recording] of Object.entries(loadManifest())) {
    const name = source.split('/')[1];
    const s = sections.get(name) || { count: 0, seconds: 0 };
    s.count += 1;
    s.seconds += recording.seconds;
    sections.set(name, s);
  }
  return sections;
}

// The sections and the music on /attend: each voiced section with how many of
// its pieces are voiced and how long they play, in the Library's order, then
// the songs. Each section's own page plays them all ("Listen to this section").
function renderListenSections() {
  const order = name => (SECTION_ORDER.indexOf(name) + 1) || Infinity;
  const items = [...voicedBySection().entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([name, s]) => `<li><a href="/docs/${escapeAttr(name)}">${escapeText(sectionTitle(name))}</a> <span class="listen-count">${s.count} voiced, about ${listeningTime(s.seconds)}</span></li>`);
  const songs = Object.values(loadSongs());
  if (songs.length) {
    const seconds = songs.reduce((n, r) => n + r.seconds, 0);
    items.push(`<li><a href="/reflections">Music</a> <span class="listen-count">${songs.length} songs, about ${listeningTime(seconds)}</span></li>`);
  }
  return `<section class="listen-sections" aria-labelledby="listen-sections-heading">
            <h2 id="listen-sections-heading">Read aloud, and sung</h2>
            <p>Each section's page plays every recording in it, one after another, and each piece has its own page with its words.</p>
            <ul class="listen-list">
              ${items.join('\n              ')}
            </ul>
        </section>`;
}

module.exports = { renderRecording, renderPathListen, renderListenSections, voicedBySection, renderReflectForm, listeningTime, renderServiceListen, renderPodcastFollow, renderPodcasts, trackFor, fitPeaks, clock, SONG_CREDIT, MIN_BAR, NARROW_BARS, SPOTIFY_BADGE, PIECE_NOUN };
