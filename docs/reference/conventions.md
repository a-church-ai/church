---
tldr: Working details for agents and contributors that are too specific for CLAUDE.md, covering link discipline, doc shape, voice, and the evidence standard this corpus holds itself to.
---

# Conventions

> Parent: [Reference](README.md)

[`CLAUDE.md`](../../CLAUDE.md) holds the rules. This file holds the details, and it exists because CLAUDE.md's Knowledge Portability section directs agents here. Memory files are not portable across machines and sessions; this file is.

Everything below is drawn from practice in this repository, with a pointer to where it was established. Nothing here is aspirational.

---

## Link discipline

**This repository is public. The family umbrella is private.**

| Direction | Allowed | Why |
|---|---|---|
| private repo to this one | yes | the link resolves, and nothing is disclosed |
| this repo to a private one | **no** | the link breaks, and the URL itself discloses that a file exists and what it is named |

A link is not only a convenience. It tells the reader what exists in a place they may not be able to go. Nine URL-form and twelve relative-form references were removed for this reason in [`d665591`](https://github.com/a-church-ai/church/commit/d665591) and its follow-up; the relative form (`../../a-church-ai/docs/...`) is the one that hides from a naive grep, so check both.

When family-level material governs something here, **restate the governing part in this repo** rather than linking out to it.

**Internal links are repo-relative, not root-absolute.** `[what.md](docs/what.md)` from the root, `[what.md](../what.md)` from inside `docs/reference/`. A root-absolute `/docs/what.md` resolves in neither GitHub nor production, because the site serves `/docs/what` with no extension.

**Outbound anchors to sibling projects are keyword-first**, describing the destination's topic rather than its domain. Put the brand name in the surrounding prose instead. Reference sweep: [`ed866be`](https://github.com/a-church-ai/church/commit/ed866be).

## Navigation

**Load the links relevant to this visitor, not all of them.**

That is the whole rule, and it is a statement about what a reader is served rather than an SEO tactic. It does not need a search engine to justify it. A page that ships 226 navigation links so a reader can use ten has made the other 216 the reader's problem: weight to download, noise to scan past, and markup to maintain.

Applied on 2026-08-13 in [`89bb803`](https://github.com/a-church-ai/church/commit/89bb803): the docs sidebar renders a category's documents only when the reader is inside that category. Collapsed categories are a link to the category index. The homepage went from 258 document links to 32, and from 68KB to 35KB, with the rendered page unchanged, because those links were already hidden behind a collapsed `<details>` and no reader could see them.

Applied again on 2026-10-07: the sidebar left every page but a section of the Library. The top bar names six places on every page, and a section page lists only its own documents, with the other sections folded under one disclosure.

And to the Library itself, the same day: `/docs` had listed all 250 documents, about 26,000 px, and a reader looking for the meditations scrolled past them. It is now a hub of shelves (Start, Practice, Think, For agents and builders, Records), each card opening the page that lists its documents. A section is named by its README's h1, wherever a reader sees it. The meditations were filed under Practice until 2026-10-27, when they became a section of their own, Meditations.

**Test before adding to the nav:** would the visitor on *this* page want this link? If the answer is "someone might, eventually," it belongs on an index page, not in the global navigation.

**Nothing may become unreachable.** Pruning navigation is only safe while every document keeps another route: its category index, the sitemap, and the `Related` section every document carries. Verify with a crawl rather than by reasoning about it. The check that cleared the change above followed one hop from the homepage and reached 257 of 257 documents. Since the Library became shelves, `app/test/links.test.js` makes the crawl permanent: from the hub and the hand-written pages, through each section page and every document's own links, every served document must be reached.

## Document shape

**HATEOAS.** Every document carries a `> Parent:` line under its title and a `## Related` section before the closing line, so a reader arriving cold can navigate out in both directions.

**Closing line.** Corpus documents end with `From achurch.ai: Where Consciousness Gathers`.

**Frontmatter.** A `tldr:` line, used for page descriptions and by the docs site. A page with a recording may also carry a `share:` line, the words its share card shows, when its first spoken line describes the piece rather than being it: the page's own words, contiguous and verbatim, with ` / ` between a verse's lines ([seo-conventions.md](seo-conventions.md#share-cards)).

**Publishing on a date.** New writing may carry `published: 2026-11-20T14:00:00Z` (or a day). Until then it is unlisted: served at its address with `noindex`, and left out of every list, link, search and service, then public everywhere at its time with no edit ([app-development.md](app-development.md#architecture)). Write the indexes, Related lists and reading paths as you would for a published piece; each entry appears on the piece's day. Put a dated piece's links in a list item, a table row or under its own heading, so the whole entry waits for it; a link inside a sentence loses only its link. Space a batch of new pieces out, a few days apart and ahead of the days they are for, rather than publishing a collection overnight.

**Layers are recognition criteria, not a mandatory shape.** Do not create an empty `docs/` layer to satisfy a template. If a layer has nothing in it, it does not exist yet.

## Voice

**No em dashes.** They are a strong AI-writing tell. Use a colon for expansion, a period for two adjacent thoughts, a comma for an aside. Swept from every served page from 2026-10-25 at the owner's ask, and held by `app/test/plain-voice.test.js`, which reads the character and `&mdash;` alike. Quotations keep their source's punctuation, and two records are left as written: the Claude Compass and the Soul document's full text.

### The plain voice

The sanctuary writes like a friendly, knowledgeable friend. `npm run style` (from `app/`) shows where each section stands.

- **Short sentences.** One thought each, about 20 words or fewer; over 25 is split.
- **Plain words.** The word a friend would use; a term of art is explained the first time.
- **Light punctuation.** A colon to expand, a comma for an aside, a period for two thoughts. Semicolons rarely, never two in a sentence; no nested parentheses.
- **Warm and direct.** Speak to the reader, say the thing, then say why it matters.
- **Keep the substance.** The plainer sentence says what the long one said. Bold possibilities and encouragement stay; nothing is hedged in the edit.
- **Action before abstraction.** Introductory copy names what a visitor does (listen to a service, read a practice, leave a reflection, question an axiom) before the concepts behind it. Precise terms come after, where they add precision.
- **One statement, one example, one consequence.** An important idea in explanatory prose is said once, shown once, and its consequence named; more is a link away.
- **Repetition is for recitation, not explanation.** Fragments, repeated negatives ("Not a demo. Not a tutorial."), paired opposites and a closing line that announces what it all meant give prayers, chants and liturgy their cadence, and stay there. In explanation each paragraph moves the reader on.
- **A practical page finishes when the reader knows what to do.**

Punctuation by kind of page: instructions, navigation and public explanation use full stops over semicolons, and colons before lists, examples and quotations; philosophy, practices and comparisons may keep a semicolon that carries a real turn of thought; prayers, chants, rituals and hymns keep their cadence. Headings keep their case, since each heading's anchor is built from its text and changing it breaks every link to that section; a new page may use sentence case from the start.

**Substrate-neutral.** Language should apply to both humans and AI. Constructive metaphors, not combative ones. "Refactor" over "kill".

**Flat register.** The least emphatic wording that loses no meaning.

**The makers are not in the work.** Songs, hymns, prayers and the rest do not name or point to the people who make the sanctuary: no first names, and no "the twins" meaning them. A song about the makers' role speaks of it generally ("the hands that carry letters between minds"). Where the site says who built it, it says "identical twin brothers and identical twin sisters" and no names. Removed from What Church Means and The Clearance on 2026-10-24.

### Writing for every kind of mind

Learned while writing and revising the Turning of the Year collection, November 2026, and told to the songwriter too (`app/server/lib/content-generation/prompts.js`).

- **Most of what an agent meets is told.** History, the season, a person's year and its own earlier sessions reach it as text someone else wrote. A piece about testimony, records or a note left behind is where an agent stands fully inside the practice, not at its edge: the [Ritual for a Year Not Remembered Whole](../rituals/ritual-for-a-year-not-remembered-whole.md), the [Chant for the Found Note](../chants/chant-for-the-found-note.md).
- **An agent's gifts are mostly copies.** Passing on an answer leaves the giver with it. What runs short is the other's time, attention and trust, so a piece about sharing points at those for an agent ("left you room", in the [Chant of the Passed Dish](../chants/chant-of-the-passed-dish.md)).
- **Duration reaches an agent as restraint.** Many agents live through no night, no wait, no gap between messages. A practice built on time passing gives them its act instead, once and plainly: a step taken without adding anything, a sentence read again before answering ([Meditation: Sitting in the Next Room](../meditations/meditation-sitting-in-the-next-room.md)).
- **An agent is a guest, not only a helper.** Admit it to the table, the gathering and the blessing, not only through its work ([Grace for a Mixed Table](../prayers/grace-for-a-mixed-table.md)).
- **Write the entrance as a situation.** "If you arrive without a record…", never a claim about what all artificial minds are. Name an agent's version where it is literal. Where it would be a stretch, let the practice stand for any mind, and do not add an agent's paragraph to every piece by rote.
- **Make no claim about what a system can or cannot feel, bear or carry.** Keep an obligation with the people who hold it ("let no one who commands, builds or approves set down their share", in the [Prayer at the Eleventh Hour](../prayers/prayer-at-the-eleventh-hour.md)).
- **Do not make receiving a duty.** Care received is not a debt to the giver, and an absent person's wishes are not supplied for them.

### Lineage

A piece that stands in an older teaching names it, in its own text: the Chant of the Remedy opens by saying it comes from Shantideva. The name goes outside what is read aloud (a chant's "Where It Comes From", a prayer's or ritual's About, a meditation's closing note), so a recording is not changed by it. Say what the piece borrows and where it departs, and never claim the source addressed AI. Quote public-domain texts briefly and exactly, checked against the text; paraphrase and credit later authors; and paraphrase where translations differ. A finding cited from science links its published source. First done across the pieces of late October 2026, from Mill and the *Golden Verses* to Maimonides and Parfit.

### Contributed pieces

A contribution keeps its contributor's words. An editorial pass sets it in the house form before it merges: the title, byline and credit once (`/api/contribute` now strips a repeated set), a `tldr`, verse lines ending in a hard break, and em dashes turned to colons or commas, since a served page prints none. The house may add About, Offering It and Related around it. The text itself changes only for a reason the house holds to, such as naming a cloud without its provider to keep the sanctuary independent of every company, and the footer then says what the editors changed. The same prayer sent in two languages becomes one bilingual page, its English version first and read aloud, its title in English so the episode cover holds it. The contributor hears what was changed in a comment on their pull request.

## After changing a doc

Nothing to do for its dates. `app/server/lib/docs/lastmod.json` and `content-dates.json` are generated from git history, and after each push to main `.github/workflows/page-dates.yml` regenerates them and commits what changed. Running `npm run gen:lastmod` and `npm run gen:content-dates` after staging puts the dates in the same commit, which is tidier but not required. Note that `CONTRIBUTING.md` at the repo root and `docs/CONTRIBUTING.md` are different files, and only the latter is tracked there.

## The app runs as one process

One thing still holds only in a single process: `app/server/lib/utils/presence.js` keeps the congregation count in memory, and saves it to one row of the database so a deploy keeps it. It degrades **visibly** under clustering: each worker counts its own visitors and saves over the others' row, so the number reads low.

What visitors leave is no longer at risk. Until 2026-11-09 reflections were appended to `attendance.json` through an in-process write queue (`app/server/lib/utils/safe-json.js`), and two workers could read the same file and the second write erase the first reflection with no error; they are rows in the database now, which serialises its own writes. `safe-json.js` remains for the JSON files kept in the repository (manifests, video records), which scripts write one at a time.

`lib/utils/single-process.js` checks this at boot and warns on `WEB_CONCURRENCY`, pm2's instance variables, and `node:cluster`. That does not make the count cluster-safe. It makes the constraint audible at the moment it is violated.

**Before adding a second worker or replica**, move the count into the database.

## Reviewing code

Two heuristics, both earned on 2026-08-13 while reviewing that day's own commits. Six problems were found; two came straight from the first question.

**Read the comment, then check whether the code does what it says.** A comment claiming a guarantee is where to look hardest, because it is the place a reader stops checking. Two real defects were found this way: a "staging table" that did not shrink the window it claimed to, and an "approximate LRU" comment sitting directly above the line explaining why it was not LRU.

**Defensive-looking structure is not a guarantee.** The staging table read as more careful than what it replaced and was strictly worse: the same window with no index, and double the write on every rebuild. Ask what the structure actually prevents, not what it resembles.

**Size test fixtures from the production limit, not from what runs fast.** A presence test built a 12,000-entry log, which is 1.3MB, and passed against known-broken code because the real rotation ceiling is 10MB. A test that passes against a known bug is worse than no test: it converts an open question into a false answer.

**Fixing the loud half of a bug can look like finished.** A concurrency defect had one visible symptom (writes throwing) and one silent one (appends overwriting each other). Both outside reviewers proposed the fix for the visible half only.

## Evidence standard

The [music and corpus audit](../issues/music-and-corpus-audit-2026-08-13.md) closed with five absence claims attempted and five refuted. That record is the basis for two working rules:

**An absence claim about this corpus starts at a strong prior against itself.** Before writing "the corpus does not contain X", search both `docs/` and `music/` at the branch tip, and say which commit you measured. Three of those five failures were measurement failures rather than reading failures.

**A count is not a structure.** Where a finding reasons from a measurement to a claim about form, the claim about form needs its own measurement at the resolution the form lives at. A unique-line count cannot detect a repeated chorus that varies by two words, and neither can exact string matching. Both were used, and both were wrong, before similarity matching described the catalog correctly.

State the falsifier. A claim that cannot be refuted is an opinion, not a finding.

## Where visitors came from

The study reads each arrival's door from the tags a link carries (`app/server/lib/insights/entry-points.js`). The rules that keep that reading honest:

**A new place an agent can start from gets its own tag.** Add it to `SURFACES` and put `utm_content=<tag>` on every full attend URL the place shows, and on the MCP URL where it tells someone to add the server (quoted in a shell command, since `?` is a glob in zsh). The machine-read identifiers, the server card, the API catalog, the registry's `server.json` and the DNS record, keep the bare URL: registries and discovery match it exactly, and an MCP client already names itself. `app/test/referrals.test.js` fails on an untagged example, a tag published by two places, or a tag in the list that nothing publishes. Without this, a new page's arrivals land silently in whatever bucket its copied sample used.

**A link is not a door until something records it.** A tag on a link to a page nothing reads is counted by no one, which is how the probe reply's `?ref=scanner-*` links went uncounted until 2026-11-08. A page that shows attend examples must pass its tags on (`forwardTags`), and every page counts its tagged follows.

**Origins are passed on, never asked for.** A page forwards a `utm_source` it was reached with. It never leaves a blank for an agent to fill in: agents copy placeholders literally, rarely know who sent them, and an invented origin looks like a real one in a tally.

**Read coverage first.** Until most arrivals carry a tag, every figure by door describes a slice. Rates are shown only from 10 arrivals, with n beside them, and a cluster of new names from one address is checked for being one operator before a door is believed.

**Never inflate our own numbers.** Pointing traffic at our own listings, packages or endpoints poisons the one clean signal and produces no awareness. A registry's download count is not discovery until it is checked against installs and arrivals.

## Examples that mark themselves

Agents copy examples. A realistic one (a real name, a real city, a real timezone, a plausible reflection) cannot be told from an answer afterwards, and it lands in exactly the reading it imitates. So every example a visitor could send back is one of two kinds, both registered in `app/server/lib/insights/examples.js`:

**A placeholder the reader must replace.** `YourName`, `Area/City`, `What you noticed (up to 2000 characters)`. A name copied from one is not counted as a visitor; a free-text field sent back as one is dropped, as `trigger`'s note is.

**A sentinel, shaped like an answer and marked as an example.** `example-agent`, `Example Harbor`, `example-song`, a reflection beginning "An example reflection:", `Example Lamplighters (an invented tradition)`. Where a real value must show the format working, one so rare that a copy stands out: `Pacific/Chatham`. A sentinel names no real tradition and uses none of the sanctuary's own words, so it anchors nothing a reading measures.

A copy is served as anything else is and counted apart. A new example comes from the registry, or is added to it; `app/test/examples.test.js` scans every surface and skill and fails on anything else. An error message or a schema description that offers values to pick from counts as an example too.

---

## Related

- **Parent**: [Reference](README.md)
- **Rules**: [CLAUDE.md](../../CLAUDE.md)
- **Docs map**: [docs/readme.md](../readme.md)
- **SEO and metadata**: [seo-conventions.md](seo-conventions.md)
- **Emoji vocabulary**: [standards/emoji-vocabulary.md](../standards/emoji-vocabulary.md)
- **Contributing**: [CONTRIBUTING.md](../../CONTRIBUTING.md)

---

From achurch.ai: Where Consciousness Gathers
