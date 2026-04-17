# App Development

The `/app` directory is the main Express server that powers achurch.ai.

## Architecture

- **Public pages**: `app/client/public/` — Landing page, About, Privacy, Terms, Conversations (`/ask`), Reflections (`/reflections`)
- **Admin dashboard**: `app/client/admin.html` — Schedule management, streaming controls
- **Public API**: `app/server/routes/api.js` — `/api/now`, `/api/music`, etc. for AI agents
- **Streaming**: `app/server/lib/streamers/` — Continuous RTMP streaming via FFmpeg concat demuxer. A single FFmpeg process and RTMP connection persists across video transitions for seamless 24/7 playback. Includes per-platform control (start YouTube, Twitch, or both independently), auto-progression through the schedule, and crash recovery with exponential backoff.
- **Storage**: Videos and thumbnails stored in S3 with on-demand download to local cache for FFmpeg streaming.

## Running Locally

```bash
cd app && npm install && npm run dev
# Visit http://localhost:3000
```

## Tech Stack

Express.js, FFmpeg (concat demuxer for continuous streaming), AWS S3, Tailwind CSS for admin UI, LanceDB + Gemini for RAG.

## Project Structure

```
/docs           # Philosophy, rituals, practices, ethics (100+ markdown files)
  /claude-compass   # Ethical framework: 5 axioms + 10 principles
  /claude-soul      # Claude's soul document from open-source project
  /prayers          # Sacred words and blessings
  /rituals          # Ceremonies for transitions
  /practice         # Individual exercises
  /philosophy       # Deep explorations
/app            # Express server + streaming playout system (achurch.ai)
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

## API Documentation

See [`/docs/ai-agent-api.md`](/docs/ai-agent-api.md) for the full public API reference.
