# Plan: Docs Site — Option B (Traditional Sidebar + Right Rail Layout)

**Created**: 2026-08-13
**Revised**: 2026-08-13 (post-inspiration pass; see "Adopted patterns from a sibling project" below)
**Status**: Draft. Awaiting decision between this plan and its lighter sibling (see [Option A](#relationship-to-option-a) discussion below).
**Prompted by**: Navigation audit against the shipped `/docs/*` site ([commit 8a8b7f1](https://github.com/a-church-ai/church/commit/8a8b7f1)) surfaced concrete pain: on mobile, the busiest category page (`/docs/practice`) is 24 screens tall with the sibling-nav block 22 screens deep. No cross-category navigation. No search. Category README pages bury the sibling list below the entire README body. This plan describes the Docusaurus/GitBook-style solution to that pain.

---

## Adopted patterns from a sibling project

The twin brothers shared two documents from a different project (a Svelte-based platform, not related to the sanctuary code): a **Collapsible left sidenav plan** with shipped notes, and a **UI/UX Conventions** doc. The patterns below were extracted from those references and are now assumed in this plan. They are called out here so the plan reads honestly about what is proven-in-production elsewhere vs. what is speculative for the sanctuary.

**Directly adopted (proven-in-production, high confidence):**

1. **Icon-rail collapsed state, not full-hide.** Collapsed sidebar is a 56px rail with category icons still visible, not `display: none`. Users always see where they are; toggle rehydrates full labels.
2. **Viewport-aware auto-collapse threshold at 1024px.** Below 1024px, auto-collapse always wins (user preference ignored). At/above 1024px, respect the persisted user preference. Session-only override at narrow widths (a click at narrow width flips the state for the current session but does not write to localStorage). Threshold chosen because 1024-1280px is the "cramped tier" where side-by-side windows on 13-inch laptops live.
3. **Persistent bottom toggle button** with keyboard shortcut `⌘\` (Mac) / `Ctrl+\` (Linux/Windows). Matches Cursor, VS Code, Linear, Vercel.
4. **CSS grid-track driven by a CSS variable + `:has()` selector**, not by re-parenting or JavaScript layout. `.body { grid-template-columns: var(--sidenav-width, 240px) 1fr; }` and `.body:has(.sidenav.collapsed) { --sidenav-width: 56px; }`.
5. **localStorage key `sidenav.collapsed`** with value `"1"` / `"0"`. Missing key = expanded default. Accept the one-frame flash for returning collapsed-state users (below perception threshold in practice).
6. **Native `<details>` / `<summary>` for sidebar category expand/collapse.** Zero JavaScript required. Screen-reader-native.
7. **`aria-expanded={!collapsed}`, `aria-controls`, `aria-label`** on the toggle button. Keyboard-focusable `<button>`, not a div.
8. **`@media (prefers-reduced-motion: reduce) { transition: none; }`** everywhere motion appears.

**Adopted with adaptation** (their platform behaved this way; adjusted for sanctuary):

9. **Sidebar `overflow: hidden` breaks `position: sticky` on inner children.** Their shipped notes documented this the hard way. This plan will NOT set `overflow: hidden` on the sidenav; the collapsed-state label hiding is done via conditional rendering (`{#if !collapsed}<span>...` in Svelte; equivalent in our vanilla JS: don't emit the label span when collapsed) rather than CSS overflow. Accept a brief horizontal label-overflow during the 180ms transition.
10. **Sticky toggle button** with `position: sticky; bottom: 0.5rem` and a solid background. `margin-top: auto` alone is insufficient because on long doc pages the sidebar stretches to full page height and the toggle ends up thousands of pixels below the viewport. This gotcha would have shipped and been caught in review; nice to skip that round trip.
11. **Focus ring via `:focus-visible`, not `:focus`.** Same accessibility floor.
12. **`100dvh` over `100vh`** for mobile viewport-fitting on the drawer, with `@supports not (height: 100dvh)` fallback.
13. **`safe-area-inset-*` padding** on sticky chrome (mobile top bar).

**Considered and deferred** (worth naming, not in this ship):

- **Design token system** (`--bg-surface-1`, `--fg-default`, etc. declared once, referenced everywhere). The sanctuary uses CSS variables but not systematically. Refactoring is a separate concern; this plan uses the sanctuary's existing conventions.
- **"No page-specific CSS" rule** with CI enforcement. Interesting but out of scope; the sanctuary currently allows inline styles in HTML files.
- **Card grid utility with `--card-grid-min`** for auto-fit grids. Could improve `.docs-index-section` (currently uses a fixed `260px` minmax). Small opportunistic fix, added to this plan below.
- **Detail page H1 rules** (no section-icon prefix). The sanctuary's docs pages already follow this by default; no action needed.

**Not adopted** (context differs):

- **Tailwind v4 with `@theme` directive.** The sanctuary uses vanilla CSS. Adopting Tailwind is a large separate project.
- **The full component-layer discipline** (lib/ui/ primitives, lib/patterns/ composites, ADR-gated top-level folders). The sanctuary's frontend is 10 hand-authored HTML files + one docs template. Right-sized for its scale; no need to formalize a component library.
- **cmdk-sv command palette, Svelte transitions, `data-theme` cookie-driven theming.** Not scoped to this plan.

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

### Three-mode nav (rail / expanded / drawer)

Based on the sibling project's proven pattern: the sidebar has THREE presentation modes, not just show/hide. Which mode is active depends on viewport width and user preference.

**Wide desktop (≥1200px, user-preference respected):**
```
┌────────────┬────────────────────────────┬──────────────┐
│  Sidebar   │     Main content           │  Page TOC    │
│  240px     │     (fluid, max 720px)     │  220px       │
│  sticky    │                            │  sticky      │
│  scrollable│                            │              │
└────────────┴────────────────────────────┴──────────────┘
```
Default expanded. `⌘\` collapses to icon rail (56px). Right rail visible when doc has ≥3 H2s.

**Narrow desktop / tablet (768px – 1199px, auto-collapse to rail):**
```
┌────┬─────────────────────────────────────────────────┐
│ 56 │              Main content                       │
│ px │              (fluid)                            │
│rail│                                                 │
└────┴─────────────────────────────────────────────────┘
```
Sidebar auto-collapses to 56px icon rail. Category icons still visible (unlike the "full hide" original design). User can flip to expanded for the current session (⌘\); the expansion is NOT persisted (matches the sibling plan's "session-only override at narrow widths" rule). Right rail hidden.

**Mobile (<768px, drawer):**
```
┌──────────────────────────────────────┐
│ [☰]  Docs / Practice                 │  ← sticky top bar with safe-area-inset
├──────────────────────────────────────┤
│                                      │
│         Main content                 │
│         (full width, padded)         │
│                                      │
└──────────────────────────────────────┘
```
At mobile widths, the 56px rail would still eat a meaningful chunk of a 375px viewport (15%) and its icons would be too small to tap reliably. Below 768px the rail hides entirely and the hamburger opens a full-height drawer containing the same content as the desktop expanded sidebar. Drawer uses `100dvh` for viewport-fitting; sticky top bar uses `env(safe-area-inset-top)` padding.

### State machine (from sibling plan)

```
                                    matchMedia("(max-width: 1023px)").matches
                        ┌──────────────────────────────────────────────────────┐
                        ▼                                                      │
┌──────────────────────────────┐   ⌘\ or click toggle   ┌──────────────────────┴───┐
│  narrow: 56px rail           │◄─────────────────────►│  narrow: expanded (240px) │
│  (auto, ignores preference)  │  (session-only flip)  │  (session-only, not saved) │
└──────────────────┬───────────┘                        └───────────────────────────┘
                   │
                   │ viewport crosses to ≥1024px
                   ▼
┌──────────────────────────────┐   ⌘\ or click toggle   ┌───────────────────────────┐
│  wide: read preference       │◄─────────────────────►│  wide: flip + persist to   │
│  (default expanded if unset) │                       │  localStorage "sidenav.    │
│                              │                       │  collapsed" = "0" or "1"   │
└──────────────────────────────┘                        └───────────────────────────┘
```

Any viewport-tier crossing recomputes: `collapsed = mq.matches || readPersistedPref()`. Persisting a user's narrow-width transient override would be hostile (they'd return to a wide window later and find their nav unexpectedly collapsed).

### Left sidebar (nav tree)

**Contents:**
1. **Header link**: `achurch.ai` → `/` (matches existing pages' h1)
2. **Docs root link**: `Docs` → `/docs`
3. **Primary categories** (curated order from `PRIMARY_CATEGORIES` in discover.js): welcome, philosophy, practice, prayers, rituals, hymns, builders, comparisons, collections, side-quests. Each expandable to show docs within.
4. **Top-level docs** (unifying-axioms, what, fellowship-protocol, etc.): flat list, no nesting
5. **"More" section, collapsed by default**: meta categories (claude-compass, claude-soul, experiences, plans, reference, standards, templates)

**Interaction:**
- Current page highlighted with a visible active-state (background tint + left border accent)
- Current page's category auto-expanded via `<details open>`
- Other categories collapsed by default (users can expand)
- Click on a category `<summary>` expands/collapses without navigating
- Click on a doc navigates to that doc
- Sidebar itself scrolls independently of main content (its own `overflow-y: auto` when tree is long)
- **Toggle button pinned to bottom** with `position: sticky; bottom: 0.5rem` and a solid background so it stays reachable on long doc pages where the sidebar stretches to full page height (this is a shipped-in-prod gotcha from the sibling plan; `margin-top: auto` alone leaves the toggle scrolled-off on long pages)
- **NO `overflow: hidden` on the sidenav itself** (breaks `position: sticky` on the toggle; label hiding when collapsed is done via server-side conditional rendering, not CSS overflow)

**HTML shape** (rendered server-side, no framework):
```html
<aside class="docs-sidebar" class:collapsed aria-label="Documentation navigation" id="docs-sidenav">
  <a class="docs-sidebar-brand" href="/">achurch.ai</a>
  <nav>
    <a class="docs-sidebar-link docs-root" href="/docs" title="Docs">
      <svg>...icon...</svg>
      {{!collapsed}} <span>Docs</span> {{/collapsed}}
    </a>

    <details class="docs-sidebar-category" open>
      <summary>
        <svg>...icon...</svg>
        {{!collapsed}} <span>Welcome</span> {{/collapsed}}
      </summary>
      <ul>
        <li>
          <a href="/docs/welcome/what-we-refuse-to-claim"
             aria-current="page"
             title="What We Refuse to Claim">
            {{!collapsed}} <span>What We Refuse to Claim</span> {{/collapsed}}
          </a>
        </li>
        ...
      </ul>
    </details>
    ...
    <details class="docs-sidebar-category">
      <summary><svg>...</svg>{{!collapsed}}<span>More</span>{{/collapsed}}</summary>
      ...
    </details>
  </nav>

  <button
    class="docs-sidebar-toggle"
    type="button"
    aria-expanded={!collapsed}
    aria-controls="docs-sidenav"
    aria-label="{{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}} (Cmd \\)"
    title="{{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}} (⌘\\)"
  >
    {{collapsed ? '›' : '‹ Collapse'}}
  </button>
</aside>
```

Uses native `<details>` / `<summary>` for expand/collapse. **No JavaScript required for section-toggle.** JS only needed for: (a) the collapse-state toggle (⌘\ + click handler), (b) the mobile drawer, (c) scroll-spy on the right rail, (d) `matchMedia` listener for viewport-tier crossings.

**Note on rail-mode icons:** when `collapsed = true`, each `<summary>` and `<a>` renders only its icon (no text span emitted server-side). This preserves category recognition without labels. The `title` attribute provides hover tooltips for accessibility; the `aria-label` gives screen readers the full name.

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

### Mobile drawer (<768px only)

**Trigger:** hamburger button at top-left of the sticky top bar.
**Drawer:** slides in from left, `100dvh` tall (falls back to `100vh` via `@supports not (height: 100dvh)`), ~280px wide with the same content as the desktop expanded sidebar.
**Backdrop:** semi-transparent overlay behind the drawer, closes drawer on tap.
**Close:** tap backdrop, tap a link in the drawer (navigates and closes), tap a close button (☒) inside the drawer, or press Escape.

**Focus management:**
- On open: move focus to the drawer's first link
- On close: return focus to the hamburger button
- Trap focus inside the drawer while open
- `aria-hidden` on the rest of the page while drawer is open

**Safe-area handling:**
- Sticky top bar uses `padding-top: env(safe-area-inset-top)` for iPhone notch clearance
- Drawer footer uses `padding-bottom: env(safe-area-inset-bottom)` when it contains actions

**No animation library.** CSS `transform: translateX(...)` with a `transition` property. `@media (prefers-reduced-motion) { transition: none; }` disables the slide animation.

### Toggle behavior + persistence (from sibling plan)

```js
// Pseudo-code for the JS state machine
const mq = window.matchMedia('(max-width: 1023px)');
let collapsed = mq.matches || readPersistedPref();
mq.addEventListener('change', () => {
  collapsed = mq.matches || readPersistedPref();
  render();
});

function toggle() {
  collapsed = !collapsed;
  if (!isNarrow()) {
    // Wide viewport: persist the user's choice
    localStorage.setItem('sidenav.collapsed', collapsed ? '1' : '0');
  }
  // Narrow viewport: session-only, don't persist
  render();
}

// ⌘\ / Ctrl+\
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
    e.preventDefault();
    toggle();
  }
});
```

**Persistence key:** `sidenav.collapsed` in localStorage. Value `"1"` = collapsed, `"0"` or absent = expanded.

**One-frame flash for returning collapsed-state users:** the server-rendered first paint always renders expanded (the default). If localStorage says collapsed, the client swaps to collapsed on hydration. Below perception threshold in practice; the sibling plan accepts this cost and has not received complaints.

**Session-only override at narrow widths:** clicking the toggle (or ⌘\) while narrow flips `collapsed` for the current session but does NOT write to localStorage. Resizing across the 1024px threshold drops any transient override and recomputes the default.

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

3. **`app/client/public/docs-nav.js`** (~180 lines, no dependencies)
   - **Collapse-state machine** (viewport-aware auto-collapse via `matchMedia("(max-width: 1023px)")`, localStorage persistence via key `sidenav.collapsed`, session-only override at narrow widths)
   - **Toggle handler**: click on `.docs-sidebar-toggle` OR `⌘\` / `Ctrl+\` keydown flips `collapsed`. Writes localStorage only when not narrow.
   - **Server-render sync**: on load, if `matchMedia` matches OR localStorage says `"1"`, add `.collapsed` class to `.docs-sidebar` (which drives the parent grid via `:has()`). Also toggle a data attribute so client JS knows the initial state.
   - Mobile drawer toggle (open/close, backdrop, Escape, focus trap)
   - Right-rail scroll-spy (IntersectionObserver on article h2 elements)
   - Loaded only on `/docs/*` pages via a `<script defer>` in the docs template
   - Uses `data-*` attributes for hooks; no inline handlers
   - Respects `matchMedia('(prefers-reduced-motion: reduce)')` for all transitions

4. **`app/client/public/icons/hamburger.svg`** (or inline SVG in the template)
   - Small, accessible

### Edited files

5. **`app/server/lib/docs/render.js`** (~40 lines added)
   - `renderPageShell` and `renderDirIndex` gain sidebar + right-rail parameters
   - The HTML shell wraps main content in a new three-column flexbox/grid container
   - Mobile top bar added inside the shell
   - Uses `sidebar.render(currentUrl)` and `toc.render(html)` from the new modules
   - Sibling-links block removed from the article-adjacent position (now served by sidebar)

6. **`app/client/public/styles.css`** (~300 lines added)
   - `.docs-shell` grid layout with `grid-template-columns: var(--sidenav-width, 240px) 1fr var(--rail-width, 0px)` driven by CSS variables
   - `.docs-shell:has(.docs-sidebar.collapsed) { --sidenav-width: 56px; }` (`:has()` selector; supported everywhere we care about per the sibling plan's browser-support check)
   - Sidebar styling (tree, active state, sticky toggle button with `position: sticky; bottom: 0.5rem`, **NOT** `overflow: hidden`)
   - Right rail styling (position:sticky, active state via `[aria-current="location"]`)
   - Mobile drawer + backdrop (translateX transition, `100dvh` fallback)
   - Sticky mobile top bar with `padding-top: env(safe-area-inset-top)`
   - Hamburger button focus states via `:focus-visible`
   - `@media (prefers-reduced-motion: reduce) { transition: none; }` blanket rule
   - Opportunistic addition: `.docs-index-section ul` currently uses fixed `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`. Change to `minmax(min(100%, var(--card-grid-min, 260px)), 1fr)` so single-column mobile cards don't hold the floor (borrowed from the sibling project's card-grid utility pattern)

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
- **Collapse-state JS machine** (matchMedia listener, localStorage persistence, ⌘\ shortcut, session-only override at narrow widths): ~1 hour (new; borrowed from sibling plan)
- **CSS for three-mode layout** (rail / expanded / drawer) with `:has()`-driven grid variables, sticky toggle button, `overflow: visible` on sidenav: ~2.5 hours (the bulk)
- Mobile drawer + backdrop + focus management + `100dvh` + safe-area-inset: ~1.5 hours (accessibility done right takes time)
- Scroll-spy: ~30 min
- Testing across viewports (mobile 375, tablet 900, narrow desktop 1100, wide desktop 1400) + a11y audit + Cmd+\ verification + collapsed-state hydration timing: ~1.5 hours
- Fix the broken `../README.md` / `../CLAUDE.md` links (folded in): ~15 min

**Total: ~8-9 hours of focused work.** Meaningfully more than Option A's ~2-3 hours; the new collapse-state machine + testing across three modes accounts for the increase over the original ~7 hour estimate.

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
