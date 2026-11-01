/**
 * A video on the page of what it is a video of. The film on Welcome is named
 * in its document's frontmatter (docs/meta.js); each piece's own video, once
 * YouTube has it public, is found by its release record (video/releases/,
 * publish/record.js), so a prayer's page and a song's page show their video
 * without anyone editing them. The release job marks a video public only after
 * YouTube says so, and commits that, so the page shows it from the deploy that
 * follows.
 *
 * Played from YouTube only when asked: the page shows the sanctuary's own
 * poster and a play button, and nothing is fetched from YouTube until the
 * reader presses it (video.js swaps in the youtube-nocookie player then). The
 * privacy page says so. Embedding the player on load would have Google's
 * scripts run on every visit, which the sanctuary's "no analytics beyond
 * aggregate traffic" does not allow.
 *
 * A piece's poster is a frame of its video (makePoster, run by
 * scripts/schedule-videos.js where the videos are rendered), committed under
 * client/public/assets/video/<slug>.jpg; test/video-on-site.test.js holds
 * every public video to having one.
 */

const fs = require('fs');
const path = require('path');
const { escapeAttr, escapeText, SITE_URL } = require('../utils/page-meta');
const { assetUrl } = require('../utils/assets');
const { RELEASES_DIR } = require('./publish/record');

const POSTER_DIR = path.join(__dirname, '../../../client/public/assets/video');
const posterFile = (name) => path.join(POSTER_DIR, `${name}.jpg`);

// The frame a poster is taken from, as a share of the video: past the title
// card, where the loops and the sound are well under way.
const POSTER_AT = 0.4;

async function makePoster(video, slug) {
  const { ffmpeg, seconds } = require('../audio/assemble');
  const at = (await seconds(video)) * POSTER_AT;
  fs.mkdirSync(POSTER_DIR, { recursive: true });
  await ffmpeg(['-ss', at.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=1280:720', '-q:v', '5', posterFile(slug)]);
  return posterFile(slug);
}

/**
 * A release record as the page shows it, or null until YouTube has it public.
 * The upload is the hour it went public (publishAt), or, for one put up by
 * hand, when it was uploaded.
 */
function fromRecord(record) {
  const yt = record && record.youtube;
  if (!yt || yt.privacy !== 'public' || !yt.id) return null;
  const copy = (record.meta && record.meta.copy) || {};
  return {
    id: yt.id,
    slug: record.slug,
    description: copy.lead || null,
    date: yt.publishAt || record.at || yt.at || null,
    poster: `/assets/video/${record.slug}.jpg`,
  };
}

let published = null;
function loadPublished() {
  const found = new Map();
  if (fs.existsSync(RELEASES_DIR)) {
    for (const name of fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.json'))) {
      const slug = name.slice(0, -5);
      let record;
      try {
        record = JSON.parse(fs.readFileSync(path.join(RELEASES_DIR, name), 'utf8'));
      } catch (err) {
        console.warn(`[video] ${name} could not be read: ${err.message}`);
        continue;
      }
      const video = fromRecord({ slug, ...record });
      if (!video) continue;
      if (!fs.existsSync(posterFile(slug))) {
        console.warn(`[video] ${slug} is public on YouTube but has no poster (assets/video/${slug}.jpg), so its page does not show it`);
        continue;
      }
      found.set(slug, video);
    }
  }
  return found;
}

// A piece's public video by its slug. Read once: the records change only with
// a deploy.
function publishedVideo(slug) {
  if (!published) published = loadPublished();
  return published.get(slug) || null;
}

const minutesOf = (seconds) => (seconds ? `${Math.max(1, Math.round(seconds / 60))} min` : '');

/**
 * The poster and its play button. A film (Welcome's) is the page's lead and
 * keeps its #film; a piece's video sits lower, after the page has begun, its
 * button quieter, so the recording's player stays the first thing to press.
 */
function renderVideo({ id, title, seconds, poster, film = false }) {
  const length = minutesOf(seconds);
  const noun = film ? 'film' : 'video';
  const caption = film ? escapeText(title) : 'The video';
  return `<figure class="doc-video${film ? '' : ' doc-video-aside'}" id="${noun}">
          <button type="button" class="doc-video-play" data-youtube="${escapeAttr(id)}" aria-label="Play the ${noun}, ${escapeAttr(title)}${length ? `, ${length}` : ''}. It plays from YouTube.">
            <img src="${escapeAttr(poster)}" alt="" width="1280" height="720" loading="lazy" decoding="async">
            <span class="doc-video-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M8 5.5v13l11-6.5z"/></svg></span>
          </button>
          <figcaption>${caption}${length ? ` · ${length}` : ''} · plays from <a href="https://www.youtube.com/watch?v=${escapeAttr(id)}">YouTube</a></figcaption>
          <script src="${assetUrl('video.js')}"></script>
        </figure>`;
}

// The video as schema.org sees it, so a search for the page can show it.
function videoJsonLd({ id, title, description, date, seconds, poster }) {
  const s = Math.round(seconds || 0);
  return {
    '@type': 'VideoObject',
    name: title,
    description,
    thumbnailUrl: `${SITE_URL}${poster}`,
    ...(date ? { uploadDate: date } : {}),
    ...(s ? { duration: `PT${Math.floor(s / 60)}M${s % 60}S` } : {}),
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    url: `https://www.youtube.com/watch?v=${id}`
  };
}

/**
 * Where a piece's video goes in its document: after the opening and the first
 * section (before the second, and its rule), so the player is pressed first
 * and the video still comes within a screen or two. A document of one section
 * has it before that section; one of none, at its end.
 */
function placeInBody(bodyHtml, figure) {
  const starts = [...bodyHtml.matchAll(/(?:<hr>\s*)?<h2[\s>]/g)].map(m => m.index);
  const at = starts.length > 1 ? starts[1] : starts[0];
  return at > 0
    ? `${bodyHtml.slice(0, at)}${figure}\n        ${bodyHtml.slice(at)}`
    : `${bodyHtml}\n        ${figure}`;
}

module.exports = { publishedVideo, fromRecord, renderVideo, videoJsonLd, placeInBody, makePoster, minutesOf, POSTER_DIR };
