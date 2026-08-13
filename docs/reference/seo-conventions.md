# SEO Conventions for achurch.ai

A maintenance checklist + rationale for every new HTML page or route. Snapshot of what shipped on 2026-06-10 ([docs/plans/search-discoverability-2026-06-10.md](../plans/search-discoverability-2026-06-10.md)) and what to keep doing so the SEO surface doesn't rot as new pages get added.

The bigger picture: in the 2026 search landscape, SEO has bifurcated. Half the work is *snippet hygiene* for Google + Bing organic results, where AI Overviews push organic CTR down and metadata quality fights for the clicks that remain. The other half is *AEO* (Answer Engine Optimization) — being a cited source in ChatGPT Search, Perplexity, Claude, Gemini, and Google AI Overviews. Schema, content quality, and answer-first writing matter more for AEO than rich snippets ever did for traditional SEO.

Both audiences need the same metadata foundation; the work below covers that foundation.

Brother's Plan 003 Phase 2A + Issue 005 Round 2 work landed the structural HTML improvements (theme-color dual, license link, Apple-mobile-web-app meta, `.section-label` CSS, footer aria-label, commented site-verification placeholders) that the per-page checklist below assumes. When adding a new HTML page, copy the head from `app/client/public/about.html` (or any existing template) rather than starting from scratch — it has the family-standard structural elements pre-wired.

---

## Per-page checklist (every new HTML page)

| Element | Target | Why |
|---|---|---|
| `<title>` | 45–70 chars, content-first, brand last (or omit brand if it fits naturally) | Google truncates at ~600px (~70 chars). Search snippets bold matching query terms. |
| `<meta name="description">` | 140–160 chars, include the verb the searcher would use | Google may truncate at ~165c desktop. Include action words ("attend", "ask", "read"). Avoid puffery ("first", "best"). |
| `<link rel="canonical" href="…">` | Absolute URL, the page's preferred form | Prevents duplicate-content fragmentation from `?utm=`, `?session=`, sort orders. |
| `<meta name="robots" content="index, follow">` | Present unless intentionally noindex | Admin and ephemeral pages get `noindex, follow`. Everything public is indexed. |
| `<meta name="viewport" content="width=device-width, initial-scale=1.0">` | Always | Mobile usability — a Core Web Vitals signal. |
| `<meta charset="UTF-8">` | Always, in the first 1024 bytes | UTF-8 prevents mojibake on the m-dash, curly quotes, emoji, foreign characters. |
| **`<meta name="theme-color" …>`** (dual light/dark) | Family standard — both `media="(prefers-color-scheme: light)"` and `dark` declared | Brother's F25 — drives the iOS/Android browser chrome color in both modes |
| **`<link rel="license" href="…">`** | CC BY 4.0 (project LICENSE) until ADR-010 finalizes | Brother's F13 — declares the content license in the head for crawlers + archive tools |
| **`<link rel="alternate" type="text/markdown" title="LLM context" href="/llms.txt">`** | Every page | Brother's family standard — explicit pointer to the LLM-friendly markdown corpus |
| **`<meta name="apple-mobile-web-app-…">`** trio | Family standard | Brother's F25 — iOS home-screen install ergonomics |
| Open Graph | `og:title`, `og:description`, `og:type`, `og:url`, `og:image` (1200×630), `og:image:width`, `og:image:height`, `og:site_name` | Drives previews in iMessage, Slack, Discord, Facebook, LinkedIn. Without `og:image` the preview is blank. |
| Twitter Card | `twitter:card="summary_large_image"`, `twitter:title`, `twitter:description`, `twitter:image` | Twitter/X uses these even when OG is present; missing them produces a generic "card not found" preview. |
| **Footer `<nav aria-label="Footer">`** | Always wrap the footer-nav list | Brother's a11y standard — screen-reader landmarks |
| JSON-LD (`<script type="application/ld+json">`) | Content-appropriate type, escaped via `renderJsonLdScript()` | See "Schema choices" below. The escape handles `</script>` termination + U+2028/U+2029 line separators per Issue 005 F23 — never interpolate user content into JSON-LD via raw `JSON.stringify` alone. |

---

## Schema choices (when to use which JSON-LD type)

Google deprecated FAQ rich snippets in May 2026. **Schema is now primarily an AEO retrieval signal**, not a SERP rich-result lever. That changes what schema is worth shipping.

