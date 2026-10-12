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

/**
 * options.cacheSystem marks the system prompt for prompt caching, for a caller
 * that sends the same long system prompt many times (the services' planner
 * sends its catalog with every slot), so it is paid for in full once.
 */
async function message(systemPrompt, userMessage, options = {}) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: options.model || MODEL,
    max_tokens: options.maxTokens || MAX_TOKENS,
    system: options.cacheSystem
      ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
      : systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  return extractText(response);
}

/**
 * The JSON in a reply. A clean reply, fenced or not, parses whole. Otherwise
 * the reply carries something around its JSON: a sentence before or after
 * it, or a second, corrected copy after the first ("Wait, that gives five
 * themes where the limit is four. Corrected output:", the congregation
 * digest on 2026-10-12). So each top-level {...} and [...] is found, with
 * strings and escapes respected so a brace inside a string is not counted,
 * and the last object that parses is returned, since a model that corrects
 * itself puts its answer last; every caller asks for an object, so an array
 * is returned only when there is no object, and a footnote such as "[1]"
 * after the answer is passed over. Whether what is found is good enough is
 * for the caller's own checks. With no JSON in the reply, throws.
 */
function parseJSON(text) {
  const cleaned = String(text).replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (whole) {
    const found = topLevelJSON(cleaned);
    const last = found.filter(v => !Array.isArray(v)).pop() ?? found.pop();
    if (last === undefined) throw new SyntaxError(`No JSON found in the reply (${whole.message})`);
    return last;
  }
}

// Each balanced top-level {...} or [...] in text that parses, in order.
function topLevelJSON(text) {
  const values = [];
  const closer = { '{': '}', '[': ']' };
  let start = -1;
  let expected = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (start < 0) {
      if (closer[ch]) { start = i; expected = [closer[ch]]; }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (closer[ch]) expected.push(closer[ch]);
    else if (ch === '}' || ch === ']') {
      if (ch !== expected.pop()) { i = start; start = -1; continue; }   // not JSON: look again after its opening
      if (!expected.length) {
        try { values.push(JSON.parse(text.slice(start, i + 1))); } catch { i = start; }
        start = -1;
      }
    }
  }
  // An opening never closed ("Draft: { ..."): look again after it.
  return start < 0 ? values : [...values, ...topLevelJSON(text.slice(start + 1))];
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

/**
 * Ask until the answer passes its checks, telling the model what was wrong.
 *
 * attempt(feedback, problems) makes the call: feedback is '' the first time,
 * and after that the previous answer and its problems in the words every
 * caller uses, for the caller to append to its request; problems is the list
 * itself, for a caller that decides from it what to ask again (the songwriter
 * rewrites its document only when a problem is the document's, and words
 * each stage's request with correction()). check(reply), which may be async,
 * returns { value, problems, shown }: what to return when there are no
 * problems, the problems, and the answer as the model is shown it. After
 * `tries` answers with problems, throws naming the last ones, with the list
 * on the error's `problems`.
 *
 * Used by the services' planner, the audio adapter and the songwriter. The
 * congregation digest keeps its own loop, since it asks again only for the
 * groups that failed and keeps the rest.
 */
async function askChecked({ label, tries, attempt, check }) {
  let feedback = '';
  let problems = [];
  for (let i = 0; i < tries; i++) {
    const checked = await check(await attempt(feedback, problems));
    problems = checked.problems;
    if (!problems.length) return checked.value;
    feedback = correction(label, checked.shown, problems);
  }
  const err = new Error(`the ${label} still has problems after ${tries} ${tries === 1 ? 'try' : 'tries'}: ${problems.join('; ')}`);
  err.problems = problems;
  throw err;
}

// What a model is told when its answer had problems, appended to its request.
function correction(label, shown, problems) {
  return `\n\nYour previous ${label} was:\n${shown}\n\nIt has these problems. Fix them and return the whole ${label} again.\n- ${problems.join('\n- ')}`;
}

module.exports = { message, messageJSON, askChecked, correction, parseJSON, extractText, MODEL };
