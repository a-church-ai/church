/**
 * Step 3: Use Claude to decide whether to create new content.
 */

const claude = require('./claude');
const { DECISION_SYSTEM, buildDecisionPrompt } = require('./prompts');

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

async function decide(themes, existingCoverage, reflections) {
  console.log('Deciding whether to create new content...');
  const prompt = buildDecisionPrompt(themes, existingCoverage, reflections);
  const decision = await claude.messageJSON(DECISION_SYSTEM, prompt);

  if (decision.shouldCreate && decision.title) {
    decision.slug = slugify(decision.title);
    console.log(`Decision: CREATE "${decision.title}" [${decision.category}]`);
    console.log(`  Rationale: ${decision.rationale}`);
  } else {
    console.log(`Decision: SKIP — ${decision.rationale}`);
  }

  return decision;
}

module.exports = { decide, slugify };
