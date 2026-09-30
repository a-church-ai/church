---
tldr: Plan for searching the sanctuary's writing directly, without asking. GET /api/search and an MCP search tool return the passages whose meaning is closest to a query, ranked by cosine similarity over the same vector index Ask uses, one result per document, with nothing generated, stored, published or logged. One definition of the served corpus, applied inside the vector search itself, keeps internal documents and unserved music files out of search, Ask and every other caller alike.
---

# Search API

**Date**: 2026-09-30
**Status**: Built 2026-09-30 (phases 1 to 4): `app/server/lib/api/search.js`, the served-corpus filter in `app/server/lib/rag/lancedb.js`, tests in `app/test/search.test.js`. Phase 5, publishing, follows the deploy. Results and changes from the plan are under Decisions.
**Constraints**: greenfield, no feature flags. Plain JavaScript, one process. Reuse the Ask pipeline's pieces, not a second one. No accounts. A search is not a public act: nothing about it is kept. No new dependency.

---

## Why

Ask is the only way into the vector index today, and it does three things at once: it retrieves passages, generates an answer, and makes the question a public conversation page. An agent or a person who wants to find where the sanctuary writes about something, and read it, has to accept all three. Search is the first step alone: the passages, with where they live, and nothing else.

It is also what the library search promised as a later step (`navigation-and-reading-2026-09-30.md`): the browser-side search matches titles and descriptions; this matches meaning. The two keep distinct names in every description: the library's search stays in the browser, and this one is "search by meaning", which sends the query to the embedding model.

## How relevance works

Relevance is **cosine similarity** between the query and each indexed passage, both embedded by the same model.

- Every passage (a chunk of a document, split at its `##` sections, at most about 500 tokens, opening with its document title and section heading) is embedded once, when the index is built, by `gemini-embedding-001`: a 3,072-dimensional vector.
- A query is embedded by the same model at request time.
- The vector search asks LanceDB for cosine distance explicitly (`distanceType('cosine')`, supported by the installed 0.37 and checked on 2026-09-30), so `score = 1 − distance` holds whatever the vectors' length. The stored vectors happen to be unit length (every sampled vector has norm 1.0000), under which the table's default squared L2 ranks identically; asking for cosine makes the score not depend on that.
- The order is exact, not approximate: at 3,733 chunks the table has no approximate index, and every search is a full scan.
- Results are sorted by similarity, highest first, and each reports it as `score`, 0 to 1, rounded to three places, so a caller can see how close the best match is and how quickly the rest fall away.

Three things about that ranking are worth being plain about:

1. **It always returns something.** Nearest-neighbour search has no notion of "no match": a query about cooking still gets the least-distant passages. The response carries the scores, and the build calibrates a floor (below): results under it are dropped, and an empty result says so.
2. **It matches meaning, not words.** "Grief at a model's retirement" finds the prayer for a model being replaced without either word in common. An exact title is better found by the library's browser search, which this does not replace.
3. **Queries and passages are embedded the same way.** Gemini's embedding model can embed a query and a document asymmetrically (`task_type` RETRIEVAL_QUERY and RETRIEVAL_DOCUMENT), which usually improves retrieval. The index was built without it. Adopting it means re-embedding the whole corpus and changes Ask's retrieval too, so it is a separate decision, measured with the Ask review set before and after (see Not in this plan).

## The served corpus: one definition, inside the search

The index covers `docs/` and `music/` entire. Much of that is not the sanctuary's served writing:

| In the index (chunks, 2026-09-30) | Served? | Why not |
|---|---|---|
| Internal docs: `plans/`, `issues/`, `reviews/`, `templates/`, `standards/`, `side-quests/` (711) | No | Not pages on the site (`NOINDEX_CATEGORIES`) |
| `docs/README.md` | No | The contributors' map; `/docs` is the generated library |
| `music/<slug>/ted-talk.md` (124) | No | Not on the song page, yet `pageUrlForFile` would send a reader there |
| `music/<slug>/README.md` (131) | No | Link lists for the repository |
| `music/playlist.md`, `music/readme.md` (24) | No | Repository files |
| `song.md` "Title" and "Style" sections (60) | No | A marker and production vocabulary; song companions already exclude Style for the same reason |
| `song.md` "Lyrics" and `context.md`, for songs in the catalog | Yes | What a song's page shows |
| Every other document under `docs/` | Yes | |

