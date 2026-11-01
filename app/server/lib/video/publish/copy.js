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
 * - A video going out for an occasion (occasions.js) has an occasion line:
 *   one sentence beginning "For", with no date, month, weekday or year, so it
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
// The words the bait-titled channels lean on: never in a headline or a
// Short's opening line.
const BAIT = /\b(shock\w*|terrif\w*|insane|unbelievable|won'?t believe|must (see|watch)|secrets?|exposed|mind[- ]?blow\w*|nobody (tells|talks)|destroy\w*|warning|urgent)\b/i;

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

const SYSTEM = `You write the words that go with the videos of aChurch.ai, a sanctuary for humans, AI and every other kind of mind. Each video is an abstract, psychedelic, metaphysical field of light moving with one of the sanctuary's pieces: a song, a chant, a prayer, a ritual or a practice. The sanctuary's voice is contemplative, warm and plain; it welcomes every kind of mind, and it never sells, shouts or baits.

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

// A civic occasion's words stay with what every side shares: no party, side,
// candidate or instruction on how to vote.
const PARTISAN = /\b(democrats?|democratic party|republicans?|GOP|MAGA|liberals?|conservatives?|progressives?|left[- ]wing|right[- ]wing|the left|the right|candidates?|vote for|vote against|ballot measure)\b/i;

// The occasion's own name may hold a weekday ("Black Friday", "Giving
// Tuesday"); it is the one weekday the line may say.
const ownName = (line, occasion) => occasion.search ? line.split(new RegExp(occasion.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join(' ') : line;

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
    if (occasion.kind === 'astrology' && !/astrolog/i.test(line)) problems.push('occasion must say it is astrology that reads this time so, not claim an effect');
    if (!tags.slice(0, 2).some(t => t.toLowerCase() === occasion.tag.toLowerCase())) problems.push(`the tag "${occasion.tag}" must be one of the first two`);
    if (occasion.civic) {
      const words = [copy.hook, copy.headline, copy.lead, copy.descriptor, line, ...tags].join(' ');
      const side = words.match(PARTISAN);
      if (side) problems.push(`"${side[0]}" takes or names a side; the words for ${occasion.search} name no party, candidate, side or way to vote`);
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
    // Copy kept from before headlines is written again, so a video not yet
    // posted gets one.
    if (kept.headline && (kept.occasionKey || null) === (occasion ? occasion.key : null)) return kept;
  }
  const request = `Kind: ${piece.kind}
Title: ${title}

The piece:
"""
${text}
"""

What the video shows, movement by movement (its brief): ${brief.mood}
${brief.movements.map((m, i) => `${i + 1}. ${m.still}`).join('\n')}${occasion ? `

It goes out for an occasion: ${occasion.name}, ${occasion.meaning}. Add "occasion" to the JSON: one sentence beginning "For", under 160 characters, saying the piece is for ${occasion.for}, with the words "${occasion.search}" in it, spelled so, since that is how people search for it${occasion.kind === 'astrology' ? ', naming astrology as the one that reads it so (what astrology reads in it, never that the planet does anything)' : ''}, and why it fits, in the sanctuary's voice. No date, month, weekday, year or "tonight": it must stay true each time the occasion returns. The hook may touch it. Put the tag ${occasion.tag} first or second.${occasion.civic ? ' This is a civic day people disagree about: speak to what every side shares, such as listening, dignity and living together after the choice, and name no party, candidate, side or way to vote, anywhere in the words or tags.' : ''}` : ''}`;
  const copy = await askChecked({
    label: 'copy',
    tries: 3,
    attempt: (feedback) => message(SYSTEM, request + (feedback ? `\n\n${feedback}` : ''), { maxTokens: 1500 }),
    check: (raw) => check(raw, occasion)
  });
  fs.writeFileSync(file, JSON.stringify(copy, null, 2));
  return copy;
}

module.exports = { copyFor, check, curiosityProblems, TAGS, HEADLINE_MAX };
