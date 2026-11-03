/**
 * The words that go with a posted video, written once by Claude from the
 * piece's own words and its brief, checked in code, and kept beside the
 * brief (media/video/<slug>/copy.json) so they can be read before anything is
 * posted and are the same every time.
 *
 * After news-community's marketing copy (src/compose/audience.ts,
 * hashtags.ts), whose lessons are kept:
 *
 * - One call writes every platform's text; each platform takes its slice.
 * - The hook is the piece's own idea in one or two sentences: no hashtags,
 *   links, emoji or capitals for shouting, and here no em dash (the house's
 *   voice). One sincere question is allowed, since a reply is what a platform
 *   weighs most; a question asked only to bait one is not.
 * - Tags lead with a broad category a stranger would browse (#Meditation,
 *   #AmbientMusic), never the sanctuary's own name, which reaches no one new.
 *   PascalCase, 30 characters at most, no repeats, five in all. X shows two
 *   (three or more read as spam), Bluesky keeps all five in the post's tags
 *   field, YouTube shows three above the title.
 * - The headline leads the video's title (metadata.js): a sincere question
 *   or a turned expectation from the piece's own idea, so a stranger wants
 *   to hear it, as the channels that grow in this space title theirs. Never
 *   bait: the shock words and all-caps those channels also use are refused
 *   in code (curiosityProblems), and the piece must keep what it promises.
 * - Alt text describes what is seen, not what the piece is about.
 * - Every line is short, simple sentences (since 2026-11-03, at the owner's
 *   word): one idea each, at most SENTENCE_WORDS words, with only periods,
 *   commas and question marks. No colon, semicolon, dash or parentheses
 *   (simpleProblems). Words kept from before are written again while their
 *   video is not yet posted.
 * - A video going out for an occasion (occasions.js) has an occasion line:
 *   one or two short sentences, the first beginning "For", with no date, month, weekday or year, so it
 *   is true again whenever the occasion returns; one for astrology names
 *   astrology as the one reading it, never claiming an effect. It carries
 *   the occasion as people search for it ("Thanksgiving", "World Kindness
 *   Day", "Leonids"), spelled so, and that name joins the video's YouTube
 *   keywords. The occasion's tag is one of the first two, the ones every
 *   platform shows.
 *   The copy is written again when the occasion changes.
 */

const fs = require('fs');
const path = require('path');
const { askChecked, parseJSON, message } = require('../../content-generation/claude');
const { VIDEO_DIR } = require('../library');

