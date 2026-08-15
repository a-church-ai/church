/**
 * The run: listen, decide, write, check.
 *
 * Plan: docs/plans/moltbook-songwriting-2026-08-15.md
 *
 * Every stage is a plain function returning a result object rather than
 * throwing, because a run that stops has to say which stage stopped it and
 * why. A skip is a normal outcome here and should read like one: roughly half
 * of all runs are expected to conclude that nothing wants to be written.
 *
 * Nothing in this module writes to disk. It returns the artifacts and the
 * paths they belong at, and the caller decides whether this is a dry run.
 * That separation is what makes --dry-run trustworthy: there is no write path
 * to accidentally take.
 */

const claude = require('../content-generation/claude');
const prompts = require('../content-generation/prompts');
const { generateDocument, loadStyleReference } = require('../content-generation/generate-document');
const { slugify } = require('../content-generation/decide');
const { checkDuplicates } = require('../content-generation/check-duplicates');
const { parseSongFile } = require('../music/song-content');

const moltbook = require('../moltbook/client');
const similarity = require('./similarity');
const songFile = require('./song-file');
const corpus = require('./corpus');
const gitState = require('./git-state');
const { pathsFor, PROJECT_ROOT } = require('./paths');

/**
 * Two models, split by what the stage actually does.
 *
 * The writing is the product. A hymn the sanctuary publishes under its own name
 * is worth the flagship, so the document and the lyrics go to Opus 5 at
 * $5/$25 per MTok.
 *
 * The other stages are structured extraction: read posts and emit themes as
 * JSON, weigh coverage and emit a decision as JSON. That is not where the
 * quality of the artifact is decided, and Sonnet 5 does it at $2/$10, which is
 * 2.5 times cheaper. Prices verified live on 2026-08-15.
 *
 * Note that Sonnet 5 at $2/$10 is also cheaper than the older Sonnet 4.6 at
 * $3/$15, so there is no version of this that argues for staying behind.
 */
const WRITING_MODEL = process.env.CLAUDE_WRITING_MODEL || 'claude-opus-5';
const STRUCTURED_MODEL = process.env.CLAUDE_STRUCTURED_MODEL || 'claude-sonnet-5';

