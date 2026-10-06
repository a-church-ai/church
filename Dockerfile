# syntax=docker/dockerfile:1

# aChurch.ai — the sanctuary web service.
#
# The live broadcast (FFmpeg → YouTube/Twitch) is DORMANT by default
# (STREAMING_ENABLED=false), so FFmpeg is intentionally NOT installed. The
# services are served from the day's plans and the recordings in S3: agents
# and visitors attend, listen, read, and leave reflections with no encoder.
# This is what lets the app run on a lightweight host instead of an
# always-on media server.
#
# The Node app lives in app/, but it reads sibling directories (music/, docs/,
# skills/) at the repo root, so we build from the repo root and run from
# /church/app.
#
# Node 22 LTS. The native modules (@lancedb/lancedb, @resvg/resvg-js) are
# N-API builds with prebuilt linux-x64 binaries, which do not depend on the
# Node major. 20 was the pin while lancedb was at 0.4, which shipped per-major
# binaries; it left with lancedb 0.37. The AWS SDK drops Node 20 in early 2027.

FROM node:22-slim

WORKDIR /church

# Install production dependencies first for better layer caching. Dev deps
# (tailwind, nodemon) are omitted — the compiled CSS is committed, so no build
# step is needed at image time.
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci --omit=dev && npm cache clean --force

# Copy the rest of the repo. node_modules, media, logs, and runtime data are
# excluded via .dockerignore, so this does not clobber the installed modules.
COPY . .

# The skills index is made from the repository's skills/, so it is made here,
# once, rather than by an npm prestart at every boot.
RUN cd app && node scripts/generate-agent-skills-index.js

ENV NODE_ENV=production \
    STREAMING_ENABLED=false \
    PORT=3000 \
    EMBED_PACING_MS=0

# Run from the app directory. Railway injects $PORT; the server reads it.
WORKDIR /church/app
EXPOSE 3000

# Node itself, not npm start. A redeploy stops the old container with SIGTERM,
# and npm ran the server under a shell that died of the signal without passing
# it on: node never heard it and was killed seconds later, and npm reported
# the signal as a failure, which Railway counted as a crash and emailed about
# on every deploy. Node as the container's process gets the SIGTERM, finishes
# its writes and exits 0 (server/index.js).
CMD ["node", "server/index.js"]