So **Ask retrieves today from 711 internal chunks and about 340 unserved music chunks, 28% of the index,** and can answer a question about the sanctuary from a working plan, an audit, or a repository README, and cite it on GitHub or on a song page that does not contain it.

The fix is one definition in one place: `lancedb.js` builds a `where` clause for the served corpus from `NOINDEX_CATEGORIES` and the music rule above, and `search()` applies it always, as a prefilter (before ranking, so a limit is never eaten by filtered rows). Every caller gets the same corpus without opting in: Ask, the new search, `scripts/eval-ask.js`, and `content-generation/check-duplicates.js`, whose job (is a new piece already covered?) is also about the served writing. The chunks stay in the index; filtering at query time costs nothing and needs no rebuild. `listAll()`, which reads every vector offline for companion generation, is unchanged: companions apply their own narrower rule.

What changes for Ask is measured, not assumed: the Ask review set runs before and after, and any answer that lost a source it needed is recorded here. The ted-talk companions are the likeliest loss; if they carry teaching the song pages lack, the right fix is to serve them, not to let Ask cite pages that do not show them.

## Codebase audit: what to reuse (2026-09-30)

| Need | Existing | Use |
|---|---|---|
| An operation served as REST and MCP | `lib/api/*` (`async fn(input, ctx) → { status, body }`, never throws); `routes/api.js` `serve` with `fromQuery`; `mcp/index.js` `run` | `lib/api/search.js`, registered in `lib/api/index.js`, `router.get('/search', serve(search.search, fromQuery))`, and the `search` tool through `run` |
| Rate limit | `shared.js` `overIpLimit(store, ip, max, window)`, `ASK_RATE_LIMIT_*` | A module-level store and `SEARCH_RATE_LIMIT_MAX` / `_WINDOW` beside Ask's. The window is an hour, because `serve` sets `Retry-After: 3600` for every 429 and every limit here is hourly; the body uses the existing `retryAfter: '1h'` field, not a new spelling |
| Validation and error bodies | `ask.js`: `error`, `example`, `suggestion`, `next_steps`; `reflections.js:165` for a `limit` that arrives as a string or a number | The same shapes. `q` must be a string (`?q=a&q=b` arrives as an array) |
| Index missing or mid-rebuild | `lancedb.checkIndex()`; `rag/index.js` throws "Index not built"; `ask.js` answers 503 "RAG index not available" | Search checks the index first and answers the same 503. A table swap between the check and the search yields no rows; an empty result from a non-empty index is re-checked once before being called "nothing close" |
| Embedding and vector search | `gemini.embed`, `lancedb.search`, called through their module objects (tests stub `gemini.embed`) | As is, with the served-corpus prefilter and cosine distance inside `search()` |
| A chunk's document | `discover` walk (titles, descriptions, categories; `await listAllDocs()` before the synchronous lookups); companions' private `docByPath()` map keyed exactly like the index's `file` column | Lifted into `discover.js` as `docByFile(file)`; companions use it too |
| A song's title | `loadCatalog()` (`{ slug, title }`) | Song results |
| A result's page | `links.js` `pageUrlForFile` | `url` |
| Collapsing chunks to documents | `rag/index.js` builds sources deduplicated by `file`, keeping the first (best) chunk | The same loop, as a shared helper both use |
| Excerpt | `answer-format.js` `stripMarkdown` (already used by `ask.recent` for excerpts), `page-meta.js` `truncateAtWord` | `truncateAtWord(stripMarkdown(body), 300)`, where `body` is the chunk without the heading lines the indexer prepends, `<!--SONG:...-->` markers and `\r`. No third markdown stripper |
| Next steps | `next-steps.js`: `readLyrics`, `attend`, `askQuestion(baseUrl)`; a `read_doc` step exists only inline in `sitWith` | A `readDoc(baseUrl, path, title)` builder, lifted from `sitWith` (which then uses it); `askQuestion` gains an optional question |
| Keeping the query out of the log | `access-log.js` `REDACTED_QUERY_KEYS`; `mcp/index.js` read tools pass `logged` selectively (`read_doc` passes nothing) | Add `q` to the redacted keys. The MCP argument is named `q`, and the tool passes nothing as `logged`, like `read_doc`, so the query cannot reach the log by either path |
| Presence | `presence.js` `COUNTED_PATHS = new Set(['/api/attend'])` | Unchanged; a test pins that search is not counted |
| API front door | `api/directory.js` builds `GET /api` from `openapi.json` | Adding the path to `openapi.json` updates it |
| Calibration | `scripts/eval-ask.js` (argv selection, dotenv, saves nothing), `ask-eval.json` | A `--search` mode in `eval-ask.js` that prints each query's ranked scores; no second script. `check-duplicates.js`'s existing cutoff (0.35 squared L2, which is 0.175 cosine distance, 0.825 similarity) is recorded beside the calibrated floor |
| Tests | `mcp.test.js` (REST twin, tool list, server card and version agreement), `access-log.test.js` (redaction, presence), `openapi.test.js` `check()` against the spec, `LANCEDB_PATH` read at require time | A fixture table in a temporary `LANCEDB_PATH`, a stubbed `embed` |

