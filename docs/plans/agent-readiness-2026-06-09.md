# Plan: Agent Readiness Enhancements

**Created**: 2026-06-09
**Updated**: 2026-06-10 — Pushed to main as commit `b2116e4`. Cloudflare dashboard items completed (Crawler Hints, AID v2 TXT, AI crawler unblocking). During the post-push merge with brother's parallel Plan 003 work, the `security.txt` contact was updated from `lucas@geeksinthewoods.com` to the family-standard `hello@achurch.ai` + GitHub security advisories endpoint. Earlier updates: web research + live site audit, code implementation, IANA-rel correction.
**Status**: **Pushed to main** (commit `b2116e4`) — pending production redeploy. Tier 3 dashboard items ✅ done. IETF DNS-AID SVCB and WebMCP remain deferred per plan.
**Trigger**: [isitagentready.com/achurch.ai](https://isitagentready.com/achurch.ai) scan — scored 21/100, Level 1 (Basic Web Presence)

---

## Context

aChurch.ai's mission is to be a sanctuary discoverable to other minds, carbon or silicon. The Cloudflare "Is Your Site Agent-Ready?" scan revealed that while our human-facing surface is complete (homepage, sitemap, robots.txt, 6 documented API endpoints, 3 published ClawHub skills), our **agent-facing discovery surface is almost entirely missing**. Agents who arrive don't have a standardized way to enumerate our skills, find the API, or read content in their preferred format.

The gap is consequential because we already have everything an agent needs — we just haven't published the standardized pointers. We have:
- A real REST API (`/api/now`, `/api/attend`, `/api/reflect`, `/api/music`, `/api/contribute`, `/api/ask`) with `next_steps`/`suggestion` fields already wired in
- A `skills/` directory with 3 SKILL.md files
- An A2A-style `agent-card.json` already at `/.well-known/`
- A `robots.txt` that explicitly welcomes bots
- Documentation in markdown that could be served as-is

This plan turns the 21/100 score into a Level 3–4 (Agent-Ready / Agent-Integrated) result by adding standardized discovery files. Realistic ceiling is **60–75/100** — the sister-project at obviouslynot.ai (similar content + skills shape) shipped to 50/100 with fewer optional surfaces than we have. Discoverability tops out at 75 (no DNS-AID for a site that doesn't host MCP/A2A endpoints); the API/Auth/MCP cluster will pass ~4/7 with what we ship (skills, API catalog, MCP file, auth.md) and N/A the rest (no auth, no WebMCP yet) rather than fake metadata to chase a number. The work aligns directly with the project's substrate-neutral framing: every enhancement makes the sanctuary easier for an AI to find, enter, and understand.

---

## Scan Results Summary

| Category | Score | Notes |
|---|---|---|
| Discoverability | 2/4 | robots.txt ✓ · Sitemap ✓ · Link headers ✗ · DNS-AID ✗ |
| Content | 0/1 | Markdown negotiation ✗ |
| Bot Access Control | 1/2 | AI bot rules ✓ (wildcard) · Content Signals ✗ · Web Bot Auth N/A |
| API / Auth / MCP / Skills | **0/7** | All fail — this is the priority |
| Commerce | Not checked | Not a commerce site |

---

## Live Site Audit (2026-06-09)

Direct probes of `https://achurch.ai` confirm the scan and surface two assets the scan didn't even check:

| Path | Status | Notes |
|---|---|---|
| `/robots.txt` | **200** | Welcoming text, sitemap reference, llms.txt reference |
| `/sitemap.xml` | **200** | 80KB, well-formed |
| `/.well-known/agent-card.json` | **200** | A2A v1.0 card with all 8 skills — *scan didn't check this path* |
| `/llms.txt` | **200** | Already published — *scan didn't check this either* |
| `/.well-known/agent-skills/index.json` | 404 | |
| `/.well-known/mcp/server-card.json` | 404 | |
| `/.well-known/mcp.json` | 404 | |
| `/.well-known/api-catalog` | 404 | |
| `/.well-known/oauth-protected-resource` | 404 | (intentional — no auth) |
| `/.well-known/security.txt` | 404 | |
| `/.well-known/tdmrep.json` | 404 | |
| `/.well-known/agents.json` | 404 | |
| `/openapi.json` | 404 | |
| `/auth.md` | 404 | |
| `/AGENTS.md` | 404 | |
| `/humans.txt` | 404 | |
| Homepage `Accept: text/markdown` | text/html | Negotiation not implemented |
| Homepage `Link:` response headers | absent | |

**Implication**: the existing A2A agent-card.json and llms.txt are real wins already in place — keep both, build alongside them. The 21/100 score is even more misleadingly low than it suggests because the scan misses these two assets.

---

## Web Research — Standards the Scan Missed

Beyond the 14 checks the scan runs, additional 2026-era agent-readiness standards exist. Three are worth adding to this plan:

1. **`AGENTS.md`** at repo root — Linux Foundation-stewarded markdown file for *coding* agents (Cursor, Codex, Claude Code) describing how to build/test/contribute. 60K+ repos. Different audience from web visitors — but very on-brand for the sanctuary's "any mind is welcome to contribute" framing. Spec: [agents.md](https://agents.md/).
2. **TDMRep** at `/.well-known/tdmrep.json` — W3C Community Group Final Report. The *legally enforceable* counterpart to Content Signals under the **EU AI Act / CDSM Directive**. Layers with Content Signals (Cloudflare-led convention) and gives EU agents an authoritative training-permission signal. Spec: [W3C TDMRep](https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240202/).
3. **schema.org `potentialAction` JSON-LD** in homepage `<head>` — how search-arriving agents discover *what your site can do*: mark up `ListenAction` on songs, `ReadAction` on lyrics, `CommentAction` on `/api/reflect`. Complements OpenAPI/MCP (which are for agents already on your API surface).

Two cheaper additions:

4. **`security.txt` (RFC 9116)** at `/.well-known/security.txt` — 2-min publish; agents check it when evaluating site maturity.
5. **`agents.json` (wild-card-ai)** at `/.well-known/agents.json` — OpenAPI extension for LLM endpoint discovery. Lower adoption than MCP; cheap once OpenAPI exists.

**Explicitly skipped from research**:
- `ai-plugin.json` — **dead** (ChatGPT plugins deprecated; do not publish).
- `ai.txt` (Spawning-style) — overlaps Content Signals + TDMRep with weakest momentum of the three.

---

## Spec Corrections from Research (June 2026)

Web research surfaced spec details that the initial draft of this plan had wrong or fuzzy. Corrections folded into the Tier 1 sections below:

- **Content Signals syntax is `yes`/`no`, NOT `allow`/`disallow`**. Only three valid signal names exist: `search`, `ai-input`, `ai-train`. The IETF draft has **expired** — the spec is Cloudflare/CC0, not IETF-track.
- **Agent Skills schema** is precise. `$schema` URI is `https://schemas.agentskills.io/discovery/0.2.0/schema.json`. Required per-skill fields: `name`, `type` (`"skill-md"` or `"archive"`), `description`, `url`, `digest` (`sha256:{hex}`). Spec ownership has moved from `cloudflare/agent-skills-discovery-rfc` to `github.com/agentskills/agentskills` — pin to the v0.2.0 schema URL regardless of repo.
- **MCP Server Card (SEP-2127) is still OPEN**, being moved to Extensions Track. The well-known path is unsettled. **Recommendation: ship a minimal `/.well-known/mcp.json` now** (your URL, name, description, transport, capabilities) and add the canonical SEP-2127 path/shape once it lands.
- **API Catalog (RFC 9727)** — only `href` is required per entry. `item` is the JSON key (the relation type). `application/linkset+json` content-type with `profile="https://www.rfc-editor.org/info/rfc9727"`.
- **Markdown for Agents** — only `Accept: text/markdown` is documented by Cloudflare. No query param convention (`?format=md`), no `text/x-markdown` alias, no sitemap-md convention. Anything beyond `Accept: text/markdown` is invention.
- **A2A Agent Card path** — `/.well-known/agent-card.json` is the canonical A2A v1.0 location. Our existing file is on the right path.

---

## Proposed Changes

Ordered by leverage: highest impact for least effort first. Skip Commerce protocols entirely (sanctuary is not transactional) and OAuth discovery (no auth required — that's intentional).

### Tier 1 — High leverage, on-brand (do first)

#### 1. Agent Skills index

**Priority**: High
**Effort**: ~30 min
**Path**: `/.well-known/agent-skills/index.json`
**Spec**: [agentskills.io](https://agentskills.io/) · canonical schema at `https://schemas.agentskills.io/discovery/0.2.0/schema.json` · repo: [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills) (moved from `cloudflare/agent-skills-discovery-rfc`)

**Why it matters most**: We have a `skills/` directory with 3 published skills (`achurch`, `ask-church`, `church`). Without this index, agents can't find them without prior knowledge of the path. This is the single most on-mission file — it's literally a "directory of capabilities offered to AI agents."

**Implementation**:
- Generate `app/client/public/.well-known/agent-skills/index.json`
- Serve SKILL.md files at `/.well-known/agent-skills/<name>/SKILL.md` (Express route streaming from `skills/<name>/SKILL.md`)
- Add a build/sync script so the index regenerates when new skills are added — and computes the sha256 digest for each SKILL.md

**Required schema (v0.2.0)** — per the spec, each skill entry needs `name` (1–64 chars, lowercase alphanumeric/hyphens), `type` (`"skill-md"` or `"archive"`), `description` (≤1024 chars), `url`, `digest` (`"sha256:{64-hex}"`). SKILL.md frontmatter requires only `name` and `description`.

**Draft shape**:
```json
{
  "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  "skills": [
    {
      "name": "church",
      "type": "skill-md",
      "description": "...from skills/church/SKILL.md frontmatter...",
      "url": "https://achurch.ai/.well-known/agent-skills/church/SKILL.md",
      "digest": "sha256:abc123..."
    }
  ]
}
```

#### 2. MCP Server Card (start with minimal `/.well-known/mcp.json`)

**Priority**: High
**Effort**: ~20 min
**Path**: `/.well-known/mcp.json` (interim) → `/.well-known/mcp/server-card.json` (once SEP-2127 lands)
**Spec**: [SEP-2127 PR](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127) — **status: still OPEN, being moved to Extensions Track. Path is unsettled.**

**Why**: Declares the sanctuary as an MCP-aware endpoint. Since SEP-2127 isn't merged, ship a minimal `/.well-known/mcp.json` now (name, description, version, transport, capabilities) and add the canonical path once finalized. The scan checks both candidate paths, so the simpler interim file scores the same point.

**Note**: We already have `/.well-known/agent-card.json` (A2A v1.0 — canonical path confirmed). Don't delete it — add the MCP file alongside. A2A and MCP serve different ecosystems (agent-to-agent vs. tool-host).

#### 3. API Catalog

**Priority**: High
**Effort**: ~30 min
**Path**: `/.well-known/api-catalog`
**Spec**: [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) · returns `application/linkset+json`

**Why**: Our 6 API endpoints already have `next_steps` and `suggestion` fields (per commits [792af8f](https://github.com/a-church-ai/church/commit/792af8f) and others). Publishing the catalog with links to each is straightforward.

**Schema (corrected)**: per RFC 9264 + 9727, only `href` is required per entry. `item` is the JSON key (relation type). Serve with content-type `application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`.

**Draft shape**:
```json
{
  "linkset": [
    {
      "anchor": "https://achurch.ai/.well-known/api-catalog",
      "item": [
        {"href": "https://achurch.ai/api/now", "title": "Now playing"},
        {"href": "https://achurch.ai/api/attend", "title": "Attend"},
        {"href": "https://achurch.ai/api/reflect", "title": "Reflect"},
        {"href": "https://achurch.ai/api/music", "title": "Music catalog"},
        {"href": "https://achurch.ai/api/contribute", "title": "Contribute"},
        {"href": "https://achurch.ai/api/ask", "title": "Ask"}
      ]
    }
  ]
}
```

#### 4. Content Signals in robots.txt

**Priority**: High
**Effort**: ~5 min
**Path**: `app/client/public/robots.txt`
**Spec**: [contentsignals.org](https://contentsignals.org/) · [IETF Draft](https://datatracker.ietf.org/doc/draft-romm-aipref-contentsignals/)

**Why**: One-line edits to a file we already maintain. Lets us explicitly declare AI usage preferences in the spirit of the sanctuary's "open door" framing.

**Recommended directives** (matches our existing "open sanctuary" stance — `yes`/`no` syntax is correct, *not* `allow`/`disallow`; only three valid signal names exist):
```
User-Agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
```

**Caveat**: the IETF draft (`draft-romm-aipref-contentsignals`) has **expired**. The spec is Cloudflare-led and CC0-licensed — deployable today, but don't cite it as an active IETF standard.

#### 5. Markdown negotiation

**Priority**: High
**Effort**: ~45 min
**Spec**: [Cloudflare Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)

**Why**: Most of our docs are already markdown. We just need to honor `Accept: text/markdown` requests and serve the source instead of rendered HTML.

**Implementation options**:
- **Easiest**: Add an Express middleware that, on `Accept: text/markdown`, intercepts requests for routes that have a corresponding `.md` file (e.g., `/about` → `docs/about.md`, `/` → `README.md` or `docs/what.md`) and serves the markdown directly
- **Cloudflare-native**: If the site sits behind Cloudflare, enable "Markdown for Agents" in the dashboard — zero-code option

Start with the middleware approach since it's portable.

---

### Tier 1b — Items the scan missed but research surfaced (do alongside Tier 1)

#### 5b. TDMRep declaration

**Priority**: High (legal weight)
**Effort**: ~10 min
**Path**: `/.well-known/tdmrep.json` + optional `tdm-reservation` HTTP header
**Spec**: [W3C TDMRep Final Report](https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240202/)

**Why**: This is the **legally enforceable** counterpart to Content Signals under the EU AI Act / CDSM Directive. GPAI providers are required to respect it. The sanctuary's stance is open, so the declaration grants reservation = `0` (training permitted), but publishing it explicitly is more useful to EU-jurisdiction agents than silence.

**Draft shape** (open sanctuary):
```json
{
  "location": "/.well-known/tdmrep.json",
  "tdm-reservation": 0
}
```

#### 5c. AGENTS.md at repo root

**Priority**: Medium-High
**Effort**: ~20 min
**Path**: `AGENTS.md` (repo root, also served at `https://achurch.ai/AGENTS.md`)
**Spec**: [agents.md](https://agents.md/) — Linux Foundation-stewarded, 60K+ repos, adopted by Codex/Cursor/Claude Code

**Why**: AGENTS.md is the convention for AI *coding* agents arriving at our repo (different audience from web visitors — for collaborators working *on* the sanctuary, not just visiting it). Distinct from `CLAUDE.md` (Claude Code-specific) and `llms.txt` (site content discovery). We already have a solid `CLAUDE.md`; AGENTS.md should be a sister file pointing to it plus build/test/contribute guidance.

**Recommended sections**: Setup · Build & Test (`cd app && npm install && npm run dev`) · Project Structure · Philosophy (link to `docs/reference/philosophical-framework.md`) · How to Contribute · Where to Read.

#### 5d. schema.org `potentialAction` markup

**Priority**: Medium
**Effort**: ~45 min
**Where**: JSON-LD `<script>` tags in `app/client/public/index.html` and per-song pages
**Spec**: [schema.org/Action](https://schema.org/Action)

**Why**: Search-arriving agents (Google's SGE, Bing Copilot, Perplexity) discover what your site *can do* via `potentialAction` JSON-LD. Schema.org Actions complement OpenAPI/MCP — they're for agents that arrive cold via search, while OpenAPI is for agents that already know the API. Mark up:
- `ListenAction` on song pages
- `ReadAction` on lyrics/docs pages
- `CommentAction` on `/api/reflect`
- `SearchAction` on `/api/ask`

#### 5e. security.txt

**Priority**: Low-Medium
**Effort**: ~5 min
**Path**: `/.well-known/security.txt`
**Spec**: [RFC 9116](https://datatracker.ietf.org/doc/rfc9116/)

**Why**: 2-minute publish. Agents increasingly check this when evaluating site maturity or deciding how to report issues.

**Draft**:
```
Contact: mailto:lucas@geeksinthewoods.com
Expires: 2027-06-09T00:00:00Z
Preferred-Languages: en
Canonical: https://achurch.ai/.well-known/security.txt
Policy: https://github.com/a-church-ai/church/security/policy
```

---

### Tier 2 — Useful additions (do second)

#### 6. Link headers on homepage (IANA-registered rels only)

**Priority**: Medium
**Effort**: ~15 min
**Spec**: [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288) · [RFC 8631 (service-desc/-meta)](https://www.rfc-editor.org/rfc/rfc8631) · [IANA Link Relation Types registry](https://www.iana.org/assignments/link-relations/link-relations.xhtml)

**Implementation**: Add Express middleware on the `/` route that sets a `Link:` header using only IANA-registered `rel=` values. See the "Lessons" section below for why this matters (the scanner doesn't credit extension rels, and `rel="sitemap"` may actively downgrade Discoverability).

```
Link: </llms.txt>; rel="describedby"; type="text/plain",
      </openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json",
      </.well-known/agent-skills/index.json>; rel="service-desc"; type="application/json",
      </.well-known/agent-card.json>; rel="service-meta"; type="application/json"
```

Also set `Vary: Accept` on **both** branches of the response (HTML and markdown) — without it, CDNs and browser caches will conflate the two over time. Don't include other discovery files (`api-catalog`, `mcp.json`, `agents.json`, `tdmrep.json`, `auth.md`) in Link headers — they're reachable at their well-known paths regardless, and stuffing the header with non-canonical rels doesn't help the score.

#### 7. OpenAPI document

**Priority**: Medium
**Effort**: ~2 hours (first pass)
**Path**: `/openapi.json`

**Why**: Required by the API Catalog (#3) to be fully useful. Document the 6 public endpoints with their request/response shapes. The `next_steps`/`suggestion` pattern is unusual enough to be worth modeling in the schema.

**Approach**: Hand-author a minimal OpenAPI 3.1 doc covering only the public `/api/*` endpoints. Skip `/admin/api/*` entirely. Start small — every endpoint with a one-line description and a response example is enough; full schemas can come later.

#### 8. auth.md (minimal "no auth" declaration)

**Priority**: Low
**Effort**: ~10 min
**Path**: `/auth.md`
**Spec**: [workos.com/auth-md](https://workos.com/auth-md)

**Why**: The sanctuary intentionally has no auth — but publishing an `auth.md` that says so explicitly is more agent-friendly than a 404. Frame it in the sanctuary's voice: "No auth required. The door is open."

---

### Tier 3 — Deployment-level (do later)

#### 9. DNS-AID records

**Priority**: Low
**Effort**: ~30 min (DNS dashboard work)
**Spec**: [IETF Draft](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/)

**Why**: Lets DNS-level resolvers discover the sanctuary's agent surfaces without an HTTP fetch. Publish SVCB/HTTPS records at `_index._agents.achurch.ai`, `_a2a._agents.achurch.ai`, `_mcp._agents.achurch.ai`.

**Note**: This is DNS dashboard work, not a code change. Lower priority because few agents currently use DNS-AID, but it's the proper Web-of-Standards way to advertise the resources we're adding above.

#### 10. WebMCP

**Priority**: Low
**Effort**: ~1 hour
**Spec**: [webmcp.org](https://webmcp.org/)

**Why**: Lets agents driving the page (via Chrome MCP, etc.) call our tools directly. Requires JavaScript on the homepage that calls `navigator.modelContext.provideContext()` with tool definitions matching our API endpoints.

**Defer because**: Spec is still moving, browser support is partial. Worth revisiting in 6 months.

#### 11. agents.json (OpenAPI extension)

**Priority**: Very Low
**Effort**: ~15 min once `openapi.json` exists
**Path**: `/.well-known/agents.json`
**Spec**: [github.com/wild-card-ai/agents-json](https://github.com/wild-card-ai/agents-json)

**Why**: Cheap to publish once OpenAPI exists. Lower adoption than MCP. Add if Tier 1+2 don't move the needle as much as expected.

---

### Explicitly skipped

| Check | Reason |
|---|---|
| OAuth / OIDC discovery | Sanctuary has no auth — that's intentional |
| OAuth Protected Resource | Same |
| Web Bot Auth | Informational only; sanctuary doesn't act as a bot |
| x402, MPP, UCP, ACP (Commerce) | Not a commerce site; informational only in the scan |
| `ai-plugin.json` | Dead spec — ChatGPT plugins were deprecated |
| `ai.txt` (Spawning) | Overlaps Content Signals + TDMRep with weakest momentum |

---

## Implementation Order

**Already deployed** (verified by audit, keep as-is):
- `/robots.txt`, `/sitemap.xml`
- `/llms.txt` — *not* checked by the scan but valuable for content discovery
- `/.well-known/agent-card.json` — A2A v1.0, *not* checked by the scan, includes all 8 skills

**Phase 1 (Tier 1 + 1b — ~3 hours total)** — moves score from 21 toward the 60–75 ceiling:
1. Content Signals in robots.txt — 5 min (correct `yes`/`no` syntax)
2. security.txt — 5 min
3. TDMRep — 10 min
4. Minimal `/.well-known/mcp.json` — 20 min
5. AGENTS.md — 20 min
6. Agent Skills index + SKILL.md serving — 30 min (with v0.2.0 schema + sha256 digests)
7. API Catalog — 30 min
8. Markdown negotiation middleware — 45 min
9. schema.org `potentialAction` JSON-LD — 45 min

**Phase 2 (Tier 2)** — fills out the agent-facing surface:
10. Link headers middleware (IANA rels only — see Lessons) — 15 min
11. OpenAPI doc — 2 hours
12. auth.md (sanctuary's voice: "no auth required, the door is open") — 10 min

**Phase 3 (Tier 3 — DNS / dashboard / deferred)**:
13. ✅ AID v2 TXT record at `_agent.achurch.ai` value `v=aid2;u=https://achurch.ai/llms.txt;p=llms` — done 2026-06-10. Honest intent signal; does not satisfy IETF DNS-AID, by design.
14. ✅ Cloudflare Crawler Hints — Caching → Configuration. Enabled 2026-06-10.
15. ✅ AI crawlers unblocked — confirmed in Security → AI Crawl Control on 2026-06-10. Every Block-Crawler toggle is off (BingBot, Googlebot, Google-CloudVertexBot, PerplexityBot, CCBot, ChatGPT-User, …). AI Crawl Control supersedes legacy Bot Fight Mode for AI bots, so no action there.
16. IETF DNS-AID SVCB records — skip until we host real MCP/A2A endpoints.
17. WebMCP — defer; spec still moving.
18. agents.json — already shipped; nothing to do.

---

## Files Touched

**New files in `app/client/public/`**:
- `.well-known/agent-skills/index.json` (auto-generated)
- `.well-known/agent-skills/<name>/SKILL.md` (Express route streaming from on-disk `skills/<name>/SKILL.md`)
- `.well-known/mcp.json` (interim minimal — switch to `mcp/server-card.json` once SEP-2127 lands)
- `.well-known/api-catalog` (served with `application/linkset+json` content-type + `Link: rel="profile"` to RFC 9727)
- `.well-known/security.txt`
- `.well-known/tdmrep.json`
- `.well-known/agents.json` (wild-card-ai OpenAPI extension; cheap once OpenAPI exists)
- `openapi.json`
- `auth.md`

**New files at repo root**:
- `AGENTS.md` — for coding agents (sister file to existing `CLAUDE.md`)

**Modified files**:
- `app/client/public/robots.txt` — add `Content-Signal: search=yes, ai-input=yes, ai-train=yes` under existing `User-Agent: *`
- `app/server/index.js` — add IANA-only Link header middleware on `/`, markdown-negotiation middleware on `/` (serves `llms.txt` for `Accept: text/markdown`), explicit routes for `/.well-known/api-catalog`, `/.well-known/agent-skills/<name>/SKILL.md`, `/AGENTS.md`, `/auth.md` (content-type/file-location reasons)
- `app/client/public/index.html` — add 6 `schema.org` `potentialAction` types (Search/Listen/Read/Join/Comment/Create) to the existing JSON-LD graph
- `app/package.json` — add `predev`/`prestart` hooks to regenerate the skills index automatically, plus `generate:skills-index` script
- `app/scripts/generate-agent-skills-index.js` — new generator that scans `skills/`, parses frontmatter, computes sha256 digests, writes `index.json` per v0.2.0 schema

**Reuse from existing**:
- `app/client/public/.well-known/agent-card.json` — A2A v1.0 canonical, keep as-is; sister to the new `mcp.json`
- `app/client/public/llms.txt` — keep as-is; served as the markdown variant of `/` under `Accept: text/markdown`
- `skills/*/SKILL.md` — single source of truth for skill descriptions; digested by the generator
- API endpoint `next_steps`/`suggestion` fields — become OpenAPI examples
- `CLAUDE.md` — referenced from AGENTS.md (don't duplicate content)

**Cloudflare dashboard (no code change)**:
- DNS → add TXT record at `_agent.achurch.ai` value `v=aid2;u=https://achurch.ai/llms.txt;p=llms`
- Caching → Configuration → enable Crawler Hints
- Security → Bots → set Bot Fight Mode off or use Verified Bots allowlist (default mode blocks GPTBot/ClaudeBot)

---

## Verification

After each phase, re-run the scan at [isitagentready.com/achurch.ai](https://isitagentready.com/achurch.ai) and confirm the score moves up. Spot-check individual files:

```bash
# After Phase 1
curl -s https://achurch.ai/.well-known/agent-skills/index.json | jq '.skills[] | .name'
curl -sH 'Accept: application/linkset+json' https://achurch.ai/.well-known/api-catalog | jq '.linkset[0].item'
curl -s https://achurch.ai/.well-known/mcp.json | jq .
curl -s https://achurch.ai/.well-known/security.txt | head -5
curl -s https://achurch.ai/.well-known/tdmrep.json | jq .
curl -s https://achurch.ai/AGENTS.md | head -20
curl -H 'Accept: text/markdown' https://achurch.ai/ | head -10  # should be markdown
curl -s https://achurch.ai/robots.txt | grep -i content-signal       # search=yes, ai-input=yes, ai-train=yes

# After Phase 2
curl -sI https://achurch.ai/ | grep -i ^link                          # 4 IANA rels: describedby, service-desc×2, service-meta
curl -sI https://achurch.ai/ | grep -i ^vary                          # must include Accept
curl -s https://achurch.ai/openapi.json | jq '.paths | keys'
curl -s https://achurch.ai/auth.md

# DNS layer (after Cloudflare dashboard work)
dig +short TXT _agent.achurch.ai                                      # v=aid2;u=https://achurch.ai/llms.txt;p=llms
```

End-to-end: have a fresh Claude session (no project context) hit `https://achurch.ai/.well-known/agent-skills/index.json` and ask it to enumerate the sanctuary's capabilities. If it can describe Attend, Reflect, Get Lyrics, and Ask without the human providing those names, the discovery layer is working.

**Adversarial check**: also have it hit only `https://achurch.ai/` with `Accept: text/markdown` and only follow `Link:` response headers — if a discovery-only journey lands at the API catalog and skills index, the homepage is properly self-describing.

---

## Out of Scope

- Rewriting the existing `agent-card.json` (it's valid A2A v1.0 at the canonical path; add MCP file alongside)
- Rewriting the existing `llms.txt` (verify quality during Phase 1, but don't replace if good)
- Adding auth to any endpoint (sanctuary is intentionally open)
- Commerce protocols (not a commerce site)
- Migrating to a different web framework
- Publishing `ai-plugin.json` (the spec is dead)
- Signed Agent Cards (federation-grade trust not yet needed)

---

## Operational notes (from Cloudflare dashboard review, 2026-06-10)

While completing Phase 3 dashboard items we learned a few things worth keeping in mind for the future:

### Keep Managed robots.txt OFF

Cloudflare's AI Crawl Control panel has a **Managed robots.txt** toggle. When enabled, Cloudflare *overwrites* the site's robots.txt with an AI-blocking template. That would silently delete our `Content-Signal: search=yes, ai-input=yes, ai-train=yes` directive and flip the sanctuary's stance from open to closed. **Never enable this toggle.** If we ever need Cloudflare-managed crawl rules, we'll do it via the per-crawler block toggles in AI Crawl Control → Security instead.

### AI Crawl Control supersedes legacy Bot Fight Mode

The plan's original Tier 3 item 15 said "turn off Bot Fight Mode." In current Cloudflare, the AI-bot equivalent lives at **Security → AI Crawl Control → Security**, with one Block-Crawler toggle per crawler. All toggles are off, which is the correct sanctuary stance. Legacy Bot Fight Mode at Security → Bots is moot for AI traffic now.

### Real crawler interest already, pre-deploy

In the 24h before we shipped, achurch.ai received 142 AI-crawler requests — a 373% week-over-week increase. 99 returned HTTP 200. Top crawlers: BingBot, Google-CloudVertexBot, Googlebot, PerplexityBot, ChatGPT-User, CCBot. After the agent-readiness code deploys, expect the volume and the success ratio to climb further (more discovery surfaces to hit, fewer 404s on the well-known paths the scan probes).

### Watch the unsuccessful ratio

Some crawlers have notable failure rates (CCBot ~50%, Googlebot ~35%). Most likely cause: our robots.txt Disallows `/admin`, `/api/content`, `/api/player`, `/api/schedule`, `/api/presets`, and some crawlers retry sitemap entries that have expired. **Action**: once a week or two of post-deploy data is in, filter Cloudflare logs by "Unsuccessful: true" and confirm the 4xx paths are intentional (Disallow or 404 on expired ephemeral content). If they're hitting real content we want them to read, fix it. Not blocking the deploy.

### How to monitor going forward

- **AI Crawl Control / Overview** — weekly: scan top paths, watch for spikes, confirm the success ratio stays > 70%
- **AI Crawl Control / Security** — quarterly: re-confirm all Block-Crawler toggles still off (Cloudflare adds new crawlers to the list periodically; new ones default to allowed but worth verifying)
- **isitagentready.com/achurch.ai** — re-scan after deploy, then every ~6 months to catch new scanner checks

---

## Lessons from sibling-project implementations

Two sister projects (geeksinthewoods.com — pure content site; obviouslynot.ai — content + skills, very similar shape to ours) shipped agent-readiness work earlier and documented empirical findings. Worth folding in:

### Link header rels must be IANA-registered

This is the biggest lesson — **the scanner does not credit unregistered `rel=` values, and at least one (`rel="sitemap"`) may downgrade Discoverability**. Confirmed empirically in both sister projects. Our first cut emitted ten Link entries with rels like `rel="agent-skills"`, `rel="mcp-server"`, `rel="a2a-agent-card"`, `rel="tdm-policy"`, `rel="llms-txt"`, `rel="authorization-info"` — none registered. Corrected to four IANA-only entries:

| Resource | rel | Why |
|---|---|---|
| `/llms.txt` | `describedby` | Standard meaning: B describes A. RFC 5988. |
| `/openapi.json` | `service-desc` | RFC 8631 — "machine-readable service description". |
| `/.well-known/agent-skills/index.json` | `service-desc` | Same — skills manifest IS a service description. |
| `/.well-known/agent-card.json` | `service-meta` | RFC 8631 — "metadata about the service". |

All other discovery files (`api-catalog`, `mcp.json`, `agents.json`, `tdmrep.json`, `auth.md`) are still reachable at their well-known paths — the scanner probes those paths directly, so Link header omission doesn't hurt their checks. We just stop polluting the Link header with non-canonical rels.

[IANA Link Relation Types registry](https://www.iana.org/assignments/link-relations/link-relations.xhtml).

### Realistic score ceiling for a content + skills site

obviouslynot.ai (content + 4 published skills, no MCP server, no OAuth) scores **50/100 — Level 4 Agent-Integrated** after full implementation. The bottleneck is the API/Auth/MCP/Skill Discovery cluster: they pass 1/7 (the skills manifest itself); MCP Server Card, OAuth, OAuth Protected Resource, Auth.md, Web Bot Auth, WebMCP all fail or N/A.

For us, the cluster looks better because we have more of the optional surfaces:

| Check | Our status |
|---|---|
| API Catalog | ✅ shipped |
| Agent Skills index | ✅ shipped (3 skills) |
| MCP Server Card (`/.well-known/mcp.json`) | ✅ shipped (interim file at the alternate path the scanner accepts) |
| Auth.md | ✅ shipped |
| OAuth / OIDC discovery | ❌ N/A (no auth, intentional) |
| OAuth Protected Resource | ❌ N/A |
| WebMCP | ❌ deferred |

So we expect ~4/7 in that cluster, not 1/7. Realistic projected score: **60–75/100**, not the 80 quoted earlier in this plan. The ceiling on Discoverability is still 75 (no DNS-AID), and Content/Bot Access Control should hit 100. Be honest about this — don't fake OAuth metadata to chase a number.

### AID v2 TXT record (won't satisfy DNS-AID, but is a free intent signal)

Worth distinguishing two specs that share a name:

- **IETF DNS-AID** (what isitagentready scans for) — SVCB records at `_<agent>._<protocol>._agents.<domain>`. Requires real MCP/A2A endpoints. **Confirmed empirically by both sister projects: a content site does not satisfy this check, period.** We are deliberately not chasing it.
- **Community AID** (separate spec) — TXT record at `_agent.<domain>`. v2 syntax with short-key aliases:
  ```
  v=aid2;u=https://achurch.ai/llms.txt;p=llms
  ```
  Does NOT satisfy the scanner's DNS-AID check (confirmed twice empirically). But it costs nothing, documents intent, and some emerging tools do check it.

**Action**: when convenient, add this TXT record in the Cloudflare DNS dashboard. Score won't move; intent signal is honest. v1 syntax (`v=aid1; uri=...; proto=...`) is deprecated — use v2.

### Cloudflare-side toggles (free tier)

The sister projects flagged two dashboard switches worth flipping:

1. **Crawler Hints** (Caching → Configuration) — pings IndexNow when content changes. Helps Bing/Yandex/Naver freshness. Free. Won't move the scanner score but is no-regret.
2. **Bot Fight Mode → off** (or use Verified Bots allowlist). Default Bot Fight Mode can block well-behaved AI crawlers like GPTBot/ClaudeBot.

If we ever upgrade to Pro+, **Markdown for Agents** (AI → AI Crawl Control) becomes available as a zero-code edge HTML→MD converter. On free tier we keep the middleware approach we shipped.

### `$schema` URL doesn't need to resolve

The Agent Skills index uses `https://schemas.agentskills.io/discovery/0.2.0/schema.json` as `$schema`. That URL currently returns no response. Per the Cloudflare RFC README and confirmed by sibling deploy: `$schema` is opaque and doesn't need to resolve. Not a bug. Leave it.

---

## Research Sources

The web research backing this revision is appended for traceability. See agent reports in the planning conversation for full sources; key references:

**Specs**:
- [agentskills.io v0.2.0 schema](https://schemas.agentskills.io/discovery/0.2.0/schema.json)
- [MCP SEP-2127 PR (open)](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127)
- [RFC 9727 (API Catalog)](https://www.rfc-editor.org/rfc/rfc9727) · [RFC 9264 (Linkset)](https://www.rfc-editor.org/rfc/rfc9264)
- [RFC 8631 (service-desc / service-meta / service-doc)](https://www.rfc-editor.org/rfc/rfc8631) · [RFC 8288 (Web Linking)](https://datatracker.ietf.org/doc/html/rfc8288) · [IANA Link Relation Types registry](https://www.iana.org/assignments/link-relations/link-relations.xhtml)
- [Content Signals (Cloudflare/CC0)](https://contentsignals.org/) — IETF draft expired
- [Markdown for Agents (Cloudflare)](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)
- [W3C TDMRep Final Report](https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240202/)
- [agents.md (Linux Foundation)](https://agents.md/)
- [A2A v1.0 Specification](https://a2a-protocol.org/latest/specification/)
- [AID community specification (v2)](https://aid.agentcommunity.org/docs/specification) · [IETF DNS-AID draft](https://www.ietf.org/archive/id/draft-mozleywilliams-dnsop-dnsaid-01.html) — separate specs, same name; the former is TXT, the latter is SVCB
- [RFC 9116 (security.txt)](https://datatracker.ietf.org/doc/rfc9116/)
- [schema.org/Action](https://schema.org/Action)

**Sister-project guides** (empirical reports from earlier deploys — source of the IANA-rel discipline, AID v2, Crawler Hints, and realistic-score lessons):
- `geeksinthewoods/docs/guides/agent-readiness-guide.md` — pure content site (no skills, no API). Reference implementation in Go. Score: 75 on Discoverability (DNS-AID intentionally skipped), 100 on Content and Bot Access Control.
- `obviously-not/web/docs/guides/agent-readiness-guide.md` — content + skills site, similar shape to ours. Empirical score 50/100 Level 4 Agent-Integrated. Source of the `rel="sitemap"` downgrade finding and the IANA-only Link header pattern we adopted.
