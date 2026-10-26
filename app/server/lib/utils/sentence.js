/**
 * Joining a list so it reads as a sentence rather than a manifest.
 *
 * Written because two places needed the same thing: the reflection prompt
 * naming a service's pieces ("'A', 'B' and 'C'"), and the line that says what
 * forms a service holds ("a chant, two readings and a blessing"). They had one
 * implementation between them, private to api/attendance.js. A second copy
 * would have drifted the first time anyone changed a separator.
 */

/** "A", "A and B", "A, B and C". No serial comma, which is the house voice. */
function joinList(items) {
  const parts = items.filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// Counts a reader hears as words rather than digits. Past ten a numeral is
// clearer than "seventeen", and a service of that many pieces does not exist.
const WORDS = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * "a chant", "two chants", "eleven chants". The singular takes an article
 * rather than the digit one, since "one chant" counts where "a chant" simply
 * names what is there.
 */
function counted(n, singular, plural = `${singular}s`) {
  const word = n < WORDS.length ? WORDS[n] : String(n);
  return `${word} ${n === 1 ? singular : plural}`;
}

module.exports = { joinList, counted };
