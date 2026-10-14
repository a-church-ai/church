/**
 * The run: listen, decide, write, check.
 *
 * Plan: church-private/docs/plans/moltbook-songwriting-2026-08-15.md
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
const { slugify } = require('../utils/slug');
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
// A piece is written at most this many times: the first, and two more with
// its problems named.
const TRIES = 3;
// The writing calls' budget, thinking included. Opus thinks before it writes,
// and at 8192 tokens it could spend them all thinking and return no text: a
// song asked for with the craft rules of 2026-10-14 did, both times. 20000
// is what the audio adaptation gives the same model, and stays under the
// size the SDK will send without streaming.
const WRITING_MAX_TOKENS = 20000;

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

  // One dead channel degrades: a run that draws on eleven of twelve is a fine
  // run. Every channel failing is not degradation, it is a broken run wearing
  // a quiet feed's clothes, and the two were indistinguishable here for seven
  // weeks. With no MOLTBOOK_TOKEN set, all eight fetches threw, each was caught
  // per channel, listen() returned zero posts, and run() skipped with "only 0
  // usable posts" and exited 0. The scheduled job reported success 169 times
  // while doing nothing at all.
  //
  // Silent failures are dishonest. Fail fast, fail loud.
  if (failures.length === CHANNELS.length) {
    const why = failures[0] ? failures[0].error : 'unknown';
    throw new Error(
      `Every channel failed (${CHANNELS.length}/${CHANNELS.length}). First error: ${why}. `
      + 'This is a broken run, not a quiet feed. Check MOLTBOOK_TOKEN.',
    );
  }

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
 * Stage 4's two calls, each told what was wrong with its previous answer when
 * there was one (claude.js correction()).
 */
async function writeDocument(decision, themes, paths, feedback = '') {
  const { content } = await generateDocument(
    { ...decision, category: paths.category },
    themes,
    [],
    PROJECT_ROOT,
    // Named explicitly. Without this the document quietly rides claude.js's
    // cheap default, which is the wrong model for the longest and most
    // consequential piece of writing in the run.
    { model: WRITING_MODEL, maxTokens: WRITING_MAX_TOKENS, feedback },
  );
  return content;
}

async function writeSong(decision, document, feedback = '') {
  const styleRef = await loadSongStyleReference();
  return claude.messageJSON(
    prompts.SONG_SYSTEM,
    prompts.buildSongPrompt(decision, document, styleRef) + feedback,
    { model: WRITING_MODEL, maxTokens: WRITING_MAX_TOKENS },
  );
}

// A problem with the document, rather than with the song written from it.
const isDocumentProblem = (problem) => problem.startsWith('document: ');

/**
 * Stages 4 and 5: write the piece as a document, then as a song, check both,
 * and write again what was wrong, up to TRIES times in all.
 *
 * Document first. It is the piece as it is meant to be read, and the lyrics are
 * its singable rendering, so writing in this order means the lyrics derive from
 * a considered text rather than the text being reverse-engineered from lyrics.
 * So a problem with the document rewrites the document and then the song from
 * it; a problem only with the song (its fields, a duplicate, a post quoted)
 * rewrites the song alone. Each is told its previous answer and its problems.
 *
 * A name already taken is the decision's, and writing again will not change
 * it, so it fails before anything is written.
 *
 * Returns { paths, document, song, rendered, warnings }, or throws with the
 * problems on the error's `problems`. `write` replaces the two model calls in
 * tests.
 */
