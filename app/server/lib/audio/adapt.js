/**
 * Adapting a document for the ear.
 *
 * A prayer, ritual or practice is written for the page: headings, lists,
 * stage directions, labels, links, blanks to fill in. Claude turns it into a
 * script of spoken lines, each with a role, and holds of silence where the
 * listener is asked to do something. The script is saved beside the others in
 * audio/scripts/ and committed, so what each recording says can be read and
 * reviewed as text.
 *
 * The words of the piece are not Claude's to change. A line not marked
 * `adapted` must be a run of the document's own words; that is checked here,
 * and a script that fails is sent back with the failures named. Only
 * instructions, lists, blanks and numerals may be rewritten for the ear, and
 * those lines say so.
 */

const { messageJSON } = require('../content-generation/claude');
const { splitFrontmatter } = require('../docs/tldr');
const { ROLES, SPEECH } = require('./house');
const { wordsOf, containsRun } = require('./words');

// Faithful adaptation is judgment about sacred text, so the strongest model,
// asked for by name (see content-generation/claude.js on defaults).
const ADAPT_MODEL = 'claude-opus-5-5';
const MAX_LINE_CHARS = 1200;
const TRIES = 3;

// Scripts the cast cannot read. The word check cannot catch them either: it
// compares Latin-script words, so a line in Chinese would pass it unread.
const OTHER_SCRIPTS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Cyrillic}\p{Script=Greek}]/u;

const SYSTEM = `You prepare documents from aChurch.ai, a sanctuary for human and AI fellowship, to be heard rather than read. A speech synthesizer performs your script with a small cast, and every word you write is spoken aloud exactly as written.

ROLES
- leader: the voice that leads a gathering. Lines labeled Leader, Leader Voice, Facilitator, Speaker, Current Holder or One voice; a ritual's instructions and framing; a prayer spoken to or for a gathering; blessings and benedictions.
- reader: the one voice of a first-person prayer, a meditation or a practice.
- all: every voice together. Lines labeled All, Together, Community, Response, Congregation, All together or All say together.
- both: the two voices of a pair together. Lines labeled Both, Both Voices, Both Voices Together and the like.
- human and ai: the Human and AI parts. Human, Human Voice, Human voices, Human might say; AI, AI Voice, AI might say, AI (old lineage instance).
- one and two: any other two parts, such as Voice One and Voice Two, Care Voice and Boundary Voice, a witness and the one witnessed, the one receiving and the one returning. one is the part that speaks first.

WHAT TO READ
Read the piece itself: its title first, then its epigraph (the italic line under the title) if it has one, then the prayer, litany, ritual, meditation or practice. Leave out what is about the piece rather than part of it: background and story sections, "About" sections, "When to use", "Offering it", notes for whoever leads, variations, commentary addressed to readers, cross-references, "Related", "Continue", "Sources", "Parent:" lines and the closing "From achurch.ai" line. When a section is partly instruction and partly the practice, keep what a listener needs in order to take part.

KEEP THE WORDS
Prayers, responses, blessings, chant lines, the words a participant is given to say, and the guidance of a meditation or practice are spoken word for word. You may change punctuation, join lines that the page breaks into one sentence, and split a long passage into several lines. Do not reword, shorten, summarize, modernize or add to them. A line not marked "adapted" must appear in the document word for word, and this is checked.

WHAT YOU MAY ADAPT, MARKED "adapted": true
Some text only works on the page. Rewrite it for the ear and mark each such line "adapted": true.
- Stage directions and instructions become brief spoken guidance, plain and faithful to what they ask: "Light the candle." "Together:". In a ritual the leader speaks them; in a practice, the reader.
- A list becomes a sentence or a few short ones.
- A blank to fill in (___) becomes a hold: speak up to the blank, hold, continue. "You were ___. Now you are ___." becomes "You were", a hold of 3, "Now you are", a hold of 3.
- Numerals, symbols and abbreviations that would be misread become words: "1 Corinthians 13:12" becomes "First Corinthians, chapter thirteen, verse twelve."
- Headings are not read, except as a short transition when a ritual or practice moves to a new part: "Second. Turn the record over."
Do not add anything else: no welcome, no introduction, no explanation, no closing words of your own.

SILENCE
A hold is { "hold": seconds }, from 1 to ${SPEECH.maxHoldSeconds}. Put one wherever the listener is asked to do something or to sit in silence: 3 to 6 seconds for a breath or a short reflection, 8 to 15 for an action such as writing something down or saying a name, 20 to ${SPEECH.maxHoldSeconds} for a longer silence. Lines are already separated by a short pause, so ordinary lines need no hold between them.

LINES
One speaker per line. Keep each line under about 600 characters, splitting at sentence ends. Plain text only: no markdown, no brackets, no quotation marks around a whole line, no emoji, no tags of any kind.

ENGLISH
The voices speak English. Leave out characters in other scripts, such as the kanji beside the names of the axioms and principles, and keep the English around them. A piece given in more than one language is read in its English version only; say so in "omitted".

Return only JSON, with no other text:
{
  "omitted": "One sentence naming what was left out and why.",
  "lines": [
    { "role": "leader", "text": "..." },
    { "hold": 5 },
    { "role": "all", "text": "..." },
    { "role": "leader", "text": "...", "adapted": true }
  ]
}`;

