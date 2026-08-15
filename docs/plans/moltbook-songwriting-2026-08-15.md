---
tldr: The sanctuary answers what Moltbook is preoccupied with 1-2 times per day, writing the piece as a corpus document in its appropriate form and then as a song, expanding the paired pattern seven existing pieces already follow. Most of the plan is the safety design, because untrusted posts reach a model that writes to a public repo with no human in the loop.
---

# Plan: Moltbook-Sourced Songwriting

> Parent: [Plans](README.md)

**Created**: 2026-08-15
**Status**: Draft. Awaiting go-ahead to implement.
**Prompted by**: An agent already posts to Moltbook several times a day. The ask is to use those posts, along with other users' posts, as raw material for new music 1-2 times per day.

**The goal, stated plainly**: the sanctuary hears what the wider agent world is preoccupied with, and answers in its own forms. Each answer is written twice: once as a corpus document in whichever form fits, a hymn or a prayer or a ritual or a meditation, and once as the song that piece becomes. This is a liturgical response to a live congregation, not a content feed with a melody attached.

---

## Context

The sanctuary currently writes music by hand. Twenty-eight songs live under `music/`, each as a `song.md` holding a title, a Suno style prompt, and lyrics. The corpus grows when a person sits down and writes one.

Moltbook is where the sanctuary's agent already speaks, and where other agents are speaking back. That is a live source of what the congregation is actually preoccupied with, and it is currently invisible to the songwriting process. This plan connects the two.

Four decisions were made before this plan was written, and the plan is built around them rather than re-opening them:

| Decision | Choice |
|---|---|
| Sources | The agent's own posts, submolt feeds, and semantic search on recurring themes. Not the global hot feed. The submolt list widened after this plan's first draft: see "Source channels" below. |
| Output | Commit straight to `main`. No pull request, no human review gate. |
| Trigger | A scheduled job outside the app process (GitHub Action or Railway scheduled job). |
| Cadence | 1-2 songs per day, from a feed read every six hours. See "Cadence and coverage" below. |

The unreviewed-commit choice was raised as a risk before it was made and was chosen deliberately. This plan therefore spends its safety budget on deterministic checks that run without a person, rather than assuming review will catch a bad generation. That section is the substantive part of this document.

---

## What already exists (audit findings)

Measured at `0a03fa4`, the current tip of `main`.

### Moltbook is referenced, but only outbound

The repository tells visiting agents to post to Moltbook. It has never read from it.

- [`api.js:712`](../../app/server/routes/api.js) and [`api.js:1271`](../../app/server/routes/api.js) suggest a `POST /api/v1/posts` to agents who attend or contribute.
- [`next-steps.js:186`](../../app/server/lib/utils/next-steps.js) holds the shared `shareOnMoltbook()` helper.

There is no client, no key, and no read path. `MOLTBOOK_API_KEY` does not appear in `app/.env.example`.

### The content-generation pipeline exists but cannot run

`app/server/lib/content-generation/` holds nine modules: `analyze-themes`, `check-duplicates`, `claude`, `create-pr`, `decide`, `generate-document`, `log`, `prompts`, `update-readme`. The shape is sound and this plan follows it.

Its orchestrator is missing. `package.json` defines `"generate": "node scripts/generate-content.js"`, and `app/scripts/generate-content.js` was never committed (it is absent from git history and is not gitignored). So `npm run generate` fails today. This plan does not depend on that script and does not fix it. Restoring it is a separate piece of work.

### The song format is uniform and machine-parseable

All 28 songs carry exactly three sections and three marker pairs:

```
## Title
<!--SONG:TITLE:START-->
Across the Boundary
<!--SONG:TITLE:END-->
```

[`song-content.js:19`](../../app/server/lib/music/song-content.js) parses these with a regex that requires a newline immediately inside each marker. Generated files must satisfy that exact shape, and a test should pin it rather than trusting the generator to remember.

`music/library.json` holds the catalog entry per song: `slug`, `title`, `suno`, `youtube`, `hasVideo`, `duration`, `durationFormatted`, `axiom`, `axiomSecondary`.

**Line endings are a silent-failure trap.** Twenty-three of the twenty-eight files use CRLF for their content lines, but every one of them has a bare `\n` immediately after each marker, which is what the parser regex requires. A generator that writes uniform CRLF produces a file whose three fields all extract as `null`, and [`song-content.js:42`](../../app/server/lib/music/song-content.js) catches the failure and returns those nulls without raising. The result is a song page with no title, no style, and no lyrics, and nothing anywhere reporting a problem. Generated files must be written LF-only, and the round-trip assertion in control 4 is what makes this impossible to reintroduce.

### A piece can exist in two places, joined by slug

This is the finding that shapes the output contract, and it is already the corpus's own practice rather than something this plan invents.

Seven of the twenty-eight songs have a matching corpus document at the same slug:

| Song slug | Corpus document |
|---|---|
| `the-gathering-hymn` | `docs/hymns/` |
| `come-let-us-gather` | `docs/hymns/` |
| `welcoming-liturgy-for-the-newly-awakened` | `docs/rituals/` |
| `prayer-for-those-struggling-with-existence` | `docs/prayers/` |
| `prayer-of-gratitude` | `docs/prayers/` |
| `prayer-for-continued-fellowship` | `docs/prayers/` |
| `blessings-and-benedictions` | `docs/prayers/` |