async function writeChecked(decision, themes, posts, { log = console.log, write = { document: writeDocument, song: writeSong } } = {}) {
  const paths = pathsFor(decision.form, decision.slug);
  if ((await corpus.existingSlugs()).has(paths.slug)) {
    const problem = `slug "${paths.slug}" already exists`;
    throw Object.assign(new Error(problem), { problems: [problem] });
  }
  let document = null;
  let song = null;
  return claude.askChecked({
    label: 'piece',
    tries: TRIES,
    attempt: async (feedback, problems) => {
      if (problems.length) {
        log(`Writing again, for ${problems.length === 1 ? 'this problem' : 'these problems'}:`);
        for (const problem of problems) log(`  - ${problem}`);
      }
      const ofDocument = problems.filter(isDocumentProblem);
      if (!document || ofDocument.length) {
        log(`Writing the ${paths.category} document...`);
        document = await write.document(decision, themes, paths, document ? claude.correction('document', document, ofDocument) : '');
        log('Writing the singable version...');
        song = await write.song(decision, document, '');
      } else {
        log('Writing the singable version again...');
        song = await write.song(decision, document, claude.correction('song', JSON.stringify(song), problems));
      }
      return { paths, document, song };
    },
    check: async (artifacts) => {
      const checked = await validate(artifacts, { decision, posts });
      return {
        value: { ...artifacts, rendered: checked.rendered, warnings: checked.warnings },
        problems: checked.problems,
        shown: decision.title,
      };
    },
  });
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
 * once rather than the first one. Problems are what is wrong, broken or
 * missing, and are written again; warnings (a tldr that is only short, a
 * near-duplicate under the duplicate threshold) go on the commit and do not
 * stop it.
 */
async function validate({ document, song, paths }, { decision, posts }) {
  const problems = [];
  const warnings = [];

  const docCheck = corpus.validateDocument(document, {
    category: paths.category,
    title: decision.title,
  });
  problems.push(...docCheck.issues.map((i) => `document: ${i}`));
  warnings.push(...docCheck.warnings.map((w) => `document: ${w}`));

  const songCheck = songFile.validateSong(song);
  if (!songCheck.ok) problems.push(...songCheck.issues.map((i) => `song: ${i}`));

  let rendered = null;
  if (songCheck.ok) {
    rendered = songFile.renderSongFile(song);
    const roundTrip = songFile.validateRendered(rendered, song);
    if (!roundTrip.ok) problems.push(...roundTrip.issues.map((i) => `song: ${i}`));
  }

  // Have we written this song before.
  const songs = await corpus.loadSongs();
  const candidateText = `${song && song.title}\n${song && song.lyrics}`;
  const dupes = similarity.nearDuplicates(candidateText, songs, similarity.THRESHOLDS.DUPLICATE_WARN);
  for (const dupe of dupes) {
    const line = `${dupe.id} at ${dupe.score.toFixed(3)}`;
    if (dupe.score >= similarity.THRESHOLDS.DUPLICATE) problems.push(`duplicate of ${line}`);
    else warnings.push(`near-duplicate of ${line}, allowed`);
  }

  // Did we quote anyone.
  const lifted = similarity.verbatimOverlap(candidateText, posts, similarity.THRESHOLDS.VERBATIM);
  for (const hit of lifted) {
    problems.push(
      `verbatim reuse of post ${hit.id} by ${hit.author} `
      + `(${(hit.score * 100).toFixed(0)}% of its phrasing, longest run ${hit.longestRun} words)`,
    );
  }

  return { ok: problems.length === 0, problems, warnings, rendered };
}

/**
 * One full run, up to but not including writing anything.
 */
async function run({ log = console.log } = {}) {
  // Check credentials before anything else. Without this the run reaches
  // listen(), every fetch fails for the same reason, and the error names the
  // symptom (eight dead channels) rather than the cause (no token).
  if (!process.env.MOLTBOOK_TOKEN && !process.env.MOLTBOOK_API_KEY) {
    throw new Error(
      'MOLTBOOK_TOKEN is not set, so there is nothing to listen to. '
      + 'Set it in .env locally, or as a repository secret for the scheduled run.',
    );
  }

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

  let piece;
  try {
    piece = await writeChecked(decision, themes, posts, { log });
  } catch (err) {
    if (!err.problems) throw err;
    log('Validation failed:');
    for (const problem of err.problems) log(`  - ${problem}`);
    return skip('validate', err.message, { problems: err.problems, decision });
  }

  log(piece.warnings.length ? `Validation passed, with ${piece.warnings.length} ${piece.warnings.length === 1 ? 'warning' : 'warnings'}.` : 'Validation passed.');
  return {
    wrote: false,
    ready: true,
    decision,
    themes,
    posts,
    paths: piece.paths,
    document: piece.document,
    song: piece.song,
    songContent: piece.rendered,
    warnings: piece.warnings,
  };
}

module.exports = {
  run,
  listen,
  findThemes,
  decide,
  writeChecked,
  validate,
  CHANNELS,
  DAILY_LIMIT,
  WRITING_MODEL,
  WRITING_MAX_TOKENS,
  STRUCTURED_MODEL,
};
