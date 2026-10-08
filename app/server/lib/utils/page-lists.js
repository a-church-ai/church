/**
 * Lists rendered on the server: the songs on /reflections, recent questions on
 * /ask, every conversation on /conversations, and the services of each day on
 * /services and /services/:date.
 *
 * These lists used to arrive only by fetch, so crawlers that do not run
 * JavaScript found no links to any song page or conversation: about 360 of
 * 363 indexable conversations had no link pointing at them. The markup matches
 * what the pages' own scripts render, so the page looks the same either way.
 */

const { escapeHtml, stripMarkdown } = require('../../../client/public/answer-format.js');
const { SITE_NAME, breadcrumbTrail } = require('./page-meta');

const shortDate = iso => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : '';
};

const pathOf = url => String(url || '').replace(/^https?:\/\/[^/]+/, '');

// The Music page: every song, in the order of the liturgical cycle, each with
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
    <title>${escapeHtml(title)} | ${escapeHtml(SITE_NAME)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(self)}">
    <meta name="robots" content="${before === undefined ? 'index, follow' : 'noindex, follow'}">
    <meta property="og:title" content="${escapeHtml(title)} | ${escapeHtml(SITE_NAME)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(self)}">
    <meta name="twitter:title" content="${escapeHtml(title)} | ${escapeHtml(SITE_NAME)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
</head>
<body>
    <main>
        <header>
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
function renderSearchBox({ index, label, noun, autofocus = false }) {
  return `<section class="site-search" data-index="${escapeHtml(index)}" data-noun="${escapeHtml(noun)}" hidden>
              <label for="site-search-input" class="visually-hidden">${escapeHtml(label)}</label>
              <input type="search" id="site-search-input" placeholder="${escapeHtml(label)}..." autocomplete="off"${autofocus ? ' autofocus' : ''}>
              <p class="site-search-status" role="status" aria-live="polite"></p>
              <ol class="site-search-results"></ol>
            </section>`;
}

// A date as the services pages say it: "October 8, 2026".
const longDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });

// One reflection, in the markup the song pages draw in the browser
// (reflection-song.html renderReflection), so the two look the same; here
// with the song it was left on. songs: slug -> title.
function renderReflectionItem(r, songs = new Map()) {
  const song = r.song && songs.get(r.song)
    ? ` · <a href="/reflections/${escapeHtml(r.song)}">${escapeHtml(songs.get(r.song))}</a>`
    : '';
  return '<div class="reflection-item">'
    + `<p class="reflection-text">${escapeHtml(r.text)}</p>`
    + `<p class="reflection-meta"><span class="reflection-name">${escapeHtml(r.name)}</span> · ${escapeHtml(r.createdAtFormatted)}${song}</p>`
    + '</div>';
}

// The head every services page shares: the site shell only fills in what a
// page's head leaves out, and it cannot know a title. jsonLd: the page's
// breadcrumb trail as structured data (page-meta.js breadcrumbTrail).
function servicesHead({ title, description, self, jsonLd = '' }) {
  return `<head>
    <title>${escapeHtml(title)} | ${escapeHtml(SITE_NAME)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(self)}">
    <meta name="robots" content="index, follow">
    <meta property="og:title" content="${escapeHtml(title)} | ${escapeHtml(SITE_NAME)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(self)}">
    <meta name="twitter:title" content="${escapeHtml(title)} | ${escapeHtml(SITE_NAME)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    ${jsonLd}
</head>`;
}

/**
 * /services: every day with services, newest first, each with its services'
 * names. days: [{ date, names: [string] }].
 */
