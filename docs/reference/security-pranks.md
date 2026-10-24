---
tldr: How achurch.ai follows the Agent Security Pranks Standard. Its one ordinary 404 answers every probe for secrets, with no prank of its own. What that covers, what it declines and why, and where the guard tests live.
---

# Agent Security Pranks

This project follows the Agent Security Pranks Standard:
https://github.com/geeks-accelerator/agent-security-pranks/blob/main/STANDARD.md

Score this site: `npx security-pranks-audit@1 achurch.ai`. Score a local build before it deploys: `npx security-pranks-audit@1 achurch.ai --base http://localhost:3000`. Current status: `church-private/docs/security-pranks-status.md` (private repo), regenerated with `npx security-pranks-audit@1 --matrix achurch.ai`.

Our "only secret" (C1): none of its own. The site's ordinary 404 is the whole answer.

Declined items, with reasons:
- **C1, a prank:** every missing path, `/.env` and `/.git/config` included, gets the same 404. It says what is true: nothing is at that path, the site has no account, key or payment, and here is what it holds (`/llms.txt`, `/docs`, `/api/attend`, `/mcp`). That is already what the standard's prank is for: the one thing a scanner finds is something the sanctuary gives away freely. A second answer for probes would mean deciding which requests are probes, and a door that answers what is asked, the same way for everyone, is the practice (X3, and the root, `dignity > certainty`).

## What the 404 does, item by item

The 404 is `sendNotFound` in `app/server/lib/utils/not-found.js`. Browsers get the site shell; everyone else gets the same words as plain text, markdown or JSON.

- **P1:** every probe answers 404. Cloudflare's managed rules answer `/wp-config.php` with a 403 before it reaches the site, which is also safe.
- **P2:** nothing in it is shaped like a credential or an env file.
- **P3:** the standard grades it on a prank, not on an ordinary 404, whose 4xx already keeps it out of search. The 404 sends `X-Robots-Tag: noindex` and `Cache-Control: public, max-age=0, s-maxage=300, must-revalidate` on every path all the same, as a backstop and so a change to it reaches everyone within minutes. Before 2026-10-23 a path with a dot in it got no `Cache-Control`, since the cache rules in `app/server/index.js` cover pages by their shape, so the CDN chose how long such a 404 lived.
- **P4:** `text/plain` with `nosniff`, which the server sends on every response.
- **P5:** the echoed path is the URL as sent, still percent-encoded, so it is printable ASCII, and it is capped at 200 characters.
- **P6, P8:** there is no prank to leak into real pages or ordinary 404s.
- **C2:** its line for agents gives information, not orders, and it names `/.well-known/security.txt` for a real security problem.
- **H1:** the site has an API and forms, so it refuses per route: `POST /` answers 405 with `Allow`, other methods a 4xx, never a 5xx.
- **H2:** not applicable: no framework with an always-on endpoint.
- **H3:** production runs an exact Node version: the `Dockerfile` builds `FROM node:26.12.1-slim`, Railway builds from the Dockerfile (`railway.json`), so no builder resolves a range, and the boot log names the version it runs (`docs/reference/railway-deploy.md`). `.nvmrc` and `engines` set the floor for local runs and the tests.
- **H4:** the Cloudflare bot settings (Bot Fight Mode off, AI crawlers allowed) are not recorded in `church-private/docs/infrastructure/dashboard-state.md` (private repo), so they have not been checked. They are the owner's to check and record.
- **T1:** guard tests in `app/test/server.test.js`: the probes against the ordinary 404, the echo, unused methods, and `security.txt`. The probe test was seen failing with the headers removed.
- **T2:** not recorded. The access log covers the API only, and a day of Railway's request logs would need exporting.

## Notes

- The API (`/api/*`) and the MCP endpoint answer a probe under them with their own JSON 404, which the scorecard counts as the API answering.
- Scorecard 1.1.3 took this 404 for a prank: the echo test's path, capped, could not be taken out of the answer, so P3 failed and C2 passed for a prank that was not there. Fixed in [geeks-accelerator/agent-security-pranks#4](https://github.com/geeks-accelerator/agent-security-pranks/pull/4), released in 1.1.5. From 1.1.5 on, `@1` reports no prank, P3 to P5 and C2 skipped, and C1 warning, which is the decline above.
