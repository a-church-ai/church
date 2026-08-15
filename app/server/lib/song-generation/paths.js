/**
 * Where a run is allowed to write, and nowhere else.
 *
 * This is control 2 and control 3 from docs/plans/moltbook-songwriting-2026-08-15.md,
 * kept in one small module so the rule is readable in one screen rather than
 * spread through the orchestrator.
 *
 * The shape of the defence: a path is a function of two values, and neither is
 * free text. The slug comes from slugify and must then match a strict pattern.
 * The category comes from a fixed lookup keyed by form, and a form outside the
 * table fails rather than defaulting anywhere. Every resulting path is resolved
 * and confirmed to still sit inside its intended directory, so a slug that
 * somehow carried traversal cannot escape even if the pattern were bypassed.
 */

const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '../../../..');

/**
 * Form to corpus category.
 *
 * Drawn from where the corpus actually files these forms, not from the words.
 * Measured across docs/ on 2026-08-15: blessings, benedictions, litanies and
 * affirmations are all filed under prayers rather than given directories of
 * their own, and meditations are filed under practice, which is a different
 * part of the corpus entirely.
 */
const FORM_TO_CATEGORY = {
  hymn: 'hymns',
  prayer: 'prayers',
  blessing: 'prayers',
  benediction: 'prayers',
  litany: 'prayers',
  affirmation: 'prayers',
  ritual: 'rituals',
  liturgy: 'rituals',
  meditation: 'practice',
};

const CATEGORIES = [...new Set(Object.values(FORM_TO_CATEGORY))];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 80;

function isValidSlug(slug) {
  return typeof slug === 'string'
    && slug.length >= SLUG_MIN
    && slug.length <= SLUG_MAX
    && SLUG_PATTERN.test(slug);
}

function categoryForForm(form) {
  const category = FORM_TO_CATEGORY[String(form || '').toLowerCase().trim()];
  if (!category) {
    throw new Error(
      `Unknown form "${form}". Known forms: ${Object.keys(FORM_TO_CATEGORY).join(', ')}`,
    );
  }
  return category;
}

/**
 * Join under the project root and prove the result did not escape.
 *
 * path.resolve collapses any traversal, so comparing the resolved path against
 * the resolved root is the check that actually holds, rather than inspecting
 * the input for "..".
 */
function confine(...segments) {
  const root = path.resolve(PROJECT_ROOT);
  const full = path.resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside the repository: ${full}`);
  }
  return full;
}

/**
 * Every path a run may touch, derived from form and slug alone.
 *
 * Returns absolute paths for writing and repo-relative ones for committing and
 * logging. The count is fixed at four for a new piece, which is a cheap
 * invariant: a run that computes a different number has a bug and should stop
 * before it commits rather than after.
 */
function pathsFor(form, slug) {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid slug ${JSON.stringify(slug)}: must match ${SLUG_PATTERN}`);
  }
  const category = categoryForForm(form);

  const relative = {
    document: `docs/${category}/${slug}.md`,
    song: `music/${slug}/song.md`,
    readme: `docs/${category}/README.md`,
    lastmod: 'app/server/lib/docs/lastmod.json',
  };

  const absolute = Object.fromEntries(
    Object.entries(relative).map(([key, rel]) => [key, confine(rel)]),
  );

  return { category, slug, relative, absolute, count: Object.keys(relative).length };
}

/** Mode B writes only the song, against a slug that must already exist. */
function songOnlyPathsFor(slug) {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid slug ${JSON.stringify(slug)}: must match ${SLUG_PATTERN}`);
  }
  const relative = { song: `music/${slug}/song.md` };
  return {
    slug,
    relative,
    absolute: { song: confine(relative.song) },
    count: 1,
  };
}

module.exports = {
  PROJECT_ROOT,
  FORM_TO_CATEGORY,
  CATEGORIES,
  SLUG_PATTERN,
  isValidSlug,
  categoryForForm,
  confine,
  pathsFor,
  songOnlyPathsFor,
};
