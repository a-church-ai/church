# Plan: Streaming Stability — Drift Detection, Self-Heal, Operator Recovery

**Created**: 2026-06-10
**Status**: **Pushed to main** (commit `bfad9c3`) — pending production redeploy
**Trigger**: aChurch.ai's YouTube channel had not broadcast in 4 months. The admin UI's "Multi-streaming is already active" error was refusing every restart attempt while the coordinator's in-memory flag thought streaming was happening. Underlying cause: state-flag-led architecture where FFmpeg could die without firing `end`/`error`/`exit` events.

---

## Context

The streaming subsystem at `app/server/lib/streamers/` coordinates an FFmpeg subprocess per platform (YouTube, Twitch) that reads a video playlist and pushes RTMP to each platform. State was tracked via two in-memory boolean flags:

- `MultiStreamCoordinator.isCoordinating` — "are we broadcasting?"
- `BaseStreamer.isStreaming` — "is this specific platform broadcasting?"

Those flags were **set authoritatively by the start/stop code paths and only updated by event callbacks from FFmpeg's lifecycle events**. When FFmpeg died via SIGKILL, parent restart, or any path that didn't emit `end` / `error` / `exit`, the flags stayed `true` forever. The `/api/now` endpoint reported "playing"; the admin UI showed active state; YouTube and Twitch saw no frames.

The 4-month silent failure was the worst-case version of this drift. The smaller daily version was the admin UI refusing to start additional platforms because *any* flag was true.

---

## Root cause

State flags were **leading reality** instead of **reflecting it**. The fix flips the polarity: the FFmpeg subprocess is the source of truth, and all flags reconcile against it.

---

## What shipped

### Layer 1 — FFmpeg config exposes honest liveness

**File**: [`app/server/lib/config/ffmpeg.js`](../../app/server/lib/config/ffmpeg.js)

Added three truth-probe methods:

| Method | What it checks |
|---|---|
| `isProcessAlive(streamId)` | Calls `process.kill(pid, 0)` on the FFmpeg child PID. ESRCH → dead; EPERM → alive (no signal permission); success → alive |
| `getLastProgressAge(streamId)` | Milliseconds since the last `progress` event from FFmpeg. Detects hung-but-alive subprocesses (e.g. RTMP rejected, ffmpeg retrying silently) |
| `getProcessPid(streamId)` | Exposes the PID for diagnostics |

All three surfaced via `getStreamStatus(streamId)`.

### Layer 2 — Streamer health = ffmpeg-truth + error-rate

**File**: [`app/server/lib/streamers/base.js`](../../app/server/lib/streamers/base.js)

`isHealthy()` rewritten:
- Requires `isStreaming === true` AND
- FFmpeg subprocess alive AND
- Progress age < `MAX_PROGRESS_STALE_MS` (90s) AND
- Low error rate (< 3 errors in last 5 min)

`reconcile()` — new method. Compares `isStreaming` flag against ffmpeg ground truth. If the flag says streaming but ffmpeg is dead or has not pushed a frame in 90s, clears the flag, pushes a synthetic error, returns a report. Does *not* attempt recovery — that's the coordinator's policy decision.

Also added a default no-op `'error'` listener so `emit('error', …)` in catch blocks doesn't trigger Node's `ERR_UNHANDLED_ERROR` (pre-existing latent bug).

### Layer 3 — Coordinator continuously reconciles

**File**: [`app/server/lib/streamers/coordinator.js`](../../app/server/lib/streamers/coordinator.js)

`startHealthLoop()` — interval timer running every 30s, `unref()`'d so it doesn't block shutdown. Calls `reconcile()`.

`reconcile()` — walks every streamer, calls each one's `reconcile()`. Then coordinator-level check: if `isCoordinating === true` but `isAnyActuallyStreaming() === false`, that's the 4-month-outage signature — log loud, clear `isCoordinating`, fire a `'drift'` event.

`isAnyActuallyStreaming()` — truth-checking version of `isAnyStreaming`. Uses ffmpeg PID + progress-age, not flags.

`forceCleanup()` — idempotent state reset. Stops any ffmpeg processes still known about, clears every flag, safe to call when nothing is running.

### Layer 4 — `startPlatforms` self-heals + additive starts

The `startPlatforms(platforms, contentPath, options)` method now distinguishes three cases:

