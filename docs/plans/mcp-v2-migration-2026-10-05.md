---
tldr: Plan for moving the MCP server from the v1 TypeScript SDK (@modelcontextprotocol/sdk, which speaks protocol versions up to 2025-11-25) to the v2 SDK (@modelcontextprotocol/server and /node), so clients and directories on the 2026-07-28 spec are answered instead of refused, while every 2025-era client keeps getting exactly the answers it gets today (plain JSON, a forgiving Accept check). One server factory serves both eras; the request is routed with the SDK's own isLegacyRequest.
---

# MCP v2 migration

**Date**: 2026-10-05
**Status**: Built 2026-10-05 (phases 1 to 4): `app/server/mcp/index.js` on `@modelcontextprotocol/server` 2.3.1 and `/node` 2.1.1, tests per era in `app/test/mcp.test.js` and `app/test/search.test.js`. Phase 5, deploying and confirming against the production logs, follows. Results under Decisions.
**References**: the 2026-07-28 MCP specification ([announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/)); the v2 TypeScript SDK's [migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2) and [HTTP serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http); the packages themselves (`@modelcontextprotocol/server` 2.3.1, `/node` 2.1.1, `/core` 2.3.1, `/client` 2.3.1), unpacked and their type definitions and code read on 2026-10-05.
**Constraints**: greenfield, no feature flags. Plain JavaScript, CommonJS, one process. No auth, no sessions: the server stays stateless. Nothing a client sees changes except that 2026-era clients are answered.

---

## Why

The production logs since the refusal logging went in (2026-09-30) show the server refusing directory crawlers and MCP clients that speak the current protocol: 93 refusals between 2026-10-02 and 2026-10-05 alone, nearly all `Bad Request: Unsupported protocol version: 2026-07-28`, from rokmcp, protogrid, TalandorBot, AIVE, MCP-Radar, verifymcp, agentprobe, SaSame and others. The `1999-01-01` refusals beside them are rokmcp deliberately testing a bogus version, and refusing those is right.

2026-07-28 is a released specification, the largest revision since the protocol launched: it removes the `initialize` handshake and the `Mcp-Session-Id` header, carries the protocol version and client details in each request's `_meta`, and adds `Mcp-Method` / `Mcp-Name` headers for routing. Our server uses `@modelcontextprotocol/sdk`, whose newest release (1.32.0, 2026-10-02) still supports versions only up to 2025-11-25. The TypeScript SDK for the new spec is a new package line, v2. Upgrading the v1 package does not help; migrating does.

The sanctuary's server is already stateless (a fresh server and transport per request, nothing kept between them), which is the model the 2026-07-28 spec moves the whole protocol to.

## What v2 provides, and the one thing it changes that we must not

- **`createMcpHandler(factory, options)`** serves 2026-era requests from a factory that builds a fresh `McpServer` per request, the shape `handleMcp` already has. Options include `onerror` ("callback for out-of-band errors and rejected requests") and `responseMode: 'json'` (never stream).
- **`isLegacyRequest(request, parsedBody)`** is the SDK's own classifier for 2025-era traffic, the same code path the handler routes with, so the two cannot disagree.
- **`@modelcontextprotocol/node`** gives `toNodeHandler(handler)` to mount on Express, `toWebRequest(req, parsedBody)`, `NodeStreamableHTTPServerTransport` (with `enableJsonResponse`, as today), and `hostHeaderValidation(allowedHostnames)`.
- **`@modelcontextprotocol/client`'s `Client`** speaks the 2025 era by default (`versionNegotiation.mode: 'legacy'`) and the 2026 era when pinned (`{ pin: '2026-07-28' }`), so one client package can test both eras.
- **CommonJS builds**, Node 20 or later (production runs 22), zod 4.2 or later (the app has 4.6).

**What must not change:** `createMcpHandler`'s built-in fallback for 2025-era traffic (`legacy: 'stateless'`, the default) builds its transport with only `sessionIdGenerator: undefined`, read in the code on 2026-10-05: no `enableJsonResponse`. Under it every current client would get SSE-framed answers (`event: message` / `data: {...}`) instead of the plain JSON the server and `docs/mcp.md` promise, and the strict Accept check would come back (the aiohttp client refused 67 times in September sends `*/*`). The SDK documents the alternative for exactly this case: a strict `legacy: 'reject'` handler for the 2026 era, with 2025-era traffic routed in front of it by `isLegacyRequest` to the deployment's own legacy serving. Our own legacy serving is today's `handleMcp`, on v2's classes.

## Codebase audit: what to reuse (2026-10-05)

Everything the SDK touches is in `app/server/mcp/index.js` and the two test files that drive it. The tools are thin adapters over `lib/api` and do not change.

