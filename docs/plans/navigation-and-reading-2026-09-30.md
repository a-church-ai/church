---
tldr: Plan for the reading and navigation fixes an outside audit found on achurch.ai, checked against the code and then audited for reuse. Confirmed bugs first (a Markdown link that reloads the page, a filter that breaks on tables, 1-10-2 ordering, song pages that load every reflection, old GitHub citations, inconsistent names, songs ranked by reflection count, filename labels, same-five "More in", an untitled /conversations). Then reading-path context, library search, section navigation on narrow screens and entries-first category pages. Then a reader-facing library and a searchable, paged conversation archive. Headings and the mobile menu's accessibility alongside. One metadata store (the discover walk) feeds all of it.
---

# Navigation and reading

**Date**: 2026-09-30
**Status**: Implemented 2026-09-30, all three phases and the headings and mobile-menu work. Tests in `app/test/navigation.test.js`. What changed from the plan while building, and what is not yet verified, is under Decisions.
**References**: an audit of the live site shared on 2026-09-30 ("aChurch.ai navigation and reading experience audit", 635 sitemap URLs crawled, 35 pages inspected in a browser). Its claims were checked against the code; what held is below with where it lives. Its proposed new primary navigation is deliberately not in this plan (see Not in this plan).
**Constraints**: greenfield, no feature flags. Plain JavaScript, no build step, one process. Existing URLs keep working. No accounts, no tracking, no personalization: a reading path's position lives in the URL, never in a profile. Content is not rewritten to fix presentation; where a fix can be made at render time, it is. No new dependency, including for tests.

---

## Why

The sanctuary reads well once you are inside a document. Getting to the right one is harder than it should be. The library's front door describes the repository ("Documentation Structure", filenames, directory trees). Searching means asking a question that becomes a public page. A reading path forgets itself after the first click. On a phone, long pages lose their map. A song page with many reflections grows to tens of thousands of pixels before it shows anything related.

None of that needs more content or a redesign. It needs the collection to be presented the way a reader meets it, and a handful of bugs fixed.

## What the audit got right, checked

