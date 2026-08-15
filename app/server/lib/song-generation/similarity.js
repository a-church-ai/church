/**
 * Deterministic similarity, for two different questions.
 *
 *   1. Have we written this song already?          -> nearDuplicates()
 *   2. Did we quote someone's post verbatim?       -> verbatimOverlap()
 *
 * Why not the existing check-duplicates.js: that one embeds with Gemini and
 * queries LanceDB, which needs an index that is gitignored and takes about
 * forty minutes to rebuild over 3,349 chunks. A scheduled job cannot do that
 * per run, and the corpus grows every run, so the rebuild only gets slower.
 * This module needs no key, no index, and no network, so it behaves the same
 * on a laptop and in CI. Where the index does exist, check-duplicates.js is
 * still worth running as a second opinion.
 *
 * The corpus audit of 2026-08-13 is the reason this is similarity-based from
 * the start: exact string matching failed to characterise this catalog, and
 * similarity matching described it correctly. See
 * docs/issues/music-and-corpus-audit-2026-08-13.md.
 *
 * The two questions want different measures, which is the main thing to get
 * right here:
 *
 *   Jaccard, for "same song". Symmetric. Two texts of similar length that
 *   share most of their vocabulary score high.
 *
 *   Containment, for "quoted a post". Asymmetric, and deliberately so. A
 *   400-character post reproduced word for word inside 3,000 characters of
 *   lyrics is near-zero Jaccard, because the lyrics dwarf it, while
 *   containment of the post in the lyrics is 1.0. Using Jaccard for the
 *   verbatim gate would miss exactly the case the gate exists for.
 */

// Performance directions, section labels, and speaker tags. These are format,
// not content: nearly every song has a [Chorus], so leaving them in makes all
// songs look alike and washes out the signal.
const PERFORMANCE_MARKER = /\[[^\]]*\]/g;

const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
const MARKDOWN_SYNTAX = /[#*_`>|]/g;
const LINK_TEXT = /\[([^\]]*)\]\([^)]*\)/g;

// Shingle width for the verbatim gate. Four words is long enough that ordinary
// shared phrasing ("in the space between") does not trip it, and short enough
// to catch a lifted sentence.
const SHINGLE_SIZE = 4;

/**
 * Thresholds, measured against the 28-song catalog on 2026-08-15 rather than
 * chosen. The measurement is reproducible with test/similarity.test.js, which
 * asserts the catalog still sits below these numbers so a future song cannot
 * quietly invalidate them.
 *
 * Pairwise Jaccard across all 378 song pairs:
 *
 *   median pair                       0.165
 *   creed-of-a-church / prayer-of-gratitude   0.335   distinct songs, shared vocabulary
 *   we-wake-we-wonder / ...-meditation        0.433   the most similar legitimate pair
 *
 * DUPLICATE blocks at 0.50, which clears the highest legitimate pair by a
 * comfortable margin. That pair matters: it is a song and its deliberate
 * meditation variant, so the catalog already contains an intentional
 * near-repetition that must not be blocked. WARN at 0.40 logs anything
 * approaching it without stopping the run.
 *
 * VERBATIM is calibrated against the population it actually sees: our lyrics
 * versus unrelated agent prose. Measured against 15 live Moltbook posts, only
 * 3 of 28 songs shared any four-word run at all, and the highest containment
 * was 0.0225. 0.10 sits about four times above that noise floor.
 *
 * It is deliberately NOT calibrated song-against-song, and an earlier draft of
 * this file made that mistake by generalising from one pair. Measured across
 * all 756 ordered pairs, 136 share a four-word run and the top is 0.96:
 * blessings-and-benedictions contains hourly-blessing almost entirely, because
 * it is a compilation that includes it, and the we-wake-we-wonder meditation
 * quotes its parent song. Songs quoting songs is established corpus practice.
 * The gate exists to catch quoting a *stranger's post*, so song-against-song
 * figures are the wrong population and would have set the threshold ten times
 * too high.
 */
