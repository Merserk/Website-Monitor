// background.js - service worker (MV3) with improved element detection

importScripts('storage.js');

let checkQueue = [];
let activeChecks = 0;
let isQueueProcessing = false;

// --- Helpers ---
async function updateBadge() {
    const monitors = await getMonitors();
    const changedCount = monitors.filter(m => m.changed).length;
    chrome.action.setBadgeText({ text: changedCount > 0 ? `${changedCount}` : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#32d583' });
}
function genId(){ return Date.now().toString() + '-' + Math.random().toString(36).slice(2,8); }

// --- Queue Processing Logic ---
async function processCheckQueue() {
    if (isQueueProcessing) return;
    isQueueProcessing = true;
    try {
        const settings = await getSettings();
        const limit = settings.maxConcurrency;
        while (activeChecks < limit && checkQueue.length > 0) {
            const monitorToCheck = checkQueue.shift();
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
        processCheckQueue();
    }
}
function batchAddToQueue(monitors) {
    monitors.forEach(monitor => {
        if (!checkQueue.some(item => item.id === monitor.id)) {
            checkQueue.push(monitor);
        }
    });
    processCheckQueue();
}

// --- Core Checking Logic ---
async function performCheck(monitor) {
    let tempWindowId;
    let foundValue = null;
    let pageTitle = null;
    let pageTextSnippet = '[Error: Script did not execute]';
    const VALUE_TRUNCATE_LIMIT = 1000;

    try {
        // Create a new, small, unfocused window far off-screen to perform the check.
        // This is the most reliable way to prevent background tab throttling.
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
                    // Add a small extra delay for SPAs to finish rendering
                    setTimeout(resolve, 1000);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        
        // Now that the page is rendered in the hidden window, execute the improved script.
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (selector) => {
                // Enhanced element finding with fallback strategies
                const findElementWithFallbacks = (originalSelector) => {
                    // Strategy 1: Try the original selector
                    let element = document.querySelector(originalSelector);
                    if (element && element.innerText.trim() !== '') {
                        return { element, usedSelector: originalSelector };
                    }

                    // Strategy 2: If original selector contains dynamic classes, create fallback selectors
                    const fallbackSelectors = [];
                    
                    // Remove focus-related classes
                    let fallbackSelector = originalSelector
                        .replace(/\.[\w-]*-focused/g, '')
                        .replace(/\.[\w-]*-active/g, '')
                        .replace(/\.[\w-]*-current/g, '')
                        .replace(/\.[\w-]*-selected/g, '');
                    
                    if (fallbackSelector !== originalSelector && fallbackSelector.trim()) {
                        fallbackSelectors.push(fallbackSelector);
                    }

                    // Extract base classes for ProseMirror editors
                    if (originalSelector.includes('ProseMirror')) {
                        const proseMirrorBase = originalSelector.replace(/\.ProseMirror-[\w-]*/g, '.ProseMirror');
                        fallbackSelectors.push(proseMirrorBase);
                        
                        // Even broader fallback - just .ProseMirror
                        fallbackSelectors.push('.ProseMirror');
                    }

                    // Try each fallback selector
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

                    // Strategy 3: Try to find by element type and some stable attributes
                    if (originalSelector.includes('#editorTextarea')) {
                        const textareaContainer = document.querySelector('#editorTextarea');
                        if (textareaContainer) {
                            // Look for contenteditable elements or ProseMirror editors within
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
            
            // Log selector information for debugging
            if (results[0].result.usedSelector !== results[0].result.originalSelector) {
                console.log(`Monitor ${monitor.url}: Used fallback selector '${results[0].result.usedSelector}' instead of '${results[0].result.originalSelector}'`);
            }
        }

    } catch (e) {
        console.error(`Scripting failed for ${monitor.url}`, e);
        pageTextSnippet = `[Error: ${e.message}]`;
    } finally {
        // Ensure the temporary window is always closed
        if (tempWindowId) {
            try { await chrome.windows.remove(tempWindowId); } catch(e) {}
        }
    }

    const monitors = await getMonitors();
    const idx = monitors.findIndex(m => m.id === monitor.id);
    if (idx === -1) return;

    const monitorToUpdate = monitors[idx];
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

    if (monitorToUpdate.running) {
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
        currentValue: payload.initialText,
        lastChecked: null,
        running: settings.isRunning,
        changed: false,
        initialChecked: false,
        nextCheckTime: null,
        lastCheckDebug: null,
        isFavorite: false,
        lastCheckFailed: false
    };
    const monitors = await getMonitors();
    monitors.push(monitor);
    await saveMonitors(monitors);
    // Don't call performCheck here directly. Let the dashboard navigation happen first.
    // The user can see the monitor and click "Check now" themselves for the initial check.
    // This provides a smoother and more predictable user experience.
}

// --- The rest of the file (notifyUser, listeners, etc.) remains the same ---
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
    if (monitor && monitor.running) {
        addToQueue(monitor);
    }
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'batchAddMonitors') {
        (async () => {
            const newMonitors = msg.payload.map(m => ({ ...m, id: genId() }));
            const existingMonitors = await getMonitors();
            const combined = existingMonitors.concat(newMonitors);
            await saveMonitors(combined);
            await updateBadge();
            sendResponse({ok: true});
        })();
        return true;
    }
    (async () => {
        if (msg.type === 'elementSelected') {
            await handleAddMonitor(msg.payload);
            
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
                m.running = isRunning;
                if (isRunning) { const ms = Math.max(1, interval) * 60 * 1000; m.nextCheckTime = Date.now() + ms; await startAlarmForMonitor(m, interval); } else { m.nextCheckTime = null; await clearAlarmForMonitor(m); }
            }
            await saveMonitors(monitors);
        } else if (msg.type === 'checkNow') {
            const monitors = await getMonitors();
            const monitor = monitors.find(m => m.id === msg.id);
            if (monitor) addToQueue(monitor);
        } else if (msg.type === 'checkAll') {
            const monitors = await getMonitors();
            batchAddToQueue(monitors);
        } else if (msg.type === 'delete') {
            let monitors = await getMonitors();
            const monitorToDelete = monitors.find(m => m.id === msg.id);
            if (monitorToDelete) {
                await clearAlarmForMonitor(monitorToDelete);
                monitors = monitors.filter(m => m.id !== msg.id);
                await saveMonitors(monitors);
                await chrome.storage.local.remove('monitor_state_' + msg.id);
                await updateBadge();
            }
        } else if (msg.type === 'acknowledge') {
            const monitors = await getMonitors();
            const idx = monitors.findIndex(m => m.id === msg.id);
            if (idx !== -1) { monitors[idx].changed = false; await saveMonitors(monitors); await updateBadge(); }
        }
    })();
    return true;
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);