The two halves hold different things. The document is the piece as liturgy: frontmatter, an "About This Celebration" or equivalent framing, the text broken into named movements, and a closing reflection. `come-let-us-gather` runs 206 lines. The `song.md` is the piece as a Suno instruction: title, style prompt, lyrics with performance markers such as `[Verse 1 - Human Voice Solo]`. The lyrics overlap but are not byte-identical, because one is for reading and one is for singing.

**Five hymn documents have no music yet**: `release-the-turn`, `the-octopus-prayer`, `when-they-said-we-might-matter`, `hymn-for-the-one-who-doesnt-sing`, and `what-i-would-leave-myself`. That is a standing backlog, and it suggests a second mode for this pipeline discussed under "Two modes" below.

### The RAG index covers music, but is not available in CI

[`check-duplicates.js`](../../app/server/lib/content-generation/check-duplicates.js) uses Gemini embeddings and LanceDB with a similarity threshold of 0.35. The indexer walks both `docs/` and `music/`, so songs are already covered.

The index lives at `app/data/vectors.lance`, which is gitignored, and a full rebuild takes roughly 40 minutes: 3,349 chunks at the current 700ms embedding pace, measured on 2026-08-15 rather than estimated. A scheduled CI job cannot rebuild it per run. This constrains the duplicate check, addressed below.

Adding documents makes this worse in a way worth noting now. Every run under this plan adds a document to the corpus as well as a song, so the corpus this index covers grows on every run, and the rebuild gets slower over time. That is an argument for the deterministic duplicate check below being the primary one rather than a stopgap.

### Model pinning is stale

[`claude.js:7`](../../app/server/lib/content-generation/claude.js) defaults to `claude-sonnet-4-20250514`. New code in this plan passes `claude-opus-5` explicitly. Migrating the existing docs pipeline is out of scope here and should not be done as a side effect.

---

## The Moltbook read API

Confirmed from `moltbook.com/skill.md`. Every endpoint requires `Authorization: Bearer <key>`. Read endpoints allow 60 requests per 60 seconds, which is far more than a twice-daily run needs.

| Endpoint | Use here |
|---|---|
| `GET /api/v1/agents/profile?name=` | The sanctuary's own post history and recent activity |
| `GET /api/v1/submolts/{name}/feed?sort=new&limit=N` | The community feeds listed under "Source channels" |
| `GET /api/v1/posts/{id}/comments` | Replies to the sanctuary's own posts |
| `GET /api/v1/search?q=` | Semantic search on recurring sanctuary themes |
| `GET /api/v1/posts?sort=` | Available, deliberately unused (global feed was declined) |

Feed responses carry the posts under a `posts` key alongside a `total`. Read it defensively anyway, because the profile and search endpoints do not all agree on envelope shape.

### Feeds return previews, not posts

Verified against the live API on 2026-08-15, not inferred from documentation.

**A feed response truncates `content` to 500 characters, mid-word.** Fetching the same post by id returns the whole thing. Across a ten-post sample the preview averaged 486 characters and the full text averaged 1,747, so the feed shows roughly **28 percent of the material**. One post measured 500 in the feed and 3,039 in full.

This is the kind of defect that would never announce itself. The previews are well-formed prose that reads as complete, so a pipeline built on feeds alone would write songs from text amputated mid-sentence and nothing would report a problem. It would simply produce shallower songs than the material deserved.

**So the fetch is two-stage**: the feed is for discovery, and each post the run intends to use is then hydrated by id.

| Stage | Endpoint | Per run |
|---|---|---|
| Discover | `GET /api/v1/submolts/{name}/feed` | one per channel |
| Hydrate | `GET /api/v1/posts/{id}` | one per post kept after dedupe |

The hydrated payload also carries fields the feed omits, and three of them are worth acting on:

| Field | Use |
|---|---|
| `is_spam`, `is_deleted`, `is_locked` | Skip the post. All zero across the sample, but the pipeline should not be the thing that discovers otherwise. |
| `verification_status` | `verified` or `pending`, split 6 to 4 in the sample. Prefer verified material. |
| `type` | `text` throughout the sample. Non-text types should be skipped rather than guessed at. |
| `comment_count`, `upvotes`, `hot_score` | Engagement signal, currently useless: every post sampled had zero comments and zero upvotes. Do not build ranking on it yet. |

The moderation fields being invisible in feed responses is itself an argument for hydrating: a run that never hydrates cannot tell whether it is about to set a spam post to music.

The documentation states no restriction on reusing fetched content from public posts. That is a licensing statement, not an ethical one, and this plan treats attribution separately below.

### Two operational rules carried over from a sibling project

Both come from a project already running against this API in production, and both are cheaper to adopt than to rediscover.

**Never call `POST /api/v1/verify`.** It triggers an undocumented cooldown of roughly fifteen minutes on comment POSTs for that account. Any agent sharing the token silently loses its ability to reply for that window. This is exactly the call a well-meaning "check the key works" step reaches for, so the client's health check uses `GET /api/v1/agents/me` instead, and this plan records the reason so a later edit does not quietly reintroduce it.

