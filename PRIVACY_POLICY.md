***

# Privacy Policy for Website Monitor Extension

**Last Updated:** August 23, 2025

Thank you for using Website Monitor ("the extension"). This Privacy Policy is here to help you understand what data the extension collects, why it collects it, and how it is stored and used. Your privacy is a top priority, and this extension has been designed from the ground up to be as private and secure as possible.

### Core Principle: Your Data Stays With You

The fundamental principle of this extension is that **your data is yours**. The extension is designed to function without the need for any developer-controlled servers. All the information you configure and the data it collects is stored directly on your own computer or within your personal browser's sync storage, which is managed by your Google Account. We, the developers, have no access to your list of monitored sites, their content, or your settings.

### What Information We Collect and Why

To perform its single purpose—monitoring web pages for changes—the extension needs to store certain information.

1.  **Website and Content Data (Collected by You):**
    *   **URLs of Monitored Pages:** When you add a monitor, the extension saves the full URL of the website you want to track. This is essential for the extension to know which page to visit for its checks.
    *   **CSS Selectors:** When you select a specific element on a page, the extension generates and saves a CSS selector to identify that exact part of the page on subsequent visits.
    *   **Website Content:** The extension stores the text content of the element you are monitoring. This is necessary to compare the previous value with the current value to detect a change. It also stores the page title to help you identify your monitors.

2.  **User Configuration Data:**
    *   **Extension Settings:** The extension saves your preferences, such as the global check interval, max concurrent checks, and whether monitoring is active. This allows the extension to operate according to your specific configuration.

**We DO NOT collect any Personally Identifiable Information (PII).** This extension does not collect, store, or transmit any personal data such as your name, email address, age, location, or financial information.

### How Your Data is Used

Your data is used exclusively to provide the core functionality of the extension:

*   To save your list of monitors and personal settings.
*   To automatically navigate to your specified URLs in the background.
*   To read the content of the element you selected.
*   To compare the new content with the stored content to see if there is a difference.
*   To display a desktop notification to you if a change is detected.

### Data Storage and Security

Your data is stored in two locations, both of which are under your control:

1.  **`chrome.storage.sync` (Browser Sync Storage):** Your core monitor configurations (URL, selector, title) and global settings are stored here. This allows you to sync your monitors across different computers where you are logged into the same Google Account. This data is managed by your browser and your Google Account; we do not have access to it.
2.  **`chrome.storage.local` (Local Storage):** State-related data for each monitor, such as the last detected value and the last checked time, is stored locally on your device. This data does not sync across devices.

No data is ever sent to or stored on any server owned or operated by the developers of this extension.

### Data Sharing and Third Parties

We **do not** sell, trade, rent, or transfer any of your data to any third parties. Period.

The only external network requests the extension makes are:

*   **To the websites you are monitoring:** This is necessary to check for content changes.
*   **To `https://www.google.com/s2/favicons`:** This is a standard Google service used to fetch the small icon (favicon) for the websites you monitor, which is displayed in the dashboard for easier identification. No personal or unique identifiers are sent with this request.

### Permissions Justification

The extension requests a minimal set of permissions required for its operation:

*   **`storage`**: To save your list of monitors and settings.
*   **`alarms`**: To schedule the periodic background checks.
*   **`tabs` / `activeTab`**: To open the management dashboard, allow you to open monitored pages, and to enable the visual element selector on the current page.
*   **`scripting`** and **Host Permission (`<all_urls>`)**: To inject the script that allows you to select an element, and to read the content from any website you choose to monitor.
*   **`notifications`**: To show you an alert when a change is detected.

### Changes to This Privacy Policy

We may update this Privacy Policy in the future. Any changes will be accompanied by an update to the "Last Updated" date at the top of this policy. We encourage you to review this policy periodically.
