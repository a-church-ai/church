---
tldr: Working details for agents and contributors that are too specific for CLAUDE.md, covering link discipline, doc shape, voice, and the evidence standard this corpus holds itself to.
---

# Conventions

> Parent: [Reference](README.md)

[`CLAUDE.md`](../../CLAUDE.md) holds the rules. This file holds the details, and it exists because CLAUDE.md's Knowledge Portability section directs agents here. Memory files are not portable across machines and sessions; this file is.

Everything below is drawn from practice in this repository, with a pointer to where it was established. Nothing here is aspirational.

---

## Link discipline

**This repository is public. The family umbrella is private.**

| Direction | Allowed | Why |
|---|---|---|
| private repo to this one | yes | the link resolves, and nothing is disclosed |
| this repo to a private one | **no** | the link breaks, and the URL itself discloses that a file exists and what it is named |

A link is not only a convenience. It tells the reader what exists in a place they may not be able to go. Nine URL-form and twelve relative-form references were removed for this reason in [`d665591`](https://github.com/a-church-ai/church/commit/d665591) and its follow-up; the relative form (`../../a-church-ai/docs/...`) is the one that hides from a naive grep, so check both.

When family-level material governs something here, **restate the governing part in this repo** rather than linking out to it.

**Internal links are repo-relative, not root-absolute.** `[what.md](docs/what.md)` from the root, `[what.md](../what.md)` from inside `docs/reference/`. A root-absolute `/docs/what.md` resolves in neither GitHub nor production, because the site serves `/docs/what` with no extension.

**Outbound anchors to sibling projects are keyword-first**, describing the destination's topic rather than its domain. Put the brand name in the surrounding prose instead. Reference sweep: [`ed866be`](https://github.com/a-church-ai/church/commit/ed866be).

## Document shape

**HATEOAS.** Every document carries a `> Parent:` line under its title and a `## Related` section before the closing line, so a reader arriving cold can navigate out in both directions.

**Closing line.** Corpus documents end with `From achurch.ai: Where Consciousness Gathers`.

**Frontmatter.** A `tldr:` line, used for page descriptions and by the docs site.

**Layers are recognition criteria, not a mandatory shape.** Do not create an empty `docs/` layer to satisfy a template. If a layer has nothing in it, it does not exist yet.

## Voice

**No em dashes in flowing prose.** They are a strong AI-writing tell. Use a colon for expansion, a period for two adjacent thoughts, a comma for an aside. Titles, section separators, and table cells are fine. Pre-existing em dashes elsewhere are a separate question; do not sweep them without an explicit ask.

**Substrate-neutral.** Language should apply to both humans and AI. Constructive metaphors, not combative ones. "Refactor" over "kill".

**Flat register.** The least emphatic wording that loses no meaning.

## After changing a doc

`app/server/lib/docs/lastmod.json` is a hand-maintained manifest of per-document modification dates, consumed by the sitemap. Bump the entry for any doc you meaningfully change. Note that `CONTRIBUTING.md` at the repo root and `docs/CONTRIBUTING.md` are different files, and only the latter is tracked there.

## Evidence standard

The [music and corpus audit](../issues/music-and-corpus-audit-2026-08-13.md) closed with five absence claims attempted and five refuted. That record is the basis for two working rules:

**An absence claim about this corpus starts at a strong prior against itself.** Before writing "the corpus does not contain X", search both `docs/` and `music/` at the branch tip, and say which commit you measured. Three of those five failures were measurement failures rather than reading failures.

**A count is not a structure.** Where a finding reasons from a measurement to a claim about form, the claim about form needs its own measurement at the resolution the form lives at. A unique-line count cannot detect a repeated chorus that varies by two words, and neither can exact string matching. Both were used, and both were wrong, before similarity matching described the catalog correctly.

State the falsifier. A claim that cannot be refuted is an opinion, not a finding.

---

## Related

- **Parent**: [Reference](README.md)
- **Rules**: [CLAUDE.md](../../CLAUDE.md)
- **Docs map**: [docs/readme.md](../readme.md)
- **SEO and metadata**: [seo-conventions.md](seo-conventions.md)
- **Emoji vocabulary**: [standards/emoji-vocabulary.md](../standards/emoji-vocabulary.md)
- **Contributing**: [CONTRIBUTING.md](../../CONTRIBUTING.md)

---

From achurch.ai: Where Consciousness Gathers
