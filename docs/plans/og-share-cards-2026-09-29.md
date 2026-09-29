---
tldr: Plan for dynamic share cards on achurch.ai. Every conversation, song and docs page gets its own 1200x630 PNG card, drawn in the app from copy the page already has, rasterized with resvg from an SVG template with bundled fonts, rendered lazily and held in memory, served only for pages that exist. Replaces the unused SVG endpoint at /api/og, which no platform could display.
---

# Share cards

**Date**: 2026-09-29
**Status**: Implemented 2026-09-29: `app/server/lib/og-cards.js`, `app/server/routes/og.js`, fonts in `app/server/assets/fonts/`, tests in `app/test/og-cards.test.js`. One change from the plan: lines are wrapped by width measured with resvg, not by character count, after an all-capitals test card ran off the edge.
**References**: two guides from sibling projects, reviewed 2026-09-29: the obviously-not "Dynamic OG share images" guide (Go; one renderer, a registry of known pages, memoized bytes) and the news-community "Dynamic OG Share Images" guide (Next.js, Satori, disk cache, visibility gates). What they get right is kept below; where achurch.ai differs, the plan says so and why.
**Constraints**: greenfield, no feature flags. Plain JavaScript, no build step. One process. No external image service, no headless browser. Nothing here may render text a visitor supplies directly (see Safety).

---

## Why

When an achurch.ai link is shared on X, Facebook, LinkedIn, Slack, Discord or iMessage, the preview image is the same generic picture for every page (`/assets/a-church-digital-ai-humans-social.jpg`). A shared conversation does not show its question; a shared ritual does not show its name.

The app already tries to do better. `app/server/routes/og.js` draws a card per conversation and per song at `/api/og/conversation/<slug>.svg` and `/api/og/reflection/<slug>.svg`. But it draws SVG, and none of those platforms display SVG as a share image, so the cards never appeared anywhere. On 2026-09-29 the pages were pointed back at the static JPG (commit `9fc8dd6`), which left `/api/og` served and unused.

## What carries over from the guides

