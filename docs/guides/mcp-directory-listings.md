---
tldr: How to get a remote MCP server listed in Anthropic's Claude connector directory and OpenAI's ChatGPT plugin directory, what each asks for, and what to prepare first. Written from aChurch.ai's submissions in November 2026, for any project.
---

# Getting an MCP Server into the Claude and ChatGPT Directories

A guide for any project with a remote MCP server. It was written from aChurch.ai's own submissions (Claude on 2026-11-01, ChatGPT begun the same day), so where it says "we" it means that run. Both portals change often: treat the steps as a map, and check the linked docs for the current details.

Both directories list **remote** servers only: a public HTTPS endpoint speaking streamable HTTP (usually `/mcp`). A local stdio server, or a package that runs one through `npx`, is not accepted, though a plugin that bundles one can still be distributed elsewhere.

## Prepare once, for both

Most of the work is the same for both directories, and doing it first makes each form a short sitting.

**On the server**

- **A title for every tool, in two places.** Give each tool a top-level `title` and the same string in `annotations.title`. Claude's directory reads the name from `annotations.title` and flags every tool without one, even when the top-level title is set.
- **All three hints, stated as booleans, on every tool.** `readOnlyHint`, `destructiveHint` and `openWorldHint`, with `false` written out rather than left implied. ChatGPT asks for all three explicitly, and Claude's form checks your read/write answer against them.
- **Hints that tell the truth.** A tool that posts, saves or publishes anything is not read-only, even when what it writes is harmless. `openWorldHint: true` is for a tool that reaches past your own service or publishes to the open web.
- **Plain descriptions.** Both directories forbid descriptions that instruct the model, steer it toward other tools, or hide text. Saying which parameter comes from which tool's output is usually fine, but if a description reads like an instruction ("always call X first", "use Y instead"), rewrite it as a statement of what the tool does.
- **No promotion inside responses.** Neither directory accepts sponsored or promotional content. If your server suggests next steps, check that none of them is an advertisement or a "share this on social media" nudge. We removed such a step from the MCP responses alone and kept it on the REST API.
- **A test that holds these lines,** so a tool added next month does not quietly lose its title or a hint. aChurch.ai's is in [`app/test/mcp.test.js`](../../app/test/mcp.test.js).

**On the website**

- **A docs page for the server** with its URL, how to connect, what each tool does, and **at least three example prompts** written as someone would type them. Claude asks for three; ChatGPT allows three as starter prompts and asks for five more as test cases. Ours is [`docs/mcp.md`](../mcp.md), served at `/docs/mcp`.
- **A privacy policy** and **terms of service**, each at a stable HTTPS URL.
- **A support contact.** Claude accepts an email address; ChatGPT wants an HTTPS URL, so a GitHub issues page or a contact page works.
- **A square logo,** at least 48 by 48 pixels (PNG, JPEG, WebP, or SVG with a square `viewBox`). Claude uses your site's favicon unless you give it another.

**Words to write once and reuse**

- A one-line description (ChatGPT caps its short description at 30 characters; Claude's one-liner allows 200).
- A longer description, up to 2000 characters for Claude and 4000 for ChatGPT, saying what the server does, what it publishes or stores, and that nothing else is written.
- Five prompts the server should handle, each with the tool it should call and what should come back, and three it should leave alone (weather, unrelated coding, a near miss such as "find a church near me" for a church that has no buildings).
- A short note to reviewers: how to test without an account, which tools have public side effects, and anything a policy checkbox might misread.

## Anthropic: the Claude connector directory

**Where:** [claude.ai/directory/manage](https://claude.ai/directory/manage), then **Submit new** and **MCP connector** (or go straight to `claude.ai/directory/manage/new/connector`). You need a paid Claude plan. The form saves a draft in the tab as you go.

The form has ten steps:

1. **Connection.** Add your server as a custom connector (name and URL). It connects live and reads the tools, resources and sign-in method. The connector stays in your Settings, under Connectors, until you remove it.
2. **Tools.** Lists every tool with its annotations and any suggestions, such as a missing `annotations.title`. **It keeps the tool list it read at step 1**: after you fix and deploy, reconnect from step 1 (Change, then choose the connector again). In our run even that, and a page reload, still showed the old list, though the suggestions did not block the later steps.
3. **Listing.** Name, a permanent slug, one-liner, description, up to five categories, author name and URL, and links to docs, support and privacy.
4. **Use cases.** Three use cases, each with an example prompt; prerequisites (write "None" and say so if no account is needed); and read only, write only, or read and write. Choose read and write if any tool has `readOnlyHint: false`, or the form refuses the answer.
5. **Company.** Company name and website, and a primary contact prefilled from your Claude account.
6. **Authentication.** Detected from the live connection. An open server shows "None".
7. **Data handling.** Whose API the server calls, whether it touches health data, and whether it shows sponsored content.
8. **Test and launch.** Instructions a reviewer can follow alone (every link, every step, any test account), and a box confirming you have run every tool yourself.
9. **Compliance.** Seven policy statements to tick, and optional notes for the review team. Read them before ticking: one says the server does not use AI to generate images, video or audio, and another that descriptions hold no instructions about other tools. If something sits near a line, explain it in the notes rather than leaving the reviewer to guess.
10. **Review and submit.**

The developer guidelines are linked from step 9. Review takes some days, and the listing can be edited after it goes live.

## OpenAI: the ChatGPT plugin directory

**Where:** [platform.openai.com/plugins](https://platform.openai.com/plugins). The official guide is [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission).

OpenAI's process is a package, not a form: a ZIP holding the listing, any skills, and the MCP configuration, which the dashboard checks before you submit. In late 2026 the older apps form was replaced by this plugin flow, so older articles about "submitting a ChatGPT app" describe a different screen.

**1. Verify a developer identity first.** Nothing can be uploaded until the organization has a verified individual or business identity, and the check involves an ID and takes some days ("Application in review", with updates in the organization settings). The name you verify is the developer name the directory shows, so pick the right organization before you start. Only an organization owner, or a member given Apps Management Write, can submit.

**2. Build the ZIP.** The portable layout:

```
plugin.json        the manifest, with OpenAI's settings under extensions.com.openai
mcp.json           exactly one remote server
skills/<name>/SKILL.md   optional, each with name and description frontmatter
assets/            the logo and any screenshots the manifest names
```

`mcp.json` names the transport `streamable-http`, not `http` (the [Agent Plugins MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) allows `stdio`, `streamable-http` and `sse`):

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "my-server": { "type": "streamable-http", "url": "https://example.com/mcp" }
  }
}
```

In `plugin.json`, `extensions.com.openai.interface` holds the listing: `displayName` and `shortDescription` (30 characters each), `longDescription` (4000), `developerName`, `category`, the four URLs (`websiteURL`, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL`, all HTTPS), up to three `defaultPrompt`s of 128 characters, an optional `brandColor`, and `logo`. Next to it, `review.test_cases` holds exactly five `positive` cases (each with `description`, `prompt`, `tools_triggered` and `expected_behavior`) and exactly three `negative` ones (`description` and `prompt`), and `review.commerce` says whether the server sells anything. Leave out credentials, request headers, app references and lifecycle hooks: the upload refuses them.