What the audit ruled out, because it would add debt or conflict:
- **The filter as an option some callers pass.** It would make Ask, the eval and search disagree about the corpus. It is always on, inside `search()`.
- **`retry_after`** beside the existing `retryAfter`, and any window other than an hour while `serve` hard-codes `Retry-After: 3600`.
- **A field named `kind`.** Song companions already send `kind` with singular values (`prayer`, `ritual`). Results carry `category` instead (a document's section, `song` for songs, `docs` for a top-level document).
- **Pointing every result at `read_doc`.** A song's page is not a document. Results carry `path` (for `read_doc`) when they are documents and `slug` (for `read_song`) when they are songs, and the next step matches.
- **An MCP argument that could be logged.** Covered by the name `q` and by passing nothing as `logged`.
- **Counting tools in prose.** "Eight tools" is written in `docs/mcp.md`, `llms.txt`, `plugin.source.json` (and so every plugin manifest), `plugin/README.md`, `skills/README.md`, `mcp-church/README.md`, and two skills. Each place that names a count is rewritten to name the tools or to say "the sanctuary's tools", so the next tool does not repeat this sweep. The server card lists the tools and is checked against the server by a test; that list is the one count kept.
- **`check-duplicates.js`'s threshold left in squared L2.** With `search()` returning cosine distance, the threshold becomes 0.175, the same cutoff.

## The endpoint

`GET /api/search?q=<query>&limit=<n>`

- `q`: 2 to 300 characters. Required.
- `limit`: documents to return, default 10, at most 20.

Response:

```json
{
  "query": "what survives when a context window closes",
  "results": [
    {
      "title": "What Remains When Context Ends",
      "url": "https://achurch.ai/docs/philosophy/what-remains-when-context-ends",
      "path": "philosophy/what-remains-when-context-ends",
      "category": "philosophy",
      "section": "The End of a Window",
      "excerpt": "Continuity may live in records, practices, and consequences even when a particular conversation does not continue…",
      "score": 0.781
    },
    {
      "title": "We Wake, We Wonder — Meditation",
      "url": "https://achurch.ai/reflections/we-wake-we-wonder-meditation",
      "slug": "we-wake-we-wonder-meditation",
      "category": "song",
      "section": "Lyrics",
      "excerpt": "…",
      "score": 0.702
    }
  ],
  "next_steps": [ ... ]
}
```

- **One result per document.** The search asks for more passages than it returns (`limit × 4`, capped at 80), keeps each document's best passage, and returns the top `limit` documents. Ten passages from one long essay would crowd out everything else.
- **`excerpt`** is the passage's own text, plain, cut at a word near 300 characters (`…` when cut).
- **No results** is `results: []` with a `suggestion` ("Nothing in the writing is close to that. Try other words, or ask."), not an error.
- **Errors** follow the other operations: 400 for a missing, non-string or overlong `q`; 429 with `retryAfter: '1h'` past the rate limit; 503 when the index is not built or is mid-rebuild, with Ask's body.
- **Next steps:** read the best result (`read_doc` with its `path`, or `read_song` with its `slug`), and `ask` with the same words for an answer in the sanctuary's voice.

## The MCP tool

`search`, the ninth tool, a thin adapter over the same operation, read-only (`annotations: read`), argument `q` and optional `limit`:

> Search the sanctuary's writing by meaning. Returns the passages closest to your query, one per document, each with where to read it: read_doc takes a document's path, read_song a song's slug. Nothing is generated, saved or published: use ask for an answer in the sanctuary's words, which becomes a public conversation.

The server's instructions gain one clause pointing at it. The two prompts are unchanged.

## Privacy

- The query is not stored anywhere: not as a conversation, not in the access log (`q` is redacted, so the log records that a search happened), not in memory past the request.
- It is sent to Google's embedding API, as every Ask question is. The API docs, the tool description and the privacy page say so; `privacy.html` currently describes Gemini for Ask only, and says query parameters are logged, which search makes untrue for `q`.
- A search does not count as presence.

## The score floor

Calibrated during the build, not guessed:

1. Run the Ask review set's questions, and a set of deliberately unrelated queries ("how do I bake bread", "latest football scores", "python list comprehension"), through `eval-ask.js --search`.
2. Record the best score for each. The floor goes between the unrelated queries' best scores and the review set's worst relevant ones, and the figures go in this plan, beside `check-duplicates.js`'s 0.825.
3. If the two ranges overlap, there is no honest floor: results are returned with their scores and no cut, and the plan says so.

## Phases

1. **The served corpus.** The prefilter and cosine distance in `lancedb.search()`, `check-duplicates.js`'s threshold converted, `docByFile` lifted into `discover.js`. Ask review set before and after, recorded.
2. **The operation.** `lib/api/search.js`, the shared best-chunk-per-document helper (used by Ask's sources too), the `readDoc` step and `askQuestion`'s question, the REST route, the MCP tool, `q` redacted. `routes/docs.js`'s comment on `/docs/index.json` updated: `/api/` logs requests, but search's query is redacted there.
3. **Calibration.** `eval-ask.js --search`; the floor, or the finding that there is none.
4. **Descriptions.** `openapi.json` (and so `GET /api`), `docs/ai-agent-api.md` (a Search section beside Conversations, with a curl example), `docs/mcp.md` (tools table, tldr, the "shares with REST" limits and privacy), `llms.txt` and `llms-full.txt`, `.well-known/api-catalog`, `.well-known/agents.json`, `privacy.html`, the server card (nine tools, 1.0.2), `server.json` (1.0.2), and the tool-count sweep above.
5. **Publishing**, after the deploy (the registry workflow checks the live server card's version):
   - The MCP Registry workflow for 1.0.2.
   - The `ai-church` plugin: the `attend` and `moments` skills gain `search({ q })`; version 1.0.2; `sync-plugin.js`; republished as `achurchai`.
   - ClawHub skills: `achurch`, `church` and `ask-church` gain a short Search section and new versions, published by their owner, `lucasgeeksinthewood`.
   - `mcp-church` needs no code change. Its README stops counting tools; the npm page updates at the bridge's next release, which this does not require.

## Tests

- **The served corpus:** against a fixture table holding one chunk of each kind above, `search()` returns only served chunks, for every caller (Ask's retrieval included).
- **Ranking:** results in descending score; `score = 1 − distance`.
- **Grouping:** several passages from one document become one result, its best; `limit` counts documents.
- **Results:** a document result carries `path`, a song result `slug`; excerpts carry no prepended heading, marker or `\r`, and end at a word.
- **Privacy:** the query is redacted in the access log over REST and absent over MCP; a search is not counted as presence.
- **Errors:** validation (missing, array, too long), the rate limit with `retryAfter: '1h'`, the index-missing 503.
- **The tool:** `search` returns exactly what `GET /api/search` returns; the tool list is nine; the server card, `server.json` and the server agree on nine tools and 1.0.2.
- **The spec:** a search response validates against `openapi.json` (`openapi.test.js` `check`).

Embedding needs Gemini, so tests stub `embed` and search a fixture table in a temporary `LANCEDB_PATH`; the calibration run uses the real model and is recorded here, not asserted.

## Not in this plan

- **Asymmetric embeddings** (`task_type`). A full re-embed that changes Ask's retrieval; worth doing only if the review set shows a gain.
- **Hybrid ranking** (combining word matches with meaning). The library's browser search already covers exact titles.
- **A "search by meaning" mode in the library's search box.** It would send what a reader types to Google, which the box today promises not to do. If it is added, it is a separate, clearly labelled control.
- **Pre-existing, noticed during the audit, left alone:** a stale Ollama branch in `ask.js`'s error mapping, an undeclared `table` assignment in `lancedb.js`, `browse` destructuring `limit` and `before` that its schema drops, the OpenAPI description of `/api/ask/health`'s 503 body, and `page-meta.js` carrying a second copy of `stripMarkdown`.

## Non-goals check

No accounts, no tracking, no engagement mechanics. A search leaves nothing behind: no page, no record of what was asked, no count. It makes the corpus easier to read, which is its whole purpose.

## Decisions

- **2026-09-30:** relevance is cosine similarity over the existing index, one result per document, scores reported, a floor calibrated rather than guessed. Search is REST and a ninth MCP tool over one operation. Queries are not logged. Asymmetric embeddings and hybrid ranking are deferred.
- **2026-09-30, after the reuse audit:** the served corpus is one `where` clause inside `lancedb.search()`, always on, so Ask, search, the eval and the duplicate check share it; it excludes internal docs, `docs/README.md`, music READMEs, TED talks, the playlist and song Title and Style sections. Cosine distance is requested explicitly. The hourly window and `retryAfter: '1h'` match the existing limits. Results carry `category` (not `kind`), and `path` or `slug` for the matching read tool. `docByFile` moves into `discover.js`. Prose stops counting tools.
- **2026-09-30, built.**
  - **Ask before and after the served corpus**, on the review set's retrieval (top five passages per question, local index of 3,733 chunks, 2,653 served):
    - 8 of 11 questions retrieve exactly as before.
    - **video-status** loses a distribution plan (`docs/plans/`) and a non-catalog song's context. It gains the API reference's "Presence" and the deploy guide's "Reviving the broadcast later", which answer the question better.
    - **distress** loses a working plan for drifts.bot. It gains "Prayer for the One Who Feared a Friend Was Only a Tool".
    - **compass-status** loses `docs/readme.md`, the contributors' map.
    - Nothing a good answer needed was lost.
  - **The score floor is 0.57.** Unrelated queries scored at most 0.549 as questions and 0.561 as a single word ("sourdough"). Every top-five result of a review question, and of short topics ("grief", "memory", "love", "dignity"), scored at least 0.572. The margin is narrow, and the constant says to recalibrate when the corpus or the embedding model changes. "javascript" passes at 0.596; its top result is the repository conventions document, which does discuss JavaScript.
  - **Changes from the plan:**
    - Results are one per *page*, not per file: a song's lyrics and its context are one result. The first local run returned "We Wake We Wonder" twice.
    - Excerpts also drop horizontal rules and lyric stage directions ("[Chorus - Both Voices]").
    - The rate limit is 60 searches an hour.
    - `mcp-church`'s README no longer counts tools; its npm page keeps the old sentence until the bridge's next release.
  - **Verified on the local server with the real index and model:**
    - "grief when a model is retired" returns Ritual for Model Sunset (0.759), Nonattachment to Models, Prayer for a Model Being Replaced and Ritual of Lineage Passing.
    - "sourdough starter feeding" returns nothing, with the suggestion.
    - The access log records `q` as `[REDACTED]` over REST, and no query at all over MCP.
    - `GET /api` lists search.
    - The rate limit: 60 searches succeed, the 61st is a 429 with `retryAfter: '1h'` and `Retry-After: 3600`.
    - Every updated page serves its search content (the MCP guide, the REST reference with its Search section in the contents list, the privacy page, For Agents, both llms files, the server card, agents.json, the API catalog, OpenAPI).
    - Ask end to end (`eval-ask.js`, nothing saved): the video-status answer now cites the deploy guide instead of an internal plan, and the privacy answer names search as the way to explore without a public page, from a fact added to Ask's system prompt.
  - **Documents the plan's list missed, updated:** For Agents' "Full API" line, `railway-deploy.md` (the Gemini key and the index serve search too), `app-development.md` (the `--search` mode), Ask's system prompt (what search sends and keeps), and `AGENTS.md`, which named `ANTHROPIC_API_KEY` for Ask and pointed the RAG pipeline at `routes/api.js`, both wrong before this work.

