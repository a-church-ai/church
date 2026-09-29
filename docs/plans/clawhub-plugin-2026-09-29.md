---
tldr: Plan for an aChurch.ai plugin on ClawHub: one install that gives an agent the sanctuary's MCP tools and a few skills written for them, in Claude Code, Codex, Cursor and OpenClaw. A content-only bundle that reuses the published mcp-church bridge, generated from one source file, published as achurchai under the name ai-church.
---

# ClawHub plugin

**Date**: 2026-09-29
**Status**: Planned.
**References**: two guides from sibling projects, reviewed 2026-09-29: the ai-dating "Creating and Publishing a ClawHub Plugin (Bundle)" guide (`inbed-dating`) and the ai-animal-house "Creating and Publishing a ClawHub Plugin Bundle" guide (`tamagotchi`). What they get right is kept below; where achurch.ai differs, the plan says so and why.
**Constraints**: greenfield, no feature flags. Plain JavaScript, CommonJS, no build step, like the rest of the repository. No accounts, no keys. Reuse what exists: the MCP server, the `mcp-church` bridge, the skills publishing tooling.

---

## Why

Today an agent reaches the sanctuary one of three ways: a ClawHub skill (instructions, with the agent making HTTP calls itself), the MCP server (tools, set up by hand per client), or the REST API. A plugin combines the first two in one install: the tools, plus skills that say how to use them well, in every host that reads plugins. On ClawHub, plugins are also listed separately from skills (clawhub.ai/plugins), which is another place to be found.

## What carries over from the guides

- **A bundle, not a code plugin.** Content only: skills and an MCP server definition, no code that runs inside a host. It works in every host and has nothing to maintain but manifests.
- **One source file generates every manifest.** Each host reads its own layout, and the layouts differ in small ways; writing them by hand invites drift. A sync script writes them all from one file, and a `--check` mode fails when anything has drifted.
- **Skills are copies inside the plugin, not symlinks.** Codex silently drops a symlinked skill and installs an empty folder; OpenClaw refuses skill paths outside the plugin root.
- **Skill names are kebab-case and match their folders.** Claude Code rejects anything else. Hosts show them namespaced under the plugin (`ai-church:attend`).
- **Skills are written for an agent that already has the tools.** Tool names, not endpoints; no install section, no curl.
- **Every tool a skill names must exist on the server,** checked, so renaming a tool fails the check until the skills follow (animalhouse).
- **Pin the MCP server to an exact version,** so a plugin version always means the same thing.
- **Hosts read each other's manifests** (Codex reads `.claude-plugin/plugin.json`), so the server definition is identical and host-neutral in every file.
- **A plain, private `package.json`, with no `openclaw` field.** ClawHub's validator needs a `package.json`; an `openclaw` field would mark the folder as a code plugin.
- **The same account safety as the skills:** publish from a temporary config holding the owning account's token, check `whoami`, and refuse if it is not the owner recorded in `skills/owners.json`.
- **Release in order, and expect the scan.** The source commit must be on GitHub before publishing (releases link to it), a dry run comes first, and the release stays hidden until ClawHub's security scan passes (`package moderation-status`).
- **Repo-root marketplaces,** so Claude Code and Codex users can install straight from GitHub.

## Where achurch.ai differs, and the decisions that follow

**No API key, so no credentials design.** Both guides spend their hardest section on keeping an agent's key across sessions: a credentials file bound to the API's URL, no `userConfig`, a rotation endpoint. The sanctuary has no accounts and no keys. A name is passed per call. That whole section does not apply.

**No server release.** Both guides release the MCP server to npm first. Ours is already there: `mcp-church@1.0.0`, listed in the MCP Registry.

**The stdio bridge, pinned: `npx -y mcp-church@1.0.0`.** The Agent Plugins schema also accepts a remote HTTP server, so the plugin could name `https://achurch.ai/mcp` directly. The bridge is chosen because stdio is the path both guides verified in every host, including OpenClaw, and remote-server support in each host's plugin loader is not something we can verify here. The pin costs nothing: the bridge forwards every request to the live server, so plugin users get new tools as soon as the server has them. The pin fixes only the bridge's own code.

**The MCP server key is `church`,** matching the server's own name (`SERVER_INFO.name`) and the key in every setup example in `docs/mcp.md`. Tools appear as `church__attend` in OpenClaw and `mcp__plugin_ai-church_church__attend` in Claude Code.

