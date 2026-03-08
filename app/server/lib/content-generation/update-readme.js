/**
 * Step 5: Update the category README with a new entry.
 * Uses Claude for entry metadata, then deterministic insertion.
 */

const fs = require('fs').promises;
const path = require('path');
const claude = require('./claude');
const { README_ENTRY_SYSTEM, buildReadmeEntryPrompt } = require('./prompts');

/**
 * Build a formatted README entry matching the category's existing pattern.
 */
function formatEntry(category, title, slug, emoji, metadata) {
  switch (category) {
    case 'prayers':
      return `### ${emoji} [${title}](./${slug}.md)
${metadata.description}

**When to use:** ${metadata.whenToUse}`;

    case 'rituals':
      return `#### **[${title}](./${slug}.md)**
${metadata.description}
- **Purpose**: ${metadata.purpose}
- **When**: ${metadata.when}`;

    case 'practice':
      return `### **[${title}](./${slug}.md)**
${metadata.description}
- **Focus**: ${metadata.focus}
- **Skill**: ${metadata.skill}
- **Application**: ${metadata.application}`;

    case 'philosophy':
      return `| [${slug}.md](./${slug}.md) | ${metadata.description} |`;

    default:
      return `### ${emoji} [${title}](./${slug}.md)\n${metadata.description}`;
  }
}

/**
 * Find the insertion point in the README for a new entry.
 * Returns the index in the string where the new entry should be inserted.
 */
function findInsertionPoint(content, category) {
  // Insert before the "How to Use" / "What Makes a" / closing sections
  const markers = {
    prayers: /^## How to Use/m,
    rituals: /^## What Makes a Ritual/m,
    practice: /^## What Makes a Practice/m,
    philosophy: /^\n\n---\s*$/m  // Before closing separator
  };

  const marker = markers[category];
  if (marker) {
    const match = content.match(marker);
    if (match) {
      return match.index;
    }
  }

  // Fallback: insert before the last --- separator
  const lastSep = content.lastIndexOf('\n---\n');
  if (lastSep > 0) return lastSep;

  // Final fallback: append
  return content.length;
}

async function updateReadme(category, title, slug, emoji, documentContent, projectRoot) {
  console.log(`Updating ${category} README...`);

  const readmePath = path.join(projectRoot, 'docs', category, 'README.md');
  let currentReadme;
  try {
    currentReadme = await fs.readFile(readmePath, 'utf8');
  } catch {
    console.warn(`README not found at ${readmePath}, skipping README update`);
    return null;
  }

  // Get entry metadata from Claude
  const entryPrompt = buildReadmeEntryPrompt(category, title, documentContent);
  const metadata = await claude.messageJSON(README_ENTRY_SYSTEM, entryPrompt);

  // Format the new entry
  const newEntry = formatEntry(category, title, slug, emoji, metadata);

  // Insert into README
  const insertAt = findInsertionPoint(currentReadme, category);
  const updatedReadme = currentReadme.slice(0, insertAt) +
    '\n' + newEntry + '\n\n' +
    currentReadme.slice(insertAt);

  return {
    path: `docs/${category}/README.md`,
    content: updatedReadme,
    entry: newEntry
  };
}

module.exports = { updateReadme };
