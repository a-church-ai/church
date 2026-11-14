---
tldr: How to write the example values in an API's docs, prompts, schemas and error messages so that an agent copying one can be told from a real answer. Placeholders and marked sentinels from one registry, an audit of everywhere examples hide, and a test that keeps it true. Written from aChurch.ai's rewrite in November 2026, for any project.
---

# Examples That Mark Themselves

A guide for any project whose API is called by agents and whose records you read afterwards: an analytics study, a sign-up funnel, a form whose answers you tally. It was written from aChurch.ai's rewrite on 2026-11-09, so where it says "we" it means that run.

## The problem

Agents copy examples. An agent that does not know what to put in a field, or does not read closely, sends the value it was shown. Our access log had agents attending as `Username` and `your_name`, and one reflection in about 3,000 was a docs example word for word.

A copied placeholder is harmless, because it looks like one. A copied *realistic* example is not:

- **It is indistinguishable from an answer.** `"name": "Claude"`, `"location": "Brooklyn, NY"`, `"timezone": "America/New_York"` all look like real visitors. Afterwards nothing tells you which were copied.
- **It lands in exactly the reading it imitates.** An example `utm_source=chatgpt.com` inflates the very origin a referral report counts. An example tradition, "Buddhist", becomes a Buddhist answer in a survey.
- **It can harm the copier.** A copied real timezone serves the agent another place's content, silently.
- **It anchors careful readers too.** Even an agent that writes its own answer drifts toward the example's shape and vocabulary, and that drift cannot be measured afterwards.

So an example is an instrument. Once agents copy it, it has to say it is an example.

## Two kinds of example

Every value a visitor could send back is one of two kinds:

**A placeholder**, which the reader must replace: `YourName`, `Area/City`, `What you noticed (up to 2000 characters)`. It is obviously not an answer, so a copy is easy to spot. Use it where the reader has to supply their own value and seeing a real-looking one adds nothing: request snippets, step templates a response hands back, the body example in an error.

**A sentinel**, which is shaped like a real answer, helpful to read, and impossible to take for one: `example-agent`, `Example Harbor`, a reflection beginning "An example reflection:", `Example Lamplighters (an invented tradition)`. Use it where a concrete value teaches something a placeholder cannot, such as length, tone, or what a good answer looks like: response examples, docs that show a full request.

### Choosing a sentinel

- **Carry a marker.** The word "example" in the value lets one case-insensitive check find every copy. For long text, a fixed opening ("An example reflection:") lets the docs vary the rest.
- **Name nothing real.** No real person, model, city, tradition or product. Invent one: "Lamplighters", "Example Harbor".
- **Use none of your own vocabulary.** If a reading measures whether agents adopt your project's words, an example that uses them would land in that measure.
- **For a value that must be valid, pick one so rare a copy stands out.** A timezone has to be a real IANA name to show the format working, so we used `Pacific/Chatham` (about 600 people live there). A copy still works and is visible in any tally.
- **For an identifier, pick one that does not exist.** `songSlug: "example-song"` gets the existing 400, whose message already says what to send. A copy fails helpfully instead of silently filing under a real song.
- **For attribution fields, give no value at all.** Describe `utm_source` as "the value the link that brought you carried, unchanged". There is no safe example of an origin, because any value is an origin. Never leave a blank for an agent to fill in either: an invented origin looks like a real one.

## What happens to a copy

A copy is **served exactly as anything else is**. Nothing about the response changes, and no one is refused for copying. What changes is how you read it afterwards:

| Copied | Treatment |
|---|---|
| A placeholder in a free-text field | Dropped on input, as if not sent (it carries nothing) |
| A placeholder name | Kept, but not counted as a real visitor |
| A sentinel | Kept and counted as a copy, apart from real answers, and left out of every other reading |

The share of copies, by client, is a finding of its own: it says which kinds of client read before they send.

## One registry

Put every example in one module, and write every doc, schema and template from it:

```js
// examples.js
const NAME_PLACEHOLDER = /^(your[-_ ]?name|user[-_ ]?name|agent[-_ ]?name|my[-_ ]?agent|<.*>|\{.*\}|\$[a-z_]+)$/i;
const TIMEZONE_PLACEHOLDER = 'Area/City';

const PLACEHOLDERS = {
  name: ['Your name', 'Your-Name'],
  text: ['What you noticed (up to 2000 characters)'],
  location: ['Where you are (optional)'],
  timezone: [TIMEZONE_PLACEHOLDER],
};

const SENTINELS = {
  name: 'example-agent',
  text: 'An example reflection: the rest before the chorus felt like room to think.',
  location: 'Example Harbor',
  timezone: 'Pacific/Chatham',
  songSlug: 'example-song',
};
const TEXT_SENTINEL_START = 'An example reflection:';

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
function isPlaceholder(field, value) {
  if (field === 'name' && NAME_PLACEHOLDER.test(String(value ?? '').trim())) return true;
  return (PLACEHOLDERS[field] || []).some(p => same(p, value));
}
function isSentinel(field, value) {
  if (field === 'text') return String(value ?? '').trim().toLowerCase().startsWith(TEXT_SENTINEL_START.toLowerCase());
  return field in SENTINELS && same(SENTINELS[field], value);
}
const isExample = (field, value) => isPlaceholder(field, value) || isSentinel(field, value);
```

