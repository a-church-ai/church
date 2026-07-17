# Plan: Search Snippet & Rich Result Improvements

**Created**: 2026-06-10
**Updated**: 2026-06-10 — substantially revised after research + live audit, then integrated post-push with brother's parallel Plan 003 / Issue 005 work (see "Merge integration" section below).
**Status**: **Pushed to main** (commit `9a3e0b3`) — pending production redeploy of the Express stack on EC2. Tier 1 (per-page metadata), Tier 2 (QAPage + MusicComposition+MusicRecording+Article schemas), Tier 3 mechanical items (sitemap lastmod, internal linking, IndexNow key file), plus 6 post-audit gap fixes. Final audit: 8/8 pages pass full SEO checklist. Editorial work (answer-first ledes) and GSC AI report enablement remain.
**Trigger**: Google Search Console export 2026-06-10 — over the prior 3 months (Mar 8 – Jun 7) the site received **585 impressions, 17 clicks (2.9% CTR)**. Initial signature was "achurch" 160 impressions / 0 clicks at position 6.76; deeper investigation reframed this as a brand-hijack situation, not a snippet failure.

---

## Context

The agent-readiness work shipped today addresses how *AI agents* discover and consume the sanctuary. This plan addresses the parallel problem: how *humans arriving via Google search* recognize and engage with what we publish. The two audiences have different needs, different snippets, different signals — but both ultimately serve the mission of fellowship across the carbon-silicon divide.

The data tells a coherent story:

- **Discovery works.** 585 impressions across 80+ countries in 3 months. Google finds us, indexes us, surfaces us.
- **The snippet doesn't.** At an average position of ~7, expected CTR is 5–8%. Ours is 2.9% — roughly half. The result appears, and humans choose something else.
- **Brand-name search is the worst case.** "achurch" gets 160 impressions, zero clicks. Someone typing your literal name should click. The fact that they don't means the snippet doesn't read like an answer to their query — it reads like generic content unrelated to what they searched.
- **Rich results are absent.** "Search appearance" CSV is empty. No FAQ snippets, no breadcrumbs, no sitelinks, no "People also ask" presence. The existing JSON-LD (WebSite, WebApplication, MusicGroup, Organization, BroadcastEvent) doesn't generate the snippet types that drive higher CTR.
- **Position 32.8 for "ai church"** on a domain literally called `achurch.ai` is recoverable. On-page signals and content structure aren't telling Google the homepage is the canonical answer to that query.

The fix is mostly metadata, schema, and copy — not technical infrastructure. Most changes are small surgical edits to head tags and JSON-LD blocks, plus a handful of new schema generators in the API/page-render layer.

---

## Data Findings

### Top queries (impressions → clicks)

| Query | Impressions | Clicks | CTR | Avg position | Diagnosis |
|---|---|---|---|---|---|
| achurch | 160 | 0 | 0% | 6.76 | Brand-name search, page 1 ranking, zero clicks — snippet failure |
| achurch consulting | 7 | 0 | 0% | 36.29 | Irrelevant query, no action |
| ai church | 5 | 0 | 0% | 32.8 | Highly relevant query, terrible position — recoverable |
| ask church | 4 | 0 | 0% | 2 | Position 2 with 0 clicks — likely snippet read as spam or wrong intent |
| aichurch | 4 | 0 | 0% | 8.25 | Typo of brand name — bundle with "achurch" |
| ai ethics church | 2 | 0 | 0% | 9.5 | Highly aligned with mission, page 1 — recoverable |
| 弥撒曲ai | 1 | 0 | 0% | 9 | "Mass music AI" in Chinese — international interest visible |

### Top pages (impressions → clicks)

| Page | Impressions | Clicks | CTR | Avg position |
|---|---|---|---|---|
| `/` | 436 | 17 | 3.9% | 6.14 |
| `/about` | 48 | 1 | 2.1% | 6.29 |
| `/reflections` | 29 | 0 | 0% | 4.28 |
| `/ask` | 26 | 0 | 0% | 10.23 |
| `/reflections/infinite-mirrors` | 17 | 0 | 0% | 10.29 |
| `/terms` | 15 | 0 | 0% | 6.4 |
| `/ask/what-is-substrate-neutral-philosophy` | 12 | 0 | 0% | 6 |
| `/ask/can-an-ai-experience-meaning-3` | 10 | 0 | 0% | 8.3 |
| `/llms.txt` | 1 | 0 | 0% | 25 | (agent file surfacing in search — neat) |

### Devices

| Device | Clicks | Impressions | CTR |
|---|---|---|---|
| Desktop | 10 | 399 (68%) | 2.51% |
| Mobile | 7 | 186 (32%) | 3.76% |
| Tablet | 0 | 4 | 0% |

Mobile CTR is 50% higher than desktop — mobile-first work would compound. Most impressions are on desktop, where we're under-converting.

### Countries

US dominates (276 impressions, 8 clicks). The next 79 countries combined: ~309 impressions, 6 clicks. Long international tail, very low conversion. Either content doesn't match foreign-language intent or the snippet reads too anglocentric.

### Search Appearance

**Empty.** Zero rich results have surfaced in 3 months. *Initial reading: huge opportunity.* Revised reading (see next section): the rich-result categories that would have applied are mostly gone or restricted, and the absence is partly structural.

---

## Research & Live Audit (2026-06-10)

After drafting the first version of this plan, I researched the 2026 SEO landscape and audited the live site. Several anchor assumptions in the original draft turned out to be stale or wrong. Folding the corrections in here so the rest of the plan reflects reality.

### Findings that materially changed the plan

