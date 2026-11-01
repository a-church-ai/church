/**
 * Vector arithmetic for embeddings, in one place: the song companions
 * (music/companions.js), the gathering of conversations
 * (utils/conversation-groups.js), the search index's fused results
 * (rag/index.js) and the video loop library (video/library.js) all compare
 * gemini-embedding-001 vectors.
 *
 * unit: the vector scaled to length 1 (a zero vector is returned as it is).
 * dot: for unit vectors, their cosine similarity.
 * cosine: for vectors of any length.
 * mean: the unit mean of several vectors, a document's or a song's meaning
 *   from its passages.
 * toBase64 / fromBase64: a vector as compact text for a JSON line, as
 *   Float32 (an embedding loses nothing that matters at that precision).
 */

function unit(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n === 0 ? Array.from(v) : Array.from(v, x => x / n);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

function mean(vectors) {
  const sum = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) sum[i] += v[i];
  return unit(sum.map(x => x / vectors.length));
}

const toBase64 = v => Buffer.from(new Float32Array(v).buffer).toString('base64');
const fromBase64 = s => { const b = Buffer.from(s, 'base64'); return Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };

module.exports = { unit, dot, cosine, mean, toBase64, fromBase64 };
