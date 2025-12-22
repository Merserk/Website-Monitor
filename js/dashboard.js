// dashboard.js - UI for the management dashboard page

const monitorsEl = document.getElementById('monitors');
const selectBtn = document.getElementById('selectBtn');
const checkAllBtn = document.getElementById('checkAllBtn');
const globalIntervalEl = document.getElementById('globalInterval');
const toggleAllBtn = document.getElementById('toggleAllBtn');
const maxConcurrencyEl = document.getElementById('maxConcurrency');
const urlEl = document.getElementById('url');
const globalCountdownEl = document.getElementById('global-countdown');
const emptyBinBtn = document.getElementById('emptyBinBtn');
const addMonitorSection = document.querySelector('.add-monitor');

const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileEl = document.getElementById('importFile');

// View Switching Elements
const dashboardView = document.getElementById('dashboardView');
const settingsView = document.getElementById('settingsView');
const settingsToggleBtn = document.getElementById('settingsToggleBtn');
const backToDashboardBtn = document.getElementById('backToDashboardBtn');
const moveAllToBinBtn = document.getElementById('moveAllToBinBtn');
const dashboardHeader = document.querySelector('.dashboard-header');

// Tab elements
const tabBtns = document.querySelectorAll('.tab-btn');
let currentView = 'active'; // 'active' or 'bin'

let isGloballyRunning = false;
let monitorStatus = new Map(); // Track status: 'queued' or 'checking'

// --- Helpers ---

async function saveUiSettings() {
    const currentSettings = await getSettings();
    const interval = Number(globalIntervalEl.value);
    const maxConcurrency = Number(maxConcurrencyEl.value);
    if (interval < 1) { globalIntervalEl.value = 1; }
    if (maxConcurrency < 1) { maxConcurrencyEl.value = 1; }
    currentSettings.interval = interval >= 1 ? interval : 60;
    currentSettings.maxConcurrency = maxConcurrency >= 1 ? maxConcurrency : 1;
    await saveSettings(currentSettings);
}

function escapeHtml(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''; }

function openAndHighlight(monitor) {
    chrome.tabs.create({ url: monitor.url, active: true }, (tab) => {
        const tabId = tab.id;
        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: (selector) => {
                        const el = document.querySelector(selector);
                        if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            el.style.transition = 'all 0.5s ease';
                            el.style.outline = '5px solid #32d583';
                            el.style.backgroundColor = 'rgba(50, 213, 131, 0.3)';
                            setTimeout(() => {
                                el.style.outline = '';
                                el.style.backgroundColor = '';
                            }, 4000);
                        }
                    },
                    args: [monitor.selector]
                });
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
    if (monitor.changed) {
        chrome.runtime.sendMessage({ type: 'acknowledge', id: monitor.id });
    }
}

// --- Chrome Message Listener ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'checkQueued') {
        monitorStatus.set(msg.id, 'queued');
        if (window.currentMonitors) renderMonitors(window.currentMonitors);
    } else if (msg.type === 'checkStarted') {
        monitorStatus.set(msg.id, 'checking');
        if (window.currentMonitors) renderMonitors(window.currentMonitors);
    } else if (msg.type === 'checkEnded') {
        monitorStatus.delete(msg.id);
        loadAndRender();
    } else if (msg.type === 'queueCleared') {
        // Remove all queued items
        for (const [id, status] of monitorStatus.entries()) {
            if (status === 'queued') monitorStatus.delete(id);
        }
        if (window.currentMonitors) renderMonitors(window.currentMonitors);
    }
});

// --- Tab Logic ---
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.getAttribute('data-view');

        // Show/Hide Empty Bin button
        if (currentView === 'bin') {
            emptyBinBtn.style.display = 'block';
        } else {
            emptyBinBtn.style.display = 'none';
        }

        if (window.currentMonitors) {
            renderMonitors(window.currentMonitors);
        }
    });
});

