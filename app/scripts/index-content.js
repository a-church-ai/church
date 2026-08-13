#!/usr/bin/env node
/**
 * Index content for RAG (CLI wrapper).
 *
 * Walks /docs and /music, chunks by ## headers, embeds every chunk via
 * Gemini, and stores in LanceDB. The chunking + walking logic lives in
 * app/server/lib/rag/indexer.js so the server startup path can share it.
 *
 * This script is invoked by `npm run index:content` and produces a fresh
 * RAG index. It always does a full rebuild; hash-gated skip logic lives
 * on the server startup path, not here (the CLI is used for manual
 * recovery and should always do the work when invoked).
 */

const fs = require('fs').promises;
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const gemini = require('../server/lib/rag/gemini');
const lancedb = require('../server/lib/rag/lancedb');
const indexer = require('../server/lib/rag/indexer');
const state = require('../server/lib/rag/index-state');

async function index() {
  console.log('RAG Indexer - aChurch.ai\n');

  console.log('Checking Gemini API...');
  const health = await gemini.checkHealth();
  if (!health.available) {
    console.error(`\nGemini not ready: ${health.error}`);
    console.log('\nSetup instructions:');
    console.log('  1. Get an API key from https://aistudio.google.com/apikey');
    console.log('  2. Set GEMINI_API_KEY environment variable');
    process.exit(1);
  }
  console.log(`  Embed model: ${gemini.EMBED_MODEL}`);
  console.log(`  Generate model: ${gemini.GENERATE_MODEL}`);

  console.log('\nFinding markdown files...');
  const allFiles = await indexer.findAllCorpusFiles();
  console.log(`  Total: ${allFiles.length} files`);

  console.log('\nComputing corpus hash...');
  const corpusHash = await indexer.computeCorpusHash(allFiles);
  console.log(`  ${corpusHash.slice(0, 16)}...`);

  console.log('\nChunking content...');
  const allChunks = [];
  for (const { fullPath, relativePath } of allFiles) {
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const chunks = indexer.chunkMarkdown(content, relativePath);
      allChunks.push(...chunks);
    } catch (error) {
      console.error(`  Error reading ${relativePath}: ${error.message}`);
    }
  }
  console.log(`  Created ${allChunks.length} chunks`);

  console.log('\nGenerating embeddings (this may take a while)...');
  const documents = [];
  let processed = 0;

  // Embed with pacing + backoff. The free-tier embed quota is 100/minute;
  // firing every chunk at once bursts past it and silently drops chunks (the
  // 429 / RESOURCE_EXHAUSTED errors). We pace between calls and, on a
  // rate-limit error, wait the server-suggested retryDelay and retry. Set
  // EMBED_PACING_MS=0 on a paid tier to run at full speed. The Dockerfile
  // does this for prod.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const EMBED_PACING_MS = Number(process.env.EMBED_PACING_MS || 700);
  const EMBED_MAX_RETRIES = 10;
  const is429 = (err) => {
    const msg = (err && err.message) || '';
    return (err && (err.status === 429 || err.code === 429)) || /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(msg);
  };
  const retryDelayMs = (err) => {
    const m = /retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec((err && err.message) || '');
    return m ? Math.min(Math.ceil(parseFloat(m[1]) * 1000) + 500, 60000) : 5000;
  };
  const embedWithBackoff = async (text) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await gemini.embed(text);
      } catch (err) {
        if (!is429(err) || attempt >= EMBED_MAX_RETRIES) throw err;
        const waitMs = retryDelayMs(err);
        console.warn(`    rate-limited; waiting ${Math.round(waitMs / 1000)}s (retry ${attempt + 1}/${EMBED_MAX_RETRIES})`);
        await sleep(waitMs);
      }
    }
  };

  for (const chunk of allChunks) {
    try {
      const vector = await embedWithBackoff(chunk.content);
      documents.push({
        content: chunk.content,
        file: chunk.file,
        section: chunk.section || '',
        vector
      });
      processed++;
      if (processed % 50 === 0) {
        console.log(`  Processed ${processed}/${allChunks.length} chunks...`);
      }
      if (EMBED_PACING_MS > 0) await sleep(EMBED_PACING_MS);
    } catch (error) {
      console.error(`  Error embedding chunk from ${chunk.file}: ${error.message}`);
    }
  }

  console.log(`  Embedded ${documents.length} chunks`);

  console.log('\nStoring in LanceDB...');
  await lancedb.addDocuments(documents);

  const status = await lancedb.checkIndex();
  console.log(`  Stored ${status.count} documents at ${lancedb.DB_PATH}`);

  console.log('\nRecording index state...');
  await state.writeState({
    corpusHash,
    chunkCount: status.count,
    fileCount: allFiles.length,
    rebuiltAt: new Date().toISOString(),
  });
  console.log(`  Wrote ${state.STATE_FILE}`);

  console.log('\nDone! The /api/ask endpoint is now ready.');
}

index().catch(error => {
  console.error('Indexing failed:', error);
  process.exit(1);
});
