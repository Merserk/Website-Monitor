// dashboard.js - UI for the management dashboard page

const monitorsEl = document.getElementById('monitors');
const selectBtn = document.getElementById('selectBtn');
const checkAllBtn = document.getElementById('checkAllBtn');
const globalIntervalEl = document.getElementById('globalInterval');
const toggleAllBtn = document.getElementById('toggleAllBtn');
const maxConcurrencyEl = document.getElementById('maxConcurrency');
const urlEl = document.getElementById('url');
const globalCountdownEl = document.getElementById('global-countdown');

const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileEl = document.getElementById('importFile');

let isGloballyRunning = false;
let checkingMonitors = new Set(); // Track which monitors are currently being checked

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

function escapeHtml(s){ return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

// --- Rendering ---
function renderMonitors(list){
  monitorsEl.innerHTML = '';
  if (list.length === 0) {
      monitorsEl.innerHTML = '<p class="no-monitors">You have no monitors set up. Add one above to get started!</p>';
      return;
  }
  
  const favoriteCount = list.filter(m => m.isFavorite).length;
  const favoriteLimitReached = favoriteCount >= 10;

  list.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'monitor collapsed';

    const header = document.createElement('div');
    header.className = 'monitor-header';

    const titleDiv = document.createElement('div');
    titleDiv.className='monitor-title';
    
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
    a.className = 'monitor-link' + (m.changed ? ' updated' : '') + (m.lastCheckFailed ? ' failed' : '');

    a.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (m.changed) {
        e.preventDefault();
        window.open(m.url, '_blank');
        await chrome.runtime.sendMessage({ type: 'acknowledge', id: m.id });
      }
    });

    titleDiv.appendChild(a);

    const controls = document.createElement('div');
    controls.className='controls';
    const row = document.createElement('div');
    row.className='row';
    
    const openBtn = document.createElement('button');
    openBtn.className='small';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(m.url, '_blank');
    });

    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = 'small favorite-btn';
    favoriteBtn.innerHTML = '&#9733;';
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
        const currentFavoriteCount = currentMonitors.filter(mon => mon.isFavorite).length;

        if (!m.isFavorite && currentFavoriteCount >= 10) {
            alert('You can only select a maximum of 10 favorite monitors.');
            return;
        }

        chrome.runtime.sendMessage({ type: 'toggleFavorite', id: m.id });
    });

    const checkBtn = document.createElement('button');
    checkBtn.className='small';
    
    // Check if this monitor is currently being checked
    const isChecking = checkingMonitors.has(m.id);
    checkBtn.textContent = isChecking ? 'Checking...' : 'Check now';
    checkBtn.disabled = isChecking;
    
    checkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        checkingMonitors.add(m.id);
        chrome.runtime.sendMessage({ type: 'checkNow', id: m.id });
        checkBtn.textContent = 'Checking...';
        checkBtn.disabled = true;
        
        // Set a timeout to reset the button if no response comes back
        setTimeout(() => {
            checkingMonitors.delete(m.id);
            if (!checkBtn.disabled) return; // Already reset
            checkBtn.textContent = 'Check now';
            checkBtn.disabled = false;
        }, 30000); // 30 second timeout
    });
    
    const delBtn = document.createElement('button');
    delBtn.className='small';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'delete', id: m.id });
    });
    
    row.append(openBtn, favoriteBtn, checkBtn, delBtn);
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
        statusDiv.innerHTML = '<span class="status-failed">Check failed (element not found)</span>';
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
    details.appendChild(info);
    header.addEventListener('click', () => {
        el.classList.toggle('collapsed');
    });
    el.append(header, details);
    monitorsEl.appendChild(el);
  });
}

function timeRemainingStr(nextTs, isRunning){
  if (!isRunning || !nextTs) return 'stopped';
  const ms = nextTs - Date.now();
  if(ms <= 0) return 'checking...';
  const totalSec = Math.floor(ms/1000);
  const min = Math.floor(totalSec/60);
  const sec = totalSec % 60;
  return (min>0) ? `${min}m ${sec}s` : `${sec}s`;
}

