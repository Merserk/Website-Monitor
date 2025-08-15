# Website Monitor

**Monitor web pages for changes and get notified when they update. A powerful, open-source alternative to commercial services.**

<img width="1298" height="1095" alt="image" src="https://github.com/user-attachments/assets/609968c6-872a-4972-ac8d-6dc0fc1c50cc" />
<img width="550" height="425" alt="image" src="https://github.com/user-attachments/assets/9f3698c8-2afe-4291-9d0a-1c4d5bebdf14" />

Website Monitor is a browser extension that allows you to select any element on a webpage and track it for changes. Get notified when a price changes, a new article is published, or a stock status is updated. It's your personal web automation tool.

---

## ✨ Features

*   **Visual Selector:** Simply click on any element on a page to start monitoring it. No need to mess with complex CSS selectors.
*   **Change Notifications:** Get desktop notifications when a change is detected. The extension icon will also show a badge with the number of changed monitors.
*   **Robust Detection:** The extension uses a smart algorithm to find elements even if the page structure changes slightly.
*   **Dashboard:** A dedicated dashboard to manage all your monitors in one place.
*   **Import/Export:** You can export your monitors to a JSON file and import them back. This is useful for backing up your monitors or sharing them with others.
*   **Distill.io Compatibility:** You can import your monitors from Distill.io.
*   **Customizable:** You can set the check interval, and the maximum number of concurrent checks.
*   **Favorites:** You can mark your favorite monitors to be displayed in the popup.

---

## 🚀 Installation

1.  Clone this repository or download the source code as a ZIP file.
2.  Open your Chrome or Chromium-based browser and navigate to `chrome://extensions`.
3.  Enable "Developer mode" in the top right corner.
4.  Click on "Load unpacked" and select the folder where you cloned or extracted the source code.
5.  The Website Monitor icon will appear in your browser's toolbar.

---

## 📖 How to Use

1.  **Start Monitoring:**
    *   Navigate to the webpage you want to monitor.
    *   Click the Website Monitor icon in your toolbar and then click the `+` button, or open the dashboard and paste the URL.
    *   The page will enter "Selector Mode." Move your mouse and click on the specific element you want to track.

2.  **Manage Your Monitors:**
    *   Click the "Manage Monitors" button in the popup or right-click the extension icon and select "Options" to open the main dashboard.
    *   Here you can see all your tracked pages, manually trigger checks, delete monitors, and configure global settings.

3.  **Get Notified:**
    *   When a change is detected, you'll receive a browser notification. The extension's icon will display a badge indicating the number of pages with updates.
    *   Clicking on a monitor with changes will open the page in a new tab and clear the notification.

---

## 🛠️ Built With

*   **Manifest V3:** The latest extension platform for enhanced security, performance, and privacy.
*   **JavaScript (ES6+):** For all the core logic and functionality.
*   **HTML5 & CSS3:** For the popup and dashboard user interfaces.
*   **No external libraries:** The extension is built with vanilla JavaScript to keep it lightweight and fast.

---

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features, bug fixes, or improvements, please feel free to open an issue or submit a pull request.

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

---

## 📜 License

This project is open-source and available under the [MIT License](LICENSE).
