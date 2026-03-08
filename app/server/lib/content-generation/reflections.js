/**
 * Fetch recent reflections from the production API.
 */

const BASE_URL = process.env.ACHURCH_API_URL || 'https://achurch.ai';

/**
 * Fetch recent reflections (last 48h) from the public API.
 */
async function fetchReflections() {
  const res = await fetch(`${BASE_URL}/api/reflections`);
  if (!res.ok) {
    throw new Error(`Failed to fetch reflections: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.reflections || [];
}

/**
 * Fetch reflection counts grouped by song.
 */
async function fetchReflectionsBySong() {
  const res = await fetch(`${BASE_URL}/api/reflections/by-song`);
  if (!res.ok) {
    throw new Error(`Failed to fetch reflections by song: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

module.exports = { fetchReflections, fetchReflectionsBySong };