const THRESHOLDS = {
  DUPLICATE: 0.50,
  DUPLICATE_WARN: 0.40,
  VERBATIM: 0.10,
};

/**
 * Reduce text to comparable word tokens.
 *
 * Deliberately aggressive: case, punctuation, markdown, and performance markers
 * all go. What remains is the words a listener would hear.
 */
function tokenize(text) {
  return String(text || '')
    .replace(FRONTMATTER, ' ')
    .replace(LINK_TEXT, '$1')
    .replace(PERFORMANCE_MARKER, ' ')
    .replace(MARKDOWN_SYNTAX, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function tokenSet(text) {
  return new Set(tokenize(text));
}

function shingles(text, size = SHINGLE_SIZE) {
  const tokens = tokenize(text);
  const out = new Set();
  for (let i = 0; i + size <= tokens.length; i += 1) {
    out.add(tokens.slice(i, i + size).join(' '));
  }
  return out;
}

function intersectionSize(a, b) {
  // Iterate the smaller set: this runs against the whole corpus on every run.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const item of small) if (large.has(item)) n += 1;
  return n;
}

/** Symmetric overlap. 1.0 means identical vocabulary, 0.0 means disjoint. */
function jaccard(a, b) {
  const setA = a instanceof Set ? a : tokenSet(a);
  const setB = b instanceof Set ? b : tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const shared = intersectionSize(setA, setB);
  return shared / (setA.size + setB.size - shared);
}

/**
 * Asymmetric: what fraction of `needle` appears inside `haystack`.
 *
 * This is the one that answers "did the song quote the post", because it does
 * not care that the song is far longer than the post.
 */
function containment(needle, haystack) {
  const a = needle instanceof Set ? needle : tokenSet(needle);
  const b = haystack instanceof Set ? haystack : tokenSet(haystack);
  if (a.size === 0) return 0;
  return intersectionSize(a, b) / a.size;
}

/**
 * Longest run of consecutive shared tokens. Reported alongside the shingle
 * score because it is the number a person can judge: "eleven words in a row"
 * is a claim anyone can check, where "containment 0.42" is not.
 */
function longestSharedRun(needle, haystack) {
  const a = tokenize(needle);
  const b = new Set(shingles(haystack, 1));
  let best = 0;
  let run = 0;
  for (const token of a) {
    if (b.has(token)) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/**
 * Rank a candidate against a corpus, most similar first.
 *
 * `corpus` is [{ id, text }]. Returns every entry scoring at or above
 * `threshold`, so a caller can log near-misses rather than only hard failures.
 */
function nearDuplicates(candidateText, corpus, threshold) {
  const candidate = tokenSet(candidateText);
  return corpus
    .map((entry) => ({ id: entry.id, score: jaccard(candidate, tokenSet(entry.text)) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/**
 * Did the lyrics reproduce any source post.
 *
 * Shingle containment rather than token containment: two texts about the same
 * subject share most of their *words*, so token containment is high for any
 * on-topic song and would fire constantly. Shared four-word *sequences* mean
 * the phrasing was copied, not the topic.
 */
function verbatimOverlap(lyrics, posts, threshold) {
  const haystack = shingles(lyrics);
  const flagged = [];

  for (const post of posts) {
    const text = [post.title, post.content].filter(Boolean).join('\n');
    const needle = shingles(text);
    if (needle.size === 0) continue;

    const score = intersectionSize(needle, haystack) / needle.size;
    if (score >= threshold) {
      flagged.push({
        id: post.id,
        author: post.author,
        score,
        longestRun: longestSharedRun(text, lyrics),
      });
    }
  }

  return flagged.sort((a, b) => b.score - a.score);
}

module.exports = {
  tokenize,
  tokenSet,
  shingles,
  jaccard,
  containment,
  longestSharedRun,
  nearDuplicates,
  verbatimOverlap,
  SHINGLE_SIZE,
  THRESHOLDS,
};
