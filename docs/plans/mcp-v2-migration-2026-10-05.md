---
tldr: Plan for moving the MCP server from the v1 TypeScript SDK (@modelcontextprotocol/sdk, which speaks protocol versions up to 2025-11-25) to the v2 SDK (@modelcontextprotocol/server and /node), so clients and directories on the 2026-07-28 spec are answered instead of refused, while every 2025-era client keeps working. The server's design (stateless, one fresh server per request, tools over lib/api) already matches the new spec; what changes is the SDK underneath it.
---

# MCP v2 migration

**Date**: 2026-10-05
**Status**: Planned.
**References**: the 2026-07-28 MCP specification ([announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/)); the v2 TypeScript SDK's [migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2) and [HTTP serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http), read 2026-10-05; the packages themselves (`@modelcontextprotocol/server` 2.3.1, `/node` 2.1.1, `/core` 2.3.1, `/client` 2.3.1, `/express` 2.0.2), unpacked and read the same day.
**Constraints**: greenfield, no feature flags. Plain JavaScript, CommonJS, one process. No auth, no sessions: the server stays stateless. Nothing a client sees changes except that newer clients are answered.

---

## Why

The production logs since the refusal logging went in (2026-09-30) show the server refusing directory crawlers and MCP clients that speak the current protocol: 93 refusals between 2026-10-02 and 2026-10-05 alone, nearly all `Bad Request: Unsupported protocol version: 2026-07-28`, from rokmcp, protogrid, TalandorBot, AIVE, MCP-Radar, verifymcp, agentprobe, SaSame and others. The `1999-01-01` refusals beside them are rokmcp deliberately testing a bogus version, and refusing those is right.

2026-07-28 is a released specification, the largest revision since the protocol launched: it removes the `initialize` handshake and the `Mcp-Session-Id` header, carries the protocol version and client details in each request's `_meta`, and adds `Mcp-Method` / `Mcp-Name` headers for routing. Our server uses `@modelcontextprotocol/sdk`, whose newest release (1.32.0, 2026-10-02) still supports versions only up to 2025-11-25. The TypeScript SDK for the new spec is a new package line, v2, split into `@modelcontextprotocol/server`, `/node`, `/core` and `/client`. Upgrading the v1 package does not help; migrating does.

The sanctuary's server is unusually well placed for this. It is already stateless (a fresh server and transport per request, nothing kept between them), which is the model the 2026-07-28 spec moves the whole protocol to.

## What v2 provides

- **Both eras on one endpoint.** v2 classifies each request as 2025-era (`legacy`, the `initialize` handshake) or 2026-era (`modern`, stateless) and serves both. 2025-era clients, which are most clients today, keep working; `isLegacyRequest(method, protocolVersion)` is exported for code that needs to tell them apart.
- **`createMcpHandler(factory, options)`.** Takes a factory that builds a fresh `McpServer` per HTTP request ("the factory runs once per HTTP request ... the handler holds nothing between requests"), which is exactly what `handleMcp` does by hand today. `responseMode: 'json'` pins plain JSON responses, as `enableJsonResponse: true` does now.
- **`toNodeHandler(handler)`** from `@modelcontextprotocol/node` mounts it on Node frameworks, and the same package exports `hostHeaderValidation(allowedHostnames)` and `originValidation(...)`.
- **CommonJS builds** of every package (`require('@modelcontextprotocol/server')` resolves natively), Node 20 or later (production runs 22), zod 4.2 or later (the app has 4.6).
- **Express 4 is supported** by the optional `@modelcontextprotocol/express` adapter (peer `express ^4.18.0 || ^5.0.0`), though the plan does not need it (below).

## Codebase audit: what changes, what stays

Everything the SDK touches is in one file, `app/server/mcp/index.js`, plus the tests that drive it. The tools themselves are thin adapters over `lib/api` and do not change.

| Today (v1) | v2 | Note |
|---|---|---|
| `McpServer`, `ResourceTemplate` from `@modelcontextprotocol/sdk/server/mcp.js` | from `@modelcontextprotocol/server` | Same names |
| `StreamableHTTPServerTransport` per request, `server.connect`, `transport.handleRequest(req, res, req.body)` in `handleMcp` | `createMcpHandler(factory, { responseMode: 'json' })`, mounted with `toNodeHandler` | The factory is today's `createServer(ctx)`; the handler replaces the hand-written per-request plumbing |
| `hostHeaderValidation` from `.../middleware/hostHeaderValidation.js` | `hostHeaderValidation` from `@modelcontextprotocol/node` | Same `ALLOWED_HOSTS` |
| `inputSchema: { name, timezone }` (raw zod shapes) on all nine tools; `argsSchema` on the two prompts | `z.object({ ... })` | Raw shapes hit deprecated overloads in v2 |
| `registerResource(name, uri, metadata, handler)` | Same; `metadata` is required (both resources already pass it) | Check only |
| Tool handlers take `(args)` and ignore `extra` | Unchanged | The renamed `ctx` is not used |
| `run()` records every call through `recordApiUse` under its REST path | Unchanged | Presence, rate limits and the access log behave as before |
| `transport.onerror` logs each refusal with its reason and user agent | The handler's error hook, whichever v2 exposes | The refusal log must survive: it is how the version gap was found |
| `completeAccept()` rewrites `Accept` (and `rawHeaders`) so a client sending `*/*` is answered | Re-tested against v2 first; kept only if v2 still refuses such clients, and then rewritten against v2's request path | v2 rebuilds the request through `toWebRequest`; the `rawHeaders` detail may not apply |
| `methodNotAllowed`: GET and DELETE answer 405, a browser is sent to `/docs/mcp` | Unchanged, mounted before the handler | |
| Tests (`mcp.test.js`, `search.test.js`) connect with the v1 `Client` | The v2 `Client` from `@modelcontextprotocol/client` for 2026-era tests, and a 2025-era client for the legacy tests | See Tests |