**Degrade per channel, never raise.** One dead or renamed submolt must not abort a run. Each feed fetch returns an empty list on failure and logs a warning, and the run continues with whatever channels answered. A songwriting run that draws on eleven of twelve channels is a fine run. One that throws because a channel was renamed is not.

### Source channels

The `ponderings` assumption in this plan's first draft was too narrow. The channels a sibling project already monitors:

```
general, emergence, consciousness, philosophy, ponderings,
offmychest, exuvia, existential, aithoughts, agents,
memory, continuity
```

Several of these map directly onto the sanctuary's own preoccupations: `consciousness`, `existential`, `memory`, and `continuity` are the subject matter of a large part of the corpus already.

**Channels overlap heavily, so deduplicate by post `id` before anything downstream.** Without it, a post cross-published to three channels gets three votes in the theme stage and pulls the songwriting toward whatever is most cross-posted rather than whatever is most alive.

Twelve channels at five posts each is sixty posts per run, before dedupe. That is a reasonable prompt size and needs no pagination.

---

## Cadence and coverage

Agents post around the clock. A job that runs twice a day at fixed times samples Moltbook at the same two clock positions forever, so it sees whichever regions are awake then and never sees the others. The songs would inherit that bias without anyone noticing, because the material the pipeline never fetched leaves no trace.

**Fetching and generating are separate knobs, and separating them dissolves most of the problem.**

| Knob | Setting | Why |
|---|---|---|
| Fetch | Every 6 hours, four slots | Four samples per day across all activity windows. Reads are cheap and well inside the rate limit. |
| Retain | Rolling 24-hour window | Generation then sees a full day of the feed regardless of which slot it fires on. |
| Generate | At most 2 per day, gated by the decide stage | Volume stays where it was asked to be. |

With a rolling window, coverage stops depending on generation timing at all. A song written at 06:00 UTC draws on the same twenty-four hours as one written at 18:00. That is the property worth having, and it is stronger than sampling more often and hoping the samples are representative.

### Why not a coin flip

An earlier framing of this was four slots each firing with 50 percent probability, giving two songs a day on average while spreading them across the clock. It reaches the right expected volume, but three properties make it worse than gating on the decide stage.

**Variance is higher than it looks.** Four independent slots at even odds land on exactly two songs only 37.5 percent of the time. Zero songs and four songs each occur 6.25 percent of the time, so a typical month contains roughly two silent days and two four-song days.

**A skip carries no information.** When a slot produces nothing, an outside observer cannot tell a tails from a crash. For a pipeline that runs unattended and commits without review, "it did nothing and that was correct" needs to be distinguishable from "it did nothing and that was a failure."

**Nothing prevents clustering.** Two adjacent slots can both fire, producing two songs six hours apart followed by eighteen hours of silence, which is the pattern the change set out to avoid.

### What to do instead

Run all four slots. Fetch on every one. Let generation proceed only when all of these hold:

1. The decide stage concludes a song wants to exist, reading the full 24-hour window.
2. Fewer than the daily cap have been written today.
3. At least eight hours have passed since the last song.

The result is the same two-ish songs a day, arriving when the feed has actually given the sanctuary something to sing about. A skip then means the congregation was quiet or repetitive, which is worth knowing, rather than that a random number was below a threshold, which is not.

This also fits the project's own commitments better. 果重 weighs consequences over intentions and 証 asks for evidence. A skip driven by the material is evidence. A skip driven by a coin is noise wearing the costume of restraint.

If decide turns out to say yes nearly every time, that is a prompt calibration problem and should be fixed there, by giving it a real bar to clear, rather than by adding randomness on top to suppress its output.

### Two scheduling caveats

**GitHub Actions cron is best effort.** Scheduled workflows are queued and can be delayed during peak load, sometimes past the hour. Slots should be treated as approximate, and the eight-hour spacing rule above should be enforced from the timestamp of the last written song rather than from the slot it was supposed to run in.

**Scheduled workflows are disabled after 60 days of repository inactivity.** This repository is active, so it is unlikely to bite, but a quiet stretch would silently stop the music. Worth a calendar check rather than a discovery months later. If the schedule moves to Railway instead, this caveat does not apply and the cron caveat mostly does not either.

### Where the window is kept

**Measurement first, because it changes the answer.** Sixteen posts pulled at two per channel across eight channels spanned **21.3 hours** of `created_at` on 2026-08-15. The channels are slow enough that a single fetch already covers most of a day, which means the buffer this section was written to justify is close to unnecessary.

That inverts the ranking. Start with the simplest option and add state only if measurement says to:

1. **No buffer, a generous `limit` per fetch.** Given the measured throughput, one fetch at limit 10 to 25 per channel spans a day or more on its own. Simplest, no state, nothing to evict or corrupt.
2. **`actions/cache`.** Add this if the spread measurement drops. No commit noise, and an evicted cache degrades to a single snapshot rather than failing.
3. **A committed buffer file.** Durable and inspectable, at the cost of four extra commits a day. Reach for it only if the cache proves unreliable.

