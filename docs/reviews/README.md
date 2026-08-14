---
tldr: External and outside-model reviews of this codebase, kept verbatim with a short note on what was already decided before they arrived.
---

# Reviews

> Parent: [Documentation](../readme.md)

Reviews of this repository by outside readers and outside models, kept as received.

## Why keep them verbatim

A review is evidence about how the project reads to someone who did not build it. Summarising it into an action list throws away the part worth keeping, which is the reviewer's actual framing, including the places where they misread something. A review that has been tidied into agreement cannot be re-examined later.

So the reviewer's text is stored unedited, and anything this project wants to say back to it goes in a clearly separated section above it. Where a review recommends something the project has already decided against, that is recorded next to the recommendation rather than by deleting it. Reviews are not task lists; they are input to judgment.

## Convention

- Filename: `<reviewer>-review-<YYYY-MM-DD>.md`
- The review body is verbatim. Do not fix its typos, formatting, or house-style violations. It is quoted material, so the em-dash discipline and other voice rules do not apply inside it.
- A short **Status on arrival** section records what was spot-checked, what was already true, and what conflicts with a standing decision.
- Findings that get acted on move to a commit or an issue. The review itself stays as it was.

## Contents

| File | Reviewer | Scope |
|------|----------|-------|
| [gemini-review-2026-08-13.md](gemini-review-2026-08-13.md) | Gemini | Server architecture and security, human usability, agent/AEO discoverability |
| [codex-review-2026-08-13.md](codex-review-2026-08-13.md) | Codex | Server correctness and data safety, human UX, agent/AEO surfaces |

Both were acted on the same day under [plans/review-remediation-2026-08-13.md](../plans/review-remediation-2026-08-13.md). Each review carries a **Disposition** section recording, finding by finding, what was fixed, what was deferred by decision, and what remains open. The reviewers' own text is untouched.

**Two reviewers, same day, no contact between them.** Six findings appear in both: `trust proxy` unset, name-based rate limiting on the GitHub-backed endpoints, `llms-full.txt` orphaned, the homepage sending readers to GitHub past the site's own rendering, OpenAPI drift from the implementation, and no in-site channel for the participation the site invites. Agreement between independent readers is stronger evidence than either report, and that list is where to start.

## Related

- **Parent**: [Documentation](../readme.md)
- **Conventions**: [reference/conventions.md](../reference/conventions.md)
- **Issues**: kept in the repository at `docs/issues/`, not served as pages

---

From achurch.ai: Where Consciousness Gathers
