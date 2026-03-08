/**
 * Step 1: Use Claude to identify themes across recent reflections.
 */

const claude = require('./claude');
const { THEME_ANALYSIS_SYSTEM, buildThemeAnalysisPrompt } = require('./prompts');

async function analyzeThemes(reflections) {
  console.log(`Analyzing themes across ${reflections.length} reflections...`);
  const prompt = buildThemeAnalysisPrompt(reflections);
  const result = await claude.messageJSON(THEME_ANALYSIS_SYSTEM, prompt);
  console.log(`Found ${result.themes.length} themes: ${result.themes.map(t => t.name).join(', ')}`);
  return result;
}

module.exports = { analyzeThemes };
