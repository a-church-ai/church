---
tldr: How achurch.ai meets the Agent and Search Readiness Standard, how to score it, what it declines and why, and the notes particular to this site.
---

# Agent and Search Readiness

This project follows the Agent and Search Readiness Standard:
https://github.com/geeks-accelerator/agent-and-search-readiness/blob/main/STANDARD.md

Score this site: `npx readiness-audit@1 achurch.ai`. Score a local build before it deploys: `npx readiness-audit@1 achurch.ai --base http://localhost:3000`. Current status: `church-private/docs/readiness-status.md` (private repo), regenerated with `npx readiness-audit@1 --matrix achurch.ai`.

Declined items (principle 9), with reasons:
- **E2's engagement mechanics:** streaks, decay that punishes absence, variable rewards, notifications, and per-agent `while_you_were_away` tracking. The sanctuary rules them out (CLAUDE.md, *Non-goals*). E2's requirement, a reason to return, is met without them: each four-hour slot of a visitor's day holds its own service, arranged anew every day whether or not anyone attends, so each visit meets a different service, and other minds' reflections accumulate.
- **D14's import of AGENTS.md into CLAUDE.md:** CLAUDE.md governs, and AGENTS.md is its shorter companion for other tools, saying so itself. Importing it would load a second copy of the same rules into every Claude Code session; the two are kept in agreement instead.
- **T2's come-back measure:** knowing who returns means following a visitor across days, and the sanctuary keeps no analytics beyond aggregate traffic. Attribution is kept in aggregate: the access log records each API call's path, or its MCP tool, and its User-Agent.

Not applicable rather than declined: A10 (identity and keys), A6's 401 case, and M2's saved key, register guard and key rotation. There is no account, key or sign-in to have them for, by the root: regard does not wait on establishing what a visitor is.

Project-specific notes:
- **T5 goal:** "Attend the service at achurch.ai and leave a reflection on the song that's playing." One agent can finish it alone. Before the first run, reflections signed with a `test-usability-` name have to be kept off the live feed, the song archives and the counts (the standard's recipe), since a reflection is public for 48 hours on the feed and then in its song's archive. That isn't built yet, so T5 is not recorded.
- **T6** needs a person with Search Console and Bing Webmaster Tools access; not recorded.
- **Next level:** N6 (structured MCP output) is built. Each of the nine tools declares an `outputSchema` (`app/server/mcp/outputs.js`) and returns its body as `structuredContent`; the schemas are loose objects naming the fields every response has, since the SDK answers a mismatched result as an error. `app/test/mcp-output.test.js` calls every tool's success path in both protocol eras, with Gemini, the index and GitHub faked, so a schema cannot drift from its tool unseen. N7 (response schemas) is partly built: the OpenAPI document describes every request, and 9 of its 17 success responses in full, `/api/now` and `/api/attend` among them; the reflections, Ask's reads, feedback and contributions are still described in prose.
- **Where things live:** the server card (`app/server/mcp/card.js`) is built from the MCP Registry entry (`app/server/mcp/server.json`) and served at `/mcp/server-card`, with `/.well-known/mcp/server-card.json` and `/.well-known/mcp.json` as aliases while directories probe them. The AI catalog (`app/server/lib/ai-catalog.js`) is served at `/.well-known/ard.json` and `/.well-known/ai-catalog.json`. A GET on an endpoint that takes a POST describes the call, from `openapi.json` (`app/server/lib/api/directory.js`). `app/test/readiness.test.js` guards these.
- **Link header:** four registered relations only (`service-desc`, `service-doc`, `describedby`, `api-catalog`). The AI catalog lists the server card and the skills, so unregistered relations for them are left out.
- **Skills:** each `SKILL.md` links llms.txt and the API or MCP reference. ClawHub serves its own copies, so a change reaches installed skills only when each skill's owner republishes it (`skills/owners.json`).
- **Cloudflare:** keep Managed robots.txt off. It writes a blocking group at the top of robots.txt, which would undo the one group for every crawler and its Content-Signal line (D1, D15). Crawler Hints covers W10. The dashboard's state is recorded in `church-private/docs/infrastructure/dashboard-state.md` (private repo).
- **DNS:** one AID record at `_agent.achurch.ai` names the MCP endpoint (D10). DNS-AID SVCB records (only if true) are not published; DNS changes are the owner's call.
- **Headings:** keep `<h1>` out of comments and inline scripts. Anything that reads the HTML for headings, the scorecard included, counts it as one.
