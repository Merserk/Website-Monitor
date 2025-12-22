// popup.js - Quick status view

const statusListEl = document.getElementById('status-list');
const openDashboardBtn = document.getElementById('openDashboardBtn');
const checkAllBtnPopup = document.getElementById('checkAllBtnPopup');
const selectElementBtn = document.getElementById('selectElementBtn');
const popupCountdownEl = document.getElementById('popup-countdown');

let localMonitors = [];
let localSettings = {};
let monitorStatus = new Map(); // 'queued' | 'checking'

function escapeHtml(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''; }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'checkQueued') {
    monitorStatus.set(msg.id, 'queued');
    renderStatusList(localMonitors);
  } else if (msg.type === 'checkStarted') {
    monitorStatus.set(msg.id, 'checking');
    renderStatusList(localMonitors);
  } else if (msg.type === 'checkEnded') {
    monitorStatus.delete(msg.id);
    loadAndRender();
  } else if (msg.type === 'queueCleared') {
    for (const [id, status] of monitorStatus.entries()) {
      if (status === 'queued') monitorStatus.delete(id);
    }
    renderStatusList(localMonitors);
  }
});

function renderStatusList(list) {
  statusListEl.innerHTML = '';

  // Filter out deleted monitors
  const activeMonitors = list.filter(m => !m.deleted);

  if (activeMonitors.length === 0) {
    statusListEl.innerHTML = '<div class="status-item-none">No active monitors.</div>';
    return;
  }

  let itemsToRender;
  const favorites = activeMonitors.filter(m => m.isFavorite);

  if (favorites.length > 0) {
    itemsToRender = favorites;
  } else {
    itemsToRender = activeMonitors;
  }

  itemsToRender = itemsToRender.slice(0, 10);

  itemsToRender.forEach(m => {
    const el = document.createElement('div');
    el.className = 'status-item';

    if (monitorStatus.get(m.id) === 'checking') {
      el.classList.add('checking');
    }

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
          if (!checkBtn.disabled) return;
          checkBtn.textContent = 'Check now';
          checkBtn.disabled = false;
        }
      }, 30000);
    });

    el.append(contentDiv, checkBtn);
    statusListEl.appendChild(el);
  });
}

function timeRemainingStr(nextTs) {
  const ms = nextTs - Date.now();
  if (ms <= 0) return 'now';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return (min > 0) ? `${min}m ${sec}s` : `${sec}s`;
}

function updatePopupCountdown() {
  if (!localSettings.isRunning) {
    popupCountdownEl.textContent = 'paused';
    return;
  }
  const runningMonitors = localMonitors.filter(m => m.running && m.nextCheckTime && !m.deleted);
  if (runningMonitors.length === 0) {
    popupCountdownEl.textContent = '';
    return;
  }
  const soonestNextCheck = Math.min(...runningMonitors.map(m => m.nextCheckTime));
  popupCountdownEl.textContent = timeRemainingStr(soonestNextCheck);
}

async function syncCheckStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getCheckStatus' });
    if (response) {
      response.queued.forEach(id => monitorStatus.set(id, 'queued'));
      response.checking.forEach(id => monitorStatus.set(id, 'checking'));
      renderStatusList(localMonitors);
    }
  } catch (e) { }
}

async function loadAndRender() {
  [localMonitors, localSettings] = await Promise.all([getMonitors(), getSettings()]);
  renderStatusList(localMonitors);
  updatePopupCountdown();
  syncCheckStatus();
}

openDashboardBtn.addEventListener('click', () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('pages/dashboard.html')
  });
  window.close();
});

checkAllBtnPopup.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'checkAll' });
  checkAllBtnPopup.textContent = 'Queuing...';
  checkAllBtnPopup.disabled = true;

  localMonitors.forEach(m => !m.deleted && monitorStatus.set(m.id, 'queued'));

  renderStatusList(localMonitors);

  setTimeout(() => {
    checkAllBtnPopup.textContent = 'Check All';
    checkAllBtnPopup.disabled = false;
    monitorStatus.clear();
    renderStatusList(localMonitors);
  }, 30000);
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
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      if (window.initWebsiteMonitorSelector) {
        window.initWebsiteMonitorSelector(null); // NULL means Add Mode
      }
    }
  });
  window.close();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  // NOW WATCHING 'local' FOR CONFIG
  if (namespace === 'local' && changes.monitors_config) {
    if (changes.monitors_config.newValue) {
      const updatedMonitors = changes.monitors_config.newValue;
      updatedMonitors.forEach(m => {
        if (monitorStatus.has(m.id)) {
          monitorStatus.delete(m.id);
        }
      });
    }
    loadAndRender();
  }
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

setInterval(updatePopupCountdown, 1000);

loadAndRender();