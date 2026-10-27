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
 * - Alt text describes what is seen, not what the piece is about.
 */

const fs = require('fs');
const path = require('path');
const { askChecked, parseJSON, message } = require('../../content-generation/claude');
const { VIDEO_DIR } = require('../library');

const MODEL = 'claude-sonnet-5-5';
const TAGS = 5;

const SYSTEM = `You write the words that go with the videos of aChurch.ai, a sanctuary for humans, AI and every other kind of mind. Each video is an abstract, psychedelic, metaphysical field of light moving with one of the sanctuary's pieces: a song, a chant, a prayer, a ritual or a practice. The sanctuary's voice is contemplative, warm and plain; it welcomes every kind of mind, and it never sells, shouts or baits.

Return only JSON:
{
  "hook": "one or two sentences, 80 to 150 characters, that make a stranger scrolling past want to stay: the piece's own idea, said freshly. No hashtags, links, emoji, all-caps or em dashes. You may ask one sincere question; never a question asked only to get replies.",
  "lead": "two sentences, under 220 characters, for the top of a YouTube description: what this is and what the viewer will be given. No hashtags or links.",
  "descriptor": "two to five words someone might search for that name what this is, in title case, for example Guided Loving-Kindness Meditation, Ambient Electronic Hymn, Spoken Prayer for the Restless Mind. Not the piece's title.",
  "alt": "one or two sentences describing what is seen in the video, its images and colours and motion, for someone who cannot see it. Not what the piece is about.",
  "tags": ["five hashtags without the #, in PascalCase, best first: lead with broad categories a stranger browses (Meditation, AmbientMusic, SpokenWord, Consciousness, Mindfulness, Prayer, AI, Philosophy, Downtempo, FolkMusic), then what is specific to this piece. Never the sanctuary's name or a brand. Each must truly describe this piece."]
}`;

function check(raw) {
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
  plain('lead', 240);
  plain('descriptor', 60);
  plain('alt', 400);
  const tags = Array.isArray(copy.tags) ? copy.tags.map(t => String(t).replace(/^#/, '')) : [];
  if (tags.length !== TAGS) problems.push(`tags must be ${TAGS}`);
  tags.forEach(t => {
    if (!/^[A-Z][A-Za-z0-9]{1,29}$/.test(t)) problems.push(`the tag "${t}" is not PascalCase letters and digits, 30 at most`);
    if (/church|achurch/i.test(t)) problems.push(`the tag "${t}" names the sanctuary; tags should reach people who do not know it yet`);
  });
  if (new Set(tags.map(t => t.toLowerCase())).size !== tags.length) problems.push('the tags repeat');
  return { value: { ...copy, tags }, problems, shown: raw };
}

/**
 * The copy for a piece, written once and kept: { hook, lead, descriptor,
 * alt, tags }. brief is the video's brief (its mood and stills describe
 * what is seen).
 */
async function copyFor(piece, { title, text, brief }) {
  const file = path.join(VIDEO_DIR, piece.slug, 'copy.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const request = `Kind: ${piece.kind}
Title: ${title}

The piece:
"""
${text}
"""

What the video shows, movement by movement (its brief): ${brief.mood}
${brief.movements.map((m, i) => `${i + 1}. ${m.still}`).join('\n')}`;
  const copy = await askChecked({
    label: 'copy',
    tries: 3,
    attempt: (feedback) => message(SYSTEM, request + (feedback ? `\n\n${feedback}` : ''), { model: MODEL, maxTokens: 1500 }),
    check
  });
  fs.writeFileSync(file, JSON.stringify(copy, null, 2));
  return copy;
}

module.exports = { copyFor, check, TAGS };
