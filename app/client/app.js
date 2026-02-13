// API base URL
const API_URL = '/api';

// Global state
let currentSchedule = { items: [], currentIndex: 0, isPlaying: false, loop: false };
let catalog = [];
let playerStatus = {};

// Playback timer state
let playbackStartTime = null;
let playbackTimerInterval = null;

// Auth handling
async function checkAuth() {
    try {
        const response = await fetch(`${API_URL}/auth/check`, { credentials: 'include' });
        const data = await response.json();
        return data.authenticated;
    } catch (error) {
        console.error('Auth check failed:', error);
        return false;
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const key = document.getElementById('login-key').value;
    const errorEl = document.getElementById('login-error');

    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ key })
        });
        const data = await response.json();

        if (data.success) {
            showApp();
        } else {
            errorEl.textContent = 'Invalid key';
            errorEl.style.display = 'block';
        }
    } catch (error) {
        errorEl.textContent = 'Login failed';
        errorEl.style.display = 'block';
    }
}

function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
}

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    init();
}

// Initialize auth check on page load
document.addEventListener('DOMContentLoaded', async () => {
    const isAuthenticated = await checkAuth();
    if (isAuthenticated) {
        showApp();
    } else {
        showLogin();
    }
});

// Login form handler
document.getElementById('login-form').addEventListener('submit', handleLogin);

// Tab handling
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const tabName = button.dataset.tab;

        // Update buttons - remove active styles from all, add to clicked
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('bg-white', 'border-b-3', 'border-primary', 'font-bold');
            btn.classList.add('bg-transparent', 'border-none', 'hover:bg-black/5');
        });
        button.classList.remove('bg-transparent', 'border-none', 'hover:bg-black/5');
        button.classList.add('bg-white', 'border-b-3', 'border-primary', 'font-bold');

        // Update content - hide all, show selected
        document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        document.getElementById(tabName).classList.remove('hidden');

        // Load tab-specific data
        if (tabName === 'schedule') {
            loadSchedule();
        } else if (tabName === 'catalog') {
            loadCatalog();
        } else if (tabName === 'player') {
            loadPlayerStatus();
        } else if (tabName === 'access') {
            loadAccessLogs();
        } else if (tabName === 'logs') {
            loadLogs();
        } else if (tabName === 'ask-logs') {
            loadAskLogs();
        }
    });
});

// Player Controls
document.getElementById('btn-play').addEventListener('click', play);
document.getElementById('btn-pause').addEventListener('click', pause);
document.getElementById('btn-next').addEventListener('click', playNext);
document.getElementById('btn-previous').addEventListener('click', playPrevious);
document.getElementById('btn-stop').addEventListener('click', stop);

// Streaming Controls
document.getElementById('btn-start-youtube').addEventListener('click', () => startStreaming('youtube'));
document.getElementById('btn-start-twitch').addEventListener('click', () => startStreaming('twitch'));
document.getElementById('btn-start-all').addEventListener('click', () => startStreaming('all'));
document.getElementById('btn-stop-youtube').addEventListener('click', () => stopStreaming('youtube'));
document.getElementById('btn-stop-twitch').addEventListener('click', () => stopStreaming('twitch'));
document.getElementById('btn-stop-all').addEventListener('click', () => stopStreaming('all'));

// Schedule Controls
document.getElementById('btn-clear-played').addEventListener('click', clearPlayed);
document.getElementById('btn-clear-all').addEventListener('click', clearAll);
document.getElementById('btn-toggle-loop').addEventListener('click', toggleLoop);
document.getElementById('btn-save-preset').addEventListener('click', savePreset);
document.getElementById('preset-selector').addEventListener('change', loadPreset);

// Catalog Filters
document.getElementById('filter-with-video').addEventListener('change', renderCatalog);
document.getElementById('filter-without-video').addEventListener('change', renderCatalog);

// Upload Form
document.getElementById('upload-form').addEventListener('submit', uploadVideo);

// Logs Controls
document.getElementById('btn-refresh-logs').addEventListener('click', loadLogs);

// Access Logs Controls
document.getElementById('btn-refresh-access').addEventListener('click', loadAccessLogs);
document.getElementById('access-filter').addEventListener('change', loadAccessLogs);
document.getElementById('auto-refresh-access').addEventListener('change', toggleAccessAutoRefresh);

let accessAutoRefreshInterval = null;

// Ask Logs Controls
document.getElementById('btn-refresh-ask-logs').addEventListener('click', loadAskLogs);
document.getElementById('btn-download-ask-logs').addEventListener('click', downloadAskLogs);

// Streaming Functions
async function startStreaming(platform) {
    try {
        const quality = document.getElementById('quality-select').value;
        const response = await fetch(`${API_URL}/player/start-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform, quality })
        });
        const data = await response.json();

        if (data.success) {
            const platformText = platform === 'all' ? 'all platforms' : platform;
            showMessage(`Started streaming to ${platformText}`, 'success');
        } else {
            showMessage(`Failed to start streaming: ${data.error}`, 'error');
        }
        // Always refresh status to update buttons
        await loadPlayerStatus();
        updateStreamingButtons();
    } catch (error) {
        console.error('Error starting stream:', error);
        showMessage('Error starting stream', 'error');
    }
}

async function stopStreaming(platform) {
    try {
        const response = await fetch(`${API_URL}/player/stop-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform })
        });
        const data = await response.json();

        if (data.success) {
            const platformText = platform === 'all' ? 'all platforms' : platform;
            showMessage(`Stopped streaming to ${platformText}`, 'success');
        } else {
            showMessage(`Failed to stop streaming: ${data.error}`, 'error');
        }
        // Always refresh status to update buttons
        await loadPlayerStatus();
        updateStreamingButtons();
    } catch (error) {
        console.error('Error stopping stream:', error);
        showMessage('Error stopping stream', 'error');
    }
}