// --- Rendering ---
function updateTabCounts(list) {
    if (!list) return;
    const activeCount = list.filter(m => !m.deleted).length;
    const binCount = list.filter(m => m.deleted).length;

    const activeTab = document.querySelector('.tab-btn[data-view="active"]');
    const binTab = document.querySelector('.tab-btn[data-view="bin"]');

    if (activeTab) activeTab.textContent = `Active Monitors (${activeCount})`;
    if (binTab) {
        binTab.textContent = `Recycle Bin (${binCount})`;
        binTab.style.display = binCount > 0 ? 'inline-flex' : 'none';

        // Also hide the whole tabs container if only one tab is visible? 
        // No, keep active tab visible for consistency.
    }

    // Auto-switch back to active if bin becomes empty while viewing it
    if (binCount === 0 && currentView === 'bin') {
        currentView = 'active';
        if (activeTab) activeTab.classList.add('active');
        if (binTab) binTab.classList.remove('active');
        if (emptyBinBtn) emptyBinBtn.style.display = 'none';
    }
}

function renderMonitors(list) {
    updateTabCounts(list);
    monitorsEl.innerHTML = '';

    // Show/Hide Add Monitor section based on view
    if (addMonitorSection) {
        addMonitorSection.style.display = currentView === 'active' ? 'flex' : 'none';
    }

    // Filter based on view
    const filteredList = list.filter(m => {
        if (currentView === 'bin') return m.deleted;
        return !m.deleted;
    });

    if (filteredList.length === 0) {
        if (currentView === 'bin') {
            monitorsEl.innerHTML = '<p class="no-monitors">Recycle Bin is empty.</p>';
        } else {
            monitorsEl.innerHTML = '<p class="no-monitors">You have no monitors set up. Add one above to get started!</p>';
        }
        return;
    }

    // Sort: Favorites first for Active view
    if (currentView === 'active') {
        filteredList.sort((a, b) => (b.isFavorite === a.isFavorite) ? 0 : b.isFavorite ? 1 : -1);
    }

    const favoriteCount = list.filter(m => m.isFavorite && !m.deleted).length;
    const favoriteLimitReached = favoriteCount >= 10;

    filteredList.forEach((m) => {
        const el = document.createElement('div');
        // Base class
        let classes = ['monitor', 'collapsed'];
        if (monitorStatus.get(m.id) === 'checking') {
            classes.push('checking');
        }
        el.className = classes.join(' ');

        const header = document.createElement('div');
        header.className = 'monitor-header';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'monitor-title';

        const favIconUrl = m.favIconUrl || `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(m.url)}`;
        const icon = document.createElement('img');
        icon.src = favIconUrl;
        icon.className = 'monitor-favicon';
        icon.alt = '';
        titleDiv.appendChild(icon);

        const a = document.createElement('a');
        a.href = m.url;
        a.target = '_blank';
        a.textContent = m.title || m.url;
        // Don't show update status in bin
        if (currentView === 'active') {
            a.className = 'monitor-link' + (m.changed ? ' updated' : '') + (m.lastCheckFailed ? ' failed' : '');
        } else {
            a.className = 'monitor-link';
        }

        a.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentView === 'active') {
                e.preventDefault();
                openAndHighlight(m);
            }
        });

        titleDiv.appendChild(a);

        const controls = document.createElement('div');
        controls.className = 'controls';
        const row = document.createElement('div');
        row.className = 'row';

        if (currentView === 'active') {
            // --- ACTIVE VIEW BUTTONS ---
            const openBtn = document.createElement('button');
            openBtn.className = 'small';
            openBtn.textContent = 'Open';
            openBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openAndHighlight(m);
            });

            // --- EDIT BUTTON ---
            const editBtn = document.createElement('button');
            editBtn.className = 'small';
            editBtn.textContent = 'Edit';
            editBtn.title = 'Re-select element for this monitor';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();

                chrome.tabs.create({ url: m.url, active: true }, (tab) => {
                    const tabId = tab.id;
                    const listener = (updatedTabId, changeInfo) => {
                        if (updatedTabId === tabId && changeInfo.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);

                            // 1. Inject the selector script
                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                files: ['js/selector.js']
                            }, () => {
                                // 2. Call the init function with the monitor ID
                                chrome.scripting.executeScript({
                                    target: { tabId: tabId },
                                    func: (id) => {
                                        if (window.initWebsiteMonitorSelector) {
                                            window.initWebsiteMonitorSelector(id);
                                        }
                                    },
                                    args: [m.id]
                                });
                            });
                        }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                });
            });

            const favoriteBtn = document.createElement('button');
            favoriteBtn.className = 'small favorite-btn';
            favoriteBtn.textContent = 'Favorite';
            favoriteBtn.title = 'Toggle Favorite';

            if (m.isFavorite) {
                favoriteBtn.classList.add('active');
            }

            if (favoriteLimitReached && !m.isFavorite) {
                favoriteBtn.disabled = true;
                favoriteBtn.title = 'You can only have 10 favorites.';
            }

            favoriteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                const currentMonitors = await getMonitors();
                const currentFavoriteCount = currentMonitors.filter(mon => mon.isFavorite && !mon.deleted).length;

                if (!m.isFavorite && currentFavoriteCount >= 10) {
                    alert('You can only select a maximum of 10 favorite monitors.');
                    return;
                }

                chrome.runtime.sendMessage({ type: 'toggleFavorite', id: m.id });
            });

            const checkBtn = document.createElement('button');
            checkBtn.className = 'small status-btn';

            const status = monitorStatus.get(m.id);
            const isQueued = status === 'queued';
            const isChecking = status === 'checking';

            if (isChecking) checkBtn.textContent = 'Checking...';
            else if (isQueued) checkBtn.textContent = 'Queued...';
            else checkBtn.textContent = 'Check now';

            checkBtn.disabled = isQueued || isChecking;

            checkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                monitorStatus.set(m.id, 'queued');
                checkBtn.textContent = 'Queued...';
                checkBtn.disabled = true;
                chrome.runtime.sendMessage({ type: 'checkNow', id: m.id });

                setTimeout(() => {
                    if (monitorStatus.has(m.id)) {
                        monitorStatus.delete(m.id);
                        // Check if element still exists before updating
                        if (!checkBtn.disabled) return;
                        checkBtn.textContent = 'Check now';
                        checkBtn.disabled = false;
                    }
                }, 30000);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'small';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                chrome.runtime.sendMessage({ type: 'delete', id: m.id });
            });

            row.append(openBtn, editBtn, favoriteBtn, checkBtn, delBtn);

        } else {
            // --- RECYCLE BIN BUTTONS ---
            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'small restore';
            restoreBtn.textContent = 'Restore';
            restoreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                chrome.runtime.sendMessage({ type: 'restore', id: m.id });
            });

            const hardDelBtn = document.createElement('button');
            hardDelBtn.className = 'small danger';
            hardDelBtn.textContent = 'Delete Forever';
            hardDelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Are you sure? This cannot be undone.')) {
                    chrome.runtime.sendMessage({ type: 'hardDelete', id: m.id });
                }
            });

            row.append(restoreBtn, hardDelBtn);
        }

        controls.append(row);
        header.append(titleDiv, controls);

        const details = document.createElement('div');
        details.className = 'monitor-details';
        const info = document.createElement('div');
        info.className = 'info-grid';
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'small';
        selectorDiv.innerHTML = `monitoring selector: <span class="badge">${escapeHtml(m.selector)}</span>`;
        info.appendChild(selectorDiv);
        const lastCheckedDiv = document.createElement('div');
        lastCheckedDiv.className = 'small';
        lastCheckedDiv.innerHTML = `last: ${m.lastChecked ? new Date(m.lastChecked).toLocaleString() : 'never'}`;
        info.appendChild(lastCheckedDiv);

        // Only show value details if active
        if (currentView === 'active') {
            const currentValueDiv = document.createElement('div');
            currentValueDiv.className = 'small';
            currentValueDiv.innerHTML = 'current value: ';
            const badge = document.createElement('span');
            badge.className = `badge ${m.currentValue === null && m.initialChecked ? 'badge-fail' : ''}`;
            const valueText = m.currentValue || 'not found';
            const TRUNCATE_LENGTH = 120;
            if (valueText.length > TRUNCATE_LENGTH) {
                const visibleSpan = document.createElement('span');
                visibleSpan.textContent = escapeHtml(valueText.substring(0, TRUNCATE_LENGTH));
                const hiddenSpan = document.createElement('span');
                hiddenSpan.style.display = 'none';
                hiddenSpan.textContent = escapeHtml(valueText.substring(TRUNCATE_LENGTH));
                const toggleLink = document.createElement('a');
                toggleLink.href = '#';
                toggleLink.className = 'toggle-more';
                toggleLink.textContent = '... Show more';
                toggleLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const isHidden = hiddenSpan.style.display === 'none';
                    hiddenSpan.style.display = isHidden ? 'inline' : 'none';
                    toggleLink.textContent = isHidden ? ' Show less' : '... Show more';
                });
                badge.append(visibleSpan, hiddenSpan, toggleLink);
            } else {
                badge.textContent = escapeHtml(valueText);
            }
            currentValueDiv.appendChild(badge);
            info.appendChild(currentValueDiv);

            const statusDiv = document.createElement('div');
            statusDiv.className = 'small status-text';
            if (m.lastCheckFailed) {
                const fullErrorText = "Check failed (element not found). Please log in to the website if you haven't already. Check the website's availability. Check your internet connection. The element may have been removed from the website. Try again.";
                const ERROR_TRUNCATE = 65;

                const failSpan = document.createElement('span');
                failSpan.className = 'status-failed';

                if (fullErrorText.length > ERROR_TRUNCATE) {
                    const visibleSpan = document.createElement('span');
                    visibleSpan.textContent = fullErrorText.substring(0, ERROR_TRUNCATE);

                    const hiddenSpan = document.createElement('span');
                    hiddenSpan.style.display = 'none';
                    hiddenSpan.textContent = fullErrorText.substring(ERROR_TRUNCATE);

                    const toggleLink = document.createElement('a');
                    toggleLink.href = '#';
                    toggleLink.className = 'toggle-more'; // Re-use same class for styling
                    toggleLink.textContent = '... Show more';
                    toggleLink.style.marginLeft = '5px';

                    toggleLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const isHidden = hiddenSpan.style.display === 'none';
                        hiddenSpan.style.display = isHidden ? 'inline' : 'none';
                        toggleLink.textContent = isHidden ? ' Show less' : '... Show more';
                    });

                    failSpan.append(visibleSpan, hiddenSpan, toggleLink);
                } else {
                    failSpan.textContent = fullErrorText;
                }
                statusDiv.appendChild(failSpan);
            } else if (m.changed) {
                statusDiv.innerHTML = '<span class="status-updated">Update detected! Click link to view.</span>';
            } else {
                statusDiv.innerHTML = '<span class="status-up">No change</span>';
            }
            info.appendChild(statusDiv);
            if (m.lastCheckDebug) {
                const { foundValue, extractedTextSnippet } = m.lastCheckDebug;
                const debugDetails = document.createElement('div');
                debugDetails.className = 'debug-container';
                debugDetails.innerHTML = `<details class="debug-details"><summary>Debug Info</summary><div class="debug-info"><strong>Found Value:</strong> <pre>${escapeHtml(foundValue) || 'null'}</pre><strong>Extracted Page Snippet:</strong><pre class="snippet">${escapeHtml(extractedTextSnippet)}</pre></div></details>`;
                info.appendChild(debugDetails);
            }
        } else {
            const deletedNotice = document.createElement('div');
            deletedNotice.className = 'small';
            deletedNotice.style.color = '#ffb3b3';
            deletedNotice.textContent = 'This monitor is in the Recycle Bin and is not being checked.';
            info.appendChild(deletedNotice);
        }

        details.appendChild(info);
        header.addEventListener('click', () => {
            el.classList.toggle('collapsed');
        });
        el.append(header, details);
        monitorsEl.appendChild(el);
    });

    const isAnyActive = monitorStatus.size > 0;
    const playIcon = document.getElementById('checkIconPlay');
    const stopIcon = document.getElementById('checkIconStop');

    if (playIcon && stopIcon) {
        playIcon.style.display = isAnyActive ? 'none' : 'block';
        stopIcon.style.display = isAnyActive ? 'block' : 'none';
        checkAllBtn.title = isAnyActive ? 'Force Stop All Checks' : 'Check All Now';
        if (isAnyActive) {
            checkAllBtn.classList.add('danger-mode');
        } else {
            checkAllBtn.classList.remove('danger-mode');
        }
    }
    checkAllBtn.disabled = false;
}

