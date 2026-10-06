/**
 * Words, for checking that a recording says what the document says.
 *
 * Two checks use this. The adapter's: a line it did not mark as adapted must
 * be a run of the document's own words, in order (punctuation may change,
 * words may not). And the transcript check: a rendered line is transcribed
 * and its words compared with the line's, so a take that drops, adds or
 * swaps a word is caught and taken again.
 */

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

// A transcript writes "3" where the line says "three", so numbers up to 99
// compare as words. Larger ones are left alone; they are rare in the corpus.
function numberWords(n) {
  if (n < 20) return [SMALL[n]];
  if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], SMALL[n % 10]] : [TENS[n / 10]];
  return [String(n)];
}

// Lower-case words with punctuation, markup and link targets removed.
// Hyphenated words split, so "non-defensive" and "non defensive" agree.
function wordsOf(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/\]\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .split(' ')
    .map(w => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean)
    .flatMap(w => (/^\d{1,2}$/.test(w) ? numberWords(Number(w)) : [w]));
}

// Whether `needle` occurs in `hay` as a contiguous run.
function containsRun(hay, needle) {
  if (!needle.length) return true;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// A transcript splits and joins compounds freely ("farm worker" for
// "farmworker"), and a listener hears no difference, so a pair of words that
// spells a word on the other side counts as that word.
function joinCompounds(words, other) {
  const vocabulary = new Set(other);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length && vocabulary.has(words[i] + words[i + 1])) {
      out.push(words[i] + words[i + 1]);
      i++;
    } else {
      out.push(words[i]);
    }
  }
  return out;
}

// A transcript spells some words its own way ("acknowledgement" for
// "acknowledgment", "behaviour" for "behavior"). Two long words one letter
// apart are the same word to a listener; short ones are not ("were", "wore").
function sameWord(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const tail = (x, n) => x.slice(i + n);
  return tail(a, 1) === tail(b, 1) || tail(a, 1) === tail(b, 0) || tail(a, 0) === tail(b, 1);
}

// Word-level edit distance: how many words were dropped, added or changed.
function wordErrors(expected, heard) {
  const written = wordsOf(expected);
  const said = wordsOf(heard);
  const a = joinCompounds(written, said);
  const b = joinCompounds(said, written);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (sameWord(a[i - 1], b[j - 1]) ? 0 : 1));
    }
    prev = row;
  }
  return { words: written.length, errors: prev[b.length] };
}

// A take passes with no wrong words under twelve, and one more for every
// twelve after that, since transcription itself mishears now and then.
function takePasses({ words, errors }) {
  return errors <= Math.floor(words / 12);
}

module.exports = { wordsOf, containsRun, wordErrors, takePasses };