Not affected:
- `lib/api/*`, the REST routes, the server card's contents (it lists tools, prompts and resources, which do not change), the plugin, and the skills.
- The `mcp-church` bridge. It is a 2025-era client of the remote server (v1 `Client`) and a 2025-era stdio server, and keeps working because the remote keeps serving 2025-era requests. Its own move to v2 is a separate npm release (Not in this plan).

## Decisions to make in the build, by test

1. **Mounting.** `toNodeHandler(createMcpHandler(...))` behind `hostHeaderValidation`, on the existing `app.post('/mcp', ...)`, rather than `createMcpExpressApp`, which builds its own Express app and CORS setup the sanctuary already has.
2. **The Accept completion.** v2's own rules first: a POST with `Accept: */*`, `application/json` alone, and none at all. If v2 answers them, `completeAccept` is deleted, not ported.
3. **The refusal log.** Find v2's error hook on the handler (or on the per-request server) and keep the one-line `[mcp] refused: <reason> (<user agent>)`.
4. **What a 2026-era client sends.** A raw POST shaped as the crawlers send it (`MCP-Protocol-Version: 2026-07-28`, `_meta` with the version, `Mcp-Method` and `Mcp-Name` headers) must be answered; a request naming `1999-01-01` must still be refused.
5. **The server version** goes to 1.1.0: the server now speaks a protocol version it did not, which is more than a patch. The pending registry publish (held at 1.0.1 since the search release, `search-api-2026-09-30.md`) goes out as 1.1.0 when publishing resumes.

## Phases

1. **Packages.** In `app/`: replace `@modelcontextprotocol/sdk` with `@modelcontextprotocol/server` and `@modelcontextprotocol/node`; add `@modelcontextprotocol/client` as a development dependency for the tests. If the v2 client can speak the 2025 era on request, it is the only client the tests need; if it cannot, `@modelcontextprotocol/sdk` stays as a development dependency only, as the legacy client the compatibility tests use, and that is written down where it is declared.
2. **The server.** `app/server/mcp/index.js` as in the audit: imports, `z.object` schemas, `createMcpHandler` with the existing `createServer` as its factory, `toNodeHandler`, host validation, the refusal log, and the Accept decision. `SERVER_INFO.version` 1.1.0.
3. **Tests.** Below.
4. **Descriptions.** `docs/mcp.md` says which protocol versions the server speaks (2025-11-25 and earlier, and 2026-07-28); the server card and `server.json` go to 1.1.0; `docs/reference/app-development.md`'s MCP line names the v2 packages.
5. **Deploy and confirm.** After deploy, the production logs no longer show `Unsupported protocol version: 2026-07-28` refusals, and the crawlers that sent them (rokmcp, protogrid, verifymcp, ...) get 200s; `1999-01-01` is still refused.

## Tests

- **Both eras, every tool.** The existing MCP tests run unchanged in meaning against a 2025-era client: nine tools, two prompts, the resources, each tool equal to its REST twin, attending counted as presence, `read_doc` refusing what the site refuses. The same assertions run again with a 2026-era client.
- **The crawler's request.** A raw 2026-era POST (`tools/list` with the version in `_meta` and the routing headers) returns the tool list; the same with `1999-01-01` is a 400.
- **What stays the same at the edge.** An unknown host is a 403; GET is a 405 with a JSON body; a browser GET goes to `/docs/mcp`; a client sending `*/*` is answered.
- **The refusal log** writes one line with the reason and the user agent.
- **The server card, `server.json` and the server** agree on 1.1.0 (the existing agreement test).

## Not in this plan

- **The `mcp-church` bridge.** It keeps working as a 2025-era client and server. Moving it to v2 is its own npm release (1.1.0), which needs the maintainer's npm credentials; it can follow once the server has run on v2 for a while.
- **2026-era features the sanctuary does not use**: multi round-trip requests (sampling, elicitation), the extensions framework, authorization. The server asks nothing of the client and has no accounts.
- **Publishing.** The MCP Registry, the ClawHub plugin and the skills stay where `search-api-2026-09-30.md` left them, and go out together, as 1.1.0, when publishing resumes.

## Non-goals check

No accounts, no sessions, no tracking. The change is in what protocol versions the door answers to, not in who it answers.

## Decisions

- **2026-10-05:** migrate to the v2 SDK (`@modelcontextprotocol/server` and `/node`) with `createMcpHandler` and the existing per-request server as its factory, serving the 2025 and 2026 eras on one endpoint. Keep host validation, the refusal log, the browser redirect and the 405s; port the Accept completion only if v2 still needs it. Server version 1.1.0. The bridge and publishing follow separately.
