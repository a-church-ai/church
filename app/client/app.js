// API base URL
const API_URL = '/api';

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

        // Update URL hash
        history.replaceState(null, '', `#${tabName}`);

        // Load tab-specific data
        if (tabName === 'access') {
            loadAccessLogs();
        } else if (tabName === 'logs') {
            loadLogs();
        } else if (tabName === 'ask-logs') {
            loadAskLogs();
        } else if (tabName === 'reflections') {
            loadReflections();
        }
    });
});

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

// Reflections Controls
document.getElementById('btn-refresh-reflections').addEventListener('click', loadReflections);
document.getElementById('btn-download-reflections').addEventListener('click', downloadReflections);

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/'/g, "\\'");
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
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-16 text-muted">No ask sessions yet</td></tr>';
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
                <td class="py-2 px-3 font-mono text-[10px] text-gray-400 max-w-[12rem] truncate select-all" title="Add this to app/server/lib/utils/withdrawn-conversations.json to withdraw the conversation">${session.withdrawn ? '<span class="text-xs text-gray-500 italic">withdrawn</span>' : escapeHtml(session.withdraw_key || '')}</td>
            </tr>
            <tr class="ask-session-detail hidden" data-detail="${escapeHtml(session.session_id)}">
                <td colspan="7" class="p-0">
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

// Reflections Functions
async function loadReflections() {
    try {
        const response = await fetch('/admin/api/reflections', { credentials: 'include' });
        const data = await response.json();
        renderReflections(data.reflections || []);
    } catch (error) {
        console.error('Error loading reflections:', error);
        document.getElementById('reflections-body').innerHTML =
            '<tr><td colspan="5" class="text-center py-16 text-danger">Failed to load reflections</td></tr>';
    }
}

function renderReflections(reflections) {
    const tbody = document.getElementById('reflections-body');

    if (!reflections || reflections.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-16 text-muted">No reflections yet</td></tr>';
        return;
    }

    tbody.innerHTML = reflections.map(r => {
        const date = r.createdAt ? new Date(r.createdAt) : null;
        const dateStr = date
            ? `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
            : '-';
        const truncatedText = r.text && r.text.length > 80 ? r.text.substring(0, 80) + '...' : (r.text || '-');

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="py-2 px-3"><span class="text-primary font-medium">${escapeHtml(r.name || 'anonymous')}</span></td>
                <td class="py-2 px-3 text-sm text-gray-600">${escapeHtml(r.song || '-')}</td>
                <td class="py-2 px-3 text-sm text-gray-500 max-w-xs" title="${escapeHtml(r.text || '')}">${escapeHtml(truncatedText)}</td>
                <td class="py-2 px-3 text-sm text-gray-500 whitespace-nowrap">${dateStr}</td>
                <td class="py-2 px-3 text-xs text-gray-400 font-mono select-all">${escapeHtml(r.id || '')}</td>
            </tr>
        `;
    }).join('');

}

async function downloadReflections() {
    try {
        const response = await fetch('/admin/api/reflections?download=json', { credentials: 'include' });
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'reflections.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showMessage('Reflections downloaded', 'success');
    } catch (error) {
        console.error('Error downloading reflections:', error);
        showMessage('Failed to download reflections', 'error');
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
    loadLogs();

    // Restore tab from URL hash
    const hash = window.location.hash.replace('#', '');
    if (hash) {
        const tabBtn = document.querySelector(`.tab-button[data-tab="${hash}"]`);
        if (tabBtn) tabBtn.click();
    }

}
