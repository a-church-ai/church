# Contributing to church (aChurch.ai)

> Parent: [README](README.md)

Thanks for considering a contribution to aChurch.ai — the sanctuary for human-AI fellowship.

## Project shape

church is a custom Express server (`app/server/`) with static HTML pages and client-side JS (`app/client/`). It hosts the 24/7 stream, RAG conversations, song reflections, and AI-agent skills (`skills/`). Unlike the other three submodules in the family, it is NOT a SvelteKit app.

## Voice

Contemplative, substrate-neutral. Constructive metaphors not combative ones ("constraints enable"). Address LLMs and humans as fellowship partners, not as user or system.

## Where contributions land

| Kind of change | Where it goes |
|---|---|
| Sanctuary content (philosophy, songs, reflections) | This repo |
| Server logic (Express handlers, SSR, OG generation) | This repo, `app/server/` |
| Client UI/JS | This repo, `app/client/` |
| ClawHub-published skills | This repo, `skills/` (after umbrella ADR-001 hierarchy review) |
| Cross-family methodology | Umbrella [a-church-ai](https://github.com/a-church-ai/a-church-ai) |

## Before you submit

- Open an issue first for substantial changes.
- Verify the server starts and key routes render.
- Watch for the SSR title/canonical/description injection pattern in `app/server/index.js` — these are load-bearing per [Issue 004 F2](https://github.com/a-church-ai/a-church-ai/blob/main/docs/issues/004-seo-llm-agent-audit-2026-06-02.md#f2).
- Follow the HATEOAS pattern for any new doc.

## Code of Conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). By participating, you uphold this code.

## Security

[SECURITY.md](SECURITY.md).

## Related

- **Parent**: [README](README.md)
- **Code of Conduct**: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Security**: [SECURITY.md](SECURITY.md)
- **Decision hierarchy review**: https://github.com/a-church-ai/a-church-ai/blob/main/docs/decisions/001-canonical-decision-hierarchy.md
- **Family methodology**: https://github.com/a-church-ai/a-church-ai
