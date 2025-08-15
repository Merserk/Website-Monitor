// export_import.js - Handles exporting and importing of monitor data.

/**
 * Triggers a download of the current monitor configuration.
 * The exported JSON contains both a native format for this extension
 * and a Distill-compatible format.
 */
async function exportData() {
    const monitors = (await getMonitors()) || [];
    if (monitors.length === 0) {
        alert('There are no monitors to export.');
        return;
    }

    // 1. Native format (for re-importing into this extension)
    const nativeFormat = {
        source: 'WebsiteMonitorExtension',
        version: '1.0',
        createdAt: new Date().toISOString(),
        monitors: monitors
    };

    // 2. Distill Web Monitor compatible format
    const distillData = monitors.map(m => {
        return {
            name: m.title || m.url,
            uri: m.url,
            config: JSON.stringify({
                ignoreEmptyText: true,
                includeStyle: false,
                dataAttr: "text",
                selections: [{
                    frames: [{
                        index: 0,
                        excludes: [],
                        includes: [{
                            type: "css",
                            expr: m.selector,
                            fields: [{ name: "text", type: "builtin" }]
                        }]
                    }],
                    dynamic: true,
                    delay: 2
                }]
            }),
            content_type: 2,
            schedule: "{\"type\":\"INTERVAL\",\"params\":{\"interval\":3600}}", // Default interval
            ts: new Date().toISOString()
        };
    });

    const distillFormat = {
        client: { local: 1 },
        data: distillData
    };

    const finalExportObject = {
        native: nativeFormat,
        distill_compatible: distillFormat
    };

    const blob = new Blob([JSON.stringify(finalExportObject, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `website_monitor_export_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Reads a JSON file, parses it, and imports the monitors.
 * It can handle both the native format and Distill Web Monitor format.
 * @param {File} file The JSON file to import.
 */
function importData(file) {
    if (!file) {
        alert('No file selected.');
        return;
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const json = JSON.parse(event.target.result);
            let monitorsToImport = [];

            // Case 1: It's our native format
            if (json.native && json.native.source === 'WebsiteMonitorExtension') {
                monitorsToImport = json.native.monitors || [];
            }
            // Case 2: It's a Distill Web Monitor format
            else if (json.data && Array.isArray(json.data)) {
                monitorsToImport = json.data.map(item => {
                    try {
                        const config = JSON.parse(item.config);
                        // UPDATED: Safely access the nested selector property using optional chaining (?.)
                        const selector = config.selections?.[0]?.frames?.[0]?.includes?.[0]?.expr;

                        // If a selector wasn't found (e.g., for full-page monitors), we cannot import it.
                        if (!selector) {
                            console.warn('Skipping Distill monitor item as no valid CSS selector was found:', item);
                            return null;
                        }

                        return {
                            // We create a new object matching our extension's structure
                            url: item.uri,
                            title: item.name,
                            selector: selector,
                            currentValue: null, // Will be populated on first check
                            lastChecked: null,
                            running: false, // Imported monitors are initially paused
                            changed: false,
                            initialChecked: false,
                            nextCheckTime: null,
                            lastCheckDebug: null,
                            isFavorite: false,
                            lastCheckFailed: false
                        };
                    } catch (e) {
                        console.warn('Skipping invalid Distill monitor item:', item, e);
                        return null;
                    }
                }).filter(Boolean); // Filter out any nulls from failed parsing
            } else {
                throw new Error('Unrecognized file format.');
            }

            if (monitorsToImport.length > 0) {
                // Use a different message type to add monitors in bulk without starting checks immediately
                await chrome.runtime.sendMessage({ type: 'batchAddMonitors', payload: monitorsToImport });
                alert(`Successfully imported ${monitorsToImport.length} monitors. They are currently paused.`);
            } else {
                alert('No valid monitors found in the selected file.');
            }

        } catch (error) {
            console.error('Import failed:', error);
            alert('Import failed. Please make sure you are selecting a valid JSON export file.');
        }
    };
    reader.readAsText(file);
}