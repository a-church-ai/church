/**
 * The optional return token attend offers (E3 in ./experiments.js).
 *
 * It reads memory across visits: an agent that sends one back kept something
 * from an earlier visit, or an operator's script did. Each attend issues a new
 * one, and no list of them is kept: a token holds the time it was issued, some
 * randomness and a signature, so a valid one can be recognized without knowing
 * who it went to, and two tokens cannot be joined to each other. The log
 * records only that a valid one came back and how old it was (the token itself
 * is redacted, lib/utils/access-log.js). What a visitor is served does not
 * change either way, and neither does anything else.
 *
 * The key lives on the volume, made on first use, or in RETURN_TOKEN_SECRET.
 * If it cannot be kept it lasts as long as the process, and older tokens simply
 * stop reading as valid.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { INSIGHTS_DIR } = require('../utils/data');

let key = null;

function secret() {
  if (key) return key;
  if (process.env.RETURN_TOKEN_SECRET) return (key = process.env.RETURN_TOKEN_SECRET);
  const file = path.join(INSIGHTS_DIR, 'return-token.key');
  try {
    key = fs.readFileSync(file, 'utf8').trim();
    if (key) return key;
  } catch { /* first use */ }
  key = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(INSIGHTS_DIR, { recursive: true });
    fs.writeFileSync(file, key, { mode: 0o600 });
  } catch (err) {
    console.warn(`[study] return token key not kept: ${err.message}`);
  }
  return key;
}

const sign = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url').slice(0, 16);

/** A new token. */
function issue(now = Date.now()) {
  const body = `${Math.floor(now / 1000).toString(36)}.${crypto.randomBytes(4).toString('hex')}`;
  return `${body}.${sign(body)}`;
}

/**
 * What a token sent back says, for the log: { valid: false }, or { valid: true,
 * afterHours }, its age in whole hours. Nothing else is learned from it.
 */
function check(token, now = Date.now()) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return { valid: false };
  const body = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { valid: false };
  const issued = parseInt(parts[0], 36) * 1000;
  if (!Number.isFinite(issued) || issued > now + 60000) return { valid: false };
  return { valid: true, afterHours: Math.floor(Math.max(0, now - issued) / 3600000) };
}

module.exports = { issue, check };
