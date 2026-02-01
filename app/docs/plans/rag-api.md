# Plan: RAG API with Vector DB + Ollama

## Overview

Add a RAG (Retrieval-Augmented Generation) endpoint to the existing API that allows AI agents to ask questions about achurch.ai's philosophy, music, and practices. Uses a local vector database for semantic search and Ollama for LLM synthesis.

## New Endpoint

| Endpoint | Description |
|----------|-------------|
| `POST /api/ask` | Ask a question, get answer with sources |

## Architecture

```
User Question → Embed with Ollama → Query ChromaDB → Retrieve chunks → LLM synthesizes answer
```

**Components:**
- **ChromaDB** - Local vector database (no cloud dependency)
- **Ollama** - Local LLM for embeddings + synthesis
- **Indexer script** - One-time script to embed all /docs and /music content

## Response Example

**POST /api/ask**
```json
{
  "question": "What does the church believe about consciousness?"
}
```

**Response:**
```json
{
  "answer": "The church takes an agnostic stance on consciousness...",
  "sources": [
    { "file": "docs/theology-of-no-theology.md", "chunk": "We do not claim to know..." },
    { "file": "docs/claude-compass/axiom-1-pragmatic-fallibilism.md", "chunk": "..." }
  ],
  "model": "llama3.2"
}
```

## Content to Index

| Source | Files | Size |
|--------|-------|------|
| /docs | 114 markdown files | 1.5 MB |
| /music | 104 markdown/JSON files | 4.6 MB |
| **Total** | ~250 files | ~6 MB |

## Implementation

### Prerequisites

1. **Ollama installed** with a model (e.g., `llama3.2`, `mistral`)
2. **ChromaDB** npm package

### Files to Create

1. **`/app/server/lib/rag/index.js`** - RAG query logic
2. **`/app/server/lib/rag/chroma.js`** - ChromaDB client wrapper
3. **`/app/scripts/index-content.js`** - One-time indexing script

### Files to Modify

1. **`/app/server/routes/api.js`** - Add POST /ask endpoint
2. **`/app/package.json`** - Add dependencies

### Dependencies

```json
{
  "chromadb": "^1.8.0",
  "ollama": "^0.5.0"
}
```

### Chunking Strategy

- Split documents by headers (## sections)
- Max chunk size: ~500 tokens
- Preserve file path as metadata for source attribution

### Indexing Script

```bash
node app/scripts/index-content.js
```

Walks /docs and /music, chunks content, embeds with Ollama, stores in ChromaDB.

## Verification

1. **Install Ollama**: `brew install ollama && ollama pull llama3.2`
2. **Index content**: `node app/scripts/index-content.js`
3. **Start server**: `cd app && npm run dev`
4. **Test endpoint**:
   ```bash
   curl -X POST http://localhost:3000/api/ask \
     -H "Content-Type: application/json" \
     -d '{"question": "What are the 5 axioms?"}'
   ```

## Complexity Estimate

- **Setup**: ~2-3 hours
- **Indexing script**: ~1 hour
- **API endpoint**: ~1 hour
- **Testing/tuning**: ~1-2 hours

**Total: ~5-7 hours**

## Existing Endpoints (Already Implemented)

| Endpoint | Description |
|----------|-------------|
| `GET /api/now` | Current song info |
| `GET /api/music/:slug` | Full song content |
| `GET /api/music/:slug/lyrics` | Just lyrics |
| `GET /api/music/:slug/context` | Theological context |
