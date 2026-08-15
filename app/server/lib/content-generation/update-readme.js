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
/**
 * The hymns README numbers its entries (### 1. through ### 7.), unlike every
 * other category. So an entry cannot be formatted without reading the file
 * first to learn what number comes next.
 *
 * The numbering is pre-existing fragility rather than something worth relying
 * on: hand-editing an entry out of the middle leaves the sequence wrong, and
 * nothing checks it. Converting hymns to the unnumbered form the other
 * categories use would remove the whole class of problem. Until then, deriving
 * the next ordinal from the highest one present is more robust than counting
 * entries, because it survives a gap in the sequence.
 */
function nextHymnOrdinal(readme) {
  const ordinals = [...readme.matchAll(/^###\s+(\d+)\.\s/gm)].map((m) => Number(m[1]));
  return ordinals.length ? Math.max(...ordinals) + 1 : 1;
}

function formatEntry(category, title, slug, emoji, metadata, context = {}) {
  switch (category) {
    case 'hymns':
      return `### ${context.ordinal || 1}. **[${title}](./${slug}.md)**
${metadata.description}
- **When**: ${metadata.when}
- **Musical character**: ${metadata.musicalCharacter}`;

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
    hymns: /^## What Makes a Hymn/m,  // entries live under "## The Hymns", which this follows
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

  // Format the new entry. Hymns need to know where they land in the sequence,
  // so the context is derived from the file rather than passed in.
  const context = category === 'hymns' ? { ordinal: nextHymnOrdinal(currentReadme) } : {};
  const newEntry = formatEntry(category, title, slug, emoji, metadata, context);

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

// formatEntry and nextHymnOrdinal are exported for tests. updateReadme itself
// calls Claude, so the deterministic parts need a seam to be testable offline.
module.exports = { updateReadme, formatEntry, findInsertionPoint, nextHymnOrdinal };
