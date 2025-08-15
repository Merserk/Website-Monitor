// selector.js - Injected into a page to allow visual element selection.

(function() {
    // Prevent the script from being injected multiple times
    if (window.selectorScriptLoaded) {
        return;
    }
    window.selectorScriptLoaded = true;

    // --- UI ---
    const banner = document.createElement('div');
    banner.textContent = 'SELECTOR MODE: Move your mouse and click the element you want to monitor.';
    Object.assign(banner.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        background: '#32d583',
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
        target.style.outline = '2px solid #32d583';
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
                title: document.title
            }
        });
    }

    function cleanup() {
        if (lastElement) lastElement.style.outline = '';
        document.removeEventListener('mouseover', handleMouseOver);
        document.removeEventListener('click', handleClick, true);
        document.body.removeChild(banner);
        window.selectorScriptLoaded = false;
    }

    // --- Smart Selector Generation Logic ---
    function generateRobustCssSelector(el) {
        if (!(el instanceof Element)) return;

        // Regular expressions to identify unstable, auto-generated class names and IDs
        const unstableClassRegex = /^(css-|sc-|styled-|emotion-)/;
        // Enhanced regex to detect common dynamic classes including focus states
        const dynamicClassRegex = /(-focused|-active|-hover|-selected|-current|-open|-closed|-visible|-hidden|_\d+$|\d{4,})/;
        // Regex to detect common dynamic ID patterns
        const dynamicIdRegex = /^(ember\d+|\d+$|yui_)/;

        const path = [];
        while (el.nodeType === Node.ELEMENT_NODE) {
            let selector = el.nodeName.toLowerCase();

            // 1. Prioritize ID, BUT ONLY if it's not dynamic
            const id = el.id.trim();
            if (id && !dynamicIdRegex.test(id)) {
                selector += '#' + id;
                path.unshift(selector);
                break; // Stable ID is unique, no need to go further up
            }

            // 2. Prioritize stable data-* attributes
            const testId = el.getAttribute('data-testid') || el.getAttribute('data-cy') || el.getAttribute('data-test');
            if (testId) {
                 selector += `[data-testid="${testId.trim()}"]`;
                 path.unshift(selector);
                 break; // Assume test IDs are unique enough
            }

            // 3. Use stable, semantic class names (exclude dynamic classes)
            const allClasses = Array.from(el.classList);
            const stableClasses = allClasses.filter(c => 
                !unstableClassRegex.test(c) && 
                !dynamicClassRegex.test(c) && 
                c.length > 2 &&
                // Keep core ProseMirror classes but exclude state-specific ones
                (c === 'ProseMirror' || !c.includes('ProseMirror-') || 
                 (c.includes('ProseMirror-') && !c.match(/-focused|-selected|-active|-current/)))
            );

            if (stableClasses.length > 0) {
                selector += '.' + stableClasses.slice(0, 3).join('.'); // Limit to first 3 stable classes
            } else {
                // 4. Last resort: use structural position if no stable classes exist
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
        
        // Optimize the selector path - remove redundant parent selectors if child is unique enough
        if (path.length > 3) {
            const optimized = optimizeSelectorPath(path);
            return optimized;
        }
        
        return path.join(" > ");
    }

    // Helper function to optimize selector paths
    function optimizeSelectorPath(path) {
        // Start with the full path
        let bestSelector = path.join(" > ");
        
        // Try shorter combinations starting from the end (most specific)
        for (let i = Math.max(0, path.length - 3); i < path.length; i++) {
            const candidate = path.slice(i).join(" > ");
            try {
                // Test if this shorter selector still uniquely identifies the element
                const elements = document.querySelectorAll(candidate);
                if (elements.length === 1) {
                    bestSelector = candidate;
                    break;
                }
            } catch (e) {
                // Invalid selector, skip
                continue;
            }
        }
        
        return bestSelector;
    }

    // Attach listeners
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('click', handleClick, true); // Use capture phase to intercept click
})();