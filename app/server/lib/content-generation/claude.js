/**
 * Thin wrapper around the Anthropic Claude SDK.
 */

const Anthropic = require('@anthropic-ai/sdk');

/**
 * The fallback model, for callers that do not name one.
 *
 * Sonnet 5 rather than Opus 5, deliberately. A default is what you get when
 * nobody made a decision, so it should be the cheap current model rather than
 * the expensive one: $2/$10 per MTok against $5/$25. A new call site that
 * forgets to name a model then costs 2.5 times less than it might have, and
 * spending Opus money stays something a caller has to ask for by name.
 *
 * Sonnet 5 is also cheaper than the older Sonnet 4.6 at $3/$15, so this is not
 * a quality compromise made for cost. It is the current mid-tier model.
 *
 * The previous default, claude-sonnet-4-20250514, is retired and returns 404,
 * so every caller relying on it was broken rather than merely dated. Verified
 * against the live Models API on 2026-08-15.
 */
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
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
/**
 * Pull the assistant's text out of a response.
 *
 * Not response.content[0].text. On current models thinking is on by default,
 * so content[0] is usually a thinking block and reading .text off it yields
 * undefined, which then fails somewhere further away with a confusing message.
 * Find the text block instead of assuming its position.
 */
function extractText(response) {
  const blocks = (response && response.content) || [];
  const text = blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');

  if (!text) {
    // A refusal is a successful HTTP response with no text, so say which case
    // this is rather than returning an empty string to the caller.
    const reason = response && response.stop_reason;
    const types = blocks.map((b) => b && b.type).join(', ') || 'none';
    throw new Error(`No text in response (stop_reason: ${reason}, blocks: ${types})`);
  }

  return text;
}

async function message(systemPrompt, userMessage, options = {}) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: options.model || MODEL,
    max_tokens: options.maxTokens || MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  return extractText(response);
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
      throw new Error(`Failed to parse Claude response as JSON: ${err.message}\nRaw: ${String(raw).substring(0, 500)}`);
    }
  }
}

module.exports = { message, messageJSON, parseJSON, extractText, MODEL };