function updateGlobalCountdown() {
    if (!window.currentMonitors || !isGloballyRunning) {
        globalCountdownEl.textContent = 'Monitoring is stopped';
        return;
    }

    const runningMonitors = window.currentMonitors.filter(m => m.running && m.nextCheckTime);

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

async function loadAndRender(){
  const [monitors, settings] = await Promise.all([getMonitors(), getSettings()]);
  window.currentMonitors = monitors;
  isGloballyRunning = settings.isRunning;
  globalIntervalEl.value = settings.interval;
  maxConcurrencyEl.value = settings.maxConcurrency;
  toggleAllBtn.textContent = isGloballyRunning ? 'Stop All Monitoring' : 'Start All Monitoring';
  toggleAllBtn.disabled = false;
  renderMonitors(monitors);
  updateGlobalCountdown();
}

// --- Event Listeners ---
selectBtn.addEventListener('click', async () => {
    const url = urlEl.value.trim();
    if (!url || !url.startsWith('http')) {
        return alert('Please enter a valid URL to begin selection.');
    }
    
    // Create a new tab and wait for it to be ready before injecting the script.
    chrome.tabs.create({ url, active: true }, (tab) => {
        const tabId = tab.id;

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                // Now that the tab is loaded, inject the selector script.
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['js/selector.js']
                });
                // Clean up the listener to avoid it firing again.
                chrome.tabs.onUpdated.removeListener(listener);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
});

checkAllBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'checkAll' });
    checkAllBtn.textContent = 'Checking...';
    checkAllBtn.disabled = true;
    
    // Mark all monitors as being checked
    if (window.currentMonitors) {
        window.currentMonitors.forEach(m => checkingMonitors.add(m.id));
        renderMonitors(window.currentMonitors);
    }
    
    // Set a timeout to reset the button if no response comes back
    setTimeout(() => {
        checkAllBtn.textContent = 'Check All';
        checkAllBtn.disabled = false;
        checkingMonitors.clear();
        if (window.currentMonitors) {
            renderMonitors(window.currentMonitors);
        }
    }, 30000); // 30 second timeout
});

toggleAllBtn.addEventListener('click', () => {
    const newIsRunning = !isGloballyRunning;
    const interval = Number(globalIntervalEl.value) || 60;
    const maxConcurrency = Number(maxConcurrencyEl.value) || 1;
    toggleAllBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'toggleAll', payload: { isRunning: newIsRunning, interval, maxConcurrency } });
});

globalIntervalEl.addEventListener('change', saveUiSettings);
maxConcurrencyEl.addEventListener('change', saveUiSettings);

exportBtn.addEventListener('click', exportData);
importBtn.addEventListener('click', () => importFileEl.click());
importFileEl.addEventListener('change', (event) => {
    importData(event.target.files[0]);
    event.target.value = null;
});

setInterval(updateGlobalCountdown, 1000);

chrome.storage.onChanged.addListener((changes, namespace) => {
  // Reset checking status when monitors update (check completed)
  if (namespace === 'sync' && (changes.monitors_config || changes.globalSettings)) {
    // Clear checking status for updated monitors
    if (changes.monitors_config && changes.monitors_config.newValue) {
      const updatedMonitors = changes.monitors_config.newValue;
      updatedMonitors.forEach(m => {
        if (checkingMonitors.has(m.id)) {
          checkingMonitors.delete(m.id);
        }
      });
    }
    loadAndRender();
  }
  if (namespace === 'local' && Object.keys(changes).some(key => key.startsWith('monitor_state_'))) {
    // Clear checking status when state updates
    Object.keys(changes).forEach(key => {
      if (key.startsWith('monitor_state_')) {
        const monitorId = key.replace('monitor_state_', '');
        checkingMonitors.delete(monitorId);
      }
    });
    loadAndRender();
  }
});

loadAndRender();