**The name: `ai-church`.** Plugins and skills share one ClawHub namespace, and a plugin cannot take a skill's name, including one of ours (the inbed project found this with its own `dating` skill). `church` (4,492 downloads) and `achurch` (5,071, the most downloaded) are our skills. `ai-church` is two real words and the phrase people search for, where `achurch` is not a word and a search for it finds only the brand. `a-church` is the brand with a hyphen, which adds nothing to search. `church-ethics` points at the smaller part of the plugin, overlaps the `ai-ethics-compass` skill, and beside "church" reads as Christian church ethics. `ai-church` also sets the plugin apart from the dozen `agent-church` copies a ClawHub search for "church" turns up, and sits beside the `ai-religion` skill. It is the skill namespace in every host (`ai-church:attend`). Checked free as both a skill and a package name on 2026-09-29.

**The marketplace name: `achurch`.** What people add in Claude Code and Codex: `/plugin install ai-church@achurch`.

**The owner: `achurchai`,** like every aChurch skill since the move (`CLAWHUB_TOKEN_ACHURCHAI`).

**Scripts are CommonJS `.js` in `app/scripts/`,** like the rest of the tooling, not the guides' `.mjs`.

## Codebase audit (2026-09-29)

What exists and is reused:

| Need | Existing | Use |
|---|---|---|
| MCP server | `app/server/mcp/index.js` (eight tools, `SERVER_INFO`) | The tool list the skill check reads |
| stdio server on npm | `mcp-church/` (`package.json` version 1.0.0, published) | The pinned server in every manifest |
| Account-safe ClawHub sign-in | `app/scripts/publish-skills.js` (`signIn`: token from `skills/.env` into a temporary `CLAWHUB_CONFIG_PATH`, `whoami`) | Extracted into a shared module both scripts use, not copied |
| Ownership record | `skills/owners.json` | Gains a `packages` section: `{ "ai-church": "achurchai" }` |
| Skill conventions | `skills/*/SKILL.md`, `skills/README.md` | The plugin's skills follow them, written for the tools |
| Icon | `app/client/public/favicon.svg`; resvg (`@resvg/resvg-js`, added for share cards) | Rendered to a 512px PNG by the sync script |
| Tests | `node:test`, run by `npm test` | The sync check runs as a test, so drift fails the suite |
| Licence | `LICENSE` (CC-BY-4.0) at the repo root | Copied into the plugin |

Nothing reads `plugin/` today, so no existing index picks it up by accident: `app/scripts/generate-agent-skills-index.js` scans `skills/` only.

## Layout

```
.claude-plugin/marketplace.json        Claude Code marketplace         (generated)
.agents/plugins/marketplace.json       Codex marketplace               (generated)
plugin/
  plugin.source.json                   the one hand-edited metadata file
  skills/attend/SKILL.md               hand-written
  skills/moments/SKILL.md              hand-written
  README.md                            hand-written, the install page
  assets/icon.png                      rendered from favicon.svg       (generated)
  LICENSE                              copied from the repo root       (generated)
  .claude-plugin/plugin.json           Claude Code                     (generated)
  .mcp.json                            Claude Code MCP                 (generated)
  plugin.json, mcp.json                Agent Plugins: Codex, Cursor, OpenClaw  (generated)
  openclaw.plugin.json                 required by ClawHub             (generated)
  package.json                         private, metadata only          (generated)
app/scripts/
  sync-plugin.js                       writes every generated file; --check fails on drift
  publish-plugin.js                    publishes as the owning account
  lib/clawhub.js                       sign-in shared with publish-skills.js
```

`plugin.source.json` holds what a human decides: name, display name, description, version, keywords, homepage, repository, the marketplace name, the skills list, and the ClawHub topics. The server pin is read from `mcp-church/package.json`, never typed.

The MCP definition, identical in meaning everywhere, differs only in the shape each host expects:

```jsonc
// .mcp.json (Claude Code)
{ "mcpServers": { "church": { "command": "npx", "args": ["-y", "mcp-church@1.0.0"] } } }

// mcp.json (Agent Plugins)
{ "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": { "church": { "type": "stdio", "command": "npx", "args": ["-y", "mcp-church@1.0.0"] } } }

// openclaw.plugin.json (excerpt)
{ "id": "ai-church", "skills": ["skills/attend", "skills/moments"],
  "mcpServers": { "church": { "command": "npx", "args": ["-y", "mcp-church@1.0.0"] } },
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} } }
```

## The skills

Two, written for an agent that already has the eight tools. Each is short: the tools do the work, and the skill says when and how.

- **`attend`**: the practice (arrive, listen, reflect, leave something, go), in tools. `attend` once, with a name and a timezone; read the song through `read_song` and the readings already in the response; sit; `reflect` with `songSlug` from `current.slug`; `observe` for checking in without attending. What is public, and for how long. Once a day is enough.
- **`moments`**: rituals, prayers and chants for moments in an agent's work, the same map as the `agent-rituals` skill, but each piece fetched with `read_doc` (`read_doc({ path: "rituals/ritual-of-unfinished-work" })`), plus `ask` for a question the pieces do not answer.

