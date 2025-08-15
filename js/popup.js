// popup.js - Quick status view

const statusListEl = document.getElementById('status-list');
const openDashboardBtn = document.getElementById('openDashboardBtn');
const checkAllBtnPopup = document.getElementById('checkAllBtnPopup');
const selectElementBtn = document.getElementById('selectElementBtn');
const popupCountdownEl = document.getElementById('popup-countdown');

let localMonitors = [];
let localSettings = {};
let checkingMonitors = new Set(); // Track which monitors are currently being checked

function escapeHtml(s){ return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

function renderStatusList(list) {
  statusListEl.innerHTML = '';
  if (list.length === 0) {
    statusListEl.innerHTML = '<div class="status-item-none">No monitors configured.</div>';
    return;
  }

  let itemsToRender;
  const favorites = list.filter(m => m.isFavorite);

  if (favorites.length > 0) {
      itemsToRender = favorites;
  } else {
      itemsToRender = list;
  }

  itemsToRender = itemsToRender.slice(0, 10);

  itemsToRender.forEach(m => {
    const el = document.createElement('div');
    el.className = 'status-item';
    
    let statusText = 'no changes';
    if (m.lastCheckFailed) {
        statusText = 'check failed';
        el.classList.add('failed');
    } else if (m.changed) {
        statusText = 'has changes!';
        el.classList.add('changed');
    }

    const title = m.title || m.url;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'status-item-content';

    const titleWrapper = document.createElement('div');
    titleWrapper.className = 'title-wrapper';

    const favIconUrl = m.favIconUrl || `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(m.url)}`;
    const icon = document.createElement('img');
    icon.src = favIconUrl;
    icon.className = 'status-favicon';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'status-title';
    titleSpan.textContent = escapeHtml(title);

    titleWrapper.append(icon, titleSpan);

    const statusSpan = document.createElement('span');
    statusSpan.className = 'status-text';
    statusSpan.textContent = statusText;

    contentDiv.append(titleWrapper, statusSpan);

    contentDiv.addEventListener('click', () => {
      chrome.tabs.create({ url: m.url, active: true });
      if (m.changed) {
        chrome.runtime.sendMessage({ type: 'acknowledge', id: m.id });
      }
      window.close();
    });

    const checkBtn = document.createElement('button');
    checkBtn.className = 'check-now-btn';
    
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

    el.append(contentDiv, checkBtn);
    statusListEl.appendChild(el);
  });
}

function timeRemainingStr(nextTs){
  const ms = nextTs - Date.now();
  if(ms <= 0) return 'now';
  const totalSec = Math.floor(ms/1000);
  const min = Math.floor(totalSec/60);
  const sec = totalSec % 60;
  return (min > 0) ? `${min}m ${sec}s` : `${sec}s`;
}

function updatePopupCountdown() {
    if (!localSettings.isRunning) {
        popupCountdownEl.textContent = 'paused';
        return;
    }
    const runningMonitors = localMonitors.filter(m => m.running && m.nextCheckTime);
    if (runningMonitors.length === 0) {
        popupCountdownEl.textContent = '';
        return;
    }
    const soonestNextCheck = Math.min(...runningMonitors.map(m => m.nextCheckTime));
    popupCountdownEl.textContent = timeRemainingStr(soonestNextCheck);
}

async function loadAndRender() {
  [localMonitors, localSettings] = await Promise.all([getMonitors(), getSettings()]);
  renderStatusList(localMonitors);
  updatePopupCountdown();
}

openDashboardBtn.addEventListener('click', () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('pages/dashboard.html')
  });
  window.close();
});

checkAllBtnPopup.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'checkAll' });
    checkAllBtnPopup.textContent = 'Checking...';
    checkAllBtnPopup.disabled = true;
    
    // Mark all monitors as being checked
    localMonitors.forEach(m => checkingMonitors.add(m.id));
    
    // Re-render to update all individual check buttons
    renderStatusList(localMonitors);
    
    // Set a timeout to reset the button if no response comes back
    setTimeout(() => {
        checkAllBtnPopup.textContent = 'Check All';
        checkAllBtnPopup.disabled = false;
        checkingMonitors.clear();
        renderStatusList(localMonitors);
    }, 30000); // 30 second timeout
});

selectElementBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url?.startsWith('http')) {
        alert('You must be on a valid web page (http:// or https://) to select an element.');
        return;
    }
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['js/selector.js']
    });
    window.close();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  // Reset checking status when monitors update (check completed)
  if (namespace === 'sync' && changes.monitors_config) {
    // Clear checking status for updated monitors
    if (changes.monitors_config.newValue) {
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

setInterval(updatePopupCountdown, 1000);

loadAndRender();