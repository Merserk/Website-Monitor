// storage.js - Centralized storage management

// Use LOCAL storage for everything to avoid Sync quotas (QUOTA_BYTES_PER_ITEM)
// which were causing silent failures and data reversion.
const configStorage = chrome.storage.local;
const localStorage = chrome.storage.local;

const CONFIG_KEY = 'monitors_config';      // Key for core data
const STATE_KEY_PREFIX = 'monitor_state_'; // Key for state data
const SETTINGS_KEY = 'globalSettings';     // Key for settings

/**
 * Retrieves monitor configurations from storage and merges them with
 * their state to create full monitor objects.
 * Migrates from Sync to Local if Local is empty.
 * @returns {Promise<Array>} A promise that resolves to the array of full monitors.
 */
async function getMonitors() {
    // 1. Get the core configuration from LOCAL storage
    let localData = await configStorage.get(CONFIG_KEY);
    let configs = localData[CONFIG_KEY];

    // --- MIGRATION LOGIC: If Local is empty, try to import from Sync ---
    if (!configs) {
        try {
            const syncData = await chrome.storage.sync.get(CONFIG_KEY);
            if (syncData[CONFIG_KEY] && syncData[CONFIG_KEY].length > 0) {
                console.log('Migrating monitors from Sync to Local storage...');
                configs = syncData[CONFIG_KEY];
                // Save immediately to Local to complete migration
                await configStorage.set({ [CONFIG_KEY]: configs });
            } else {
                configs = [];
            }
        } catch (e) {
            console.warn('Migration from Sync failed or not needed:', e);
            configs = [];
        }
    }

    // 2. Get the state data from local storage
    const monitorIds = configs.map(m => m.id);
    const stateKeys = monitorIds.map(id => STATE_KEY_PREFIX + id);
    const states = stateKeys.length > 0 ? await localStorage.get(stateKeys) : {};

    // 3. Merge config and state to "rehydrate" the full monitor object
    return configs.map(config => {
        const state = states[STATE_KEY_PREFIX + config.id] || {};
        return {
            // Data from config
            id: config.id,
            url: config.url,
            selector: config.selector,
            running: config.running || false,
            isFavorite: config.isFavorite || false,
            title: config.title || config.url,
            deleted: config.deleted || false,

            // Data from state
            currentValue: state.currentValue !== undefined ? state.currentValue : null,
            lastChecked: state.lastChecked || null,
            changed: state.changed || false,
            initialChecked: state.initialChecked || false,
            lastCheckFailed: state.lastCheckFailed || false,
            nextCheckTime: state.nextCheckTime || null,

            // Dynamically generated
            favIconUrl: `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(config.url)}`,
            lastCheckDebug: null
        };
    });
}

/**
 * Saves the monitor list by splitting it into configuration and state.
 * Both are now saved to Local storage.
 * @param {Array} monitors The array of full monitor objects to save.
 */
async function saveMonitors(monitors) {
    const statesToSave = {};
    const configsToSave = monitors.map(monitor => {
        // Queue up the state data
        const key = STATE_KEY_PREFIX + monitor.id;
        statesToSave[key] = {
            currentValue: monitor.currentValue,
            lastChecked: monitor.lastChecked,
            changed: monitor.changed,
            initialChecked: monitor.initialChecked,
            lastCheckFailed: monitor.lastCheckFailed,
            nextCheckTime: monitor.nextCheckTime
        };
        // Return the dehydrated config object
        return {
            id: monitor.id,
            url: monitor.url,
            selector: monitor.selector,
            running: monitor.running,
            isFavorite: monitor.isFavorite,
            title: monitor.title && monitor.title !== monitor.url ? monitor.title : undefined,
            deleted: monitor.deleted || false
        };
    });

    // Perform save (all local now)
    await localStorage.set(statesToSave);
    await configStorage.set({ [CONFIG_KEY]: configsToSave });
}

// Settings can also stay in Local for consistency, but Sync is fine for small settings.
// Let's migrate settings to Local too to be safe and consistent.
async function getSettings() {
    let data = await configStorage.get(SETTINGS_KEY);

    // Migration for settings
    if (!data[SETTINGS_KEY]) {
        try {
            const syncSettings = await chrome.storage.sync.get(SETTINGS_KEY);
            if (syncSettings[SETTINGS_KEY]) {
                data = syncSettings;
                await configStorage.set({ [SETTINGS_KEY]: data[SETTINGS_KEY] });
            }
        } catch (e) { }
    }

    return data[SETTINGS_KEY] || { interval: 60, isRunning: false, maxConcurrency: 1 };
}

async function saveSettings(settings) {
    await configStorage.set({ [SETTINGS_KEY]: settings });
}