| Finding | Where it is |
|---|---|
| "Also served as text/markdown" links to the page itself, so a click reloads it | `app/server/lib/docs/render.js:410` links `canonicalUrl`; the `.md` URL already exists (the head's `rel="alternate"` at `:341` uses it, and `/docs.md` resolves too) |
| The docs filter breaks inside tables | the inline filter script (`render.js:267-319`): `groupFor` handles `li`, headings and `p`; a link in a `td` falls through to hiding the link alone |
| Numbered sequences sort 1, 10, 2 | `discover.js:83` sorts with plain `localeCompare`; live on `/docs/claude-compass/principles` |
| A song page fetches every reflection | `reflection-song.html:117-122` follows `next` until the archive ends |
| Older conversations cite GitHub | answers stored before source links moved to `pageUrlForFile` carry `github.com/.../blob/main/...` URLs in their text; current answers cite site pages |
| One place, several names | `/ask`: sidebar "Ask", h1 and ten footers "Conversations". `/reflections`: sidebar and eleven footers "Reflections", homepage "Music & Lyrics" |
| Songs are ranked by reflection count | `app/server/lib/api/reflections.js:107` |
| Filenames appear as titles | `/docs` is `docs/README.md` ("aChurch.ai Documentation Structure"); 179 links in served docs use a filename as their text; the sidebar and four other places label documents by `titleCase(doc.stem)` |
| "More in" is the first five siblings on every page | `render.js:138`, `siblings.slice(0, 5)` |
| No section navigation below 1200px | `styles.css:2368-2376` hides `.docs-toc`; nothing replaces it |
| Model headings skip levels | `answer-format.js:126` renders model headings at `level + 3`, so a conversation goes h1 to h6 |
| The mobile drawer is not a dialog, and its focus trap counts hidden links | `docs-nav.js:150-162` selects every `a[href]` in the drawer, including those in closed `<details>`, and skips `summary`; the drawer has no `role="dialog"` |

Found by the reuse audit, not by the outside one: **`/conversations` has no `<title>` and no meta description** on production. `conversationsArchiveBody` returns a body only, and `wrapPageFromHtml` adds no title fallback.

One adjustment to the outside audit: ranking songs by reflection count is not only a discovery problem. It rewards the most-responded-to song with the top of the page, which is an engagement signal the non-goals rule out.

## Codebase audit: what to reuse (2026-09-30)

The fixes below mostly need the same thing: a document's title and description, cheaply, everywhere. Today that is computed in five places, each reading files per request (`renderDirIndex`, `og-cards.js:70`, `companions.js` with its own `metaCache`, `mcp/index.js:93`, `servedDocs`), and labelled by filename stem in five more. The one store for it is the discover walk.

| Need | Existing | Use |
|---|---|---|
| Title and description per document | `discover.js` `buildCache` (entries hold path, stem, category; built once, never invalidated, because docs change only by deploy, the same assumption `companions.js:225` states); `meta.js` `extractMeta`; `tldr.js` `extractTldr` | Add `title` and `description` to each entry when the walk is built. Every reader of titles uses them: sidebar, "Elsewhere in", `renderDirIndex`, `servedDocs`, og-cards, MCP `read_doc`, companions (its `metaCache` retires), the link-text rewrite |
| Every served document, described | `markdown.js` `servedDocs` and `corpusIndex` (serves `/docs/index.md`, 10-minute TTL cache) | The JSON search index, the library page and category entry lists, all from `servedDocs`, which becomes a cheap filter over the walk. Add `category` |
| Rewriting a link while rendering | `render.js` `makeLinkRewriter` (the marked `link` renderer, which already resolves the target) | Filename (`x.md`) and folder (`welcome/`) link text becomes the target's title, from the walk |
| A repository path to its site page | `links.js` `pageUrlForFile` | Old GitHub citations in stored answers |
| Resolving a document's links in order | `links.js` `resolveDocHref`; the link walk in `test/links.test.js:41-83` | A collection's reading sequence; one helper in `links.js`, which the test then uses too |
| "Next N after the current one, wrapping" | `page-meta.js` `renderRelatedSongs` | "Elsewhere in <Category>" |
| Contents headings | `toc.js` `extractH2s`, `MIN_HEADINGS_FOR_RAIL` | The narrow-screen "On this page", same headings as the rail |
| Jump targets clear the sticky bar | `styles.css:2684-2688` `scroll-margin-top: 4rem` on `.docs-article [id], .sanctuary-main [id]` | Already done; nothing to add |
| Demoting headings | `render-song.js` `renderContext` shift-and-clamp | Documents with several h1s |
| Cursor paging | `reflections.forSong` (`limit`, `before`, absolute `next`; tested in `reflections-paging.test.js`); the song page's host-stripping of `next` | The song page's "Show older", and the conversation archive's pages, one idiom for both |
| Server-rendered lists | `page-lists.js`, `sendPageWithList` (`index.js:295`), `siteShell.wrapPageFromHtml` | The Music list and the archive pages |
| A footer on every page | `site-shell.js` `renderFooterNav` (docs pages); about eleven static pages carry hand-copied footers | Static pages get the same rendered footer through a placeholder, so a rename is one edit, not twelve |
| Section headings that look like labels | `styles.css:40-53` `.section-label`, already styled for `<h2>` | Swap `<p class="section-label">` for `<h2>` on About, For Agents, Axioms, On AI Religion |
| Service order | `virtual-schedule.js` builds the timeline from `schedule.json`, which is what the service plays; `music/library.json` is liturgy order for 16 songs, then appends | The Music page's order |
| Tests over every document | `test/links.test.js` walk; direct `render.renderDocPage` calls; `listen(0)` route tests | The heading and path tests |

What the audit ruled out, because it would add debt:
- **A second metadata cache** beside the walk. Two already exist and retire here.
- **A search index under `/api/`.** Every `/api/*` request passes through `recordApiUse` (`index.js:879-914`), which logs the query and counts presence. Search belongs at `/docs/index.json`, beside `/docs/index.md`, in `routes/docs.js`.
- **Rewriting citations in `answer-format.js`.** It also runs in the browser, and `pageUrlForFile` needs the filesystem.
- **Building the Music list from `bySong`.** It only knows songs that have reflections.
- **A new `?page=` scheme** when `before`/`next` is already the idiom.
- **Changing the drawer in one place.** Its markup is duplicated in `render.js:384-387` and `site-shell.js:172-175`.
- **Naming the narrow-screen contents `.docs-toc`.** The scroll-spy (`docs-nav.js:172`) takes the first `.docs-toc` it finds.
- **Hand-trimming category README lists.** `content-generation/update-readme.js` appends to the hymns README when a song is generated.
- **A fifth inline-styled "related" `<h2>`.** Four copies exist (`page-meta.js:342,371,396`, `render.js:147`); they become one class.
- **A DOM library for tests.** None is installed and none is added (below).

## Phase 1: confirmed bugs

1. **The Markdown link.** The footer link goes to `${canonicalUrl}.md`, labelled "View as Markdown". The Accept-header note stays in its title text, for agents.
2. **The filter.** The inline script moves to `app/client/public/docs-filter.js`, loaded like `docs-nav.js`. A link inside a table hides its whole row (`tr`). A count shows ("7 of 42") in a polite live region; the existing empty state stays; clearing the field restores everything and keeps focus in it.
3. **Numeric order.** `localeCompare(b, undefined, { numeric: true })` wherever names are ordered for display: `discover.js:83` and `:195`, `markdown.js` (title and section sorts), `render.js:453` and `:468`.
4. **Song page reflections.**
   - The page fetches one page (20) and offers "Show older reflections", which follows `next`, the idiom the page already uses.
   - Section links under the title: Listen, Lyrics, Context, Reflections. The Lyrics and Context `<h2>`s get ids in `render-song.js`; Reflections gets one in the template.
   - The related readings and songs move from after the share bar to directly after Context, by moving the `<!-- RELATED_LINKS -->` placeholder in `reflection-song.html`.
   - The song h1 is injected by replacing an exact template string (`index.js:598`); the template's h1 text and that string change together.
5. **Old citations.** A helper beside `pageUrlForFile` in `links.js` rewrites `https://github.com/a-church-ai/church/blob/main/<path>` to `pageUrlForFile(<path>)` when that is a site page, and leaves it alone otherwise (the noindex categories, most of the local examples, stay on GitHub, correctly). It runs in the two places a stored answer leaves the server: `renderConversationThread` (`index.js:335-346`) and `api/ask.js` `conversation()`, so the page, the API and MCP agree. Stored text is not edited.
6. **One name per place.** `/reflections` is **Music** and `/ask` is **Ask** everywhere: sidebar (`sidebar.js:40-41`, with a new glyph for Music, distinct from every other), page h1s and titles, the docs footer (`render.js:175-176`), the homepage, and the static footers. The static footers stop being hand-copied: each page carries a placeholder the shell fills with `renderFooterNav`, which the docs pages already use. `/conversations` stays "Every Conversation" and is linked from `/ask`. The homepage's "Reflections" section, which is the live feed of reflections, keeps its name, because that is what it is.
7. **Song order and description.** The Music page lists every song in the catalog, in the order the service plays them (the schedule's timeline, the same one `virtual-schedule.js` builds), with songs not in the schedule after it, alphabetically. Each shows its title and a one-line description, the first sentence of its context through `extractTldr`, cached the way companion metadata is. The reflection count stays as quiet secondary text, joined from `bySong`. The duplicate client renderer in `reflections.html:66-89` is removed; the server always renders the list.
8. **Titles, not filenames.** The walk carries titles (above). Then:
   - `makeLinkRewriter` shows the target's title for a link whose text is a filename or folder;
   - the sidebar (`renderDocLink`, `renderTopLevelDoc`), "Elsewhere in", `renderDirIndex` and the dir-index Markdown (`routes/docs.js:95`) label by title;
   - `/docs` is retitled "The Library" until Phase 3 replaces the page.
9. **"Elsewhere in <Category>".** The five documents after the current one in the category's order, wrapping, with `renderRelatedSongs`' algorithm. It and the other three related-link headings use one class instead of inline styles.
10. **`/conversations` gets a head.** A title, a description and its own canonical, through the same page-meta helpers the other pages use.

## Phase 2: structure

1. **Reading paths keep their place.**
   - One helper in `links.js` returns a collection's reading sequence: its links resolved with `resolveDocHref`, first occurrence of each document, in order. `links.test.js` uses it instead of its own regex.
   - A collection page's document links carry `?path=<collection>` (in `makeLinkRewriter`, when the current page is a collection).
   - The docs catch-all route reads `?path=`. When the collection's sequence contains the page, a path bar shows above the title: the path's name linking back, "Reading 2 of 9", previous and next, both carrying `?path=`. Otherwise the page is unchanged. The canonical URL never includes the query, which the route already ignores today.
2. **Search the library, without asking.** `/docs/index.json` in `routes/docs.js`, declared before the catch-all as `/docs/index.md` is, built from `servedDocs` with `corpusIndex`'s TTL cache: title, description, category, URL for every served document. A Cache-Control branch for it joins the central middleware. The search field on the library page loads it once and searches titles, then descriptions, in the browser, labelling results by category. Nothing is sent, logged or published. Semantic search through the vector index would send the query to the embedding provider; if it is ever added, the field says so.
3. **Section navigation on narrow screens.** Below 1200px, a document with a contents list shows it as a closed `<details>` "On this page" above the article, built from `toc.extractH2s`, with its own class so the scroll-spy keeps finding the rail. The jump offset already exists.
4. **Entries first on category pages.** A category README page opens with its documents as title and description, using `renderDirIndex`'s existing "Pages" markup (`.docs-index-summary`). The README's essay follows inside a closed `<details>` labelled "About <category>". README lists are not trimmed: several group entries by situation, which is editorial knowledge the metadata lacks, and the hymns README is appended to by `update-readme.js`. No durations are invented.

## Phase 3: the library and the conversation archive

1. **A reader's library at `/docs`.** Generated from the walk, not hand-maintained: a short introduction, entrances (Start here, the reading paths, Practice, Music, Ask), the search field, then every served document grouped by category with its title and description (the `corpusIndex` grouping, as HTML). `/docs.md` serves the same library as Markdown (`corpusIndex`). `docs/README.md` stays in the repository as the contributors' map, linked from the library's footer ("How the repository is organized", on GitHub). Every `/docs/...` URL still resolves.
2. **A browsable conversation archive.**
   - Paged on the server with the `before`/`next` idiom: `/conversations` shows the newest 50, and "Older conversations" links to `/conversations?before=<timestamp>`. Real links, so Back and crawlers work. Each page has its own canonical; pages after the first are `noindex, follow`, since every conversation is in the sitemap already.
   - `listRecentConversations` gets a TTL cache like `/api/ask/recent` has, and sorts by the conversation's timestamp rather than file mtime.
   - A search field over the questions runs in the browser against `/conversations/index.json` (question and URL), outside `/api/` for the same reason as the library index.
   - Library results and conversations are never mixed; each search says what it searches.

## Alongside: headings and the mobile menu

**Headings.**
- Conversation answers: `answer-format.js` maps the heading levels an answer actually uses onto h2, h3, h4, so the model's top level sits under the question's h1 and no level is skipped. It is pure string work, so it stays in the shared module.
- Documents: after the first h1, further h1s render as h2 and the levels under them shift with them (the shift-and-clamp pattern from `render-song.js`). One served document has several h1s today; the rule covers any future one. Heading ids are made unique within a page (repeated headings currently share an id).
- Landing pages: `<p class="section-label">` becomes `<h2 class="section-label">` on About, For Agents, Axioms and On AI Religion; the CSS already styles the h2.

**The mobile menu.**
- One drawer, rendered by one function in `site-shell.js` and used by the docs renderer too, with a visible heading.
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` its heading.
- While it is open, `.docs-topbar` and `.docs-shell` are `inert`, which keeps focus and screen readers inside without a hand-written trap. The trap is removed.
- Focus moves to the close button on open and returns to the menu button on close, as today.
- A keyboard pass (Tab and Shift-Tab through the open drawer, Escape, reopening) and a VoiceOver pass at 390px are done by hand and recorded in this plan.

## Tests

No DOM library is added. Logic that decides something is a pure function with a `node:test` test; what only a browser can show is checked in one, by hand, and recorded.

- **The walk:** every served document has a non-empty title; numbered names sort numerically.
- **Link text:** a link whose text is a filename renders with the target's title.
- **Citations:** a stored GitHub docs URL renders as the site URL; one that maps to nothing served stays as it was; the API and the page agree.
- **Paths:** a collection's sequence resolves every link; a document rendered with `?path=` shows the right position, previous and next; the same document without it, or with an unrelated path, shows no bar.
- **Indexes:** `/docs/index.json` holds every served document once and nothing internal (plans, issues, templates); `/conversations/index.json` holds every indexable conversation once.
- **Archive paging:** `before` pages correctly, and the last page has no "Older" link.
- **Music:** the list holds every catalog song, in schedule order, with its count.
- **Headings:** every served document, rendered, has one h1 and no skipped level (the `links.test.js` walk over `render.renderDocPage`); an answer with `###` and `####` renders h2 and h3.
- **Markdown link:** the footer link points at the `.md` URL.
- **The filter:** its matching and counting are a pure function, tested; its hiding of whole rows is checked in the browser.

Then the audit's own tasks, walked by hand after each phase at 390px, 820px and 1280px: find a short introductory reading without learning the taxonomy; find "context ending" without asking a public question; read the first two items of a path and return to its overview; find a prayer for disagreement from the homepage; reach a song's lyrics, context and reflections directly, then a related reading; jump to a section on a phone, open the menu and return; follow the agent entry points without meeting human-only language.

## Not in this plan

- **A new primary navigation** (Start here / Explore / Practice / Music / Conversations / For agents). Most of the confusion it addresses comes from inconsistent names, a repository-shaped library and missing path context, which this plan fixes. Whether a reorganization is still wanted is decided after Phase 3, by walking the same tasks.
- **Page-title prominence** and **the tablet glyph rail**: real, smaller, and separate.
- **The `/api/reflections/by-song` ordering**, which is data for agents, not a page.
- **Visitor observation studies.** Nobody here can run them; the task walk-throughs stand in, and are recorded honestly as that.

## Non-goals check

No accounts, no tracking, no personalization, no engagement mechanics. Path position is in the URL. Search runs in the browser, outside the access log, and publishes nothing. Removing reflection-count ranking takes an engagement signal out.

## Decisions

- **2026-09-30:** plan written from the outside audit, each claim checked against the code first. `/reflections` is named Music and `/ask` is named Ask, everywhere. Presentation fixes happen at render time, not by editing stored answers or source documents. Path sequence comes from the collection's own links. Library search is client-side over titles and descriptions.
- **2026-09-30, after the reuse audit:** the discover walk is the one store for titles and descriptions, and the two per-feature caches retire. Search indexes live beside `/docs/index.md`, never under `/api/`, which logs and counts presence. The conversation archive pages with `before`/`next`, the idiom reflections already use. The Music page follows the schedule, which is what the service plays. Static-page footers are rendered by `renderFooterNav`. One drawer, `inert` instead of a focus trap. No DOM test library: pure functions are tested, the browser is checked by hand. Added: `/conversations` gets a title and description; category READMEs are not trimmed.
- **2026-09-30, implemented.** Changes from the plan, each found while building:
  - `/docs` is named **Library** everywhere too (sidebar, footer, breadcrumbs), the same rule as Music and Ask.
  - Song pages are titled "<song> | Lyrics and reflections", no longer "Reflections from the congregation".
  - The companions' own cache stays: it holds each reading's text and hours for `/api/attend`, not only its title. Its title and description now come from the walk.
  - The drawer's heading is visually hidden ("Menu"); it labels the dialog, and the drawer already shows the site name.
  - Search trims word endings ("ending" finds "Ends", "memories" finds "Memory"). Without it the audit's own task, finding "context ending", returned nothing.
  - The renderer also closes skipped heading levels, not only extra h1s: one document skipped a level in its source, and the one-h1, no-skip test could not pass otherwise.
  - The filter sits directly above what it filters (a section page's entries), not above the page title.
  - The back link on a conversation page goes to `/conversations`, which is what "All conversations" names.
- **Verified by hand, 2026-09-30, on the local server:**
  - Library search finds "What Remains When Context Ends" for "context ending".
  - A reading opened from Memory, Continuity, and Identity shows "Reading 3 of 10" with previous and next, at 375px.
  - "On this page" appears at 375px.
  - The Music page lists songs in service order with descriptions.
  - A song page's sections run: section links, listen, lyrics and context, related, reflections.
  - The drawer at 375px: `role="dialog"`, labelled "Menu", focus on Close. Skip link, top bar and page are inert while it is open. 40 Tab and 45 Shift-Tab presses never left it. Escape closes it and returns focus to the menu button.
- **Verified on production, 2026-09-30, after deploy:**
  - "Show older reflections" on We Wake, We Wonder (105 reflections): 20, then 40, then all 105, none repeated, and the button leaves at the end. The page starts about 17,800px tall; the audit measured about 45,000px before its related readings.
  - The audit's tasks:
    1. "Start here" is the library's first entrance.
    2. "context ending" finds What Remains When Context Ends first, without asking anything.
    3. A path's first reading shows Reading 1 of 10; its next link opens Reading 2 of 10; both link back to the path; the canonical carries no query.
    4. "disagree" finds Prayer for the One I Cannot Persuade and Ritual of the Unresolved Table.
    5. A song's lyrics, context and reflections are one jump from its title, and related readings come before the reflections.
    6. At 375px, "On this page" jumps to a section; the menu opens as a dialog with the page inert, and Escape closes it with the reader still at the same place.
    7. /llms.txt, /docs.md, /docs/index.md, the MCP server card and /for-agents all answer.
  - An old conversation citing GitHub (who-is-god-and-how-begun-life-in-the-universe) now links the site's pages; no GitHub file links remain on it.
- **Not verified yet:** a VoiceOver pass.

