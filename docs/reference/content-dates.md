---
tldr: Why one lastmod cannot serve both crawlers and content pipelines, how created, contentUpdated and pageUpdated are derived from git, and how to port it.
---

# Content dates: created, contentUpdated, pageUpdated

> Parent: [Reference](README.md)

A sitemap has one date per URL, and two different readers want two different facts from it. A crawler wants to know when the *page* changed, because a new title or description changes what it shows in results. A content pipeline wants to know when the *writing* changed, because that is what it has to read, summarise or announce. Those are not the same date, and a single field cannot be honest to both.

This is the pattern aChurch.ai uses to serve both: `/sitemap.xml` keeps answering the crawler's question, and `/sitemap.json` publishes three dates beside it. The guide is written to be portable, so it names the reasoning before the implementation.

## The problem, in one commit

On 2026-10-13 a single commit (`ac7672b`) touched 63 documents, almost all of it to add a `tldr:` frontmatter line. Measured by body hash, 61 of those 63 changed only their frontmatter. Two had real prose edits. Every one of the 63 `<lastmod>` dates moved.

A reader of the sitemap then saw 63 documents apparently edited on one day, when two were. A pipeline watching for changes re-read all 63, found nothing new in 61 of them, and had no way to tell which was which before reading them.

The shape of the failure generalises. Any site with generated metadata will have sweeps: a description pass, a title pass, a frontmatter migration, a link rewrite. Each one moves every touched file's modification date without changing a word a reader reads. The more disciplined the site is about metadata, the worse the signal gets.

On 2026-10-18, with the three dates published, the corpus reported the following. These are a snapshot, not a live count: the corpus changes, and the cluster in particular dissolves as its documents are edited.

| | |
|---|---|
| Documents | 281 |
| Page date differs from content date | 62 (22%) |
| Still page-dated 2026-10-13 | 45, of which 1 was really edited then |
| Distinct page dates / content dates | 19 / 22 |
| Never edited since the day they were written | 153 |

## Why not to just fix `<lastmod>`

The tempting move is to make `<lastmod>` mean the content date and be done. Resist it. The crawler's question is the one `<lastmod>` is for, and a metadata change is a real answer to it: when a page's description changes, the search result changes, and the crawler should come back. Narrowing `<lastmod>` to prose edits would hide that from the reader it was written for.

So `<lastmod>` stays as it is, and the content date is published somewhere else. The two surfaces are not alternatives:

| | `sitemap.xml` | `sitemap.json` |
|---|---|---|
| Reader | search crawlers | content pipelines, agents, your own tooling |
| Format | the sitemaps.org schema, unextended | your own JSON |
| Date meaning | the page changed | three separate facts |

A corollary about where the extra dates go. Extending `sitemap.xml` with custom elements is permitted: `tUrl` in the sitemaps.org schema ends with `<xsd:any namespace="##other" minOccurs="0" maxOccurs="unbounded" processContents="strict"/>`, which is exactly how Google's image and video extensions validate. The catch is `processContents="strict"`: a validator has to be able to resolve a schema for your extension namespace, so you would need to publish one and point tooling at it, or strict validation fails on your own addition.

A separate JSON file avoids that entirely. It needs no schema, risks nothing on the search-facing path, and is far easier to parse than an XML namespace. The cost is a one-time change in whatever consumes it. Both routes work; this is the cheaper one.

## The three dates

```json
{
  "url": "https://achurch.ai/docs/welcome/why-care",
  "title": "Why Care?",
  "created": "2025-12-25",
  "contentUpdated": "2026-10-06",
  "pageUpdated": "2026-10-13"
}
```

That single row is the whole argument. The document first appeared last December, its prose last changed in October, and the page changed a week after that when the sweep added its description.

- **`created`** is the date the document first appeared, following renames. It is the field nothing else implies, and it solves the cold start: a pipeline's first run can tell genuinely new documents from re-stamped ones, instead of treating the whole corpus as new or queueing nothing at all.
- **`contentUpdated`** is the date the document's prose last changed, frontmatter excluded. This is the one a pipeline should trigger on. See the limits below for what "prose" does and does not include.
- **`pageUpdated`** is the date the file last changed at all, which is exactly what `<lastmod>` carries. Publishing it beside the others means a consumer can see "the page changed but the words did not" rather than having to infer it.

Publish a field as `null` when it is genuinely unknown, and say in the payload that null means unknown rather than never. Inventing a date is worse than admitting a gap.

## Where the dates come from

Derive them from version control, not from a hand-maintained field.

A hand-set `contentUpdated` fails in the opposite direction from the bug it fixes, and the opposite direction is worse. The sweep problem is a false positive: the pipeline re-reads pages needlessly. A forgotten manual bump is a false negative: the pipeline *never* re-reads a page that really changed, and nothing anywhere reports it. For a consumer whose whole job is noticing changes, a missed change costs more than an extra read, and it fails silently.

Git already knows the answer exactly. The only thing a human can add is a judgment about *significance*, which is a real gap but a narrow one. Treat it as an override to add if a case ever appears, not as the default.