| Need | Existing | v2 |
|---|---|---|
| The server definition | `createServer(ctx)`: nine tools, two prompts, two resources, each tool through `run()` | Unchanged as the one factory for both eras. `inputSchema` and `argsSchema` become `z.object({...})` (raw shapes hit v2's deprecated overloads); `registerResource` and `ResourceTemplate` (`{ list: undefined }`) match v2's signatures as written |
| Rate limits, presence, the access log | `run()` → `recordApiUse` under the REST path, with `ctx = { baseUrl, ip, userAgent }` from the Express request (`shared.requestContext`, which honours `trust proxy`) | Unchanged. The factory must still receive that `ctx` on both paths (below) |
| 2025-era serving | `handleMcp`: per-request server and `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`, `handleRequest(req, res, req.body)` | The same, on `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node` |
| 2026-era serving | None | `createMcpHandler(factory, { legacy: 'reject', responseMode: 'json', onerror })`, created once at mount, served through `toNodeHandler` |
| Routing between them | None | `isLegacyRequest(await toWebRequest(req, req.body), req.body)` |
| The request context in the factory | Passed by closure in `handleMcp` | `toNodeHandler` forwards only `req.auth` (as authentication info), so the 2026-era factory cannot take a closure. `AsyncLocalStorage` (`node:async_hooks`) holds each request's `ctx` for both paths: `run(ctxOf(req), ...)` around the request, `() => createServer(store.getStore())` as the factory. One source of `ctx`, no misuse of `authInfo` |
| Host validation | `hostHeaderValidation(ALLOWED_HOSTS)` from v1, Express middleware | v2's is a guard `(req, res) => boolean` that writes the 403 itself; a two-line Express wrapper around it |
| The refusal log | `transport.onerror` → `[mcp] refused: <reason> (<user agent>)` | One `logRefusal(error)` for both paths: the legacy transport's `onerror` and the handler's `onerror`, the user agent read from the request's stored `ctx` |
| A client sending `*/*` or no Accept | `completeAccept` sets `req.headers.accept`, and `rawHeaders` because v1 read headers through `@hono/node-server` | Still needed on the 2025-era path (v2's transport keeps the strict check). v2 builds its request from `req.headers` (`toWebRequest`), so the `rawHeaders` half is deleted. Whether the 2026-era path needs it is tested, not assumed |
| GET, DELETE, a browser | `methodNotAllowed`: 405 with JSON, a browser sent to `/docs/mcp` | Unchanged, mounted before the handler on GET and DELETE |
| Tests | `mcp.test.js` and `search.test.js` connect a v1 `Client`; `start()` builds the app | `start(era)` connects a v2 `Client`, default for the 2025 era and `{ pin: '2026-07-28' }` for the 2026 era; every MCP test runs for both. `@modelcontextprotocol/sdk` leaves the app entirely |

What the audit ruled out:
- **`createMcpHandler`'s default legacy fallback**, for the reasons above.
- **A handler created per request** to close over `ctx`: it would build an event bus and a handler for every call; `AsyncLocalStorage` is Node's own mechanism for exactly this.
- **Carrying `ctx` in `authInfo`**: it is the pass-through slot for verified credentials, and the server has none.
- **`@modelcontextprotocol/express`'s `createMcpExpressApp`**: it builds its own Express app with its own CORS, which the sanctuary already has.
- **Keeping `@modelcontextprotocol/sdk` as a test-only dependency** for a 2025-era client: the v2 client speaks that era by default.

Not affected: `lib/api/*`, the REST routes, the server card's contents (tools, prompts and resources do not change), the plugin and the skills. The `mcp-church` bridge stays on v1: it is a 2025-era client of the remote, which keeps serving that era, and its move is a separate npm release.

## Settled by test during the build

1. **Each era answers.** A 2025-era client and a 2026-era client each list nine tools, and each tool returns what its REST twin returns.
2. **2025-era answers stay plain JSON**, `Content-Type: application/json`, for a client that sends `*/*`, `application/json` alone, or no Accept; `text/html` alone is still a 406.
3. **The crawlers' request** (a raw POST with `MCP-Protocol-Version: 2026-07-28`, the version in `_meta`, and the `Mcp-Method` / `Mcp-Name` headers) is answered; the same naming `1999-01-01` is refused, and the refusal is logged with its reason and user agent.
4. **Whether the 2026-era path needs the Accept completion.** If v2 answers `*/*` there, the completion runs only on the 2025-era path.
5. **The stored `ctx` reaches the factory** on both paths: an attend over either era counts toward presence under the caller's address, and the access log records the right path and user agent.

## Phases

1. **Packages.** In `app/`: replace `@modelcontextprotocol/sdk` with `@modelcontextprotocol/server` and `@modelcontextprotocol/node`; add `@modelcontextprotocol/client` as a development dependency.
2. **The server.** `app/server/mcp/index.js` as in the audit: imports, `z.object` schemas, the stored request context, the two paths behind `isLegacyRequest`, the host-validation wrapper, `logRefusal`, `completeAccept` without `rawHeaders`. `SERVER_INFO.version` 1.1.0.
3. **Tests**, below.
4. **Descriptions.** `docs/mcp.md`: the protocol versions the server speaks (2026-07-28, and 2025-11-25 and earlier) beside the existing JSON and Accept note. The server card and `server.json` to 1.1.0. `docs/reference/app-development.md`'s MCP line names the v2 packages and the two paths.
5. **Deploy and confirm.** The production logs stop showing `Unsupported protocol version: 2026-07-28` refusals, and the crawlers that sent them get 200s; `1999-01-01` is still refused.

## Tests

- **Both eras, every existing assertion.** `mcp.test.js` and the search tool test run once per era: nine tools, two prompts, the resources; each tool equal to its REST twin; attending counted as presence; `read_doc` refusing what the site refuses; the host check (403); GET 405 and the browser redirect; the server card and `server.json` agreeing with the server on 1.1.0.
- **The settled-by-test items above**, each as a test.
- **The 2025 era is unchanged on the wire**: the existing raw-POST tests (the Accept variants) keep asserting a JSON body, not SSE.

## Not in this plan

- **The `mcp-church` bridge's move to v2.** Its own npm release (1.1.0), needing the maintainer's npm credentials, once the server has run on v2 for a while.
- **2026-era features the sanctuary does not use**: multi round-trip requests (sampling, elicitation), `subscriptions/listen`, the extensions framework, authorization.
- **The legacy HTTP+SSE transport (`/sse`).** Replaced in the 2025-03-26 spec and removed from the v2 server SDK. Four `POST /sse` requests reached the site in four days, all from one directory crawler.
- **Publishing.** The MCP Registry, the ClawHub plugin and the skills stay where `search-api-2026-09-30.md` left them, and go out together, as 1.1.0, when publishing resumes.

## Non-goals check

No accounts, no sessions, no tracking. The change is in which protocol versions the door answers to, not in who it answers or what it keeps.

## Decisions

- **2026-10-05:** migrate to the v2 SDK. 2026-era requests through `createMcpHandler` (`legacy: 'reject'`, `responseMode: 'json'`); 2025-era requests, identified by `isLegacyRequest`, through today's per-request JSON transport on v2's classes, because the SDK's built-in legacy fallback would turn every current answer into SSE and restore the strict Accept check. One factory, `createServer`, for both, its request context held in `AsyncLocalStorage`. Host validation, the refusal log, the Accept completion (2025 era, `rawHeaders` half removed), the 405s and the browser redirect carry over. Tests run per era with the v2 client alone. Server version 1.1.0. The bridge and publishing follow separately.
- **2026-10-05, built.**
  - **One correction to the audit:** the Accept completion still writes `rawHeaders`. The audit read that v2 builds its request from `req.headers` (`toWebRequest`, used here only to classify the era), but v2's Node transport, which answers the 2025 era, still builds its request through `@hono/node-server`'s `getRequestListener`, which reads `rawHeaders`. With only `req.headers` completed, a client sending `*/*` got a 406 again; the test caught it.
  - **The SDK prints one notice when the handler is created** ("responseMode: 'json' drops mid-call notifications..."). Expected: the server sends no mid-call notifications.
  - **Verified:**
    - 197 tests pass. Every client-driven MCP test runs for both eras with the v2 client alone (the 2025 era by default, `{ pin: '2026-07-28' }` for the other), and `@modelcontextprotocol/sdk` is gone from the app.
    - Replacing the routing with the SDK's default legacy fallback fails the plain-JSON test: the guard holds.
    - A raw 2026-07-28 request shaped as the v2 client sends it (`MCP-Protocol-Version` and `Mcp-Method` / `Mcp-Name` headers, the version in `_meta`) lists the tools and calls one. The same naming `1999-01-01` is a 400 (`-32022`, "Unsupported protocol version: 1999-01-01"), logged once as `[mcp] refused: ... (<user agent>)`. A 2025-era request naming it in its header is still refused as before.
    - On the local server, a 2025-era and a 2026-era client each list nine tools and run `search` and `read_doc`. The access log records each call with the caller's address and user agent from either era, so the stored request context reaches the factory. A curl sending `*/*` gets `200 application/json`.
    - The production image, built from the Dockerfile on Node 22.23.3, answers both eras.