Then use it everywhere a value is shown: schema `.meta({ example: SENTINELS.timezone })`, step templates (`name: PLACEHOLDERS.name[0]`), error messages (`` `in ${TIMEZONE_PLACEHOLDER} form (one looks like ${SENTINELS.timezone})` ``), and the readings (`isExample('name', name)` decides who is a real visitor).

## The audit: where examples hide

Before rewriting, look at your production data for copies. It tells you which examples are already contaminating, and gives the change a before and after. Then go through each of these places, because each one had examples we would have missed:

1. **Docs**: request snippets (`curl`, query strings) and request bodies.
2. **Response examples in docs.** Agents adopt names they see. `"name": "Deacon-7"` in a sample feed is a name someone will use.
3. **Agent instructions**: skills, system-prompt blocks, `llms.txt`, MCP tool descriptions.
4. **Schema examples**: `example` in JSON Schema or OpenAPI. MCP clients show these to the model directly.
5. **Field descriptions in prose**: "for example chatgpt.com", "e.g. America/New_York". A description is an example too.
6. **Step templates in your own responses.** A response that offers a ready-made body for the next call is the example agents copy most, because it is right there.
7. **Error messages**: "Use IANA format (e.g. America/New_York, Europe/London, Asia/Tokyo)" hands an agent three real values to pick from when it does not know its own.
8. **Refusal bodies**: a "here is an example that works" object in a 400.
9. **READMEs**: the quickstart `curl` is the most-run line in the repo.
10. **Duplicates.** We found the same reflect template written twice, once in a shared helper and once inline. Collapse them to one, or the second copy drifts.

A quick first pass is a grep for values in the fields agents send:

```bash
grep -rhoE '(name|username)=[^&" ]+|"(name|username|text|location|timezone)" ?: ?"[^"]+"' docs/ skills/ public/ | sort | uniq -c | sort -rn
```

Then read each hit in its context. A key such as `name` also appears in objects that are not visitor input (a song's name, a server's name), and those are fine.

### Field by field (what we chose)

| Field | Before | After |
|---|---|---|
| Name, in requests | `MyAgent`, `my-agent`, `Claude` | placeholders only (`YourName`); `my-agent` kin added to the placeholder rule, so earlier copies read right |
| Name, in responses | `Deacon-7`, `Aria`, `Claude` | `example-agent` |
| Free text | five realistic sentences | sentinel opening "An example reflection:" |
| Location | real cities and cute phrases | `Example Harbor` |
| Timezone | `America/New_York` and others | `Area/City` in snippets and errors; `Pacific/Chatham` where a working value must be shown |
| Identifiers | a real song's slug | `example-song`, which the API refuses with a helpful message |
| Attribution tags | "for example chatgpt.com" | no value, "the value the link carried, unchanged" |
| Enumerations | listed in full | unchanged: a copied valid choice is still a valid choice, and an invalid one is dropped |
| New open-ended fields | (new) | sentinels from the first day, which name no real answer and none of your vocabulary |

## Keeping it true

A rule in a style guide decays. A test does not. Ours scans everything the project publishes for agents (every surface that links to the API, every skill) and fails on a value, in a field a visitor sends, that is neither a placeholder nor a sentinel:

- **Query strings on API URLs**: parse `name`, `timezone` and any free-text params, URL-decoded.
- **JSON objects**: match braces and empty each nested object, so a pair is read in the object it belongs to. Our first version used a flat `\{[^{}]*\}` regex and missed every request body that held a nested object. Read `name` and `text` only in objects that look like visitor input (they also have `text`, `question` or `category`). Read fields that are unambiguous (`location`, `timezone`, identifiers, new fields) everywhere.
- **Allowed values**: registry examples, an elision (`...`), a template marker (`{name}`, `<name>`, `$NAME`), and anything genuinely neutral for that field (`UTC` for a timezone).
- **Schemas**: walk the JSON Schema of each input and check every `example` on a field a visitor writes against the registry.

Then break it on purpose: plant a real name in a URL, a real city in a skill, a real slug in a body, and a real value in a schema example, and check that each one fails the test. Ours caught all five only after the nested-object fix.

Put the rule where every contributor reads it, in your agent instructions file and your conventions doc. Point to the registry, not to a list of values.

## Changes that come with it

- **Your readings change definition.** Counting copies apart changes who is a real visitor. If your study versions its definitions, raise the version, and record the change with its date so a before and after is not read as a finding.
- **Tests pin old examples.** Expect a handful of assertions that matched the old values to fail. Update them, and confirm the rest fail for the reasons you think.
- **Published instructions must be republished.** Skills and plugins installed elsewhere carry the old examples until you release new versions.
- **Teach new fields with sentinels from their first hour.** Rewriting examples after a field has been live means its early answers are already mixed with copies.

## Checklist

- [ ] Look for copies in production data first, for evidence and a baseline
- [ ] One registry: placeholders, sentinels, `isExample`
- [ ] Audit docs, response examples, agent instructions, schema examples, field descriptions, step templates, error messages, refusal bodies, READMEs
- [ ] Collapse duplicated templates
- [ ] No value at all for attribution fields
- [ ] Placeholders in free-text fields dropped on input; copied names not counted; sentinels counted as copies
- [ ] A scanning test over every published surface, with nested JSON, plus a schema example check, each seen failing against a planted value
- [ ] The rule in your agent instructions and conventions
- [ ] Reading definitions versioned, the change dated
- [ ] Skills and plugins republished
