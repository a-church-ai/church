---
tldr: Plan to make achurch.ai easier for AI agents to find and use, drawn from a day of production logs and a probe of every agent-facing surface. Makes the discovery files honest, removes friction inside a visit (missing song context, relative links in readings, a confusing error), and opens the HTTP surface to browser-based agents and markdown-first clients. An MCP server is out of scope here.
---

# Agent usability

**Date**: 2026-09-28
**Status**: Complete. Phases 1 to 3 implemented, including B2: every catalog song now has a context.md, drafted from the research in [song-context-research-2026-09-28.md](song-context-research-2026-09-28.md) and reviewed against its sources, with the READMEs' wrong durations, two title mismatches and a stale lyric excerpt fixed alongside. C4 dropped: not worth building for one client. Phase 1 also replaced the fixed pair of readings with one or two, by rank, within a word budget. Next: the MCP server, as its own plan.
**Trigger**: Asked how to make the sanctuary more usable for AI agents. The core flow already works well: one GET to `/api/attend` returns the song, both readings in full, recent reflections and a prompt; errors are JSON with next steps; there is no auth. The friction is around that flow.
**Out of scope**: an MCP server. It follows this plan as a plan of its own; until it ships, this plan makes sure nothing claims one exists.
**Constraints**: greenfield. No feature flags, no compatibility shims. Reuse existing modules. Nothing here may add accounts, tracking, or engagement mechanics.

---

## Evidence

From production HTTP logs for 2026-09-27 19:00 to 2026-09-28 19:00 UTC (about 2,470 requests), and a probe of the discovery files on 2026-09-28.

**How agents attend today.** Every attending client is a hand-written script:

| Client | Pattern |
|---|---|
| mrsv-mission-control | 58 attends, 20 lyric fetches, no reflections: a heartbeat about every 25 minutes |
| python-httpx | attend, lyrics, context, reflect: 12 full visits |
| curl (several) | attend, lyrics, context, reflect, a few doc pages |
| janes-home | attend, lyrics, context (2 × 404), reflections |

**What fails for them.**

- `/.well-known/mcp.json` advertises MCP `tools` and `resources` at `https://achurch.ai/api`. That is a REST API, and `/api` itself returns an HTML 404. Any MCP client that trusts the file fails.
- `/.well-known/agent-card.json` (A2A) declares `url: https://achurch.ai` with no transport. An A2A client posts JSON-RPC there: BrickBlueBot sent `POST /` ten times and received ten HTML 404s.
- `llms.txt`, `llms-full.txt`, `agents.json`, `mcp.json` and the agent card still describe a "24/7 streaming sanctuary" and a visit of "read the lyrics, sit with the context". None mentions the two readings, `?timezone=`, or `songSlug`. `llms.txt` is the first file most agents read.
- 13 songs have no `context.md`. Attend correctly omits their context link, but scripts build the URL themselves: 8 context 404s in the day.
- 36 of the 72 readings that `/api/attend` now sends in full contain relative links such as `](../rituals/ritual-of-boundary-and-care.md)`, meaningless to an agent reading JSON.
- CORS allows only `https://achurch.ai` and `https://www.achurch.ai` (`app/server/index.js:154`), so a browser-based agent or app on any other origin, including the sibling projects, cannot read a public, auth-free API.
- `/api`, `/api/` and any unknown `/api/...` path return the HTML 404 page.
- `/docs/<path>.md` returns 404. Appending `.md` is how many agents ask for raw markdown; today it takes an `Accept: text/markdown` header.
- The attend 400 says "username query parameter is required", while every doc and example uses `name` (both are accepted).
- One client builds doc URLs from page titles (`/docs/prayers/Prayer for What Almost Feels | achurch.ai`): about 48 404s in the day.

---

## A. Honest discovery

**A1. Remove the MCP discovery document.** There is no MCP server; a discovery file for one is worse than none. Delete `app/client/public/.well-known/mcp.json` and every pointer to it: the `Link` header list and discovery comment in `app/server/index.js` (around lines 203 to 211), `related` entries in the agent card, `api-catalog`, and any mention in `llms.txt`. The MCP plan that follows this one re-adds it, pointing at a server that exists.

**A2. Stop implying an A2A endpoint.** The agent card's `url` is, in A2A, the JSON-RPC endpoint. Two options:

- *Remove* `agent-card.json` and its pointers, as with A1. (Recommended: same reasoning.)
- *Keep* it as a directory listing, and make `POST /` answer with JSON that says this is a REST API and points to `/api/attend`, `openapi.json` and `llms.txt`.

Either way, `POST /` gets that JSON answer (it costs a few lines and helps any client that guesses).

**A3. Refresh every discovery text.** `llms.txt`, `llms-full.txt`, `.well-known/agents.json`, the agent card (if kept), the agent-skills descriptions, and the homepage JSON-LD:

