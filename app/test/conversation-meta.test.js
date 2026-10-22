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