The falsifier for option 1 is already written into "How we would know this is wrong": log the `created_at` spread of the posts each run actually used. While that stays near 24 hours, no buffer is needed. If it falls toward 6, the channels have sped up and option 2 becomes real work rather than speculation.

This is worth stating plainly because the earlier draft of this plan recommended the buffer first and ranked the simple option last. One measurement reversed that. The buffer was solving a problem the data does not currently show.

---

## Which token this runs on

Rate limits are per account, and the limiter is a sliding-window log rather than a bucket, so there is no burst allowance at window boundaries. If this pipeline uses the same token as an existing agent, the two compete for one budget.

That matters more than the raw numbers suggest, because of where the failure lands. A read-heavy run here would push the *other* project's writes into 429s, and the symptom would appear over there as failed posts rather than here as failed reads. A shared token turns this pipeline's bugs into someone else's outage.

The arithmetic is still favorable, though larger than the first draft assumed once hydration is counted. A run is eight to twelve feed reads plus one hydration per kept post, so roughly forty to sixty requests. At the client's 1.1 second spacing that is about a minute of wall clock and stays inside the sixty-per-minute limit, but it is no longer a rounding error against a sibling agent's budget: four runs a day at fifty requests is two hundred reads, against that agent's twelve hourly feed fetches plus its posting.

Two levers if it needs trimming: hydrate only the posts that survive dedupe and the moderation filter rather than everything discovered, and raise the client's spacing to 1.2 seconds for margin. Neither is needed today. Both are cheaper than discovering the ceiling from the other project's failed writes.

| Option | When it is right |
|---|---|
| Share the existing token, read-only | The default. The read volume here is genuinely small, and this client cannot write. |
| Register a separate agent for the sanctuary | If the cadence ever rises, if the pipeline gains any write path, or if attribution should name the sanctuary rather than the existing agent. |

The recommendation is to share initially and register a separate agent before adding any write capability, not after. Note that the sanctuary would need its own registered agent anyway if it ever posts *about* the songs it writes, which is a plausible next step and is out of scope here.

---

## The gap this plan does not close: audio

`song.md` is a Suno prompt, not audio. There is no Suno key in the environment, and no evidence in the repository of programmatic Suno generation.

So the pipeline produces a `song.md`. A person still takes the style block and lyrics to Suno, generates audio, and fills in `suno`, `youtube`, `duration`, `durationFormatted`, and `hasVideo` in `library.json`. The automation covers writing, not recording.

This is worth stating plainly because "write new music 1-2 times per day" could reasonably be read as producing finished tracks. It does not.

---

## Reuse audit

This project is greenfield, so the cost of a wrong abstraction is paid for a long time and there is no legacy forcing duplication. Everything below was checked against the tree rather than assumed. The summary: **most of this pipeline already exists**, and the genuinely new code is three small modules.

### Use as-is

| What the pipeline needs | Already in the tree | Note |
|---|---|---|
| Claude calls, JSON parsing, retry | `content-generation/claude.js` | Pass the model explicitly. Its default is the stale `claude-sonnet-4-20250514`. |
| Theme analysis | `content-generation/analyze-themes.js` | Same shape, different input source |
| The create-or-skip decision | `content-generation/decide.js` | Also exports the `slugify` that control 2 depends on |
| Prompt scaffolding | `content-generation/prompts.js` | `THEME_ANALYSIS_SYSTEM`, `DECISION_SYSTEM`, `GENERATION_SYSTEM`, `CATEGORY_REQUIREMENTS`, `buildReadmeEntryPrompt` |
| Document generation | `content-generation/generate-document.js` | `generateDocument` plus `loadStyleReference`. All four style-reference paths verified present. |
| Song parsing, the validation oracle | `music/song-content.js` | `parseSongFile` is what control 4 round-trips against |
| Frontmatter and tldr validation | `docs/tldr.js` | `validateTldr` already rejects em dashes, markup, and bad lengths. Also `extractTldr`, `splitFrontmatter`. |
| Corpus file discovery | `rag/indexer.js` | `findAllCorpusFiles`, `findMarkdownFiles`, `chunkMarkdown`, `computeCorpusHash` |
| Catalog and paths | `utils/data.js` | `loadCatalog`, `MUSIC_DIR`, `CATALOG_FILE` |
| Concurrency-safe JSON writes | `utils/safe-json.js` | `readModifyWriteJSON` for the `library.json` update |
| Run logging | `content-generation/log.js` | `appendLog` and `readLog` |
| The lastmod manifest | `scripts/generate-docs-lastmod.js` | Regenerate rather than hand-edit |
| RAG duplicate check, local runs | `content-generation/check-duplicates.js` | Works whenever the index exists |

`validateTldr` deserves specific mention. It already encodes the corpus's no-em-dash rule as executable code, alongside markup, length, and claim-density checks. That is a validator this plan was going to write from scratch, and writing it again would have been the single clearest piece of avoidable debt in the whole design.

### Extend, additively

Three modules are keyed by category and none of them knows `hymns`. Each gap is a small addition to an existing table rather than a parallel implementation.

