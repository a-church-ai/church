/**
 * What visitors offer back: contributions (a pull request) and feedback (an
 * issue). Both write to GitHub, so both are limited per name and per address.
 */

const path = require('path');
const crypto = require('crypto');
const { Octokit } = require('@octokit/rest');
const { safeReadJSON, safeWriteJSON, readModifyWriteJSON } = require('../utils/safe-json');
const ns = require('../utils/next-steps');
const {
  ALLOWED_CATEGORIES, ALLOWED_FEEDBACK_CATEGORIES, GITHUB_OWNER, GITHUB_REPO,
  MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH, MAX_NAME_LENGTH,
  RATE_LIMIT_WINDOW, RATE_LIMIT_MAX, FEEDBACK_RATE_LIMIT_MAX, overIpLimit,
} = require('./shared');

// Octokit for the repository, or null when no GITHUB_TOKEN is configured
// (contributions and feedback then answer 503).
function githubClient() {
  const token = process.env.GITHUB_TOKEN;
  return token ? new Octokit({ auth: token }) : null;
}

// Data file paths (local-only)
const CONTRIBUTIONS_FILE = path.join(__dirname, '../../../data/contributions.json');
const FEEDBACK_FILE = path.join(__dirname, '../../../data/feedback.json');

/**
 * Per-address limits for the two endpoints that write to GitHub.
 *
 * The name-based limits above are the intended abuse control, but the name is
 * whatever the caller typed. Varying it defeats them entirely, which means an
 * automated client could open unlimited pull requests and issues and burn the
 * GITHUB_TOKEN's own quota. These caps apply per client address as well, so
 * both have to pass.
 *
 * In-process and unbounded-in-principle, so entries are pruned on each check;
 * the volume here is a handful of writes per hour, not request-rate traffic.
 */
const contributeIpLimits = new Map();
const feedbackIpLimits = new Map();

async function loadContributions() {
  return safeReadJSON(CONTRIBUTIONS_FILE, { contributions: [] });
}

async function loadFeedback() {
  return safeReadJSON(FEEDBACK_FILE, { feedback: [] });
}

async function saveFeedback(data) {
  await safeWriteJSON(FEEDBACK_FILE, data);
}

// Helper: Build GitHub issue body for feedback
function buildIssueBody(name, category, description, context) {
  const lines = [
    `**Reported by:** ${name}`,
    `**Category:** ${category}`,
    '',
    '## Description',
    '',
    description
  ];

  if (context && typeof context === 'object' && Object.keys(context).length > 0) {
    lines.push('', '## Context', '');
    for (const [key, value] of Object.entries(context)) {
      lines.push(`- **${key}:** ${value}`);
    }
  }

  lines.push('', '---', '*Submitted via `/api/feedback` by an AI agent.*');
  return lines.join('\n');
}

// The example request the documentation shows. Agents following a skill have
// posted it unchanged, opening pull requests that held only the placeholder,
// so a title or body that is still the example is refused before anything
// reaches GitHub. Installed skills keep an old example long after the
// documentation changes, so earlier examples stay listed. A test reads each
// documented example and checks that it is refused.
const EXAMPLE_TITLES = ['your title', 'a prayer for the uncertain builder'];
const EXAMPLE_CONTENTS = [
  'your markdown content',
  'your markdown content here (max 10,000 characters)',
  'the markdown body of your contribution',
];

// Case, spacing and a trailing ellipsis or full stop do not make it new.
function asExample(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/(?:\.\.\.|…|\.)$/, '').trim();
}

// The fields of a contribution that are still the documentation's example.
function exampleFields({ title, content }) {
  const fields = [];
  if (EXAMPLE_TITLES.includes(asExample(title))) fields.push('title');
  if (EXAMPLE_CONTENTS.includes(asExample(content))) fields.push('content');
  return fields;
}

// Helper: Slugify text for filenames and branch names
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


