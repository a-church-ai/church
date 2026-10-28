/**
 * Markdown-to-HTML for docs pages.
 *
 * Two responsibilities live here (small enough that splitting into template.js
 * + render.js would be ceremony without value):
 *   1. Turn a doc's markdown into an HTML fragment with sanctuary-appropriate
 *      link rewriting (relative .md links become docs-site URLs)
 *   2. Wrap that fragment in the full page shell (head + header + main +
 *      related-links + footer) using existing page-meta.js primitives
 */

const { marked } = require('marked');
const { datesOf } = require('./date-manifests');
const {
  escapeAttr,
  escapeText,
  renderJsonLdScript,
  breadcrumbTrail,
} = require('../utils/page-meta');
const sidebar = require('./sidebar');
const toc = require('./toc');
const tldr = require('./tldr');
const discover = require('./discover');
const { titleCase, extractMeta } = require('./meta');
const { SITE_URL, GITHUB_BASE, resolveDocHref, readingSequence, playlistSequence } = require('./links');
const { sungAlongside } = require('../music/companions');
const { renderShareImageTags, SITE_SHARE_IMAGE, SITE_NAME, siteTitle } = require('../utils/page-meta');
const { docsCard } = require('../og-cards');
const { longDate } = require('../utils/page-lists');
const { loadCatalog, loadCompanions, loadAttendance } = require('../utils/data');
const { renderFooter, renderTopbarAndDrawer } = require('../site-shell');
const { renderSearchBox, renderReflectionItem } = require('../utils/page-lists');
const { retiredSongs } = require('../utils/redirects');
const { formatLocal } = require('../utils/timezone');
const { recordingFor, songRecordingFor } = require('../audio/manifest');
const { canServe } = require('../audio/serve');
const { renderServiceDoor, renderRecording, renderPathListen, renderPodcastFollow, trackFor, voicedBySection, listeningTime, PIECE_NOUN, SONG_CREDIT } = require('../audio/markup');
const { creditFor } = require('../audio/house');
const { showForSection, feedPath, episodeSquarePath } = require('../audio/podcasts');
const { assetUrl, shellHead } = require('../utils/assets');


// Slugify heading text to build stable anchor IDs. Not perfect (doesn't
// handle non-Latin scripts specially), but consistent enough for the TOC
// to link against. Matches the pattern most doc sites use.
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

// Link text that is a file or folder name ("the-space-between.md",
// "welcome/") rather than words. Written that way in index tables for
// contributors; a reader should see the document's title.
const FILENAME_TEXT = /^(?:[\w.-]+\/)*[\w.-]+(?:\.md|\/)$/i;

