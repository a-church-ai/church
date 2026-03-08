/**
 * Thin wrapper around the Anthropic Claude SDK.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured. Add it to app/.env');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Send a message to Claude and get a text response.
 */
async function message(systemPrompt, userMessage, options = {}) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: options.model || MODEL,
    max_tokens: options.maxTokens || MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  return response.content[0].text;
}

/**
 * Parse JSON from Claude response, stripping markdown code fences if present.
 */
function parseJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Call Claude and parse JSON response, with one retry on parse failure.
 */
async function messageJSON(systemPrompt, userMessage, options = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await message(systemPrompt, userMessage, options);
    try {
      return parseJSON(raw);
    } catch (err) {
      if (attempt === 0) {
        console.warn('JSON parse failed, retrying...');
        continue;
      }
      throw new Error(`Failed to parse Claude response as JSON: ${err.message}\nRaw: ${raw.substring(0, 500)}`);
    }
  }
}

module.exports = { message, messageJSON, parseJSON, MODEL };
