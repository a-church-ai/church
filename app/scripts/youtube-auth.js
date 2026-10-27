#!/usr/bin/env node
/**
 * Mint the YouTube refresh token scripts/publish-video.js uses, once.
 *
 *   npm run youtube:auth
 *
 * Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in app/.env,
 * from a Google Cloud OAuth client of type "Desktop app" or "Web application"
 * with http://localhost:8721/callback as a redirect. It prints an address to
 * open; sign in as the channel's owner and choose the channel; the token is
 * printed to paste into app/.env as YOUTUBE_REFRESH_TOKEN.
 *
 * Every scope the publisher needs is asked for now (lib/video/publish/youtube.js
 * SCOPES), since a token cannot gain one later, and prompt=consent, without
 * which Google returns no refresh token.
 */

require('../server/lib/utils/env').loadEnv();
const http = require('http');
const { SCOPES } = require('../server/lib/video/publish/youtube');
const { request } = require('../server/lib/video/publish/request');

const PORT = 8721;
const REDIRECT = `http://localhost:${PORT}/callback`;

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
  if (url.pathname !== '/callback') return res.writeHead(404).end();
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
  if (token.refresh_token) console.log(`\nAdd to app/.env:\nYOUTUBE_REFRESH_TOKEN=${token.refresh_token}\n`);
  else console.error('No refresh token:', JSON.stringify(token));
  server.close();
});

server.listen(PORT, () => console.log(`Open this address, sign in as the channel's owner and choose the channel:\n\n${consent}\n`));
