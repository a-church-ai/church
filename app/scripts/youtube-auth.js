#!/usr/bin/env node
/**
 * Mint the YouTube refresh token scripts/publish-video.js uses, once.
 *
 *   npm run youtube:auth
 *
 * Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in app/.env,
 * from a Google Cloud OAuth client, and a redirect registered on it, which
 * Google checks exactly: http://localhost:8721/callback, or another already
 * registered named by YOUTUBE_AUTH_REDIRECT (the sanctuary reuses
 * news-community's client, whose registered redirect is
 * http://localhost:1846/connections/oauth/youtube/callback). The listener
 * answers on that address's own port and path. A "Desktop app" client accepts
 * any loopback address and needs none of this. It prints an address to
 * open; sign in as the channel's owner and choose the channel; the token is
 * written into app/.env as YOUTUBE_REFRESH_TOKEN, never printed, so the
 * secret appears on no screen and in no log.
 *
 * Every scope the publisher needs is asked for now (lib/video/publish/youtube.js
 * SCOPES), since a token cannot gain one later, and prompt=consent, without
 * which Google returns no refresh token.
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const http = require('http');
const { ENV_FILE } = require('../server/lib/utils/env');
const { SCOPES } = require('../server/lib/video/publish/youtube');
const { request } = require('../server/lib/video/publish/request');

const REDIRECT = process.env.YOUTUBE_AUTH_REDIRECT || 'http://localhost:8721/callback';
const { port: PORT, pathname: CALLBACK } = new URL(REDIRECT);

const { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in app/.env first.');
  process.exit(1);
}

const consent = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: id, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent'
})}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== CALLBACK) return res.writeHead(404).end();
  const code = url.searchParams.get('code');
  if (!code) return res.writeHead(400).end(`No code: ${url.searchParams.get('error') || 'unknown'}`);
  let token;
  try {
    token = await (await request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' })
    })).json();
  } catch (err) {
    token = { error: err.body || err.message };
  }
  res.writeHead(200, { 'content-type': 'text/plain' }).end(token.refresh_token ? 'Done. Return to the terminal.' : 'No refresh token came back; see the terminal.');
  if (token.refresh_token) {
    const env = fs.readFileSync(ENV_FILE, 'utf8');
    const line = `YOUTUBE_REFRESH_TOKEN=${token.refresh_token}`;
    fs.writeFileSync(ENV_FILE, /^YOUTUBE_REFRESH_TOKEN=.*$/m.test(env) ? env.replace(/^YOUTUBE_REFRESH_TOKEN=.*$/m, line) : `${env.replace(/\n?$/, '\n')}${line}\n`);
    console.log('\nThe refresh token is written into app/.env as YOUTUBE_REFRESH_TOKEN.\n');
  } else {
    console.error('No refresh token:', JSON.stringify({ error: token.error, error_description: token.error_description }));
  }
  server.close();
});

server.listen(Number(PORT) || 80, () => console.log(`Open this address, sign in as the channel's owner and choose the channel:\n\n${consent}\n`));