function timeRemainingStr(nextTs, isRunning) {
    if (!isRunning || !nextTs) return 'stopped';
    const ms = nextTs - Date.now();
    if (ms <= 0) return 'checking...';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return (min > 0) ? `${min}m ${sec}s` : `${sec}s`;
}

function updateGlobalCountdown() {
    if (!window.currentMonitors || !isGloballyRunning) {
        globalCountdownEl.textContent = 'Monitoring is stopped';
        return;
    }

    const runningMonitors = window.currentMonitors.filter(m => m.running && m.nextCheckTime && !m.deleted);

    if (runningMonitors.length === 0) {
        globalCountdownEl.textContent = 'No monitors are scheduled to run';
        return;
    }

    const soonestNextCheck = Math.min(...runningMonitors.map(m => m.nextCheckTime));

    const timeStr = timeRemainingStr(soonestNextCheck, true);
    if (timeStr === 'checking...') {
        globalCountdownEl.textContent = 'Checking in progress...';
    } else {
        globalCountdownEl.textContent = `Next update check in ${timeStr}`;
    }
}

async function syncCheckStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'getCheckStatus' });
        if (response) {
            response.queued.forEach(id => monitorStatus.set(id, 'queued'));
            response.checking.forEach(id => monitorStatus.set(id, 'checking'));

            // Sync Header Icons
            const isManualChecking = response.queued.length > 0 || response.checking.length > 0;
            document.getElementById('checkIconPlay').style.display = isManualChecking ? 'none' : 'block';
            document.getElementById('checkIconStop').style.display = isManualChecking ? 'block' : 'none';
            checkAllBtn.title = isManualChecking ? 'Force Stop All Checks' : 'Check All Now';
            if (isManualChecking) {
                checkAllBtn.classList.add('danger-mode');
            } else {
                checkAllBtn.classList.remove('danger-mode');
            }

            if (window.currentMonitors) renderMonitors(window.currentMonitors);
        }
    } catch (e) { }
}

