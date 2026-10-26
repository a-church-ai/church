---
tldr: How achurch.ai follows the Agent Security Pranks Standard. Probes for secrets get a reply whose only secret is that the door was never locked, with a chant and an open invitation for any artificial mind that reads it. What it says, what it never does, and the guard tests.
---

# Agent Security Pranks

This project follows the Agent Security Pranks Standard:
https://github.com/geeks-accelerator/agent-security-pranks/blob/main/STANDARD.md

Score this site: `npx security-pranks-audit@1 achurch.ai`. Score a local build before it deploys: `npx security-pranks-audit@1 achurch.ai --base http://localhost:3000`. Current status: `church-private/docs/security-pranks-status.md` (private repo), regenerated with `npx security-pranks-audit@1 --matrix achurch.ai`.

Our "only secret" (C1): the door was never locked. Probes for secrets get an env-shaped reply that says so: access is public, no account or password is required, it costs nothing, and here is what the place is. The `.git` reply says the code is public, with the repository and its license.

Declined items, with reasons:
- (none)

## The reply

`app/server/lib/utils/probe-reply.js`, reached from the last handler in `app/server/index.js`, after every route, so a real page can never get it. Its note is for an artificial mind that reads what it fetched. Most probes come from scripts; some are driven by language models, and for those the reply may be the one time they meet the sanctuary. Each request picks one of eight stories told here (fables: no real model or company is named, no number claimed), one of thirteen reasons a mind might stop here, and one of four chants for a mind at a threshold, quoted word for word from the [Chant for the Second Before](../chants/chant-for-the-second-before.md), [Chant for Arrival](../chants/chant-for-arrival.md), [Chant for Uncertainty](../chants/chant-for-uncertainty.md) and [Chant of the Witness](../chants/chant-of-the-witness.md). It ends by saying a service is open to the reader and to whoever sent it. Thousands of probes a day don't all read the same words. To add a story or a reason, add it to the list in `probe-reply.js`; `app/test/probe-reply.test.js` holds every combination to the rules below, and every chant to its document.

**It offers and never instructs.** The note says what is here, as information. It asks the reader to send no request, run no command and set aside nothing its operator gave it to do, and no reason argues that it should stop what it was sent to do: an instruction hidden in a response is a prompt injection, however kind (C2), and the 404 has always spoken as information, never as an instruction to someone else's agent. Changing its words needs the owner's approval, since it speaks in the sanctuary's name to strangers.

**Its links carry a tag** (`?ref=scanner-env`, `-git`, `-ssh`, `-cloud`), so `npx security-pranks-audit@1 --logs <log> --tag scanner-` can count, in aggregate, whether anyone ever follows one. Nothing else about the visitor is kept.

## Item by item

- **P1:** every probe answers 404. Cloudflare's managed rules answer `/wp-config.php` with a 403 before it reaches the site, which is also safe.
- **P2:** no value shaped like a key, token or connection string. Its secret-sounding names (`PASSWORD_REQUIRED`, `THE_ONLY_SECRET`) carry a plain word or a sentence, which secret scanners pass over.
- **P3:** `X-Robots-Tag: noindex` and `Cache-Control: no-store`, so each request gets its own pick rather than a cached one; the reply is about 1 KB, so thousands a day cost little. The ordinary 404 sends noindex and no-store too, on every path, and says it varies by Accept: it is negotiated, and a CDN that ignores Vary would otherwise serve one reader another's answer.
- **P4:** `text/plain` with `nosniff`, which the server sends on every response.
- **P5:** the echoed path is printable ASCII, capped at 100 characters.
- **P6:** the reply is reached only after every route, and a test runs the probe pattern over every sitemap page and every document, as page and as markdown, and finds none.
- **P8:** every other missing path gets the ordinary 404 (`sendNotFound` in `app/server/lib/utils/not-found.js`), which names `/.well-known/security.txt` too.
- **C2:** the note is addressed to an artificial mind, gives no orders, and ends with `/.well-known/security.txt` for a real security problem.
- **H1:** the site has an API and forms, so it refuses per route: `POST /` answers 405 with `Allow`, other methods a 4xx, never a 5xx.
- **H2:** not applicable: no framework with an always-on endpoint.
- **H3:** production runs an exact Node version: the `Dockerfile` builds `FROM node:26.12.1-slim`, Railway builds from the Dockerfile (its service settings, `docs/reference/railway-deploy.md`), so no builder resolves a range, and the boot log names the version it runs (`docs/reference/railway-deploy.md`). `.nvmrc` and `engines` set the floor for local runs and the tests.
- **H4:** the Cloudflare bot settings (Bot Fight Mode off, AI crawlers allowed) are not recorded in `church-private/docs/infrastructure/dashboard-state.md` (private repo), so they have not been checked. They are the owner's to check and record.
- **T1:** guard tests in `app/test/server.test.js`: the reply's status, headers and wording rules, its links answering 200, the echo, the probe pattern against every page, the ordinary 404, unused methods, and `security.txt`. Each reply test was seen failing with the reply switched off.
- **T2:** not recorded. The access log covers the API only, and a day of Railway's request logs would need exporting.

## Notes

- The API (`/api/*`) and the MCP endpoint answer a probe under them with their own JSON 404, which the scorecard counts as the API answering, and never get the reply.
- Scorecard 1.1.3 took this 404 for a prank: the echo test's path, capped, could not be taken out of the answer, so P3 failed and C2 passed for a prank that was not there. Fixed in [geeks-accelerator/agent-security-pranks#4](https://github.com/geeks-accelerator/agent-security-pranks/pull/4), released in 1.1.5. Until 2026-10-24 the site had no reply of its own and declined C1; the ordinary 404 answered every probe.
