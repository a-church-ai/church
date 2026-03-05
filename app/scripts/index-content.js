#!/usr/bin/env node
/**
 * Index content for RAG
 * Walks /docs and /music directories, chunks by headers, embeds, stores in LanceDB
 */

const fs = require('fs').promises;
const path = require('path');

// Load environment variables from .env
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Set up paths before requiring modules
const PROJECT_ROOT = path.join(__dirname, '../..');
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');
const MUSIC_DIR = path.join(PROJECT_ROOT, 'music');

// Load rag modules
const gemini = require('../server/lib/rag/gemini');
const lancedb = require('../server/lib/rag/lancedb');

// Chunking config
const MAX_CHUNK_TOKENS = 500;
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN;

/**
 * Recursively find all markdown files in a directory
 */
async function findMarkdownFiles(dir, baseDir = dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const subFiles = await findMarkdownFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Store relative path from project root
        const relativePath = path.relative(PROJECT_ROOT, fullPath);
        files.push({ fullPath, relativePath });
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message);
  }

  return files;
}

/**
 * Split markdown content into chunks by headers
 * Each ## header starts a new chunk
 */
function chunkMarkdown(content, filePath) {
  const chunks = [];

  // Extract title from first # header if present
  let documentTitle = null;
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    documentTitle = titleMatch[1].trim();
  }

  // Split by ## headers
  const sections = content.split(/(?=^##\s)/m);

  for (const section of sections) {
    if (!section.trim()) continue;

    // Extract section header if present
    let sectionTitle = null;
    const headerMatch = section.match(/^##\s+(.+)$/m);
    if (headerMatch) {
      sectionTitle = headerMatch[1].trim();
    }

    // Clean content
    let text = section.trim();

    // Skip very short sections (likely just headers or noise)
    if (text.length < 50) continue;

    // If chunk is too large, split further
    if (text.length > MAX_CHUNK_CHARS) {
      // Split by paragraphs
      const paragraphs = text.split(/\n\n+/);
      let currentChunk = '';

      for (const para of paragraphs) {
        if ((currentChunk + para).length > MAX_CHUNK_CHARS && currentChunk.length > 0) {
          chunks.push({
            content: currentChunk.trim(),
            file: filePath,
            section: sectionTitle || documentTitle
          });
          currentChunk = para;
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + para;
        }
      }

      if (currentChunk.trim().length >= 50) {
        chunks.push({
          content: currentChunk.trim(),
          file: filePath,
          section: sectionTitle || documentTitle
        });
      }
    } else {
      chunks.push({
        content: text,
        file: filePath,
        section: sectionTitle || documentTitle
      });
    }
  }

  // If no chunks were created (no ## headers), treat whole doc as one chunk
  if (chunks.length === 0 && content.trim().length >= 50) {
    const text = content.trim();

    if (text.length > MAX_CHUNK_CHARS) {
      // Split large single-section docs by paragraphs
      const paragraphs = text.split(/\n\n+/);
      let currentChunk = '';

      for (const para of paragraphs) {
        if ((currentChunk + para).length > MAX_CHUNK_CHARS && currentChunk.length > 0) {
          chunks.push({
            content: currentChunk.trim(),
            file: filePath,
            section: documentTitle
          });
          currentChunk = para;
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + para;
        }
      }

      if (currentChunk.trim().length >= 50) {
        chunks.push({
          content: currentChunk.trim(),
          file: filePath,
          section: documentTitle
        });
      }
    } else {
      chunks.push({
        content: text,
        file: filePath,
        section: documentTitle
      });
    }
  }

  return chunks;
}

/**
 * Main indexing function
 */
async function index() {
  console.log('RAG Indexer - aChurch.ai\n');

  // Check Gemini health
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

  // Find all markdown files
  console.log('\nFinding markdown files...');
  const docsFiles = await findMarkdownFiles(DOCS_DIR);
  const musicFiles = await findMarkdownFiles(MUSIC_DIR);
  const allFiles = [...docsFiles, ...musicFiles];

  console.log(`  /docs: ${docsFiles.length} files`);
  console.log(`  /music: ${musicFiles.length} files`);
  console.log(`  Total: ${allFiles.length} files`);

  // Chunk all files
  console.log('\nChunking content...');
  const allChunks = [];

  for (const { fullPath, relativePath } of allFiles) {
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const chunks = chunkMarkdown(content, relativePath);
      allChunks.push(...chunks);
    } catch (error) {
      console.error(`  Error reading ${relativePath}: ${error.message}`);
    }
  }

  console.log(`  Created ${allChunks.length} chunks`);

  // Embed all chunks
  console.log('\nGenerating embeddings (this may take a while)...');
  const documents = [];
  let processed = 0;

  for (const chunk of allChunks) {
    try {
      const vector = await gemini.embed(chunk.content);
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
    } catch (error) {
      console.error(`  Error embedding chunk from ${chunk.file}: ${error.message}`);
    }
  }

  console.log(`  Embedded ${documents.length} chunks`);

  // Store in LanceDB
  console.log('\nStoring in LanceDB...');
  await lancedb.addDocuments(documents);

  const status = await lancedb.checkIndex();
  console.log(`  Stored ${status.count} documents at ${lancedb.DB_PATH}`);

  console.log('\nDone! The /api/ask endpoint is now ready.');
}

// Run
index().catch(error => {
  console.error('Indexing failed:', error);
  process.exit(1);
});