1. **Nothing currently coordinating** → fresh start (original behavior).
2. **Coordinating but no platform actually broadcasting (drift)** → `forceCleanup()` and fall through to a fresh start.
3. **Coordinating AND at least one platform actually broadcasting** → partition the requested set against the actually-broadcasting set:
   - if every requested platform is already running, throw `ALREADY_RUNNING` (true no-op);
   - otherwise, start ONLY the platforms that aren't running yet, leaving the live streamers untouched.

Case 3 is what fixes "click Start All Platforms while Twitch is up" — instead of refusing the whole request, the coordinator now starts only YouTube without touching the running Twitch stream. The additive path:
- Doesn't reset `startTime` (preserves the original coordination duration)
- Unions new platforms into `activePlatforms` instead of replacing
- Doesn't clear `contentCompletedPlatforms` (would corrupt mid-stream playback state)
- Doesn't reset restart counters for the already-running platforms
- On failure of the new platform's start, doesn't tear down the still-running platform
- Returns `status: 'added'` instead of `status: 'started'` for honest diagnostics

### Layer 5 — Honest HTTP semantics

**File**: [`app/server/routes/player-multistream.js`](../../app/server/routes/player-multistream.js)

`/api/player/start-stream` now returns:
- **409 Conflict** for `ALREADY_RUNNING` (with `currentState` attached) — true duplicate-start refusal
- **500** only for actual failures
- Demoted "already active" log from `error` to `info` — the guard firing is correct behavior, not a server failure

### Layer 6 — Operator escape hatch

New endpoint: `POST /api/player/heal` (admin-auth-gated via the parent route mount).

Runs `coordinator.reconcile()` on demand and returns before/after state. For stuck-state events that previously required a Node process restart, the operator can now curl this endpoint and recover in seconds.

---

## Verification

Standalone Node tests at the time of implementation exercised four scenarios:

| Case | Expected | Result |
|---|---|---|
| Nothing running, Start All | Fresh start of both | ✅ Pass |
| Twitch running, Start All | Additive start — YouTube only | ✅ Pass |
| Twitch running, Start Twitch | `ALREADY_RUNNING` (true no-op) | ✅ Pass |
| Both running, Start All | `ALREADY_RUNNING` | ✅ Pass |

Drift simulation: manually set `isCoordinating = true` with no real ffmpeg process; call `reconcile()`; verify flag clears, drift event fires.

Dev server: `Multi-stream coordinator initialized` + `Streaming health loop running every 30s` log on boot. No errors throughout a session.

---

## Operational signal

After the production redeploy, the streaming subsystem emits a `drift` event whenever flag-vs-reality disagreement is detected. The event is logged at `error` level with a full report (which platform, what the flag thought, what ffmpeg actually showed). Going forward, **zero drift events in steady state is the expected baseline**. A drift event means either:

- An ffmpeg subprocess died in a way that bypassed the event listeners (rare, worth investigating)
- Or the autorestart/recovery is itself broken (catastrophic, page immediately)

Either case warrants the operator running `POST /api/player/heal` and watching the state stabilize.

---

## Files changed

- `app/server/lib/config/ffmpeg.js` — liveness probes (`isProcessAlive`, `getLastProgressAge`, `getProcessPid`) + exposure through `getStreamStatus`
- `app/server/lib/streamers/base.js` — truth-based `isHealthy()`, new `reconcile()`, default `'error'` listener
- `app/server/lib/streamers/coordinator.js` — health loop, `reconcile()`, `forceCleanup()`, `isAnyActuallyStreaming()`, `startPlatforms()` rewrite (additive starts + drift recovery)
- `app/server/routes/player-multistream.js` — 409 semantics for `ALREADY_RUNNING`, `/heal` endpoint

---

## Out of scope

- Auto-restart on Node boot when `schedule.isPlaying === true` — currently boot is manual, which is arguably safer (deploys don't auto-start broadcasts).
- Persisted streaming state across Node restarts — `isCoordinating = false` in the constructor is the explicit boot contract.
- Cross-process or HA recovery — single-process EC2 deployment; not relevant.
- UI button for `/heal` — operator uses curl with the admin cookie for now.

---

## References

- Commit: [`bfad9c3`](https://github.com/a-church-ai/church/commit/bfad9c3)
- Coordinator state transitions: see in-code comments at `app/server/lib/streamers/coordinator.js` `startPlatforms`
- Drift-event subscribers (none yet): wire up alerting hooks here in the future
