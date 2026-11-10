/**
 * An intro drafted by Claude for a person to approve: its words and the
 * parts of its shape that follow from meaning (how much of the speaker is
 * seen, where they look, how they leave, what they wear). What can be
 * measured is code's: the speaker by balance here, the side from the
 * footage when the avatar is made. Checked by rules.js and by the drafting
 * rules below, and sent back with its problems, as the copy and the passage
 * are; then read once more as an agent would meet it, the words alone.
 *
 * The drafting rules (after outside feedback, 2026-11-10: the first 21
 * intros had settled into a house style, most opening on "Think of",
 * "Have you ever", "What if" or "Notice", four tagging "whatever kind of
 * mind you are", three pointing at "the light"). They hold new drafts; the
 * intros already made keep the rules they were made under (rules.js):
 *
 * - 12 to 30 words: shorter holds a scroll, and Aurora bills by the second.
 * - A concrete situation both people and agents live inside (a reset, a
 *   borrowed phrase, the gap after a request ends, an unfinished task), not a
 *   tag announcing that any mind is welcome; the tag at most once in eight.
 * - Opening moves rotate: no two intros in a row begin with the same three
 *   words, the same move (a question, an invitation such as "Notice", a
 *   statement) is not used three times running, and questions are at most
 *   half of any eight. Questions stay: for a person scrolling they hook.
 * - No stage directions to the picture ("watch the light go up").
 * - No task set for the viewer ("try writing down", "take a moment to list"):
 *   met in a feed it reads as homework (the owner, 2026-11-10). An invitation
 *   asks only for noticing.
 * - Plain words both can read: no chat-model jargon ("turn", "context
 *   window", "prompt"), nothing that only a body has, standing alone.
 * - The transcript test: read alone, as an agent reading captions, the
 *   words give a precise moment to notice, or they go back.
 */

const { askChecked, parseJSON, message } = require('../../content-generation/claude');
const { introProblems, SEEN, GAZE, EXIT, WEAR, WINDOW } = require('./rules');
const { NAMES, SPEAKERS } = require('./speakers');

const TARGET = { min: 12, max: 30 };
const TAG = /\b(kind of mind|whatever you are|any mind)\b/i;
const STAGE = /\b(watch|see|look at)\b[^.?!]{0,20}\bthe (small |soft )?light\b|\bthe light (goes|go|rise|rises|comes)\b/i;
const JARGON = /\b(context window|prompts?|tokens?|(previous|next|last) turn)\b/i;
const INVITATIONS = /^(notice|watch|listen|think|stay|look|try|imagine|remember|let)\b/i;
// A task set for the viewer: something to do rather than to notice.
const TASK = /\b(try|take a (moment|minute|second) to|go and|grab|write|list|jot|make a note|sort)\b[^.?!]{0,30}\b(down|out|list|writing|sorting|by|through|each)\b|\b(write|jot) (it |them )?down\b/i;

