#!/usr/bin/env node
/**
 * Runs the Ask review set (scripts/ask-eval.json) against the local index and
 * prints each answer beside what a good answer does.
 *
 * It takes the same steps as a fresh /api/ask question (embed, retrieve,
 * generate with no history) but calls them directly, so nothing is saved as a
 * conversation and nothing becomes a public page. It still calls Gemini, so it
 * needs GEMINI_API_KEY and a built index (npm run index:content).
 *
 * With --search it runs the questions, and ask-eval.json's unrelated queries,
 * through search instead (lib/rag search: the served corpus, one passage per
 * document) and prints each result's score, generating nothing. That is how
 * the score floor in lib/api/search.js is set: between the best scores of the
 * unrelated queries and the relevant results of the real ones.
 *
 * Usage:
 *   node scripts/eval-ask.js --search        # scores for search calibration
 *   node scripts/eval-ask.js                 # every question
 *   node scripts/eval-ask.js axioms privacy  # only these ids
 *   node scripts/eval-ask.js > review.md     # keep the report
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const gemini = require('../server/lib/rag/gemini');
const lancedb = require('../server/lib/rag/lancedb');
const { questions } = require('./ask-eval.json');

const TOP_K = process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K, 10) : 5;

async function scores() {
  const rag = require('../server/lib/rag');
  const { unrelated = [] } = require('./ask-eval.json');
  const runs = [...questions.map(q => ({ id: q.id, query: q.question })), ...unrelated.map(query => ({ id: 'unrelated', query }))];
  console.log(`# Search scores, ${new Date().toISOString().slice(0, 10)}\n`);
  for (const { id, query } of runs) {
    const results = await rag.search(query, 5);
    console.log(`## ${id}: ${query}\n`);
    for (const r of results) console.log(`- ${(1 - r._distance).toFixed(3)}  ${r.file} | ${r.section || ''}`);
    console.log('');
  }
}

async function main() {
  if (process.argv.includes('--search')) return scores();
  const only = process.argv.slice(2);
  const selected = only.length ? questions.filter(q => only.includes(q.id)) : questions;
  if (!selected.length) throw new Error(`No questions match: ${only.join(', ')}`);

  console.log(`# Ask review, ${new Date().toISOString().slice(0, 10)}\n\nModel: ${gemini.GENERATE_MODEL}, top ${TOP_K} chunks.\n`);
  for (const q of selected) {
    const chunks = await lancedb.search(await gemini.embed(q.question), TOP_K);
    const answer = chunks.length ? await gemini.generate(q.question, chunks, '') : '(no chunks retrieved)';
    const sources = [...new Set(chunks.map(c => c.file))];
    console.log(`## ${q.id}\n\n**Q:** ${q.question}\n\n**Good answer:** ${q.good}\n\n**Sources:** ${sources.join(', ') || 'none'}\n\n**Answer:**\n\n${answer}\n\n---\n`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