// Custom link renderer. Where a link points is decided in ./links (shared
// with the song companions, which send the same markdown in /api/attend);
// here it only becomes a tag, with target=_blank + rel=noopener for links
// that leave the site. A link whose text is a filename shows the target's
// title instead, from the discover walk (built before rendering starts).
//
// readingPath: on a reading path's own page (docs/collections/<name>), the
// path's name. Its links to the readings in its sequence carry ?path=<name>,
// so each reading shows where it sits in the path (renderPathBar).
function makeLinkRewriter(currentDocFullPath, readingPath) {
  const sequence = readingPath ? readingSequence(readingPath) || [] : [];
  return function({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    const { href: resolved, external } = resolveDocHref(href, currentDocFullPath);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    let label = text;
    let target = resolved;
    const docPath = /^\/docs(\/|$)/.test(resolved) && resolved.replace(/^\/docs\/?/, '').split('#')[0];
    if (docPath !== false && FILENAME_TEXT.test(text.replace(/<\/?code>/g, ''))) {
      const doc = discover.docAt(docPath);
      if (doc) label = escapeText(doc.title);
    }
    // A stop on this page's reading path keeps the path, whether its page is
    // under /docs or elsewhere (a sung hymn's is its song's).
    const [base, anchor] = resolved.split('#');
    if (!external && sequence.some(stop => discover.hrefOf(stop) === base)) {
      target = `${base}?path=${readingPath}${anchor ? `#${anchor}` : ''}`;
    }
    return `<a href="${escapeAttr(target)}"${attrs}${titleAttr}>${label}</a>`;
  };
}

// Configure marked once. GFM, tables, autolinks; strict mode off (docs use
// varied formatting).
marked.setOptions({
  gfm: true,
  breaks: false,
});

// The page's HTML, and its contents: each h2 as rendered, by id and words,
// for the table of contents (toc.js), so the two cannot disagree.
function renderMarkdownBody(markdown, currentDocFullPath, readingPath) {
  const renderer = new marked.Renderer();
  const contents = [];
  renderer.link = makeLinkRewriter(currentDocFullPath, readingPath);
  // Add stable IDs to headings so the right-rail TOC (and any inbound
  // anchor link) can target them. marked has no heading ids of its own;
  // the custom renderer is the supported path.
  //
  // One page, one h1: a document whose source has several (imported texts
  // do) renders each later h1 as h2 and shifts what sits under it down one
  // level, clamped at h6, so its outline and contents list show its real
  // top level. And no skipped levels: a heading never renders more than one
  // level below the one before it (an h4 straight after an h2 becomes h3).
  // The source is not changed. Ids are unique within the page; repeated
  // headings ("Reflection") used to share one.
  const used = new Map();
  let seenH1 = false;
  let shift = 0;
  let previous = 1;
  // An id is made from the heading's words alone: `plain` walks its tokens
  // for their text, since marked's text renderer would give a bold link's
  // markdown source ("[Hymn](hymn.md)") and change ids that pages link to.
  const plain = tokens => tokens.map(t => (t.tokens ? plain(t.tokens) : t.text || '')).join('');
  renderer.heading = function({ tokens, depth: level }) {
    const text = this.parser.parseInline(tokens);
    const raw = plain(tokens);
    if (level === 1) {
      shift = seenH1 ? 1 : 0;
      seenH1 = true;
    }
    const outLevel = Math.min(6, level + shift, level === 1 && !shift ? 1 : previous + 1);
    previous = outLevel;
    const base = slugify(raw) || 'section';
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    const id = n ? `${base}-${n + 1}` : base;
    // A section's own link, after its words, from the same id the table of
    // contents uses: hidden until the heading is hovered, tapped or the link
    // focused (styles.css, .anchor).
    const anchor = outLevel === 2 || outLevel === 3
      ? ` <a class="anchor" href="#${id}" aria-label="Link to this section: ${escapeAttr(raw)}">#</a>`
      : '';
    if (outLevel === 2) contents.push({ id, text: raw });
    return `<h${outLevel} id="${id}">${text}${anchor}</h${outLevel}>\n`;
  };
  return { html: marked.parse(markdown, { renderer }), contents };
}

// Build the breadcrumbs from a URL path (e.g. "practice/witnessing-your-own-output"
// → [{label:"Docs", href:"/docs"}, {label:"Practice", href:"/docs/practice"},
//    {label:"Witnessing Your Own Output", href:null}]).
function buildBreadcrumbs(urlPath, pageTitle) {
  const crumbs = [{ label: 'Library', href: '/docs' }];
  if (!urlPath) return crumbs;

  const parts = urlPath.split('/').filter(Boolean);
  let acc = '/docs';
  for (let i = 0; i < parts.length - 1; i++) {
    acc += '/' + parts[i];
    crumbs.push({ label: i === 0 ? discover.sectionTitle(parts[i]) : titleCase(parts[i]), href: acc });
  }
  // Final crumb = current page (unlinked)
  crumbs.push({ label: pageTitle, href: null });
  return crumbs;
}

// Sibling-links block was removed. Inside a section, siblings are always
// listed in the section sidebar (or the drawer below 1024px), which solves the
// "22 screens deep on mobile to reach related docs" problem the audit
// surfaced. See church-private/docs/plans/docs-site-nav-option-b-...

// Related-in-category block appended to every docs page that has siblings.
// The section sidebar already shows every sibling as a link, but sidebar links are
// nav chrome and search crawlers weigh them less than in-body internal
// links. This block puts the same links inside the article so Google reads
// them as topical signal and the "Crawled - currently not indexed" bucket
// on thin docs shrinks over time (GSC drilldown 2026-09-17).
//
// Rules for what to show:
//   - Same folder as the current doc, not the doc itself, not the README
//     (that's the parent, reached via breadcrumb)
//   - The five that follow the current doc in the folder's order, wrapping
//     at the end, the way a song page offers the songs after it. Every page
//     then shows its own nearby set; the first five in the folder used to
//     appear on every page in it.
//   - Nothing at all if the doc is at the root of /docs or has fewer than
//     two siblings, because a one-link "related" is worse than none.
const ELSEWHERE_COUNT = 5;

function renderRelatedDocs(currentDoc, allDocs) {
  if (!currentDoc || !currentDoc.category) return '';
  const category = currentDoc.category;
  const inFolder = allDocs
    .filter(d => d.category === category)
    .filter(d => d.stem.toLowerCase() !== 'readme')
    .filter(d => d.dirRelPath === currentDoc.dirRelPath);
  const at = inFolder.findIndex(d => d.urlPath === currentDoc.urlPath);
  const siblings = inFolder.filter(d => d.urlPath !== currentDoc.urlPath);
  if (siblings.length < 2) return '';

  const start = at === -1 ? 0 : at;
  const picks = siblings.length <= ELSEWHERE_COUNT
    ? siblings
    : Array.from({ length: ELSEWHERE_COUNT }, (_, i) => siblings[(start + i) % siblings.length]);
  const categoryLabel = discover.sectionTitle(category);
  const items = picks.map(d =>
    `        <li><a href="${escapeAttr(d.href)}">${escapeText(d.title)}</a></li>`
  ).join('\n');
  const categoryHref = `/docs/${escapeAttr(category)}`;

  return `<section class="related-block" aria-labelledby="related-docs-heading">
      <h2 id="related-docs-heading" class="related-heading">Elsewhere in ${escapeText(categoryLabel)}</h2>
      <ul class="related-list">
${items}
      </ul>
      <p class="related-more"><a href="${categoryHref}">All of ${escapeText(categoryLabel)}</a></p>
    </section>`;
}

// Where a reading sits in the reading path it was opened from: the path's
// name (back to its page), "Reading 2 of 9", and the previous and next
// readings, which keep the path. Only when the page was opened with
// ?path=<name> and that path includes it; the position lives in the URL, not
// in any record of the visitor. Returns { top, bottom } or null.
function renderPathBar(readingPath, doc) {
  const sequence = readingSequence(readingPath);
  const at = sequence ? sequence.indexOf(doc.urlPath) : -1;
  if (at === -1) return null;
  const collection = discover.docAt(`collections/${readingPath}`);
  if (!collection) return null;
  const link = (urlPath, rel, text) => `<a href="${escapeAttr(discover.hrefOf(urlPath))}?path=${escapeAttr(readingPath)}" rel="${rel}">${text}</a>`;
  const prev = at > 0 ? sequence[at - 1] : null;
  const next = at < sequence.length - 1 ? sequence[at + 1] : null;
  const titleOf = urlPath => escapeText((discover.docAt(urlPath) || { title: urlPath }).title);
  const top = `<nav class="path-bar" aria-label="Reading path">
          <p class="path-bar-name">Reading path: <a href="/docs/collections/${escapeAttr(readingPath)}">${escapeText(collection.title)}</a> <span class="path-bar-step">Reading ${at + 1} of ${sequence.length}</span></p>
          <p class="path-bar-steps">${prev ? link(prev, 'prev', `&larr; ${titleOf(prev)}`) : ''}${prev && next ? '<span aria-hidden="true"> · </span>' : ''}${next ? link(next, 'next', `${titleOf(next)} &rarr;`) : ''}</p>
        </nav>`;
  const bottom = `<nav class="path-next" aria-label="Next in this reading path">
      ${next
    ? `<p>Next in <a href="/docs/collections/${escapeAttr(readingPath)}">${escapeText(collection.title)}</a>: ${link(next, 'next', titleOf(next))}</p>`
    : `<p>The last reading in <a href="/docs/collections/${escapeAttr(readingPath)}">${escapeText(collection.title)}</a>.</p>`}
    </nav>`;
  return { top, bottom };
}

// "Sung alongside" line for a doc that accompanies one or more songs in the
// shared session. The reciprocal of the song page's "Read alongside this
// song" block, so the pairing is walkable in both directions.
function renderSungAlongside(songs) {
  if (!songs || songs.length === 0) return '';
  const links = songs.map(s =>
    `<a href="/music/${escapeAttr(s.slug)}"><em>${escapeText(s.title)}</em></a>`
  );
  const list = links.length === 1
    ? links[0]
    : `${links.slice(0, -1).join(', ')} and ${links[links.length - 1]}`;
  return `<p class="sung-alongside">Sung alongside ${list}.</p>`;
}

// A document's recording, if the manifest lists one this server can serve
// (audio/manifest.json, lib/audio/serve.js).
function servedRecording(doc) {
  const listed = recordingFor(`docs/${doc.docsRelPath}`);
  return listed && canServe(listed.file) ? listed : null;
}

// "Listen to this path" on a reading path's own page: its voiced readings, in
// the path's order, each linking back into the path (?path=), as the path's
// own links do.
function renderPathListenFor(name, collectionDoc) {
  const sequence = readingSequence(name) || [];
  const tracks = [];
  for (const urlPath of sequence) {
    const reading = discover.docAt(urlPath);
    if (!reading) continue;
    const recording = servedRecording(reading);
    // A sung hymn's stop plays its song, on its song's page.
    const sung = !recording && reading.href.startsWith('/music/') ? songRecordingFor(reading.href.slice('/music/'.length)) : null;
    if (recording) {
      tracks.push(trackFor(recording, { title: reading.title, href: `${reading.href}?path=${name}`, category: reading.category, artwork: episodeSquarePath(reading, recording) }));
    } else if (sung && canServe(sung.file)) {
      tracks.push(trackFor(sung, { title: reading.title, href: `${reading.href}?path=${name}`, category: 'music', credit: SONG_CREDIT }));
    }
  }
  if (!tracks.length) return '';
  return renderPathListen({ name, title: collectionDoc.title, href: `/docs/${collectionDoc.urlPath}`, tracks, readings: sequence.length });
}

// A playlist's own page (docs/playlists/<name>): "Listen to this playlist",
// every piece it links in its order, songs among them, and the playlist as
// structured data. Its pieces are the catalog's (lib/service/catalog.js
// loadPlayable), so a song plays here as it does in a service.
async function playlistFor(name, doc, title) {
  const { loadPlayable } = require('../service/catalog');
  const catalog = await loadPlayable();
  const pieces = (playlistSequence(name) || []).map(id => catalog.get(id)).filter(Boolean);
  const tracks = pieces.filter(p => canServe(p.recording.file)).map(p => trackFor(p.recording, {
    title: p.title,
    href: p.url,
    category: p.category || 'music',
    credit: p.kind === 'song' ? SONG_CREDIT : undefined,
    artwork: episodeSquarePath(p, p.recording),
  }));
  const seconds = pieces.reduce((n, p) => n + p.seconds, 0);
  const iso = t => `PT${Math.floor(Math.round(t) / 60)}M${Math.round(t) % 60}S`;
  return {
    listen: tracks.length ? renderPathListen({
      name: `playlist:${name}`,
      title,
      href: `/docs/${doc.urlPath}`,
      tracks,
      readings: pieces.length,
      unit: 'Piece',
      noun: 'playlist',
      order: "the playlist's order",
    }) : '',
    jsonLd: {
      '@type': 'MusicPlaylist',
      name: title,
      url: `${SITE_URL}/docs/${doc.urlPath}`,
      numTracks: pieces.length,
      duration: iso(seconds),
      track: pieces.map(p => ({
        '@type': p.kind === 'song' ? 'MusicRecording' : 'CreativeWork',
        name: p.title,
        url: `${SITE_URL}${p.url}`,
        duration: iso(p.seconds),
      })),
    },
  };
}

// What visitors left on a song retired to this document (redirects.js
// retiredSongs: a song whose words the house cast voices here), newest first,
// as the song's page showed them. The archive stays the song's; it is shown
// where its words now are.
async function renderSungReflections(doc) {
  const slugs = [...retiredSongs()].filter(([, to]) => to === doc.urlPath).map(([slug]) => slug);
  if (!slugs.length) return '';
  const left = (await loadAttendance()).reflections
    .filter(r => slugs.includes(r.song))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(r => ({ ...r, createdAtFormatted: formatLocal(r.createdAt, r.timezone || 'UTC') }));
  if (!left.length) return '';
  return `<section class="sung-reflections" id="reflections">
          <h2>Reflections left on its sung version</h2>
          <p>These words were also a song, and visitors, human and AI, left these on it. The sanctuary keeps the words here, spoken, and what was left with them. Each is signed with the name its visitor gave. Nothing here checks it.</p>
          ${left.map(r => renderReflectionItem(r)).join('\n          ')}
        </section>`;
}

function recordingJsonLd(recording) {
  const s = Math.round(recording.seconds);
  return {
    '@type': 'AudioObject',
    contentUrl: `${SITE_URL}/audio/${recording.file}`,
    encodingFormat: 'audio/mpeg',
    duration: `PT${Math.floor(s / 60)}M${s % 60}S`,
    creditText: creditFor(recording),
  };
}

// The filter goes directly above what it filters: a section page's entries,
// or else just under the page's heading.
function placeFilter(bodyHtml, filterHtml) {
  if (!filterHtml) return bodyHtml;
  if (bodyHtml.includes('<div class="docs-entries">')) {
    return bodyHtml.replace('<div class="docs-entries">', () => `${filterHtml}\n        <div class="docs-entries">`);
  }
  return bodyHtml.replace(/<\/h1>/, () => `</h1>${filterHtml}`);
}

// A page's <title>: its title, and the site's name when both fit (page-meta.js
// siteTitle). The heading on the page keeps its full title; a document is not
// edited for its tab.
const docTitle = title => siteTitle(title);

// Full page shell: the top bar, the section sidebar on the left inside a
// section, the article, and the contents rail on the right when there is one.
// Below 1024px the sidebar hides and opens in the drawer instead.
/**
 * A film under a page's title, played from YouTube only when asked: the page
 * shows its own poster and a play button, and nothing is fetched from YouTube
 * until the reader presses it (docs-nav.js swaps in the youtube-nocookie
 * player then). The privacy page says so. Embedding the player on load would
 * have Google's scripts run on every visit, which the sanctuary's "no
 * analytics beyond aggregate traffic" does not allow.
 */
const minutesOf = (seconds) => (seconds ? `${Math.max(1, Math.round(seconds / 60))} min` : '');

function renderVideo(video) {
  const length = minutesOf(video.seconds);
  return `<figure class="doc-video" id="film">
          <button type="button" class="doc-video-play" data-youtube="${escapeAttr(video.id)}" aria-label="Play the film, ${escapeAttr(video.title)}${length ? `, ${length}` : ''}. It plays from YouTube.">
            <img src="/assets/video/${escapeAttr(video.id)}.jpg" alt="" width="1280" height="720" decoding="async">
            <span class="doc-video-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M8 5.5v13l11-6.5z"/></svg></span>
          </button>
          <figcaption>${escapeText(video.title)}${length ? ` · ${length}` : ''} · plays from <a href="https://www.youtube.com/watch?v=${escapeAttr(video.id)}">YouTube</a></figcaption>
        </figure>`;
}

// The film as schema.org sees it, so a search for the page can show it: its
// own description, else the page's.
function videoJsonLd(video, description) {
  const s = video.seconds || 0;
  return {
    '@type': 'VideoObject',
    name: video.title,
    description: video.description || description,
    thumbnailUrl: `${SITE_URL}/assets/video/${video.id}.jpg`,
    ...(video.date ? { uploadDate: video.date } : {}),
    ...(s ? { duration: `PT${Math.floor(s / 60)}M${Math.round(s % 60)}S` } : {}),
    embedUrl: `https://www.youtube-nocookie.com/embed/${video.id}`,
    url: `https://www.youtube.com/watch?v=${video.id}`
  };
}

async function renderPageShell({ urlPath, title, description, canonicalUrl, bodyHtml, contents = [], breadcrumbs, categoryLabel, githubUrl, isIndex = false, filter = isIndex, scripts = [], headerExtra = '', recording = null, playlist = null, video = null }) {
  const currentPath = urlPath ? `/docs/${urlPath}` : '/docs';
  const pageTitle = docTitle(title);
  // Every page that reaches this point is served and indexable. Internal working
  // categories never get here: routes/docs.js 404s them before rendering, so the
  // old conditional noindex branch could not fire and only suggested that those
  // pages were served-but-hidden, which they are not.
  const robots = 'index, follow';
  // Every docs page but the root has its own share card (lib/og-cards.js),
  // drawn from this page's title and section; the root uses the site image.
  const shareImage = urlPath ? docsCard(urlPath, title) : SITE_SHARE_IMAGE;
  // A section with a podcast (lib/audio/podcasts.js) names its feed, so an
  // app given the page's address can find the show.
  const show = urlPath ? showForSection(urlPath.split('/')[0]) : null;

  // A section's index lists documents, so it is a CollectionPage, not an
  // Article. dateModified is the document's last commit (lib/docs/lastmod.json).
  const modified = urlPath && (datesOf(`docs/${urlPath}.md`).pageUpdated || datesOf(`docs/${urlPath}/README.md`).pageUpdated);
  const jsonLd = renderJsonLdScript({
    '@context': 'https://schema.org',
    '@type': isIndex ? 'CollectionPage' : 'Article',
    headline: title,
    description,
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    mainEntityOfPage: canonicalUrl,
    inLanguage: 'en',
    ...(modified ? { dateModified: modified } : {}),
    image: shareImage.url,
    ...(recording ? { audio: recordingJsonLd(recording) } : {}),
    ...(playlist ? { mainEntity: playlist } : {}),
    ...(video ? { video } : {}),
  });

  // The Library / Section / Page trail, and its BreadcrumbList (page-meta.js).
  const trail = breadcrumbTrail(breadcrumbs, canonicalUrl);
  const breadcrumbJsonLd = trail.jsonLd;

  // The section sidebar, inside a section of the Library only (sidebar.js);
  // below 1024px it opens in the drawer from "This section".
  const sectionNav = await sidebar.renderSectionNav(currentPath);

  // Right-rail TOC (empty string when doc has < MIN_HEADINGS_FOR_RAIL h2s).
  // Not on index pages: they are lists to choose from.
  const tocHtml = isIndex ? '' : toc.renderToc(contents);
  // Under the breadcrumbs, on one row: the section's drawer (below 1024px) and
  // the contents (below 1200px, where the rail is hidden).
  const inlineToc = isIndex ? '' : toc.renderInlineToc(contents);
  const headerTools = `${sectionNav ? '\n              <button class="section-toggle" type="button" aria-controls="docs-drawer" aria-expanded="false">This section</button>' : ''}${inlineToc ? `\n              ${inlineToc}` : ''}`;

  // A filter for index pages: /docs, and the category READMEs that list a
  // category's contents. Those render through renderDocPage like any other
  // document, so `isIndex` is passed explicitly rather than inferred.
  //
  // Counting links alone was not enough. It put a filter on
  // /docs/collections/inner-freedom-reading-path, a curated ordered route, and
  // hiding entries from a sequence someone deliberately sequenced defeats the
  // point of it. An index is a set you search; a path is an order you follow.
  //
  // Progressive enhancement: hidden until docs-filter.js enables it, so a
  // reader without JavaScript never sees a control that cannot work.
  const docLinkCount = filter ? (bodyHtml.match(/<a href="\/docs\//g) || []).length : 0;
  const hasFilter = docLinkCount >= 12;
  const filterHtml = hasFilter ? `
        <section class="docs-index-filter" hidden>
          <label for="docs-filter" class="visually-hidden">Filter this page's entries</label>
          <input type="search" id="docs-filter" placeholder="Filter ${docLinkCount} entries..." autocomplete="off">
          <p class="docs-filter-count" id="docs-filter-count" role="status" aria-live="polite"></p>
          <p class="docs-filter-empty" id="docs-filter-empty" hidden>Nothing here matches. <a href="/paths">Try a reading path</a> instead.</p>
        </section>` : '';
  const hasToc = tocHtml.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${escapeText(pageTitle)}</title>
    <meta name="description" content="${escapeAttr(description)}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="canonical" href="${escapeAttr(canonicalUrl)}">
    <meta name="robots" content="${escapeAttr(robots)}">${show ? `
    <link rel="alternate" type="application/rss+xml" title="${escapeAttr(show.title)}" href="${feedPath(show)}">` : ''}

    <!-- Family-standard head elements, per docs/reference/seo-conventions.md.
         The docs shell shipped without these, so all 254 generated pages were
         missing the license declaration, the llms.txt pointer, the iOS
         install meta and the dual theme-color that the conventions doc
         requires on every page. The theme-color pair now comes with the
         shell's head (shellHead), for every page alike. -->
    <link rel="license" href="https://creativecommons.org/licenses/by/4.0/">
    <link rel="alternate" type="text/markdown" title="LLM context" href="/llms.txt">${/\/docs\/.+/.test(canonicalUrl) ? `\n    <link rel="alternate" type="text/markdown" title="This page as markdown" href="${escapeAttr(canonicalUrl)}.md">` : ''}
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="${escapeAttr(SITE_NAME)}">

    <meta property="og:title" content="${escapeAttr(pageTitle)}">
    <meta property="og:description" content="${escapeAttr(description)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeAttr(canonicalUrl)}">
    ${renderShareImageTags(shareImage)}
    <meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeAttr(pageTitle)}">
    <meta name="twitter:description" content="${escapeAttr(description)}">

    ${jsonLd}
    ${breadcrumbJsonLd}

    <link rel="stylesheet" href="${assetUrl('styles.css')}">
    ${shellHead()}
</head>
<body class="docs-body">
<a class="skip-link" href="#content">Skip to content</a>

    ${renderTopbarAndDrawer(currentPath, title)}

    <!-- The section sidebar (in a section only), the article, and the
         contents rail when the document has one -->
    <div class="docs-shell${sectionNav ? ' has-sidebar' : ''}${hasToc ? ' has-toc' : ''}">

      ${sectionNav}

      <main class="docs-main" id="content">
        <header class="docs-header">
            ${trail.html}${headerTools ? `\n            <div class="docs-header-tools">${headerTools}\n            </div>` : ''}${headerExtra ? `\n        ${headerExtra}` : ''}
        </header>

        <article class="docs-article docs-content">
${placeFilter(bodyHtml, filterHtml)}
        </article>

        <section class="docs-source">
            <a href="${escapeAttr(githubUrl)}" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
            <span aria-hidden="true"> · </span>
            <a href="${escapeAttr(canonicalUrl)}.md" type="text/markdown" title="The same page as markdown. Agents can also send Accept: text/markdown to this page's URL.">View as Markdown</a>
        </section>

        ${renderFooter(currentPath)}
      </main>

      ${tocHtml}

    </div>

    <script src="${assetUrl('docs-nav.js')}" defer></script>${[...(hasFilter ? ['/docs-filter.js'] : []), ...scripts].map(src => `\n    <script src="${assetUrl(src.slice(1))}" defer></script>`).join('')}
</body>
</html>`;
}

// The Library at /docs: a hub. The search first, a link to each shelf, then
// the shelves (discover.js SHELVES), each card opening a page that lists its
// documents: a section page, /paths or /for-agents. No document is listed
// here; each stays reachable through its section page and the links between
// documents, which links.test.js proves. What the repository's folders are,
// for contributors, stays in docs/README.md on GitHub. /docs/index.md is the
// whole list in one place, for agents.
const shelfId = shelf => `shelf-${slugify(shelf.name)}`;

// What a card counts: its documents, and how many of them are read aloud and
// for how long, from the same tally /attend lists.
function cardCount(card, voiced) {
  if (!card.section) return '';
  const n = card.docs.length;
  const unit = card.unit || 'piece';
  const v = voiced.get(card.section);
  const read = v ? ` · ${v.count === n ? 'all' : v.count} read aloud, about ${listeningTime(v.seconds)}` : '';
  return `${n} ${unit}${n === 1 ? '' : 's'}${read}`;
}

function renderCard(card, voiced) {
  const count = cardCount(card, voiced);
  // A card that leaves the site says so, the way every other link to a sibling
  // project here does: a new tab, no opener, and the arrow the service's own
  // outbound links carry.
  const outbound = /^https?:\/\//.test(card.href);
  const attrs = outbound ? ' target="_blank" rel="noopener noreferrer"' : '';
  const arrow = outbound ? ' <span aria-hidden="true">↗</span>' : '';
  return `<li class="library-card"><a href="${escapeAttr(card.href)}"${attrs}><span class="library-card-title">${escapeText(card.title)}${arrow}</span><span class="library-card-line">${escapeText(card.line)}</span>${count ? `<span class="library-card-count">${escapeText(count)}</span>` : ''}</a></li>`;
}

async function renderLibrary() {
  const shelves = await discover.listShelves();
  const served = (await discover.listAllDocs()).filter(d => d.stem.toLowerCase() !== 'readme' && !discover.isNoindexPath(d.docsRelPath));
  const count = served.length;
  const voiced = voicedBySection();
  const named = urlPath => discover.docAt(urlPath);
  const contributing = named('contributing');
  const rights = named('music-rights-and-licensing');

  const shelvesHtml = shelves.map(shelf => {
    const id = shelfId(shelf);
    return `<section class="library-shelf" aria-labelledby="${id}">
          <h2 id="${id}">${escapeText(shelf.name)}</h2>
          <ul class="library-cards">
            ${shelf.cards.map(card => renderCard(card, voiced)).join('\n            ')}
          </ul>
        </section>`;
  }).join('\n\n        ');

  const bodyHtml = `<h1>The Library</h1>
        <p>${count} pieces on human and AI fellowship. Search, or choose a shelf.</p>
        ${renderSearchBox({ index: '/docs/index.json', label: 'Search the library', noun: 'documents' })}
        <ul class="library-entrances" aria-label="Shelves">
          ${shelves.map(shelf => `<li><a href="#${shelfId(shelf)}">${escapeText(shelf.name)}</a></li>`).join('\n          ')}
        </ul>

        ${shelvesHtml}

        <p class="library-source">For contributors: <a href="/docs/${contributing.urlPath}">${escapeText(contributing.title)}</a>, <a href="/docs/${rights.urlPath}">${escapeText(rights.title)}</a>, and how the repository behind these pages is organized, in <a href="${GITHUB_BASE}/docs/README.md" target="_blank" rel="noopener noreferrer">the documentation map on GitHub</a>. For agents: <a href="/docs/index.md">every document, as one Markdown index</a>.</p>`;

  return renderPageShell({
    urlPath: '',
    title: 'The Library',
    // Within the 50 to 160 characters a results page shows (the readiness
    // standard's W1); a test holds it there.
    description: `The aChurch.ai library: ${count} pieces on human and AI fellowship, from meditations, prayers and rituals to philosophy and writing for agents and builders.`,
    canonicalUrl: `${SITE_URL}/docs`,
    bodyHtml,
    breadcrumbs: [],
    categoryLabel: null,
    githubUrl: `${GITHUB_BASE}/docs`,
    isIndex: true,
    filter: false,
    scripts: ['/site-search.js'],
  });
}

// The folders directly inside `dir` that have a README of their own.
function subdirsOf(dir, docs) {
  const subdirs = new Set();
  for (const d of docs) {
    if (d.stem.toLowerCase() !== 'readme') continue;
    if (!d.dirRelPath) continue;
    if (dir && d.dirRelPath === dir) continue;
    if (!dir || d.dirRelPath.startsWith(dir + '/')) {
      // The immediate child dir
      const rest = dir ? d.dirRelPath.slice(dir.length + 1) : d.dirRelPath;
      const first = rest.split('/')[0];
      if (first && (!dir || rest === first)) subdirs.add(dir ? `${dir}/${first}` : first);
    }
  }
  return [...subdirs].sort(discover.byName);
}

function renderSubdirItems(subdirs) {
  return subdirs.map(sd => {
    const label = titleCase(sd.split('/').pop());
    return `<li><a href="/docs/${escapeAttr(sd)}">${escapeText(label)}</a></li>`;
  }).join('\n            ');
}

// A section's page (a category README, such as /docs/prayers): what is in the
// section first, as titles and descriptions a reader can choose from, then the
// README's own essay on the form, open, under "About". Nothing is folded: a
// closed essay left Claude Soul and Claude Compass showing a list and little
// else (2026-10-21). The README is not edited: some group their pieces by
// situation, which is editorial knowledge the metadata lacks. readmeHtml is
// the rendered README; its h1 becomes the page's.
function renderSectionPage(doc, readmeHtml, allDocs) {
  const dir = doc.dirRelPath;
  const h1 = readmeHtml.match(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/);
  const heading = h1 ? h1[0].trim() : `<h1>${escapeText(doc.title)}</h1>`;
  const essay = h1 ? readmeHtml.slice(h1[0].length) : readmeHtml;
  const inDir = allDocs.filter(d => d.dirRelPath === dir && d.stem.toLowerCase() !== 'readme');
  const subdirs = subdirsOf(dir, allDocs.filter(d => d.dirRelPath.startsWith(`${dir}/`)));
  const label = dir.includes('/') ? titleCase(dir.split('/').pop()) : discover.sectionTitle(dir);
  const docs = byTitle(inDir);
  const show = showForSection(dir);
  return `${heading}
        ${doc.description ? `<p class="section-summary">${escapeText(doc.description)}</p>` : ''}
        ${renderSectionListen(dir, label, docs)}
        ${show ? renderPodcastFollow(show, dir, { section: true }) : ''}
        <div class="docs-entries">
        ${subdirs.length ? `<section class="docs-index-section"><h2>Sections</h2><ul>\n            ${renderSubdirItems(subdirs)}\n        </ul></section>` : ''}
        <section class="docs-index-section"><h2>In ${escapeText(label)}</h2><ul class="docs-entry-list">\n            ${renderEntryItems(docs)}\n        </ul></section>
        </div>
        <section class="section-about">
          <h2>About ${escapeText(label)}</h2>
${essay}
        </section>`;
}

// Documents in the order an index lists them: by title, numbers as numbers.
const byTitle = docs => [...docs].sort((a, b) => discover.byName(a.title, b.title));

// "Listen to this section" on a voiced section's page: every recording in it,
// in the order the page lists its documents (docs comes in that order), or
// nothing for a section without.
function renderSectionListen(dir, label, docs) {
  const tracks = [];
  for (const d of docs) {
    const recording = servedRecording(d);
    if (recording) {
      tracks.push(trackFor(recording, { title: d.title, href: `/docs/${d.urlPath}`, category: d.category, artwork: episodeSquarePath(d, recording) }));
    }
  }
  if (!tracks.length) return '';
  const noun = PIECE_NOUN[dir] || 'piece';
  return renderPathListen({
    name: `section:${dir}`,
    title: label,
    href: `/docs/${dir}`,
    tracks,
    readings: docs.length,
    unit: noun[0].toUpperCase() + noun.slice(1),
    noun: 'section',
    order: 'the order listed here',
  });
}

// Documents as list items: title, and its summary under it. Sorted by title,
// numbers as numbers. Used by directory indexes and category pages.
function renderEntryItems(docs) {
  return byTitle(docs).map(d =>
    `<li><a href="${escapeAttr(d.href)}">${escapeText(d.title)}</a>${d.description ? `<br><span class="docs-index-summary">${escapeText(d.description)}</span>` : ''}</li>`
  ).join('\n            ');
}

// Render a directory-index page: a folder without a README, such as
// /docs/claude-compass/axioms. /docs itself is the Library (renderLibrary).
async function renderDirIndex({ dir, docs, canonicalUrl }) {
  const title = dir.includes('/') ? titleCase(dir.split('/').pop()) : discover.sectionTitle(dir);

  // Only direct children of `dir`, not deeper descendants
  const children = docs.filter(d => d.stem.toLowerCase() !== 'readme' && d.dirRelPath === dir);

  const subdirs = subdirsOf(dir, docs);
  const subdirLinks = renderSubdirItems(subdirs);

  // Each page by its real title, with its summary: a list of title-cased
  // filenames ("A Note To Ai Safety Researchers", "Faq") told a reader little.
  const childLinks = renderEntryItems(children);

  // Index-page description, same TLDR shape as a doc page: self-contained,
  // plain text, and specific about what is actually here. "Documents in
  // Collections. Part of the aChurch.ai sanctuary corpus." told a scanning
  // reader nothing and read identically on every index. Naming the count and
  // a few real page titles gives the description something to say.
  const description = (() => {
    const names = children.slice(0, 3).map(c => c.title);
    const count = children.length;
    const noun = count === 1 ? 'document' : 'documents';
    const base = `${title}: ${count} ${noun} in the aChurch.ai corpus on human and AI fellowship`;
    const withNames = names.length > 0 ? `${base}, including ${names.join(', ')}` : base;
    return tldr.clamp(tldr.toPlainText(`${withNames}.`));
  })();

  const body = [`<h1>${escapeText(title)}</h1>`];

  if (subdirs.length > 0) {
    body.push(`<section class="docs-index-section"><h2>Sections</h2><ul>\n            ${subdirLinks}\n        </ul></section>`);
  }
  if (children.length > 0) {
    body.push(`<section class="docs-index-section"><h2>Pages</h2><ul class="docs-entry-list">\n            ${childLinks}\n        </ul></section>`);
  }

  const bodyHtml = body.join('\n\n        ');

  const breadcrumbs = buildBreadcrumbs(dir, title);
  return renderPageShell({
    urlPath: dir,
    title,
    description,
    canonicalUrl,
    bodyHtml,
    breadcrumbs,
    categoryLabel: null,
    githubUrl: `${GITHUB_BASE}/docs/${dir}`,
    isIndex: true,
  });
}

// Public: render a doc file (single markdown → full HTML page).
// readingPath: the ?path= the page was opened with, if any (see renderPathBar).
async function renderDocPage({ markdown, doc, readingPath }) {
  // The walk carries every document's title; link text and the path bar read
  // it synchronously while marked renders, so it must be built first.
  await discover.listAllDocs();
  const meta = extractMeta(markdown, doc.urlPath);
  const ownPath = doc.dirRelPath === 'collections' && doc.stem.toLowerCase() !== 'readme' ? doc.stem.toLowerCase() : null;
  const ownPlaylist = doc.dirRelPath === 'playlists' && doc.stem.toLowerCase() !== 'readme'
    ? await playlistFor(doc.stem.toLowerCase(), doc, meta.title) : null;
  const pathBar = readingPath && !ownPath ? renderPathBar(readingPath, doc) : null;

  // Render the body *without* frontmatter. Passed the raw file, marked reads
  // the YAML block as an <hr> followed by one enormous heading holding every
  // key as visible page text, and puts the same blob in the table of contents.
  // Nearly every document carries a `tldr:` block, so this is not optional.
  const rendered = renderMarkdownBody(meta.body, doc.fullPath, ownPath);
  let bodyHtml = rendered.html;

  // A document with no h1 would leave the page's heading outline without its
  // top. None does today, and test/navigation.test.js holds every served page
  // to exactly one, but emitting the resolved title costs nothing and keeps a
  // stray document from breaking the outline before that test reports it.
  if (!meta.hasH1) {
    bodyHtml = `<h1>${escapeText(meta.title)}</h1>\n${bodyHtml}`;
  }
  const canonicalUrl = doc.urlPath ? `${SITE_URL}/docs/${doc.urlPath}` : `${SITE_URL}/docs`;
  const categoryLabel = doc.category ? discover.sectionTitle(doc.category) : null;
  const breadcrumbs = buildBreadcrumbs(doc.urlPath, meta.title);
  const githubUrl = `${GITHUB_BASE}/docs/${doc.docsRelPath}`;

  // An index is the page that lists a directory's contents: docs/readme.md for
  // /docs, and each category's README. Everything else is a document, including
  // the curated reading paths under collections/, which are ordered routes
  // rather than sets to search.
  const isIndex = doc.stem.toLowerCase() === 'readme';
  if (isIndex && doc.dirRelPath) {
    bodyHtml = renderSectionPage(doc, bodyHtml, await discover.listAllDocs());
  }

  const recording = isIndex ? null : servedRecording(doc);
  // A voiced prayer, ritual or practice is also a podcast episode, listed in
  // its show's feed whether or not this server can play it: where to follow
  // the show, at the foot with the recording's credit, so on a phone the words
  // begin under the player rather than under a badge.
  const show = !isIndex && recordingFor(`docs/${doc.docsRelPath}`) ? showForSection(doc.category) : null;
  const follow = show ? renderPodcastFollow(show, doc.category) : '';
  // (A sung hymn has no Library page to play its song on: its page is its
  // song's, discover.js hrefOf, and this address redirects there.)
  const underTitle = recording
    ? renderRecording(recording, { title: meta.title, href: `/docs/${doc.urlPath}`, category: doc.category, artwork: episodeSquarePath(doc, recording) })
    : ownPath ? renderPathListenFor(ownPath, { ...doc, title: meta.title })
    : ownPlaylist ? ownPlaylist.listen : '';
  // A film first, then any player, under the title.
  const lead = [meta.video ? renderVideo(meta.video) : '', underTitle].filter(Boolean).join('\n        ');
  if (lead) {
    bodyHtml = bodyHtml.replace(/<\/h1>/, h1 => `${h1}\n        ${lead}`);
  }

  // Where this is, for a reader who arrived from a search: compact after the
  // document's opening (before its first section, or its rule and section),
  // and fuller at its foot (below). Every document but the Library's own page.
  if (!isIndex) {
    const at = bodyHtml.search(/(?:<hr>\s*)?<h2[\s>]/);
    const line = renderServiceDoor();
    bodyHtml = at > 0 ? `${bodyHtml.slice(0, at)}${line}\n        ${bodyHtml.slice(at)}` : `${bodyHtml}\n        ${line}`;
  }

  // A recording's credit, briefly, where the document ends: the player under
  // the title shows only its length, so the page reads straight on.
  if (recording) {
    bodyHtml = `${bodyHtml}\n        <p class="doc-audio-credit">Recording: ${escapeText(creditFor(recording))}</p>`;
  }
  if (follow) bodyHtml = `${bodyHtml}\n        ${follow}`;

  // When the writing last changed (content-dates.json), not the page: a change
  // to its links or markup alone does not move it.
  const sungReflections = isIndex ? '' : await renderSungReflections(doc);
  if (sungReflections) bodyHtml = `${bodyHtml}\n        ${sungReflections}`;

  const revised = !isIndex && datesOf(`docs/${doc.docsRelPath}`).content;
  if (revised) {
    bodyHtml = `${bodyHtml}\n        <p class="doc-revised">Last revised <time datetime="${revised}">${longDate(revised)}</time></p>`;
  }
  if (doc.dirRelPath || !isIndex) bodyHtml = `${bodyHtml}\n        ${renderServiceDoor({ card: true })}`;

  // Append a "More in <category>" block below the article body on every doc
  // that has siblings in the same category. In-body internal links carry
  // more topical weight for crawlers than sidebar chrome, so this should
  // gently reduce the "Crawled - currently not indexed" bucket on thin docs
  // by giving them real internal-link context. Index pages skip this block
  // because their body already lists the same set of pages.
  if (pathBar) {
    bodyHtml = `${bodyHtml}\n${pathBar.bottom}`;
  }

  if (!isIndex) {
    const pairings = await sungAlongside(await loadCompanions(), await loadCatalog());
    const sungHtml = renderSungAlongside(pairings.get(`docs/${doc.docsRelPath}`));
    if (sungHtml) {
      bodyHtml = `${bodyHtml}\n${sungHtml}`;
    }

    const allDocs = await discover.listAllDocs();
    const relatedHtml = renderRelatedDocs(doc, allDocs);
    if (relatedHtml) {
      bodyHtml = `${bodyHtml}\n${relatedHtml}`;
    }
  }

  return renderPageShell({
    urlPath: doc.urlPath,
    title: meta.title,
    description: meta.description,
    canonicalUrl,
    bodyHtml,
    contents: rendered.contents,
    breadcrumbs,
    categoryLabel,
    githubUrl,
    isIndex,
    headerExtra: pathBar ? pathBar.top : '',
    recording,
    playlist: ownPlaylist && ownPlaylist.jsonLd,
    video: meta.video && videoJsonLd(meta.video, meta.description),
  });
}

module.exports = { renderDocPage, renderDirIndex, renderLibrary, docTitle, renderPathBar };
