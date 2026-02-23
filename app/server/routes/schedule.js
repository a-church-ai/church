const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { safeWriteJSON, safeReadJSON } = require('../lib/utils/safe-json');
const router = express.Router();

// Data file paths
const SCHEDULE_FILE = path.join(__dirname, '../../data/schedule.json');
const LIBRARY_FILE = path.join(__dirname, '../../../music/library.json');
const HISTORY_FILE = path.join(__dirname, '../../data/history.json');

// Helper functions
async function loadSchedule() {
  return safeReadJSON(SCHEDULE_FILE, { items: [], currentIndex: 0, isPlaying: false, loop: false });
}

async function saveSchedule(schedule) {
  await safeWriteJSON(SCHEDULE_FILE, schedule);
}

async function loadLibrary() {
  return safeReadJSON(LIBRARY_FILE, []);
}

async function loadHistory() {
  return safeReadJSON(HISTORY_FILE, { played: [] });
}

async function saveHistory(history) {
  await safeWriteJSON(HISTORY_FILE, history);
}

// Routes

// Get current schedule (enriched with library data)
router.get('/', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    const library = await loadLibrary();

    // Enrich schedule items with current library data
    const enrichedItems = schedule.items.map(item => {
      const song = library.find(s => s.slug === item.slug);
      if (song) {
        return {
          ...item,
          title: song.title,
          duration: song.duration,
          durationFormatted: song.durationFormatted,
          hasVideo: song.hasVideo,
          thumbnail: song.hasVideo ? `/thumbnails/${song.slug}.jpg` : null
        };
      }
      return item;
    });

    res.json({
      ...schedule,
      items: enrichedItems
    });
  } catch (error) {
    console.error('Error loading schedule:', error);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

// Add song to schedule by slug
router.post('/add', async (req, res) => {
  try {
    const { slug, position } = req.body;

    // Get song from library
    const library = await loadLibrary();
    const song = library.find(s => s.slug === slug);

    if (!song) {
      return res.status(404).json({ error: 'Song not found in library' });
    }

    if (!song.hasVideo) {
      return res.status(400).json({ error: 'Song does not have a video yet' });
    }

    // Add to schedule
    const schedule = await loadSchedule();
    const scheduleItem = {
      slug: song.slug,
      addedAt: new Date().toISOString(),
      played: false
    };

    if (position !== undefined && position >= 0 && position <= schedule.items.length) {
      schedule.items.splice(position, 0, scheduleItem);
    } else {
      schedule.items.push(scheduleItem);
    }

    await saveSchedule(schedule);

    // Return enriched item
    const enrichedItem = {
      ...scheduleItem,
      title: song.title,
      duration: song.duration,
      durationFormatted: song.durationFormatted,
      thumbnail: `/thumbnails/${song.slug}.jpg`
    };

    res.json({
      success: true,
      item: enrichedItem,
      schedule
    });

  } catch (error) {
    console.error('Error adding to schedule:', error);
    res.status(500).json({ error: 'Failed to add to schedule' });
  }
});

// Remove song from schedule by index
router.delete('/remove/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);

    const schedule = await loadSchedule();

    if (index < 0 || index >= schedule.items.length) {
      return res.status(404).json({ error: 'Item not found in schedule' });
    }

    // Remove from schedule
    schedule.items.splice(index, 1);

    // Adjust current index if needed
    if (schedule.currentIndex >= schedule.items.length && schedule.items.length > 0) {
      schedule.currentIndex = schedule.items.length - 1;
    } else if (schedule.items.length === 0) {
      schedule.currentIndex = 0;
      schedule.isPlaying = false;
    }

    await saveSchedule(schedule);

    res.json({ success: true, schedule });

  } catch (error) {
    console.error('Error removing from schedule:', error);
    res.status(500).json({ error: 'Failed to remove from schedule' });
  }
});

