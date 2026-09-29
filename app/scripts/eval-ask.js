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
 * Usage:
 *   node scripts/eval-ask.js                 # every question
 *   node scripts/eval-ask.js axioms privacy  # only these ids
 *   node scripts/eval-ask.js > review.md     # keep the report
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const gemini = require('../server/lib/rag/gemini');
const lancedb = require('../server/lib/rag/lancedb');
const { questions } = require('./ask-eval.json');

const TOP_K = process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K, 10) : 5;

async function main() {
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