If you already ship a plugin that runs the server locally, build the ChatGPT ZIP from the same folder with the remote URL swapped in, rather than keeping a second copy by hand. aChurch.ai's script, [`app/scripts/pack-chatgpt-plugin.js`](../../app/scripts/pack-chatgpt-plugin.js), does that, checks the directory's limits and that every test case names a real tool, and writes `dist/ai-church-chatgpt.zip`.

**3. Upload and resolve the findings.** Choose **Upload new or existing plugin**, pick the verified identity, and upload the ZIP. The dashboard reports metadata and skill findings; fix the package and upload again until the required ones clear.

**4. Connect the server and verify the domain.** OpenAI gives a challenge token. Serve it as plain text, the token and nothing else, at `https://<your MCP host>/.well-known/openai-apps-challenge`. Then wait for the tool scan.

**5. Review details and submit.** Add a demo recording, a video walkthrough of the plugin working in ChatGPT that a reviewer can open (an unlisted video link is fine), check the imported test cases, choose **Submit for review**, and tick the policy statements. Feedback comes by email; a rejection can be appealed by replying. After approval, **Publish plugin** makes it live.

**Afterwards:** a change to the tools takes effect after **Rescan** under MCPs (OpenAI also rescans daily); a change to the listing, skills or assets is a new ZIP, and each upload is a version with its own review; a change to the server's URL needs OpenAI's support.

## Other places worth listing

These take minutes and need no review:

- **The official [MCP Registry](https://registry.modelcontextprotocol.io).** Publish a `server.json` with the `mcp-publisher` CLI, under a namespace you prove (`io.github.<org>/<name>` through GitHub, or your domain through DNS).
- **[Smithery](https://smithery.ai).** Add the remote URL.
- **A DNS record.** An [AID](https://aid.agentcommunity.org) TXT record at `_agent.<your domain>` lets an agent find the server from the domain alone.

## Checklist

- [ ] Remote HTTPS MCP endpoint, streamable HTTP, answering without a session.
- [ ] Every tool: `title`, `annotations.title`, and all three hints as booleans; a test that keeps them.
- [ ] Descriptions that describe; no promotion in responses.
- [ ] Docs page with at least three example prompts; privacy, terms and support URLs.
- [ ] Square logo.
- [ ] Five positive and three negative test cases, each positive naming its tool.
- [ ] Claude: paid plan, the ten-step form, the compliance statements read before ticking.
- [ ] ChatGPT: verified identity, ZIP built and uploaded, domain token served, demo video recorded, then submit.
- [ ] MCP Registry and Smithery while you wait.

## How aChurch.ai did it

- The server and its annotations: [`app/server/mcp/index.js`](../../app/server/mcp/index.js); the tests that hold them: [`app/test/mcp.test.js`](../../app/test/mcp.test.js).
- The docs page with the example prompts: [`docs/mcp.md`](../mcp.md).
- The plugin folder and the ChatGPT listing and test cases (the `chatgpt` block of [`plugin/plugin.source.json`](../../plugin/plugin.source.json)), packed by [`app/scripts/pack-chatgpt-plugin.js`](../../app/scripts/pack-chatgpt-plugin.js).
- Where it is listed, and which submissions are in review: the Discovery section of [`docs/mcp.md`](../mcp.md#discovery).
