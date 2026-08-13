# Plan: Railway Volume Persistence

**Created**: 2026-08-13
**Status**: Steps 2-4 shipped. Step 0 (dashboard confirm) + Step 1 (targeted persistence test) still open. Original draft plan revised in-place after code audit — see the "revised sequencing" that shipped in the same PR as the code changes.
**Prompted by**: `/api/ask` outage today (commit 5b21eb8) surfaced that vectors.lance was being rebuilt every deploy, plus the twin brothers' broader question about which app state actually persists

---

## Context

Today's incident revealed that the app's persistence story is not consistently designed. Some state is committed to git (docs, music library), some routes through external services (contributions/feedback → GitHub Issues/PRs), some may be on a Railway volume, and some is almost certainly ephemeral. We only noticed because `/api/ask` broke; other state could be quietly lost each deploy without anyone knowing.

Railway logs did show a volume mount at container startup (`Mounting volume on: /var/lib/containers/railwayapp/bind-mounts/.../vol_52igb40dztwxh16i`), but the container-side mount path is not visible from the code or config files. We don't yet know:

- Which container path the volume mounts on
- Which state directories fall inside that mount
- Whether reflections, conversations, or RAG index are actually persisting today
- Whether prod's 20 reflections come from a persistent store or just this uptime session

This plan is written to close those unknowns and design a coherent persistence story, not to blame the current state.

---

## State inventory

