// storage.js - Centralized storage management

const syncStorage = chrome.storage.sync;
const localStorage = chrome.storage.local;

const CONFIG_KEY = 'monitors_config';      // Key for core data in chrome.storage.sync
const STATE_KEY_PREFIX = 'monitor_state_'; // Prefix for state data in chrome.storage.local
const SETTINGS_KEY = 'globalSettings';     // Key for settings in chrome.storage.sync

/**
 * Retrieves monitor configurations from sync storage and merges them with
 * their state from local storage to create full monitor objects.
 * @returns {Promise<Array>} A promise that resolves to the array of full monitors.
 */
async function getMonitors() {
    // 1. Get the core configuration from sync storage
    const syncData = await syncStorage.get(CONFIG_KEY);
    const configs = syncData[CONFIG_KEY] || [];

    // 2. Get the state data from local storage
    const monitorIds = configs.map(m => m.id);
    const stateKeys = monitorIds.map(id => STATE_KEY_PREFIX + id);
    const states = stateKeys.length > 0 ? await localStorage.get(stateKeys) : {};

    // 3. Merge config and state to "rehydrate" the full monitor object
    return configs.map(config => {
        const state = states[STATE_KEY_PREFIX + config.id] || {};
        return {
            // Data from config (synced)
            id: config.id,
            url: config.url,
            selector: config.selector,
            running: config.running || false,
            isFavorite: config.isFavorite || false,
            title: config.title || config.url,

            // Data from state (local)
            currentValue: state.currentValue !== undefined ? state.currentValue : null,
            lastChecked: state.lastChecked || null,
            changed: state.changed || false,
            initialChecked: state.initialChecked || false,
            lastCheckFailed: state.lastCheckFailed || false,
            nextCheckTime: state.nextCheckTime || null,

            // Dynamically generated properties (never stored)
            favIconUrl: `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(config.url)}`,
            lastCheckDebug: null
        };
    });
}

/**
 * Saves the monitor list by splitting it into configuration (for sync)
 * and state (for local).
 * @param {Array} monitors The array of full monitor objects to save.
 */
async function saveMonitors(monitors) {
    const statesToSave = {};
    const configsToSave = monitors.map(monitor => {
        // Queue up the state data for local storage
        const key = STATE_KEY_PREFIX + monitor.id;
        statesToSave[key] = {
            currentValue: monitor.currentValue,
            lastChecked: monitor.lastChecked,
            changed: monitor.changed,
            initialChecked: monitor.initialChecked,
            lastCheckFailed: monitor.lastCheckFailed,
            nextCheckTime: monitor.nextCheckTime
        };
        // Return the dehydrated config object for sync storage
        return {
            id: monitor.id,
            url: monitor.url,
            selector: monitor.selector,
            running: monitor.running,
            isFavorite: monitor.isFavorite,
            title: monitor.title && monitor.title !== monitor.url ? monitor.title : undefined
        };
    });

    // Perform both saves
    await localStorage.set(statesToSave);
    try {
        await syncStorage.set({ [CONFIG_KEY]: configsToSave });
    } catch (error) {
        if (error.message.includes('QUOTA_BYTES')) {
            console.error('Could not save monitor configuration:', error);
            alert('Error: Your monitor list is too large to be saved. Please export your data and reduce the number of monitors.');
        } else {
            console.error('An unknown error occurred while saving monitor config:', error);
        }
    }
}

// Settings are simple and can remain in sync storage
async function getSettings() {
    const data = await syncStorage.get(SETTINGS_KEY);
    return data[SETTINGS_KEY] || { interval: 60, isRunning: false, maxConcurrency: 1 };
}

async function saveSettings(settings) {
    await syncStorage.set({ [SETTINGS_KEY]: settings });
}