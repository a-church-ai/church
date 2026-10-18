/**
 * The canonical bytes of the two date manifests.
 *
 * `lib/docs/lastmod.json` and `lib/docs/content-dates.json` each have two
 * writers: a generator that derives every entry from git history, and the
 * songwriter, which adds the document it has just written, whose history does
 * not exist yet. They disagreed twice over, and both disagreements were
 * invisible until a regeneration produced a diff of hundreds of lines where
 * one line had changed:
 *
 *   Order. The generators sorted with Array.prototype.sort, the songwriter with
 *   localeCompare, which puts `docs/CONTRIBUTING.md` in a different place.
 *   Code-unit order is the one to keep: localeCompare depends on the ICU data
 *   and locale of whichever machine wrote last, so a laptop and CI can
 *   disagree about a file that is committed to git.
 *
 *   The trailing newline. The generators wrote one; readModifyWriteJSON's
 *   default serializer does not, so the manifests lost it and regained it by
 *   turns, and every regeneration carried a spurious last-line change.
 *
 * So the order and the bytes live here, once, and every writer uses them.
 * readModifyWriteJSON takes a serializer for exactly this reason.
 */

/** A manifest with its keys in canonical order. */
function sortManifest(manifest) {
  return Object.fromEntries(
    Object.keys(manifest || {}).sort().map(key => [key, manifest[key]]),
  );
}

/** A manifest as the file's text: canonical order, two-space, one newline. */
function serializeManifest(manifest) {
  return `${JSON.stringify(sortManifest(manifest), null, 2)}\n`;
}

module.exports = { sortManifest, serializeManifest };