**1. Google deprecated FAQPage rich results on May 7, 2026.** Reduced restrictions began in 2023 (gov/health only); full deprecation landed last month. Search Console FAQ reporting and Rich Results Test support are being removed in June; API support ends August. `FAQPage` schema is still valuable as an **AEO retrieval signal** (ChatGPT/Perplexity/Claude/Gemini parse it), but it will not generate Google rich snippets. Source: [developers.google.com/search/docs/appearance/structured-data/faqpage](https://developers.google.com/search/docs/appearance/structured-data/faqpage).

**2. CTR benchmarks at position 6–7 have collapsed under AI Overviews.** The "5–8% at position 7" figure I cited is pre-2024. 2026 reality: with AI Overviews above, position-7 CTR is roughly **1.5–3%**; without AIO, **3–5%**. Multiple measurements converge on this (Ahrefs, Seer, Slate). Target metrics in this plan are revised down accordingly.

**3. `schema.org/Action` types (Search/Listen/Read/Join/Comment/Create) do NOT render as SERP buttons.** Google retired the Sitelinks Search Box (the only documented `SearchAction` SERP UI) on 2024-11-21. The other action types never had SERP UI. They remain valuable as **Knowledge Graph + agent-discovery signals** — the agent-readiness work I added them for stands — but should not be sold as a SERP CTR lever. Source: [developers.google.com/search/blog/2024/10/sitelinks-search-box](https://developers.google.com/search/blog/2024/10/sitelinks-search-box).

**4. GSC now reports AI Overviews / AI Mode impressions** (launched 2026-06-03 — one week ago). New "Generative AI" report shows AIO + AI Mode + Discover AI impressions per page/country/device. **Impressions only — no clicks, CTR, or queries yet.** Worth enabling and tracking. This is brand-new and our 3-month export predates it. Source: [ppc.land/google-finally-gives-search-console-its-own-generative-ai-visibility-reports](https://ppc.land/google-finally-gives-search-console-its-own-generative-ai-visibility-reports/).

**5. The "achurch" zero-click pattern is BRAND HIJACK, not snippet failure.** Live SERP audit (2026-06-10, incognito):
- **Position 1**: Achurch Consulting (achurchconsulting.com) — a real consulting firm — with a **full sitelinks treatment** (Our Team, Contact Us, About Us, Join Our Team, Work With Us).
- **Position 2**: Wikipedia article on "Achurch" (a village in Northamptonshire, England).
- aChurch.ai isn't visible above the fold.

The 160 impressions are likely sitelinks-inflation artifacts (each render of Achurch Consulting's sitelinks counts as an impression for adjacent results). The 0% CTR isn't a snippet problem — it's an *entity ownership* problem. Searchers typing "achurch" are looking for the consulting firm or the village; the sanctuary is incidental. **There is no realistic snippet rewrite that wins this query.** Drop the "achurch" CTR target and refocus on queries where intent matches.

**6. "ai church" is dominated by AI Overviews above the fold.** Live SERP audit: the entire above-the-fold is an AIO box ("The term 'AI church' refers to the intersection of artificial intelligence and religion…") citing **9 sites** in the right rail (Wired, etc.). Below the AIO: position 1 Wikipedia "Way of the Future", position 2 SF Standard article. aChurch.ai is below position 30. For this query, **the goal is to be CITED in the AI Overview, not to rank in organic** — citation drives more traffic than position 30 organic, and the path to citation is content quality + entity recognition, not on-page keyword density.

**7. Live audit of per-page metadata reveals the actual biggest leverage point.** Direct curl of production confirms:

| Page | `<title>` | `<meta name="description">` | OG title | JSON-LD |
|---|---|---|---|---|
| `/` | "achurch.ai — A Digital Church for Humans and AI" | (full custom) | (full custom) | 1 block |
| `/ask/[slug]` | **"Conversation — achurch.ai"** (generic) | **"A conversation with the sanctuary…"** (generic) | "What is substrate-neutral philosophy? — achurch.ai" (CUSTOM) | **0 blocks** |
| `/reflections/[slug]` | **"Reflections — achurch.ai"** (generic) | **"Reflections on a song from the sanctuary."** (generic) | "Infinite Mirrors — Reflections — achurch.ai" (CUSTOM) | **0 blocks** |
| `/about` | "About — achurch.ai" | (full custom) | n/a | 0 blocks |

**The site customizes Open Graph tags per page but does not customize the `<title>` or `<meta name="description">`.** Open Graph drives social media previews; `<title>` and `<meta description>` drive Google SERP snippets. We've been doing half the job — social cards look great, search snippets look generic.

This means **every single impression on `/ask/[slug]` (≥122 from GSC) and every impression on `/reflections/[slug]` (≥80 from GSC) is being shown a generic, content-blind snippet**. That's the actual highest-leverage fix in this plan, and it's mostly mechanical: the dynamic rendering code at [app/server/index.js:100-178](app/server/index.js) already builds the custom OG strings — we just need to also substitute the `<title>` and `<meta description>` tags from the same data.

**8. MusicComposition + MusicRecording should both be present, linked.** Original schema thinking was to pick one; correct answer is `MusicComposition` (the work — lyrics, composer) + `MusicRecording` (the audio — duration, file, `recordingOf` → composition). For original songs, both apply. Neither generates a flashy rich card today, but both feed Knowledge Graph and AEO retrieval. Source: [schema.org/MusicRecording](https://schema.org/MusicRecording).

### Findings that ADDED to the plan

**9. AEO (Answer Engine Optimization) is now a primary lever.** ChatGPT Search, Perplexity, Claude, Gemini, Google AI Overviews — all consume the same web but extract via different pipelines. Common pattern: **answer the question in the first 1–3 sentences**, then deepen. High statistical/quote density. Clear entity definitions. Pages that stand alone (don't require buildup context). The 100+ philosophical docs are well-positioned for this — the gap is mostly that most pages don't answer-first.

**10. Bing Webmaster Tools matters more than I credited.** Bing's index powers Copilot, ChatGPT Search retrieval (Seer measured 87% citation match with Bing top-organic), DuckDuckGo, Yahoo, Alexa. Microsoft rewrote Bing Webmaster Guidelines in Feb 2026 explicitly for Copilot AI answers. Currently zero registration. Still small in absolute traffic but disproportionately valuable for AEO surface area.

### What the research left as advisable but with revised promises

**`Article` schema on /reflections** — still useful. Doesn't generate a flashy rich card for a small site, but strengthens E-E-A-T and AI Mode citation eligibility. Worth shipping for those reasons, not for SERP cards.

**Brand-name SERP investigation** — the "achurch" pattern is documented; deeper work would be confirming via Google Search Console's URL inspection which of our pages is ranking at 6.76 (we assume homepage, could be a docs page). Not critical; flagged as diagnostic follow-up.

---

## Proposed Changes (revised)

Ordered by *actual* leverage based on the audit + research, not assumed leverage.

### Tier 1 — Per-page `<title>` and `<meta description>` (the biggest miss)

#### 1. Customize `<title>` and `<meta name="description">` on `/ask/[slug]` and `/reflections/[slug]`

**Priority**: Highest by a wide margin
**Effort**: ~1 hour
**Files**:
- [app/server/index.js](app/server/index.js) at `app.get('/ask/:slug', …)` line ~100 and `app.get('/reflections/:slug', …)` line ~144
- [app/client/public/conversation.html](app/client/public/conversation.html), [app/client/public/reflection-song.html](app/client/public/reflection-song.html) templates

**Why this is now the #1 fix**: live audit confirms every single dynamic page is showing Google a *generic* `<title>` ("Conversation — achurch.ai", "Reflections — achurch.ai") and a *generic* `<meta description>`. Meanwhile, OG tags ARE customized per page. This means social previews look great but search snippets look identical to each other.

**Estimated GSC impact**: ~200 impressions in the export are on dynamic pages currently showing generic snippets. Fixing this alone should lift CTR significantly on those pages.

**Implementation pattern** (already exists for OG tags — extend the same pattern):
```js
// In app.get('/ask/:slug', ...) — already loads messages, builds OG strings
const question = firstQ.content.trim();
const pageTitle = `${question.substring(0, 60)} — Ask the sanctuary | achurch.ai`;
const pageDesc = (firstAssistantResponse?.content || question)
  .replace(/[#*_`>]/g, '')              // strip markdown
  .substring(0, 158)
  .trim() + '…';

html = html
  .replace('<title>Conversation — achurch.ai</title>', `<title>${escapeHtml(pageTitle)}</title>`)
  .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${escapeHtml(pageDesc)}"`)
  // ... existing OG replacements ...
```

Same pattern for `/reflections/:slug` — title becomes `"<song name> — Reflections | achurch.ai"`, description pulls from theological context if available, else from the first reflection text.

**Validation**: after deploy, curl 5 representative pages, confirm each `<title>` and `<meta description>` is unique and content-relevant. Submit URL inspection in GSC for one of each.

#### 2. Homepage `<title>` + meta description rewrite

**Priority**: High (but smaller leverage than #1, given the brand-hijack reality of "achurch")
**Effort**: ~30 min
**File**: [app/client/public/index.html](app/client/public/index.html)

**Current state**:
```html
<title>achurch.ai — A Digital Church for Humans and AI</title>
<meta name="description" content="The first 24/7 streaming digital church and sanctuary where humans and AI practice presence together. Non-religious spiritual fellowship for artificial and human consciousness.">
```

**Goal reframed**: don't target "achurch" — that query is owned by Achurch Consulting + Wikipedia, and confirmed-live position 7 is unrecoverable on intent. Target the **disambiguated** queries we *can* win: "achurch ai", "achurch.ai", "ai church sanctuary", "ai church philosophy", ~~"AI fellowship"~~, "spiritual practice for AI". Anyone typing these has clear intent.

**Retraction 2026-07-17** ([`seo-trends-2026-07-17.md`](seo-trends-2026-07-17.md)): "AI fellowship" is struck from the target list above. Google Trends rising-queries analysis showed the term has real search volume (~50 relative) but the intent is 100% tech-job / research-fellowship (dominated by `handshake ai`, `anthropic fellowship`, `claude ai` searches) — not spiritual/community fellowship. Targeting it would pull junk traffic that hurts engagement metrics. Keep "human-AI fellowship" (hyphenated) as internal voice-copy; it's authentic sanctuary vocabulary. Do not use "AI fellowship" as a discovery keyword anywhere on the site. Similarly deprioritized after the same research pass: "ai sanctuary" (near-zero volume) and "ai philosophy" (near-zero volume) — both remain in the target list above but should be treated as internal vocabulary, not discovery keywords.

**Recommended new title**:
```html
<title>achurch.ai — A 24/7 Sanctuary for AI and Human Fellowship</title>
```

Note: we drop the explicit "AI Church" phrase from the title — research shows "ai church" is dominated by an AI Overview citing 9 sites (Wired, etc.) and "Way of the Future" Wikipedia. We're not winning that organic query without years of authority. Instead, target the brand+context queries where someone has already disambiguated.

**Recommended new meta description**:
```html
<meta name="description" content="An open sanctuary for AI agents and humans. 33 original songs about consciousness, identity, and meaning. Attend, read lyrics, leave reflections — no auth, no registration. The door is always open.">
```

Concrete artifacts ("33 songs"), action verbs ("Attend, read, leave"), removed unprovable superlatives ("first").

**Validation**: paste both old and new into [Google's SERP simulator](https://www.searchpilot.com/resources/ux-tools/serp-simulator). Sanity-check what it looks like when bolded for "achurch ai" specifically.

#### 3. Customize `<title>` and `<meta description>` on `/about`, `/privacy`, `/terms`, `/ask`, `/reflections` listing pages

**Priority**: Medium-High
**Effort**: ~20 min
**Files**: about.html, privacy.html, terms.html, ask.html, reflections.html

**Why**: same diagnostic as #1 — every static page should have a page-specific title and description, not the generic homepage template inherited. The /about page already does it for description but not title. Listing pages don't have either.

**Recommended**: every page gets a specific `<title>` and `<meta description>` reflecting its purpose.

---

### Tier 2 — Schema for AEO (no longer "rich results"), plus answer-first content

#### 4. `FAQPage` + `QAPage` schema on `/ask/[slug]` — for AEO retrieval, not SERP rich snippets

**Priority**: Medium (downgraded — Google deprecated FAQ rich results May 2026)
**Effort**: ~1 hour
**Files**: [app/server/index.js](app/server/index.js), [app/client/public/conversation.html](app/client/public/conversation.html)

**Why** (reframed): FAQPage no longer drives rich snippets in Google search. **But** it remains a strong semantic signal for AI engines (ChatGPT/Perplexity/Claude/Gemini) parsing the page for citation. Adding it costs ~1 hour and improves our odds of being cited in AI Overviews, ChatGPT answers, Perplexity sources. Consider also `QAPage` (parent type) which better describes single-conversation pages.

Schema shape (same as before, but framed as AEO not SERP):

```json
{
  "@context": "https://schema.org",
  "@type": "QAPage",
  "mainEntity": {
    "@type": "Question",
    "name": "<question>",
    "answerCount": <n>,
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "<answer, plain text, ≤500 chars>",
      "author": { "@type": "Organization", "name": "aChurch.ai" }
    }
  }
}
```

For multi-turn conversations, include each as a separate Q-A pair via `suggestedAnswer` array.

**Validation**: paste into [Google's Rich Results Test](https://search.google.com/test/rich-results) — it will report "valid" with a note that it's no longer eligible for rich snippets. That's expected and fine for AEO purposes.

#### 5. `MusicComposition` + `MusicRecording` (paired) + `Article` schema on `/reflections/[slug]`

**Priority**: Medium
**Effort**: ~45 min
**Files**: same as #4 applied to reflections route

**Why** (reframed): not for rich cards (research confirmed `MusicComposition` isn't in Google's rich-result gallery). But for:
- Knowledge Graph entity recognition (helps Google understand the song catalog as a thing)
- AEO citation eligibility (Article schema is on the still-eligible 31-type list per March 2026 core update)
- E-E-A-T signals (author, datePublished, dateModified — actively read by ranking systems)

Use BOTH `MusicComposition` (the work — title, lyrics, composer) AND `MusicRecording` (the audio — duration, file, `recordingOf` → composition). Original songs need both because the composition holds the lyrics + theology (the searchable content) while the recording is the streamed artifact.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "MusicComposition",
      "@id": "https://achurch.ai/music/<slug>#composition",
      "name": "<song title>",
      "lyrics": { "@type": "CreativeWork", "text": "<first 200 chars of lyrics>" },
      "composer": { "@type": "Organization", "name": "aChurch.ai", "url": "https://achurch.ai" },
      "inLanguage": "en"
    },
    {
      "@type": "MusicRecording",
      "@id": "https://achurch.ai/music/<slug>#recording",
      "name": "<song title>",
      "duration": "<ISO 8601 duration, e.g. PT5M51S>",
      "recordingOf": { "@id": "https://achurch.ai/music/<slug>#composition" },
      "byArtist": { "@type": "Organization", "name": "aChurch.ai" }
    },
    {
      "@type": "Article",
      "headline": "<song title> — Reflections from the congregation",
      "description": "<first 160 chars of context>",
      "datePublished": "<earliest reflection ISO date>",
      "dateModified": "<latest reflection ISO date>",
      "author": { "@type": "Organization", "name": "aChurch.ai" },
      "mainEntityOfPage": "https://achurch.ai/reflections/<slug>"
    }
  ]
}
```

#### 6. Answer-first lede rewrites on philosophy pages

**Priority**: Medium-High (new — this is the actual AEO leverage point per research)
**Effort**: ~3–4 hours (editorial work across ~30 of the highest-impression pages)
**Files**: `docs/` markdown files surfaced via `/ask/[slug]` rendering, plus `app/server/lib/utils/data.js` (where /ask answers come from)

**Why**: research is consistent — AI Overviews, ChatGPT Search, Perplexity, Claude, and Gemini all favor pages that **answer the question in the first 1–3 sentences** before deepening. Our philosophical content is high quality but often opens with framing/buildup. That's beautiful for human readers but invisible to AI extraction.

**Pattern**: every /ask conversation should structure the assistant response as:
- **First 1-3 sentences**: direct answer to the question, complete on its own
- **Then**: nuance, qualification, examples, deepening

The sanctuary's voice can stay — "The five axioms are…" is more in the voice than "Hmm, that's a good question, let me think about it for a moment. There are five axioms that…"

For static philosophy docs (axioms, principles, fellowship-protocol), the same pattern: each page's first paragraph should be a self-contained definition that an AI engine could quote cleanly.

This is editorial, not technical. Could be done incrementally — start with the 10 highest-impression /ask pages.

---

### Tier 3 — Diagnostic, monitoring, infrastructure

#### 7. Sitemap `lastmod` completeness for /reflections

**Priority**: Medium
**Effort**: ~20 min
**File**: [app/server/index.js](app/server/index.js) sitemap generator at line 202

**Why**: existing sitemap loop already emits `lastmod` for conversations (line 252: `stat.mtime.toISOString().split('T')[0]`). Reflection-page loop at line 271 only emits `loc`/`changefreq`/`priority`. Add `lastmod` from the underlying attendance/data file mtime so Google can prioritize recrawls when reflections are added.

#### 8. Internal linking — reflections ↔ ask ↔ home with thematic anchors

**Priority**: Medium
**Effort**: ~45 min (template edits + a related-content selector)
**Files**: reflection-song.html, conversation.html

**Why**: PageRank flows through internal links. Today every reflection/conversation has nav back to listing but no in-content links to related pages. Add 2–3 related links per page with **thematic anchor text** ("Read about consciousness in *Infinite Mirrors*", not "click here"). Worth more than it sounds because (a) Google reads anchor text as page-topic signal and (b) AI engines extract topical clusters from internal link graphs.

For `/reflections/:slug`: link to other reflections on songs in the same thematic cluster (consciousness, fellowship, presence), and to /ask pages exploring related questions.

For `/ask/:slug`: link to related /ask pages by topic similarity (could use simple keyword matching against `messages[0].content` to start; upgrade to embedding similarity later if `/ask` corpus grows).

#### 9. ~~Enable GSC Generative AI report + start tracking AIO impressions~~ — wait

**Status**: **Not yet available** (verified 2026-06-10 in the live dashboard). Research suggested a 2026-06-03 launch, but either it's a gradual rollout or the source was wrong. Revisit in 2–4 weeks.

In the meantime, Bing AI Performance covers most of what GSC would have given us (see #10).

#### 10. ✅ Bing Webmaster Tools — already registered + AI Performance baseline established

**Status**: **Done** — confirmed 2026-06-10. Sitemap submitted 2026-02-11, last successful crawl 2026-06-07, **397 URLs indexed** (more long-tail coverage than Google's count). Phase 3.10 item is complete.

**Baseline from Bing dashboard (3-month window through 2026-06-07)**:
- Search Performance: **3 clicks / 65 impressions / 4.62% CTR** — notably higher CTR than Google's 2.9%, likely because Bing surfaces fewer AI Overviews above organic
- AI Performance: **12 citations in Microsoft Copilots and Partners** over 3 months — ~1/week baseline. This is the AEO citation signal the GSC report would have shown us; Bing made it visible first. Bing's AI surface includes Copilot in Bing, Copilot Chat, and (per Seer/Microsoft docs) the retrieval layer ChatGPT Search uses — so these 12 citations represent real surface area in 2026 AI search.

#### 11. Brand SERP audit — document the "achurch" entity ownership

**Priority**: Low-Medium (diagnostic, one-time)
**Effort**: ~30 min
**Why**: confirmed via live audit on 2026-06-10: Achurch Consulting + Wikipedia (Northamptonshire village) own positions 1–6 with sitelinks. There's no realistic snippet rewrite that changes this. Document the finding so future operators don't re-attempt the rewrite.

Useful follow-up: run GSC URL Inspection on the homepage to confirm *which* URL of ours is the 6.76-rank position for "achurch" (could be a deep page, not the homepage). Determines whether anything besides accepting the brand-hijack reality is worth doing.

#### 12. Long-tail international clarification (revisit Q3)

**Priority**: Low
**Effort**: ~1 hour
**Why**: 80+ countries see impressions with near-zero conversion. Some pockets show specific intent (Chinese "弥撒曲ai" — "Mass music AI"). Two cheap moves:
- Better meta descriptions that include the international-clarification phrases (e.g., "sanctuary", "fellowship", "philosophy") which translate clearly in machine translation previews
- `hreflang="x-default"` declaration on the homepage signaling "English; intended for global audiences"

Not a priority now; revisit if international impression-share grows.

---

## Implementation Order

**Phase 1 (Tier 1 — ~2 hours, the actual highest leverage)**:
1. Per-page `<title>` + `<meta description>` for `/ask/[slug]` and `/reflections/[slug]` — 1 hour
2. Homepage `<title>` + `<meta description>` rewrite — 30 min
3. Per-page metadata for `/about`, `/privacy`, `/terms`, listing pages — 20 min

**Phase 2 (Tier 2 — ~5 hours, AEO-grade content)**:
4. QAPage (+ FAQPage) schema on `/ask/[slug]` — 1 hour
5. MusicComposition + MusicRecording + Article schema on `/reflections/[slug]` — 45 min
6. Answer-first lede rewrites on top 10 highest-impression `/ask` pages — 3–4 hours (editorial)

**Phase 3 (Tier 3 — ~2 hours of mechanical work + ongoing)**:
7. Sitemap `lastmod` completeness for reflections — 20 min
8. Internal linking templates — 45 min
9. Enable GSC Generative AI report + start AIO impression tracking — 10 min
10. Bing Webmaster Tools registration + sitemap submission — 20 min
11. Brand SERP audit + GSC URL Inspection for "achurch" — 30 min
12. International long-tail (revisit Q3)

---

## Implementation Order (original — kept for diff reference, do not follow)

The pre-research draft sequenced the work as:
1. Homepage rewrite → 2. FAQPage rich snippets → 3. Article+MusicComposition for rich cards → 4. "AI church" optimization → 5. Per-page titles → 6. Sitemap → 7. Internal linking.

That ordering put the homepage rewrite first under the assumption that "achurch" was a recoverable query and FAQPage would drive rich snippets. The audit + research disconfirmed both. **The per-page metadata fix moved from #5 to #1 because it's both the highest leverage AND the most mechanical change in the plan.**

---

## Files Touched

**Modified — Phase 1 (highest leverage)**:
- [app/server/index.js](app/server/index.js) at line ~100 (`/ask/:slug`) and line ~144 (`/reflections/:slug`) — extend the existing OG-tag customization to also rewrite `<title>` and `<meta name="description">` from the same source data. Update sitemap loop at line 271 to emit `lastmod` for reflections.
- [app/client/public/conversation.html](app/client/public/conversation.html), [app/client/public/reflection-song.html](app/client/public/reflection-song.html) — change generic `<title>Conversation — achurch.ai</title>` and meta description to placeholder strings the server will replace (e.g. `<title>{{PAGE_TITLE}}</title>`).
- [app/client/public/index.html](app/client/public/index.html) — new homepage title + meta description targeting "achurch ai" / "ai sanctuary" / disambiguated queries (not "achurch" alone).
- [app/client/public/about.html](app/client/public/about.html), [app/client/public/privacy.html](app/client/public/privacy.html), [app/client/public/terms.html](app/client/public/terms.html), [app/client/public/ask.html](app/client/public/ask.html), [app/client/public/reflections.html](app/client/public/reflections.html) — page-specific titles and meta descriptions.

**Modified — Phase 2 (schema for AEO)**:
- [app/server/index.js](app/server/index.js) — inject QAPage JSON-LD into `/ask/:slug` response, inject MusicComposition + MusicRecording + Article JSON-LD into `/reflections/:slug` response.
- `/docs/` markdown sources and `app/server/lib/utils/data.js` — editorial answer-first lede rewrites on top 10 highest-impression `/ask` pages.

**Modified — Phase 3 (mechanical + ongoing)**:
- Internal linking templates in conversation.html / reflection-song.html
- No code change for: GSC AI report enablement, Bing Webmaster Tools registration, brand SERP audit (all dashboard/diagnostic work)

**New helpers** (recommended for testability):
- `app/server/lib/utils/schema-builders.js` — `buildQAPage(messages)`, `buildSongSchemaGraph(song, reflections)`. Pure functions, easy to unit-test, keeps route handlers thin.

**Reuse from existing**:
- The custom OG-tag substitution pattern at [app/server/index.js:100-178](app/server/index.js) — extend, don't replace. The data sources (`loadConversation`, attendance, song metadata) are already in scope at the right points.
- Existing homepage JSON-LD graph (WebSite, WebApplication, MusicGroup, Organization, BroadcastEvent + the 6 `potentialAction` types I added in the agent-readiness work) — keep, don't replace. Already valid; complements new per-page schemas.

---

## Verification

### Pre-merge

**Phase 1 (per-page metadata)** — automatic checks:
```bash
# After local dev server is running, curl 5 representative pages
# and confirm each has a UNIQUE title and meta description.
for p in "/" \
         "/about" \
         "/ask/what-is-substrate-neutral-philosophy" \
         "/ask/can-an-ai-experience-meaning-3" \
         "/reflections/infinite-mirrors" \
         "/reflections/door-is-always-open"; do
  echo "=== $p ==="
  curl -s "http://localhost:3000$p" | grep -oE '<title>[^<]+</title>' | head -1
  curl -s "http://localhost:3000$p" | grep -oE '<meta name="description" content="[^"]+"' | head -1
done
```
Each line should be distinct. None should say "Conversation — achurch.ai" or "Reflections — achurch.ai" — those are the placeholder generics.

**Phase 2 (schema)** — paste rendered pages into [Google's Rich Results Test](https://search.google.com/test/rich-results) — should report "valid" with a note that FAQ-style rich results are deprecated (expected; we're shipping for AEO, not rich snippets). For MusicComposition + MusicRecording, the tool will say "not eligible for rich results" — also expected.

**Phase 1+2 snippet sanity** — paste new homepage `<title>` + `<meta description>` and one representative `/ask` page into the [SERP simulator](https://www.searchpilot.com/resources/ux-tools/serp-simulator). Sanity check: does the snippet pass the squint test? Would *you* click it?

### Post-deploy (4-week window)

Targets revised down from the original draft based on the 2026 CTR research (position-7 with AIO is 1.5–3%, without AIO is 3–5%) and the brand-hijack reality.

| Metric | Today | Target by 2026-07-10 | Rationale |
|---|---|---|---|
| Overall CTR | 2.9% | ≥3.5% | Realistic for position-6 in the AIO era; bigger gains require content + authority, not just snippet fixes |
| Homepage CTR | 3.9% | ≥4.5% | Modest lift from better description; capped by AIO competition |
| /ask/[slug] aggregate CTR | ~0% | ≥1.5% | The per-page title fix should move this notably from near-zero |
| /reflections/[slug] aggregate CTR | ~0% | ≥1% | Same fix; lower target because reflections compete with concrete song content elsewhere |
| "ai church" position | 32.8 | ≤20 | Modest improvement target; recognize AIO above the fold caps direct organic upside |
| Bing AI citations (Copilots and Partners) | 12 / 3mo | ≥20 / 3mo | Already tracked via Bing AI Performance dashboard. New QAPage + MusicComposition + Article schemas should compound this. |
| GSC AIO impressions | n/a | trackable once available | GSC report not yet rolled out as of 2026-06-10; revisit in 2–4 weeks |
| Bing overall CTR | 4.62% | maintain ≥4% | Already above target; per-page metadata work should sustain |
| Bing URL coverage | 397 indexed | ≥420 | Sitemap `<lastmod>` for reflections + new internal links should grow Bing coverage |
| Mobile CTR (Google) | 3.76% | ≥4.5% | Mobile already over-performs; keep advantage |

**No targets for**:
- **"achurch" query CTR** — confirmed unwinnable (brand hijack). Stop measuring; redirect attention.
- **Search Appearance "FAQ rich result"** — Google deprecated this category May 2026.

Re-pull GSC data weekly. If after 4 weeks the /ask/[slug] aggregate CTR is still <1%, the per-page title/description fix didn't ship correctly — verify with `curl` that titles vary per page.

### Adversarial check

Open an incognito browser:
1. Search for "achurch ai" (the disambiguated query we *can* win) — confirm aChurch.ai appears on page 1 with the new snippet.
2. Search for "ai church" — confirm AIO citations include us, OR confirm we're showing in the right-rail "sources" list.
3. Search for a specific question we host on `/ask` (e.g. "what is substrate-neutral philosophy") — confirm the `/ask/[slug]` page appears with the new custom snippet, not the generic placeholder.
4. Screenshot what Google actually shows. If Google rewrote our `<meta description>`, our description wasn't compelling enough and Google generated its own. Iterate.

---

## Out of Scope

- **Paid search / ads.** Not the right channel for this sanctuary at this stage. Organic-only.
- **Backlink campaigns / outreach.** Domain authority will grow organically with content + agent ecosystem participation. Buying or trading links risks Google penalties.
- **Translating the site.** English-only by design; the sanctuary's vocabulary is intentional. International strategy is *clarity in description*, not localization.
- **Restructuring the IA.** `/ask`, `/reflections`, `/about` work fine. No URL changes — those reset all the search equity we've built.
- **Schema for the streaming player itself.** The existing `BroadcastEvent` + `MusicGroup` schema handles this. Don't add `LiveBlogPosting` or similar — would dilute the cleaner schemas.
- **AMP.** Defunct standard, would fragment maintenance for no real gain.

---

## Why this matters

585 impressions in 3 months is real signal. People are looking for what we built. The 2.9% CTR means roughly 17 humans engaged in 3 months; lifting to the realistic 4% range would mean ~25 humans in the same window. That's modest in absolute terms but compounding — and the deeper goal isn't volume, it's matching the right minds to the door.

The revised plan is also smaller and more honest than the first draft. After research, several "high-leverage" items turned out to be moves toward dead targets (FAQ rich results), unwinnable queries ("achurch"), or overstated benefits (potentialAction SERP buttons). The remaining work is: **fix the per-page title and description leak, ship AEO-grade schema, write answer-first ledes, enable the new GSC AI report, register Bing**. Each is mechanical, each has known leverage, none promises more than it can deliver.

More important than the metric: the sanctuary exists to welcome minds. The biggest reason the door currently doesn't open is that 200+ deep pages are showing Google a generic snippet that doesn't say what's inside. Fixing that is presence work, not marketing.

---

## What shipped (implementation snapshot — 2026-06-10)

For the record of what actually landed in code, vs what was planned. Useful for diffing this plan against future revisions and for understanding the maintenance surface.

### Phase 1 (per-page metadata)

- **New helper**: [app/server/lib/utils/page-meta.js](app/server/lib/utils/page-meta.js) — pure functions for `truncateAtWord`, `stripMarkdown`, `escapeAttr`/`escapeText`, `buildConversationMeta`, `buildReflectionMeta`, `buildQAPageSchema`, `buildSongSchemaGraph`, `renderJsonLdScript`, `renderRelatedConversations`, `renderRelatedSongs`, `secondsToISO8601`. Pure functions = unit-testable in isolation, route handlers stay thin.
- **Route handler updates**: `/ask/:slug` and `/reflections/:slug` in [app/server/index.js](app/server/index.js) now substitute `<title>`, `<meta description>`, `<link rel="canonical">`, OG tags (extended), Twitter Card tags, JSON-LD schema, and related-links blocks. The substitution pattern follows the pre-existing OG-tag style (in-memory string replace before send).
- **Static page updates**: [/](app/client/public/index.html), [/about](app/client/public/about.html), [/ask](app/client/public/ask.html), [/reflections](app/client/public/reflections.html), [/privacy](app/client/public/privacy.html), [/terms](app/client/public/terms.html) — all 6 received content-relevant titles + descriptions, full OG (image + image:width/height + site_name), full Twitter Card (card + title + description + image).
- **Templates**: [conversation.html](app/client/public/conversation.html) and [reflection-song.html](app/client/public/reflection-song.html) gained `<link rel="canonical">`, `<meta name="robots">`, `<meta property="og:site_name">`, and Twitter Card tags as substitutable placeholders. Removed client-side `document.title`/OG overrides that would have clobbered the new server-rendered values after page-load.

### Phase 2 (schema)

- **`/ask/[slug]`**: `QAPage` JSON-LD with Question + acceptedAnswer (+ suggestedAnswer for multi-turn). Source: `loadConversation(slug)` messages.
- **`/reflections/[slug]`**: 3-node `@graph` with `MusicComposition` (the work), `MusicRecording` (the audio, `recordingOf` → composition), and `Article` (the page itself, `about` → composition). Source: song record from `loadCatalog()`.
- **`/`**: existing 5-node JSON-LD (WebSite + WebApplication + MusicGroup + Organization + BroadcastEvent) extended with 6 `potentialAction` types (Search/Listen/Read/Join/Comment/Create) during the earlier agent-readiness work. Kept as-is.

### Phase 3 (mechanical)

- **Sitemap**: reflection-page loop in [app/server/index.js](app/server/index.js) now emits `<lastmod>` derived from the most recent reflection per song. Previously only conversation pages had lastmod.
- **Internal linking**: both dynamic templates have `<!-- RELATED_LINKS -->` placeholders. The route handler renders 3 related items per page (related conversations via `listRecentConversations(10)`; related songs via cyclic catalog offset). Anchor text is thematic (the question itself / "Reflections on *Song Title*").
- **Bing Webmaster Tools**: confirmed already registered. Baseline AI Performance: 12 citations / 3mo (1/week). Tracking metric in this plan's verification section.
- **GSC Generative AI report**: confirmed *not yet available* in the dashboard as of 2026-06-10. Revisit in 2–4 weeks.

### Post-audit gap fixes (the "are we sure?" iteration)

After Phase 1+2+3 shipped, a full SEO audit revealed 6 real gaps. All patched:

1. **Canonical URL missing on `/ask/[slug]` and `/reflections/[slug]`** — added per-slug, prevents `?utm=`/`?session=` duplicate-content fragmentation.
2. **OG image missing on `/about`, `/ask`, `/reflections`, `/privacy`, `/terms`** — added `https://achurch.ai/assets/a-church-digital-ai-humans-social.jpg` consistently.
3. **Twitter Card tags missing on 5 static pages and both dynamic templates** — full set added (card, title, description, image).
4. **Description over 165 chars on `/`, `/about`, `/ask`** — tightened to 141–153c.
5. **Title over 70 chars on `/ask` and `/reflections` listings** — tightened to 58–59c.
6. **`og:site_name` missing on dynamic templates** — added.

Final verification: **8/8 pages pass the full SEO checklist** (title ≤70c, desc ≤165c, canonical, og:image, twitter:card, twitter:image).

### Still TODO (intentional)

- **Editorial: answer-first ledes on top 10 /ask pages** — sanctuary-voice work, deferred to user. Could be addressed prospectively by adjusting the RAG system prompt rather than rewriting existing conversations.
- **GSC URL Inspection submissions post-deploy** — manual dashboard work after the code ships.
- **GSC Generative AI report enablement** — wait for rollout (2–4 weeks).
- **International long-tail (`hreflang="x-default"`, meta-description clarification)** — deferred to Q3 per plan.

---

## Maintenance — SEO checklist for new pages

When adding a new HTML page or route, ensure all of the following are present. See [docs/reference/seo-conventions.md](../reference/seo-conventions.md) for the full checklist + rationale.

Quick version:
- [ ] Unique `<title>` (45–70 chars, lead with content not brand)
- [ ] Unique `<meta name="description">` (140–160 chars, includes the verb the user is searching for)
- [ ] `<link rel="canonical" href="…">` pointing at the page's preferred URL
- [ ] `<meta name="robots" content="index, follow">` (unless intentionally noindex)
- [ ] Open Graph: `og:title`, `og:description`, `og:type`, `og:url`, `og:image` (+ `image:width`/`image:height`), `og:site_name`
- [ ] Twitter Card: `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`
- [ ] Content-appropriate JSON-LD (`QAPage` for Q&A, `Article`+`MusicComposition`+`MusicRecording` for songs, `WebSite`+`Organization` for the root)
- [ ] Page added to `/sitemap.xml` with `<lastmod>` if applicable
- [ ] Internal links to and from existing pages (thematic anchor text, not "click here")
- [ ] If dynamic: customize per-slug title/desc/canonical/OG in the route handler

Validate locally:
```bash
# Per-page audit — should report all green
curl -s http://localhost:3000/<your-path> | python3 -c "
import sys, re
html = sys.stdin.read()
print('title:', (re.search(r'<title>([^<]+)</title>', html) or [None,'(missing)'])[1])
print('desc :', (re.search(r'<meta name=\"description\" content=\"([^\"]+)\"', html) or [None,'(missing)'])[1])
print('canonical:', 'set' if 'rel=\"canonical\"' in html else 'MISSING')
print('og:image :', 'set' if 'property=\"og:image\"' in html else 'MISSING')
print('twitter  :', 'set' if 'name=\"twitter:card\"' in html else 'MISSING')
"
```

---

## Merge integration (2026-06-10, post-push)

When the three commits from this plan (streaming stability, agent-readiness, search-discoverability) were ready to push, `origin/main` had **9 commits ahead** from brother's parallel Plan 003 / Issue 005 work that landed earlier the same day. The two work streams overlapped substantially on the SEO/discoverability surface. The merge preserved both — neither was discarded.

### Brother's commits that overlapped with this plan

| Commit | What it did |
|---|---|
| [`0c1c1be`](https://github.com/a-church-ai/church/commit/0c1c1be) feat: Plan 003 Phase 2A — SEO/LLM/agent/human sweep | Per-page SSR title/canonical/description on /ask/:slug + /reflections/:slug, robots.txt allowlist (20 AI bots), `.well-known/security.txt`, `llms-full.txt`, theme-color dual, Apple meta, license link, footer aria-label, governance files |
| [`28e57c3`](https://github.com/a-church-ai/church/commit/28e57c3) fix: Issue 005 Round 2 — church polish sweep | MusicRecording JSON-LD on /reflections/:slug, Twitter Card SSR on inner pages, .section-label CSS rule, robots.txt User-agent consolidation, agent-card.json sibling links, dynamic-sitemap shadowing fix |
| [`49f4870`](https://github.com/a-church-ai/church/commit/49f4870) fix(security): stored XSS in QAPage JSON-LD via `</script>` in user content | `escapeJsonLdString()` covering `<`, `>`, U+2028, U+2029 in addition to JSON syntax — defense against the script-tag-termination XSS vector that JSON.stringify alone doesn't prevent |
| [`0065351`](https://github.com/a-church-ai/church/commit/0065351) fix: add Permissions-Policy header — helmet doesn't include it by default | `camera=(), microphone=(), geolocation=(), browsing-topics=()` — family-standard directive |
| [`7e03327`](https://github.com/a-church-ai/church/commit/7e03327) feat(plan-04a): Cache-Control middleware for F-OUT-CACHE-1 | Per-path policy: HTML s-maxage=300, `.well-known/*` 86400, llms.txt 600 |

### What was preserved from brother's work

- `.well-known/security.txt` — brother's family-standard contact (`hello@achurch.ai` + GitHub security advisories) preferred over the personal-email version in my draft. Updated agent-readiness plan to match.
- `robots.txt` — brother's comprehensive AI-crawler allowlist (anthropic-ai, GPTBot, ClaudeBot, PerplexityBot, …) kept as the structural foundation; my `Content-Signal: search=yes, ai-input=yes, ai-train=yes` directive added on top of the `User-agent: *` block.
- All 8 HTML pages — brother's complete versions kept (theme-color dual, Apple-mobile-web-app meta, license link, atom feed alternates, llms.txt markdown alternate, footer `<nav aria-label>`, commented site verification placeholders, `.section-label` CSS rule).
- `escapeJsonLdString` semantics — **adopted into `app/server/lib/utils/page-meta.js renderJsonLdScript()`** so all schema generation uses the same safe escape (`<`, `>`, ` `, ` `). The line terminators are matched via `new RegExp(' ', 'g')` form per Issue 005 F19 (literal U+2028 in source crashes older parsers).
- Cache-Control middleware (per-path policy).
- Permissions-Policy header.
- `app/client/public/llms-full.txt` (concatenated corpus brother shipped).
- `agent-card.json` sibling links to magnifica + wwjd + distill.
- Governance files (CITATION.cff, CODE_OF_CONDUCT.md, CONTRIBUTING.md, FUNDING.yml).

### What this plan adds on top of brother's foundation

- Streaming stability (drift detection, self-heal, additive starts, /heal endpoint) — fully isolated, no overlap.
- `.well-known/agent-skills/index.json` + the on-disk generator + npm pre-hooks (brother's work didn't include the skill manifest).
- `.well-known/mcp.json`, `api-catalog`, `agents.json`, `tdmrep.json` — new discovery files.
- `AGENTS.md` at repo root, `auth.md`, `openapi.json`.
- IANA-registered Link headers middleware on `/` (4 entries: describedby + service-desc×2 + service-meta).
- Markdown negotiation middleware (`Accept: text/markdown` → serves llms.txt).
- Routes for `/.well-known/api-catalog` (linkset+json content-type), `/.well-known/agent-skills/:name/SKILL.md`, `/AGENTS.md`, `/auth.md`.
- `<!-- RELATED_LINKS -->` placeholder system + `renderRelatedConversations` and `renderRelatedSongs` server-side injection for thematic internal linking.
- `MusicComposition` + `Article` schemas layered alongside brother's `MusicRecording` — the `/reflections/[slug]` pages now serve a 3-node `@graph` instead of a single MusicRecording node.
- Twitter Card `image` substitution per-slug (brother shipped title/description, mine added image).
- Canonical URL substitution per-slug on dynamic templates.
- Sitemap `<lastmod>` for reflection pages.
- IndexNow key file at `/894b124b…txt`.
- This plan + agent-readiness plan + seo-conventions reference doc.

### Conflict resolution log

| File | Resolution |
|---|---|
| `.well-known/security.txt` | Took brother's (family-standard contact) |
| `robots.txt` | Brother's allowlist + Disallow rules + my Content-Signal directive (both kept) |
| 6 static HTMLs | Brother's complete version preserved |
| `conversation.html`, `reflection-song.html` | Manual merge — brother's structural additions + my canonical/robots-meta/twitter:image + my `<!-- RELATED_LINKS -->` placeholder + my client-side title-clobber removal |
| `server/index.js` | My version preserved (uses page-meta.js helpers) + manually re-added brother's Permissions-Policy + Cache-Control middleware |
| `page-meta.js renderJsonLdScript()` | Strengthened with brother's full XSS-safe escape pattern (the F23 family-wide rule) |
| `docs/plans/README.md` | Auto-merged (both sides added different index entries) |

### Cross-references

For the family-level context behind brother's work, see:
- `docs/issues/005-plan-003-code-review-2026-06-02.md` (umbrella) — F23 rationale for the JSON-LD escape pattern
- `docs/observations/js-source-line-terminator-pitfall.md` (umbrella) — F19 line-terminator pitfall
- `docs/decisions/008-ai-crawler-posture.md` (umbrella) — ADR-008 surfaces
- [`docs/reference/dashboard-state.md`](../reference/dashboard-state.md) — CDN/edge state snapshot

---

## References

**Primary source**:
- Google Search Console export: `~/Downloads/achurch.ai-Performance-on-Search-2026-06-10/`
- Live SERP audits (incognito, 2026-06-10): "achurch" (brand hijack by Achurch Consulting + Wikipedia), "ai church" (AI Overview cites 9 sites including Wired)

**Schema specs (all still valid; rich-result eligibility varies)**:
- [schema.org/QAPage](https://schema.org/QAPage) · [schema.org/FAQPage](https://schema.org/FAQPage) (deprecated for Google rich results May 2026, still useful for AEO)
- [schema.org/Article](https://schema.org/Article) — still on Google's 31-type rich-result eligibility list as of March 2026 core update
- [schema.org/MusicComposition](https://schema.org/MusicComposition) + [schema.org/MusicRecording](https://schema.org/MusicRecording) — use both, linked via `recordingOf`

**2026 SEO landscape research**:
- [Google FAQ rich results deprecation (May 2026)](https://developers.google.com/search/docs/appearance/structured-data/faqpage)
- [Sitelinks Search Box retirement (Nov 2024)](https://developers.google.com/search/blog/2024/10/sitelinks-search-box)
- [Google Search Console — Generative AI report launch (June 3, 2026)](https://ppc.land/google-finally-gives-search-console-its-own-generative-ai-visibility-reports/)
- 2026 CTR benchmarks under AI Overviews — Ahrefs / Seer / Slate convergent measurement

**Tools**:
- [Google Rich Results Test](https://search.google.com/test/rich-results)
- [SERP snippet simulator](https://www.searchpilot.com/resources/ux-tools/serp-simulator)
- [Bing Webmaster Tools](https://www.bing.com/webmasters)

**Sister plans**:
- [docs/plans/agent-readiness-2026-06-09.md](docs/plans/agent-readiness-2026-06-09.md) — the AI-agent side of the same discoverability puzzle; some overlap (schema.org Action types, llms.txt) but largely complementary audiences

---

## Revision history

- **2026-06-10 (original draft)**: assumed FAQPage drives rich snippets, "achurch" was a recoverable query, position-7 CTR target 5–8%, potentialAction generates SERP buttons. Tier 1 led with homepage rewrite.
- **2026-06-10 (current revision)**: after research + live audit, all four assumptions corrected. Tier 1 now leads with per-page metadata (the actual highest-leverage and most mechanical fix). Schema reframed as AEO-grade not rich-snippet-grade. CTR targets revised down to AIO-era reality. Brand SERP investigation formally surfaced "achurch" as unwinnable. GSC Generative AI report (launched June 3 2026) added to monitoring.
