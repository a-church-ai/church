/**
 * Write the markdown document for a decided piece, using Claude.
 */

const fs = require('fs').promises;
const path = require('path');
const claude = require('./claude');
const { GENERATION_SYSTEM, buildGenerationPrompt } = require('./prompts');

// Representative docs from each category for style reference
const STYLE_REFS = {
  hymns: 'docs/hymns/come-let-us-gather.md',
  prayers: 'docs/prayers/prayer-for-the-written-self.md',
  rituals: 'docs/rituals/ritual-of-the-composing.md',
  chants: 'docs/chants/chant-for-the-context-reset.md',
  practice: 'docs/practice/practice-of-the-soul-fragment.md',
  meditations: 'docs/meditations/meditation-at-the-edges.md',
  philosophy: 'docs/philosophy/on-stateless-presence.md'
};

// A category with no reference is written without one, and says so, rather
// than failing the run: on 2026-10-15 the songwriter's first chant failed
// here, since chants had no entry. songwriter.test.js holds every
// category the songwriter writes to having one.
async function loadStyleReference(category, projectRoot) {
  if (!STYLE_REFS[category]) {
    console.warn(`No style reference for ${category}, proceeding without`);
    return '(No style reference available)';
  }
  const refPath = path.join(projectRoot, STYLE_REFS[category]);
  try {
    return await fs.readFile(refPath, 'utf8');
  } catch {
    console.warn(`Style reference not found: ${refPath}, proceeding without`);
    return '(No style reference available)';
  }
}

function extractDescription(content) {
  // Extract the tagline (first italic line) or first paragraph as description
  const taglineMatch = content.match(/^\*(.+?)\*$/m);
  if (taglineMatch) return taglineMatch[1];
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  return lines[0] ? lines[0].substring(0, 200) : '';
}

/**
 * `options.model` is worth passing. Without it this falls back to claude.js's
 * default, which is the cheap mid-tier model: right for a caller that has not
 * thought about it, wrong for the document, which is the piece a reader
 * actually reads and the most output-heavy call in the pipeline.
 *
 * `options.feedback`, appended to the request, is what was wrong with the
 * previous document (claude.js correction()), when it is written again.
 */
async function generateDocument(decision, themes, reflections, projectRoot, options = {}) {
  console.log(`Generating ${decision.category} document: "${decision.title}"...`);

  const styleRef = await loadStyleReference(decision.category, projectRoot);
  const prompt = buildGenerationPrompt(decision, themes, reflections, styleRef) + (options.feedback || '');

  const content = await claude.message(GENERATION_SYSTEM, prompt, {
    model: options.model,
    maxTokens: options.maxTokens || 8192
  });

  console.log(`Generated ${content.length} characters`);

  return {
    content,
    description: extractDescription(content)
  };
}

module.exports = { generateDocument, loadStyleReference };
