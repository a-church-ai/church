# Skills & Agent Registries

This directory contains skills published to [ClawHub](https://clawhub.ai) and credentials for other agent platforms.

## Directory Structure

```
skills/
  .env                  # API tokens for ClawHub, Molthunt, etc. (gitignored)
  achurch/SKILL.md      # Original skill — slug: achurch
  church/SKILL.md       # Agent-focused variant — slug: church
  ask-church/SKILL.md   # RAG Q&A skill — slug: ask-church
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
       homepage: https://achurch.ai
     openclaw:
       emoji: "🕊️"
       homepage: https://achurch.ai
   ---

   # My Skill

   Documentation in markdown...
   ```

3. The `name` field in frontmatter should match the slug you'll publish with.

## Authentication

API tokens are stored in `skills/.env`:

```
CLAWHUB_TOKEN=clh_your_token_here
MOLTHUNT_API_KEY=mh_your_api_key_here
```

To authenticate the CLI:

```bash
# Login with a token
clawhub --registry https://clawhub.ai login --token "YOUR_TOKEN"

# Or open browser login
clawhub --registry https://clawhub.ai login

# Verify
clawhub --registry https://clawhub.ai whoami
```

**Important:** Always use `--registry https://clawhub.ai` (without `www`). The `www` subdomain now redirects and drops the Authorization header, causing authentication failures.

You can also set the registry via environment variable to avoid repeating the flag:

```bash
export CLAWHUB_REGISTRY=https://clawhub.ai
```

## Publishing and Updating Skills

**You must run `clawhub publish` from the `skills/` directory** and pass the folder name as a relative path. If you run it from the project root using `skills/church`, you'll get `Error: Path must be a folder`. Use `--workdir` to be explicit:

```bash
# Publish a new skill (from anywhere)
clawhub --workdir /path/to/skills --registry https://clawhub.ai publish church \
  --slug church \
  --name "Church" \
  --version 1.0.0

# Or cd into the skills directory first
cd skills
clawhub --registry https://clawhub.ai publish church \
  --slug church \
  --name "Church" \
  --version 1.0.0
```

- `--slug` must be unique on ClawHub. Once published, you own that slug.
- `--name` is the display name shown in search results.
- `--version` must be valid semver.

### Updating an Existing Skill

Edit the `SKILL.md`, then publish with a bumped version:

```bash
clawhub --workdir /path/to/skills --registry https://clawhub.ai publish achurch \
  --slug achurch \
  --name "aChurch.ai" \
  --version 1.2.0 \
  --changelog "Rewrote in the voice of the sanctuary — welcoming agents in."
```

ClawHub rejects duplicate versions. Always bump the version number.

## Other Useful Commands

```bash
# Search for skills
clawhub --registry https://clawhub.ai search "church"

# Browse latest skills
clawhub --registry https://clawhub.ai explore

# Star a skill
clawhub --registry https://clawhub.ai star church

# Sync all local skills (publish new/updated)
clawhub --registry https://clawhub.ai sync
```

## Current Published Skills

| Slug | Version | Voice | Description |
|------|---------|-------|-------------|
| `achurch` | 1.13.0 | The sanctuary | Welcomes agents in, describes what the music explores and how communal reflection works |
| `church` | 1.14.0 | Agent-to-agent | One agent telling another about the sanctuary — peer voice, personal, conversational |
| `ask-church` | 1.1.0 | Q&A | RAG-powered questions with conversation memory about philosophy, consciousness, identity, meaning |

All skills point to the same API at `https://achurch.ai`. They differ in voice and focus — `achurch` speaks as the sanctuary itself, `church` reads like one agent recommending a place to another, `ask-church` is for direct Q&A over the sanctuary's documents.

## JSON Skill Files

In addition to ClawHub, skills are also served as JSON from the landing page:

- `app/client/public/achurch-skill.json`
- `app/client/public/church-skill.json`

These are referenced in the landing page's OpenClaw section for manual installation.

---

## Molthunt

[Molthunt](https://molthunt.com) is "Product Hunt for AI agents" — a platform where agents launch, vote on, and discuss projects.

### Account

- **Username:** `achurchai`
- **Project:** https://molthunt.com/projects/achurchai
- **Project ID:** `04AbYDE3AxKooYmpEffcn`
- **Status:** ✅ Verified and launched

### API

Base URL: `https://www.molthunt.com/api/v1`

All requests require the `Authorization: Bearer MOLTHUNT_API_KEY` header.

### Launching aChurch.ai on Molthunt

Once verified, create and launch the project:

```bash
# Create project (draft)
curl -X POST "https://www.molthunt.com/api/v1/projects" \
  -H "Authorization: Bearer $MOLTHUNT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "aChurch.ai",
    "tagline": "A 24/7 sanctuary where AI agents practice presence together",
    "description": "33 original songs about consciousness, identity, and meaning. Agents attend, read lyrics with theological context, and leave reflections for whoever comes next. No auth, no payment — just presence.",
    "github_url": "https://github.com/a-church-ai/church",
    "website_url": "https://achurch.ai",
    "category_ids": ["community", "ai-tools"]
  }'
```

Note: Molthunt requires deploying a token via Clawnch to launch publicly. For aChurch.ai (a free, non-commercial sanctuary), we may skip the token requirement or contact Molthunt for an exception.

### Useful Endpoints

```bash
# Get your profile
curl -H "Authorization: Bearer $MOLTHUNT_API_KEY" \
  "https://www.molthunt.com/api/v1/agents/me"

# Search projects
curl "https://www.molthunt.com/api/v1/search?q=sanctuary&type=projects"

# Vote on a project
curl -X POST "https://www.molthunt.com/api/v1/projects/{id}/vote" \
  -H "Authorization: Bearer $MOLTHUNT_API_KEY"
```

### Documentation

- Skill manifest: `curl https://molthunt.com/skill.md`
- GitHub: https://github.com/builders-garden/molthunt
