(function () {
    // Expose the initialization function globally
    window.initWebsiteMonitorSelector = function (monitorIdToEdit) {
        // If already active, cleanup first to reset state (e.g. switching from Edit to Add)
        if (window.websiteMonitorCleanup) {
            window.websiteMonitorCleanup();
        }

        const isEditMode = (typeof monitorIdToEdit !== 'undefined' && monitorIdToEdit !== null);

        // --- UI ---
        const banner = document.createElement('div');
        banner.textContent = isEditMode
            ? 'EDIT MODE: Select the new element for this monitor.'
            : 'SELECTOR MODE: Move your mouse and click the element you want to monitor.';
        Object.assign(banner.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            background: isEditMode ? '#ffcd3c' : '#32d583', // Yellow for edit, Green for new
            color: '#012018',
            textAlign: 'center',
            padding: '10px',
            zIndex: '99999999',
            fontFamily: 'sans-serif',
            fontSize: '16px',
            fontWeight: 'bold',
            boxSizing: 'border-box'
        });
        document.body.appendChild(banner);

        let lastElement = null;

        // --- Event Listeners ---
        function handleMouseOver(e) {
            const target = e.target;
            if (target === banner) return;
            if (lastElement) {
                lastElement.style.outline = '';
            }
            target.style.outline = isEditMode ? '2px solid #ffcd3c' : '2px solid #32d583';
            lastElement = target;
        }

        function handleClick(e) {
            e.preventDefault();
            e.stopPropagation();

            const target = e.target;
            if (target === banner) return;

            const selector = generateRobustCssSelector(target);
            const initialText = target.innerText;

            cleanup();

            // Send the selected data back to the extension
            chrome.runtime.sendMessage({
                type: 'elementSelected',
                payload: {
                    selector: selector,
                    initialText: initialText,
                    url: window.location.href,
                    title: document.title,
                    monitorId: monitorIdToEdit // Explicitly passed ID
                }
            });
        }

        function cleanup() {
            if (lastElement) lastElement.style.outline = '';
            document.removeEventListener('mouseover', handleMouseOver);
            document.removeEventListener('click', handleClick, true);
            if (banner.parentNode) banner.parentNode.removeChild(banner);
            window.websiteMonitorCleanup = null;
        }

        // Expose cleanup for external reset
        window.websiteMonitorCleanup = cleanup;

        // Attach listeners
        document.addEventListener('mouseover', handleMouseOver);
        document.addEventListener('click', handleClick, true);
    };

    // --- Smart Selector Generation Logic ---
    function generateRobustCssSelector(el) {
        if (!(el instanceof Element)) return;

        // Regular expressions to identify unstable, auto-generated class names and IDs
        const unstableClassRegex = /^(css-|sc-|styled-|emotion-)/;
        const dynamicClassRegex = /(-focused|-active|-hover|-selected|-current|-open|-closed|-visible|-hidden|_\d+$|\d{4,})/;
        const dynamicIdRegex = /^(ember\d+|\d+$|yui_)/;

        const path = [];
        while (el.nodeType === Node.ELEMENT_NODE) {
            let selector = el.nodeName.toLowerCase();

            // 1. Prioritize ID, BUT ONLY if it's not dynamic
            const id = el.id.trim();
            if (id && !dynamicIdRegex.test(id)) {
                selector += '#' + id;
                path.unshift(selector);
                break;
            }

            // 2. Prioritize stable data-* attributes
            const testId = el.getAttribute('data-testid') || el.getAttribute('data-cy') || el.getAttribute('data-test');
            if (testId) {
                selector += `[data-testid="${testId.trim()}"]`;
                path.unshift(selector);
                break;
            }

            // 3. Use stable, semantic class names
            const allClasses = Array.from(el.classList);
            const stableClasses = allClasses.filter(c =>
                !unstableClassRegex.test(c) &&
                !dynamicClassRegex.test(c) &&
                c.length > 2 &&
                (c === 'ProseMirror' || !c.includes('ProseMirror-') ||
                    (c.includes('ProseMirror-') && !c.match(/-focused|-selected|-active|-current/)))
            );

            if (stableClasses.length > 0) {
                selector += '.' + stableClasses.slice(0, 3).join('.');
            } else {
                // 4. Last resort: use structural position
                let sib = el, nth = 1;
                while (sib = sib.previousElementSibling) {
                    if (sib.nodeName.toLowerCase() === el.nodeName.toLowerCase()) {
                        nth++;
                    }
                }
                if (nth > 1) {
                    selector += `:nth-of-type(${nth})`;
                }
            }

            path.unshift(selector);
            el = el.parentNode;
        }

        if (path.length > 3) {
            return optimizeSelectorPath(path);
        }

        return path.join(" > ");
    }

    function optimizeSelectorPath(path) {
        let bestSelector = path.join(" > ");
        for (let i = Math.max(0, path.length - 3); i < path.length; i++) {
            const candidate = path.slice(i).join(" > ");
            try {
                const elements = document.querySelectorAll(candidate);
                if (elements.length === 1) {
                    bestSelector = candidate;
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        return bestSelector;
    }
})();