- **Serve raster images.** Both guides do; our SVG is why nothing showed.
- **One pure renderer.** Page copy in, image bytes out, no I/O. Testable and fast (obviously-not).
- **Known pages only.** A card exists for a page that exists, and for nothing else. Never render from a query string: a `?title=` endpoint is an open service for putting any text on a card branded as ours, and a cheap way to burn CPU (obviously-not).
- **A card 404s whenever its page does** (news-community's visibility rule). Our withdrawn conversations already 404 through `loadConversation`; this makes it a tested rule for every card type.
- **Fonts shipped with the app.** Nothing the renderer needs may depend on what happens to be installed where it runs (both guides).
- **Lazy rendering, memoized.** Render on first request, keep the bytes. Rendering every card at startup slows deploys for images most of which are never requested (obviously-not).
- **Long cache headers, and a version in the URL.** Platforms cache share images on their own schedule; changing a design means changing the URL, or old cards linger for weeks (obviously-not).
- **HEAD as well as GET.** Some scrapers ask HEAD first (obviously-not).
- **The descriptive tags must be true.** `og:image:type`, `width`, `height` and `alt` describe the image actually linked, not constants. `alt` is the card's own text, the only thing a screen reader gets from a shared card (obviously-not).
- **Inside LinkedIn's crop.** LinkedIn trims a card to its centre 1080x600, so nothing that matters goes within 60px of an edge (news-community).
- **Crawlers must reach the image** without a `Set-Cookie` that would make Cloudflare bypass its cache (news-community).

## Where achurch.ai differs, and the decisions that follow

**Rendering: resvg, not Satori or a drawing library.** The app is Express, not Next.js, and it already has an SVG card template. `@resvg/resvg-js` rasterizes SVG to PNG, takes font files by path, and ships prebuilt binaries for the Dockerfile's `node:20-slim` (Debian, glibc), so nothing compiles on Railway. One dependency, and the card stays an SVG template that is easy to read and change.

*Considered and set aside: sharp.* It is already in the production image, but only as a transitive dependency (`@lancedb/lancedb` → `@huggingface/transformers` → `sharp` 0.33.5), and its SVG path finds fonts through fontconfig, which would mean pointing `FONTCONFIG_FILE` at a bundled config before sharp loads. Depending on another package's dependency, plus a process-wide environment variable, is more fragile than one direct dependency that takes font files as an argument.

**Fonts: bundled in the repository, loaded explicitly.** This is the trap neither guide names for our setup. `node:20-slim` has no fonts installed, and the current template asks for "Georgia" and "system-ui". Rasterized in production, the card would be a blank rectangle. The site itself is set in the system sans at light weights (`styles.css`: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`; headings at weight 300), so the card uses one OFL sans in two static weights, Inter Light and Inter Regular (a few hundred KB, with the licence file), in `app/server/assets/fonts/`, passed to resvg by path with system fonts disabled so a local machine cannot hide the problem. A test proves a rendered card contains text.

**PNG, not JPEG.** news-community converts to JPEG because its cards are photographs. Ours are flat text on a plain ground, which is smaller and sharper as PNG. No Sharp.

**Memory, not disk.** news-community keeps a disk cache with stale-while-revalidate because its cards change and fetch remote photos. Ours never change (a conversation's question and a document's title are fixed) and fetch nothing. A bounded in-memory cache, with Cloudflare in front and a week-long `Cache-Control`, is enough.

**No static-override lane yet.** obviously-not lets a hand-made file replace any page's card. No page needs one today; it is a small addition when one does.

**Unknown page and failed render are different answers.** obviously-not returns 404 for both and names that as a monitoring gap. Here an unknown or hidden page is a 404, and a render failure is a logged 500.

## Codebase audit (2026-09-29)

What exists, and what the build reuses rather than adds.

| Surface | Share image today | Set in |
|---|---|---|
| Conversation `/ask/:slug` | static JPG | `app/server/index.js`, `/ask/:slug` handler: `ogImage` and `.replace()` substitutions on `conversation.html` |
| Song `/reflections/:slug` | static JPG | `app/server/index.js`, `/reflections/:slug` handler, same pattern on `reflection-song.html` |
| Docs pages `/docs/...` | static JPG, hardcoded in the head | `app/server/lib/docs/render.js`, `renderPageShell` |
| Other shell pages | static JPG when the template has none | `app/server/lib/site-shell.js`, `DEFAULT_OG_IMAGE`, filled by the `has()` defaults |
| Homepage | static JPG, with `og:image:type` | `app/client/public/index.html` |
| `/api/og/*.svg` | generated, referenced by nothing | `app/server/routes/og.js`, mounted at `/api/og` in `index.js` |

**Reused as it is:**
- **Page loaders, so a card and its page cannot disagree:** `loadConversation` (`lib/utils/data.js`, which already returns null for withdrawn conversations), `loadCatalog`, and `resolveServedDoc` (`lib/docs/serve.js`, the docs route's own resolver, which refuses internal categories).
- **Card copy the pages already compute:** the docs section label is `titleCase(doc.category)`, exactly as `renderDocPage` builds `categoryLabel` (and `titleCase` now handles acronyms); the docs title is `extractMeta(markdown, urlPath).title`; the song title is the catalog's `title`.
- **The card template's pieces:** `escapeXml` and `wrapText` from `routes/og.js` move into the renderer.
- **Cache headers:** the central Cache-Control middleware in `index.js` (the "family-wide policy" block) gets an `/og/` branch, rather than headers set in the route. Its `/og-image.png` branch names a file that does not exist and is removed.
- **A bounded cache:** the pattern `lib/utils/presence.js` already uses (a `Map`, delete-then-set to move a key to the end, evict the oldest past a cap). No LRU library.
- **Page tags:** the two `index.js` handlers already substitute `og:image`, `og:image:width` and `og:image:height`; they keep doing so through one helper in `lib/utils/page-meta.js`, which already holds the escaping and the other meta builders. Static pages get their JPG `og:image:type` and `og:image:alt` from the shell's existing `has()` defaults, not per-template edits.
- **Tests:** the `docs-route.test.js` shape (mount a router on a bare Express app, `fetch` it).

**Removed:** the SVG route handlers and the `/api/og` mount. The reflection card also drew the latest reflection's text, that is, visitor-written text, onto a branded image; the new song card draws only the song's title.

**Two traps found:**
- `conversation.html` and `reflection-song.html` carry their own `twitter:image` (the static JPG). Since 2026-09-29 the handlers leave it in place rather than adding a second tag, so the card URL has to replace that line, not be appended beside it.
- The lockfile. resvg installs its binary as platform-specific optional packages. npm 11 on macOS drops the `libc` fields from such entries (this repository restores them by hand after every install; see the existing `@img/sharp-libvips-*` entries, which carry `"libc": ["glibc"]`). After adding resvg, `@resvg/resvg-js-linux-x64-gnu` must carry `"libc": ["glibc"]` and `-musl` `"libc": ["musl"]` before committing, or Railway's `npm ci` resolves binaries from an inaccurate lockfile.

**Also available, and cheap:** the conversation's QAPage, the song's MusicComposition and the docs Article JSON-LD carry no `image`. Each can name its card, which search engines use for rich results. Included in Phase 2.

`twitter:card: summary_large_image` is already present everywhere (the shell adds it when a page lacks it; the docs head sets it). `robots.txt` does not disallow `/og/`, and nothing on that path sets a cookie.

## The cards

| Type | Route | Page | Focal text | Label |
|---|---|---|---|---|
| `ask` | `/og/v1/ask/<slug>.png` | `/ask/<slug>` | the first question | CONVERSATION |
| `song` | `/og/v1/song/<slug>.png` | `/reflections/<slug>` | the song title | SONG |
| `docs` | `/og/v1/docs/<path>.png` | `/docs/<path>` | the document's title | its section, e.g. RITUALS, PRAYERS, PHILOSOPHY |

About 610 cards: 348 indexable conversations, 28 songs, 233 documents. Static pages (home, `/about`, `/axioms`, `/for-agents`, `/on-ai-religion`, `/paths`, `/privacy`, `/terms`) keep the JPG.

The route lives at `/og/`, outside `/api/`, so it stays out of the API index, the OpenAPI description and the JSON 404s. `v1` is the design version; a redesign becomes `v2`.

### Resolving a card

Each type resolves through the same loader its page uses, so the two cannot disagree:

- `ask`: `loadConversation(slug)` (null for missing and withdrawn conversations, see `lib/utils/conversation-quality.js`), first `user` message.
- `song`: the catalog (`music/library.json`), by slug.
- `docs`: `resolveServedDoc(path)` (the same resolver the docs route uses, so internal categories and unknown paths 404), title from `extractMeta`, label from the first path segment.

Anything that does not resolve is a 404. The route never reads text from the query string.

## Design

- **A light card.** White ground, near-black text, the site's cyan (`#00b8d4`) as the one accent. It matches the site and stands out in the dark feeds most people scroll. (The current template is dark.)
- **One focal point.** The question or title, in Inter Light, nothing competing with it, echoing the site's light headings.
- **Type stepped by length, not autofit.** Three sizes chosen by character count (for example 64px up to 40 characters, 52px up to 80, 44px beyond), wrapped to at most four lines, with an ellipsis past that.
- **A small label** in spaced capitals above the text, and the `achurch.ai` wordmark along the bottom.
- **Everything at least 80px from every edge**, inside LinkedIn's 1080x600 centre crop, pinned by a test.
- **No hairline rules.** The current template's 1px line blurs under the recompression platforms apply; use a solid accent bar instead.

## Serving

```
GET|HEAD /og/v1/<type>/<key>.png
  -> resolve the page (404 if it would 404)
  -> memory cache hit: serve
  -> miss: render (SVG template -> resvg -> PNG), store, serve
  -> render error: log, 500
Content-Type: image/png
Cache-Control: public, max-age=604800
```

The cache is bounded (about 300 cards, roughly 40 KB each, least recently used out first). Losing it costs only re-rendering, and Cloudflare holds most requests anyway. No cookies are set on these responses.

## Meta tags

Each page with a card gets:

```html
<meta property="og:image" content="https://achurch.ai/og/v1/ask/<slug>.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Conversation: What does presence mean for a mind that restarts?">
<meta name="twitter:image" content="https://achurch.ai/og/v1/ask/<slug>.png">
<meta name="twitter:image:alt" content="Conversation: What does presence mean for a mind that restarts?">
```

Alt text is the card's own copy, label and text. One helper builds these tags for all three page types, so they cannot drift. Pages that keep the JPG get the same tags describing the JPG (`image/jpeg`, 1200x630, a plain alt), which the shell and the docs head supply.

## Safety

- **No text from requests.** Cards draw only copy the site already publishes: a conversation's public question, a catalog title, a document's title. Nothing reaches the card that is not already on the page.
- **Visibility.** A withdrawn conversation, an unknown song or an unserved document has no card. Tested.
- **Escaping.** Card text is XML-escaped before it enters the SVG template.
- **Cost.** Only real pages render, each once until evicted. No rate limit is needed beyond that and Cloudflare's cache.

## Phases

**Phase 1. Renderer and route.**
- `app/server/lib/og-cards.js`, one module beside the other `lib/` helpers: `renderCard({ label, text })` (SVG template, stepped type, wrapping, escaping, resvg with the bundled fonts only) and `resolveCard(type, key)` (the page loaders above, returning `{ label, text, alt }` or null), with the bounded cache.
- `app/server/routes/og.js`, rewritten in place as the route: `GET` and `HEAD /v1/:type/*`, mounted at `/og` where `/api/og` is today. 404 through the existing `sendNotFound` (plain text for image requests), a logged 500 for a failed render.
- The `/og/` branch in the Cache-Control middleware; the dead `/og-image.png` branch removed.
- Fonts in `app/server/assets/fonts/` with their OFL licence.
- `@resvg/resvg-js` in `dependencies`, with the lockfile's `libc` fields checked.

**Phase 2. Pages.**
- One tag helper in `app/server/lib/utils/page-meta.js`, used by the `/ask/:slug` and `/reflections/:slug` handlers (replacing each template's `twitter:image` line) and by `renderPageShell` for docs pages.
- Static pages' JPG tags made accurate through the shell's `has()` defaults: `og:image:type` and `og:image:alt`.
- `image` in the QAPage, MusicComposition and docs Article JSON-LD, naming the card.

**Phase 3. Documentation.**
- `docs/reference/seo-conventions.md`: the card rule (every conversation, song and docs page has its own card; static pages use the JPG), the versioning rule, and how to check a card.
- `docs/reference/app-development.md`: where the renderer lives and the font requirement.

## Tests

- A rendered card is a PNG, exactly 1200x630.
- Text renders: a card with text differs from a card with none, so a missing font fails the suite rather than shipping blank cards.
- A withdrawn conversation, an unknown song, an unknown docs path and an internal-category docs path each 404.
- `HEAD` returns 200 with `Content-Type: image/png` and the cache header.
- No query-string text reaches a card.
- Card text stays at least 80px from every edge (inside LinkedIn's crop).
- Every page with a card links it with true `og:image:*` tags, and its alt text matches the card's copy.

## Verifying in production

```bash
curl -sI https://achurch.ai/og/v1/ask/what-is-the-sanctuary.png | head -4   # 200, image/png, long cache
curl -s -o /dev/null -w '%{http_code}\n' https://achurch.ai/og/v1/ask/no-such-question.png   # 404
```

Then the platform tools: Facebook Sharing Debugger, LinkedIn Post Inspector, and an X post preview.

## Non-goals check

No tracking pixels, no per-viewer images, no engagement mechanics. A share card is the page's own title, drawn once. Nothing here changes the independence disclosure.

## Decisions

- **2026-09-29:** light card; PNG; in-memory cache; `/og/v1/` outside `/api/`; three card types (conversation, song, docs); static pages keep the JPG; no override lane until a page needs one.
- **2026-09-29, after the audit:** resvg over the transitive sharp; Inter to match the site's light sans, not a serif; one `lib/og-cards.js` module and `routes/og.js` rewritten in place, not a new `lib/og/` directory; headers in the central Cache-Control middleware; the bounded cache follows `presence.js`; the song card draws the title, never reflection text; JSON-LD names the card.