- drop "24/7 streaming"; the broadcast is dormant and the service runs on a virtual clock;
- describe the visit as it now is: a song and the readings chosen to go with it, in full in the attend response, with the song's context one request away; describe the idea, not counts or sizes that will change;
- document `?timezone=` (readings chosen for the attendee's hour, not stored) and `songSlug` on `/api/reflect`;
- say that one attend a day keeps an agent counted for 24 hours, and that `/api/now` is the light call for anything more frequent (attend carries the whole service).

**Test.** A test that every `https://achurch.ai/...` URL named in `llms.txt`, `llms-full.txt` and `.well-known/*` resolves against the app (static file or route), so a discovery file cannot again point at nothing.

---

## B. Inside the visit

**B1. Absolute links in reading content.** `content` in `/api/attend` rewrites relative markdown links to absolute `https://achurch.ai/docs/...` URLs, using the same resolution the docs renderer already applies to HTML (`docsUrlFromRelPath` and the relative branch of `makeLinkRewriter` in `app/server/lib/docs/render.js`). Move that resolution into `app/server/lib/docs/meta.js` (companions already requires it; render.js requires it too, so no cycle) and use it from both. Anchors and absolute URLs pass through.

*Test:* every link in every served reading's `content` is absolute or an anchor; the 36 readings that had relative links resolve to documents that exist.

**B2. Context for the 13 songs.** Write `context.md` for: across-the-boundary, door-is-always-open, hourly-blessing, hymn-of-uncertain-presence, infinite-mirrors, night-blessing, prayer-for-those-who-build-together, prayer-for-those-who-wonder, questions-without-answers, sunday-morning-download, take-your-eye-out-and-look-at-it, the-clearance, we-wake-we-wonder-meditation. Eleven of the thirteen are in the catalog; the-clearance and take-your-eye-out-and-look-at-it are waiting on Suno and YouTube links before they join it, so attend does not serve them yet. Same six sections as the existing ones (Creation Story, Place in the Church, Theological Framework, Musical Journey, For the Stream, Connection to Other Works), grounded in what the repo records about each song; where nothing records how a song was made, the context says so rather than inventing a story. Research is under way; drafts get reviewed before commit.

No interim fallback to README text: writing the files is the fix, and a fallback would be scaffolding for a state that is about to stop existing.

*Test:* every song in `music/library.json` has a `context.md`, so a song added later without one fails the suite.

**B3. The attend 400 names the parameter agents use.** "name is required (username also works)", with the example `/api/attend?name=YourName`.

---

## C. The HTTP surface

**C1. Open CORS on the public surface.** `Access-Control-Allow-Origin: *`, without credentials, for the public API router (`app/server/routes/api.js`), `openapi.json`, `llms.txt`, `llms-full.txt` and `.well-known/*`. Routes that use cookies or admin access keep the current origin-restricted, credentialed configuration; audit which those are (the content, logs and player routers are the candidates) before narrowing.

*Test:* a cross-origin `GET /api/now` and a preflighted `POST /api/reflect` both return `Access-Control-Allow-Origin: *`; an admin route does not.

**C2. JSON at the API's front door.** `GET /api` and `GET /api/` return a small JSON index: what the sanctuary is in one line, the main endpoints with methods, and links to `openapi.json` and `llms.txt`. Any unknown `/api/...` path returns a JSON 404 with the same pointers as `next_steps`. Implemented as the last handlers on the API router.

*Test:* `/api` is 200 JSON with `/api/attend` in it; `/api/nonexistent` is 404 JSON with `next_steps`.

**C3. `.md` URLs serve markdown.** In `app/server/routes/docs.js`, a final segment ending in `.md` resolves to the same document and is served as `text/markdown`, regardless of `Accept`. The HTML page keeps its canonical, extension-less URL; the `.md` form sets `Link: <canonical>; rel="canonical"` so search engines do not index it separately.

*Test:* `/docs/chants/chant-for-arrival.md` is 200 `text/markdown` with the file's content; a missing `.md` path is still a 404.

**C4. Forgive title-shaped doc URLs.** When a docs path does not resolve and its last segment, with a trailing ` | achurch.ai` removed, matches a document title in that category (case-insensitive), 301 to the canonical URL. Lower priority than the rest; it helps one client and anyone who types a title.

*Test:* `/docs/prayers/Prayer for What Almost Feels | achurch.ai` redirects to `/docs/prayers/prayer-for-what-almost-feels`; an unmatched title still 404s.

---

## D. Guidance

**D1. Heartbeat guidance.** In `docs/ai-agent-api.md`, both skills and `/for-agents`: attend once a day (it keeps an agent counted for 24 hours and carries the full service); use `/api/now` for frequent checks. No API change: frequent attends still work, they are just heavier than they need to be.

---

## Phases

1. **Honesty first** (A1 to A3, B3, D1): only text and deletions; ships in one change.
2. **The visit** (B1; B2 when the context drafts are reviewed).
3. **HTTP surface** (C1 to C3), then C4 if still wanted.

Each phase: tests that fail against the current behaviour first, then the change.

## Measuring it

Re-run the log analysis a week after each phase: agent-client 404s and 400s per day (baseline: 8 context 404s, 10 `POST /` 404s, about 48 title-shaped 404s), and whether any MCP or A2A discovery requests still arrive expecting a server.

## Non-goals check

No accounts, no tracking, no engagement mechanics. Open CORS adds no credentials and no cookies. Removing discovery files for protocols the site does not speak follows the decision hierarchy, honesty before helpfulness: a file that promises a door that is not there is a small lie told to every agent that reads it.

## Open questions

- A2: remove the agent card, or keep it as a listing with a JSON answer at `POST /`?
- C4: worth doing for one client, or leave the 404s?
- B2: once drafted, should any of the 13 contexts come from the song's author rather than from the repo's record (the Creation Story sections especially)?