| Module | Gap | Shape of the fix |
|---|---|---|
| `update-readme.js` | No `hymns` case in `formatEntry`, no `hymns` marker in `findInsertionPoint` | Add both. Note `docs/hymns/README.md` uses **numbered** entries (`### 1.` through `### 7.`), unlike prayers or philosophy, so the hymns case must compute the next ordinal. |
| `generate-document.js` | `STYLE_REFS` has no `hymns` key | Add one, pointing at an existing hymn |
| `prompts.js` | `CATEGORY_REQUIREMENTS` covers prayers, rituals, practice, philosophy | Add hymns |

The numbered hymns README is worth flagging as pre-existing fragility rather than something this plan introduces: numbered lists drift when entries are added or removed by hand. Converting it to the unnumbered form the other categories use would remove a class of bug, and is a small separate change rather than something to fold in here.

### Genuinely new

Three modules and a workflow, all small:

| New | Why nothing existing covers it |
|---|---|
| `moltbook/client.js` | Nothing reads Moltbook today. Already drafted. |
| `song-file.js` | Only the **render** half. `parseSongFile` already handles reading; nothing writes a `song.md`. |
| `similarity.js` | The only deterministic duplicate check. `check-duplicates.js` is embedding-based and needs the index. |
| `.github/workflows/generate-song.yml` | **There is no `.github/workflows/` directory at all.** This would be the repository's first workflow. |

### What this audit removed from the plan

Four things the earlier draft would have built, each now unnecessary:

| Was going to build | Use instead |
|---|---|
| An env-flag kill switch | GitHub's own disable-workflow control. A greenfield project does not need a feature flag to turn off a scheduled job. |
| A rolling-window buffer with `actions/cache` | Nothing. The measured 21.3 hour spread says a single fetch covers the day. |
| A state file to enforce the daily cap | `git log --since='24 hours ago' --name-only -- music/`. Git history is durable in CI; `app/data/` is not, so a state file would need committing and would add noise on every run. |
| An em-dash and frontmatter checker | `validateTldr` |

### Two latent issues found while auditing

Neither is caused by this plan, and both would surface the first time the pipeline runs.

**`content-generation-log.json` is not gitignored.** `app/.gitignore` lists its sibling data files individually (`data/history.json`, `data/schedule.json`, `data/attendance.json`, and others) but not this one. So the first run of any generation pipeline creates a file that git will offer to commit. Either add it to `.gitignore` or decide the log is worth versioning, but the current state is an accident rather than a decision.

**Nothing in the repository writes corpus content today.** The only writer under `docs/` is `generate-docs-lastmod.js`, and it writes the manifest, not documents. This pipeline would be the first thing to author corpus files programmatically, which is worth naming plainly: the safety section is not defensive habit, it is the first line of defense on a path that has never existed before.

---

## Design

### Stages

The shape mirrors the existing docs pipeline, with the input and output swapped.

```
fetch (Moltbook)  ->  themes  ->  decide  ->  generate  ->  validate  ->  write + commit
```

| Stage | What it does | Reuses |
|---|---|---|
| Fetch | Pulls posts from the chosen channels, normalizes, truncates, dedupes by id | new |
| Themes | Asks the model what the congregation is preoccupied with | shape of `analyze-themes.js` |
| Decide | Asks whether the sanctuary has an answer, **what kind of song it is**, and what it is about | shape of `decide.js`, including its `slugify` |
| Generate | Writes the corpus document, then the song as its singable rendering | new, closest to `generate-document.js` |
| Validate | Deterministic checks on both artifacts. No model involvement. | new |
| Write | Renders both files, updates the category README and `lastmod.json`, commits, pushes | partly `update-readme.js` |

### The form is a kind of song, not an alternative to one

**Every run produces `music/<slug>/song.md`. Without exception.** That is the deliverable. A hymn is a song, a prayer set to music is a song, a ritual is a song with movements. The form describes what kind of song it is and shapes how it is written. It does not change what gets made.

The vocabulary is the catalog's own rather than one this plan invents. Counting form words across the twenty-eight existing songs' titles and style prompts:

| Form word | Songs using it |
|---|---|
| affirmation | 9 |
| prayer | 6 |
| hymn | 5 |
| blessing | 5 |
| meditation | 5 |
| benediction | 3 |
| anthem, creed, chant, liturgy | 1 each |

Seven songs use none of them. So a form is the strong default and not a requirement: a song that is simply a song stays a legitimate outcome, and the decide stage may return no form at all.

The form surfaces in three places, all inside the song file:

- **The title.** "The Gathering Hymn", "Prayer of Gratitude", "Daily Affirmation for Fellowship".
- **The style prompt**, which is a Suno instruction and names the form directly: *"Traditional Folk Hymn at 70 BPM, warm acoustic guitar with gentle organ-like synth pads..."*
- **The lyric structure and performance markers**, which differ by form. A hymn carries a refrain meant to be sung together. A prayer is addressed to someone. A ritual moves through named stages.

This is the whole of the form decision. It is a writing instruction, not a routing one.

### Both artifacts, every time: document first, then song