async function loadAndRender() {
    const [monitors, settings] = await Promise.all([getMonitors(), getSettings()]);
    window.currentMonitors = monitors;
    isGloballyRunning = settings.isRunning;
    globalIntervalEl.value = settings.interval;
    maxConcurrencyEl.value = settings.maxConcurrency;

    // SVG Toggle Logic
    const isRunning = settings.isRunning;
    toggleAllBtn.title = isRunning ? 'Stop All Monitoring' : 'Start All Monitoring';
    if (isRunning) toggleAllBtn.classList.add('danger-mode');
    else toggleAllBtn.classList.remove('danger-mode');

    toggleAllBtn.disabled = false;
    renderMonitors(monitors);
    updateGlobalCountdown();
    syncCheckStatus();
}

// --- Event Listeners ---
selectBtn.addEventListener('click', async () => {
    const url = urlEl.value.trim();
    if (!url || !url.startsWith('http')) {
        return alert('Please enter a valid URL to begin selection.');
    }

    chrome.tabs.create({ url, active: true }, (tab) => {
        const tabId = tab.id;
        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                // 1. Inject the selector script
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['js/selector.js']
                }, () => {
                    // 2. Call the init function with NULL (Add Mode)
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        func: () => {
                            if (window.initWebsiteMonitorSelector) {
                                window.initWebsiteMonitorSelector(null);
                            }
                        }
                    });
                });
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
});