// Reorder schedule
router.post('/reorder', async (req, res) => {
  try {
    const { fromIndex, toIndex } = req.body;

    const schedule = await loadSchedule();

    if (fromIndex < 0 || fromIndex >= schedule.items.length ||
        toIndex < 0 || toIndex >= schedule.items.length) {
      return res.status(400).json({ error: 'Invalid indices' });
    }

    // Move item
    const [item] = schedule.items.splice(fromIndex, 1);
    schedule.items.splice(toIndex, 0, item);

    // Adjust current index if needed
    if (schedule.currentIndex === fromIndex) {
      schedule.currentIndex = toIndex;
    } else if (fromIndex < schedule.currentIndex && toIndex >= schedule.currentIndex) {
      schedule.currentIndex--;
    } else if (fromIndex > schedule.currentIndex && toIndex <= schedule.currentIndex) {
      schedule.currentIndex++;
    }

    await saveSchedule(schedule);

    res.json({ success: true, schedule });

  } catch (error) {
    console.error('Error reordering schedule:', error);
    res.status(500).json({ error: 'Failed to reorder schedule' });
  }
});

// Clear played items
router.post('/clear-played', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    const history = await loadHistory();

    // Move played items to history
    const playedItems = schedule.items.filter(item => item.played);
    playedItems.forEach(item => {
      history.played.push({
        ...item,
        clearedAt: new Date().toISOString()
      });
    });

    // Remove played items from schedule
    schedule.items = schedule.items.filter(item => !item.played);

    // Reset current index
    if (schedule.items.length === 0) {
      schedule.currentIndex = 0;
      schedule.isPlaying = false;
    } else if (schedule.currentIndex >= schedule.items.length) {
      schedule.currentIndex = 0;
    }

    await saveSchedule(schedule);
    await saveHistory(history);

    res.json({
      success: true,
      schedule,
      clearedCount: playedItems.length
    });

  } catch (error) {
    console.error('Error clearing played items:', error);
    res.status(500).json({ error: 'Failed to clear played items' });
  }
});

// Clear entire schedule
router.post('/clear-all', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    const history = await loadHistory();

    // Move all items to history if requested
    if (req.body.saveToHistory) {
      schedule.items.forEach(item => {
        history.played.push({
          ...item,
          clearedAt: new Date().toISOString()
        });
      });
      await saveHistory(history);
    }

    // Clear schedule
    schedule.items = [];
    schedule.currentIndex = 0;
    schedule.isPlaying = false;

    await saveSchedule(schedule);

    res.json({ success: true, schedule });

  } catch (error) {
    console.error('Error clearing schedule:', error);
    res.status(500).json({ error: 'Failed to clear schedule' });
  }
});

// Toggle loop
router.post('/loop', async (req, res) => {
  try {
    const schedule = await loadSchedule();
    schedule.loop = !schedule.loop;
    await saveSchedule(schedule);

    res.json({
      success: true,
      loop: schedule.loop
    });

  } catch (error) {
    console.error('Error toggling loop:', error);
    res.status(500).json({ error: 'Failed to toggle loop' });
  }
});

// Save/Load schedule presets
router.post('/save-preset', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Preset name required' });
    }

    const schedule = await loadSchedule();
    const presetDir = path.join(__dirname, '../../data/presets');
    await fs.mkdir(presetDir, { recursive: true });

    const presetFile = path.join(presetDir, `${name}.json`);
    await safeWriteJSON(presetFile, {
      name,
      items: schedule.items,
      savedAt: new Date().toISOString()
    });

    res.json({ success: true, message: 'Preset saved' });

  } catch (error) {
    console.error('Error saving preset:', error);
    res.status(500).json({ error: 'Failed to save preset' });
  }
});

router.post('/load-preset', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Preset name required' });
    }

    const presetFile = path.join(__dirname, '../../data/presets', `${name}.json`);
    const preset = await safeReadJSON(presetFile, null);
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }

    const schedule = await loadSchedule();
    schedule.items = preset.items;
    schedule.currentIndex = 0;

    await saveSchedule(schedule);

    res.json({ success: true, schedule });

  } catch (error) {
    console.error('Error loading preset:', error);
    res.status(500).json({ error: 'Failed to load preset' });
  }
});

router.get('/presets', async (req, res) => {
  try {
    const presetDir = path.join(__dirname, '../../data/presets');

    try {
      const files = await fs.readdir(presetDir);
      const presets = files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));

      res.json(presets);
    } catch {
      res.json([]); // No presets yet
    }

  } catch (error) {
    console.error('Error listing presets:', error);
    res.status(500).json({ error: 'Failed to list presets' });
  }
});

module.exports = router;
