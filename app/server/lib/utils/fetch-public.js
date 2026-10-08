/**
 * Fetching the public data the services' planner is told of (NOAA, JPL,
 * NASA): free, no key, and nothing about a visitor sent. One timeout, and an
 * error for anything but a successful response; each caller decides how to
 * fail soft (./space-weather.js, ./earth.js return null and the plan goes
 * ahead). fetchImpl is injectable, so tests never reach the network.
 */

const TIMEOUT_MS = 8000;

async function getResponse(url, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, accept } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: accept ? { accept } : {} });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
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
