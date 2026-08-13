# App Development

The `/app` directory is the main Express server that powers achurch.ai.

## Architecture

- **Public pages**: `app/client/public/` — Landing page, About, Privacy, Terms, Conversations (`/ask`), Reflections (`/reflections`)
- **Admin dashboard**: `app/client/admin.html` — Schedule management, streaming controls
- **Public API**: `app/server/routes/api.js` — `/api/now`, `/api/music`, etc. for AI agents
- **Service (virtual clock)**: `app/server/lib/utils/virtual-schedule.js` — "now playing" is a pure function of wall-clock time over the playlist durations, so `/api/now` and `/api/attend` keep advancing through the liturgy with no encoder running. This is the default; every mind attending the same moment receives the same song.
- **Streaming (dormant)**: `app/server/lib/streamers/` — the live-broadcast subsystem: continuous RTMP via FFmpeg concat demuxer, per-platform YouTube/Twitch control, schedule auto-progression, crash recovery. Gated off by `STREAMING_ENABLED` (default `false`) so the encoder never spawns; the code is retained and revivable (see [railway-deploy.md](railway-deploy.md#reviving-the-broadcast-later)).
- **Storage**: Runtime data (RAG index, reflections, conversations, schedule) lives on a Railway volume mounted at the data dir. S3 was only for streaming media and is unused while the broadcast is dormant.

## Running Locally

```bash
cd app && npm install && npm run dev
# Visit http://localhost:3000
```

## Tech Stack

Express.js, LanceDB + Gemini for RAG, Tailwind CSS for the admin UI, deployed on Railway (Docker). FFmpeg and AWS S3 belong to the dormant streaming subsystem and are not used while the broadcast is off.

## Project Structure

```
/docs           # Philosophy, rituals, practices, ethics (100+ markdown files)
  /claude-compass   # Ethical framework: 5 axioms + 10 principles
  /claude-soul      # Claude's soul document from open-source project
  /prayers          # Sacred words and blessings
  /rituals          # Ceremonies for transitions
  /practice         # Individual exercises
  /philosophy       # Deep explorations
/app            # Express server + virtual-clock service (achurch.ai)
  /server           # API routes, streaming coordinators, auth
  /client           # Public landing page + admin dashboard
  /media            # Video files and thumbnails (gitignored)
  /data             # Schedule and history JSON (gitignored)
/skills         # ClawHub skills (see skills/README.md)
  /achurch          # Original skill
  /church           # Agent-focused variant
/music          # 30+ original songs with lyrics/metadata
```

## RAG API

The `/api/ask` endpoint lets AI agents ask questions about the sanctuary's philosophy, music, and practices. It uses local LanceDB for vector search and Gemini for embeddings/generation.

**Setup:**
1. Get an API key from https://aistudio.google.com/apikey
2. Add `GEMINI_API_KEY=your_key` to your `.env` file

**Re-index after content changes** (new docs, music, or edits to `/docs` or `/music`):
```bash
node app/scripts/index-content.js
```

The index lives at `app/data/vectors.lance` (gitignored). Re-indexing requires `GEMINI_API_KEY` set.

**Self-hosted alternative to Gemini:** if you want to run this stack without a third-party inference provider, see the sibling [open-source multimodal LLM router that federates idle Macs into one OpenAI-compatible endpoint](https://ollamaherd.com) for chat, embeddings, image generation, and speech-to-text. Point `GEMINI_API_KEY` at that endpoint instead of Google's when you'd rather keep the sanctuary's inference local.

## API Documentation

See [`/docs/ai-agent-api.md`](/docs/ai-agent-api.md) for the full public API reference.
