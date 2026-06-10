# Plans

> Parent: [Documentation](../readme.md)

Project improvement plans and roadmaps.

## Contents

| File | Status | Description |
|------|--------|-------------|
| [search-discoverability-2026-06-10.md](search-discoverability-2026-06-10.md) | Pushed to main (`9a3e0b3`) — pending production deploy | Per-page `<title>` + `<meta description>`, AEO-grade schema (QAPage on /ask, MusicComposition + MusicRecording + Article on /reflections), sitemap lastmod, internal linking with thematic anchors, IndexNow key file. Integrated post-push with brother's Plan 003 / Issue 005 work — see plan's "Merge integration" section. 8/8 pages pass full SEO checklist. Maintenance reference: [seo-conventions.md](../reference/seo-conventions.md). |
| [agent-readiness-2026-06-09.md](agent-readiness-2026-06-09.md) | Pushed to main (`b2116e4`) — pending production deploy | Agent discovery surface — Skills index, MCP/A2A cards, API catalog, Content Signals, TDMRep, AGENTS.md, schema.org Actions, markdown negotiation, security.txt (contact updated to family standard during merge) |
| [streaming-stability-2026-06-10.md](streaming-stability-2026-06-10.md) | Pushed to main (`bfad9c3`) — pending production deploy | Drift detection + self-heal + additive starts + /heal endpoint. Fixes the 4-month silent YouTube outage by making FFmpeg subprocess the source of truth instead of in-memory flags. |
| [achurch-improvements.md](achurch-improvements.md) | Implemented | README improvements from ai-music-context patterns |
| [grok-review-improvements.md](grok-review-improvements.md) | Implemented | Accessibility improvements from Grok review |
| [docs-readme-navigation.md](docs-readme-navigation.md) | In Progress | Adding README.md files to docs subfolders |
| [music-readme-creation-plan.md](music-readme-creation-plan.md) | Draft | Plan for creating music README |
| [compass-soul-integration-2026-02-12.md](compass-soul-integration-2026-02-12.md) | — | Compass + soul integration design |
| [distribution-strategy-2026-02-11.md](distribution-strategy-2026-02-11.md) | — | Distribution strategy |
| [drifts-bot-experiences.md](drifts-bot-experiences.md) | — | Drifts bot experience design |

## How Plans Work

Plans document proposed changes before implementation:

| Status | Meaning |
|--------|---------|
| Draft | Under review, not yet approved |
| Approved | Ready for implementation |
| In Progress | Currently being implemented |
| Implemented | Complete |

Each plan includes:
- Context and rationale
- Proposed changes with drafts
- Implementation order
- Current status

## Creating Plans

Before making significant changes, draft a plan:
1. Document current state
2. Propose changes with reasoning
3. Get approval
4. Implement systematically
5. Update status when complete

## Related

- **Parent**: [Documentation](../readme.md)
- **Sibling layers**: [reference/](../reference/) | [standards/](../standards/) | [templates/](../templates/)
- **Umbrella methodology**: [documentation system — Plans layer](../../../a-church-ai/docs/guides/documentation.md) | [HATEOAS pattern](../../../a-church-ai/docs/guides/hateoas.md)