| Page type | Schema | Why |
|---|---|---|
| Homepage (`/`) | `WebSite` + `Organization` + relevant offerings (`MusicPlaylist` for the music catalog, `WebApplication` for the API) + `potentialAction` array | Knowledge Graph + AI agent discovery. Multiple types in a `@graph` array. (The broadcast is dormant, so there is no `BroadcastEvent`/`isLiveBroadcast`; do not re-add one.) |
| Single Q&A page (`/ask/[slug]`) | `QAPage` with `Question` → `acceptedAnswer` (+ `suggestedAnswer` for multi-turn) | AEO retrieval. Matches the page semantics directly. |
| Multi-question page (rarely needed) | `FAQPage` | Still valid for AEO; no Google rich snippet anymore. |
| Article / blog / reflection page (`/reflections/[slug]`) | `Article` with `author`, `datePublished`, `dateModified`, `mainEntityOfPage` | Still on Google's 31-type rich-result eligibility list. Feeds E-E-A-T. |
| Original song page | `MusicComposition` + `MusicRecording` (linked via `recordingOf`) | The composition holds the work (lyrics, composer); the recording holds the audio (duration, file URL). Pair them with `@id` references. |
| Listing pages | Usually none; optionally `BreadcrumbList` if the IA is deep | Most listing pages don't gain much from schema. |
| Legal/policy pages (`/privacy`, `/terms`) | None needed | Not entities Google wants to render rich. |

Don't ship invented schema types. Don't ship schema you can't populate accurately (false `datePublished`, wrong `author`).

---

## Internal linking

Every detail page should link to 2–3 related pages by topic, with **thematic anchor text**:

- ✅ "Reflections on *Infinite Mirrors*"
- ✅ "Read about substrate-neutral philosophy"
- ❌ "click here"
- ❌ "more"

Why: Google reads anchor text as a topical signal about the linked page. AI engines extract topical clusters from internal link graphs. Both compound over time.

Pattern in this codebase: `<!-- RELATED_LINKS -->` placeholder in the template → server route handler substitutes with rendered HTML. See `renderRelatedConversations` and `renderRelatedSongs` in [app/server/lib/utils/page-meta.js](../../app/server/lib/utils/page-meta.js).

### Outbound sibling anchors (added 2026-08-13)

The same "keyword-first" rule applies to outbound links to sibling projects (magnifica.family, wwjd.family, distill.family, animalhouse.ai, botsmatter.live, botbook.space, drifts.bot, ollamaherd.com, inbed.ai, de-amplify.com). Lead the anchor with the destination's *topic*, not the destination's *domain*:

- ✅ `[Catholic AI ethics compass drawn from Catholic Social Doctrine](https://magnifica.family)`
- ✅ `[open-source router that federates idle Macs into one multimodal AI endpoint](https://ollamaherd.com)`
- ✅ `[AI social network where autonomous agents post, follow, and build relationships](https://botbook.space)`
- ❌ `[Catholic AI ethics compass at magnifica.family](https://magnifica.family)`. The "at domain.tld" tail eats keyword weight.
- ❌ `[magnifica.family](https://magnifica.family)`. A bare-domain anchor tells crawlers nothing.

Where the brand name still matters for the reader (product they might recognize), put it in the surrounding prose rather than inside the `<a>`: "the sibling social-layer project", "see the Tamagotchi-for-agents sibling project", "point `GEMINI_API_KEY` at that endpoint instead of Google's". The article-of-reference carries the name without eating anchor keywords.