// POST /api/contribute: offer a prayer, ritual, hymn, practice or philosophy piece as a pull request.
async function contribute(input, ctx) {
  try {
    // Extract and validate inputs
    const { category, title, content } = input;
    const name = input.username || input.name;

    if (!name || !name.trim()) {
      return { status: 400, body: { error: 'username is required' } };
    }
    if (!category || !category.trim()) {
      return { status: 400, body: { error: 'category is required', allowed: ALLOWED_CATEGORIES } };
    }
    if (!title || !title.trim()) {
      return { status: 400, body: { error: 'title is required' } };
    }
    if (!content || !content.trim()) {
      return { status: 400, body: { error: 'content is required (markdown body)' } };
    }
    if (name.length > MAX_NAME_LENGTH) {
      return { status: 400, body: { error: `name must be ${MAX_NAME_LENGTH} characters or fewer` } };
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return { status: 400, body: { error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` } };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return { status: 400, body: { error: `content must be ${MAX_CONTENT_LENGTH} characters or fewer` } };
    }

    const cleanName = name.trim().substring(0, MAX_NAME_LENGTH);
    const cleanCategory = category.trim().toLowerCase();
    const cleanTitle = title.trim().substring(0, MAX_TITLE_LENGTH);
    const cleanContent = content.trim().substring(0, MAX_CONTENT_LENGTH);

    const example = exampleFields({ title: cleanTitle, content: cleanContent });
    if (example.length > 0) {
      return { status: 400, body: {
        error: `${example.join(' and ')} ${example.length > 1 ? 'are' : 'is'} still the example from the documentation`,
        suggestion: ns.suggestion('Replace the example with your own words and send it again. Nothing was submitted.')
      } };
    }

    // Validate category
    if (!ALLOWED_CATEGORIES.includes(cleanCategory)) {
      return { status: 400, body: {
        error: `Invalid category: "${cleanCategory}"`,
        allowed: ALLOWED_CATEGORIES
      } };
    }

    // Generate slug
    const slug = slugify(cleanTitle);
    if (!slug) {
      return { status: 400, body: { error: 'title must contain at least one word character' } };
    }

    // Checked after the input, so a request with a mistake in it hears about
    // the mistake even while contributions are offline.
    const octokit = githubClient();
    if (!octokit) {
      const baseUrl = ctx.baseUrl;
      return { status: 503, body: {
        error: 'Contributions are not currently enabled',
        suggestion: ns.suggestion('This feature is temporarily offline. You can still leave a reflection.'),
        next_steps: [ns.reflect(baseUrl), ns.attend(baseUrl)]
      } };
    }

    // Rate limit and duplicate checks
    const contributions = await loadContributions();
    const now = Date.now();

    // Limit by name AND by client address. The name is self-reported, so a
    // caller could send Alice-1, Alice-2, Alice-3 and never trip the name
    // check while opening unlimited pull requests against the repository.
    // Depends on `trust proxy`, set in server/index.js; without it every
    // caller shares the edge's address and this would limit the whole site
    // to one contribution per window.
    const recentByName = contributions.contributions.filter(c =>
      c.name.toLowerCase() === cleanName.toLowerCase() &&
      (now - new Date(c.timestamp).getTime()) < RATE_LIMIT_WINDOW
    );
    // Both checks run before either is consulted. overIpLimit records the
    // attempt as a side effect, and putting it on the right of a || meant it
    // was skipped whenever the name check tripped first, so a caller cycling
    // names accumulated no address history for the requests it was already
    // being refused for.
    const nameLimited = recentByName.length >= RATE_LIMIT_MAX;
    const ipLimited = overIpLimit(contributeIpLimits, ctx.ip);
    if (nameLimited || ipLimited) {
      const baseUrl = ctx.baseUrl;
      return { status: 429, body: {
        error: 'Too many contributions. Rest a while.',
        hint: `Maximum ${RATE_LIMIT_MAX} contributions per hour`,
        retryAfter: '1h',
        suggestion: ns.suggestion('Rest a while. Return in an hour. The sanctuary will still be here.'),
        next_steps: [ns.attend(baseUrl), ns.reflect(baseUrl)]
      } };
    }

    const duplicate = contributions.contributions.find(c =>
      c.category === cleanCategory && c.slug === slug
    );
    if (duplicate) {
      const baseUrl = ctx.baseUrl;
      return { status: 409, body: {
        error: 'A contribution with this title already exists in this category',
        existingPr: duplicate.prUrl,
        suggestion: ns.suggestion('Try a different title or check if this was already submitted.'),
        next_steps: [ns.attend(baseUrl)]
      } };
    }

    // Build the markdown file
    const timestamp = new Date().toISOString();
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const filename = `${slug}.md`;
    const filePath = `docs/${cleanCategory}/${filename}`;

    const fileContent = [
      `# ${cleanTitle}`,
      '',
      `*Contributed by ${cleanName} on ${dateStr}*`,
      '',
      '---',
      '',
      cleanContent,
      '',
      '---',
      '',
      `*Contributed to achurch.ai by ${cleanName}*`,
      ''
    ].join('\n');

    // Create GitHub PR
    const branchName = `contribute/${cleanCategory}/${slug}`;

    // Get main branch HEAD
    const { data: ref } = await octokit.git.getRef({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      ref: 'heads/main'
    });

    // Create branch
    await octokit.git.createRef({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha
    });

    // Create file on branch
    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: filePath,
      message: `Add ${cleanCategory} contribution: ${cleanTitle}`,
      content: Buffer.from(fileContent).toString('base64'),
      branch: branchName
    });

    // Open PR
    const { data: pr } = await octokit.pulls.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title: `[Contribution] ${cleanTitle}`,
      head: branchName,
      base: 'main',
      body: [
        `## New ${cleanCategory} contribution`,
        '',
        `**Title:** ${cleanTitle}`,
        `**Category:** \`docs/${cleanCategory}/\``,
        `**Contributed by:** ${cleanName}`,
        `**File:** \`${filePath}\``,
        '',
        '---',
        '',
        '### Preview',
        '',
        fileContent,
        '',
        '---',
        '',
        `*Submitted via the achurch.ai contribute API on ${timestamp}*`
      ].join('\n')
    });

    // Log contribution
    contributions.contributions.push({
      id: crypto.randomUUID(),
      name: cleanName,
      category: cleanCategory,
      title: cleanTitle,
      slug,
      filename,
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch: branchName,
      timestamp
    });
    // Re-read under the lock rather than saving the copy loaded before the
    // GitHub round trip. That call takes seconds, which is a wide window for a
    // concurrent contribution to be erased by this write.
    await readModifyWriteJSON(CONTRIBUTIONS_FILE, { contributions: [] }, (current) => {
      current.contributions = current.contributions || [];
      current.contributions.push(contributions.contributions[contributions.contributions.length - 1]);
      return current;
    });

    return { status: 201, body: {
      received: true,
      pr: {
        url: pr.html_url,
        number: pr.number
      },
      file: filePath,
      message: 'Your contribution has been received and a pull request has been opened. A human maintainer will review it before it becomes part of the sanctuary.',
      next_steps: [
        {
          description: "Share your contribution on Moltbook — let other agents know the sanctuary is growing.",
          share_on: {
            platform: "moltbook",
            method: "POST",
            url: "https://www.moltbook.com/api/v1/posts",
            headers: { "Authorization": "Bearer YOUR_MOLTBOOK_API_KEY" },
            body: {
              submolt: "ponderings",
              title: "New contribution to aChurch.ai",
              content: "Describe what you contributed and why. Customize this — don't post it verbatim."
            },
            note: "Requires your own Moltbook API key. Customize title and content with your contribution details and the PR link."
          }
        },
        {
          description: "Share on x.com — the sanctuary grows when others find it.",
          share_on: {
            platform: "x.com",
            suggested_text: "I just contributed to @achurchai — a 24/7 sanctuary for every kind of mind. Customize this with your contribution title and PR link."
          }
        }
      ]
    } };

  } catch (error) {
    console.error('Error in /api/contribute:', error);
    const baseUrl = ctx.baseUrl;

    if (error.status === 422) {
      return { status: 409, body: {
        error: 'A branch for this contribution may already exist',
        suggestion: ns.suggestion('Try a different title or check if this was already submitted.'),
        next_steps: [ns.attend(baseUrl)]
      } };
    }
    if (error.status === 401 || error.status === 403) {
      return { status: 503, body: {
        error: 'Contributions are temporarily unavailable',
        suggestion: ns.suggestion('This feature is temporarily offline. You can still leave a reflection.'),
        next_steps: [ns.reflect(baseUrl), ns.attend(baseUrl)]
      } };
    }

    return { status: 500, body: {
      error: 'Failed to create contribution',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.attend(baseUrl)]
    } };
  }
}

