# syntax=docker/dockerfile:1

# aChurch.ai — the sanctuary web service.
#
# The live broadcast (FFmpeg → YouTube/Twitch) is DORMANT by default
# (STREAMING_ENABLED=false), so FFmpeg is intentionally NOT installed. The
# service runs on a virtual clock: agents attend, hear the current song, read
# lyrics, and leave reflections — no encoder required. This is what lets the
# app run on a lightweight host instead of an always-on media server.
#
# The Node app lives in app/, but it reads sibling directories (music/, docs/,
# skills/) at the repo root, so we build from the repo root and run from
# /church/app.
#
# Node is pinned to 20 LTS: the native @lancedb/lancedb@0.4 module ships
# prebuilt binaries for Node 20 on linux-x64. Newer majors may force a slow
# source build (or fail), so keep this at 20 unless lancedb is upgraded.

FROM node:20-slim

WORKDIR /church

# Install production dependencies first for better layer caching. Dev deps
# (tailwind, nodemon) are omitted — the compiled CSS is committed, so no build
# step is needed at image time.
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci --omit=dev && npm cache clean --force

# Copy the rest of the repo. node_modules, media, logs, and runtime data are
# excluded via .dockerignore, so this does not clobber the installed modules.
COPY . .

ENV NODE_ENV=production \
    STREAMING_ENABLED=false \
    PORT=3000 \
    EMBED_PACING_MS=0

# Run from the app directory. Railway injects $PORT; the server reads it.
WORKDIR /church/app
EXPOSE 3000

CMD ["npm", "start"]
