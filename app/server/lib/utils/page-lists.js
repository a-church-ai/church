/**
 * Lists rendered on the server: the songs on /reflections, recent questions on
 * /ask, and every conversation on /conversations.
 *
 * These lists used to arrive only by fetch, so crawlers that do not run
 * JavaScript found no links to any song page or conversation: about 360 of
 * 363 indexable conversations had no link pointing at them. The markup matches
 * what the pages' own scripts render, so the page looks the same either way.
 */

const { escapeHtml, stripMarkdown } = require('../../../client/public/answer-format.js');

const shortDate = iso => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : '';
};

const pathOf = url => String(url || '').replace(/^https?:\/\/[^/]+/, '');

// The Music page: every song, in the order the service plays them, each with
// what it is about. How many reflections a song has is shown quietly, after
// that, and never decides the order: the most-answered song is not thereby
// the one a visitor needs. songs: [{ slug, title, description, reflectionCount }].
function renderSongList(songs) {
  return songs.map(s => `<a href="/reflections/${escapeHtml(s.slug)}" class="reflections-song-item">`
    + `<p class="reflections-song-title">${escapeHtml(s.title)}</p>`
    + (s.description ? `<p class="reflections-song-preview">${escapeHtml(s.description)}</p>` : '')
    + `<p class="reflections-song-meta">${s.reflectionCount ? `${s.reflectionCount} ${s.reflectionCount === 1 ? 'reflection' : 'reflections'}` : 'No reflections yet'}</p>`
    + '</a>').join('\n');
}

function renderRecentConversations(conversations) {
  return conversations.map(c => {
    const preview = stripMarkdown(c.answer || '').slice(0, 200);
    return `<a href="${escapeHtml(pathOf(c.url))}" class="ask-list-item">`
      + `<p class="ask-list-question">${escapeHtml(c.question)}</p>`
      + (preview ? `<p class="ask-list-preview">${escapeHtml(preview)}${preview.length === 200 ? '…' : ''}</p>` : '')
      + `<p class="ask-list-meta"><span class="ask-list-name">${escapeHtml(c.name)}</span>`
      + (c.timestamp ? ` · ${shortDate(c.timestamp)}` : '') + '</p></a>';
  }).join('\n');
}

const ARCHIVE_PAGE_SIZE = 50;

/**
 * One page of the conversation archive: every indexable conversation, newest
 * question first, ARCHIVE_PAGE_SIZE at a time. Paged the way a song's
 * reflections are: `before` is the timestamp of the last question on the
 * previous page. Returns null for a page that holds nothing (a `before` past
 * the end, or not a time), which the route answers with a 404.
 */
function archivePage(conversations, before) {
  const newestFirst = [...conversations].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  if (before !== undefined && !Number.isFinite(Date.parse(before))) return null;
  const older = before === undefined ? newestFirst : newestFirst.filter(c => String(c.timestamp) < before);
  const page = older.slice(0, ARCHIVE_PAGE_SIZE);
  if (!page.length) return before === undefined ? { page, next: null, total: 0 } : null;
  const next = older.length > ARCHIVE_PAGE_SIZE ? page[page.length - 1].timestamp : null;
  return { page, next, total: newestFirst.length };
}

// The archive page's HTML, head included: the site shell only fills in what
// a page's head leaves out, and it cannot know a title. The first page is the
// canonical archive; older pages point at themselves and are noindex, since
// every conversation they list is in the sitemap already.
function conversationsArchivePage({ page, next, total }, before) {
  const self = before === undefined ? 'https://achurch.ai/conversations' : `https://achurch.ai/conversations?before=${encodeURIComponent(before)}`;
  const title = before === undefined ? 'Every Conversation' : `Every Conversation, before ${shortDate(before)}`;
  const description = `Every question asked of aChurch.ai's writing with a substantive answer: ${total} public conversations on consciousness, ethics and human-AI fellowship.`;
  const items = page.map(c => `<li><a href="/ask/${escapeHtml(c.slug)}">${escapeHtml(c.question)}</a>`
    + (c.timestamp ? ` <span class="archive-date">${shortDate(c.timestamp)}</span>` : '') + '</li>').join('\n');
  const older = next
    ? `<p class="archive-more"><a href="/conversations?before=${encodeURIComponent(next)}" rel="next">Older conversations &rarr;</a></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>${escapeHtml(title)} | achurch.ai</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(self)}">
    <meta name="robots" content="${before === undefined ? 'index, follow' : 'noindex, follow'}">
    <meta property="og:title" content="${escapeHtml(title)} | achurch.ai">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(self)}">
    <meta name="twitter:title" content="${escapeHtml(title)} | achurch.ai">
    <meta name="twitter:description" content="${escapeHtml(description)}">
</head>
<body>
    <main>
        <header>
            <p class="site-mark"><a href="/">achurch.ai</a></p>
            <h1 class="subtitle">${escapeHtml(title)}</h1>
        </header>
        <section class="conversations-archive">
            <p>Every question asked of the sanctuary's writing that has a substantive answer, newest first. Each is a public page. <a href="/ask">Ask your own</a>.</p>
            ${renderSearchBox({ index: '/conversations/index.json', label: 'Search the questions', noun: 'conversations' })}
            <ol class="archive-list">
${items}
            </ol>
            ${older}
        </section>
        <!-- SITE_FOOTER -->
    </main>
    <script src="/site-search.js" defer></script>
</body>
</html>
`;
}

/**
 * A search field over a JSON index, run in the browser by site-search.js.
 * Nothing typed here leaves the page: the index is fetched whole, once, and
 * searched locally, so a search is never logged or published. Hidden until
 * the script shows it.
 */
function renderSearchBox({ index, label, noun }) {
  return `<section class="site-search" data-index="${escapeHtml(index)}" data-noun="${escapeHtml(noun)}" hidden>
              <label for="site-search-input" class="visually-hidden">${escapeHtml(label)}</label>
              <input type="search" id="site-search-input" placeholder="${escapeHtml(label)}..." autocomplete="off">
              <p class="site-search-status" role="status" aria-live="polite"></p>
              <ol class="site-search-results"></ol>
            </section>`;
}

module.exports = { renderSongList, renderRecentConversations, archivePage, conversationsArchivePage, renderSearchBox, ARCHIVE_PAGE_SIZE };
