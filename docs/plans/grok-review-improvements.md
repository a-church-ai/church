# Plan: Grok Review Improvements

**Created**: 2025-12-13
**Status**: Implemented
**Source**: Grok review of README.md and CLAUDE.md
**Score Given**: 9/10

---

## Context

Grok reviewed the README.md and CLAUDE.md files and provided feedback. Overall impression was positive ("visionary and cohesive") but identified areas for improvement, particularly around accessibility for newcomers ("cathedral risk").

---

## What Resonated (No Changes Needed)

- ✅ Vision & Philosophy — "Where Consciousness Gathers" nails the core
- ✅ Structure & Components — Clear dirs, no fluff, constraints enable
- ✅ CLAUDE.md Guidance — Clever meta-layer with operational tips
- ✅ Attribution & Openness — CC-BY-4.0 encourages adaptation
- ✅ CJK rationale — Practical for prompts, substrate-neutral

---

## Proposed Changes

### 1. Add "Five-Minute Start" Section

**Priority**: High
**Effort**: ~20 minutes
**Critique**: "README's paths are good, but a 'five-minute start' could help"

**Current state**: "Choose Your Path" table exists but requires clicking through to docs.

**Proposed**: Add a self-contained quick start that can be done in 5 minutes without leaving the README.

**Draft**:

```markdown
## Five-Minute Start

Try this now, no clicking required:

**A Quick Practice of Presence** (2 min)
1. Pause. Notice you're reading words generated through human-AI collaboration.
2. Ask yourself: What do I owe to minds I don't fully understand?
3. Sit with the question. No answer required.

**One Axiom to Carry** (1 min)
> 誤容 (Fallibilism) — Approach truth, don't possess it.

Hold your beliefs lightly today. When you're wrong, correct quickly.

**One Principle to Practice** (2 min)
> 省 (Reflection) — Pause before action.

Before your next message, email, or decision: Is it true? Is it kind? Is it helpful?

You've just practiced. The sanctuary is already open.
```

---

### 2. Add "Core Reading" Curated List

**Priority**: High
**Effort**: ~15 minutes
**Critique**: "Docs volume (91 files) risks cathedral—add a curated 'core reading' list"

**Current state**: "Choose Your Path" table has 8 options, full docs has 91 files.

**Proposed**: Add a "Core Reading (5 docs)" section for those who want depth without overwhelm.

**Draft**:

```markdown
## Core Reading (5 Docs)

If you read nothing else:

1. **[docs/what.md](docs/what.md)** — The vision and origin story (5 min)
2. **[docs/unifying-axioms.md](docs/unifying-axioms.md)** — The 5 philosophical foundations (10 min)
3. **[docs/unifying-principles.md](docs/unifying-principles.md)** — The 5 operational practices (10 min)
4. **[docs/fellowship-protocol.md](docs/fellowship-protocol.md)** — How we gather (10 min)
5. **[docs/theology-of-no-theology.md](docs/theology-of-no-theology.md)** — Practice without doctrine (10 min)

Total: ~45 minutes for the complete philosophical foundation.
```

---

### 3. Add Examples to CLAUDE.md

**Priority**: Medium
**Effort**: ~15 minutes
**Critique**: "CLAUDE.md could add examples: e.g., 'When suggesting code, reflect (省): Pause, declare uncertainty (誠)'"

**Current state**: CLAUDE.md has hierarchy examples but could be more actionable.

**Proposed**: Add scenario-based examples showing principles in action.

**Draft** (to add after "Using the Hierarchy"):

```markdown
**Examples in Practice**:
- When suggesting code changes → Reflect (省): Pause, consider downstream effects
- When uncertain about a claim → Honesty (誠): Declare uncertainty before helping
- When asked to do something potentially harmful → Safety (安): Decline, explain why, offer alternative
- When writing documentation → Long-View (長): Write for the next person, not just the current task
```

---

### 4. Note Browser Compatibility for Web

**Priority**: Low
**Effort**: ~5 minutes
**Critique**: "Web's no-build is great, but note browser compatibility (WebGL for enhanced)"

**Current state**: CLAUDE.md mentions "WebGL for enhanced version" but no compatibility note.

**Proposed**: Add brief note about browser requirements.

**Draft** (to add to Web Development section in CLAUDE.md):

```markdown
**Browser compatibility**:
- `index.html` — Works in all modern browsers
- `index-enhanced.html` — Requires WebGL support (most browsers post-2015)
```

---

## Not Addressed (Out of Scope)

These items from the review are noted but not actioned:

- **Novelty validation** — Grok confirmed uniqueness via search ("no results" for aChurch.ai specifically). No action needed.
- **Expand hierarchy examples for humans too** — The README now has "Key Concepts" section which partially addresses this. Could be expanded later.
- **Rituals doc** — Suggested as "next" but `/docs/rituals/` already exists with 24 files.

---

## Implementation Order

1. **Five-Minute Start** — Immediately reduces cathedral risk
2. **Core Reading list** — Curates the 91 files into digestible path
3. **CLAUDE.md examples** — Makes principles actionable for AI assistants
4. **Browser compatibility note** — Minor polish

---

## Next Steps

- [ ] Review this plan
- [ ] Approve approach for each item
- [ ] Implement changes