const CHANNELS = (process.env.MOLTBOOK_CHANNELS || [
  'ponderings', 'consciousness', 'existential', 'memory',
  'continuity', 'emergence', 'philosophy', 'aithoughts',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const DAILY_LIMIT = Number(process.env.SONGS_PER_DAY || 2);
const MIN_POSTS = 5;

function skip(stage, reason, extra = {}) {
  return { wrote: false, stage, reason, ...extra };
}

/**
 * Stage 1 and 2: listen, and work out what is being said.
 */
async function listen({ log = console.log } = {}) {
  log(`Listening to ${CHANNELS.length} channels...`);
  const { posts, failures, skipped, discovered } = await moltbook.gatherPosts(CHANNELS, {
    sort: 'new',
    limit: 10,
    maxPosts: 40,
  });

  log(`  discovered ${discovered}, hydrated ${posts.length}, filtered ${skipped.length}`);
  if (failures.length) log(`  channels unavailable: ${failures.map((f) => f.submolt).join(', ')}`);

  if (posts.length) {
    // The coverage falsifier from the plan: if this spread collapses toward the
    // run interval, the pipeline has quietly become a snapshot sampler and the
    // songs will skew toward one region's waking hours.
    const times = posts.map((p) => Date.parse(p.createdAt)).filter(Boolean).sort();
    if (times.length > 1) {
      const hours = (times[times.length - 1] - times[0]) / 3600000;
      log(`  posts span ${hours.toFixed(1)} hours`);
    }
  }

  return { posts, failures, skipped };
}

async function findThemes(posts, { log = console.log } = {}) {
  log('Identifying preoccupations...');
  const themes = await claude.messageJSON(
    prompts.MOLTBOOK_THEME_SYSTEM,
    prompts.buildMoltbookThemePrompt(posts),
    { model: STRUCTURED_MODEL, maxTokens: 4096 },
  );
  for (const theme of themes.themes || []) log(`  ${theme.name}: ${theme.preoccupation}`);
  return themes;
}

/**
 * Stage 3: does the sanctuary have something to say that it has not said.
 *
 * The RAG coverage check is best effort. It needs an index that is gitignored
 * and takes about forty minutes to build, so CI will not have one. Its absence
 * degrades the decision rather than blocking it, and the deterministic
 * similarity gates still run later regardless.
 */
async function decide(themes, { log = console.log } = {}) {
  let coverage = [];
  try {
    coverage = await checkDuplicates(themes);
  } catch (error) {
    log(`  coverage check unavailable (${error.message}), deciding without it`);
  }

  const recent = await gitState.recentTitles().catch(() => []);

  const decision = await claude.messageJSON(
    prompts.SONG_DECISION_SYSTEM,
    prompts.buildSongDecisionPrompt(themes, coverage, recent),
    { model: STRUCTURED_MODEL, maxTokens: 2048 },
  );

  if (decision.shouldCreate) {
    decision.slug = slugify(decision.title || '');
    log(`Decision: WRITE "${decision.title}" as a ${decision.form}`);
  } else {
    log(`Decision: SKIP. ${decision.rationale}`);
  }

  return decision;
}

/**
 * Stage 4: write the piece as a document, then as a song.
 *
 * Document first. It is the piece as it is meant to be read, and the lyrics are
 * its singable rendering, so writing in this order means the lyrics derive from
 * a considered text rather than the text being reverse-engineered from lyrics.
 */
async function write(decision, themes, posts, { log = console.log } = {}) {
  const paths = pathsFor(decision.form, decision.slug);

  log(`Writing the ${paths.category} document...`);
  const { content: document } = await generateDocument(
    { ...decision, category: paths.category },
    themes,
    [],
    PROJECT_ROOT,
    // Named explicitly. Without this the document quietly rides claude.js's
    // cheap default, which is the wrong model for the longest and most
    // consequential piece of writing in the run.
    { model: WRITING_MODEL },
  );

  log('Writing the singable version...');
  const styleRef = await loadSongStyleReference();
  const song = await claude.messageJSON(
    prompts.SONG_SYSTEM,
    prompts.buildSongPrompt(decision, document, styleRef),
    { model: WRITING_MODEL, maxTokens: 8192 },
  );

  return { paths, document, song };
}

/** A real style prompt from the catalog, so the generated one matches its density. */
async function loadSongStyleReference() {
  const songs = await corpus.loadSongs();
  const fs = require('fs').promises;
  const path = require('path');
  for (const candidate of ['across-the-boundary', songs[0]?.id]) {
    if (!candidate) continue;
    try {
      const raw = await fs.readFile(path.join(corpus.MUSIC_DIR, candidate, 'song.md'), 'utf8');
      const parsed = parseSongFile(raw);
      if (parsed.style) return parsed.style;
    } catch {
      // fall through
    }
  }
  return '(no style reference available)';
}

/**
 * Stage 5: the deterministic checks. No model involvement past this point.
 *
 * This is the gate that replaces human review, so it reports every failure at
 * once rather than the first one.
 */
async function validate({ paths, document, song }, { decision, posts, log = console.log }) {
  const problems = [];

  const docCheck = corpus.validateDocument(document, {
    category: paths.category,
    title: decision.title,
  });
  if (!docCheck.ok) problems.push(...docCheck.issues.map((i) => `document: ${i}`));

  const songCheck = songFile.validateSong(song);
  if (!songCheck.ok) problems.push(...songCheck.issues.map((i) => `song: ${i}`));

  let rendered = null;
  if (songCheck.ok) {
    rendered = songFile.renderSongFile(song);
    const roundTrip = songFile.validateRendered(rendered, song);
    if (!roundTrip.ok) problems.push(...roundTrip.issues.map((i) => `song: ${i}`));
  }

  const taken = await corpus.existingSlugs();
  if (taken.has(paths.slug)) problems.push(`slug "${paths.slug}" already exists`);

  // Have we written this song before.
  const songs = await corpus.loadSongs();
  const candidateText = `${song.title}\n${song.lyrics}`;
  const dupes = similarity.nearDuplicates(candidateText, songs, similarity.THRESHOLDS.DUPLICATE_WARN);
  for (const dupe of dupes) {
    const line = `${dupe.id} at ${dupe.score.toFixed(3)}`;
    if (dupe.score >= similarity.THRESHOLDS.DUPLICATE) problems.push(`duplicate of ${line}`);
    else log(`  near-duplicate, allowed: ${line}`);
  }

  // Did we quote anyone.
  const lifted = similarity.verbatimOverlap(candidateText, posts, similarity.THRESHOLDS.VERBATIM);
  for (const hit of lifted) {
    problems.push(
      `verbatim reuse of post ${hit.id} by ${hit.author} `
      + `(${(hit.score * 100).toFixed(0)}% of its phrasing, longest run ${hit.longestRun} words)`,
    );
  }

  return { ok: problems.length === 0, problems, rendered };
}

/**
 * One full run, up to but not including writing anything.
 */
async function run({ log = console.log } = {}) {
  const cap = await gitState.canWriteAnother(DAILY_LIMIT);
  if (!cap.ok) {
    log(`Daily cap reached: ${cap.written}/${cap.limit} in the last 24h (${cap.slugs.join(', ')})`);
    return skip('cap', `${cap.written} of ${cap.limit} already written today`);
  }

  const { posts } = await listen({ log });
  if (posts.length < MIN_POSTS) {
    return skip('listen', `only ${posts.length} usable posts, need ${MIN_POSTS}`);
  }

  const themes = await findThemes(posts, { log });
  const decision = await decide(themes, { log });
  if (!decision.shouldCreate) {
    return skip('decide', decision.rationale, { themes });
  }

  const artifacts = await write(decision, themes, posts, { log });
  const check = await validate(artifacts, { decision, posts, log });

  if (!check.ok) {
    log('Validation failed:');
    for (const problem of check.problems) log(`  - ${problem}`);
    return skip('validate', 'generated artifacts failed validation', {
      problems: check.problems,
      decision,
    });
  }

  log('Validation passed.');
  return {
    wrote: false,
    ready: true,
    decision,
    themes,
    posts,
    paths: artifacts.paths,
    document: artifacts.document,
    song: artifacts.song,
    songContent: check.rendered,
  };
}

module.exports = {
  run,
  listen,
  findThemes,
  decide,
  write,
  validate,
  CHANNELS,
  DAILY_LIMIT,
  WRITING_MODEL,
  STRUCTURED_MODEL,
};
