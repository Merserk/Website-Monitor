// background.js - service worker (MV3) with improved element detection

importScripts('storage.js');

let checkQueue = [];
let activeChecks = 0;
let isQueueProcessing = false;
let executingMonitors = new Set();

// --- Helpers ---
async function updateBadge() {
    const monitors = await getMonitors();
    // Only count active (non-deleted) monitors that have changes
    const changedCount = monitors.filter(m => m.changed && !m.deleted).length;
    chrome.action.setBadgeText({ text: changedCount > 0 ? `${changedCount}` : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#32d583' });
}
function genId() { return Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8); }

// --- Queue Processing Logic ---
async function processCheckQueue() {
    if (isQueueProcessing) return;
    isQueueProcessing = true;
    try {
        const settings = await getSettings();
        const limit = settings.maxConcurrency;
        while (activeChecks < limit && checkQueue.length > 0) {
            const monitorToCheck = checkQueue.shift();

            // Double check: don't process if deleted (in case it was in queue when deleted)
            if (monitorToCheck.deleted) continue;

            activeChecks++;
            (async () => {
                try {
                    await performCheck(monitorToCheck);
                } catch (error) {
                    console.error(`Error during check for ${monitorToCheck.url}:`, error);
                } finally {
                    activeChecks--;
                    processCheckQueue();
                }
            })();
        }
    } finally {
        isQueueProcessing = false;
    }
}
function addToQueue(monitor) {
    if (!checkQueue.some(item => item.id === monitor.id)) {
        checkQueue.push(monitor);
        chrome.runtime.sendMessage({ type: 'checkQueued', id: monitor.id }).catch(() => { });
        processCheckQueue();
    }
}
function batchAddToQueue(monitors) {
    monitors.forEach(monitor => {
        if (!checkQueue.some(item => item.id === monitor.id) && !monitor.deleted) {
            checkQueue.push(monitor);
            chrome.runtime.sendMessage({ type: 'checkQueued', id: monitor.id }).catch(() => { });
        }
    });
    processCheckQueue();
}

// --- Core Checking Logic ---
async function performCheck(monitorDataFromQueue) {
    // RE-FETCH: key fix. Ensure we have the absolute latest config (selector/url) from storage.
    // The 'monitorDataFromQueue' might be stale if an edit happened while it was queued.
    const allMonitors = await getMonitors();
    const monitor = allMonitors.find(m => m.id === monitorDataFromQueue.id);

    // If monitor was deleted or not found, stop.
    if (!monitor || monitor.deleted) return;

    let tempWindowId;
    let foundValue = null;
    let pageTitle = null;
    let pageTextSnippet = '[Error: Script did not execute]';
    const VALUE_TRUNCATE_LIMIT = 1000;

    try {
        // Broadcast start
        chrome.runtime.sendMessage({ type: 'checkStarted', id: monitor.id }).catch(() => { });
        executingMonitors.add(monitor.id);

        // Create a new, small, unfocused window far off-screen to perform the check.
        const newWindow = await chrome.windows.create({
            url: monitor.url,
            type: 'normal',
            focused: false,
            width: 1,
            height: 1,
            top: 9999,
            left: 9999,
        });

        tempWindowId = newWindow.id;
        const tabId = newWindow.tabs[0].id;

        // Wait for the tab in the new window to finish loading
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                reject(new Error("Tab loading in temporary window timed out."));
            }, 25000);

            const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    clearTimeout(timeout);
                    setTimeout(resolve, 1000);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });

        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (selector) => {
                const findElementWithFallbacks = (originalSelector) => {
                    let element = document.querySelector(originalSelector);
                    if (element && element.innerText.trim() !== '') {
                        return { element, usedSelector: originalSelector };
                    }
                    const fallbackSelectors = [];
                    let fallbackSelector = originalSelector
                        .replace(/\.[\w-]*-focused/g, '')
                        .replace(/\.[\w-]*-active/g, '')
                        .replace(/\.[\w-]*-current/g, '')
                        .replace(/\.[\w-]*-selected/g, '');

                    if (fallbackSelector !== originalSelector && fallbackSelector.trim()) {
                        fallbackSelectors.push(fallbackSelector);
                    }
                    if (originalSelector.includes('ProseMirror')) {
                        const proseMirrorBase = originalSelector.replace(/\.ProseMirror-[\w-]*/g, '.ProseMirror');
                        fallbackSelectors.push(proseMirrorBase);
                        fallbackSelectors.push('.ProseMirror');
                    }
                    for (const selector of fallbackSelectors) {
                        try {
                            element = document.querySelector(selector);
                            if (element && element.innerText.trim() !== '') {
                                return { element, usedSelector: selector };
                            }
                        } catch (e) {
                            console.warn('Invalid fallback selector:', selector);
                        }
                    }
                    if (originalSelector.includes('#editorTextarea')) {
                        const textareaContainer = document.querySelector('#editorTextarea');
                        if (textareaContainer) {
                            const candidates = [
                                textareaContainer.querySelector('[contenteditable="true"]'),
                                textareaContainer.querySelector('.ProseMirror'),
                                textareaContainer.querySelector('div[role="textbox"]'),
                                textareaContainer.querySelector('textarea')
                            ].filter(Boolean);
                            for (const candidate of candidates) {
                                if (candidate.innerText.trim() !== '') {
                                    return { element: candidate, usedSelector: 'fallback-contenteditable' };
                                }
                            }
                        }
                    }
                    return { element: null, usedSelector: 'none-found' };
                };

                const waitForElement = (selector, timeout = 5000) => {
                    return new Promise(resolve => {
                        let intervalId = null, timeoutId = null;
                        const clearTimers = () => { clearInterval(intervalId); clearTimeout(timeoutId); };
                        intervalId = setInterval(() => {
                            const result = findElementWithFallbacks(selector);
                            if (result.element) {
                                clearTimers();
                                resolve(result);
                            }
                        }, 100);
                        timeoutId = setTimeout(() => {
                            clearTimers();
                            const finalResult = findElementWithFallbacks(selector);
                            resolve(finalResult);
                        }, timeout);
                    });
                };
                const result = await waitForElement(selector);
                const title = document.title || '';
                const found = result.element ? result.element.innerText.trim() : null;
                const snippet = document.body ? document.body.innerText.substring(0, 2000) : '';
                return {
                    title,
                    found,
                    pageTextSnippet: snippet,
                    usedSelector: result.usedSelector,
                    originalSelector: selector
                };
            },
            args: [monitor.selector]
        });

        if (results && results[0] && results[0].result) {
            pageTitle = results[0].result.title;
            foundValue = results[0].result.found;
            pageTextSnippet = results[0].result.pageTextSnippet;
        }

    } catch (e) {
        console.error(`Scripting failed for ${monitor.url}`, e);
        pageTextSnippet = `[Error: ${e.message}]`;
    } finally {
        executingMonitors.delete(monitor.id);
        // Broadcast end
        chrome.runtime.sendMessage({ type: 'checkEnded', id: monitor.id }).catch(() => { });

        // Update stats
        chrome.storage.local.get(['stats'], (result) => {
            const stats = result.stats || { totalChecks: 0 };
            stats.totalChecks = (stats.totalChecks || 0) + 1;
            chrome.storage.local.set({ stats });
        });

        if (tempWindowId) {
            try { await chrome.windows.remove(tempWindowId); } catch (e) { }
        }
    }

    // Refresh list again to ensure we update the latest state safely (though 'monitor' is already reasonably fresh)
    const monitors = await getMonitors();
    const idx = monitors.findIndex(m => m.id === monitor.id);
    if (idx === -1) return;

    const monitorToUpdate = monitors[idx];

    // Stop if deleted during check
    if (monitorToUpdate.deleted) return;

    // CONFLICT CHECK:
    // If the selector or URL has changed since we started this check (e.g. user edited the monitor),
    // then this result is based on stale config and should be discarded to prevent overwriting the edit.
    if (monitorToUpdate.selector !== monitor.selector || monitorToUpdate.url !== monitor.url) {
        console.log(`Aborting check save for ${monitor.id}: Monitor configuration changed during check.`);
        return;
    }

    const previousValue = monitorToUpdate.currentValue;

    monitorToUpdate.title = pageTitle || monitorToUpdate.title || monitor.url;
    monitorToUpdate.lastChecked = Date.now();

    const valueForStorage = foundValue ? foundValue.substring(0, VALUE_TRUNCATE_LIMIT) : null;

    if (!monitorToUpdate.initialChecked) {
        monitorToUpdate.initialChecked = true;
        monitorToUpdate.currentValue = valueForStorage;
        monitorToUpdate.lastCheckFailed = valueForStorage === null;
        if (monitorToUpdate.lastCheckFailed) {
            await notifyUser('Initial check failed: Element not found.', monitorToUpdate);
        }
    } else {
        if (valueForStorage !== null) {
            monitorToUpdate.lastCheckFailed = false;
            // Trim and truncate to exactly match what we store
            const cleanFound = valueForStorage.trim(); // foundValue is already truncated above? No wait.
            // Wait, foundValue.substring(0, limit) is "valueForStorage".
            // If I just compared previousValue !== valueForStorage, that handles strictly equal.

            if (previousValue !== valueForStorage) {
                monitorToUpdate.changed = true;
                await notifyUser('Update detected: ' + (monitorToUpdate.title || monitorToUpdate.url), monitorToUpdate);
            }
            monitorToUpdate.currentValue = valueForStorage;
        } else {
            monitorToUpdate.lastCheckFailed = true;
            monitorToUpdate.changed = false;
            await notifyUser('Check failed: Element not found.', monitorToUpdate);
        }
    }

    if (monitorToUpdate.running && !monitorToUpdate.deleted) {
        const settings = await getSettings();
        const ms = Math.max(1, settings.interval) * 60 * 1000;
        monitorToUpdate.nextCheckTime = Date.now() + ms;
    } else {
        monitorToUpdate.nextCheckTime = null;
    }

    await saveMonitors(monitors);
    await updateBadge();
}