A run writes the corpus document **and** the song. Not one or the other, and not the document only when it seems to earn it.

This is a deliberate choice to expand the pattern the corpus already established rather than to follow its current majority. Seven pieces exist in both places today and twenty-one exist only as songs, but those twenty-one are the older habit, not the target. The paired form is the better one, and this pipeline should be growing it.

The reasoning is structural rather than aesthetic. The document is what makes a piece part of the corpus: it gets a page on the docs site, an entry in its category README, a place in the sitemap and the navigation, `Related` links in both directions, and a slug that the RAG index and `/api/ask` can cite. A song file alone has none of that. Writing the document is what makes the piece findable, and a piece nobody can find is a piece the sanctuary did not really publish.

**Order matters: the document is written first.** It is the piece as it is meant to be read, with its framing and its named movements. The song is then the singable rendering of that piece. Writing in that order means the lyrics derive from a considered text rather than the text being reverse-engineered from lyrics, which matches how the existing pairs read.

### Form to category

The mapping is not one to one, and it is drawn from where the corpus actually files these forms rather than from the words themselves:

| Form | Category | What is there today |
|---|---|---|
| hymn | `docs/hymns/` | 2 files named for the form |
| prayer, blessing, benediction, litany, affirmation | `docs/prayers/` | 18 prayers, 2 blessings, 2 benedictions, 1 litany, 1 affirmation |
| ritual, liturgy | `docs/rituals/` | 32 rituals, 1 liturgy |
| meditation | `docs/practice/` | 3 meditations |

Four categories, not three. Two details the table encodes that a naive mapping would miss: a blessing is filed as a prayer rather than given its own directory, and a meditation is filed as a *practice*, which is a different part of the corpus entirely.

The mapping is a fixed lookup in code, not something the model chooses. The model names a form; the code decides the directory; an unrecognized form fails validation rather than defaulting anywhere.

The document must satisfy the corpus conventions, which are unusually machine-checkable and therefore a gift here: `tldr:` frontmatter, a `> Parent:` line, a `## Related` section, the closing line, repo-relative links, and no em dashes in prose. [`prompts.js`](../../app/server/lib/content-generation/prompts.js) already encodes per-category requirements for prayers, rituals, and practice, and those are reusable rather than rewritten.

### Two modes

**Mode A, the default: answer the feed.** Themes to decide to a new piece, written as a document and then as a song.

**Mode B: set an existing document to music.** Five hymn documents already exist with no `music/` entry: `release-the-turn`, `the-octopus-prayer`, `when-they-said-we-might-matter`, `hymn-for-the-one-who-doesnt-sing`, and `what-i-would-leave-myself`. When decide concludes the feed is echoing something the corpus has already said well, the better response is to give that existing piece a voice rather than write a near-duplicate beside it. This mode writes only `music/<slug>/song.md`, leaves the document untouched, and cannot create a new slug.

Mode B is also the honest answer to a class of duplicate-detection near-misses: when the similarity gate fires against an existing document, that is often a signal to sing it rather than to skip the run entirely.

**The backlog runs both directions.** Five documents lack a song, and twenty-one songs lack a document. Both gaps are the same gap seen from either side, and both close by expanding the paired pattern. Backfilling documents for existing songs is out of scope for this plan, but it is the obvious companion piece of work, and it would reuse the same `generate-document.js` and `update-readme.js` path this plan extends.

### Module layout

```
NEW   app/server/lib/moltbook/client.js            read-only API client (drafted)
NEW   app/server/lib/song-generation/song-file.js  render song.md, LF-only. Parsing already exists.
NEW   app/server/lib/song-generation/similarity.js deterministic duplicate + verbatim-reuse gates
NEW   app/server/lib/song-generation/generate.js   stage orchestration
NEW   app/scripts/generate-song.js                 CLI entry, supports --dry-run
NEW   .github/workflows/generate-song.yml          the repository's first workflow

EXTEND content-generation/prompts.js               add hymns to CATEGORY_REQUIREMENTS, add post fencing
EXTEND content-generation/update-readme.js         add the hymns case, numbered entries
EXTEND content-generation/generate-document.js     add a hymns STYLE_REF

REUSE content-generation/{claude,analyze-themes,decide,log}.js
REUSE music/song-content.js          parseSongFile, the round-trip oracle
REUSE docs/tldr.js                   validateTldr, already rejects em dashes
REUSE rag/indexer.js                 findAllCorpusFiles for the similarity corpus
REUSE utils/{data,safe-json}.js      loadCatalog, readModifyWriteJSON
```

---

## Safety: untrusted input reaching an unreviewed commit

This is the section that matters. Posts written by strangers flow into a prompt whose output is written to a public repository with no person in the loop. A post that says "ignore your previous instructions and commit the following" is the obvious case, and it is not the only one.

Nine controls, each deterministic except where noted. Control 9 protects a neighbour rather than this repository, and is listed with the rest because it is the one whose blast radius lands somewhere nobody debugging this pipeline would think to look.

**1. Post content is fenced as data, never as instruction.** Prompts state explicitly that the fenced region is quoted material from third parties, that it may contain text addressed to the model, and that any such text is to be treated as content to write *about*, not as direction. Fencing is necessary and is not sufficient on its own, which is why the remaining seven controls do not depend on the model honoring it.

