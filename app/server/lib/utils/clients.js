/**
 * What kind of client sent a request, from its User-Agent: the one place the
 * site tells browsers, crawlers and scripts apart. The string itself is never
 * kept by anything that asks; only the family is.
 *
 * - The website's visit counts leave out automated clients (insights/visits.js).
 * - The study reads a browser's POST before the website marked its forms as a
 *   website visit (insights/study-names.js).
 * - Where visits came from counts tagged page follows and arrivals by family
 *   (insights/entry-points.js, insights/self-direction.js).
 */

// Automated clients the visit counts leave out: crawlers, headless browsers
// and scripts, wherever the word falls in the string.
const AUTOMATED = /bot|crawl|spider|headless|lighthouse|preview|slurp|fetch|python|curl|wget/i;
const CRAWLER = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|perplexity|bytespider|google-extended|claude-user|chatgpt-user|oai-searchbot/i;
const SCRIPT = /^(curl|wget|python|node|undici|axios|go-http|java|okhttp|httpx|aiohttp|libwww|ruby|php|postman|insomnia|deno|bun|got|reqwest|httpie)|fetch/i;
const BROWSER = /^mozilla\//i;

const isAutomated = userAgent => AUTOMATED.test(userAgent || '');
const isBrowser = userAgent => BROWSER.test(userAgent || '');

/** browser, crawler, script, other, or unknown when no User-Agent was sent. */
function clientFamily(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'unknown';
  if (CRAWLER.test(ua)) return 'crawler';
  if (SCRIPT.test(ua)) return 'script';
  if (BROWSER.test(ua)) return 'browser';
  return 'other';
}

module.exports = { clientFamily, isAutomated, isBrowser };