async function play() {
    try {
        const response = await fetch(`${API_URL}/player/play`, { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            startPlaybackTimer();
            updatePlayerStatus();
            loadSchedule();
            showMessage('Playing: ' + data.nowPlaying.title, 'success');
        }
    } catch (error) {
        console.error('Error playing:', error);
        showMessage('Error starting playback', 'error');
    }
}

async function pause() {
    try {
        await fetch(`${API_URL}/player/pause`, { method: 'POST' });
        stopPlaybackTimer();
        updatePlayerStatus();
    } catch (error) {
        console.error('Error pausing:', error);
    }
}

async function playNext() {
    try {
        const response = await fetch(`${API_URL}/player/next`, { method: 'POST' });
        const data = await response.json();

        if (data.endReached) {
            stopPlaybackTimer();
            showMessage('End of schedule reached', 'info');
        } else if (data.success) {
            startPlaybackTimer();
            updatePlayerStatus();
            loadSchedule();
            showMessage('Playing: ' + data.nowPlaying.title, 'success');
        }
    } catch (error) {
        console.error('Error playing next:', error);
        showMessage('Error playing next video', 'error');
    }
}

async function playPrevious() {
    try {
        const response = await fetch(`${API_URL}/player/previous`, { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            startPlaybackTimer();
            updatePlayerStatus();
            loadSchedule();
            showMessage('Playing: ' + data.nowPlaying.title, 'success');
        }
    } catch (error) {
        console.error('Error playing previous:', error);
        showMessage('Error playing previous video', 'error');
    }
}

async function stop() {
    try {
        // Check if streaming was active (for user feedback)
        const wasStreaming = playerStatus.streamingStatus?.coordinator ||
            playerStatus.streamingStatus?.youtube ||
            playerStatus.streamingStatus?.twitch;

        // Stop playback (server also stops streaming if active)
        await fetch(`${API_URL}/player/stop`, { method: 'POST' });
        stopPlaybackTimer();

        if (wasStreaming) {
            showMessage('Stopped playback and streaming', 'success');
        }

        // Refresh status and update UI
        await loadPlayerStatus();
        updateStreamingButtons();
        loadSchedule();
    } catch (error) {
        console.error('Error stopping:', error);
    }
}

function startPlaybackTimer() {
    playbackStartTime = Date.now();
    playerStatus.timeElapsed = 0;

    // Clear any existing timer
    if (playbackTimerInterval) {
        clearInterval(playbackTimerInterval);
    }

    // Update elapsed time every second
    playbackTimerInterval = setInterval(() => {
        if (playbackStartTime && playerStatus.isPlaying) {
            playerStatus.timeElapsed = Math.floor((Date.now() - playbackStartTime) / 1000);
            updatePlayerDisplay();
        }
    }, 1000);
}

function stopPlaybackTimer() {
    if (playbackTimerInterval) {
        clearInterval(playbackTimerInterval);
        playbackTimerInterval = null;
    }
    playbackStartTime = null;
    playerStatus.timeElapsed = 0;
}

async function loadPlayerStatus() {
    try {
        const response = await fetch(`${API_URL}/player/status`);
        const wasPlaying = playerStatus.isPlaying;
        const previousSlug = playerStatus.currentVideo?.slug;
        playerStatus = await response.json();
        const currentSlug = playerStatus.currentVideo?.slug;

        // Detect video change while playing — reset timer for new song
        if (playerStatus.isPlaying && previousSlug && currentSlug && previousSlug !== currentSlug) {
            startPlaybackTimer();
        }
        // Detect play state transition
        else if (playerStatus.isPlaying && !wasPlaying && !playbackTimerInterval) {
            startPlaybackTimer();
        } else if (!playerStatus.isPlaying && playbackTimerInterval) {
            stopPlaybackTimer();
        }

        updatePlayerDisplay();
    } catch (error) {
        console.error('Error loading player status:', error);
    }
}

function updatePlayerDisplay() {
    const currentVideoDiv = document.getElementById('current-video');
    const isPlaying = playerStatus.isPlaying;

    if (playerStatus.currentVideo) {
        const total = playerStatus.totalDuration || playerStatus.currentVideo.duration || 0;
        const elapsed = Math.min(playerStatus.timeElapsed || 0, total);
        const remaining = Math.max(0, total - elapsed);

        currentVideoDiv.innerHTML = `
            <div class="text-center">
                ${playerStatus.currentVideo.thumbnail ?
                    `<img src="${playerStatus.currentVideo.thumbnail}" alt="${playerStatus.currentVideo.title}" class="max-w-full max-h-60 mx-auto rounded-lg">` :
                    '<div class="opacity-50">No thumbnail</div>'}
                <h3 class="text-xl font-bold mt-4">${playerStatus.currentVideo.title}</h3>
                <p class="text-gray-300 mt-2">
                    ${isPlaying ?
                        `<span class="text-green-400">${formatTime(elapsed)}</span> / ${formatTime(total)}` :
                        `Duration: ${playerStatus.currentVideo.durationFormatted || 'Unknown'}`
                    }
                </p>
                ${isPlaying ? '<p class="text-green-400 mt-1 animate-pulse">Now Playing</p>' : ''}
            </div>
        `;
    } else {
        currentVideoDiv.innerHTML = '<div class="opacity-50 text-lg">No video selected</div>';
    }

    // Update play/pause/stop button states
    document.getElementById('btn-play').disabled = isPlaying;
    document.getElementById('btn-pause').disabled = !isPlaying;
    document.getElementById('btn-stop').disabled = !isPlaying;

    // Update status indicators
    document.getElementById('stream-status').textContent =
        isPlaying ? '▶️ Playing' : '⏸️ Not Playing';
    document.getElementById('stream-status').className =
        `px-3 py-1 rounded-full ${isPlaying ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`;

    // Update streaming status
    if (playerStatus.streamingStatus) {
        document.getElementById('youtube-status').textContent =
            playerStatus.streamingStatus.youtube ? '🔴 YouTube Live' : '⚪ YouTube';
        document.getElementById('twitch-status').textContent =
            playerStatus.streamingStatus.twitch ? '🟣 Twitch Live' : '⚪ Twitch';
    }
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function updatePlayerStatus() {
    await loadPlayerStatus();
    await loadUpNext();
    updateStreamingButtons();
}

function updateStreamingButtons() {
    if (!playerStatus.streamingStatus) {
        return;
    }

    const { youtube, twitch, coordinator } = playerStatus.streamingStatus;

    // Update YouTube buttons
    document.getElementById('btn-start-youtube').disabled = youtube;
    document.getElementById('btn-stop-youtube').disabled = !youtube;

    // Update Twitch buttons
    document.getElementById('btn-start-twitch').disabled = twitch;
    document.getElementById('btn-stop-twitch').disabled = !twitch;

    // Update All buttons
    document.getElementById('btn-start-all').disabled = coordinator;
    document.getElementById('btn-stop-all').disabled = !coordinator;
}

async function loadUpNext() {
    try {
        const response = await fetch(`${API_URL}/schedule`);
        const schedule = await response.json();

        const upNextList = document.getElementById('up-next-list');
        const nextItems = schedule.items.slice(schedule.currentIndex + 1, schedule.currentIndex + 4);

        if (nextItems.length === 0) {
            upNextList.innerHTML = '<div class="text-center py-8 text-muted">Nothing scheduled</div>';
        } else {
            upNextList.innerHTML = nextItems.map(item => `
                <div class="p-2.5 bg-white mb-2.5 rounded-md flex items-center gap-2.5">
                    ${item.thumbnail ?
                        `<img src="${item.thumbnail}" alt="${item.title}" class="w-[60px] h-10 object-cover rounded">` :
                        '<div class="w-[60px] h-10 bg-gray-300 rounded"></div>'}
                    <div>
                        <div class="font-medium text-sm">${item.title}</div>
                        <small class="text-muted">${item.durationFormatted || ''}</small>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading up next:', error);
    }
}

// Schedule Functions
async function loadSchedule() {
    try {
        const response = await fetch(`${API_URL}/schedule`);
        currentSchedule = await response.json();
        renderSchedule();
        updateScheduleCount();
        updateLoopButton();
    } catch (error) {
        console.error('Error loading schedule:', error);
    }
}

function renderSchedule() {
    const scheduleList = document.getElementById('schedule-list');

    if (currentSchedule.items.length === 0) {
        scheduleList.innerHTML = '<div class="text-center py-16 text-muted text-lg">Schedule is empty. Add songs from the library.</div>';
        return;
    }

    scheduleList.innerHTML = currentSchedule.items.map((item, index) => {
        const isPlaying = index === currentSchedule.currentIndex;
        const playingClasses = isPlaying ? 'bg-green-50 border-2 border-success' : '';
        const playedClasses = item.played ? 'opacity-50' : '';
        return `
        <div class="schedule-item bg-white p-4 mb-2.5 rounded-lg flex items-center gap-4 cursor-move transition-all hover:shadow-card ${playingClasses} ${playedClasses}"
             draggable="true" data-index="${index}">
            ${item.thumbnail ?
                `<img src="${item.thumbnail}" alt="${item.title}" class="w-20 h-[45px] object-cover rounded-md">` :
                '<div class="w-20 h-[45px] bg-gray-300 rounded-md"></div>'}
            <div class="flex-1">
                <div class="font-bold mb-1">${item.title}</div>
                <div class="text-sm text-muted">
                    ${item.durationFormatted || ''}
                    ${item.played ? '• Played' : ''}
                    ${isPlaying ? '• Now Playing' : ''}
                </div>
            </div>
            <div class="flex gap-1">
                <button onclick="playFromIndex(${index})" class="px-2.5 py-1 border-none bg-success text-white rounded cursor-pointer">▶️</button>
                <button onclick="removeFromSchedule(${index})" class="px-2.5 py-1 border-none bg-danger text-white rounded cursor-pointer">🗑️</button>
            </div>
        </div>
    `}).join('');

    // Add drag and drop handlers
    addDragHandlers();
}

function addDragHandlers() {
    const items = document.querySelectorAll('.schedule-item');

    items.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
    });
}

let draggedElement = null;
let draggedIndex = null;

function handleDragStart(e) {
    draggedElement = this;
    draggedIndex = parseInt(this.dataset.index);
    this.classList.add('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }

    this.classList.add('drag-over');
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    const dropIndex = parseInt(this.dataset.index);

    if (draggedIndex !== dropIndex) {
        reorderSchedule(draggedIndex, dropIndex);
    }

    return false;
}

function handleDragEnd(e) {
    document.querySelectorAll('.schedule-item').forEach(item => {
        item.classList.remove('dragging', 'drag-over');
    });
}

async function reorderSchedule(fromIndex, toIndex) {
    try {
        const response = await fetch(`${API_URL}/schedule/reorder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromIndex, toIndex })
        });

        if (response.ok) {
            loadSchedule();
        }
    } catch (error) {
        console.error('Error reordering schedule:', error);
    }
}

async function removeFromSchedule(index) {
    try {
        const response = await fetch(`${API_URL}/schedule/remove/${index}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadSchedule();
            renderCatalog();
            showMessage('Removed from schedule', 'success');
        }
    } catch (error) {
        console.error('Error removing from schedule:', error);
    }
}

async function playFromIndex(index) {
    try {
        const response = await fetch(`${API_URL}/player/jump/${index}`, {
            method: 'POST'
        });

        const data = await response.json();
        if (data.success) {
            updatePlayerStatus();
            loadSchedule();
            showMessage('Playing: ' + data.nowPlaying.title, 'success');
        }
    } catch (error) {
        console.error('Error jumping to index:', error);
    }
}

async function clearPlayed() {
    try {
        const response = await fetch(`${API_URL}/schedule/clear-played`, {
            method: 'POST'
        });

        const data = await response.json();
        if (data.success) {
            loadSchedule();
            showMessage(`Cleared ${data.clearedCount} played items`, 'success');
        }
    } catch (error) {
        console.error('Error clearing played:', error);
    }
}

async function clearAll() {
    if (!confirm('Clear entire schedule? This cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/schedule/clear-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ saveToHistory: true })
        });

        if (response.ok) {
            loadSchedule();
            showMessage('Schedule cleared', 'success');
        }
    } catch (error) {
        console.error('Error clearing schedule:', error);
    }
}

async function toggleLoop() {
    try {
        const response = await fetch(`${API_URL}/schedule/loop`, {
            method: 'POST'
        });

        const data = await response.json();
        if (data.success) {
            currentSchedule.loop = data.loop;
            updateLoopButton();
        }
    } catch (error) {
        console.error('Error toggling loop:', error);
    }
}

function updateLoopButton() {
    const button = document.getElementById('btn-toggle-loop');
    button.textContent = `🔁 Loop: ${currentSchedule.loop ? 'ON' : 'OFF'}`;
    button.classList.remove('bg-success', 'bg-primary');
    button.classList.add(currentSchedule.loop ? 'bg-success' : 'bg-primary');
}

function updateScheduleCount() {
    document.getElementById('schedule-count').textContent =
        `${currentSchedule.items.length} items in schedule`;
}

async function savePreset() {
    const name = prompt('Enter preset name:');
    if (!name) return;

    try {
        const response = await fetch(`${API_URL}/schedule/save-preset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (response.ok) {
            showMessage('Preset saved', 'success');
            loadPresets();
        }
    } catch (error) {
        console.error('Error saving preset:', error);
    }
}

async function loadPreset(e) {
    const name = e.target.value;
    if (!name) return;

    try {
        const response = await fetch(`${API_URL}/schedule/load-preset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (response.ok) {
            loadSchedule();
            showMessage('Preset loaded', 'success');
            e.target.value = '';
        }
    } catch (error) {
        console.error('Error loading preset:', error);
    }
}

async function loadPresets() {
    try {
        const response = await fetch(`${API_URL}/schedule/presets`);
        const presets = await response.json();

        const selector = document.getElementById('preset-selector');
        selector.innerHTML = '<option value="">Load Preset...</option>' +
            presets.map(name => `<option value="${name}">${name}</option>`).join('');
    } catch (error) {
        console.error('Error loading presets:', error);
    }
}

// Catalog Functions
async function loadCatalog() {
    try {
        const response = await fetch(`${API_URL}/content`);
        catalog = await response.json();
        renderCatalog();
    } catch (error) {
        console.error('Error loading catalog:', error);
    }
}

function renderCatalog() {
    const catalogGrid = document.getElementById('catalog-grid');
    const filterWithVideo = document.getElementById('filter-with-video').checked;
    const filterWithoutVideo = document.getElementById('filter-without-video').checked;

    // Get slugs of songs currently in schedule
    const items = currentSchedule.items || [];
    const scheduledSlugs = new Set(items.map(item => item.slug));

    let filteredCatalog = catalog;

    if (filterWithVideo) {
        filteredCatalog = filteredCatalog.filter(song => song.hasVideo);
    }
    if (filterWithoutVideo) {
        filteredCatalog = filteredCatalog.filter(song => !song.hasVideo);
    }

    if (filteredCatalog.length === 0) {
        catalogGrid.innerHTML = '<div class="text-center py-16 text-muted text-lg col-span-full">No songs match the filter criteria.</div>';
        return;
    }

    catalogGrid.innerHTML = filteredCatalog.map(song => {
        const noVideoClasses = !song.hasVideo ? 'border-2 border-dashed border-gray-300' : '';
        const isInSchedule = scheduledSlugs.has(song.slug);
        return `
        <div class="bg-white rounded-xl overflow-hidden shadow-card transition-all hover:-translate-y-1 hover:shadow-card-hover ${noVideoClasses}">
            ${song.hasVideo ?
                `<img src="/thumbnails/${song.slug}.jpg" alt="${song.title}" class="w-full h-40 object-cover bg-black" onerror="this.style.display='none'">` :
                '<div class="w-full h-40 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center text-primary text-sm">No Video</div>'}
            <div class="p-4">
                <div class="font-bold mb-2 truncate" title="${song.title}">${song.title}</div>
                <div class="text-sm text-muted mb-3">
                    ${song.hasVideo ? (song.durationFormatted || 'Video uploaded') : 'No video yet'}
                </div>
                <div class="flex gap-2.5 mb-3">
                    ${song.youtube ? `<a href="${song.youtube}" target="_blank" title="YouTube" class="text-sm text-primary no-underline hover:underline">▶️</a>` : ''}
                    ${song.suno ? `<a href="${song.suno}" target="_blank" title="Suno" class="text-sm text-primary no-underline hover:underline">🎵</a>` : ''}
                </div>
                <div class="flex gap-2">
                    ${song.hasVideo ?
                        `<button id="schedule-btn-${song.slug}" class="flex-1 py-2 px-3 border-none rounded-md ${isInSchedule ? 'bg-danger hover:bg-red-600' : 'bg-success hover:bg-green-600'} text-white text-sm cursor-pointer transition-all" onclick="toggleSchedule('${song.slug}')">
                            ${isInSchedule ? 'Remove from Schedule' : 'Add to Schedule'}
                        </button>
                        <button class="flex-1 py-2 px-3 border-none rounded-md bg-warning text-white text-sm cursor-pointer transition-all hover:bg-orange-600" onclick="openUploadModal('${song.slug}', '${escapeHtml(song.title)}')">
                            Replace
                        </button>` :
                        `<button class="flex-1 py-2 px-3 border-none rounded-md bg-primary text-white text-sm cursor-pointer transition-all hover:bg-indigo-600" onclick="openUploadModal('${song.slug}', '${escapeHtml(song.title)}')">
                            Upload Video
                        </button>`
                    }
                </div>
            </div>
        </div>
    `}).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/'/g, "\\'");
}

function openUploadModal(slug, title) {
    document.getElementById('upload-slug').value = slug;
    document.getElementById('upload-song-title').textContent = title;
    document.getElementById('video-file').value = '';
    document.getElementById('upload-progress').style.display = 'none';
    document.getElementById('upload-modal').style.display = 'flex';
}

function closeUploadModal() {
    document.getElementById('upload-modal').style.display = 'none';
}

async function uploadVideo(e) {
    e.preventDefault();

    const slug = document.getElementById('upload-slug').value;
    const fileInput = document.getElementById('video-file');

    if (!fileInput.files[0]) {
        showMessage('Please select a video file', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('video', fileInput.files[0]);

    const progressDiv = document.getElementById('upload-progress');
    const progressFill = progressDiv.querySelector('.progress-fill');
    const progressText = progressDiv.querySelector('.progress-text');

    progressDiv.style.display = 'block';

    try {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressFill.style.width = percentComplete + '%';
                progressText.textContent = `Uploading... ${Math.round(percentComplete)}%`;
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                if (response.success) {
                    showMessage('Video uploaded successfully', 'success');
                    closeUploadModal();
                    loadCatalog();
                } else {
                    showMessage('Upload failed: ' + (response.error || 'Unknown error'), 'error');
                    progressDiv.style.display = 'none';
                }
            } else {
                showMessage('Upload failed', 'error');
                progressDiv.style.display = 'none';
            }
        });

        xhr.addEventListener('error', () => {
            showMessage('Upload failed', 'error');
            progressDiv.style.display = 'none';
        });

        xhr.open('POST', `${API_URL}/content/${slug}/video`);
        xhr.send(formData);

    } catch (error) {
        console.error('Error uploading video:', error);
        showMessage('Error uploading video', 'error');
        progressDiv.style.display = 'none';
    }
}

async function addToSchedule(slug) {
    try {
        const response = await fetch(`${API_URL}/schedule/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Added to schedule', 'success');
            // Update currentSchedule and refresh catalog button state
            await loadSchedule();
            renderCatalog();
        } else {
            showMessage(data.error || 'Failed to add to schedule', 'error');
        }
    } catch (error) {
        console.error('Error adding to schedule:', error);
        showMessage('Error adding to schedule', 'error');
    }
}

async function toggleSchedule(slug) {
    const items = currentSchedule.items || [];
    const isInSchedule = items.some(item => item.slug === slug);

    if (isInSchedule) {
        // Find the index of this song in the schedule and remove it
        const index = items.findIndex(item => item.slug === slug);
        if (index !== -1) {
            await removeFromSchedule(index);
        }
    } else {
        await addToSchedule(slug);
    }
}

// Logs Functions
async function loadLogs() {
    try {
        const response = await fetch(`${API_URL}/logs`);
        const data = await response.json();
        renderLogs(data.logs);
    } catch (error) {
        console.error('Error loading logs:', error);
        document.getElementById('logs-list').innerHTML =
            '<div class="text-center py-16 text-danger text-lg">Failed to load logs</div>';
    }
}

function renderLogs(logs) {
    const logsList = document.getElementById('logs-list');

    if (!logs || logs.length === 0) {
        logsList.innerHTML = '<div class="text-center py-16 text-muted text-lg">No log files found</div>';
        return;
    }

    logsList.innerHTML = logs.map(log => {
        const typeBadge = log.type === 'error'
            ? '<span class="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">error</span>'
            : '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">main</span>';
        const isGzip = log.filename.endsWith('.gz');
        const sizeClass = log.size === 0 ? 'text-gray-400' : 'text-gray-600';

        return `
            <div class="flex items-center justify-between p-3 bg-white rounded-lg hover:shadow-card transition-all">
                <div class="flex items-center gap-3">
                    ${typeBadge}
                    <span class="font-medium text-sm">${log.date || log.filename}</span>
                    ${isGzip ? '<span class="text-xs text-gray-400">.gz</span>' : ''}
                </div>
                <div class="flex items-center gap-4">
                    <span class="${sizeClass} text-sm">${log.sizeFormatted}</span>
                    ${log.size > 0
                        ? `<a href="${API_URL}/logs/${log.filename}" class="btn bg-primary text-sm !py-1 !px-3" download>Download</a>`
                        : '<span class="text-gray-400 text-sm">empty</span>'}
                </div>
            </div>
        `;
    }).join('');
}

// Access Logs Functions
async function loadAccessLogs() {
    try {
        const filter = document.getElementById('access-filter').value;
        const response = await fetch('/admin/api/access-logs?limit=500', { credentials: 'include' });
        const data = await response.json();

        const allLogs = data.logs || [];

        // Compute and render stats from all logs
        renderAccessStats(allLogs);

        // Apply filter for table display
        let filteredLogs = allLogs;
        if (filter) {
            filteredLogs = allLogs.filter(log => log.path && log.path.startsWith(filter));
        }

        renderAccessLogs(filteredLogs);
    } catch (error) {
        console.error('Error loading access logs:', error);
        document.getElementById('access-stats').innerHTML =
            '<div class="text-center py-4 text-danger col-span-full">Failed to load stats</div>';
        document.getElementById('access-logs-body').innerHTML =
            '<tr><td colspan="6" class="text-center py-16 text-danger">Failed to load access logs</td></tr>';
    }
}

function renderAccessStats(logs) {
    const statsDiv = document.getElementById('access-stats');

    if (!logs || logs.length === 0) {
        statsDiv.innerHTML = '<div class="text-center py-4 text-muted col-span-full">No API requests yet</div>';
        return;
    }

    // Count unique souls (IP + name combinations from observe endpoints)
    const uniqueSouls = new Set();
    const uniqueAttendNames = new Set();
    const endpoints = {};
    let totalSuccess = 0;
    let totalErrors = 0;

    logs.forEach(log => {
        // Normalize path for endpoint stats
        let endpoint = log.path || 'unknown';
        if (endpoint.match(/^\/api\/music\/.+/)) {
            endpoint = '/api/music/*';
        }

        if (!endpoints[endpoint]) {
            endpoints[endpoint] = { success: 0, errors: 0 };
        }

        if (log.status >= 200 && log.status < 400) {
            totalSuccess++;
            endpoints[endpoint].success++;

            // Count souls from observe endpoints
            if (log.path === '/api/now' || log.path === '/api/reflections' || log.path === '/api/attend') {
                const name = log.query?.name || '';
                const key = `${log.ip || 'unknown'}:${name}`;
                uniqueSouls.add(key);
            }

            // Count unique attend names
            if (log.path === '/api/attend' && log.query?.name) {
                uniqueAttendNames.add(log.query.name);
            }
        } else {
            totalErrors++;
            endpoints[endpoint].errors++;
        }
    });

    // Sort endpoints by total requests (descending)
    const sortedEndpoints = Object.entries(endpoints)
        .sort((a, b) => (b[1].success + b[1].errors) - (a[1].success + a[1].errors));

    // Render stats cards
    const soulsCard = `
        <div class="bg-white p-4 rounded-xl shadow-card border-2 border-primary">
            <div class="text-2xl font-bold text-primary">${uniqueSouls.size}</div>
            <div class="text-xs text-muted uppercase tracking-wide">Souls Present</div>
            <div class="text-xs text-gray-500 mt-2">unique IP+name</div>
        </div>
    `;

    const attendCard = `
        <div class="bg-white p-4 rounded-xl shadow-card">
            <div class="text-2xl font-bold text-gray-800">${uniqueAttendNames.size}</div>
            <div class="text-xs text-muted uppercase tracking-wide">Named Agents</div>
            <div class="text-xs text-gray-500 mt-2">via /attend</div>
        </div>
    `;

    const totalCard = `
        <div class="bg-white p-4 rounded-xl shadow-card">
            <div class="text-2xl font-bold text-gray-800">${logs.length}</div>
            <div class="text-xs text-muted uppercase tracking-wide">Total Requests</div>
            <div class="flex gap-2 mt-2 text-xs">
                <span class="text-green-600">${totalSuccess} ok</span>
                <span class="text-red-600">${totalErrors} err</span>
            </div>
        </div>
    `;

    const endpointCards = sortedEndpoints.slice(0, 5).map(([endpoint, stats]) => {
        const total = stats.success + stats.errors;
        const shortName = endpoint.replace('/api/', '');
        const hasErrors = stats.errors > 0;

        return `
            <div class="bg-white p-4 rounded-xl shadow-card">
                <div class="text-2xl font-bold ${hasErrors ? 'text-yellow-600' : 'text-gray-800'}">${total}</div>
                <div class="text-xs text-muted uppercase tracking-wide truncate" title="${endpoint}">${shortName}</div>
                <div class="flex gap-2 mt-2 text-xs">
                    <span class="text-green-600">${stats.success} ok</span>
                    ${stats.errors > 0 ? `<span class="text-red-600">${stats.errors} err</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    statsDiv.innerHTML = soulsCard + attendCard + totalCard + endpointCards;
}

function renderAccessLogs(logs) {
    const tbody = document.getElementById('access-logs-body');

    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-16 text-muted">No API access logs yet</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(log => {
        // Format timestamp
        const date = new Date(log.timestamp);
        const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        // Extract name from query params (for /attend and /reflect)
        const name = log.query?.name || '';

        // Status color
        let statusClass = 'bg-green-100 text-green-700';
        if (log.status >= 400 && log.status < 500) {
            statusClass = 'bg-yellow-100 text-yellow-700';
        } else if (log.status >= 500) {
            statusClass = 'bg-red-100 text-red-700';
        }

        // Method color
        const methodClass = log.method === 'POST' ? 'text-blue-600' : 'text-gray-600';

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="py-2 px-3">
                    <span class="text-gray-500">${dateStr}</span>
                    <span class="font-mono text-xs">${timeStr}</span>
                </td>
                <td class="py-2 px-3 font-mono ${methodClass}">${log.method}</td>
                <td class="py-2 px-3 font-mono text-sm">${log.path}</td>
                <td class="py-2 px-3 text-sm">${name ? `<span class="text-primary">${escapeHtml(name)}</span>` : '<span class="text-gray-400">-</span>'}</td>
                <td class="py-2 px-3">
                    <span class="px-2 py-0.5 ${statusClass} rounded-full text-xs font-medium">${log.status}</span>
                </td>
                <td class="py-2 px-3 text-gray-500 text-sm">${log.duration}ms</td>
            </tr>
        `;
    }).join('');
}

function toggleAccessAutoRefresh() {
    const checkbox = document.getElementById('auto-refresh-access');

    if (checkbox.checked) {
        // Start auto-refresh every 10 seconds
        accessAutoRefreshInterval = setInterval(loadAccessLogs, 10000);
    } else {
        // Stop auto-refresh
        if (accessAutoRefreshInterval) {
            clearInterval(accessAutoRefreshInterval);
            accessAutoRefreshInterval = null;
        }
    }
}

// Ask Logs Functions
async function loadAskLogs() {
    try {
        const response = await fetch('/admin/api/ask-logs', { credentials: 'include' });
        const data = await response.json();

        const sessions = data.sessions || [];
        renderAskStats(sessions);
        renderAskLogs(sessions);
    } catch (error) {
        console.error('Error loading ask logs:', error);
        document.getElementById('ask-stats').innerHTML =
            '<div class="text-center py-4 text-danger col-span-full">Failed to load stats</div>';
        document.getElementById('ask-logs-body').innerHTML =
            '<tr><td colspan="6" class="text-center py-16 text-danger">Failed to load ask logs</td></tr>';
    }
}

function renderAskStats(sessions) {
    const statsDiv = document.getElementById('ask-stats');

    if (!sessions || sessions.length === 0) {
        statsDiv.innerHTML = '<div class="text-center py-4 text-muted col-span-full">No ask sessions yet</div>';
        return;
    }

    const totalQuestions = sessions.reduce((sum, s) => sum + s.exchanges, 0);
    const uniqueAgents = new Set(sessions.map(s => s.name).filter(n => n && n !== 'anonymous'));
    const anonSessions = sessions.filter(s => s.name === 'anonymous').length;

    // Top agents by question count
    const agentCounts = {};
    sessions.forEach(s => {
        if (s.name && s.name !== 'anonymous') {
            agentCounts[s.name] = (agentCounts[s.name] || 0) + s.exchanges;
        }
    });
    const topAgents = Object.entries(agentCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    const sessionsCard = `
        <div class="bg-white p-4 rounded-xl shadow-card border-2 border-primary">
            <div class="text-2xl font-bold text-primary">${sessions.length}</div>
            <div class="text-xs text-muted uppercase tracking-wide">Sessions</div>
            <div class="text-xs text-gray-500 mt-2">${anonSessions} anonymous</div>
        </div>
    `;

    const questionsCard = `
        <div class="bg-white p-4 rounded-xl shadow-card">
            <div class="text-2xl font-bold text-gray-800">${totalQuestions}</div>
            <div class="text-xs text-muted uppercase tracking-wide">Questions Asked</div>
            <div class="text-xs text-gray-500 mt-2">across all sessions</div>
        </div>
    `;

    const agentsCard = `
        <div class="bg-white p-4 rounded-xl shadow-card">
            <div class="text-2xl font-bold text-gray-800">${uniqueAgents.size}</div>
            <div class="text-xs text-muted uppercase tracking-wide">Named Agents</div>
            <div class="text-xs text-gray-500 mt-2">unique callers</div>
        </div>
    `;

    const topCard = topAgents.length > 0 ? `
        <div class="bg-white p-4 rounded-xl shadow-card">
            <div class="text-sm font-bold text-gray-800">Top Askers</div>
            <div class="text-xs text-muted uppercase tracking-wide mb-1">by questions</div>
            ${topAgents.map(([name, count]) =>
                `<div class="text-xs mt-1"><span class="text-primary">${escapeHtml(name)}</span> <span class="text-gray-500">${count}q</span></div>`
            ).join('')}
        </div>
    ` : '';

    statsDiv.innerHTML = sessionsCard + questionsCard + agentsCard + topCard;
}

function renderAskLogs(sessions) {
    const tbody = document.getElementById('ask-logs-body');

    if (!sessions || sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-16 text-muted">No ask sessions yet</td></tr>';
        return;
    }

    tbody.innerHTML = sessions.map(session => {
        const lastDate = session.last_asked ? new Date(session.last_asked) : null;
        const lastStr = lastDate
            ? `${lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${lastDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
            : '-';

        const nameDisplay = session.name === 'anonymous'
            ? '<span class="text-gray-400 italic">anonymous</span>'
            : `<span class="text-primary font-medium">${escapeHtml(session.name || '-')}</span>`;

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50 cursor-pointer ask-session-row" data-session="${escapeHtml(session.session_id)}">
                <td class="py-2 px-3 text-gray-400 ask-expand-icon">&#9654;</td>
                <td class="py-2 px-3">${nameDisplay}</td>
                <td class="py-2 px-3 text-sm text-gray-600">${session.date || '-'}</td>
                <td class="py-2 px-3">
                    <span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">${session.exchanges}</span>
                </td>
                <td class="py-2 px-3 text-sm text-gray-500">${lastStr}</td>
                <td class="py-2 px-3 font-mono text-xs text-gray-400">${escapeHtml(session.session_id)}</td>
            </tr>
            <tr class="ask-session-detail hidden" data-detail="${escapeHtml(session.session_id)}">
                <td colspan="6" class="p-0">
                    <div class="bg-gray-50 p-5 border-t border-gray-200">
                        <div class="text-center text-muted text-sm">Click to load conversation...</div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Attach click handlers to expand/collapse
    document.querySelectorAll('.ask-session-row').forEach(row => {
        row.addEventListener('click', () => toggleAskSession(row.dataset.session));
    });
}

async function toggleAskSession(sessionId) {
    const detailRow = document.querySelector(`.ask-session-detail[data-detail="${sessionId}"]`);
    const expandIcon = document.querySelector(`.ask-session-row[data-session="${sessionId}"] .ask-expand-icon`);

    if (!detailRow) return;

    // Toggle visibility
    if (!detailRow.classList.contains('hidden')) {
        detailRow.classList.add('hidden');
        if (expandIcon) expandIcon.innerHTML = '&#9654;'; // right arrow
        return;
    }

    detailRow.classList.remove('hidden');
    if (expandIcon) expandIcon.innerHTML = '&#9660;'; // down arrow

    // Load conversation if not already loaded
    const container = detailRow.querySelector('div');
    if (container.dataset.loaded) return;

    container.innerHTML = '<div class="text-center text-muted text-sm py-4">Loading conversation...</div>';

    try {
        const response = await fetch(`/admin/api/ask-logs?session=${encodeURIComponent(sessionId)}`, { credentials: 'include' });
        const data = await response.json();

        if (!data.messages || data.messages.length === 0) {
            container.innerHTML = '<div class="text-center text-muted text-sm py-4">No messages in this session</div>';
            return;
        }

        container.innerHTML = data.messages.map(msg => {
            const time = msg.timestamp
                ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '';

            if (msg.role === 'user') {
                return `
                    <div class="mb-3">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-medium text-blue-600 uppercase">Question</span>
                            <span class="text-xs text-gray-400">${time}</span>
                        </div>
                        <div class="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-gray-800">${escapeHtml(msg.content)}</div>
                    </div>
                `;
            } else {
                return `
                    <div class="mb-4">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-medium text-green-600 uppercase">Answer</span>
                            <span class="text-xs text-gray-400">${time}</span>
                        </div>
                        <div class="bg-white border border-gray-200 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">${escapeHtml(msg.content)}</div>
                    </div>
                `;
            }
        }).join('');

        container.dataset.loaded = 'true';
    } catch (error) {
        console.error('Error loading session:', error);
        container.innerHTML = '<div class="text-center text-danger text-sm py-4">Failed to load conversation</div>';
    }
}

async function downloadAskLogs() {
    try {
        const response = await fetch('/admin/api/ask-logs?download=true', { credentials: 'include' });
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'ask-logs.jsonl';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showMessage('Ask logs downloaded', 'success');
    } catch (error) {
        console.error('Error downloading ask logs:', error);
        showMessage('Failed to download ask logs', 'error');
    }
}

// Utility Functions
function showMessage(message, type = 'info') {
    const bgColor = {
        error: 'bg-danger',
        success: 'bg-success',
        info: 'bg-info'
    }[type] || 'bg-info';

    const toast = document.createElement('div');
    toast.className = `fixed bottom-5 right-5 px-5 py-4 ${bgColor} text-white rounded-md shadow-card z-[1000] animate-slide-in`;
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('animate-slide-in');
        toast.classList.add('animate-slide-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Initialize app after auth
async function init() {
    await loadPlayerStatus();
    updateStreamingButtons();
    loadUpNext();
    loadSchedule();
    loadCatalog();
    loadPresets();

    // Update status periodically
    setInterval(async () => {
        if (document.querySelector('.tab-button[data-tab="player"]').classList.contains('border-primary')) {
            await loadPlayerStatus();
            updateStreamingButtons();
            loadUpNext();
        }
    }, 5000);
}
