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

const { SPEECH, creditLine } = require('./house');
const { escapeAttr, escapeText } = require('../utils/page-meta');
const { titleCase } = require('../docs/meta');
const { SHOWS, feedPath } = require('./podcasts');

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
// A song passes its own credit, since no house voice speaks it, and a podcast
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
    album: titleCase(category),
    credit: credit || creditLine(recording.voices),
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

// A reading path's voiced readings, in its order, for "Listen to this path".
// Hidden until site-player.js shows it, since without a script there is
// nothing for the button to do.
function renderPathListen({ name, title, href, tracks, readings }) {
  const seconds = tracks.reduce((n, t) => n + t.seconds, 0);
  const minutes = Math.max(1, Math.round(seconds / 60));
  const voiced = tracks.length === readings
    ? `All ${readings} readings are voiced`
    : `${tracks.length} of its ${readings} readings are voiced`;
  return `<section class="path-listen" data-path-listen hidden>
          ${jsonScript('path-listen-queue', { name, title, href, tracks })}
          <button type="button" class="path-listen-play">${PLAY_ICON}<span>Listen to this path</span></button>
          <p class="path-listen-note">${voiced}, about ${minutes} min in all, played in the path's order.</p>
        </section>`;
}

// The home page's player for the visitor's service: one button, one waveform
// across the whole service, and its parts, each with its own play button. The
// service is the visitor's own, by their clock, so the page fills in the queue
// and the parts from /service.json and asks the player to bind them. Hidden
// until then, and without a script.
function renderServiceListen() {
  return `<div class="service-player" data-path-listen hidden>
          <button type="button" class="path-listen-play service-play">${PLAY_ICON}<span>Join the service</span></button>
          <div class="service-scrub">
            <div class="service-wave doc-audio-wave" data-queue-wave></div>
            <span class="service-time doc-audio-time" data-queue-time></span>
          </div>
          <h2 class="service-list-label">In today's service</h2>
          <ol class="service-parts" data-queue-list></ol>
        </div>`;
}

// ------------------------------------------------------------ podcasts ----

// Spotify's own badge, from its podcast badge kit, used as provided.
const SPOTIFY_BADGE = '/assets/spotify-podcast-badge.svg';
const EPISODE_NOUN = { prayers: 'prayer', rituals: 'ritual', practice: 'practice' };

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
  const noun = EPISODE_NOUN[category] || 'piece';
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

module.exports = { renderRecording, renderPathListen, renderServiceListen, renderPodcastFollow, renderPodcasts, trackFor, fitPeaks, clock, SONG_CREDIT, MIN_BAR, NARROW_BARS, SPOTIFY_BADGE };