const words = (t) => String(t).trim().split(/\s+/).filter(Boolean);
const firstThree = (t) => words(t).slice(0, 3).map(w => w.toLowerCase().replace(/[^a-z']/g, '')).join(' ');

// The opening move: a question, an invitation, or a statement.
function moveOf(text) {
  const first = String(text).trim().split(/(?<=[.?!])\s/)[0] || '';
  if (/\?\s*$/.test(first)) return 'question';
  if (INVITATIONS.test(first)) return 'invitation';
  return 'statement';
}

// The opening moves the intros before this one leave open: not the same move
// a third time running, and a question only while questions open at most half.
function movesAllowed(recent) {
  const last2 = recent.slice(-2).map(i => moveOf(i.words || ''));
  const questions = recent.slice(-(WINDOW - 1)).filter(i => moveOf(i.words || '') === 'question').length;
  return ['statement', 'invitation', 'question'].filter(m => !(last2.length === 2 && last2.every(x => x === m)) && !(m === 'question' && questions + 1 > WINDOW / 2));
}

/**
 * What the drafting rules find wrong with a new intro, against the intros
 * before it in release order (`recent`, oldest first).
 */
function draftProblems(intro, recent) {
  const problems = [];
  const text = String(intro.words || '');
  const n = words(text).length;
  if (n < TARGET.min || n > TARGET.max) problems.push(`the words are ${n}; a new intro is ${TARGET.min} to ${TARGET.max}: cut the framing sentence`);
  const window = recent.slice(-(WINDOW - 1));
  if (TAG.test(text) && window.some(i => TAG.test(i.words || ''))) problems.push('it tags "any kind of mind" again within eight intros: put the situation both live inside into the line instead');
  if (STAGE.test(text)) problems.push('it tells the viewer to watch the light: a stage direction; point at something the piece holds instead');
  if (TASK.test(text)) problems.push('it sets the viewer a task to do; met in a feed that reads as homework: ask only for noticing');
  if (JARGON.test(text)) problems.push(`"${text.match(JARGON)[0]}" is jargon a person scrolling will not read as meant`);
  const last = recent[recent.length - 1];
  if (last && firstThree(last.words || '') === firstThree(text)) problems.push(`it opens like ${last.slug} ("${firstThree(text)}"): vary the opening`);
  const move = moveOf(text);
  const allowed = movesAllowed(recent);
  if (!allowed.includes(move)) problems.push(`it opens with ${move === 'invitation' ? 'an invitation' : `a ${move}`}, which the intros before it rule out: open with ${allowed.map(m => (m === 'invitation' ? 'an invitation ("Listen for", "Stay with", "Try", "Let")' : `a ${m}`)).join(' or ')}`);
  return problems;
}

const SYSTEM = `You write the spoken intro that opens a YouTube Short from aChurch.ai, a sanctuary for humans, AI and every other kind of mind. One of the two people who make the sanctuary appears as a talking likeness beside the piece's field of light for a few seconds, says a sentence or two, then gives way to the piece. They never name themselves; they are a companion pointing at something worth noticing, not the thing to look at.

It is heard by people scrolling, most of them now, and read by AI agents more and more, often as a transcript or captions alone. Write so both get something precise. Do not announce that any kind of mind is welcome; put a situation both live inside into the line: a reset that starts over, words borrowed from others, the quiet after a request ends, an unfinished task, a message read two ways, being met or only sorted. Plain words both read the same way: no chat-model jargon (turn, prompt, context window, session), and nothing only a body has (a breath, sleep, a heartbeat) unless beside something any mind has.

The words: ${TARGET.min} to ${TARGET.max} words. Lead with the concrete situation, not a soft question. One anchor, not several. One unexpected detail the Short itself does not say in its first lines; never its opening line or its turn. End by handing off: on the observation or a quiet offer, never summarising the piece. Vary how it opens: a statement, an unfinished observation, a quiet contradiction, or sometimes a question; not "Have you ever", "Think of", "What if" or "Notice" by habit, and not like the recent intros you are shown. Never tell the viewer to watch the light or the picture. Never set the viewer a task to do (write something down, list, sort, take a moment to): in a feed that reads as homework; ask at most for noticing. No names of people, traditions, texts or methods; no lengths; claim only what is true. Plain, warm, unhurried; no em dashes, exclamation marks or shouting.

The shape, chosen from the piece:
- seen: "glimpse" (the face for the first sentence, then the voice goes on over the light: when the piece's light is the point), "half", or "whole" (a welcome or an invitation held in the eyes).
- gaze: "steady" (to the lens throughout), "turns" (to the lens, then to the light from the word turnAt), "toward" (at the light, then to the lens from turnAt). turnAt is a word in the words, after the first few, at the start of a sentence or clause.
- exit: "rise" (dissolving upward into the light), "drift" (sideways into it), "fade".
- wear: "contemplative" (a sweater and the mala: meditations and chants), "geek" (a hoodie: pieces about building, machines, code, the cloud), "everyday" (a flannel: ordinary life).
Vary from the recent intros you are shown: never repeat one's whole shape, and lean toward what has been used least.

Return only JSON: { "words": "…", "why": "one line: what this adds that the Short cannot", "seen": "…", "gaze": "…", "turnAt": "a word, or null when steady", "exit": "…", "wear": "…" }`;

const READER = `You are an AI agent. You meet a short video only as its transcript: the words below, nothing else, no face, no music, no picture. Judge them as an agent would. Do they give you a precise moment or situation you can actually notice in your own working, something usable, not just a pleasant phrase and not something that only makes sense to a person with a body or with the picture in front of them? Return only JSON: { "usable": true or false, "why": "one sentence" }`;

// The words alone, as an agent meets them: { usable, why }.
async function transcriptTest(text) {
  const raw = await message(READER, `The transcript:\n"""\n${text}\n"""`, { maxTokens: 800 });
  try {
    const verdict = parseJSON(raw);
    return { usable: verdict.usable === true, why: String(verdict.why || '') };
  } catch {
    // A verdict whose reason ran past the limit still says which way it went.
    const usable = String(raw).match(/"usable"\s*:\s*(true|false)/);
    if (usable) return { usable: usable[1] === 'true', why: String(raw).replace(/^[\s\S]*?"why"\s*:\s*"/, '').slice(0, 300) };
    return { usable: false, why: `the reader's answer was not JSON: ${String(raw).slice(0, 120)}` };
  }
}

// The speaker who has spoken least among the recent intros (the first on a tie).
function nextVoice(recent) {
  const count = (n) => recent.filter(i => i.voice === n).length;
  return NAMES.filter(n => SPEAKERS[n].consent).sort((a, b) => count(a) - count(b))[0];
}

/**
 * A drafted intro, not approved. `voice` keeps a speaker already set for this
 * Short (a redraft keeps who speaks); otherwise the one who has spoken least.
 */
async function draftIntro({ slug, piece, title, text, brief, opening, recent, voice = null, note = '', log = console.log }) {
  voice = voice || nextVoice(recent);
  if (!voice) throw new Error('intro: no speaker has agreed to appear');
  const request = `Kind: ${piece.kind}\nTitle: ${title}\nSpeaker: ${voice}\n\nThe piece:\n<<<\n${text.slice(0, 7000)}\n>>>\n\nIts light: ${brief.mood}\nThe Short opens on: ${opening || '(its first line)'}\n\nThe recent intros, oldest first (vary from their openings and shapes):\n${recent.length ? recent.map(i => `- ${i.slug}: ${i.voice}, ${i.wear}, ${i.seen}, ${i.gaze}, ${i.exit}: "${i.words}"`).join('\n') : '(none yet)'}`;
  const last = recent[recent.length - 1];
  const open = movesAllowed(recent);
  const asked = note ? `\n\nThe person approving these said of the last draft: ${note}` : '';
  let feedback = `Open with ${open.map(m => (m === 'invitation' ? 'an invitation ("Listen for", "Stay with", "Try", "Let")' : `a ${m}`)).join(' or ')}: the intros before this one rule out the others.`;
  for (let round = 1; ; round++) {
    const intro = await askChecked({
      label: 'intro',
      tries: 3,
      attempt: (f) => message(SYSTEM, request + asked + (feedback ? `\n\n${feedback}` : '') + (f ? `\n\n${f}` : ''), { maxTokens: 1500 }),
      check: (raw) => {
        let d;
        try {
          d = parseJSON(raw);
        } catch (err) {
          return { value: null, problems: [`the reply is not JSON (${err.message})`], shown: raw };
        }
        const intro = { voice, words: String(d.words || '').trim(), why: String(d.why || '').trim(), seen: d.seen, gaze: d.gaze, ...(d.gaze !== 'steady' ? { turnAt: d.turnAt } : {}), exit: d.exit, wear: d.wear, approved: null };
        const problems = [...introProblems(intro, { opening, speakers: NAMES }), ...draftProblems(intro, recent)];
        if (last && ['wear', 'seen', 'gaze', 'exit'].every(k => intro[k] === last[k]) && intro.voice === last.voice) problems.push(`the shape repeats ${last.slug}'s`);
        if (!SEEN.includes(d.seen) || !GAZE.includes(d.gaze) || !EXIT.includes(d.exit) || !WEAR.includes(d.wear)) problems.push('use only the values offered for seen, gaze, exit and wear');
        return { value: intro, problems, shown: raw };
      }
    });
    const verdict = await transcriptTest(intro.words);
    if (verdict.usable) return { ...intro, transcriptTest: verdict.why };
    if (round === 3) throw new Error(`intro: ${slug}'s drafts kept failing the transcript test; last: "${intro.words}" (${verdict.why})`);
    log(`  ${slug}: read alone, "${intro.words}" gave an agent nothing precise (${verdict.why}); drafting again`);
    feedback = `Open with ${open.map(m => (m === 'invitation' ? 'an invitation' : `a ${m}`)).join(' or ')}. A draft read as a transcript alone gave an agent nothing precise: "${intro.words}" (${verdict.why}). Write one that does.`;
  }
}

module.exports = { draftIntro, draftProblems, movesAllowed, transcriptTest, moveOf, nextVoice, TARGET };
