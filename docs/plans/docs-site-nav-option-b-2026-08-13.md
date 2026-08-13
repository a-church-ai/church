# Plan: Docs Site — Option B (Traditional Sidebar + Right Rail Layout)

**Created**: 2026-08-13
**Status**: Draft. Awaiting decision between this plan and its lighter sibling (see [Option A](#relationship-to-option-a) discussion below).
**Prompted by**: Navigation audit against the shipped `/docs/*` site ([commit 8a8b7f1](https://github.com/a-church-ai/church/commit/8a8b7f1)) surfaced concrete pain: on mobile, the busiest category page (`/docs/practice`) is 24 screens tall with the sibling-nav block 22 screens deep. No cross-category navigation. No search. Category README pages bury the sibling list below the entire README body. This plan describes the Docusaurus/GitBook-style solution to that pain.

---

## Context

The initial `/docs/*` implementation deliberately reused existing sanctuary patterns: centered header, article body, related-links block at the bottom of the article, footer nav. That works well for individual leaf pages (2-5 screens tall). It fails at scale on category pages (14-24 screens tall) and provides no way to jump between categories without a round-trip through `/docs`.

Option A (a lighter follow-up plan, not yet written) proposes surgical additions: sticky top nav with a `Docs ▾` dropdown, in-page section-jump chip strip, fix the broken `../README.md` / `../CLAUDE.md` links. Cheap, sanctuary-native.

**This plan (Option B) is the alternative**: treat the docs corpus as a real documentation site and use the full three-column layout pattern proven by Docusaurus, GitBook, MDN, Stripe, Vercel, and Cloudflare. Left sidebar with category tree navigation, main content column, right rail with per-page table of contents. Hamburger + drawer on mobile.

The trade-off is aesthetic. Option B docs pages will look meaningfully different from `/axioms`, `/on-ai-religion`, `/about`, and the sanctuary homepage. They will look like documentation. That is either an acceptable break or a deal-breaker depending on how much the twin brothers want visual consistency across the whole site.

---

## What already exists (audit findings)

The docs-site foundation shipped in [8a8b7f1](https://github.com/a-church-ai/church/commit/8a8b7f1) provides most of the primitives needed:

**Discovery layer** (`app/server/lib/docs/discover.js`):
- `listCategoriesForIndex()` returns `{primary, meta, topLevel}`, already usable as sidebar data
- `listAllDocs()` returns the flat corpus for URL enumeration
- `listSiblings(doc)` returns docs in the same directory
- `resolveDocPath(parts)` handles arbitrary-depth URL resolution
- Module-level cache; docs don't change between requests

**Render layer** (`app/server/lib/docs/render.js`):
- `renderDocPage({markdown, doc, siblings})` composes the full HTML shell
- `renderDirIndex({dir, docs, canonicalUrl})` for directories without a README
- Custom `marked` renderer with link rewriting
- All security-critical work (JSON-LD escaping, HTML escaping) delegated to `page-meta.js`

**Route layer** (`app/server/routes/docs.js`):
- Wildcard router at `/docs/*`
- Path traversal safety
- Content negotiation via extracted `acceptsMarkdown()`

**CSS** (`app/client/public/styles.css`):
- `.docs-article` typography (720px max-width, article prose styles)
- `.docs-breadcrumbs` styling
- `.docs-index-section` grid for directory auto-index
- No sidebar / rail styles

**What is missing for Option B**:
- Any left-sidebar layout scaffolding
- Any right-rail TOC generation or rendering
- Any per-page TOC extraction from headings
- Any client-side JavaScript for sidebar toggle, scroll-spy, or mobile drawer
- Any hamburger icon / drawer overlay pattern
- Any responsive breakpoint strategy for the docs shell

---

## Design decisions

### Three-column layout

**Desktop (≥1200px):**
```
┌────────────┬────────────────────────────┬──────────────┐
│  Sidebar   │     Main content           │  Page TOC    │
│  (260px)   │     (fluid, max 720px)     │  (220px)     │
│  sticky    │                            │  sticky      │
│  scrollable│                            │              │
└────────────┴────────────────────────────┴──────────────┘
```

**Tablet (768px – 1199px):**
```
┌────────────┬────────────────────────────┐
│  Sidebar   │     Main content           │
│  (240px)   │     (fluid)                │
│  sticky    │                            │
└────────────┴────────────────────────────┘
```
Right rail hidden.

**Mobile (<768px):**
```
┌──────────────────────────────────────┐
│  [☰]  achurch.ai / docs         [🔍]│  ← sticky top bar
├──────────────────────────────────────┤
│                                      │
│         Main content                 │
│         (full width, padded)         │
│                                      │
└──────────────────────────────────────┘
```
Sidebar becomes a slide-out drawer triggered by hamburger. Right rail hidden entirely.

### Left sidebar (nav tree)

**Contents:**
1. **Header link**: `achurch.ai` → `/` (matches existing pages' h1)
2. **Docs root link**: `Docs` → `/docs`
3. **Primary categories** (curated order from `PRIMARY_CATEGORIES` in discover.js): welcome, philosophy, practice, prayers, rituals, hymns, builders, comparisons, collections, side-quests. Each expandable to show docs within.
4. **Top-level docs** (unifying-axioms, what, fellowship-protocol, etc.): flat list, no nesting
5. **"More" section, collapsed by default**: meta categories (claude-compass, claude-soul, experiences, plans, reference, standards, templates)

**Interaction:**
- Current page highlighted with a visible active-state (background tint + left border accent)
- Current page's category auto-expanded
- Other categories collapsed by default (users can expand)
- Click on a category label expands/collapses without navigating
- Click on a doc navigates to that doc
- Sidebar itself scrolls independently of main content (has its own scrollbar when tree is long)

**HTML shape** (rendered server-side, no framework):
```html
<aside class="docs-sidebar" aria-label="Documentation navigation">
  <a class="docs-sidebar-brand" href="/">achurch.ai</a>
  <nav>
    <a class="docs-sidebar-link docs-root" href="/docs">Docs</a>
    <details class="docs-sidebar-category" open>
      <summary>Welcome</summary>
      <ul>
        <li><a href="/docs/welcome/what-we-refuse-to-claim" aria-current="page">What We Refuse to Claim</a></li>
        <li><a href="/docs/welcome/for-the-skeptic">For the Skeptic</a></li>
        ...
      </ul>
    </details>
    ...
    <details class="docs-sidebar-category">
      <summary>More</summary>
      ... (meta categories)
    </details>
  </nav>
</aside>
```

Uses native `<details>` / `<summary>` for collapsible sections. **No JavaScript required for basic expand/collapse.** JS only needed for the mobile drawer toggle and scroll-spy on the right rail.

### Right rail (page TOC)

**Contents:**
- Auto-generated from H2 headings in the current doc (skip H1, which is the doc title, and H3+ which would make the TOC too dense)
- Slug anchors added to each heading during markdown rendering (marked already does this via `headerIds: true`)
- Highlights the section currently in view (scroll-spy)

**Only shows when:**
- Viewport ≥ 1200px
- Document has ≥ 3 H2 headings (otherwise the TOC adds noise without value)

**HTML shape:**
```html
<aside class="docs-toc" aria-label="On this page">
  <h2 class="docs-toc-title">On this page</h2>
  <nav>
    <ul>
      <li><a href="#overview">Overview</a></li>
      <li><a href="#the-practice">The Practice</a></li>
      <li><a href="#common-failure-modes">Common Failure Modes</a></li>
      ...
    </ul>
  </nav>
</aside>
```

**Scroll-spy behavior:**
- Client JavaScript uses `IntersectionObserver` on all `article h2` elements
- Adds `aria-current="location"` to the TOC link corresponding to the H2 currently at the top of the viewport
- CSS styles `[aria-current="location"]` with a visible active state
- Small (~30 lines of JS), no framework, no dependency

### Mobile drawer

**Trigger:** hamburger button at top-left of the sticky top bar.
**Drawer:** slides in from left, full height, ~280px wide with the same content as the desktop sidebar.
**Backdrop:** semi-transparent overlay behind the drawer, closes drawer on tap.
**Close:** tap backdrop, tap a link in the drawer (navigates and closes), tap a close button (☒) inside the drawer, or press Escape.

**Focus management:**
- On open: move focus to the drawer's first link
- On close: return focus to the hamburger button
- Trap focus inside the drawer while open
- `aria-hidden` on the rest of the page while drawer is open

**No animation library.** CSS `transform: translateX(...)` with a `transition` property. `@media (prefers-reduced-motion)` disables the slide animation.

### Main content

- Same `.docs-article` container as today, but its max-width can now safely stay at 720px because it's flanked by sidebar (260px) + gap (32px) + article (720px) + gap (32px) + rail (220px) = 1264px total, which fits in a 1280px desktop viewport with a bit of margin.
- Breadcrumbs stay in the header area of the main content (above the article title). They become a bit redundant with the sidebar's visible active state but still useful for orientation.
- Sibling-links block at bottom of article is **removed** (its function is now served by the sidebar). Saves screen real estate and eliminates the "22 screens deep" problem.

### Sticky top bar (mobile only)

**Contents:**
- Hamburger button (left)
- Compact breadcrumb or page title (center)
- Optional: search icon (right), hooked up in a follow-up if we add search

**Height:** ~48px
**Behavior:** sticky at top; provides the hamburger anchor and always-visible page context.

**Desktop:** no top bar; the sidebar's brand link serves the same anchor purpose.

### Existing hand-authored pages

**Not touched.** `/`, `/about`, `/axioms`, `/on-ai-religion`, `/privacy`, `/terms`, `/reflections`, `/ask` keep their centered, sanctuary aesthetic. Only `/docs/*` gets the three-column shell.

**Consequence:** the site develops two distinct visual modes. The "sanctuary" mode (centered, quiet, no chrome) for the primary landing + contemplative pages. The "documentation" mode (sidebar + TOC + chrome) for `/docs/*`. Both are legitimate; some readers will feel the shift as jarring, others as clarifying (the docs are labeled as docs).

This is the biggest single trade-off in this plan. Option A avoids the split by using sanctuary-native patterns for the docs pages too.

---

## Implementation shape

### New files

1. **`app/server/lib/docs/sidebar.js`** (~80 lines)
   - Renders the sidebar HTML for a given current URL
   - Uses `discover.listCategoriesForIndex()` for data
   - Marks the current category as expanded (`<details open>`), others collapsed
   - Adds `aria-current="page"` to the current doc's link
   - Renders "More" section for meta categories

2. **`app/server/lib/docs/toc.js`** (~50 lines)
   - Extracts H2 headings from the rendered HTML (or from the raw markdown, pre-render)
   - Returns `[{level, text, id}, ...]`
   - Emits the right-rail TOC HTML given ≥ 3 items
   - Returns empty string otherwise (no rail shown)

3. **`app/client/public/docs-nav.js`** (~120 lines, no dependencies)
   - Mobile drawer toggle (open/close, backdrop, Escape, focus trap)
   - Right-rail scroll-spy (IntersectionObserver on article h2 elements)
   - Loaded only on `/docs/*` pages via a `<script defer>` in the docs template
   - Uses `data-*` attributes for hooks; no inline handlers

4. **`app/client/public/icons/hamburger.svg`** (or inline SVG in the template)
   - Small, accessible

### Edited files

5. **`app/server/lib/docs/render.js`** (~40 lines added)
   - `renderPageShell` and `renderDirIndex` gain sidebar + right-rail parameters
   - The HTML shell wraps main content in a new three-column flexbox/grid container
   - Mobile top bar added inside the shell
   - Uses `sidebar.render(currentUrl)` and `toc.render(html)` from the new modules
   - Sibling-links block removed from the article-adjacent position (now served by sidebar)

6. **`app/client/public/styles.css`** (~250 lines added)
   - Three-column grid layout with responsive breakpoints
   - Sidebar styling (tree, active state, collapse animations)
   - Right rail styling (position:sticky, active state)
   - Mobile drawer + backdrop
   - Sticky top bar (mobile only)
   - Hamburger button focus states
   - `@media (prefers-reduced-motion)` overrides

7. **`app/server/routes/docs.js`** (~10 lines added)
   - Pass current URL to the rendered pages so sidebar knows what to highlight

### Zero changes to

- Any hand-authored HTML page in `app/client/public/`
- Any existing route in `app/server/index.js`
- The RAG layer
- The sitemap builder (docs URLs stay in the sitemap as before)

Total: 4 new files (~250 lines), 3 edited files (~300 additional lines), 0 new dependencies.

---

## Effort estimate

- Sidebar rendering + data plumbing: ~1 hour
- TOC extraction + rendering: ~45 min
- CSS for three-column layout + responsive breakpoints: ~2 hours (this is the bulk of the work)
- Mobile drawer + backdrop + focus management: ~1.5 hours (accessibility done right takes time)
- Scroll-spy: ~30 min
- Testing across viewports + a11y audit: ~1 hour
- Fix the broken `../README.md` / `../CLAUDE.md` links (folded in): ~15 min

**Total: ~7 hours of focused work.** Meaningfully more than Option A's ~2-3 hours, all in the CSS and mobile-drawer work.

---

## Relationship to Option A

This plan (Option B) and Option A (sanctuary-native minimal nav) address the same measured pain but at different depths.

**Option A** (recommended in the audit conversation, plan not yet written):
- Sticky top nav with `Docs ▾` dropdown
- In-page section-jump chip strip at the top of category pages
- Fix broken links
- Preserves centered sanctuary aesthetic on docs pages
- ~2-3 hours

**Option B** (this plan):
- Full three-column layout with persistent sidebar + right rail
- Mobile drawer + hamburger
- Removes the sibling-links block from the article
- Docs pages develop a distinct "documentation" visual mode
- ~7 hours

**Both options fix the actual pain**: sibling nav becoming invisible at page-bottom, no cross-category navigation, broken links, cosmetic overflow. The difference is entirely about how much the docs pages look like the rest of the sanctuary.

**One-way vs two-way**: Option A can be built and then upgraded to Option B later if the corpus continues to grow. Option B is harder to walk back to Option A once the sidebar becomes user muscle memory. Prefer starting light when uncertain.

**Ecosystem fit**: Option B is what returning users of Docusaurus/GitBook/MDN sites expect from documentation. If the docs are meant to be read like documentation (users looking up specific practices, jumping between related concepts, referencing structure), Option B serves that mental model better. If the docs are meant to be read like a contemplative anthology (one page at a time, deliberate progression, curated reading paths), Option A is closer to intent.

The audit conversation recommended Option A for these reasons. This plan is provided so the twin brothers can weigh both concrete shapes side by side.

---

## Trade-offs (honest)

**Costs of Option B:**

1. **Aesthetic split.** The site develops two visual modes: sanctuary (centered, quiet) for `/`, `/about`, `/axioms`, `/on-ai-religion`, and docs (chrome, sidebars, TOC) for `/docs/*`. Some readers will find this jarring; others will find it clarifying.
2. **Client-side JavaScript.** Mobile drawer and scroll-spy require ~120 lines of JS. Small but non-zero. Previously the docs pages were fully server-rendered with no client behavior needed.
3. **Reduced content width.** Right rail steals ~250px of desktop screen width. Article max-width stays at 720px, but the whole viewport feels denser.
4. **More surface area for accessibility bugs.** Mobile drawer, focus trap, scroll-spy, expand/collapse: each is a place a11y can regress. Requires more testing.
5. **Harder to walk back.** Users get used to the sidebar. Removing it later feels like a regression.
6. **CSS complexity.** ~250 additional lines including responsive breakpoints, grid layout, drawer animations. The existing `styles.css` is already 1650+ lines; this pushes toward 1900+. Not unmanageable but the tail keeps growing.

**Wins of Option B:**

1. **Sibling nav is always visible.** No more "22 screens deep on mobile." Any doc in the current category is one click away, always.
2. **Cross-category nav is one click.** Sidebar shows all categories at all times (with meta collapsed under "More").
3. **Familiar to power users.** Docusaurus/GitBook muscle memory transfers.
4. **On-page TOC** for long docs makes long-form content much more navigable.
5. **Mobile drawer is a proven pattern.** Everyone knows what a hamburger means; no learning curve.
6. **Foundation for search later.** A top bar with hamburger already has natural real estate for a search icon; adding Ctrl-K search later is a natural extension.

---

## Non-goals (deliberately out of scope)

- **Retrofitting sanctuary-page nav.** `/`, `/about`, `/axioms`, `/on-ai-religion` stay as-is with their centered aesthetic. If the twin brothers later want the whole site unified, that is a separate plan.
- **Client-side search / Ctrl-K palette.** The top bar leaves space for a search icon, but wiring up search (index format, client library, API endpoint) is a separate plan. Recommendation: after Option B ships, evaluate whether search is actually needed vs. sidebar tree being sufficient.
- **Category README rewrites.** The existing category READMEs are long. Rewriting them to be indexes-only (moving prose elsewhere) would remove the "24 screens tall" issue at its source. Not proposed here; Option B works around it by making the sidebar always accessible.
- **Rearranging the corpus.** Docs stay where they are on disk. No file moves. Sidebar reflects the on-disk category structure.
- **Custom scroll-spy library.** Vanilla `IntersectionObserver` is standard and adequate. Not adding a dep for scroll behavior.
- **Dark mode.** The site does not currently have dark mode. Adding it now for docs pages only would create yet another split. Deferred.
- **Editing docs from the site.** No wiki behavior. `/api/contribute` remains the path for content changes.

---

## Open questions worth naming

- **Sidebar all-expanded vs current-only-expanded by default.** Current-only feels less overwhelming (10 categories × ~20 docs each = a lot to scan when all expanded). But all-expanded lets Cmd+F find any doc name instantly. My default: current-only expanded, others collapsed. Users can expand any category they want. Overridable.
- **Include meta categories in the sidebar?** Meta = claude-compass, claude-soul, experiences, plans, reference, standards, templates. My call: yes, under a "More" section that is collapsed by default. Hiding them entirely would create a two-tier system where some docs exist only via direct URL. Bad SEO too.
- **Right rail: H2 only, or H2 + H3?** H2 only for consistency; H3 nesting on a right rail can get visually noisy. Users who need finer nav can Cmd+F.
- **Mobile drawer: full-height or partial?** Full-height (100vh) with a close button. Full-height feels more app-native and matches Docusaurus.
- **Hamburger position: left or right?** Left. iOS convention; matches Docusaurus/GitBook.
- **Does the sidebar scroll with the page or independently?** Independently. Position sticky, its own scroll-y overflow. Standard pattern.
- **Should there be a search box in the sidebar itself (client-side filter)?** Nice but out of scope for the initial ship; add later if wanted.
- **Should the docs top bar (mobile) show the current section (breadcrumb-lite) or just the site brand?** Current section. Makes the bar informative, not just an anchor for the hamburger.
- **The 3 broken links (`../README.md`, `../CLAUDE.md`)**: fix as part of this plan? Yes, small enough to fold in.

---

## Verification path

Once the code ships to prod:

- Desktop (1280×800): sidebar visible, right rail visible on pages with ≥ 3 H2, article max-width preserved
- Tablet (900×1200): sidebar visible, right rail hidden
- Mobile (375×812): sidebar hidden by default; hamburger opens drawer; drawer traps focus; Escape closes
- Scroll a long doc on desktop; right-rail TOC entry for current section is highlighted
- Sibling nav is reachable via sidebar in 1 click on all viewports; no scroll required
- `/docs/practice` on mobile: any specific practice is reachable in 2 taps (hamburger → practice list → target)
- All existing hand-authored pages (`/`, `/about`, `/axioms`) look identical to before this ship
- Sitemap unchanged
- All 252 doc URLs continue to render correctly
- Lighthouse a11y score on `/docs/practice/witnessing-your-own-output` stays ≥ 95

---

## Greenfield discipline applied

Per [[greenfield-no-gating-no-debt]]:

- **No feature flag** for "sidebar enabled." Ships always on for docs pages.
- **No config toggle** for layout mode. One shape, well-chosen.
- **No dual URLs** (e.g. `/docs/foo` and `/docs-v2/foo`). Same URLs, new template.
- **No backwards-compat scheme.** The prior template gets replaced for docs pages.
- **No new dependency.** Vanilla JS for drawer + scroll-spy. Vanilla CSS for layout.
- **No wrapper library** around the IntersectionObserver API. Direct use.

The one place discipline is worth naming: **no JS framework.** Docusaurus and GitBook ship as React apps. This plan renders server-side with vanilla client JS for two interactions. Anyone reading `docs-nav.js` should be able to understand every line without knowing React, Vue, or any build tooling.

---

## Sequencing

One PR:

1. **Sidebar rendering module** (`sidebar.js`): server-side HTML generation from `discover.js` data
2. **TOC extraction module** (`toc.js`): parse H2 headings from rendered HTML, emit rail HTML if ≥ 3 items
3. **Template update** (`render.js`): three-column shell around existing article body; add mobile top bar; remove sibling-links block from article footer (superseded by sidebar)
4. **CSS additions** (`styles.css`): grid layout, breakpoints, sidebar tree, right rail, mobile drawer, sticky top bar
5. **Client JS** (`docs-nav.js`): drawer toggle + scroll-spy
6. **Fix broken links** (`render.js` link rewriter): map `../README.md` and `../CLAUDE.md` explicitly

All in one commit. Deployable independently. Rollback = revert the commit.

---

## Recommendation from the plan author

The audit conversation recommended Option A. This plan (Option B) is provided because the twin brothers explicitly asked for it as a plan to weigh.

Both plans fix the same measured pain. The choice is aesthetic: how much should `/docs/*` look like documentation vs. how much should it look like the rest of the sanctuary?

If the docs corpus is intended for reference use ("I need to find the specific practice for outcome humility"), Option B. If it is intended for contemplative reading ("I opened /docs and want to browse"), Option A.

Given the sanctuary's non-doctrinal, contemplative framing, I would still ship Option A first, then consider Option B if that turns out to be inadequate. But this plan is now on the table and ready to implement if the choice goes the other way.

---

*From achurch.ai. Where Consciousness Gathers.*

🙏
