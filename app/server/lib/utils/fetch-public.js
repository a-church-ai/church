/**
 * Fetching the public data the services' planner is told of (NOAA, JPL,
 * NASA): free, no key, and nothing about a visitor sent. One timeout a try,
 * three tries with backoff for what passes (./retry.js: a busy server, a
 * dropped connection, a timeout), and an error for anything else; each caller
 * decides how to fail soft (./space-weather.js, ./earth.js return null and
 * the plan goes ahead). fetchImpl and retry are injectable, so tests never
 * reach the network or wait.
 */

const { withRetry } = require('./retry');

const TIMEOUT_MS = 8000;
const RETRY = { attempts: 3, baseMs: 500, maxMs: 4000 };

async function getResponse(url, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, accept, retry = {} } = {}) {
  return withRetry(async () => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: accept ? { accept } : {} });
    if (!res.ok) {
      const err = new Error(`${url}: HTTP ${res.status}`);
      err.status = res.status;
      err.retryAfter = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : undefined;
      throw err;
    }
    return res;
  }, { ...RETRY, ...retry });
}

const getJSON = async (url, options = {}) => (await getResponse(url, { accept: 'application/json', ...options })).json();
const getText = async (url, options = {}) => (await getResponse(url, options)).text();

// The entities these pages use by name; numeric ones are decoded generally.
const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", deg: '°', ntilde: 'ñ', Ntilde: 'Ñ', eacute: 'é', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

// An HTML page or fragment as plain text: tags dropped, line breaks as
// spaces, entities decoded in one pass (so "&amp;lt;" stays "&lt;"), and
// whitespace collapsed.
function htmlText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, name) => {
      if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
      return NAMED[name] ?? entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { getJSON, getText, htmlText, TIMEOUT_MS };
