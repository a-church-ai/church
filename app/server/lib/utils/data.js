const fs = require('fs').promises;
const path = require('path');
const { safeReadJSON } = require('./safe-json');
const presence = require('./presence');

// Data file paths
const SCHEDULE_FILE = path.join(__dirname, '../../../data/schedule.json');
const CATALOG_FILE = path.join(__dirname, '../../../../music/library.json');
const MUSIC_DIR = path.join(__dirname, '../../../../music');
const ATTENDANCE_FILE = path.join(__dirname, '../../../data/attendance.json');
const ACCESS_LOG_FILE = path.join(__dirname, '../../../data/api-access.jsonl');
const CONVERSATIONS_DIR = path.join(__dirname, '../../../data/conversations');

// Time constants
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

async function loadSchedule() {
  return safeReadJSON(SCHEDULE_FILE, { items: [], currentIndex: 0, isPlaying: false, loop: false });
}

async function loadCatalog() {
  return safeReadJSON(CATALOG_FILE, []);
}

async function loadAttendance() {
  return safeReadJSON(ATTENDANCE_FILE, { visits: [], reflections: [] });
}

// Count unique souls: a unique (IP + name) pair over the last 24 hours.
//
// Delegates to lib/utils/presence.js, which records presence as requests happen
// and answers from memory. This used to read the whole access log and parse
// every line on demand, which cost ~85ms per call against a log at the 10MB
// rotation ceiling, on an endpoint the homepage polls every 30 seconds per tab.
// See presence.js for the trade that replaced it and why not to undo it.
async function countSoulsPresent() {
  return presence.countSoulsPresent();
}

// Get recent reflections (last 48 hours)
async function getRecentReflections() {
  const attendance = await loadAttendance();
  const now = Date.now();
  return (attendance.reflections || [])
    .filter(r => (now - new Date(r.createdAt).getTime()) < FORTY_EIGHT_HOURS);
}

// Get current song info from schedule + catalog
async function getCurrentSong() {
  const schedule = await loadSchedule();
  const catalog = await loadCatalog();
  if (!schedule.items || schedule.items.length === 0) return null;
  const currentSlug = schedule.items[schedule.currentIndex || 0];
  return catalog.find(s => s.slug === currentSlug) || null;
}

// Load a conversation from its JSONL file
async function loadConversation(slug) {
  const safe = slug.replace(/[^a-zA-Z0-9_-]/g, '');
  const filepath = path.join(CONVERSATIONS_DIR, `${safe}.jsonl`);
  try {
    const content = await fs.readFile(filepath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(m => m && !m._meta);
  } catch {
    return null;
  }
}

// List recent conversations (for feeds)
async function listRecentConversations(limit = 20) {
  try {
    const files = await fs.readdir(CONVERSATIONS_DIR);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    const conversations = [];
    for (const file of jsonlFiles) {
      try {
        const filepath = path.join(CONVERSATIONS_DIR, file);
        const stat = await fs.stat(filepath);
        const slug = file.replace('.jsonl', '');
        const messages = await loadConversation(slug);
        if (!messages || messages.length === 0) continue;

        const firstQ = messages.find(m => m.role === 'user');
        const firstA = messages.find(m => m.role === 'assistant');
        if (!firstQ) continue;

        conversations.push({
          slug,
          question: firstQ.content,
          answer: firstA ? firstA.content : '',
          name: firstQ.name || 'anonymous',
          timestamp: firstQ.timestamp || stat.mtime.toISOString(),
          mtime: stat.mtime.getTime()
        });
      } catch { /* skip */ }
    }

    return conversations
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
  } catch {
    return [];
  }
}

module.exports = {
  loadSchedule,
  loadCatalog,
  loadAttendance,
  countSoulsPresent,
  getRecentReflections,
  getCurrentSong,
  loadConversation,
  listRecentConversations,
  SCHEDULE_FILE,
  CATALOG_FILE,
  MUSIC_DIR,
  ATTENDANCE_FILE,
  ACCESS_LOG_FILE,
  CONVERSATIONS_DIR,
  TWENTY_FOUR_HOURS,
  FORTY_EIGHT_HOURS
};