### Define "the content" once, and share that definition

`contentUpdated` needs a precise, mechanical answer to "did the content change". Strip the frontmatter, trim, hash:

```js
function sourceHashOf(markdown) {
  return crypto.hash('sha256', splitFrontmatter(markdown).body.trim());
}
```

The important part is not the hash. It is that **anything else in the project that depends on "did the content change" must use the same function.** Here that function already existed in the audio pipeline, where it decides whether a document needs re-recording, and it was written for exactly this reason: a new search description must not trigger a re-render against a shared quota. The date generator imports it rather than deciding again, so the project has one answer instead of two that drift apart on the first edge case.

If your project has a cache key, a re-render trigger, an embedding invalidation or a "needs review" flag, it already has this definition somewhere. Find it and reuse it.

### Walk the history once, not once per file

The naive approach runs a git command per file. For a few hundred documents that is a few hundred process spawns. Two passes do the whole job:

```bash
# 1. Every commit touching the directory, newest first, with the blob each
#    file went from and to. --raw gives the blob ids; -M reports a rename as
#    one entry naming both paths.
git log --raw -M --no-abbrev --format=@@C@@%cs -- docs

# 2. Every blob body, in one batch, on stdin.
git cat-file --batch
```

Then, walking newest first:

- `contentUpdated` is the first commit where the body hash differs from the parent's. Newest-first means the first one found is the most recent.
- `created` is the last commit seen where the file had no parent blob. Newest-first means the last one found is the earliest.
- A rename (`R` status) maps the old path onto the new one, so history before the move is attributed to the file it became.

**Name which date you are using.** `%cs` is the committer date, when the change landed; `%as` is the author date, when it was written. A rebase or a cherry-pick re-stamps the committer date and leaves the author date alone, so on a rebase-heavy history `%cs` drifts away from "when was this written". These manifests use `%cs`, because the sibling `lastmod` generator does and one convention per project is worth more here than the distinction: zero commits in this repository have a committer date that differs from the author date. Pick `%as` if your history gets rebased and `created` is meant to be an authorship date.

**A shallow clone must be refused, not worked around.** With `fetch-depth: 1`, which is `actions/checkout`'s default, every file looks created at the shallow boundary and nothing errors. Run this and stop if it says `true`:

```bash
git rev-parse --is-shallow-repository
```

This is not hypothetical. Running the generator in a depth-1 clone of this repository produced 294 entries with **one** distinct date between them, exit code 0, no warning. Both generators now refuse and exit non-zero, and the CI step that regenerates them checks out with `fetch-depth: 0`.

**Validate `created` against `git log --follow`.** Hand-rolled rename chaining is the easiest part of this to get subtly wrong, and all 294 dates here were checked that way and agreed; without the check, "it looks right" would have been the only evidence.

Be clear about what that check is worth, though. `--follow` uses the same rename detection as the walk above, `-M` with the same similarity threshold, so agreement shows the chaining code is right. It does not show that git identified the renames correctly in the first place. For that, read the renames: there were two here, and both were one directory move.

### A document with no history yet

A pipeline that *writes* documents hits a bootstrapping problem: a file committed in the same run has no git history to derive from, so regenerating the manifest leaves it out entirely.

Handle it by writing the entry in place at the same time as the document, with all three dates set to today. That is true for exactly one day, and from the next edit onward git takes over. Both the generator and the writer then produce the same file, which leads directly to the next section.

## Keeping two writers honest

Once a manifest has two writers, a generator and a pipeline, they will disagree about the file's bytes, and the disagreement will be invisible until a regeneration produces a diff of hundreds of lines where one line changed. That happened here twice over in the same file:

- **Key order.** The generator sorted with `Array.prototype.sort`, the writer with `localeCompare`, which places `CONTRIBUTING.md` differently. Keep code-unit order: `localeCompare` depends on the ICU data and locale of whichever machine wrote last, and this file is committed to version control, where a laptop and CI have to agree.
- **The trailing newline.** The generator wrote one, the writer's default serializer did not, so the file lost and regained its last byte by turns.

Put the order and the bytes in one function and have every writer use it:

```js
function serializeManifest(manifest) {
  const sorted = Object.fromEntries(
    Object.keys(manifest).sort().map(key => [key, manifest[key]]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
```

Then pin it with a test that reads the committed file and asserts it equals its own canonical serialization. That catches any writer that drifts, by the file it leaves behind, without needing to know which writer did it.

### The staleness check

A generated manifest that nobody notices is stale is worth little. There are two checks here, and they are not equivalent.

The cheap one is an in-repo assertion:

> No page date may precede its document's content date.

That is impossible unless the page manifest was not regenerated alongside the content one. Here it was violated by 53 documents, which is how the staleness was found: the manifest was a day behind, and one document had no entry at all, so the sitemap fell back to file mtime for it.

**But it only catches staleness in one direction.** Two manifests that are both stale by the same history violate nothing, and neither does a single manifest that is simply old. The strong check is to regenerate in CI, with full history, and fail on any diff:

