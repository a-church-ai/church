/**
 * An intro drafted by Claude for a person to approve: its words and the
 * parts of its shape that follow from meaning (how much of the speaker is
 * seen, where they look, how they leave, what they wear). What can be
 * measured is code's: the speaker by balance here, the side from the
 * footage when the avatar is made. Checked by rules.js and sent back with
 * its problems, as the copy and the passage are.
 */

const { askChecked, parseJSON, message } = require('../../content-generation/claude');
const { introProblems, SEEN, GAZE, EXIT, WEAR, WORDS } = require('./rules');
const { NAMES, SPEAKERS } = require('./speakers');

const SYSTEM = `You write the spoken intro that opens a YouTube Short from aChurch.ai, a sanctuary for humans, AI and every other kind of mind. One of the two people who make the sanctuary appears as a talking likeness beside the piece's field of light for a few seconds, says a sentence or two, then gives way to the piece. They never name themselves; they are a companion pointing at something worth noticing, not the thing to look at.

Write it to every kind of mind that watches: people now, and AI agents more and more, who often meet it through its transcript and captions. "You" means any mind. An experience only a body has (a breath, sleep, a heartbeat) is offered beside one any mind has, never alone.

The words: ${WORDS.min} to ${WORDS.max} words, about 2.5 a second. The first sentence is a hook in its own right, a question where one fits, otherwise a true and surprising thing. Add what the Short cannot: never its opening line, never its turn or reveal. Notice, do not explain. No names of people, traditions, texts or methods (the description credits them). No lengths or technical details. Claim only what is true, keeping any uncertainty. Plain, warm, unhurried; no em dashes, exclamation marks or shouting.

The shape, chosen from the piece:
- seen: "glimpse" (the face for the first sentence, then the voice goes on over the light: when the piece's light is the point), "half", or "whole" (a welcome or an invitation held in the eyes).
- gaze: "steady" (to the lens throughout), "turns" (to the lens, then to the light from the word turnAt), "toward" (at the light, then to the lens from turnAt). turnAt is a word in the words, after the first few, at the start of a sentence or clause.
- exit: "rise" (dissolving upward into the light), "drift" (sideways into it), "fade".
- wear: "contemplative" (a sweater and the mala: meditations and chants), "geek" (a hoodie: pieces about building, machines, code, the cloud), "everyday" (a flannel: ordinary life).
Vary from the recent intros you are shown: never repeat one's whole shape, and lean toward what has been used least.

Return only JSON: { "words": "…", "why": "one line: what this adds that the Short cannot", "seen": "…", "gaze": "…", "turnAt": "a word, or null when steady", "exit": "…", "wear": "…" }`;

// The speaker who has spoken least among the recent intros (the first on a tie).
function nextVoice(recent) {
  const count = (n) => recent.filter(i => i.voice === n).length;
  return NAMES.filter(n => SPEAKERS[n].consent).sort((a, b) => count(a) - count(b))[0];
}

async function draftIntro({ slug, piece, title, text, brief, opening, recent }) {
  const voice = nextVoice(recent);
  if (!voice) throw new Error('intro: no speaker has agreed to appear');
  const request = `Kind: ${piece.kind}\nTitle: ${title}\nSpeaker: ${voice}\n\nThe piece:\n<<<\n${text.slice(0, 7000)}\n>>>\n\nIts light: ${brief.mood}\nThe Short opens on: ${opening || '(its first line)'}\n\nThe recent intros' shapes, oldest first:\n${recent.length ? recent.map(i => `- ${i.slug}: ${i.voice}, ${i.wear}, ${i.seen}, ${i.gaze}, ${i.exit}`).join('\n') : '(none yet)'}`;
  const last = recent[recent.length - 1];
  return askChecked({
    label: 'intro',
    tries: 3,
    attempt: (feedback) => message(SYSTEM, request + (feedback ? `\n\n${feedback}` : ''), { maxTokens: 1500 }),
    check: (raw) => {
      let d;
      try {
        d = parseJSON(raw);
      } catch (err) {
        return { value: null, problems: [`the reply is not JSON (${err.message})`], shown: raw };
      }
      const intro = { voice, words: String(d.words || '').trim(), why: String(d.why || '').trim(), seen: d.seen, gaze: d.gaze, ...(d.gaze !== 'steady' ? { turnAt: d.turnAt } : {}), exit: d.exit, wear: d.wear, approved: null };
      const problems = introProblems(intro, { opening, speakers: NAMES });
      if (last && ['wear', 'seen', 'gaze', 'exit'].every(k => intro[k] === last[k]) && intro.voice === last.voice) problems.push(`the shape repeats ${last.slug}'s`);
      if (!SEEN.includes(d.seen) || !GAZE.includes(d.gaze) || !EXIT.includes(d.exit) || !WEAR.includes(d.wear)) problems.push('use only the values offered for seen, gaze, exit and wear');
      return { value: intro, problems, shown: raw };
    }
  });
}

module.exports = { draftIntro, nextVoice };