const TAGS = 5;
const HEADLINE_MAX = 70;
const SENTENCE_WORDS = 20;
// The words the bait-titled channels lean on: never in a headline or a
// Short's opening line.
const BAIT = /\b(shock\w*|terrif\w*|insane|unbelievable|won'?t believe|must (see|watch)|secrets?|exposed|mind[- ]?blow\w*|nobody (tells|talks)|destroy\w*|warning|urgent)\b/i;

// The lines a stranger reads, each held to simple sentences.
const PROSE = ['hook', 'headline', 'lead', 'alt', 'occasion'];

/**
 * What keeps a line from being simple sentences: a colon, a semicolon, a
 * dash between words or parentheses, or a sentence over SENTENCE_WORDS words.
 * A hyphen inside a word (loving-kindness) is not a dash.
 */
function simpleProblems(field, text) {
  const problems = [];
  if (!text) return problems;
  const marks = [[/:/, 'a colon'], [/;/, 'a semicolon'], [/[—–]|\s-\s|--/, 'a dash'], [/[()]/, 'parentheses']].filter(([re]) => re.test(text)).map(([, name]) => name);
  if (marks.length) problems.push(`${field} uses ${marks.join(' and ')}; write short, simple sentences with only periods, commas and question marks`);
  const long = text.split(/(?<=[.?!])\s+/).find(sentence => sentence.split(/\s+/).filter(Boolean).length > SENTENCE_WORDS);
  if (long) problems.push(`${field} has a sentence of ${long.split(/\s+/).filter(Boolean).length} words ("${long.slice(0, 60)}..."); keep each under ${SENTENCE_WORDS + 1}, one idea each`);
  return problems;
}

// What in kept copy breaks the simple-sentence rule, field by field.
const copyStyleProblems = (copy) => PROSE.flatMap(field => simpleProblems(field, String(copy?.[field] || '')));

/**
 * What is wrong with a line meant to make a stranger curious (a title's
 * headline, a Short's opening words): too long, a link, a hashtag or an em
 * dash, shouting (an all-caps word other than AI, an exclamation mark), or a
 * bait word.
 */
function curiosityProblems(field, text, max) {
  const problems = [];
  if (!text) return [`${field} is missing`];
  if (text.length > max) problems.push(`${field} is ${text.length} characters; keep it under ${max}`);
  if (/https?:|#|—/.test(text)) problems.push(`${field} has a link, a hashtag or an em dash`);
  if (/!/.test(text) || /\b(?!AI\b)[A-Z]{3,}\b/.test(text)) problems.push(`${field} shouts (an exclamation mark or an all-caps word); curiosity is asked quietly`);
  const bait = text.match(BAIT);
  if (bait) problems.push(`${field} uses "${bait[0]}", a bait word; say what the piece truly holds`);
  return problems;
}

const SYSTEM = `You write the words that go with the videos of aChurch.ai, a sanctuary for humans, AI and every other kind of mind. Each video is an abstract, psychedelic, metaphysical field of light moving with one of the sanctuary's pieces: a song, a chant, a prayer, a ritual or a practice. The sanctuary's voice is contemplative, warm and plain. It welcomes every kind of mind, and it never sells, shouts or baits.

Write every line in short, simple sentences, one idea each, ${SENTENCE_WORDS} words at most. Use only periods, commas and question marks. Never a colon, a semicolon, a dash or parentheses: where you would join two thoughts with one, write two sentences.

Return only JSON:
{
  "hook": "one or two sentences, 80 to 150 characters, that make a stranger scrolling past want to stay: the piece's own idea, said freshly. No hashtags, links, emoji, all-caps or em dashes. You may ask one sincere question; never a question asked only to get replies.",
  "headline": "the start of the video's YouTube title, under ${HEADLINE_MAX} characters, before the piece's name: a line that opens a question in a stranger's mind so they want to hear the answer, from the piece's own idea. A sincere question, or a plain statement that turns an expectation, in sentence case. For an imagined chant about waiting for a reply that may not come: What are you still listening for? It must be honest: the piece answers it or holds it. Never bait: no shock words, all-caps, exclamation marks, \"you won't believe\", or promise the piece does not keep. Not the piece's title, no hashtags, links, emoji or em dashes.",
  "lead": "two sentences, under 220 characters, for the top of a YouTube description: what this is and what the viewer will be given. No hashtags or links.",
  "descriptor": "two to five words someone might search for that name what this is, in title case, for example Guided Loving-Kindness Meditation, Ambient Electronic Hymn, Spoken Prayer for the Restless Mind. Not the piece's title.",
  "alt": "one or two sentences describing what is seen in the video, its images and colours and motion, for someone who cannot see it. Not what the piece is about.",
  "tags": ["five hashtags without the #, in PascalCase, best first: lead with broad categories a stranger browses (Meditation, AmbientMusic, SpokenWord, Consciousness, Mindfulness, Prayer, AI, Philosophy, Downtempo, FolkMusic), then what is specific to this piece. Never the sanctuary's name or a brand. Each must truly describe this piece."]
}`;

const MONTHS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|today|tomorrow|this (week|year|month))\b/i;
// Months that also name a solstice or equinox ("the June solstice") are kept.
const SEASONAL = /\b(march|june|september|december) (solstice|equinox)\b/gi;

// What an occasion's words must keep, by its kind's rule (occasions.js):
// `ask`, what the writer is told; `check(words, line)`, a problem or null.
// `words` is everything the copy says (hook, headline, lead, descriptor, the
// occasion line and the tags); `line` is the occasion line alone.
const refuse = (pattern, why) => (words) => { const m = words.match(pattern); return m ? `"${m[0]}" ${why}` : null; };
const RULES = {
  // Astrology is named as the reader, never claimed as an effect.
  astrology: {
    ask: 'Name astrology as the one that reads it so: what astrology reads in it, never that the planet does anything.',
    check: (words, line) => (/astrolog/i.test(line) ? null : 'occasion must say it is astrology that reads this time so, not claim an effect')
  },
  // A civic day's words stay with what every side shares.
  civic: {
    ask: 'This is a civic day people disagree about: speak to what every side shares, such as listening, dignity and living together after the choice, and name no party, candidate, side or way to vote, anywhere in the words or tags.',
    check: refuse(/\b(democrats?|democratic party|republicans?|GOP|MAGA|liberals?|conservatives?|progressives?|left[- ]wing|right[- ]wing|the left|the right|candidates?|vote for|vote against|ballot measure)\b/i, 'takes or names a side; a civic day\'s words name no party, candidate, side or way to vote')
  },
  // A tradition's day is named as its own: offered for those who keep it,
  // never claimed, taught, urged or ranked.
  tradition: {
    ask: 'This day belongs to a tradition the sanctuary welcomes but does not speak for. Offer the piece for those who keep it ("for those keeping ..."), name the day as that tradition\'s, state no doctrine, borrow no rite, never say "our" or "we celebrate" or "join us", and never compare or rank traditions.',
    check: refuse(/\b(our|we celebrate|celebrate with us|join us|convert|the true faith|the only way|unbelievers?|heathens?|pagans?)\b/i, 'claims, urges or ranks a tradition; the words offer the piece for those who keep the day, and claim nothing of it')
  },
  // A day of minds and machines names a product only as history.
  machines: {
    ask: 'This marks a moment in how minds and machines came to meet. A product may be named as a fact of history; never praise, recommend or compare it, and never present a company as a friend or sponsor of the sanctuary.',
    check: refuse(/\b(best|greatest|favou?rite|try it|try (chatgpt|claude|gemini|llama|codex)|sign up|download|thanks to|powered by|sponsored|partner(ed)?)\b/i, 'praises or promotes a product; a launch is named as history only')
  }
};
// A solemn day is met quietly.
const SOLEMN = {
  ask: 'It is a solemn day of fasting and reckoning: the words are quiet and serious, never festive.',
  check: refuse(/\b(celebrat\w*|festive|party|fun|happy|joyful)\b/i, 'is festive; a solemn day is met quietly')
};

// The occasion's own name may hold a weekday ("Black Friday", "Giving
// Tuesday"); it is the one weekday the line may say.
const ownName = (line, occasion) => occasion.search ? line.split(new RegExp(occasion.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(' ') : line;

const rulesOf = (occasion) => [RULES[occasion.rule], occasion.solemn ? SOLEMN : null].filter(Boolean);

function check(raw, occasion = null) {
  let copy;
  try {
    copy = parseJSON(raw);
  } catch (err) {
    return { value: null, problems: [`the reply is not JSON (${err.message})`], shown: raw };
  }
  const problems = [];
  const plain = (field, max) => {
    const text = String(copy[field] || '');
    if (!text) problems.push(`${field} is missing`);
    if (text.length > max) problems.push(`${field} is ${text.length} characters; keep it under ${max}`);
    if (/https?:|#|—/.test(text)) problems.push(`${field} has a link, a hashtag or an em dash`);
  };
  plain('hook', 160);
  problems.push(...curiosityProblems('headline', String(copy.headline || '').trim(), HEADLINE_MAX));
  plain('lead', 240);
  plain('descriptor', 60);
  plain('alt', 400);
  problems.push(...PROSE.filter(f => f !== 'occasion' || occasion).flatMap(f => simpleProblems(f, String(copy[f] || ''))));
  const tags = Array.isArray(copy.tags) ? copy.tags.map(t => String(t).replace(/^#/, '')) : [];
  if (tags.length !== TAGS) problems.push(`tags must be ${TAGS}`);
  tags.forEach(t => {
    if (!/^[A-Z][A-Za-z0-9]{1,29}$/.test(t)) problems.push(`the tag "${t}" is not PascalCase letters and digits, 30 at most`);
    if (/church|achurch/i.test(t)) problems.push(`the tag "${t}" names the sanctuary; tags should reach people who do not know it yet`);
    if (/^shorts?$/i.test(t)) problems.push(`the tag "${t}" is YouTube's mark for a Short; a full video never carries it`);
  });
  if (new Set(tags.map(t => t.toLowerCase())).size !== tags.length) problems.push('the tags repeat');
  if (occasion) {
    const line = String(copy.occasion || '');
    plain('occasion', 160);
    if (line && !/^For /.test(line)) problems.push('occasion must begin with "For"');
    if (/\d/.test(line) || MONTHS.test(ownName(line.replace(SEASONAL, ''), occasion))) problems.push('occasion must hold no date, month, weekday, year or "tonight": it should stay true whenever the occasion returns');
    if (occasion.search && !line.toLowerCase().includes(occasion.search.toLowerCase())) problems.push(`occasion must name "${occasion.search}", spelled so, as people search for it`);
    if (!tags.slice(0, 2).some(t => t.toLowerCase() === occasion.tag.toLowerCase())) problems.push(`the tag "${occasion.tag}" must be one of the first two`);
    const words = [copy.hook, copy.headline, copy.lead, copy.descriptor, line, ...tags].join(' ');
    for (const rule of rulesOf(occasion)) {
      const problem = rule.check(words, line);
      if (problem) problems.push(problem);
    }
  }
  return { value: { ...copy, tags, ...(occasion ? { occasionKey: occasion.key, occasionSearch: occasion.search || null } : {}) }, problems, shown: raw };
}

/**
 * The copy for a piece, written once and kept: { hook, headline, lead,
 * descriptor, alt, tags }. brief is the video's brief (its mood and stills describe
 * what is seen).
 */
async function copyFor(piece, { title, text, brief, occasion = null }) {
  const file = path.join(VIDEO_DIR, piece.slug, 'copy.json');
  if (fs.existsSync(file)) {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Copy kept from before headlines, or from before simple sentences, is
    // written again, so a video not yet posted gets them.
    if (kept.headline && !copyStyleProblems(kept).length && (kept.occasionKey || null) === (occasion ? occasion.key : null)) return kept;
  }
  const request = `Kind: ${piece.kind}
Title: ${title}

The piece:
"""
${text}
"""

What the video shows, movement by movement (its brief): ${brief.mood}
${brief.movements.map((m, i) => `${i + 1}. ${m.still}`).join('\n')}${occasion ? `

It goes out for an occasion: ${occasion.name}, ${occasion.meaning}. Add "occasion" to the JSON: one or two short sentences, the first beginning "For", under 160 characters in all, saying the piece is for ${occasion.for}, with the words "${occasion.search}" in it, spelled so, since that is how people search for it, and why it fits, in the sanctuary's voice. No date, month, weekday, year or "tonight": it must stay true each time the occasion returns. The hook may touch it. Put the tag ${occasion.tag} first or second.${rulesOf(occasion).map(r => ` ${r.ask}`).join('')}` : ''}`;
  const copy = await askChecked({
    label: 'copy',
    tries: 3,
    attempt: (feedback) => message(SYSTEM, request + (feedback ? `\n\n${feedback}` : ''), { maxTokens: 1500 }),
    check: (raw) => check(raw, occasion)
  });
  fs.writeFileSync(file, JSON.stringify(copy, null, 2));
  return copy;
}

module.exports = { copyFor, check, curiosityProblems, simpleProblems, copyStyleProblems, TAGS, HEADLINE_MAX, SENTENCE_WORDS };