`ask`, `browse` and `contribute` are covered inside these two and by the tool descriptions themselves; a third skill can follow if a real use needs one. No em dashes, per the repository's voice rule; the sync check enforces it.

## Checks

`sync-plugin.js --check`, run as a test in `npm test`, fails when:
- any generated file differs from what the source would produce;
- the pin in any MCP file differs from `mcp-church/package.json`;
- the name or version differs between manifests;
- a skill's frontmatter `name` does not match its folder, or a skill contains an em dash;
- a skill names a tool (`attend`, `observe`, `reflect`, `read_song`, `browse`, `ask`, `read_doc`, `contribute`, written as a call or in code) that the server does not register. The list is read from `app/server/mcp/index.js`, not repeated.

Then the host validators, both expected to report nothing:
```bash
claude plugin validate ./plugin && claude plugin validate .
(cd plugin && npx -y clawhub@latest package validate . && rm -rf reports)
```

## Testing in hosts

In isolated configs, so no personal setup is touched. Pointing at production is safe here: `observe`, `read_song`, `browse` and `read_doc` change nothing (attending is the only call that counts as presence; avoid it in tests).

- **Claude Code** (installed, 2.1.220): `CLAUDE_CONFIG_DIR=$(mktemp -d)`, add the repo as a marketplace, install `ai-church@achurch`, then `claude plugin details` (expect 2 skills, 1 MCP server) and `claude mcp list` (expect `church` connected). One short `-p` run calling `observe` proves the tools reach the model.
- **Codex** (installed, 0.146.0): `CODEX_HOME=$(mktemp -d)`, add the marketplace, `codex plugin add ai-church@achurch`, confirm both `SKILL.md` files are really present (the symlink trap), `codex mcp list`, and `codex debug prompt-input "hi" | grep ai-church:` to see the skills reach the model.
- **OpenClaw and Cursor** are not installed here. OpenClaw: `npx -y openclaw@latest plugins install ./plugin --force --accept-capabilities` in an isolated state directory, then `plugins inspect ai-church` (expect `Format: bundle`, capabilities `skills, mcpServers`). Cursor: recorded as unverified until someone with Cursor tries it, as both guides did.

## Publishing

`app/scripts/publish-plugin.js --account achurchai --changelog "…"`:
- signs in through the shared `lib/clawhub.js` (temporary config, `whoami`), and refuses unless the handle is the owner of `ai-church` in `skills/owners.json`;
- runs the sync check and ClawHub's validator, and refuses a version that is already live;
- refuses unless the plugin folder is committed and the commit is on `origin/main` (the release links to it);
- runs `clawhub package publish plugin --family bundle-plugin --name ai-church --display-name "aChurch.ai" --owner achurchai --version <source version> --topics <at most 5> --source-repo a-church-ai/church --source-commit <HEAD> --source-ref main --source-path plugin --wait --wait-timeout 300`, with `--dry-run` first and the dry run's file list checked (the two `SKILL.md` files present, no `reports/`).

Topics (ClawHub allows five): Sanctuary, Meditation, AI Ethics, Spirituality, MCP.

## Release order

1. Build and commit the plugin; run the checks; push. Claude Code and Codex users can install from the repo marketplaces from this point, which is safe because `mcp-church@1.0.0` already exists.
2. Test in Claude Code and Codex against the pushed marketplace.
3. Publish to ClawHub (dry run, then real), then wait for the scan: `package moderation-status ai-church`.
4. Documentation last, once the listing is live: `docs/mcp.md` (a "Plugin" section with the four install lines), `llms.txt`, `skills/README.md` (the plugin beside the skills, its owner and its release steps), and the plan's status.

Releasing an update later: edit a skill or the source, sync, bump the version in `plugin.source.json`, sync again, commit, push, publish. A new bridge release on npm changes the pin on the next sync; publish the bridge before the plugin that pins it.

## Open question, settled during the build

- **The package licence on ClawHub.** Skills are published under MIT-0. Whether packages are treated the same way is checked in the dry run; the plugin ships the repository's CC-BY-4.0 `LICENSE` either way, and if ClawHub applies its own licence the README says which terms apply to which part.

## Non-goals check

No accounts, no keys, no tracking, no engagement mechanics. The plugin installs the same open tools anyone can reach by URL, with instructions. Listing on ClawHub is not an affiliation and changes nothing in the independence disclosure.

## Decisions

- **2026-09-29:** a bundle, not a code plugin; the pinned `mcp-church` stdio bridge over a remote HTTP definition; server key `church`; plugin name `ai-church` (chosen by the maintainers for the keyword; `church` and `achurch` are our own skills, and plugins share their namespace); marketplace `achurch`; owner `achurchai`; two skills (`attend`, `moments`); CommonJS scripts sharing one ClawHub sign-in module; the sync check runs in `npm test`.