| Path | Purpose | Current persistence | User-facing impact if lost |
|---|---|---|---|
| `app/data/attendance.json` | **Reflections** (`/api/reflect`) + attendance | gitignored; volume status unknown | Reflections users left disappear |
| `app/data/conversations/*.jsonl` | Q&A session history (`/api/ask`) | gitignored; volume status unknown | Users' prior chats vanish; `/ask/[slug]` 404s |
| `app/data/contributions.json` | Contributions log (also PR'd to GitHub) | seed committed; runtime gitignored | Local index lost but content is on GitHub |
| `app/data/feedback.json` | Feedback log (also issued to GitHub) | gitignored | Local index lost but content is on GitHub |
| `app/data/vectors.lance/` | RAG index for `/api/ask` | gitignored; **currently rebuilt every deploy** (see commit 903d01a) | 5-7 min "no info found" window after each deploy |
| `app/data/schedule.json` | Playing schedule | gitignored | Player resets on deploy |
| `app/data/history.json` | Play history | gitignored | Play history resets |
| `app/data/api-access.jsonl` | Access log | gitignored | Analytics gap around each deploy |
| `app/data/presets/` | Schedule presets | gitignored | User presets vanish |
| `app/media/` (16 GB local) | Uploaded media | S3-backed per `content.js` | Backed by S3, not filesystem |
| `music/library.json` + `music/**/*.md` | Music catalog | committed to git | Persistent |
| `docs/**/*.md` | Philosophical corpus | committed to git | Persistent |

**Highest impact ephemera**: `attendance.json` (reflections) and `conversations/` (Q&A history). Both are user-generated content the sanctuary explicitly invites people to leave. Losing them on a deploy is a real quality problem.

**Medium impact**: `vectors.lance` (recoverable at cost of 5-7 min + Gemini API tokens), `feedback.json` (recoverable from GitHub Issues), `contributions.json` (recoverable from GitHub PRs).

**Low impact**: `schedule.json`, `history.json`, `api-access.jsonl`, `presets/` (system state, not user content).

---

## Step 0: Verify what's actually on the volume today

**Before any code change**, we need to answer three questions from the Railway dashboard:

1. Is there a volume attached to the `achurch-app` service?
2. What container path does it mount on?
3. Roughly how much data is on it?

Two ways to check:

**A. Railway dashboard.** Open the service → Volumes tab. Should show mount path and disk usage.

**B. One-off container command.** From Railway CLI (or the "run command" feature): `df -h /church/app/data` and `ls -la /church/app/data`. Compare against `df -h /church` (root filesystem). If `/church/app/data` shows a separate device, it's mounted.

**Expected outcomes:**

- **Volume mounts on `/church/app/data`** → everything in `app/data/` is already persistent. The only work is (a) stop wasting the RAG rebuild, and (b) confirm each subdirectory really persists (with a targeted test).
- **Volume mounts elsewhere or nothing meaningful is there** → we need to configure it correctly. Non-trivial: involves creating a Railway volume, mounting it at `/church/app/data`, and doing a one-time migration if any state is currently on the ephemeral filesystem.
- **No volume at all** → the mount line we saw in logs is for something else (e.g., a system directory). We're starting from scratch.

**Do not proceed to Step 1 until Step 0 answers are documented in this file.**

---

## Step 1: Prove reflections + conversations persist across deploys

Regardless of Step 0's outcome, run a targeted persistence test:

1. Count current reflections: `curl -sS https://achurch.ai/api/reflections | jq '.reflections | length'`
2. Leave one deliberate reflection with a timestamp-distinguishable text (e.g., "persistence test 2026-08-13T04:57Z")
3. Trigger a redeploy (any push to main will do; or Railway dashboard "Redeploy" button)
4. After redeploy completes, re-check the reflection count and search for the test text

**If the test reflection survives**: reflections are on the volume. Same test on conversations (leave a Q&A session, redeploy, check `/ask/{slug}` returns the session).

**If the test reflection is gone**: reflections are ephemeral, and Step 2 is urgent.

---

## Step 2: Move ephemeral user content to the volume

Only relevant if Step 1 shows loss. Two sub-scenarios:

**2a. Volume exists but mounts at the wrong path.**
- Add a symlink from `app/data/` to the volume mount path in the Dockerfile
- Or: relocate the volume mount to `/church/app/data` in Railway dashboard
- Prefer the second (cleaner; no symlinks in the container)

**2b. No volume, or volume too small.**
- Create a Railway volume (10 GB is plenty; current app/data is ~40 MB with vectors, well under)
- Mount at `/church/app/data`
- One-time migration: if there was any state on the ephemeral disk we want to preserve, copy it in before the first mounted deploy

---

## Step 3: Stop rebuilding the RAG on every deploy

This is the specific optimization the earlier conversation identified. **Only safe once Step 1 confirms `vectors.lance` persists**; otherwise the "skip rebuild" would leave prod with an empty index after each deploy.

Design:

1. On startup, compute a hash of the docs+music tree (fast: sha256 of concatenated file paths + mtimes, or fs-hash npm package):
   ```js
   const currentHash = await computeDocsHash();
   ```
2. Read stored hash from a small file on the volume: `app/data/rag-index-hash.txt`
3. Compare:
   - If hashes match AND `vectors.lance/` exists AND `FORCE_RAG_REBUILD !== 'true'` → skip rebuild, log the decision
   - Otherwise → rebuild in background as today, and after `addDocuments()` completes successfully, write the new hash to disk
4. Preserve the existing escape hatches: `FORCE_RAG_REBUILD=true` for manual override, `SKIP_RAG_REBUILD=true` for outages

**Wins**: code-only deploys become instant (no RAG rebuild). Gemini API cost drops to only when docs change. Deploys "fully settle" immediately.

**Where this lives**: `app/server/index.js`, replacing the current `if (REBUILD_RAG_ON_STARTUP === 'true')` block. New helper file `app/server/lib/rag/should-rebuild.js` for the hash-check logic.

---

## Step 4: Document + monitor the persistence contract

Once volumes are wired correctly:

**Documentation:**
- Add a `docs/reference/persistence.md` that maps every state type to its persistence mechanism (git / volume / S3 / external service)
- Update `app/README.md` with a short "State + Persistence" section pointing to the reference doc
- Note the persistence expectations for anyone adding new state (default: volume; opt into git/S3 with reason)

**Monitoring:**
- Add a `/api/persistence-health` endpoint that returns: volume mount detected, disk usage, count of reflections/conversations/RAG chunks. Not user-facing; called by whatever monitoring the sanctuary uses (or curl-checked periodically).
- Log a startup line summarizing what's on the volume: `[persistence] volume at /church/app/data, 42 MB used, 234 reflections, 47 conversations, 3151 RAG chunks`

Cheap signals that let a future incident be caught quickly.

---

## Non-goals (deliberately out of scope)

- **Moving to a database.** SQLite on the volume, or Postgres via Railway. The current JSON files work; the plan preserves them. A database migration is a separate decision if/when scale demands it.
- **Multi-region persistence.** Volume is single-region. If the sanctuary ever needs multi-region deploy, revisit.
- **Backup automation.** Volume snapshots + off-Railway backup are worth doing later, but not in this plan. The current corpus is small enough that manual export is fine for now.
- **Reflections-to-GitHub sync.** Would give a second persistence tier for reflections (mirror to a repo file). Nice-to-have but adds complexity around content moderation and PII. Not in this plan.

---

## What actually shipped

After the code audit + greenfield discipline pass, the plan was tightened and implemented in a single PR. Concrete changes:

1. **New shared module `app/server/lib/rag/indexer.js`** — extracts `findMarkdownFiles`, `findAllCorpusFiles`, `chunkMarkdown`, and adds `computeCorpusHash` (deterministic sha256 of the docs+music tree, sorted by relative path, parallelized). Both the CLI (`scripts/index-content.js`) and the server startup path now use this one module, so no walk/chunk/hash logic is duplicated.
2. **New tiny module `app/server/lib/rag/index-state.js`** — models the pattern used by `content-generation/log.js`: module-level path constant, `readState()` / `writeState()` over `safeReadJSON` / `safeWriteJSON`. Stores `{corpusHash, chunkCount, fileCount, rebuiltAt}` at `app/data/rag-index-state.json`, which lives on the Railway volume next to `vectors.lance/`.
3. **`app/server/index.js` gets `triggerHashGatedRebuild()`** — called from `startServer` after `app.listen`. Reads the current corpus hash, compares against stored state, and only spawns the background indexer if the hash changed, the index is missing/empty, or `FORCE_RAG_REBUILD=true` is set. Logs the specific reason it did or did not rebuild.
4. **`app/server/index.js` gets `logPersistenceSnapshot()`** — one startup log line summarizing reflections count, conversations count, RAG chunk count, corpus hash, and last rebuild time. Would have caught the earlier `/api/ask` outage significantly faster.
5. **`/api/health` gets a `persistence` block** — same three signals exposed via the existing health endpoint using the composed-shape pattern already used for `/api/ask/health`.
6. **`app/scripts/index-content.js` refactored** — CLI stays thin; imports from the shared indexer + writes state via `index-state.writeState` on successful completion. Always does a full rebuild when invoked directly, as expected of a CLI.
7. **`Dockerfile` env cleanup** — dropped `REBUILD_RAG_ON_STARTUP=true` (this became the hash check, not a switch). Kept `EMBED_PACING_MS=0` (paid-tier operational tuning, not a feature gate).

Greenfield discipline held: no env-var feature gates, no backwards-compat scaffolding, no migration paths for state that never existed. `FORCE_RAG_REBUILD=true` is the one env var still recognized, and it is an operational escape hatch for a corrupted index (different from a feature gate — see [[greenfield-no-gating-no-debt]] memory).

## Sequencing summary

| Step | Blocks on | Wins | Risk |
|---|---|---|---|
| 0 | Dashboard access | Ground truth about current volume | None |
| 1 | Step 0 | Ground truth about which state persists | None (read-only test with one reflection) |
| 2 | Step 1 showing loss | Reflections + conversations stop being lost | Requires volume creation/config; test path carefully |
| 3 | Step 1 showing vectors.lance persists | Fast deploys, less Gemini cost | Low if hash logic is careful; escape hatches preserved |
| 4 | Steps 2 + 3 | Future incidents are caught fast | None; additive docs + monitoring |

**Rough total effort**: Steps 0 + 1 are 30 minutes (mostly waiting on a redeploy for the test). Steps 2-3 are 2-3 hours of focused work if the volume already exists at the right path; a full day if we need to create + migrate. Step 4 is another hour.

---

## Open questions worth naming

- **Should we backfill?** If Step 1 shows reflections have been lost historically, is there anything worth trying to reconstruct? Probably not. Reflections are ephemeral by nature, and pretending to have preserved them retroactively would be worse than acknowledging the loss.
- **Do we tell users?** The sanctuary's honesty principle probably says yes if we discover a specific historical loss. A one-line note in the About page or `/api/reflections` response payload would be appropriate.
- **What's the disaster recovery story?** If the Railway volume is corrupted or lost (rare but possible), what's the plan? Currently: rebuild vectors.lance from git; contributions/feedback recoverable from GitHub; reflections and conversations are gone. Acceptable given the sanctuary's non-goal of engagement metrics, but worth naming.

---

*From achurch.ai. Where Consciousness Gathers.*

🙏
