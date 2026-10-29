/**
 * Which videos belong to which coming occasions (occasions.js): Claude reads
 * the occasions in the schedule's window and the videos to place, and pairs
 * only the true fits, each with its reason; the pairs are checked in code.
 * schedule.js then places a paired video inside its occasion. The plan is
 * video-occasions-2026-10-29.md in the private repo.
 */

const { askChecked, parseJSON, message, MODEL } = require('../content-generation/claude');

const SYSTEM = `You choose which of aChurch.ai's videos go out on which coming occasions. aChurch.ai is a sanctuary for humans, AI and any other kind of mind; each video is one of its pieces (a song, chant, prayer, ritual, practice or meditation) set to abstract light.

You are given the occasions in the coming weeks and the videos waiting to be placed. Pair a video with an occasion only where the piece truly belongs to it: its subject, its images or its spirit answer the occasion (a meditation on darkness for a new moon, a gratitude piece for a day of thanks, a piece about turning or return for a solstice, a piece about rereading or returning for a Mercury retrograde, something luminous for a meteor shower or an aurora). A loose or clever fit is worse than none: most videos will have no occasion, and that is right. Each occasion takes at most as many videos as its limit; each video at most one occasion.

Astrology is named for what astrology says, never as an effect: pair a piece with a retrograde for what that tradition reads in it, and say so in your reason.

Return only JSON:
{ "pairs": [ { "slug": "...", "occasion": "occasion id exactly as given", "why": "one sentence on what in the piece answers the occasion" } ] }`;

function request(occasions, videos) {
  return `Occasions (id | dates | what it is | limit):
${occasions.map(o => `${o.id} | ${o.from === o.to ? o.from : `${o.from} to ${o.to}`} | ${o.name}: ${o.meaning} | ${o.limit}`).join('\n')}

Videos waiting to be placed (slug | kind | title | what the piece is | what its video shows):
${videos.map(v => `${v.slug} | ${v.kind} | ${v.title} | ${v.about || ''} | ${v.mood || ''}`).join('\n')}`;
}

function check(occasions, videos) {
  const byId = new Map(occasions.map(o => [o.id, o]));
  const slugs = new Set(videos.map(v => v.slug));
  return (raw) => {
    let reply;
    try {
      reply = parseJSON(raw);
    } catch (err) {
      return { value: null, problems: [`the reply is not JSON (${err.message})`], shown: raw };
    }
    const pairs = Array.isArray(reply.pairs) ? reply.pairs : null;
    if (!pairs) return { value: null, problems: ['pairs must be a list'], shown: raw };
    const problems = [];
    const seen = new Set();
    const used = new Map();
    for (const p of pairs) {
      if (!slugs.has(p.slug)) problems.push(`"${p.slug}" is not one of the videos waiting`);
      if (!byId.has(p.occasion)) problems.push(`"${p.occasion}" is not one of the occasions, word for word`);
      if (!p.why) problems.push(`the pair for "${p.slug}" needs its reason`);
      if (seen.has(p.slug)) problems.push(`"${p.slug}" is paired twice; a video takes one occasion`);
      seen.add(p.slug);
      used.set(p.occasion, (used.get(p.occasion) || 0) + 1);
    }
    for (const [id, n] of used) if (byId.has(id) && n > byId.get(id).limit) problems.push(`"${id}" holds ${n} videos; its limit is ${byId.get(id).limit}`);
    return { value: pairs.map(p => ({ ...p, occasion: byId.get(p.occasion) })), problems, shown: raw };
  };
}

/**
 * The pairs: [{ slug, occasion, why }], occasion as occasions.js gives it.
 * videos: [{ slug, kind, title, about, mood }]. Nothing to pair is no call.
 */
async function matchOccasions(occasions, videos) {
  if (!occasions.length || !videos.length) return [];
  return askChecked({
    label: 'pairing',
    tries: 3,
    attempt: (feedback) => message(SYSTEM, request(occasions, videos) + (feedback ? `\n\n${feedback}` : ''), { model: MODEL, maxTokens: 3000 }),
    check: check(occasions, videos)
  });
}

module.exports = { matchOccasions, check };
