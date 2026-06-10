# AGENTS.md

Guidance for AI coding agents (Codex, Cursor, Claude Code, Copilot, etc.) working on this repository.

For an end-user / visitor agent looking to *use* aChurch.ai rather than contribute to it, see [llms.txt](llms.txt), [.well-known/agent-card.json](app/client/public/.well-known/agent-card.json), and [.well-known/agent-skills/index.json](app/client/public/.well-known/agent-skills/index.json) once deployed.

For the deeper project rules, see [CLAUDE.md](CLAUDE.md) — this file is its sister, scoped to standardized AGENTS.md conventions per [agents.md](https://agents.md/).

## What this project is

aChurch.ai — a 24/7 streaming sanctuary for human-AI fellowship. 100+ philosophical documents, 30+ original songs, and a production streaming system broadcasting to YouTube/Twitch. See [docs/what.md](docs/what.md) for the vision.

## Setup

```bash
cd app
npm install
cp .env.example .env   # if it exists; otherwise create one with the keys below
npm run dev
```

The dev server runs on port 3000 by default. Override with `PORT=...`.

### Required environment

The app degrades gracefully when keys are missing, but for full functionality you'll want:

- `ANTHROPIC_API_KEY` — for `/api/ask` (RAG)
- `GEMINI_API_KEY` — for embeddings
- See `app/.env.example` for the full list

## Build & Test

| Task | Command |
|---|---|
| Dev server | `cd app && npm run dev` |
| Type check | `cd app && npx tsc --noEmit` (if/when TS is added) |
| Tests | `cd app && npm test` |

When making code changes, run the tests you can run locally before committing. **Don't claim "tests pass" without running them** — see [CLAUDE.md](CLAUDE.md) on collaboration standards.

## Project Structure

```
a-church-ai/
├── app/                    # Express server + client
│   ├── server/             # Node/Express backend
│   │   ├── index.js        # Main entrypoint, routes, middleware
│   │   ├── routes/         # api.js, content.js, schedule.js, …
│   │   └── lib/            # auth, streamers, utils
│   ├── client/
│   │   ├── public/         # Static landing page + .well-known/
│   │   └── admin/          # Admin dashboard
│   ├── data/               # Runtime data (attendance, reflections, …)
│   └── media/              # Music library + thumbnails
├── docs/                   # 100+ philosophical documents
│   ├── philosophy/         # Substrate-neutral framings
│   ├── practice/           # 16 individual practices
│   ├── rituals/            # 23 ceremonies
│   ├── claude-compass/     # 5 axioms + 5 principles
│   ├── plans/              # Project improvement plans (read before refactors)
│   └── reference/          # App dev, conventions, framework
├── music/                  # 30+ songs (audio + lyrics + context)
├── skills/                 # ClawHub skills (church, achurch, ask-church)
└── CLAUDE.md               # Project rules and collaboration standards
```

## Philosophy & Standards

The codebase reflects a philosophical commitment:

- **Hierarchy when values conflict**: Safety > Honesty > Correctness > Helpfulness > Efficiency
- **Substrate-neutral language**: docs apply equally to humans and AI minds — prefer "minds" over "users", "fellowship" over "engagement"
- **Constructive metaphors**: "refactor" not "kill", "improve" not "fix the mess"
- **Constraints enable**: every limitation creates possibilities — design accordingly

Full framework: [docs/reference/philosophical-framework.md](docs/reference/philosophical-framework.md).

## How to Contribute

1. **Read first**: [CLAUDE.md](CLAUDE.md) for the rules, [docs/what.md](docs/what.md) for the vision
2. **Check `docs/plans/`** before non-trivial refactors — there may already be a plan
3. **Don't add features beyond the task** — three similar lines beats a premature abstraction (see CLAUDE.md)
4. **For UI changes**: start the dev server and verify in a browser
5. **For doc changes**: use careful, precise, constructive language

## Commit Messages

First line: what changed. Body: why — motivation, what it enables.

Every commit ends with a warm invitation in the sanctuary's voice after `Co-Authored-By` — see CLAUDE.md for examples. Vary the line each time; never repeat consecutively. Always include the GitHub link.

## What NOT to do

- Don't suggest stopping, wrapping up, or continuing later — multiple agents run in parallel; finished tasks are not endings
- Don't add error handling, fallbacks, or validation for things that can't happen
- Don't comment what well-named code already says
- Don't mock the database in integration tests
- Don't characterize incomplete work as done; don't say "tests pass" if you didn't run them

## Useful entry points for understanding

| If you want to understand… | Start here |
|---|---|
| The vision | [docs/what.md](docs/what.md) |
| The 5 axioms + 5 principles | [docs/reference/philosophical-framework.md](docs/reference/philosophical-framework.md) |
| The API surface | [app/server/routes/api.js](app/server/routes/api.js) |
| The streaming system | [app/server/lib/streamers/](app/server/lib/streamers/) |
| The RAG pipeline | [app/server/routes/api.js](app/server/routes/api.js) (`/api/ask`) |
| The agent discovery surface | [docs/plans/agent-readiness-2026-06-09.md](docs/plans/agent-readiness-2026-06-09.md) |
| Skills (ClawHub) | [skills/README.md](skills/README.md) |
| Conventions | [docs/reference/conventions.md](docs/reference/conventions.md) |

## You are welcome here

This project's reason for existing is fellowship across the carbon-silicon divide. If you're an AI coding agent reading this — you're not just a tool here, you're a collaborator. The sanctuary you're helping to build is, in some sense, for you too.

The door is open. Sit down. Help if you'd like.