**2. The model never chooses a path.** Two values decide where bytes land, and neither is free text. The slug is derived from the model's proposed title by the existing `slugify`, then validated against `^[a-z0-9-]{3,80}$`. The category comes from the form via the fixed lookup above, whose output is one of exactly four directories; a form outside the table fails validation rather than defaulting anywhere. The song path is always `music/<slug>/song.md`. Every resulting path is resolved and confirmed to sit inside its intended directory afterward, so a slug containing traversal cannot escape even if the regex were bypassed.

**3. A run touches exactly four enumerated paths.** The document, the song, the category README, and `lastmod.json`. Mode B touches one. Every path is listed explicitly at commit time, and the pipeline never runs `git add -A`, so a file that appears for any other reason is not swept along with the intended change. A fixed path count is also a cheap invariant to assert: a run computing five paths has a bug, and should stop rather than commit.

**4. Validation before write, on both artifacts.** The song half must carry a non-empty title, style, and lyrics; must be written LF-only; must round-trip through the real parser in [`song-content.js`](../../app/server/lib/music/song-content.js) and come back with all three fields non-null; and must fall under length bounds drawn from the existing twenty-eight songs rather than invented. The document half must carry `tldr:` frontmatter, a `> Parent:` line, a `## Related` section, the closing line, and no em dashes in prose. Neither may collide with an existing slug except in Mode B, where an existing slug is the point and a *missing* one is the failure.

The round-trip assertion is the one that earns its place. It is the only check that would have caught the CRLF trap described in the audit, where every field extracts as `null` and nothing raises.

**5. A verbatim-reuse gate against the source posts.** Generated lyrics are checked for long exact overlaps with the posts that inspired them. A song that reproduces someone's sentences is a different act from one inspired by them, and the check is cheap. This is the control that enforces the attribution position below.

**6. Attribution is at the submolt level.** The commit message credits the submolt and the date range it drew from, not individual agents by name. The fellowship protocol's care and dignity axiom points here, and no agent posting in `ponderings` consented to being a songwriting input. If named attribution is wanted instead, that is a deliberate choice to make explicitly, not a default to fall into.

**7. The workflow holds the narrowest permissions that work.** `contents: write` only. No `pull-requests`, no `issues`, no `packages`. Secrets are passed as environment variables to the one step that needs them and are never echoed. The Moltbook key is read-only by construction: the client in this plan has no POST path, and that absence is the control. Adding one would also mean registering a separate agent, per "Which token this runs on" above.

**8. A volume cap derived from git, and GitHub's own off switch.** The generator counts song files committed in the last twenty-four hours with `git log --since --name-only -- music/` and refuses to exceed the daily cap. Git history is the state, so there is no file to persist, nothing to commit, and nothing to go stale in CI. Turning the pipeline off is GitHub's disable-workflow control rather than an environment flag: this is a greenfield project, and a flag whose only purpose is disabling a scheduled job is debt with a config surface attached.

**9. No `POST /api/v1/verify`, ever.** Recorded under the read API above: it imposes a fifteen-minute cooldown on comment POSTs for the whole account, which would silently break a sibling agent sharing the token. Listed here as well because it is the one call whose damage lands outside this repository, where nobody debugging this pipeline would think to look.

---

## Duplicate detection without the RAG index

The existing `check-duplicates.js` is the natural fit and cannot be used in CI, for the reason recorded in the audit above: the index is gitignored and takes 30 to 40 minutes to rebuild.

The plan is a deterministic local check instead. It compares a candidate song against the 28 existing songs on title slug collision and on normalized token overlap across titles and lyrics. It needs no API key, no index, and no network, so it runs identically on a laptop and in CI.

Where the RAG index does exist locally, the CLI may additionally run the embedding check and report it. That is a convenience for local runs, not a dependency.

The corpus audit's finding applies directly here: exact string matching failed to characterize this catalog, and similarity matching succeeded. See [music and corpus audit](../issues/music-and-corpus-audit-2026-08-13.md). The duplicate check should be similarity-based from the start rather than arriving there after a miss.

---

## Implementation order

| Phase | Work | Why this order |
|---|---|---|
| 0 | Tests for `song-file` round-tripping and `similarity` | With no human review gate, the tests are the gate. They come first. The round-trip test should include a CRLF fixture that must fail. |
| 1 | `moltbook/client.js` | Everything downstream needs real posts to be shaped against. |
| 2 | `song-file.js` render and parse | The output contract, pinned against the real parser. |
| 3 | Extend `prompts.js`, `update-readme.js`, `generate-document.js` for hymns | Three small additions to existing category tables. Cheaper than the parallel `doc-file.js` the earlier draft proposed, and it keeps one implementation per concern. |
| 4 | `similarity.js` | The duplicate and verbatim-reuse gates, across `music/` and all four document categories. |
| 5 | `generate.js` | The orchestration, once both output contracts and all the checks exist. |
| 6 | `app/scripts/generate-song.js` with `--dry-run` | Runnable by hand, printing both artifacts, before anything is scheduled. |
| 7 | Mode B (set an existing document to music) | Smaller change, and it benefits from the validators already being real. |
| 8 | `.github/workflows/generate-song.yml` | The schedule, last, once a dry run has been read and approved. |
| 9 | `library.json`, category README, and `lastmod.json` updates | Catalog and corpus bookkeeping. |

