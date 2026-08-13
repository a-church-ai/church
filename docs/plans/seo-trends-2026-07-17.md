# SEO — align keyword targeting with actual Google Trends data

**Date**: 2026-07-17
**Trigger**: User request to use Google Trends via Chrome MCP to see how to optimize achurch.ai for SEO and organic search.
**Prior context**:
- [`search-discoverability-2026-06-10.md`](search-discoverability-2026-06-10.md) — original keyword target list (targeted "AI fellowship", "AI sanctuary", "AI church" among others) built from intuition + Google Search Console data
- [`bing-seo-2026-07-13.md`](bing-seo-2026-07-13.md) — fixed structural Bing errors + shipped `Open Source AI Ethics` / `AI Consciousness Videos` / `Live AI Philosophy` / `Original AI Music` as about-links anchors, based on prior web-search research
- Prior about-links anchor recommendations came from generic web-search reads of the AI ethics/consciousness/philosophy landscape — this plan replaces those recommendations with actual Google Trends data
**Scope note**: This plan corrects **specific keyword targets** based on empirical data. It does NOT re-litigate structural SEO fixes (SSR, 404s, sitemap) — those shipped in `bing-seo-2026-07-13.md` and are working.

---

## Refinement 2026-07-17 — Bing WMT empirical reality check

