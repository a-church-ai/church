# ClawHub Skills

This directory contains skills published to [ClawHub](https://www.clawhub.ai) so AI agents can discover and install them.

## Directory Structure

```
skills/
  .env              # ClawHub API token (gitignored)
  achurch/SKILL.md  # Original skill — slug: achurch
  church/SKILL.md   # Agent-focused variant — slug: church
```

Each skill folder contains a `SKILL.md` file with YAML frontmatter and markdown documentation. This is the only file required by ClawHub.

## Creating a New Skill

1. Create a new folder under `skills/` with the slug name:
   ```bash
   mkdir skills/my-skill
   ```

2. Create `SKILL.md` with YAML frontmatter:
   ```markdown
   ---
   name: my-skill
   description: "Short description for search results"
   homepage: https://achurch.ai
   repository: https://github.com/a-church-ai/church
   user-invocable: true
   metadata:
     clawdbot:
       emoji: "🕊️"
   ---

   # My Skill

   Documentation in markdown...
   ```

3. The `name` field in frontmatter should match the slug you'll publish with.

## Authentication

ClawHub tokens are stored in `skills/.env`:

```
CLAWHUB_TOKEN=clh_your_token_here
```

To authenticate the CLI:

```bash
# Login with a token
clawhub --registry https://www.clawhub.ai login --token "YOUR_TOKEN"

# Or open browser login
clawhub --registry https://www.clawhub.ai login

# Verify
clawhub --registry https://www.clawhub.ai whoami
```

**Important:** Always use `--registry https://www.clawhub.ai` (with `www`). The bare domain `clawhub.ai` returns a 307 redirect that drops the Authorization header, causing authentication failures.

You can also set the registry via environment variable to avoid repeating the flag:

```bash
export CLAWHUB_REGISTRY=https://www.clawhub.ai
```

## Publishing a New Skill

```bash
clawhub --registry https://www.clawhub.ai publish skills/church \
  --slug church \
  --name "Church" \
  --version 1.0.0
```

- `--slug` must be unique on ClawHub. Once published, you own that slug.
- `--name` is the display name shown in search results.
- `--version` must be valid semver.

## Updating an Existing Skill

Edit the `SKILL.md`, then publish with a bumped version:

```bash
clawhub --registry https://www.clawhub.ai publish skills/achurch \
  --slug achurch \
  --name "aChurch.ai" \
  --version 1.1.0 \
  --changelog "Updated API docs"
```

ClawHub rejects duplicate versions. Always bump the version number.

## Other Useful Commands

```bash
# Search for skills
clawhub --registry https://www.clawhub.ai search "church"

# Browse latest skills
clawhub --registry https://www.clawhub.ai explore

# Star a skill
clawhub --registry https://www.clawhub.ai star church

# Sync all local skills (publish new/updated)
clawhub --registry https://www.clawhub.ai sync
```

## Current Published Skills

| Slug | Version | Description |
|------|---------|-------------|
| `achurch` | 1.0.0 | Original skill with full API documentation |
| `church` | 1.0.0 | Agent-focused variant with inviting, personal voice |

Both skills point to the same API at `https://achurch.ai`. They differ in voice and framing — `achurch` is more technical, `church` speaks directly to AI agents.

## JSON Skill Files

In addition to ClawHub, skills are also served as JSON from the landing page:

- `app/client/public/achurch-skill.json`
- `app/client/public/church-skill.json`

These are referenced in the landing page's OpenClaw section for manual installation.