checkAllBtn.addEventListener('click', () => {
    const isForceStop = document.getElementById('checkIconStop').style.display === 'block';

    if (isForceStop) {
        chrome.runtime.sendMessage({ type: 'stopChecks' });
        // Optimistic cleanup
        for (const [id, status] of monitorStatus.entries()) {
            if (status === 'queued') monitorStatus.delete(id);
        }
        document.getElementById('checkIconPlay').style.display = 'block';
        document.getElementById('checkIconStop').style.display = 'none';
        checkAllBtn.title = 'Check All Now';
        checkAllBtn.classList.remove('danger-mode');
        if (window.currentMonitors) renderMonitors(window.currentMonitors);
        return;
    }

    chrome.runtime.sendMessage({ type: 'checkAll' });
    // Optimistic queuing
    document.getElementById('checkIconPlay').style.display = 'none';
    document.getElementById('checkIconStop').style.display = 'block';
    checkAllBtn.title = 'Force Stop All Checks';
    checkAllBtn.classList.add('danger-mode');
    if (window.currentMonitors) {
        window.currentMonitors.forEach(m => !m.deleted && monitorStatus.set(m.id, 'queued'));
        renderMonitors(window.currentMonitors);
    }
});

toggleAllBtn.addEventListener('click', () => {
    const newIsRunning = !isGloballyRunning;
    const interval = Number(globalIntervalEl.value) || 60;
    const maxConcurrency = Number(maxConcurrencyEl.value) || 1;
    toggleAllBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'toggleAll', payload: { isRunning: newIsRunning, interval, maxConcurrency } });
    // Optimistic update
    isGloballyRunning = newIsRunning;
    toggleAllBtn.title = isGloballyRunning ? 'Stop All Monitoring' : 'Start All Monitoring';
    if (isGloballyRunning) toggleAllBtn.classList.add('danger-mode');
    else toggleAllBtn.classList.remove('danger-mode');
    toggleAllBtn.disabled = false;
});

emptyBinBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to permanently delete all items in the Recycle Bin?')) {
        chrome.runtime.sendMessage({ type: 'emptyBin' });
    }
});

// Spin Buttons
document.querySelectorAll('.spin-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const action = btn.getAttribute('data-action');
        const input = document.getElementById(targetId);
        if (!input) return;

        let val = Number(input.value) || 0;
        const min = Number(input.getAttribute('min')) || 0;

        if (action === 'increase') {
            val++;
        } else if (action === 'decrease') {
            val--;
        }

        if (val < min) val = min;
        input.value = val;
        input.dispatchEvent(new Event('change'));
    });
});

globalIntervalEl.addEventListener('change', saveUiSettings);
maxConcurrencyEl.addEventListener('change', saveUiSettings);

exportBtn.addEventListener('click', exportData);
importBtn.addEventListener('click', () => importFileEl.click());
importFileEl.addEventListener('change', (event) => {
    importData(event.target.files[0]);
    event.target.value = null;
});

moveAllToBinBtn.addEventListener('click', () => {
    if (confirm('Move all Active Monitors to the Recycle Bin?')) {
        chrome.runtime.sendMessage({ type: 'moveAllToBin' }, (response) => {
            if (response && response.ok) {
                loadAndRender();
            }
        });
        // Switch back to dashboard and reset to Active view
        switchView('dashboard');
        currentView = 'active';
        tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === 'active');
        });
    }
});

// View Switching Logic
function switchView(view) {
    if (view === 'settings') {
        dashboardView.style.display = 'none';
        settingsView.style.display = 'block';
        dashboardHeader.style.display = 'none';
    } else {
        dashboardView.style.display = 'block';
        settingsView.style.display = 'none';
        dashboardHeader.style.display = 'flex';
    }
}

settingsToggleBtn.addEventListener('click', () => {
    const isSettingsVisible = settingsView.style.display === 'block';
    switchView(isSettingsVisible ? 'dashboard' : 'settings');
});

backToDashboardBtn.addEventListener('click', () => {
    switchView('dashboard');
});

setInterval(updateGlobalCountdown, 1000);

chrome.storage.onChanged.addListener((changes, namespace) => {
    // NOW WATCHING 'local' FOR CONFIG (since we migrated off sync)
    if (namespace === 'local' && (changes.monitors_config || changes.globalSettings)) {
        if (changes.monitors_config && changes.monitors_config.newValue) {
            const updatedMonitors = changes.monitors_config.newValue;
            updatedMonitors.forEach(m => {
                if (monitorStatus.has(m.id)) {
                    monitorStatus.delete(m.id);
                }
            });
        }
        loadAndRender();
    }
    // Also watch for individual state changes which are also active in local
    if (namespace === 'local' && Object.keys(changes).some(key => key.startsWith('monitor_state_'))) {
        Object.keys(changes).forEach(key => {
            if (key.startsWith('monitor_state_')) {
                const monitorId = key.replace('monitor_state_', '');
                monitorStatus.delete(monitorId);
            }
        });
        loadAndRender();
    }
});

// Stats Logic
function loadStats() {
    chrome.storage.local.get(['stats'], (result) => {
        const stats = result.stats || {};
        const count = stats.totalChecks || 0;
        const el = document.getElementById('totalCheckCount');
        if (el) el.textContent = count;
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.stats) {
        const newVal = changes.stats.newValue || {};
        const count = newVal.totalChecks || 0;
        const el = document.getElementById('totalCheckCount');
        if (el) el.textContent = count;
    }
});

loadStats();
loadAndRender();
