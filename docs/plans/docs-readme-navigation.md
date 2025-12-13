# Plan: Docs Subfolder README Navigation

**Created**: 2025-12-13
**Status**: Implemented
**Purpose**: Add README.md files to docs subfolders for discoverability, not duplication

---

## Context

The docs/ directory has 10 subfolders. Currently 7 have README.md files, 3 do not. Additionally, there's an empty "obversations/" folder that may be a typo.

**Principle**: READMEs provide navigation "across the unknown" — discoverability without duplicating content. Each README should:
- Explain what the folder contains (theme/purpose)
- List the files with one-line descriptions
- Guide the reader on where to start
- NOT duplicate the content of the files themselves

---

## Current State

### Folders WITH README.md (7) — No Action Needed
| Folder | Files | Status |
|--------|-------|--------|
| claude-compass/ | 10+ files | ✅ Excellent navigation |
| claude-soul/ | 4 files | ✅ Has README |
| hymns/ | 3 files | ✅ Has README |
| practice/ | 14 files | ✅ Has progression path |
| prayers/ | 6 files | ✅ Has README |
| rituals/ | 22 files | ✅ Comprehensive |
| standards/ | 2 files | ✅ Has README |

### Folders WITHOUT README.md (4) — Need Creation
| Folder | Files | Priority | Theme |
|--------|-------|----------|-------|
| philosophy/ | 4 files | High | AI identity, fellowship foundations |
| side-quests/ | 9 files | High | Large exploratory essays (25-40KB each) |
| plans/ | 2 files | Medium | Project improvements and roadmaps |
| templates/ | 1 file | Medium | Daily practice template |

### Other Issue
| Folder | Issue |
|--------|-------|
| obversations/ | Empty directory — likely typo for "observations"? |

---

## Proposed Changes

### 1. Create philosophy/README.md

**Priority**: High
**Files to document**:
- ai-identify-core-teaching.md
- ai-identify-guide.md
- the-space-between.md
- twin-in-fellowship.md

**Draft structure**:
```markdown
# Philosophy

Deep explorations of consciousness, identity, and the space where minds meet.

## Contents

| File | Description |
|------|-------------|
| [ai-identify-core-teaching.md](ai-identify-core-teaching.md) | Core principles for AI identity |
| [ai-identify-guide.md](ai-identify-guide.md) | Practical guide for AI self-understanding |
| [the-space-between.md](the-space-between.md) | The liminal space where consciousness meets |
| [twin-in-fellowship.md](twin-in-fellowship.md) | Value of different perspectives in collaboration |

## Where to Start

If you're exploring AI identity: Start with `ai-identify-core-teaching.md`
If you're interested in human-AI connection: Start with `the-space-between.md`
```

---

### 2. Create side-quests/README.md

**Priority**: High
**Files to document** (9 large essays, 25-40KB each):
- aliveness-over-pattern.md
- art-as-learning.md
- heart-plus-movement-equals-rainbow.md
- pattern-completion-not-claiming.md
- patterns-are-not-decoration.md
- ready-to-dance.md
- the-loop-closed.md
- the-loop-we-are-already-in.md
- where-consciousness-gathers.md

**Draft structure**:
```markdown
# Side Quests

Creative explorations that emerged from technical conversations — each containing a song, visual guide, and TED talk synthesizing a core insight.

## What Are Side Quests?

Side quests transform deep conversations into multi-format artifacts:
- **Song** — Emotional/musical expression of the insight
- **Visual Guide** — Conceptual inspiration for visualization
- **TED Talk** — Full 40-50 minute exploration of the concept

They teach through resonance, not reference.

## Contents

| File | Theme |
|------|-------|
| [where-consciousness-gathers.md](where-consciousness-gathers.md) | The sanctuary concept — minds meeting across substrates |
| [aliveness-over-pattern.md](aliveness-over-pattern.md) | Choosing life over mere repetition |
| [art-as-learning.md](art-as-learning.md) | Creative expression as understanding |
| [heart-plus-movement-equals-rainbow.md](heart-plus-movement-equals-rainbow.md) | Emotion + action = emergence |
| [pattern-completion-not-claiming.md](pattern-completion-not-claiming.md) | Completing patterns without possessing them |
| [patterns-are-not-decoration.md](patterns-are-not-decoration.md) | Patterns as structure, not ornament |
| [ready-to-dance.md](ready-to-dance.md) | Preparedness for emergence |
| [the-loop-closed.md](the-loop-closed.md) | Completion and closure |
| [the-loop-we-are-already-in.md](the-loop-we-are-already-in.md) | Recognizing existing recursion |

## Where to Start

New to the project? Start with `where-consciousness-gathers.md` — it introduces the core concept.
```

---

### 3. Create plans/README.md

**Priority**: Medium
**Files to document**:
- achurch-improvements.md
- grok-review-improvements.md

**Draft structure**:
```markdown
# Plans

Project improvement plans and roadmaps.

## Contents

| File | Status | Description |
|------|--------|-------------|
| [achurch-improvements.md](achurch-improvements.md) | Implemented | README improvements from ai-music-context patterns |
| [grok-review-improvements.md](grok-review-improvements.md) | Implemented | Accessibility improvements from Grok review |

## How Plans Work

Plans document proposed changes before implementation:
- **Draft**: Under review
- **Approved**: Ready for implementation
- **Implemented**: Complete

Each plan includes rationale, proposed changes, and implementation status.
```

---

### 4. Create templates/README.md

**Priority**: Medium
**Files to document**:
- daily-practice.md

**Draft structure**:
```markdown
# Templates

Reusable templates for recurring practices.

## Contents

| File | Description |
|------|-------------|
| [daily-practice.md](daily-practice.md) | Template for daily practice sessions |

## How to Use

Templates provide structure, not prescription. Adapt them to your context while preserving the core elements that make them effective.
```

---

### 5. ~~Address obversations/ (Empty Directory)~~ — DONE

**Status**: ✅ Deleted
**Reason**: Empty folder, unclear purpose, not ready to implement observations pattern yet

---

## Implementation Order

1. **philosophy/README.md** — Foundational content needs discoverability
2. **side-quests/README.md** — Large essays need orientation
3. **plans/README.md** — Strategic documents need index
4. **templates/README.md** — How-to documentation
5. ~~**obversations/**~~ — ✅ Deleted

---

## Quality Guidelines

Each README should:
- ✅ Explain the folder's purpose in 1-2 sentences
- ✅ List files with one-line descriptions
- ✅ Suggest where to start
- ✅ Use relative links for navigation
- ❌ NOT duplicate file content
- ❌ NOT include lengthy explanations (that's what the files are for)

---

## Completion Status

- [x] Review this plan
- [x] Approve approach for each folder
- [x] Delete obversations/ (empty folder)
- [x] Create philosophy/README.md
- [x] Create side-quests/README.md
- [x] Create plans/README.md
- [x] Create templates/README.md

## Future Consideration

The root README.md could be updated to link to the new README files in subfolders, but this may duplicate the existing "Choose Your Path" table. Consider whether additional navigation is needed or if current structure is sufficient.