async function handleAddMonitor(payload) {
    const settings = await getSettings();
    const monitor = {
        id: genId(),
        url: payload.url,
        title: payload.title,
        favIconUrl: `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(payload.url)}`,
        selector: payload.selector,
        // Normalize text to match performCheck logic
        currentValue: payload.initialText ? payload.initialText.trim().substring(0, 1000) : null,
        lastChecked: null,
        running: settings.isRunning,
        changed: false,
        initialChecked: false,
        nextCheckTime: null,
        lastCheckDebug: null,
        isFavorite: false,
        lastCheckFailed: false,
        deleted: false
    };
    const monitors = await getMonitors();
    monitors.push(monitor);
    await saveMonitors(monitors);
}

async function handleUpdateMonitor(payload) {
    const monitors = await getMonitors();
    const idx = monitors.findIndex(m => m.id === payload.monitorId);
    if (idx !== -1) {
        // "Delete old and create new at same place":
        // We achieve this by keeping the ID (to preserve position and alarms) but resetting states.

        monitors[idx].selector = payload.selector;
        monitors[idx].url = payload.url;
        monitors[idx].title = payload.title || monitors[idx].title;

        // Reset state effectively "creating new"
        monitors[idx].currentValue = payload.initialText ? payload.initialText.trim().substring(0, 1000) : null;
        monitors[idx].initialChecked = true; // Use current text as the baseline
        monitors[idx].changed = false;
        monitors[idx].lastCheckFailed = false;
        monitors[idx].lastChecked = Date.now();

        // Clear old specific stats if any? 
        // e.g. if we had history, we'd clear it. 
        // For now, these resets are sufficient to treat it as a fresh baseline.

        await saveMonitors(monitors);
        await updateBadge();

        // Notify user of success
        chrome.notifications.create('update-' + Date.now(), {
            type: 'basic',
            title: 'Monitor Updated',
            message: `Updated monitor for ${monitors[idx].title}`,
            iconUrl: 'icons/icon48.png'
        });
    }
}