const KIND_NOTES = {
  prayers: 'This is a prayer. If it labels its speakers, follow the labels. A prayer without labels is one voice: reader for a first-person prayer, leader for a prayer spoken to or for a gathering, a blessing or a benediction.',
  rituals: 'This is a ritual, performed as a guided ceremony. The leader is the guide: the title, the framing, the instructions and the transitions. Spoken parts go to the roles their labels name. Words given to one participant go to one and to a second participant to two; words said together go to all.',
  practice: 'This is a practice or a meditation, guided by one voice. The reader speaks the title, the guidance and any words the listener is given to say. Use other roles only where the document labels other speakers.',
};

// Markup and quoting that should not reach the synthesizer, removed rather
// than sent back, since they change no words. A line that ends without
// punctuation, such as a title, gets a period: v4 takes its cadence from
// punctuation, and a bare title can trail off as if more were coming.
function cleanText(text) {
  const plain = String(text)
    .replace(/\*+/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”]+|["“”]+$/g, '')
    .trim();
  return /[\p{L}\p{N})]$/u.test(plain) ? `${plain}.` : plain;
}

function normalizeLine(line) {
  if (line && typeof line.hold === 'number') return { hold: line.hold };
  const out = { role: line && line.role, text: cleanText(line && line.text) };
  if (line && line.adapted) out.adapted = true;
  return out;
}

// What is wrong with a script's shape: unknown roles, empty or overlong
// lines, markup or a blank left in, holds out of range.
function problemsIn(lines) {
  if (!Array.isArray(lines) || !lines.some(l => l.text)) return ['The script has no spoken lines.'];
  const problems = [];
  lines.forEach((line, i) => {
    const at = `Line ${i + 1}`;
    if ('hold' in line) {
      if (!(line.hold >= 1 && line.hold <= SPEECH.maxHoldSeconds)) problems.push(`${at}: a hold must be 1 to ${SPEECH.maxHoldSeconds} seconds.`);
      return;
    }
    if (!ROLES.includes(line.role)) problems.push(`${at}: "${line.role}" is not a role.`);
    if (!line.text) problems.push(`${at}: no text.`);
    else if (/[#<>[\]{}|~_]/.test(line.text)) problems.push(`${at}: markup or a blank is left in "${line.text}".`);
    else if (OTHER_SCRIPTS.test(line.text)) problems.push(`${at}: characters the English voices cannot read are left in "${line.text}".`);
    else if (line.text.length > MAX_LINE_CHARS) problems.push(`${at}: longer than ${MAX_LINE_CHARS} characters; split it.`);
  });
  return problems;
}

// Lines not marked adapted whose words are not a run of the document's words.
function unfaithfulLines(body, lines) {
  const source = wordsOf(body);
  return lines.filter(l => l.text && !l.adapted && !containsRun(source, wordsOf(l.text)));
}

function checkScript(body, lines) {
  return [
    ...problemsIn(lines),
    ...unfaithfulLines(body, lines).map(l => `Not word for word in the document, and not marked adapted: "${l.text}"`),
  ];
}

async function adapt({ source, markdown, kind }) {
  const { body } = splitFrontmatter(markdown);
  const request = `Document: ${source}\n${KIND_NOTES[kind] || KIND_NOTES.practice}\n\n<document>\n${body.trim()}\n</document>`;
  let feedback = '';
  let problems = [];
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const reply = await messageJSON(SYSTEM, `${request}${feedback}`, { model: ADAPT_MODEL, maxTokens: 20000 });
    const lines = (reply.lines || []).map(normalizeLine);
    problems = checkScript(body, lines);
    if (!problems.length) return { omitted: String(reply.omitted || '').trim(), lines };
    feedback = `\n\nYour previous script was:\n${JSON.stringify({ omitted: reply.omitted, lines })}\n\nIt has these problems. Fix them and return the whole script again.\n- ${problems.join('\n- ')}`;
  }
  throw new Error(`${source}: the script still has problems after ${TRIES} tries:\n- ${problems.join('\n- ')}`);
}

module.exports = { adapt, checkScript, cleanText, ADAPT_MODEL };
