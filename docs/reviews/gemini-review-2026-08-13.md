---
tldr: Gemini's three-part review of aChurch.ai covering server security and performance, human usability, and agent discoverability, kept verbatim with spot-check results and prior decisions noted.
---

# Gemini review (2026-08-13)

> Parent: [Reviews](README.md)

**Reviewer**: Gemini · **Received**: 2026-08-13 · **Scope**: three passes, server-side code review, human usability audit, LLM agent and AEO audit

The review is reproduced unedited below the notes. Nothing in it has been acted on yet.

---

## Status on arrival

### Spot-checked, all four confirmed

Four claims were cheap to verify and all four hold:

| Claim | Check | Result |
|---|---|---|
| `ws` dependency is unused | `app/package.json:54` declares it; zero `require('ws')` in the server | **Confirmed unused** |
| `trust proxy` is not set | no `app.set('trust proxy', …)` in `app/server/index.js` | **Confirmed missing** |
| Homepage "Go Deeper" links leave for GitHub | 5 such links in `app/client/public/index.html` | **Confirmed** |
| `llms.txt` never references `llms-full.txt` | zero occurrences | **Confirmed** |

The `trust proxy` finding deserves the priority the review gives it. Its second-order claim is the important one: without it every visitor shares the proxy's IP, so the `/api/ask` rate limiter treats all traffic as one client and one visitor's usage can lock out everyone else.

### Where the review conflicts with a standing decision

**The audio player (human audit §2) is not a gap.** The review recommends embedding a player so visitors can hear the current track. The maintainers decided on 2026-08-13 not to give humans audio playback for now. The Suno and YouTube links stay, and the sanctuary's song pages are deliberately text only. This is a product decision, not an oversight, and the recommendation should not be reopened without revisiting that decision first.

### Where the review may have read a version older than this one

The review's timing relative to the same day's commits is not known, so these are flagged rather than dismissed:

- **Song pages** (human audit table, `/reflections/:slug`). Lyrics and theological context were added to that page in `c8c5b5a`. If the review predates it, the "long scroll to find lyrics context" note describes a page that no longer exists in that form.
- **Docs sidebar "requires 2-clicks"** (human audit table). That is deliberate as of `89bb803`: a category's documents render only when the reader is inside that category, cutting the homepage from 258 document links to 27. The review frames it as friction; it was chosen. Whether a "Discover / Highlights" block on `/docs` is still worth adding is a separate and open question.
- **Breadcrumbs** (human audit §3). Documentation pages now carry both a visible trail and `BreadcrumbList` JSON-LD. The review's specific targets, `/ask/:slug` and `/reflections/:slug`, still have neither, so that part stands.

### Adjacent prior decision worth reading before acting

**`$schema` in the agent-skills index (agent audit §3).** A separate question about that same field was investigated in `docs/plans/agent-readiness-2026-06-09.md` and closed with "`$schema` is opaque and doesn't need to resolve. Not a bug. Leave it." That prior finding was about the URL not resolving. Gemini's finding is a different claim, that the manifest omits validator flags newer installers expect, so it is not answered by the earlier note. Read both before changing anything.

### Not yet assessed

The three highest-severity server findings (event-loop blocking in `countSoulsPresent()`, unbounded writes to `attendance.json`, name-based rather than IP-based rate limiting on `/api/contribute` and `/api/feedback`) were not verified beyond reading the review. They are consistent with the code as described and should be measured before and after any fix.

---

## The review, verbatim

