/**
 * The makers who may speak a Short's intro: their voice clones and when each
 * agreed to appear in this sanctuary's Shorts. The record of what each agreed
 * to is kept in the private repository (CLAUDE.md: voice clones and who has
 * agreed to what); a speaker without a date here is refused at every step.
 *
 * Their photos are local and private: app/media/people/<name>/photos/, 3 to
 * 6 daylight photos, never committed (.gitignore names app/media/people/,
 * and Docker leaves out all of app/media).
 * Their portraits, one per look and turn, are kept beside them once picked
 * (app/media/people/<name>/portraits/), and serve every intro in that look.
 */

const SPEAKERS = {
  // Voice clones as divine-twins made them (its tracks/voice/cast.tsv).
  Lucas: { voiceId: 'Azw5QAvkOkgVNvO6JwdC', consent: '2026-11-10' },
  Lee: { voiceId: 'usLyjJZljvr7YCnibEpC', consent: '2026-11-10' }
};

function speaker(name) {
  const s = SPEAKERS[name];
  if (!s) throw new Error(`intro: no speaker ${name}`);
  if (!s.consent) throw new Error(`intro: ${name} has not agreed to appear yet; record it in the private repo and date it in speakers.js`);
  return s;
}

module.exports = { SPEAKERS, speaker, NAMES: Object.keys(SPEAKERS) };