// --- Listeners & Message Handlers ---
async function startAlarmForMonitor(monitor, interval) {
    const name = 'mon-' + monitor.id;
    chrome.alarms.create(name, { delayInMinutes: interval, periodInMinutes: interval });
}
async function clearAlarmForMonitor(monitor) {
    await chrome.alarms.clear('mon-' + monitor.id);
}
async function notifyUser(message, monitor) {
    let iconUrl = 'icons/icon48.png';
    try {
        if (monitor.favIconUrl) {
            const response = await fetch(monitor.favIconUrl);
            if (!response.ok) { throw new Error('Favicon response was not ok.'); }
            const blob = await response.blob();
            iconUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
    } catch (error) {
        console.warn(`Could not fetch favicon for ${monitor.url}. Using default icon.`, error);
    }
    chrome.notifications.create('nm-' + monitor.id + '-' + Date.now(), {
        type: 'basic',
        title: monitor.title || 'Website Monitor',
        message: message + (monitor.currentValue ? `\nNew value: ${monitor.currentValue.slice(0, 100)}` : ''),
        iconUrl: iconUrl
    });
}
chrome.alarms.onAlarm.addListener(async alarm => {
    if (!alarm.name.startsWith('mon-')) return;
    const id = alarm.name.slice(4);
    const monitors = await getMonitors();
    const monitor = monitors.find(m => m.id === id);
    if (monitor && monitor.running && !monitor.deleted) {
        addToQueue(monitor);
    }
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 1. Handlers that send a response asynchronously
    if (msg.type === 'batchAddMonitors') {
        (async () => {
            try {
                const newMonitors = msg.payload.map(m => ({ ...m, id: genId(), deleted: false }));
                const existingMonitors = await getMonitors();
                const combined = existingMonitors.concat(newMonitors);
                await saveMonitors(combined);
                await updateBadge();
                sendResponse({ ok: true });
            } catch (e) {
                console.error('Error in batchAddMonitors:', e);
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true; // Keep channel open for async response
    }

    // 2. Handlers that send a response synchronously
    if (msg.type === 'getCheckStatus') {
        const queued = checkQueue.map(m => m.id);
        const checking = Array.from(executingMonitors);
        sendResponse({ queued, checking });
        return false; // Response sent synchronously
    }

    // 3. Handlers that send an async response (like batchAddMonitors)
    if (msg.type === 'stopChecks') {
        (async () => {
            try {
                checkQueue.length = 0; // Clear queue
                chrome.runtime.sendMessage({ type: 'queueCleared' }).catch(() => { });
                sendResponse({ ok: true });
            } catch (e) {
                console.error('Error in stopChecks:', e);
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true; // Keep channel open for async response
    }

    // 4. Async handlers that do NOT send a response (fire and forget)
    (async () => {
        try {
            if (msg.type === 'elementSelected') {
                if (msg.payload.monitorId) {
                    await handleUpdateMonitor(msg.payload);
                } else {
                    await handleAddMonitor(msg.payload);
                }

                const dashboardUrl = chrome.runtime.getURL('pages/dashboard.html');
                const tabs = await chrome.tabs.query({ url: dashboardUrl });

                if (tabs.length > 0) {
                    await chrome.tabs.update(tabs[0].id, { active: true });
                    await chrome.windows.update(tabs[0].windowId, { focused: true });
                } else {
                    await chrome.tabs.create({ url: dashboardUrl });
                }

            } else if (msg.type === 'addAndInitialCheck') {
                await handleAddMonitor(msg.payload);
            } else if (msg.type === 'toggleFavorite') {
                const monitors = await getMonitors();
                const idx = monitors.findIndex(m => m.id === msg.id);
                if (idx !== -1) { monitors[idx].isFavorite = !monitors[idx].isFavorite; await saveMonitors(monitors); }
            } else if (msg.type === 'toggleAll') {
                const { isRunning, interval, maxConcurrency } = msg.payload;
                await saveSettings({ isRunning, interval, maxConcurrency });
                const monitors = await getMonitors();
                for (const m of monitors) {
                    m.running = isRunning && !m.deleted;
                    if (isRunning && !m.deleted) {
                        const ms = Math.max(1, interval) * 60 * 1000;
                        m.nextCheckTime = Date.now() + ms;
                        await startAlarmForMonitor(m, interval);
                    } else {
                        m.nextCheckTime = null;
                        await clearAlarmForMonitor(m);
                    }
                }
                await saveMonitors(monitors);
            } else if (msg.type === 'checkNow') {
                const monitors = await getMonitors();
                const monitor = monitors.find(m => m.id === msg.id);
                if (monitor && !monitor.deleted) addToQueue(monitor);
            } else if (msg.type === 'checkAll') {
                const monitors = await getMonitors();
                batchAddToQueue(monitors);
            } else if (msg.type === 'delete') {
                // Soft Delete
                let monitors = await getMonitors();
                const idx = monitors.findIndex(m => m.id === msg.id);
                if (idx !== -1) {
                    const m = monitors[idx];
                    m.deleted = true;
                    m.running = false;
                    m.nextCheckTime = null;
                    await clearAlarmForMonitor(m);
                    await saveMonitors(monitors);
                    await updateBadge();
                }
            } else if (msg.type === 'restore') {
                // Restore from Recycle Bin
                let monitors = await getMonitors();
                const idx = monitors.findIndex(m => m.id === msg.id);
                if (idx !== -1) {
                    monitors[idx].deleted = false;
                    await saveMonitors(monitors);
                    await updateBadge();
                }
            } else if (msg.type === 'hardDelete') {
                // Permanently Delete
                let monitors = await getMonitors();
                const monitorToDelete = monitors.find(m => m.id === msg.id);
                if (monitorToDelete) {
                    await clearAlarmForMonitor(monitorToDelete);
                    await chrome.storage.local.remove('monitor_state_' + msg.id);
                    monitors = monitors.filter(m => m.id !== msg.id);
                    await saveMonitors(monitors);
                    await updateBadge();
                }
            } else if (msg.type === 'emptyBin') {
                // Delete all where deleted === true
                let monitors = await getMonitors();
                const toDelete = monitors.filter(m => m.deleted);
                const keep = monitors.filter(m => !m.deleted);
                for (const m of toDelete) {
                    await clearAlarmForMonitor(m);
                    await chrome.storage.local.remove('monitor_state_' + m.id);
                }
                await saveMonitors(keep);
                await updateBadge();
            } else if (msg.type === 'moveAllToBin') {
                // Move all non-deleted monitors to Recycle Bin
                let monitors = await getMonitors();
                for (const m of monitors) {
                    if (!m.deleted) {
                        m.deleted = true;
                        m.running = false;
                        m.nextCheckTime = null;
                        await clearAlarmForMonitor(m);
                    }
                }
                await saveMonitors(monitors);
                await updateBadge();
                sendResponse({ ok: true });
            } else if (msg.type === 'acknowledge') {
                const monitors = await getMonitors();
                const idx = monitors.findIndex(m => m.id === msg.id);
                if (idx !== -1) { monitors[idx].changed = false; await saveMonitors(monitors); await updateBadge(); }
            }
        } catch (err) {
            console.error('Error in async message handler:', err);
        }
    })();
    return true;
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);