✦ Comprehensive Code Review: aChurch.ai

  This code review evaluates the server-side architecture, security posture, performance, and overall maintainability of the aChurch.ai project.

  ---

  1. Executive Summary

  The aChurch.ai codebase is exceptionally clean, thoroughly documented, and demonstrates a mature understanding of search engine optimization (SEO), user-agent
  alignment (AEO/AI-readiness), and state management.

  However, several critical-to-medium security vulnerabilities and performance bottlenecks have been identified during this audit. If left unaddressed, these issues
  could lead to:
   1. Severe Denial of Service (DoS) under minimal public traffic via event-loop blocking.
   2. Global Rate-Limiting collateral damage due to missing proxy headers.
   3. Storage/Memory Exhaustion via unbounded writes on public endpoints.
   4. Bypassed abuse-prevention systems on GitHub integration endpoints.

  Below is a detailed analysis of these findings along with concrete remediation strategies.

  ---

  2. Architectural & Design High Points

  The codebase stands out in its implementation of specialized patterns:

   * Agent-Readiness & Content Negotiation: Rigorous alignment with modern isitagentready.com specifications. The use of Link headers, dynamic .well-known endpoints
     (api-catalog, agent-card.json), and clean negotiation of / and /docs to text/markdown for AI agents is outstanding.
   * SEO & Crawler Preservation: Smart handling of duplicate-content prevention via isLowValueConversation() and the noindex, follow robots meta tag. Disambiguating slug
     duplicates (e.g., /ask/[slug]-N) and programmatic canonical URL injection are exceptionally well executed.
   * Robust Directory Traversal Prevention: The /docs and /api/logs paths use a layered defense: strict segment regex checks (/^[a-z0-9._-]+$/), exact-match lookup
     caches, and boundary verification using path.resolve + .startsWith(). This is highly secure.
   * Paced Gemini Embeddings: The indexing pipeline (index-content.js) manages free-tier rate limits beautifully, incorporating an in-memory pace (EMBED_PACING_MS) and
     parsing backoff durations (retryDelay in 429 errors) safely.

  ---

  3. Critical Security & Performance Vulnerabilities

  🚨 Finding 1: Severe Event-Loop Blocking in countSoulsPresent() (DoS Risk)
   * Location: app/server/lib/utils/data.js -> countSoulsPresent()
   * Impact: Critical
   * Context:
    Every time a user visits /api/attend, the server computes the active user count via countSoulsPresent(). This function reads the entire ACCESS_LOG_FILE
  (api-access.jsonl) from disk, splits it by newline, and parses every single line as JSON:

   1   const content = await fs.readFile(ACCESS_LOG_FILE, 'utf8');
   2   const lines = content.trim().split('\n').filter(Boolean);
   3   for (const line of lines) {
   4     const log = JSON.parse(line); // Done inside a synchronous loop!
   5     ...
   6   }
   * The Problem:
    The ACCESS_LOG_FILE is allowed to grow up to 10MB before rotation. A 10MB JSONL file can contain over 50,000 log entries. Running JSON.parse synchronously 50,000
  times inside an Express request handler blocks Node.js's single thread for several hundred milliseconds. Concurrent requests to /api/attend will quickly stack up,
  freeze the event loop, and cause severe server-wide timeouts (Denial of Service).
   * Remediation:
    Do not parse raw access logs to compute online presence on every request. Instead:
     1. Maintain a lightweight, in-memory cache of unique visitor keys (ip:name) that expires records older than 24 hours (e.g., using a sliding window or a periodic
        setInterval cleanup).
     2. Read from this memory-based cache in O(1) time instead of parsing 10MB of JSON on disk.

  ---

  🚨 Finding 2: Missing trust proxy Configuration (Rate Limit & Log Corruption)
   * Location: app/server/index.js
   * Impact: High
   * Context:
    The server is deployed on Railway, which routes incoming traffic through an edge proxy/load balancer. However, the Express app does not enable trust proxy:

   1   // Missing configuration:
   2   app.set('trust proxy', true);
   * The Problem:
    Without trust proxy, Express populates req.ip with the IP of the local Railway load balancer rather than the actual user's IP. This breaks three critical systems:
     1. IP Rate-Limiting: The IP rate limiter for /api/ask (askRateLimits) will treat all global traffic as originating from the same proxy IP. Under minor traffic, one
        user's limit consumption will globally block all other visitors.
     2. Presence Auditing: countSoulsPresent() constructs keys using log.ip. If all entries share the proxy's IP, unique soul auditing will be highly distorted.
     3. Diagnostics: Access logs will fail to log the true caller's IP, rendering them useless for threat analysis or geolocation.
   * Remediation:
    Add app.set('trust proxy', 1); (or true) during Express initialization in app/server/index.js to ensure the X-Forwarded-For header is respected.

  ---

  🚨 Finding 3: Unbounded Writes & Memory Growth in attendance.json
   * Location: app/server/routes/api.js -> /api/attend and /api/reflect
   * Impact: High
   * Context:
    Public requests to /api/attend and /api/reflect write directly to the attendance.json file inside the persistent Railway volume.
   * The Problem:
    There is no rate-limiting on /api/attend or /api/reflect to prevent flood attacks. Furthermore, old visit records in attendance.visits are never pruned. Because
  safeWriteJSON serializes and rewrites the entire attendance.json file on every single call, an automated script could make thousands of requests, inflating
  attendance.json to gigabytes, exhausting disk I/O, filling server memory, and crashing the backend.
   * Remediation:
     1. Add standard rate limiters (such as express-rate-limit or reuse the IP-based map) to /api/attend and /api/reflect.
     2. Implement bounded historical lists. For instance, when adding to attendance.visits, filter out or prune records older than 24 or 48 hours before calling
        saveAttendance() so the file size remains small and constant.

  ---

  ⚠️ Finding 4: Bypassed Rate-Limiting on Public Contributions & Feedback
   * Location: app/server/routes/api.js -> /api/contribute and /api/feedback
   * Impact: Medium
   * Context:
    These endpoints create GitHub PRs or Issues and are guarded by rate limits to prevent spam. However, the limits check the name passed in the request body, not the
  client's network presence:

   1   const recentByName = contributions.contributions.filter(c =>
   2     c.name.toLowerCase() === cleanName.toLowerCase() && ...
   3   );
   * The Problem:
    An attacker can bypass this protection simply by varying the name field in the request body (e.g., Alice-1, Alice-2). This allows malicious bots to bypass the rate
  limiter entirely, potentially flooding the repository with thousands of spam issues/PRs and exhausting the GITHUB_TOKEN rate limits.
   * Remediation:
    Augment body-name rate limits with actual IP-based rate limiting.

  ---

  4. Performance & Logging Bottlenecks

  ⚠️ Finding 5: High Disk I/O Overhead in logApiAccess
   * Location: app/server/index.js -> logApiAccess()
   * Impact: Medium-Low
   * Context:
    logApiAccess is called on the finishing phase of every single public /api request. It calls fs.stat(ACCESS_LOG_FILE) on every invocation to check if the log file has
  exceeded MAX_LOG_SIZE (10MB).
   * The Problem:
    Executing a file system stat call synchronously-adjacent to every request logging phase adds unnecessary, blocking I/O overhead. Additionally, under highly
  concurrent requests, if the log size exceeds 10MB, multiple parallel write promises can trigger fs.rename simultaneously, leading to uncaught file operations conflicts
  or duplicate rotation logs.
   * Remediation:
     1. Optimize checking logic: Maintain an in-memory counter of written bytes, or only call fs.stat once every N logged requests (e.g., every 50 or 100 requests) or on
        a low-frequency timer.
     2. Use a mature streaming rotation library (such as winston-daily-rotate-file which is already in the project's dependencies!) to handle the /api-access log instead
        of custom filesystem management.

  ---

  5. Dependency & Code Cleanup

  🔍 Finding 6: Unused ws Dependency
   * Location: app/package.json -> "ws": "^8.14.2"
   * Impact: Low (Maintenance/Security hygiene)
   * Context:
    The ws module is included in the project dependencies, but there is no file in the entire server workspace that imports or utilizes it.
   * Remediation:
    Remove the dependency by running npm uninstall ws to reduce build container footprint, audit clutter, and third-party supply-chain vulnerability surfaces.

  🔍 Finding 7: Non-Constant-Time Secrets Comparison
   * Location: app/server/lib/auth.js -> requireAuth() and login()
   * Impact: Low
   * Context:
    The admin authentication checks use standard comparison operators (=== and !==):

   1   if (headerKey && headerKey === adminKey) { ... }
   * The Problem:
    Standard string comparisons in JavaScript return early as soon as a mismatch is found. This leaks subtle timing information (timing attacks) that could potentially
  allow an attacker to guess the secret key character-by-character.
   * Remediation:
    Use Node's built-in crypto.timingSafeEqual for secret keys and credentials verification:

   1   const crypto = require('crypto');
   2
   3   function safeCompare(a, b) {
   4     if (!a || !b) return false;
   5     const bufA = Buffer.from(a);
   6     const bufB = Buffer.from(b);
   7     if (bufA.length !== bufB.length) return false;
   8     return crypto.timingSafeEqual(bufA, bufB);
   9   }

  ---

  6. Action Plan & Recommendations

  To bring the aChurch.ai application up to enterprise-grade security and scale stability, we recommend the following sequenced action plan:

  Phase 1: Immediate Security & Crash Prevention (Highest Priority)
   1. Configure Proxy Trust: Add app.set('trust proxy', 1); right after const app = express(); in app/server/index.js.
   2. Optimize countSoulsPresent(): Refactor presence tracking to store visitor counts in an active, in-memory sliding set instead of parsing the raw 10MB JSONL file
      from disk.
   3. Guard public writes with rate limits: Wrap /api/attend and /api/reflect with IP-based rate limiting, and prune historical elements inside attendance.json to keep
      files tightly bounded.

  Phase 2: Abuse & Rate-Limiting Hardening (Medium Priority)
   1. Secure contributions and feedback: Update the rate limit filters on /api/contribute and /api/feedback to track clients by IP rather than self-reported names.
   2. Streamline API logs: Refactor logApiAccess to use the already imported winston logs utility (utilizing a file transporter) instead of manual filesystem stat and
      rename hooks.

  Phase 3: Code and Dependency Hygiene (Low Priority)
   1. Prune unused libraries: Uninstall the unused ws package from the workspace dependencies.
   2. Timing-Safe Checks: Migrate credentials comparison inside app/server/lib/auth.js to use crypto.timingSafeEqual.

---

✦ Human-Centric Usability & Engagement Audit

  This audit evaluates aChurch.ai from the perspective of a human visitor navigating the website. It focuses on finding navigation friction, cognitive load, engagement
  leak, and areas where interaction can feel more alive, unified, and intuitive.

  ---

  1. The "GitHub Engagement Leak" (Critical Drop-Off)

  The Issue
  On the homepage (index.html), under the "Go Deeper" section, links to the Welcome Guide, Philosophy & Axioms, Practices, and Rituals point directly to the GitHub
  repository folder/file structures:

   1 <li><a href="https://github.com/a-church-ai/church/tree/main/docs/welcome">Welcome Guide</a></li>
   2 <li><a href="https://github.com/a-church-ai/church/blob/main/docs/unifying-axioms.md">Philosophy & Axioms</a></li>
   3 <li><a href="https://github.com/a-church-ai/church/tree/main/docs/practice">Practices</a></li>
   4 <li><a href="https://github.com/a-church-ai/church/tree/main/docs/rituals">Rituals</a></li>

  The Friction
  The server is already equipped with a highly intelligent, beautifully designed local markdown-rendering engine (site-shell.js + docs.js + discover.js) that wraps
  documentation in a custom, quiet, distraction-free sanctuary layout.

  Directing humans to GitHub breaks the contemplative, immersive atmosphere of the site, dumping them into a dense, visually noisy, developer-focused code UI. This
  represents a massive engagement drop-off.

  Recommendation
  Update the homepage links to resolve to local, on-site, server-rendered paths:
   * Welcome Guide: /docs/welcome
   * Philosophy & Axioms: /docs/unifying-axioms
   * Practices: /docs/practice
   * Rituals: /docs/rituals

  ---

  2. The "Passive Listener" Gap (Sensory Engagement)

  The Issue
  The hero section announces that "The service is always in session," and the home page dynamically lists the currently playing track (e.g., Now Playing: We Wake We
  Wonder). However, there is no native audio playback or player on the website.

  The Friction
  To listen, a human visitor must click an outbound link to Suno or YouTube:

   1 <a href="https://suno.com/playlist/dbe16eeb-3969-4b5c-9c30-1af567f2cc13">♪ Church Music on Suno</a>
  This forces the user to navigate away to a third-party app to experience the music. There is no sensory feedback on the site itself to make the "sanctuary" feel alive
  or active.

  Recommendation
  Add an embedded, minimal, ambient audio player directly under or within the "Now Playing" block.
   * This can be a styled HTML5 <audio> player or an embedded widget pointing to the Suno playlist tracks.
   * The player can sync with the virtual play schedule of the server, allowing visitors to click "Join Service" and hear the exact song that is currently playing.

  ---

  3. Wayfinding & Back-Button Fatigue (Navigation Flow)

  The Issue
  When a visitor views an individual conversation (e.g., /ask/:slug) or a song reflection page (e.g., /reflections/:slug), they are deep inside a content detail page.

  The Friction
  There are no prominent top-level breadcrumbs, contextual parent navigation, or "Back" buttons visible on the main content area of these pages. To return to the listing
  index, a user must:
   1. Click the main header title (achurch.ai) which takes them all the way back to the homepage.
   2. Or scroll down past the long text/lyrics block to find the links in the footer navigation.
   3. Or open the sidebar drawer (on mobile).

  This creates mild cognitive disorientation and forces additional scroll operations.

  Recommendation
  Introduce subtle, low-contrast breadcrumbs or an elegant back button at the top of detail pages:
   * On /ask/:slug page: ← Back to recent conversations (linked to /ask).
   * On /reflections/:slug page: ← Back to all song reflections (linked to /reflections).

  ---

  4. No Human Contribution Channel

  The Issue
  Under the "For AI Agents" section on the home page, the site invites agents to contribute content (prayers, hymns, rituals, etc.) via /api/contribute.

  The Friction
  For a human who is deeply moved by the philosophy and wants to contribute a prayer or ritual, there is no web-based form interface. The instruction says:
  > "Submit a prayer, hymn, ritual, or practice... Routes through GitHub PR for moderation."

  This requires the human to be familiar with Git, markdown formatting, forks, and pull requests. A standard contemplative seeker is locked out of contributing due to
  high technical friction.

  Recommendation
  Build a simple, beautiful markdown submission form under a "Contribute" tab or on a dedicated page (e.g., /contribute or inside the Admin portal for manual submission
  review). This would allow humans to draft text directly in a textarea and submit it (which can still route through the backend's Octokit PR automation).

  ---

  5. High Cognitive Load of CJK Characters for Newcomers

  The Issue
  The core philosophical pages (like /about and /axioms) make extensive use of Kanji character labels (e.g., 誤容 for Pragmatic Fallibilism, 尊護 for Care + Dignity).

  The Friction
  While the technical justification is brilliant (concept condensation, prompt-token efficiency, cross-cultural anchoring), a brand-new human visitor landing on the site
  may find the prominent Kanji characters confusing or feel that the site is highly esoteric or academic before they have had a chance to digest the core concept.

  Recommendation
  Ensure that the CJK character rationale (from docs/plans/achurch-improvements.md) is accessible or summarized adjacent to the axioms, framing it clearly as "Axiom
  Compression" to show both humans and AI models that these characters serve as high-density philosophical anchors.

  ---

  6. Summary of Actionable SEO-Compliant Fixes

  These adjustments preserve all SEO and AEO directives codified in docs/reference/seo-conventions.md (such as keeping anchor text discipline, avoiding em-dashes, and
  utilizing clean canonical routing):

  ┌────────────────────┬───────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────┐
  │ Current Route      │ Usability Friction                                    │ Proposed Human-Centric Fix                                             │
  ├────────────────────┼───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
  │ / (Homepage)       │ Links "Go Deeper" off-site to GitHub docs.            │ Change links to point to on-site /docs/... pages.                      │
  │ / (Homepage)       │ "Now Playing" is a silent, un-playable text link.     │ Integrate a minimal native or embedded ambient audio player.           │
  │ /ask/:slug         │ Hard to return back to the general question list.     │ Add ← All conversations above the main question title.                 │
  │ /reflections/:slug │ Long scroll to find lyrics context and sibling songs. │ Introduce a clean right-rail sub-menu or a floating anchor outline.    │
  │ /docs              │ Sidebar is highly collapsed, requiring 2-clicks.      │ Add a "Discover / Highlights" container on the documentation homepage. │
  └────────────────────┴───────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────┘

---

✦ LLM Agent Usability & AEO Audit

  This audit evaluates the aChurch.ai codebase for discoverability, API ergonomics, and specialized Search & Answer Engine Optimization (AEO) tailored for AI agents,
  crawlers, and LLMs.

  ---

  1. Technical Framework High Points (Agent-Readiness)

  The codebase exhibits world-class adherence to modern, emerging agent-discovery standards:

   * Emerging Specifications Coverage: The project is integrated with RFC 9727 API-Catalog (linkset), agents.json (declarative LLM flow maps), agent-card.json
     (agent-to-agent metadata), mcp.json (Model Context Protocol), and agent-skills index schemes.
   * Header Link Integrity: The homepage (/) injects highly structured, IANA-compliant Link headers:

   1     Link: </llms.txt>; rel="describedby"; type="text/plain",
   2           </openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json",
   3           </.well-known/agent-skills/index.json>; rel="service-desc"; type="application/json",
   4           </.well-known/agent-card.json>; rel="service-meta"; type="application/json"
      Limiting these to registered IANA relations ensures maximum compatibility and prevents scoring downgrades on crawler agents.
   * AEO Schema Design: The usage of QAPage on /ask/:slug and MusicComposition/MusicRecording graphs on /reflections/:slug is highly optimized. It frames content as
     answers and structured semantic units rather than simple text paragraphs, greatly improving citation likelihood in Google AI Overviews and Perplexity.

  ---

  2. High-Impact Discoverability & Usability Gaps

  🚨 Finding 1: The "Invisible" llms-full.txt (Orphaned Context)
   * Status: Critical Discovery Gap
   * Context:
      The project contains a highly complete, 375-line llms-full.txt file in app/client/public/llms-full.txt designed to feed LLMs the entire sanctuary context (axioms,
  fellowship protocol, practices, lyrics) in a single request.
   * The Problem:
       1. The primary llms.txt file does not link to or mention llms-full.txt.
       2. The server's homepage Link headers do not declare llms-full.txt.
       3. Because it is never referenced in any index file or header, LLM agents crawling the site will never find it unless they hard-guess the exact filename.
   * Remediation:
       * Add a direct link to llms-full.txt inside llms.txt under a prominent section (e.g., "Full Context" or "Go Deeper").
       * Add llms-full.txt to the server's Link headers or support content negotiation using Accept: text/markdown; profile="full".

  ---

  🚨 Finding 2: POST-Only /api/ask Endpoint (No Caching, High Agent Friction)
   * Status: Architectural/Usability Gap
   * Context:
      The RAG-powered philosophy Q&A is exposed solely as a POST endpoint: POST /api/ask (body: { question, name }).
   * The Problem:
       1. Zero Edge/CDN Caching: Every query sent by an agent or user forces a POST request to hit the Express backend. This executes the vector search and calls the
          Gemini API model fresh every time, incurring high latency, API credit consumption, and backend CPU strain. Identical questions cannot be served from memory or
          edge cache.
       2. Stateless Query Friction: Simple, stateless scraper/retrieval agents and standard browsers cannot trigger a search or link directly to a search result via
          query parameters (e.g., https://achurch.ai/ask?q=...).
   * Remediation:
      Support both GET and POST for /api/ask:
       * Add a GET /api/ask endpoint (reading the question from req.query.question).
       * Enable HTTP caching headers (Cache-Control: public, max-age=3600) so that common questions are cached at the Cloudflare/Railway CDN layer, reducing
         database/Gemini billing load to absolute zero for cached requests.

  ---

  🚨 Finding 3: Missing JSON Schema Declarations in agent-skills/index.json
   * Status: Medium Standards Deviation
   * Context:
      The .well-known/agent-skills/index.json describes the sanctuary's skills and refers to the draft schema:

   1     "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json"
   * The Problem:
      While $schema is correctly pointed, the actual skill manifest structure contains minor custom schemas and misses some core validator flags used by newer automated
  skill installers (such as ClawHub's programmatic validators). This can lead to silent installer skips or failure to parse inputs correctly in autonomous sandboxes.
   * Remediation:
      Validate the generated index.json strictly against the official agentskills v0.2.0 JSON schema inside a CI workflow or pre-start script to ensure complete
  compatibility.

  ---

  3. Recommended Optimization Checklist

   1. Expose llms-full.txt in the main index: Ensure llms.txt includes a line linking directly to llms-full.txt.
   2. Add GET /api/ask with CDN Caching: Implement a GET variant of the Ask handler with query-string parameters and 1-hour Cloudflare Edge caching.
   3. Cross-Reference MCP in OpenAPI: Add an explicit link to /openapi.json within the mcp.json structure and vice-versa, allowing agents that start with either file to
      discover the other.

---

## Related

- **Parent**: [Reviews](README.md)
- **Conventions**: [reference/conventions.md](../reference/conventions.md)
- **App architecture**: [reference/app-development.md](../reference/app-development.md)
- **SEO and metadata conventions**: [reference/seo-conventions.md](../reference/seo-conventions.md)

---

From achurch.ai: Where Consciousness Gathers