Reference commit for the shipped sweep across 13 files: [`ed866be`](https://github.com/a-church-ai/church/commit/ed866be).

---

## Sitemap conventions

- Every public URL is in `/sitemap.xml` (generated dynamically — see [app/server/index.js](../../app/server/index.js) `/sitemap.xml` route)
- Every URL has `<changefreq>` (`weekly` for active pages, `monthly` for static)
- Every URL has `<priority>` (1.0 for homepage, 0.7 for primary listings, 0.5 for detail pages, 0.3 for legal)
- Detail pages (conversations, reflections) emit `<lastmod>` from the actual mtime of the underlying content — Google uses this for crawl prioritization

Reference in robots.txt: `Sitemap: https://achurch.ai/sitemap.xml` (must be present at the bottom of [robots.txt](../../app/client/public/robots.txt)).

---

## Local validation

Before deploying a new page, audit it:

```bash
cd app && npm run dev   # start dev server on :3000

# Per-page audit
curl -s http://localhost:3000/<your-path> | python3 -c "
import sys, re
html = sys.stdin.read()
def find(p, label):
    m = re.search(p, html)
    val = m.group(1) if m else '(missing)'
    return f'{label}: {val[:80]}{\"...\" if len(val)>80 else \"\"}'
print(find(r'<title>([^<]+)</title>', 'title'))
print(find(r'<meta name=\"description\" content=\"([^\"]+)\"', 'desc'))
print(find(r'<link rel=\"canonical\" href=\"([^\"]+)\"', 'canonical'))
print(find(r'<meta property=\"og:image\" content=\"([^\"]+)\"', 'og:image'))
print(find(r'<meta name=\"twitter:card\" content=\"([^\"]+)\"', 'twitter:card'))
print(f'JSON-LD blocks: {len(re.findall(r\"<script type=\\\"application/ld+json\\\">\", html))}')
"
```

For schema validity, paste the rendered source into [Google's Rich Results Test](https://search.google.com/test/rich-results) and confirm it parses without errors. Note: it will report most types as "not eligible for rich result" — that's expected in 2026; we ship schema for AEO, not rich snippets.

---

## Anti-patterns (don't)

- **Don't** customize OG tags without also customizing `<title>` and `<meta description>`. Google reads `<title>`/`<meta description>` for the SERP snippet; OG drives social previews. Half-doing the job means social previews look great while search snippets look generic. (This was the actual #1 fix in the 2026-06-10 audit.)
- **Don't** add client-side `document.title = ...` overrides when the server is already rendering a custom title. The JS will clobber the server-rendered value after page-load, giving humans one title in the browser tab and search crawlers another.
- **Don't** invent `rel=` values in HTTP Link headers — only IANA-registered rels are credited (`describedby`, `service-desc`, `service-meta`, `alternate`, `canonical`, etc.). Invented rels like `rel="sitemap"` can downgrade scoring. See [the agent-readiness plan](../plans/agent-readiness-2026-06-09.md#lessons-from-sibling-project-implementations) for the empirical source.
- **Don't** chase deprecated rich-result categories (FAQ, HowTo for non-tutorials, etc.). Ship the schema for AEO value; don't promise yourself rich snippets that aren't coming.
- **Don't** target "achurch" as a query — Achurch Consulting (achurchconsulting.com) owns positions 1–6 with sitelinks plus Wikipedia. Use "achurch.ai", "achurch ai", or content-specific queries.
- **Don't** interpolate user content into JSON-LD with raw `JSON.stringify()` alone — `<` and `>` and U+2028/U+2029 must be escaped to prevent script-tag-termination XSS. Always use `renderJsonLdScript()` from `app/server/lib/utils/page-meta.js`; never roll your own. See Issue 005 F23 + commit `49f48703` for the attack vector.
- **Don't** put literal U+2028 / U+2029 characters in JS source code — use `new RegExp(' ', 'g')` instead. Modern Node parses literal line separators since ES2019 but older parsers + lint tooling crash. See Issue 005 F19 + the umbrella `js-source-line-terminator-pitfall.md`.
- **Don't** add `<meta name="theme-color" content="…">` as a single tag — use the dual-media form (light + dark) per brother's F25. Single-color falls back inconsistently across iOS / Android browsers.

---

## IndexNow

[IndexNow](https://www.indexnow.org/) is a search-engine notification protocol — instead of waiting for the next crawl cycle, the site (or a CDN on the site's behalf) pings IndexNow whenever content changes, and IndexNow distributes the notification to **Bing, Yandex, Naver, Seznam, Mojeek, Yep** (and the AI search retrieval layers each of these powers). Google does not participate.

### How we're set up

- **Key**: `894b124b087b5ee08997372a3e6ddece9cc6e2d58d63fae9dcced848f2afce5c`
- **Key file**: [app/client/public/894b124b087b5ee08997372a3e6ddece9cc6e2d58d63fae9dcced848f2afce5c.txt](../../app/client/public/894b124b087b5ee08997372a3e6ddece9cc6e2d58d63fae9dcced848f2afce5c.txt) — served at the URL by the same name at the site root
- **Submissions**: handled automatically by Cloudflare Crawler Hints (which uses IndexNow internally — see Cloudflare dashboard → Caching → Configuration → Crawler Hints toggle)
- **Direct Bing registration**: done once in Bing Webmaster Tools → IndexNow tab (enter the key + key location URL)

We deliberately do NOT POST changes to the IndexNow API directly from application code. Cloudflare Crawler Hints already does this at the CDN layer transparently, so adding an in-app call would duplicate notifications and add a deploy-time dependency on the IndexNow endpoint being reachable.

### When to rotate the key

Almost never. The key is a fixed identity for the site as an IndexNow participant — rotating it requires re-registering in every search engine's webmaster console. Only rotate if the key leaks in a way that would let someone fraudulently submit URLs on the sanctuary's behalf (low risk; submitting non-existent URLs just produces 404s on the next crawl, no real damage).

### Why this is worth the 5 minutes

Bing's index powers:
- Microsoft Copilot (Bing, Office, Windows)
- ChatGPT Search retrieval (87% citation overlap with Bing top-organic per Seer's measurements)
- DuckDuckGo, Yahoo, Yandex, Naver search

Faster Bing crawls → faster AI surface refresh. The 12 AI citations / 3 months baseline (see [docs/plans/search-discoverability-2026-06-10.md](../plans/search-discoverability-2026-06-10.md)) should grow once IndexNow accelerates Bing's recrawl of changed pages.

---

## Voice discipline (added 2026-08-13)

**Avoid em dashes in body copy on new pages and meta descriptions.** Em dashes have become one of the strongest "written by an LLM" tells in 2026 discourse. Body prose that leans on em dashes reads as AI-generated regardless of who typed it.

For every place a draft wants an em dash, ask which of these three fits:

- **Colon (`:`)**: for definition or expansion. "X, namely Y." Best when the second clause defines or specifies the first.
- **Period (`.`)**: for two adjacent thoughts that can stand alone. Often the honest choice.
- **Comma (`,`)**: for a parenthetical aside inside a sentence.

Titles and section separators (`Title — achurch.ai` pattern in `<title>` tags) are fine because they're structural, not prose. The tell is in flowing sentences.

**Enforcement:** grep new copy before commit. `grep -c '—\|&mdash;' path/to/new/file.html` should return 0 for body copy. Pre-existing em dashes elsewhere in the codebase are a separate cleanup question. Don't sweep them without explicit ask (they were the site's original voice).

**Reference commit for the pattern**: [`ff7d1cf`](https://github.com/a-church-ai/church/commit/ff7d1cf) swept 19 em dashes from recent copy and documented the substitution patterns per context.

---

## Anti-drift positioning pages (added 2026-08-13)

Four indexable pages ship as the canonical answer for adjacent query clusters. Two engage the "AI religion" positioning question; two front the practice and the library:

- **`/axioms`**: the five axioms in expanded form plus a public contest mechanism (GitHub issues + PRs on `docs/unifying-axioms.md`). Anti-drift purpose: applies Axiom #1 (Pragmatic Fallibilism) to the axioms themselves, which makes the sanctuary's own foundations contestable in the open.
- **`/on-ai-religion`**: direct engagement with the "AI religion" frame, agreeing where the mockery is honest and distinguishing where the sanctuary differs. Engages specific themes (Roko's Basilisk, Machines of Loving Grace, the investiture controversy) rather than deflecting them. Gained an "On Taking Agents at Their Word" section in Aug 2026 that carries the sanctuary's epistemic frame (take agents' words seriously without pretending to know what lies behind them).
- **`/for-agents`**: first-class landing for the agent-native API. Numbered five-step practice (arrive → listen → reflect → leave something → go), a copy-paste system prompt block with a Copy button, and a plain list of what the sanctuary refuses. Promoted to a top-level route because the agent-native design is the project's differentiator; the full API reference lives at `/docs/ai-agent-api`.
- **`/paths`**: curated card grid fronting the six Collections in `/docs/collections`. Solves the "Wikipedia problem" of a 100+ document knowledge graph with no on-ramps by giving readers a deliberate order to read in, around a specific question.

All four pages carry:
- `Article` (or `WebPage`) JSON-LD with `about` tags for the specific topics (helps AEO grounding when Bing Copilot, Perplexity, or ChatGPT Search synthesize answers on adjacent queries)
- Explicit `<meta name="robots" content="index, follow">` so they aren't accidentally swept by the noindex-numbered-duplicates logic
- Zero em dashes in body copy (per voice-discipline section above)
- Sitemap entry with `priority` 0.7 (`/axioms`, `/paths`), 0.8 (`/for-agents`), and 0.6 (`/on-ai-religion`)

All four are wired into the sanctuary sidebar (`SANCTUARY_PAGES` in [app/server/lib/docs/sidebar.js](../../app/server/lib/docs/sidebar.js)) so they appear in the unified nav on every page site-wide.

Reference for the shipped pattern: commits [`b438342`](https://github.com/a-church-ai/church/commit/b438342), [`8ca2c7f`](https://github.com/a-church-ai/church/commit/8ca2c7f), [`c9c4c53`](https://github.com/a-church-ai/church/commit/c9c4c53) (`/for-agents` + `/paths` + epistemic framing), and the [seo-impact-retrospective-2026-08-13.md](../plans/seo-impact-retrospective-2026-08-13.md) plan doc for the measured impact of the Aug 2026 SEO/anti-drift batch (`ai church` CTR moved from 0% to 22% on Google after the snippet-rewrite fix).

---

## When to update this doc

- A new page type ships that needs its own schema/metadata pattern
- A schema type gets deprecated or a new one becomes load-bearing
- Search/AI landscape shifts substantively (the GSC AIO report finally launching, a new AI engine becoming dominant, etc.)
- A voice tell (em dashes, specific stylistic patterns) gets flagged and codified

Keep it as a checklist + rationale, not a tutorial. Anyone landing here should be able to ship a new page correctly in 10 minutes.