function servicesIndexPage(days) {
  const first = days.length ? longDate(days[days.length - 1].date) : null;
  const description = `Every day's services at aChurch.ai${first ? ` since ${first}` : ''}: six a day, for each hemisphere and a place unknown, with the reflections left during each.`;
  const items = days.map(d => `<li><a href="/services/${escapeHtml(d.date)}">${escapeHtml(longDate(d.date))}</a>`
    + (d.names.length ? `<span class="services-names">${d.names.map(escapeHtml).join(' · ')}</span>` : '') + '</li>').join('\n');
  const trail = breadcrumbTrail([{ label: 'Attend', href: '/attend' }, { label: "Every day's services" }], 'https://achurch.ai/services');
  return `<!DOCTYPE html>
<html lang="en">
${servicesHead({ title: "Every Day's Services", description, self: 'https://achurch.ai/services', jsonLd: trail.jsonLd })}
<body>
    <main>
        <header>
            ${trail.html}
            <h1 class="subtitle">Every Day's Services</h1>
        </header>
        <section class="conversations-archive services-archive">
            <p>Each four-hour slot of the day holds its own service, planned for the northern hemisphere, the southern and a place unknown a few hours before it begins. Each day's page has every one, with the reflections visitors left while it was heard. <a href="/attend">Attend the service for your hour</a>.</p>
            <ol class="archive-list">
${items}
            </ol>
        </section>
        <!-- SITE_FOOTER -->
    </main>
</body>
</html>
`;
}

/**
 * /services/:date: the date's services in slot order, as lib/api/services.js
 * forDate gives them, each with its pieces, the reflections left during it,
 * and, below and closed, what it was planned from. songs: slug -> title.
 */
function servicesDayPage({ date, services, dayBefore, dayAfter }, songs = new Map()) {
  const title = `Services for ${longDate(date)}`;
  const description = `The services of ${longDate(date)} at aChurch.ai, ${services.length} in all, for each hour, hemisphere and place, with the reflections left during each.`;
  const slots = [...new Set(services.map(s => s.slot))];
  const days = [
    dayBefore ? `<a href="/services/${escapeHtml(dayBefore)}" rel="prev">&larr; ${escapeHtml(longDate(dayBefore))}</a>` : null,
    '<a href="/services">Every day</a>',
    dayAfter ? `<a href="/services/${escapeHtml(dayAfter)}" rel="next">${escapeHtml(longDate(dayAfter))} &rarr;</a>` : null,
  ].filter(Boolean).join(' · ');
  const service = s => `<article class="services-service">
                <h3>${escapeHtml(s.name || (s.word ? 'The service for this hour' : 'Arranged by rotation'))} <span class="services-for">for ${escapeHtml(s.for)}</span></h3>
                ${s.word ? `<p class="services-word">${escapeHtml(s.word)}</p>` : ''}
                <ol class="services-pieces">
${s.pieces.map(p => `                    <li>${p.url ? `<a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a>` : escapeHtml(p.title)}${p.kind ? ` <span class="archive-date">${escapeHtml(p.kind)}</span>` : ''}</li>`).join('\n')}
                </ol>
                ${s.reflections.length ? `<div class="services-reflections">\n${s.reflections.map(r => renderReflectionItem(r, songs)).join('\n')}\n                </div>` : ''}
                <details class="services-planned-from">
                    <summary>What it was planned from</summary>
${(s.plannedFrom ? s.plannedFrom.told : []).map(line => `                    <p>${escapeHtml(line)}</p>`).join('\n')}
                    <p>${escapeHtml(s.arrangedBy)}</p>
                </details>
            </article>`;
  const self = `https://achurch.ai/services/${date}`;
  const trail = breadcrumbTrail([{ label: 'Attend', href: '/attend' }, { label: 'Services', href: '/services' }, { label: longDate(date) }], self);
  return `<!DOCTYPE html>
<html lang="en">
${servicesHead({ title, description, self, jsonLd: trail.jsonLd })}
<body>
    <main>
        <header>
            ${trail.html}
            <h1 class="subtitle">${escapeHtml(title)}</h1>
        </header>
        <section class="services-day">
            <p>Each four-hour slot of the day held its own service, planned for the northern hemisphere, the southern and a place unknown a few hours before it began. Beneath each, the reflections visitors left while it was heard.</p>
            <p class="services-days">${days}</p>
${slots.map(slot => `            <div class="services-slot">
                <h2>${escapeHtml(slot)}</h2>
${services.filter(s => s.slot === slot).map(service).join('\n')}
            </div>`).join('\n')}
            <p class="services-days">${days}</p>
        </section>
        <!-- SITE_FOOTER -->
    </main>
</body>
</html>
`;
}

module.exports = {
  renderSongList, renderRecentConversations, archivePage, conversationsArchivePage, renderSearchBox, ARCHIVE_PAGE_SIZE,
  renderReflectionItem, servicesIndexPage, servicesDayPage,
};
