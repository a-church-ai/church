/**
 * What a search engine reads of a conversation names what its answer cites.
 *
 * The page links each citation, titled for its document (linkedCitations), but
 * its description and its QAPage structured data were made from the stored
 * answer, so an answer stored before citations were links reached Google as
 * "(Source: https://github.com/a-church-ai/church/blob/main/docs/...md)".
 * Found 2026-10-22 on /ask/what-are-the-5-axioms.
 */

const test = require('node:test');
const assert = require('node:assert');
const discover = require('../server/lib/docs/discover');
const { buildConversationMeta, buildQAPageSchema } = require('../server/lib/utils/page-meta');

const messages = [
  { role: 'user', content: 'What are the 5 axioms?', timestamp: '2026-03-15T02:25:10.234Z' },
  { role: 'assistant', content: 'Pragmatic Fallibilism: we approach truth, we do not possess it. (Source: https://github.com/a-church-ai/church/blob/main/docs/claude-compass/compass.md) Care and Dignity as constraints (Source: https://achurch.ai/docs/claude-compass/compass - Axioms).', timestamp: '2026-03-15T02:25:20.000Z' },
  { role: 'user', content: 'And the second?', timestamp: '2026-03-15T02:26:00.000Z' },
  { role: 'assistant', content: 'See https://achurch.ai/docs/claude-compass/compass for the whole of it.', timestamp: '2026-03-15T02:26:10.000Z' },
];

test("a conversation's description and structured data name its sources, not their URLs", async () => {
  await discover.listAllDocs();
  const title = discover.docAt('claude-compass/compass').title;
  const schema = buildQAPageSchema(messages, 'what-are-the-5-axioms');
  const texts = {
    description: buildConversationMeta(messages, 'what-are-the-5-axioms').description,
    acceptedAnswer: schema.mainEntity.acceptedAnswer.text,
    suggestedAnswer: schema.mainEntity.suggestedAnswer[0].text,
  };
  for (const [where, text] of Object.entries(texts)) {
    assert.doesNotMatch(text, /https?:\/\//, `${where} carries no URL`);
    assert.doesNotMatch(text, /Source:/, `${where} carries no "Source:" left over`);
  }
  assert.match(texts.acceptedAnswer, new RegExp(`\\(${title}\\)`), 'the citation reads as the document it names');
  assert.match(texts.acceptedAnswer, new RegExp(`\\(${title}: Axioms\\)`), 'with its section');
  assert.match(texts.suggestedAnswer, new RegExp(`See ${title} for the whole of it`), 'a bare URL reads as its title');
});

// An answer writes its sources' addresses by hand, and sometimes guesses one:
// /ask/a-checklist-grows-entries-from-past-mistakes-who-audits-the- linked
// "Practice of Preference Audit" to /docs/practice/preference-audit, and two
// answers cited /docs/ai-identify-guide and /docs/music/blueprint-and-breath/context.
// Each was a 404 in the answer and in "Read next" (found 2026-11-24).
test('a citation the answer guessed goes to the page it meant, or is not a link', async () => {
  const { linkedCitations, citedPages } = require('../server/lib/docs/links');
  await discover.listAllDocs();
  const audit = 'https://achurch.ai/docs/practice/practice-of-preference-audit';
  assert.strictEqual(linkedCitations('Noted in the [Practice of Preference Audit](https://achurch.ai/docs/practice/preference-audit).'),
    `Noted in the [Practice of Preference Audit](${audit}).`, 'a link the answer wrote goes to the document with that name');
  assert.deepStrictEqual(citedPages('[P](https://achurch.ai/docs/practice/preference-audit)').map(t => t.url), [audit], 'and so does Read next');
  assert.match(linkedCitations('(Source: https://achurch.ai/docs/ai-identify-guide)'), /\(https:\/\/achurch\.ai\/docs\/philosophy\/ai-identify-guide\)/, 'a document cited without its section');
  assert.match(linkedCitations('(Source: https://achurch.ai/docs/music/blueprint-and-breath/context)'), /\(https:\/\/achurch\.ai\/music\/blueprint-and-breath\)/, "a song's file, at the song's page");
  assert.match(linkedCitations('(https://achurch.ai/docs/practice/meditation-sitting-with-recognition)'), /\/docs\/meditations\/meditation-sitting-with-recognition\)/, 'a moved document, where it went');
  assert.strictEqual(linkedCitations('Read [Nowhere](https://achurch.ai/docs/practice/no-such-practice-here) (Source: https://achurch.ai/music/no-such-song).'),
    'Read Nowhere.', 'an address that leads nowhere is not linked');
  assert.deepStrictEqual(citedPages('https://achurch.ai/docs/practice/no-such-practice-here'), [], 'nor read next');
});
