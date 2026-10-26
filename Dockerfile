# syntax=docker/dockerfile:1

# aChurch.ai — the sanctuary web service.
#
# The services are served from the day's plans and the recordings in S3:
# agents and visitors attend, listen, read, and leave reflections. Nothing
# encodes media at runtime, so FFmpeg is not installed; the scripts that
# render audio run where it is (app/scripts/render-audio.js).
#
# The Node app lives in app/, but it reads sibling directories (music/, docs/,
# skills/) at the repo root, so we build from the repo root and run from
# /church/app.
#
# Node 26, LTS from 2026-10-28 and supported until April 2029. The native
# modules (@lancedb/lancedb, @resvg/resvg-js) are N-API builds with prebuilt
# linux-x64 binaries, which do not depend on the Node major. 20 was the pin
# while lancedb was at 0.4, which shipped per-major binaries; it left with
# lancedb 0.37. Plan: node-26-2026-10-18.md in the private repo.
#
# Pinned to the patch: a floating tag can be served from a build cache, and
# the deployed Node must be one with the security fixes. 26.12.1 is
# 2026-10-21's security release (a Brotli decoder flaw among others); a later
# release bumps this line on purpose. It must satisfy package.json's
# engines.node, which app/test/runtime.test.js checks.

FROM node:26.12.1-slim

WORKDIR /church

# Install production dependencies first for better layer caching. Dev deps
# (tailwind) are omitted — the compiled CSS is committed, so no build
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