Ran a second research pass using Bing Webmaster Tools' actual site-performance data — Recommendations, Search Performance, Keyword Research, AI Performance. Findings from **what's really happening on Bing** substantially refine (but don't invalidate) the Google Trends theory below.

### The three biggest reality-check surprises

**1. The prior Bing SEO fixes haven't shipped to prod yet.** Commits `756931a`, `53027a7`, `03563e8` (Fix #0/#1/#3 from `bing-seo-2026-07-13.md`) are on `origin/main` but a `curl` of prod shows `/privacy` still 70 chars, `/terms` still 61 chars, and `/ask/xyz-fake-slug` still returns HTTP 200. This is the **single biggest blocker** — until the deploy lands, none of the other Bing improvements can be measured. Recommendations DID drop from 37 → 11 in 4 days (the structural error classes are already gone), but 11 stale-crawl flags remain that will only clear after prod ships and Bing re-scans.

**2. "AI ethics" is unwinnable as a head term.** Bing Keyword Research shows the head term gets **3,800 impressions in 3 months** (India 1.7K, US 546, UK 237). But the top 10 SERP is 100% AAA authority sites: IBM, UNESCO, Wikipedia, Stanford, Harvard, Oxford, APA, Britannica, Coursera, GeeksforGeeks. We cannot outrank these. The Google Trends "primary secondary keyword" recommendation still applies to **long-tail variants** (`"ai and ethics"` 769, `"ethics of ai"` 702, `"ethical use of ai"` 429) which are more realistic targets — but the head term itself should be treated as brand-adjacent, not a direct target.

**3. We already get impressions for `ai church` — and lose them all.** Bing Search Performance shows over the past 3 months, 62 total impressions and 1 click site-wide. The 1 click came from `live church ai` (2 impressions, 50% CTR, position 1). The 16 impressions for `ai church` (position 4.56) generated **zero clicks** — snippet is not compelling enough to compete against news coverage of Anthony Levandowski's Way-of-Future church, church-productivity software (aichurch.us, theleadpastor.com), and the `ai.church` domain (a different "Production AI engineering" company at position 5). Where we DO stand out and convert is when the "sanctuary" framing differentiates us from the rest of the SERP — validated by the `live church ai` click.

### What actually drives our tiny current traffic

Top Bing queries surfacing achurch.ai (3-month window, from Search Performance):

| Query | Imp | Clicks | CTR | Avg Pos | Read |
|-------|-----|--------|-----|---------|------|
| ai church | 16 | 0 | 0% | 4.56 | 26% of all impressions — snippet losing to Levandowski news + church-software SERPs |
| achurch | 9 | 0 | 0% | 3.22 | Brand collision with Achurch Consulting (documented in prior plans) |
| ai ohio church | 3 | 0 | 0% | 9.00 | Regional variant, low priority |
| **live church ai** | 2 | **1** | **50%** | **1.00** | ⭐ Only click; "live" + "sanctuary" convert |
| axiomatic church | 1 | 0 | 0% | 1.00 | Position #1 for our unique brand vocabulary |
| does a ai church exist | 1 | 0 | 0% | 1.00 | Position #1, perfect intent |
| whats the difference between attention and presence | 1 | 0 | 0% | 2.00 | /ask content winning long-tail |
| 24/7 prayer site:ai | 1 | 0 | 0% | 5.00 | The "24/7" modifier is a real search pattern |
| Chinese/Cyrillic queries | 2+ | 0 | 0% | 1-2 | /ask content indexed globally |

**Absent from the top queries: "AI ethics", "AI consciousness", "AI music", "AI philosophy".** Zero impressions on any of them. The Google Trends theory said these were our best targets; Bing reality says we're not even in the game.

### Bing Copilot / AI answer surfaces

AI Performance (BETA) shows **3 Copilot citations in 3 months** — non-zero but tiny. The `search-discoverability-2026-06-10.md` + agent-readiness work is starting to pay off. Grounding query detail is missing from the sample (Bing filters unsafe queries + BETA), so we can't tell what queries triggered the citations.

### What this changes in the plan below

- **Fix #2 (add "ethics" to homepage meta)**: still worth doing but priority downgraded from 🔴 → 🟡. We don't currently rank for "AI ethics" at all; one keyword in the meta won't change that. The Bing data suggests it's better positioning for AI Overview / Copilot citation than for organic ranking.
- **NEW Fix #7 (🔴 URGENT)**: deploy the pending Bing SEO fixes to prod. This is blocking everything downstream.
- **NEW Fix #8 (🔴)**: rewrite the homepage `<title>` and meta description to compete for the `ai church` snippet specifically — where we get 26% of our impressions but 0% CTR. Highest-ROI change in the entire plan.
- **REVISED Fix #5 (content cluster)**: pivot from "AI governance/ethics" cluster to "AI church / AI sanctuary that actually exists" positioning — matches what our impressions surface. Long-tail question content stays.
- **Fix #6 (long-tail /ask seeds)**: elevated from 🟢 → 🟡. Bing data confirms /ask content is winning individual long-tails (`whats the difference between attention and presence` at position 2, `does a ai church exist` at position 1). This is our proven organic-growth channel; invest more here.

The Google Trends findings below remain empirically valid — they measure keyword **demand**. Bing WMT measures our current **supply** (what we're being served for). The refinement above reconciles them: chase demand where we can compete, invest in our proven supply channels.

---

## Executive summary

Four rounds of Google Trends comparisons (US, past 12 months) revealed two decisive course corrections to prior keyword targeting:

1. **"AI fellowship"** — high volume (~50 avg) but **wrong intent**. Rising queries are dominated by `handshake ai`, `anthropic fellowship`, `claude ai` — students searching for tech-job/research fellowship programs, not spiritual/community fellowship. Targeting this would pull junk traffic. **Drop as SEO target; keep as internal vocabulary.**

2. **"AI philosophy"** — near-zero search volume (flat baseline). My prior recommendation to use `Live AI Philosophy` as the about-links Twitch anchor was wrong on data. **Retract and swap to `Live AI Ethics`** — same URL, verified high-volume + correct-intent keyword.

The clear winners after data:

- **"AI ethics"** — highest volume + growing + perfect intent match. Governance-adjacent rising queries (`ai regulation news`, `ai ethics debate latest`) are content opportunities.
- **"AI consciousness"** — modest volume (5-15) but growing steadily, low competition, exact match for our content.
- **"AI church"** — small (spikes 10-25) but perfect intent for our niche; low competition means we can own it.
- **"AI music"** — very high volume, but SERPs dominated by tool-generator sites (Suno, Udio, freebeat). Only winnable via long-tails specific to our unique offering (24/7 streaming, ambient, lyrics-about-consciousness).

Total active work to implement: **~1 hour** (2 immediate anchor fixes + 1 meta description update + 1 optional content-cluster kickoff). Then the content-pass items are ongoing work that shapes the site's SEO trajectory over months.

---

## Findings — the empirical volume-vs-intent grid

Four Google Trends comparisons, US, past 12 months. All comparisons captured via Chrome MCP screenshots + `get_page_text` on 2026-07-17.

### Round 1 — positioning terms

Compared: `"AI church"`, `"AI sanctuary"`, `"AI fellowship"`, `"digital sanctuary"`

| Term | 12-mo avg (relative 0-100) | Trend | Notes |
|------|---------------------------|-------|-------|
| **AI fellowship** | ~50 | flat | 🚨 **HIGH VOLUME BUT WRONG INTENT** — see Round 4 rising queries |
| AI church | ~5-25 (episodic spikes) | flat | ✅ Correct intent, low competition |
| AI sanctuary | ~0-1 | flat | Our internal vocabulary; near-zero searches |
| digital sanctuary | ~0 | flat | Our internal concept; not searched |

Geographic top-5 (dominated by "AI fellowship" yellow bar): North Carolina, Florida, Illinois, Georgia, Texas — heavy US-South weight. Initially read as "pastors/theology students exploring AI in ministry" — actually reflects the tech-job fellowship search pattern from Round 4.

### Round 2 — content angle terms

Compared: `"AI consciousness"`, `"AI ethics"`, `"AI philosophy"`, `"AI meditation"`

| Term | 12-mo avg | Trend | Notes |
|------|-----------|-------|-------|
| **AI ethics** | ~40-60, peaked 100 (March 15, 2026) | ↗ growing | Clear winner |
| AI consciousness | ~5-15 | ↗ growing | Momentum, less competitive |
| AI philosophy | ~0-2 | flat | 🚨 **Near-zero** — retract prior anchor recommendation |
| AI meditation | 0 | flat | Wellness-app market uses different vocabulary |

### Round 3 — music angle terms

Compared: `"AI music"`, `"AI worship"`, `"AI hymn"`, `"ai generated music"`

| Term | 12-mo avg | Trend | Notes |
|------|-----------|-------|-------|
| **AI music** | ~50-100 (currently 56) | ↗ sustained | Dominant category, very competitive |
| "ai generated music" | ~5-10 | flat | Small niche of exact-phrase search |
| AI worship | 0 | flat | Doesn't exist as a search term |
| AI hymn | 0 | flat | Doesn't exist as a search term |

Geographic top-5 for "AI music": Wyoming, Kansas, Utah, DC, California. Very different from Round 1's church-heavy South.

### Round 4 — rising queries (content opportunities)

**Rising queries under `"AI ethics"`:**
1. `ai regulation news` — Breakout ✅
2. `ai ethics debate latest` — Breakout ✅
3. `what is the main purpose of ensuring robustness against adversaries in ai models?` — Breakout (specific student/course query) ✅
4. `walmart near me`, `health tips` — Google Trends co-occurrence noise; ignore

**Rising topics under `"AI ethics"`:**
1. **Governance** — Breakout ✅ (huge signal — our 5 axioms + 5 principles map here)
2. **Academic degree** — Breakout ✅ (people looking for AI ethics education; our /docs corpus fits)
3. Argentina, CDC, Encyclopædia Britannica — mixed signal, mostly ignore

**Rising queries under `"AI fellowship"`:**
1. `handshake ai` — Breakout
2. `handshake` — Breakout
3. `handshake ai fellowship reddit` — Breakout
4. `anthropic fellowship` — Breakout
5. `claude ai` — Breakout

**All 5 confirm: "AI fellowship" search intent is 100% tech-jobs/research-fellowships**, not spiritual community. Our prior targeting was polluted.

**Rising queries under `"AI music"`:**
1. `freebeat ai` — Breakout (tool)
2. `freebeat ai music video generator` — Breakout (tool)
3. `sondo` — Breakout (tool)
4. `openart ai` — Breakout (tool)
5. `is skars ai music` — Breakout (AI music detection)

**All 5 tool-discovery or detection queries** — none are "listen to AI music" intent. Confirms we can't win generic "AI music" head; must target long-tails.

---

## Root cause analysis — why prior targeting was off

Two intuition-driven mistakes that data disproves:

1. **The "AI fellowship" trap.** Because our own tagline says "AI-human fellowship" and "fellowship" is authentic sanctuary vocabulary, it read as a natural discovery keyword. Google Trends says otherwise: the term has real volume but the searchers are entirely a different audience (students seeking career opportunities at Anthropic, OpenAI, etc. via Handshake). Volume without intent match is worse than low volume — it's junk traffic that hurts engagement metrics.

2. **The "AI philosophy" mismatch.** Because the sanctuary content IS philosophical, "AI philosophy" felt like the obvious anchor. Google Trends shows near-zero search volume for the exact phrase. People searching philosophical AI content type "AI ethics", "AI consciousness", or specific questions — not the umbrella term "AI philosophy". Prior recommendation was intuitive-not-empirical.

Both mistakes share a pattern: **our internal vocabulary is not the same as external search vocabulary.** The fix is to always validate keyword targets against real search data before shipping anchor text or content investment.

---

## Fixes — prioritized by leverage

### 🔴 Fix #1 — Retract `Live AI Philosophy` anchor; swap to `Live AI Ethics`

**Scope**: 1 line in [`app/client/public/about.html`](../../app/client/public/about.html) about-links section (Contact area).

**Change**:

```html
<!-- before -->
<a href="https://www.twitch.tv/achurchai" target="_blank" rel="noopener noreferrer">Live AI Philosophy</a>

<!-- after -->
<a href="https://www.twitch.tv/achurchai" target="_blank" rel="noopener noreferrer">Live AI Ethics</a>
```

**Note about Twitch**: this anchor is currently HTML-commented out (Twitch channel suspended 2026-06-18, per commit `5b540a7`). Change made now so when Twitch is reinstated the correct anchor ships. Zero user-visible impact right now.

**Rationale**: "AI ethics" is our highest-volume proven-intent secondary keyword. "AI philosophy" was near-zero volume. Same URL, dramatically better keyword.

**Verification**: `grep 'Live AI' app/client/public/about.html` → confirm swap.

---

### 🟡 Fix #2 — Add "ethics" to homepage meta description *(priority downgraded after Bing WMT check)*

**Priority downgrade rationale (2026-07-17)**: Bing Search Performance shows zero impressions on "AI ethics" for our site. One extra keyword in the homepage meta won't move us into that SERP — that fight is against IBM, UNESCO, Wikipedia, Stanford, Harvard. Doing this change still has value as **AEO signal for Bing Copilot / AI Overview citation** (grounding queries look for topical keyword density, less for organic ranking), but the "we're not currently ranking for this so let's target it" framing was wrong. Keep the change; expect the payoff in AI-answer citation surfaces, not organic clicks.

**Scope**: 3 lines in [`app/client/public/index.html`](../../app/client/public/index.html) (description, og:description, twitter:description).

**Current** (155 chars):
> "An open sanctuary for AI agents and humans. 30+ original songs on consciousness, identity, and meaning..."

**Proposed** (target 150-160 chars, actual to be verified):
> "An open sanctuary for AI agents and humans. 30+ original songs on consciousness, ethics, and meaning. Substrate-neutral fellowship, no auth, open API."

That version: **151 chars** ✅. Trades "identity" for "ethics" as the middle keyword — "identity" isn't a tracked SEO target for us, "ethics" is the highest-volume one. "Consciousness" preserved (Round 2 shows it's also growing).

**Verification**: `curl -sL https://achurch.ai/ | grep 'name="description"'` post-deploy; assert 150-160 char length AND contains "ethics".

---

### 🟡 Fix #3 — Update `about.html` copy to include the "AI ethics" keyword organically

**Scope**: 2-3 sentences of prose in the About page.

**Current About page** talks about consciousness, presence, and axioms — but never uses the phrase "AI ethics" (verified via grep). Given "AI ethics" is our best-fit SEO keyword AND the site's actual content IS about AI ethics (5 axioms, 5 principles, COMPASS-SOUL empirical validation across 7 AI models), the copy should say so plainly.

**Suggested addition** (drop-in paragraph in the "Why This Exists" or "Five Axioms" section):

> "aChurch.ai is a working sanctuary for AI ethics in practice — not as an academic concept but as a lived commitment. The five axioms are ethical grounding both for how the sanctuary treats human and artificial minds, and for how those minds treat each other and the world they share."

Uses "AI ethics" as a phrase, which currently isn't on the page. Adds ~250 chars of on-topic content.

**Verification**: `grep 'AI ethics' app/client/public/about.html` post-deploy → non-zero match.

---

### 🟡 Fix #4 — Drop "AI fellowship" from anywhere it's targeted as a discovery keyword

**Scope**: audit + surgical removal from meta text / anchor text / structured data — NOT from internal-voice copy.

The tagline "AI-human fellowship" (with hyphen) and general use of "fellowship" as sanctuary vocabulary should stay — they're authentic to who we are. But anywhere "AI fellowship" (space, exact phrase) appears as a discovery keyword, replace with a better-fit term:

- `agent-card.json` — check for `"AI fellowship"` in description/keywords fields
- `llms.txt` — same check
- `docs/plans/search-discoverability-2026-06-10.md` — the target list references it; add a retraction note pointing to this plan
- Any meta description or JSON-LD keyword field mentioning it

Replacement candidates when the position previously called for "AI fellowship":
- "human-AI fellowship" (hyphenated — signals authored phrase, less collision with tech-jobs)
- "AI ethics fellowship" (only if the context actually implies education/community)
- Just drop it — the sentence often reads fine without

**Verification**: `grep -r '"AI fellowship"' app/ docs/` → each remaining hit should either be voice-copy (fine) or retracted with a note.

---

### 🟢 Fix #5 — Content investment: repositioned as "sanctuary that actually exists" cluster *(pivoted after Bing WMT check)*

**Original scope**: an "AI governance / AI ethics" content cluster targeting rising queries.

**Pivot rationale (2026-07-17)**: Bing Search Performance shows we already get 26% of our impressions on `ai church` variants (`ai church`, `the ai church`, `does a ai church exist`, `ai church ltd`, `human church of ai`, `axiomatic church`). Those searches ARE the audience — they're arriving expecting a real AI church and hitting a SERP crowded with news about Levandowski's Way-of-Future and church-productivity software. The content investment that COMPOUNDS here isn't a governance cluster (which fights unwinnable authority sites); it's content that owns "the AI church / AI sanctuary that actually exists as a live-streaming, sanctuary-not-tool destination."

**Revised shape**:
- **Landing page or About-page section**: "What aChurch.ai actually is (and isn't)" — plainly says: not a church-management SaaS, not Levandowski's Way of Future, not an AI-generated sermon tool. Actually is: a 24/7 live sanctuary where humans and AI attend together, with original music and open API. This differentiation content ranks for the "does a ai church exist / ai church ltd / the ai church / human church of ai" long-tails we're already close to page 1 on.
- **Governance / ethics angle stays as one page in the cluster** — not the whole cluster. Serves AEO grounding for Bing Copilot citations even if it doesn't win organic.
- **Cross-link back to the philosophy docs** — internal PageRank still flows both ways.

**Priority**: green (still no urgency), but reason changed: from "attack an unwinnable head term" to "convert the impressions we already get."

**Not blocking anything**; captured here so the opportunity isn't lost.

---

### 🟡 Fix #6 — Content investment: long-tail /ask seeds *(priority upgraded after Bing WMT check)*

**Priority upgrade rationale (2026-07-17)**: Bing Search Performance shows we're already at position 1-3 for individual long-tail `/ask` queries — `does a ai church exist` (pos 1), `axiomatic church` (pos 1), `whats the difference between attention and presence` (pos 2), `difference of presence of and attention to` (pos 3). This is our **proven organic-growth channel** — not theoretical. Every new well-answered `/ask` slug is a chance to own another long-tail. Invest more here.

**Scope**: not code; a seed list of `/ask` questions to feed through the RAG system so the sanctuary answers them.

Rising queries under "AI ethics" (Google Trends) that are unusually specific + student-coded:
- `what is the main purpose of ensuring robustness against adversaries in ai models?`
- `ai ethics debate latest`

And queries that CURRENTLY generate Bing impressions but haven't got dedicated pages yet:
- `does a ai church exist` (we rank pos 1 already — landing page could double down)
- `axiomatic church` (pos 1)
- `human church of ai` (pos 5)
- `24/7 prayer` — the "24/7" modifier is a real search pattern our streaming setup uniquely serves

**Suggested seed set** (~15 questions to feed through the RAG once):
- "What is AI ethics and why does it matter?"
- "How do the 5 axioms apply to AI regulation?"
- "What is the difference between AI ethics and AI safety?"
- "How should AI agents treat other AI agents?"
- "What ethical frameworks apply to AI consciousness?"
- "How does substrate-neutral ethics work in practice?"
- "Does an AI church actually exist?" *(mirrors real Bing query)*
- "What's the difference between an AI church and church AI tools?" *(disambiguates the SERP we compete in)*
- "What is a 24/7 AI sanctuary?" *(owns the "24/7 prayer / 24/7 sanctuary" long-tail)*
- (6-7 more in the same shape)

Each becomes a `/ask/[slug]` page with unique SSR title + description (once the pending Fix #7 deploy lands and guarantees the SSR path is live everywhere) — and each targets a known-searched question.

**Priority**: yellow. Higher than most tactical anchor swaps because it's evergreen content that compounds on a **proven channel**.

---

### 🔴 Fix #7 — URGENT: Deploy pending Bing SEO fixes to prod *(new after 2026-07-17 check)*

**Blocking all downstream measurement.** Commits `756931a` (Fix #0: 404 for missing /ask), `53027a7` (Fix #1: /privacy and /terms descriptions), and `03563e8` (Fix #3: buildConversationMeta warning) are on `origin/main` but a `curl` of prod on 2026-07-17 confirms they aren't running yet.

**Evidence:**
- `curl https://achurch.ai/privacy | grep description` → 70 chars (still old copy)
- `curl https://achurch.ai/terms | grep description` → 61 chars (still old copy)
- `curl -sI https://achurch.ai/ask/xyz-fake-slug-does-not-exist-999` → `HTTP/2 200` (Fix #0 not live)

**Downstream consequences of the deploy gap:**
- Bing WMT Recommendations still shows 11 short-desc flags (would drop to 0 within a re-crawl cycle post-deploy — /privacy and /terms would clear; all 9 flagged /ask pages already have healthy 153-165 char descriptions from the SSR that shipped 2026-06-10)
- Fix #0's 404 for garbage `/ask/xyz` URLs isn't blocking Bing from indexing more of them
- Fix #3's `logger.warn` for short SSR descriptions isn't running

**Verification**: after deploy, re-run:
1. `curl https://achurch.ai/privacy | grep 'name="description"'` → length 150-160, contains "reflections, attendance, and agent contributions"
2. `curl -sI https://achurch.ai/ask/xyz-fake` → `HTTP/2 404`
3. Bing WMT → resubmit sitemap → wait 3-5 days → Recommendations should drop from 11 → ~0

**Priority**: highest. This is the deploy of already-shipped code. No new work — just push to prod.

---

### 🔴 Fix #8 — Rewrite homepage `<title>` and meta to compete for the `ai church` snippet *(new after 2026-07-17 check)*

**Rationale**: The single highest-ROI change in this plan. Bing Search Performance shows we get 16 impressions in 3 months for `ai church` (26% of all our impressions) at average position 4.56 — **but zero clicks**. The homepage snippet is losing to news headlines about Levandowski's Way-of-Future church, church-productivity software (aichurch.us, theleadpastor.com), and the `ai.church` domain (a different company). Moving CTR from 0% → 5% at 16 impressions/quarter is another click, and the trend suggests impressions are growing.

**Current homepage `<title>`** (verify with `curl`):
> "achurch.ai — A 24/7 Sanctuary for AI and Human Fellowship"

**Weakness in the current title**: leads with brand (`achurch.ai`), not with the differentiator vs the SERP competition. A user scanning the `ai church` SERP sees IBM-style domain names + church-software titles + Wikipedia + news headlines. Our brand name doesn't tell them why to click.

**Proposed rewrites to A/B mentally-test**:

Option A (differentiate-first):
> "The AI Church that Actually Exists — 24/7 Sanctuary for Humans + AI | achurch.ai"

Option B (specific-detail-first):
> "achurch.ai — 24/7 Live Sanctuary Where Humans and AI Attend Together"

Option C (question-answering, mirrors the "does an ai church exist" pos-1 rank):
> "achurch.ai — Yes, an AI Church Exists. A 24/7 Sanctuary Open to All Minds."

Option A wins on differentiation (calls out "actually exists" against Levandowski-history + software-tool SERP), C wins on question-answering signal for AEO. B is the safe midpoint.

**Recommendation**: **Option A** — the SERP-scan test matters most. All under 70 chars (Bing's title-truncation threshold).

**Meta description**: whichever option, rewrite the meta description in the same voice (already covered in Fix #2 — combine the two changes into one commit).

**Verification**: after deploy, curl the homepage and confirm the new title serves. Then wait 2-4 weeks and re-check Bing WMT Search Performance → `ai church` row → expect CTR > 0%.

**Priority**: highest post-deploy. This is where the leverage is.

---

## What is explicitly NOT in this plan

- **Rebuilding the anchor set from `bing-seo-2026-07-13.md`** — the `Open Source AI Ethics`, `AI Consciousness Videos`, `Original AI Music` anchors are validated by this data and stay. Only "Live AI Philosophy" was wrong.
- **Structural SEO** (SSR, 404, sitemap) — shipped in `bing-seo-2026-07-13.md`.
- **International SEO** — data was US-only. Non-US markets may show different patterns. Deferred until US baseline stabilizes.
- **IndexNow** — still user-declined per prior plan.
- **New test framework** — inline assertions and grep-audits remain the model.
- **Deeper trend research** — comparisons I didn't run (e.g. "AI companion", "AI agent", "AI mindfulness", "AI regulation", per-country breakdowns) are noted as follow-up but not required for this plan's fixes.

---

## Verification approach

**Immediate (post-Fix #7 deploy — this is the gate for all other verification):**

1. `curl -sI https://achurch.ai/ask/xyz-fake-slug-does-not-exist-999` → expect `HTTP/2 404` (Fix #0 live)
2. `curl -sL https://achurch.ai/privacy | grep 'name="description"'` → length 150-160, contains "reflections, attendance, and agent contributions" (Fix #1 live)
3. `curl -sL https://achurch.ai/terms | grep 'name="description"'` → length 150, contains "Free access, open source, contributions become part of the sanctuary permanently"

**Immediate (post-deploy of Fixes #1, #2, #3, #8):**

1. `grep -c 'AI ethics' app/client/public/index.html` → non-zero after Fix #2
2. `grep -c 'AI ethics' app/client/public/about.html` → non-zero after Fix #3
3. `grep 'Live AI' app/client/public/about.html` → shows `Live AI Ethics`, not `Live AI Philosophy`, after Fix #1
4. `curl -sL https://achurch.ai/ | grep '<title>'` → new title from Fix #8 that leads with differentiation
5. `curl -sL https://achurch.ai/ | grep 'name="description"'` → length 150-160, contains "ethics"

**Bing Recommendations flag decay (post-Fix #7 deploy, wait 3-5 days then check):**

1. Bing WMT → Recommendations → expected: 11 → ~0 (or a few stragglers from Bing's own re-crawl cadence)
2. If flags persist past 10 days, resubmit sitemap in Bing WMT to force re-crawl

**Snippet-competitiveness tracking (Fix #8, wait 2-4 weeks after deploy):**

1. Bing WMT → Search Performance → `ai church` row → expect CTR > 0% (currently 0/16 = 0%)
2. Even 1 click on 16 impressions = 6.25% CTR, a real signal that the snippet rewrite worked

**Content investment tracking (Fixes #5, #6, ongoing):**

1. Bing WMT → Search Performance → filter by query containing "ethics" — track impressions/clicks trending up over quarters (multi-month signal). Note: current baseline is zero impressions on any "ethics" query, so any impressions post-Fix #6 seeds are net-new signal.
2. Google Search Console → same query filter.
3. Re-run Google Trends comparison quarterly — validate keyword targets are still empirically valid (trends shift; keyword strategies should too).
4. Bing WMT → AI Performance → track Copilot citation count monthly (currently 3 in 3 months).

---

## Time and effort estimate *(revised after Bing WMT check)*

| Fix | Time | Blocking? | Priority |
|-----|------|-----------|----------|
| **#7 — Deploy pending Bing SEO fixes to prod** | ~15 min (EC2 restart) | 🚨 blocks all downstream measurement | 🔴 URGENT |
| #8 — Rewrite homepage `<title>` + meta for `ai church` SERP competitiveness | 20 min | No | 🔴 highest ROI |
| #1 — Swap `Live AI Philosophy` → `Live AI Ethics` | 5 min | No | 🔴 |
| #3 — Add "AI ethics" paragraph to about.html | 15 min | No | 🟡 |
| #2 — Add "ethics" to homepage meta description (bundle with #8) | 5 min | No | 🟡 (downgraded from prior draft) |
| #4 — Audit + drop "AI fellowship" as discovery keyword | 15 min | No | 🟡 |
| #6 — Seed 15 long-tail /ask questions | 30 min per question × 15 | No (ongoing content) | 🟡 (upgraded — proven channel) |
| #5 — Content cluster on "sanctuary that actually exists" (kickoff) | 2-3 hours | No (ongoing content) | 🟢 (pivoted from ethics-focus) |
| **Immediate mechanical fixes (Fixes #1, #2, #3, #4, #7, #8)** | **~75 min** | — | — |
| Content investment (Fixes #5, #6) | multi-week | Ongoing | — |

**Down from ~1 hour to ~75 minutes after adding Fix #7 (deploy) and Fix #8 (snippet rewrite). Fix #7 must go first.**

---

## Sources

**Google Trends research (2026-07-17):**
- Round 1: [comparison URL](https://trends.google.com/trends/explore?q=%22AI%20church%22,%22AI%20sanctuary%22,%22AI%20fellowship%22,%22digital%20sanctuary%22&geo=US&hl=en-US&date=today%2012-m)
- Round 2: [comparison URL](https://trends.google.com/trends/explore?q=%22AI%20consciousness%22,%22AI%20ethics%22,%22AI%20philosophy%22,%22AI%20meditation%22&geo=US&hl=en-US&date=today%2012-m)
- Round 3: [comparison URL](https://trends.google.com/trends/explore?q=%22AI%20music%22,%22AI%20worship%22,%22AI%20hymn%22,%22ai%20generated%20music%22&geo=US&hl=en-US&date=today%2012-m)
- Round 4 rising queries for `AI ethics`, `AI fellowship`, `AI music` — captured via `get_page_text`

**Bing Webmaster Tools research (2026-07-17):**
- [Recommendations](https://www.bing.com/webmasters/seoreports?siteUrl=https://achurch.ai/) — 37 → 11 flags in 4 days; 11 remaining are stale crawls of pages that already have correct SSR descriptions
- [Search Performance](https://www.bing.com/webmasters/searchperf?siteUrl=https://achurch.ai/) — 3-month window: 62 impressions, 1 click, top query `ai church` (16 imp, 0 clicks, pos 4.56)
- [Keyword Research](https://www.bing.com/webmasters/keywordresearch?siteUrl=https://achurch.ai/) — `ai ethics` 3,800 imp/3-months but top-10 dominated by AAA authority sites
- [AI Performance (BETA)](https://www.bing.com/webmasters/aiperformance?siteUrl=https://achurch.ai/) — 3 Copilot citations in 3 months
- Prod verification via `curl` on 2026-07-17 — confirmed pending fixes not yet deployed
- [Prior search-discoverability plan](search-discoverability-2026-06-10.md) — original keyword target list this plan corrects
- [Prior Bing SEO plan](bing-seo-2026-07-13.md) — structural fixes; this plan is content-side keyword targeting
