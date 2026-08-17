// ===== TV DETECTION =====
(function () {
    const ua = navigator.userAgent;
    const isFireTV = /\bSilk\b/i.test(ua);
    const isWebOS = /Web0S|webOS/i.test(ua);
    const isTVMode = isFireTV || isWebOS;
    if (isTVMode) document.body.classList.add('tv-mode');
    if (isFireTV) document.body.classList.add('firetv');
    if (isWebOS) document.body.classList.add('webos');
    window._tvInfo = { isFireTV, isWebOS, isTVMode };
})();

// ===== D-PAD SPATIAL NAVIGATION =====
(function () {
    const grid = document.getElementById('item-grid');
    const gridItems = Array.from(document.querySelectorAll('[data-grid-item]'));
    const navBtns = Array.from(document.querySelectorAll('.nav-links .action-btn'));
    const parentLink = document.getElementById('parent-link');

    // All focusable elements in logical order
    const allFocusable = [
        ...(parentLink ? [parentLink] : []),
        ...navBtns,
        ...gridItems
    ];

    if (allFocusable.length === 0) return;

    // Get grid column count dynamically
    function getGridColumns() {
        if (gridItems.length === 0) return 1;
        if (!grid) return 1;
        const style = window.getComputedStyle(grid);
        const cols = style.getPropertyValue('grid-template-columns').split(' ').length;
        return cols || 1;
    }

    function focusElement(el) {
        if (!el) return;
        el.focus({ preventScroll: false });
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    document.addEventListener('keydown', (e) => {
        const key = e.key;
        const keyCode = e.keyCode;
        const active = document.activeElement;

        // Back button: Fire TV (4), WebOS (461)
        if (keyCode === 4 || keyCode === 461) {
            e.preventDefault();
            if (parentLink) {
                window.location.href = parentLink.href;
            }
            return;
        }

        // Enter → click focused element
        if (key === 'Enter') {
            if (active && (active.classList.contains('item') || active.classList.contains('action-btn') || active.id === 'parent-link')) {
                e.preventDefault();
                active.click();
                return;
            }
        }

        // Arrow navigation
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
        e.preventDefault();

        const gridIndex = gridItems.indexOf(active);
        const navIndex = navBtns.indexOf(active);
        const isInGrid = gridIndex !== -1;
        const isInNav = navIndex !== -1;
        const isOnParent = active === parentLink;
        const cols = getGridColumns();

        if (isInGrid) {
            let target = null;
            switch (key) {
                case 'ArrowRight':
                    target = gridItems[gridIndex + 1] || null;
                    break;
                case 'ArrowLeft':
                    target = gridItems[gridIndex - 1] || null;
                    break;
                case 'ArrowDown':
                    target = gridItems[gridIndex + cols] || null;
                    break;
                case 'ArrowUp':
                    if (gridIndex - cols >= 0) {
                        target = gridItems[gridIndex - cols];
                    } else {
                        // Move up from grid to nav bar
                        target = navBtns[0] || parentLink || null;
                    }
                    break;
            }
            if (target) focusElement(target);
        } else if (isInNav) {
            switch (key) {
                case 'ArrowRight':
                    if (navIndex + 1 < navBtns.length) focusElement(navBtns[navIndex + 1]);
                    break;
                case 'ArrowLeft':
                    if (navIndex - 1 >= 0) focusElement(navBtns[navIndex - 1]);
                    else if (parentLink) focusElement(parentLink);
                    break;
                case 'ArrowDown':
                    if (gridItems.length > 0) focusElement(gridItems[0]);
                    break;
                case 'ArrowUp':
                    if (parentLink) focusElement(parentLink);
                    break;
            }
        } else if (isOnParent) {
            switch (key) {
                case 'ArrowDown':
                    focusElement(navBtns[0] || gridItems[0] || null);
                    break;
                case 'ArrowRight':
                    focusElement(navBtns[0] || null);
                    break;
            }
        } else {
            // Nothing focused — focus first grid item or first nav button
            focusElement(gridItems[0] || navBtns[0] || parentLink || null);
        }
    });

    // Auto-focus first grid item on TV
    if (window._tvInfo && window._tvInfo.isTVMode) {
        setTimeout(() => {
            focusElement(gridItems[0] || navBtns[0] || null);
        }, 200);
    }
})();

// ===== GAMEPAD SUPPORT (Xbox / DualShock / DualSense / generic) =====
(function () {
    // Standard mapping: 0=A/Cross, 1=B/Circle, 2=X/Square, 3=Y/Triangle
    // 4=LB/L1, 5=RB/R1, 8=Back/Share, 9=Start/Options
    // 12=DpadUp, 13=DpadDown, 14=DpadLeft, 15=DpadRight
    // Axes: 0=LeftX, 1=LeftY

    const GP_DEADZONE = 0.3;
    const GP_SCROLL_SPEED = 8;
    const GP_NAV_DELAY = 180; // ms between repeated d-pad navigations
    let gpPrevButtons = [];
    let gpAnimId = null;
    let gpConnected = false;
    let gpLastNavTime = 0;

    const grid = document.getElementById('item-grid');
    const gridItems = Array.from(document.querySelectorAll('[data-grid-item]'));
    const navBtns = Array.from(document.querySelectorAll('.nav-links .action-btn'));
    const parentLink = document.getElementById('parent-link');

    function getGridColumns() {
        if (gridItems.length === 0 || !grid) return 1;
        const style = window.getComputedStyle(grid);
        return style.getPropertyValue('grid-template-columns').split(' ').length || 1;
    }

    function focusEl(el) {
        if (!el) return;
        el.focus({ preventScroll: false });
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function getGamepad() {
        const gps = navigator.getGamepads();
        for (const gp of gps) { if (gp && gp.connected) return gp; }
        return null;
    }

    function btnJust(gp, i) {
        const now = gp.buttons[i] && gp.buttons[i].pressed;
        const prev = gpPrevButtons[i] || false;
        return now && !prev;
    }

    // D-pad with repeat support (hold to keep navigating)
    function btnNav(gp, i) {
        if (!gp.buttons[i] || !gp.buttons[i].pressed) return false;
        const prev = gpPrevButtons[i] || false;
        if (!prev) return true; // just pressed
        // Repeat after delay
        const now = performance.now();
        if (now - gpLastNavTime > GP_NAV_DELAY) return true;
        return false;
    }

    function navigateGrid(direction) {
        const active = document.activeElement;
        const gridIdx = gridItems.indexOf(active);
        const navIdx = navBtns.indexOf(active);
        const isInGrid = gridIdx !== -1;
        const isInNav = navIdx !== -1;
        const isOnParent = active === parentLink;
        const cols = getGridColumns();

        if (isInGrid) {
            let target = null;
            if (direction === 'right') target = gridItems[gridIdx + 1];
            else if (direction === 'left') target = gridItems[gridIdx - 1];
            else if (direction === 'down') target = gridItems[gridIdx + cols];
            else if (direction === 'up') {
                if (gridIdx - cols >= 0) target = gridItems[gridIdx - cols];
                else target = navBtns[0] || parentLink;
            }
            if (target) focusEl(target);
        } else if (isInNav) {
            if (direction === 'right' && navIdx + 1 < navBtns.length) focusEl(navBtns[navIdx + 1]);
            else if (direction === 'left') focusEl(navIdx > 0 ? navBtns[navIdx - 1] : parentLink || navBtns[0]);
            else if (direction === 'down' && gridItems.length > 0) focusEl(gridItems[0]);
            else if (direction === 'up' && parentLink) focusEl(parentLink);
        } else if (isOnParent) {
            if (direction === 'down') focusEl(navBtns[0] || gridItems[0]);
            else if (direction === 'right') focusEl(navBtns[0]);
        } else {
            focusEl(gridItems[0] || navBtns[0] || parentLink);
        }
        gpLastNavTime = performance.now();
    }

    window.addEventListener('gamepadconnected', () => {
        gpConnected = true;
        if (!gpAnimId) startLoop();
    });
    window.addEventListener('gamepaddisconnected', () => {
        gpConnected = Array.from(navigator.getGamepads()).some(g => g !== null);
        if (!gpConnected && gpAnimId) { cancelAnimationFrame(gpAnimId); gpAnimId = null; }
    });

    function startLoop() {
        function tick() {
            const gp = getGamepad();
            if (!gp) { gpAnimId = null; return; }

            // D-pad navigation (with repeat)
            if (btnNav(gp, 14)) navigateGrid('left');
            if (btnNav(gp, 15)) navigateGrid('right');
            if (btnNav(gp, 12)) navigateGrid('up');
            if (btnNav(gp, 13)) navigateGrid('down');

            // Face buttons (edge-triggered)
            if (btnJust(gp, 0)) {
                // A / Cross → click focused element
                const active = document.activeElement;
                if (active && active !== document.body) active.click();
            }
            if (btnJust(gp, 1)) {
                // B / Circle → go back to parent
                if (parentLink) window.location.href = parentLink.href;
            }
            if (btnJust(gp, 9)) {
                // Start → toggle fullscreen
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
                else document.documentElement.requestFullscreen().catch(() => {});
            }

            // Left stick → scroll the page
            const lsY = Math.abs(gp.axes[1]) > GP_DEADZONE ? gp.axes[1] : 0;
            if (lsY !== 0) {
                window.scrollBy(0, lsY * GP_SCROLL_SPEED);
            }

            // Left stick horizontal → navigate left/right (with repeat)
            const lsX = Math.abs(gp.axes[0]) > 0.6 ? gp.axes[0] : 0;
            if (lsX !== 0 && performance.now() - gpLastNavTime > GP_NAV_DELAY) {
                navigateGrid(lsX < 0 ? 'left' : 'right');
            }

            // Save button states
            gpPrevButtons = [];
            for (let i = 0; i < gp.buttons.length; i++) gpPrevButtons[i] = gp.buttons[i].pressed;

            gpAnimId = requestAnimationFrame(tick);
        }
        gpAnimId = requestAnimationFrame(tick);
    }

    if (navigator.getGamepads && Array.from(navigator.getGamepads()).some(g => g !== null)) {
        gpConnected = true;
        startLoop();
    }
})();
