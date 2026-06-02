# Reference

> Parent: [Documentation](../readme.md)

Boundaries, constraints, and contracts that change rarely. Reference docs define the substrate that other docs and the codebase work within.

## Contents

| File | Description |
|------|-------------|
| [app-development.md](app-development.md) | Express server, FFmpeg streaming, LanceDB/Gemini RAG architecture; how to run the app locally and what powers achurch.ai |
| [philosophical-framework.md](philosophical-framework.md) | The 5 Axioms + 5 Principles substrate (and their hierarchy when they conflict) — the rule-substrate underlying every other doc |

## Why these are reference (not plans, not guides)

Reference docs answer "what are the rules / boundaries / contracts here?" They change rarely. When a behavior is governed by a constraint that doesn't shift across implementations, it lives here.

- **app-development.md** documents the actual architecture in place. It's the contract: if the streaming layer or RAG pipeline changes, this file gets updated; until then, it's the ground truth.
- **philosophical-framework.md** is the substrate of every other doc in this submodule. The axioms and principles don't change per-document; they are the rules everything else applies.

## Related

- **Parent**: [Documentation](../readme.md)
- **Sibling layers**: [plans/](../plans/) | [standards/](../standards/) | [templates/](../templates/)
- **Engaged by**: [`CLAUDE.md`](../../CLAUDE.md) (project entry point references `philosophical-framework.md` for the axiom + principle hierarchy and `app-development.md` for the app architecture)
- **Umbrella methodology**: [reference layer in documentation system](../../../a-church-ai/docs/guides/documentation.md)