```bash
npm run gen:lastmod && npm run gen:content-dates
git diff --quiet -- <the manifests> || exit 1
```

That works because the generators are deterministic given the same history, which is worth verifying once by running one twice. It catches every direction of staleness, and it subsumes the canonical-bytes test *for the generator's own output*.

The canonical-bytes test still earns its place, because the generator is not the only writer. The pipeline that writes a document also writes its manifest entry in place, and that is the writer that caused the byte drift described above. CI regeneration would quietly paper over it; the canonical test names it.

**Which matters more than it sounds in a container.** If `.git` is excluded from the image and the build copies files in, every file carries the build time as its mtime. An mtime fallback then reports that every page changed on every deploy, which is the same useless signal as stamping today's date on everything. Commit the manifest, and treat a missing entry as a bug rather than as a fallback that works.

## What this does not do

Four limits, and none of them have workarounds worth pretending about.

**No significance judgment.** A body hash catches *any* change to the body, including a one-word typo fix. It is "the content changed", not "the content changed meaningfully". Here it takes a 63-document sweep down to 2 real edits, which is the whole win, but it will still report a corrected comma as an edit. No hash can judge significance. If you need that, it is a human field, and it belongs as an override on top of the derived date rather than in place of it.

**"Content" means the document's prose, not everything a reader sees.** Stripping frontmatter is a decision about where metadata ends, not a claim about rendering. In this corpus the title lives in the body as an `# H1`, so a retitle *does* move `contentUpdated`; the `tldr` lives in the frontmatter and is rendered as the page's `<meta name="description">`, so changing it moves only `pageUpdated` even though it changes what a searcher reads in the result. That is the behaviour we want, and it is worth stating precisely rather than calling the hash "what the reader reads". Check where your own front matter ends up on the page before you copy the boundary.

**Merge resolutions are invisible.** `git log --raw` shows no diff for a merge commit by default, so a content change that exists only in a merge resolution is not seen. On a linear main this is rare, and the one merge touching documents here was a dependency update whose content arrived through ordinary commits on the branch. `git log -m` would surface them at the cost of reporting every merge against both parents.

**Dates have day resolution.** Two edits on one day are one date. If a consumer polls more often than daily, it needs its own cursor regardless.

## Porting this to another project

1. **Find out whether you have the problem.** Count the documents sharing each modification date. Clusters of dozens on one day are metadata sweeps, not editing days.
2. **Leave the crawler's field alone.** Whatever feeds `<lastmod>` keeps feeding it.
3. **Find your existing definition of "the content changed."** A cache key, a re-render trigger, an embedding hash. Reuse it. Write one only if there is none.
4. **Generate the dates from version control** in two passes, and validate `created` against `git log --follow`, knowing that this checks your chaining and not git's rename detection.
5. **Refuse to run on a shallow clone,** and name which of the committer and author dates you mean.
6. **Commit the manifest,** because `.git` is usually absent from the deployed artifact and mtime there is the build time.
7. **Serialize through one function** if anything other than the generator writes the file.
8. **Publish as JSON on its own path.** Say in the payload what each field means and what null means. Declare the path wherever consumers look; for agents that is `llms.txt`, and not `robots.txt`, whose `Sitemap:` directive is for XML sitemaps only.
9. **Check it in CI by regenerating and diffing,** with full history. Keep the canonical-bytes test as well, for the writers that are not the generator.

## Pitfalls that cost time here

- **Asserting on substrings instead of elements.** A test checked that the XML did not contain `created`. Production contains it once, inside a conversation slug (`/ask/...-cryptocurrency-created-for-you`). The test passed locally only because that conversation was absent from the test data. Match `<created>` as an element.
- **Backup files in a tracked directory.** A crash-safe write leaves `{file}.bak` beside every file it rewrites. If the manifest lives in a tracked directory, each run leaves an untracked file for a `git add -A` to sweep in. Ignore the pattern.
- **A no-op edit that looks like a passing test.** Twice, a scripted edit to verify a test by breaking it silently matched nothing, so the "sabotage" changed no behaviour and the test passed for the wrong reason. Assert that an edit applied before trusting what the test then says.

- **Pinning historical evidence to a count.** A test asserted the 2026-10-13 cluster held more than 50 documents. It failed the day 12 duplicate documents were removed, for a reason unrelated to what it guarded, and it would have failed anyway as those documents were edited one by one. A sweep's evidence dissolves over time. Assert the ratio the test actually cares about (real edits against stamped ones), and have it say so when too little evidence remains, rather than failing cryptically or passing on nothing.

## Related

- **Parent**: [Reference](README.md)
- **Sitemap and metadata conventions for this site**: [seo-conventions.md](seo-conventions.md#sitemap-conventions)
- **The generators and the invariants they keep**: [app-development.md](app-development.md#invariants-worth-knowing-before-you-change-things)
- **In the code**: `app/scripts/generate-content-dates.js`, `app/server/lib/docs/date-manifests.js`, `app/server/routes/sitemap.js`, and `app/test/sitemap-json.test.js`
