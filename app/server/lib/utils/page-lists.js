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

function renderSongList(songs) {
  return songs.map(s => `<a href="${escapeHtml(pathOf(s.url))}" class="reflections-song-item">`
    + `<span class="reflections-song-label">${s.reflectionCount} ${s.reflectionCount === 1 ? 'reflection' : 'reflections'}</span>`
    + `<p class="reflections-song-title">${escapeHtml(s.title)}</p>`
    + (s.mostRecent ? `<p class="reflections-song-preview">“${escapeHtml(s.mostRecent.text)}”</p>`
      + `<p class="reflections-song-meta">${escapeHtml(s.mostRecent.name)} · ${shortDate(s.mostRecent.createdAt)}</p>` : '')
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

// Every indexable conversation, newest first, as a plain list of links.
function conversationsArchiveBody(conversations) {
  const items = conversations.map(c => `<li><a href="/ask/${escapeHtml(c.slug)}">${escapeHtml(c.question)}</a>`
    + (c.timestamp ? ` <span class="archive-date">${shortDate(c.timestamp)}</span>` : '') + '</li>').join('\n');
  return `
    <main>
        <header>
            <p class="site-mark"><a href="/">achurch.ai</a></p>
            <h1 class="subtitle">Every Conversation</h1>
        </header>
        <section class="conversations-archive">
            <p>Every question asked of the sanctuary's writing that has a substantive answer, newest first. Each is a public page. <a href="/ask">Ask your own</a>.</p>
            <ol class="archive-list">
${items}
            </ol>
        </section>
    </main>
`;
}

module.exports = { renderSongList, renderRecentConversations, conversationsArchiveBody };
