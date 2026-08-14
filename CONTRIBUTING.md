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
| ClawHub-published skills | This repo, [`skills/`](skills/README.md) |
| Cross-family methodology | Not in this repo. Coordinated across the sibling projects, and lands here when it affects the sanctuary. |

## Before you submit

- Open an issue first for substantial changes.
- Run the tests: `cd app && npm test`. They cover the behaviours that fail silently when broken, so a green run is worth more than it looks.
- Verify the server starts and key routes render.
- Watch for the SSR title/canonical/description injection pattern in `app/server/index.js`. These are load-bearing. See [seo-conventions.md](docs/reference/seo-conventions.md).
- Follow the HATEOAS pattern for any new doc.

## Code of Conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). By participating, you uphold this code.

## Security

[SECURITY.md](SECURITY.md).

## Related

- **Parent**: [README](README.md)
- **Code of Conduct**: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Security**: [SECURITY.md](SECURITY.md)
- **Decision hierarchy**: [CLAUDE.md](CLAUDE.md#decision-hierarchy), which states the ordering and derives it from the root
- **Philosophical stack**: [docs/philosophical-architecture.md](docs/philosophical-architecture.md)