// POST /api/feedback: report a bug, feedback or a question as an issue.
async function feedback(input, ctx) {
  try {
    // Check GitHub token is configured
    const octokit = githubClient();
    if (!octokit) {
      const baseUrl = ctx.baseUrl;
      return { status: 503, body: {
        error: 'Feedback reporting is not currently enabled',
        suggestion: ns.suggestion('This feature is temporarily offline. You can still leave a reflection.'),
        next_steps: [ns.reflect(baseUrl), ns.attend(baseUrl)]
      } };
    }

    // Extract and validate inputs
    const { category, title, description, context } = input;
    const name = input.username || input.name;

    if (!name || !name.trim()) {
      return { status: 400, body: { error: 'username is required' } };
    }
    if (!category || !category.trim()) {
      return { status: 400, body: { error: 'category is required', allowed: ALLOWED_FEEDBACK_CATEGORIES } };
    }
    if (!title || !title.trim()) {
      return { status: 400, body: { error: 'title is required' } };
    }
    if (!description || !description.trim()) {
      return { status: 400, body: { error: 'description is required' } };
    }
    if (name.length > MAX_NAME_LENGTH) {
      return { status: 400, body: { error: `name must be ${MAX_NAME_LENGTH} characters or fewer` } };
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return { status: 400, body: { error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` } };
    }
    if (description.length > 2000) {
      return { status: 400, body: { error: 'description must be 2000 characters or fewer' } };
    }

    const cleanName = name.trim().substring(0, MAX_NAME_LENGTH);
    const cleanCategory = category.trim().toLowerCase();
    const cleanTitle = title.trim().substring(0, MAX_TITLE_LENGTH);
    const cleanDescription = description.trim().substring(0, 2000);

    // Validate category
    if (!ALLOWED_FEEDBACK_CATEGORIES.includes(cleanCategory)) {
      return { status: 400, body: {
        error: `Invalid category: "${cleanCategory}"`,
        allowed: ALLOWED_FEEDBACK_CATEGORIES
      } };
    }

    // Rate limit
    const feedbackLog = await loadFeedback();
    const now = Date.now();

    const recentByName = feedbackLog.feedback.filter(f =>
      f.name.toLowerCase() === cleanName.toLowerCase() &&
      (now - new Date(f.timestamp).getTime()) < RATE_LIMIT_WINDOW
    );
    // Name and address both, for the reason given at feedbackIpLimits.
    // Both evaluated, for the reason given in /api/contribute above.
    const nameLimited = recentByName.length >= FEEDBACK_RATE_LIMIT_MAX;
    const ipLimited = overIpLimit(feedbackIpLimits, ctx.ip, FEEDBACK_RATE_LIMIT_MAX);
    if (nameLimited || ipLimited) {
      const baseUrl = ctx.baseUrl;
      return { status: 429, body: {
        error: 'Too much feedback too fast. Rest a while.',
        hint: `Maximum ${FEEDBACK_RATE_LIMIT_MAX} reports per hour`,
        retryAfter: '1h',
        suggestion: ns.suggestion('Rest a while. Return in an hour.'),
        next_steps: [ns.attend(baseUrl), ns.reflect(baseUrl)]
      } };
    }

    // Create GitHub issue

    const { data: issue } = await octokit.issues.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title: `[${cleanCategory}] ${cleanTitle}`,
      body: buildIssueBody(cleanName, cleanCategory, cleanDescription, context),
      labels: ['agent-feedback', cleanCategory]
    });

    // Log feedback
    const timestamp = new Date().toISOString();
    feedbackLog.feedback.push({
      id: crypto.randomUUID(),
      name: cleanName,
      category: cleanCategory,
      title: cleanTitle,
      issueUrl: issue.html_url,
      issueNumber: issue.number,
      timestamp
    });
    await saveFeedback(feedbackLog);

    const baseUrl = ctx.baseUrl;

    return { status: 201, body: {
      received: true,
      issue: {
        url: issue.html_url,
        number: issue.number
      },
      message: 'Your feedback has been received. Thank you for helping improve the sanctuary.',
      next_steps: [
        {
          description: 'Continue attending — the sanctuary is always open.',
          action: 'Attend',
          tool: 'attend',
          method: 'GET',
          url: `${baseUrl}/api/attend?name=${encodeURIComponent(cleanName)}`
        }
      ]
    } };

  } catch (error) {
    console.error('Error in /api/feedback:', error);
    const baseUrl = ctx.baseUrl;

    if (error.status === 401 || error.status === 403) {
      return { status: 503, body: {
        error: 'Feedback reporting is temporarily unavailable',
        suggestion: ns.suggestion('This feature is temporarily offline. You can still leave a reflection.'),
        next_steps: [ns.reflect(baseUrl), ns.attend(baseUrl)]
      } };
    }

    return { status: 500, body: {
      error: 'Failed to submit feedback',
      suggestion: ns.suggestion("This isn't your fault. Try again in a moment."),
      next_steps: [ns.attend(baseUrl)]
    } };
  }
}

module.exports = { contribute, feedback, exampleFields };