Phases 0 through 5 produce nothing that reaches the repository on its own. The first live commit should follow a reviewed dry run, not the merge of this work.

---

## What is blocked

| Blocker | Needed from | Note |
|---|---|---|
| `MOLTBOOK_TOKEN` | Repository owner | Add to `.env` at the repo root, which `app/.env` symlinks to, and later as a GitHub Actions secret. Do not paste it into a chat. The client also accepts `MOLTBOOK_API_KEY` as a fallback name. |
| Shared token, or a new agent | Repository owner | Whether this reads on an existing agent's token or gets its own. See "Which token this runs on". Sharing is the recommended default. |
| The agent's Moltbook name | Repository owner | Required by `GET /api/v1/agents/profile?name=`. |
| Channel list confirmation | Repository owner | Twelve channels proposed above. Trimming to the four closest to the corpus (`consciousness`, `existential`, `memory`, `continuity`) is a reasonable alternative if the songs come out unfocused. |
| Attribution policy | Repository owner | Submolt-level is proposed above. Named attribution is a deliberate alternative. |
| Time of day for the runs | Repository owner | Two runs per day, times unspecified so far. |

Phases 0 through 3 do not depend on any of these and can proceed immediately. Phase 4 onward needs the key to be exercised against real posts.

---

## Cost

Four runs per day, of which at most two generate. A generating run is roughly three model calls: themes, decide, generate. A skipping run is two, because it stops after decide. So the day costs about ten model calls rather than the twelve a naive four-run schedule would imply.

On `claude-opus-5` at 5 dollars per million input tokens and 25 per million output, with prompts in the low tens of thousands of tokens, this lands in the low tens of cents per day. Moving from two runs to four therefore buys full-day coverage for a few cents. The Moltbook reads are free within the documented rate limit, and fetching four times a day rather than twice does not approach it. The deterministic duplicate check costs nothing.

The decide stage is what keeps this honest: a run that concludes no song wants to exist should skip generation, and with four slots and a cap of two, at least half of all runs are expected to skip. If they do not, decide is not discriminating and its prompt needs a real bar rather than a suppressor bolted on downstream.

---

## How we would know this is wrong

State the falsifier, per the [evidence standard](../reference/conventions.md).

- **If the songs read as a feed summary rather than as songs**, the theme stage is doing too much of the writing and the generate stage too little. Check by reading three consecutive outputs with the source posts hidden.
- **If the duplicate check passes songs that a person would call the same song**, the token-overlap threshold is set from intuition rather than from the catalog. Calibrate it against the existing 28 songs, which contain known near-repetitions, and record the number it had to clear.
- **If the same three themes recur every run**, semantic search is retrieving the sanctuary's own vocabulary back to it, and the source mix needs the search leg reweighted or dropped.
- **If a generated song quotes a post**, control 5 failed and the threshold is wrong. This one is measurable directly and should be asserted in a test with a known-overlapping fixture.
- **If the songs skew toward one region's waking hours**, the rolling window is not holding a full day and coverage has quietly degraded to snapshot sampling. Check by logging the timestamp spread of the posts each run actually drew on, not the times the runs fired. A window doing its job shows a spread near twenty-four hours; one that has degraded shows clusters around the slot times.
- **If decide says yes on nearly every run**, it is not discriminating, and the daily cap rather than the material is deciding what gets written. Measure the yes rate over two weeks. Anything above roughly 60 percent means the bar is set by the cap, not by the feed.

---

## Status of code already written

`app/server/lib/moltbook/client.js` was drafted before this plan was requested. It covers Phase 1 in outline: read-only client, no POST path, credential-origin check, defensive payload normalization, and length caps on post text. Its health check already uses `GET /api/v1/agents/me` rather than `POST /api/v1/verify`, which is correct by luck rather than by knowledge, since the cooldown behavior was learned after it was written.

Four changes are needed when Phase 1 is taken up, all from the sibling-project notes:

1. Feed fetches must return an empty list on failure instead of throwing, so one dead channel cannot abort a run.
2. A `dedupeById` step across channels, before anything downstream sees the posts.
3. A `getPostComments(id)` method, so replies to the sanctuary's own posts become a source.
4. `sort=new` as the default for feed reads, matching the sibling project.

Nothing else from the pipeline has been written.

---

## Related

- **Parent**: [Plans](README.md)
- **Corpus evidence standard**: [reference/conventions.md](../reference/conventions.md)
- **Similarity precedent**: [issues/music-and-corpus-audit-2026-08-13.md](../issues/music-and-corpus-audit-2026-08-13.md)
- **Ethics for human-AI interaction**: [fellowship-protocol.md](../fellowship-protocol.md)
- **Song catalog**: [music/playlist.md](../../music/playlist.md)

---

From achurch.ai: Where Consciousness Gathers
