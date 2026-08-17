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

// ===== D-PAD NAVIGATION =====
(function () {
    const parentLink = document.getElementById('parent-link');
    const setRootBtn = document.getElementById('set-root-btn');
    const folderRows = Array.from(document.querySelectorAll('[data-folder-row]'));

    // Build navigation structure:
    // Row 0: parentLink (optional), set-root-btn
    // Row 1+: each folder row has [folder-link, select-btn]
    const navRows = [];

    // Header row
    const headerRow = [];
    if (parentLink) headerRow.push(parentLink);
    if (setRootBtn) headerRow.push(setRootBtn);
    if (headerRow.length > 0) navRows.push(headerRow);

    // Folder rows
    folderRows.forEach(row => {
        const items = Array.from(row.querySelectorAll('[data-nav-item]'));
        if (items.length > 0) navRows.push(items);
    });

    if (navRows.length === 0) return;

    function focusElement(el) {
        if (!el) return;
        el.focus({ preventScroll: false });
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function findCurrentPos() {
        const active = document.activeElement;
        for (let r = 0; r < navRows.length; r++) {
            const c = navRows[r].indexOf(active);
            if (c !== -1) return { row: r, col: c };
        }
        return null;
    }

    document.addEventListener('keydown', (e) => {
        const key = e.key;
        const keyCode = e.keyCode;

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
            const active = document.activeElement;
            if (active && active.hasAttribute('data-nav-item')) {
                e.preventDefault();
                active.click();
                return;
            }
            if (active === parentLink) {
                e.preventDefault();
                active.click();
                return;
            }
        }

        // Arrow navigation
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
        e.preventDefault();

        const pos = findCurrentPos();
        if (!pos) {
            // Nothing focused — focus first item
            focusElement(navRows[0][0]);
            return;
        }

        let targetRow = pos.row;
        let targetCol = pos.col;

        switch (key) {
            case 'ArrowDown':
                targetRow = Math.min(pos.row + 1, navRows.length - 1);
                targetCol = Math.min(pos.col, navRows[targetRow].length - 1);
                break;
            case 'ArrowUp':
                targetRow = Math.max(pos.row - 1, 0);
                targetCol = Math.min(pos.col, navRows[targetRow].length - 1);
                break;
            case 'ArrowRight':
                if (pos.col + 1 < navRows[pos.row].length) {
                    targetCol = pos.col + 1;
                }
                break;
            case 'ArrowLeft':
                if (pos.col - 1 >= 0) {
                    targetCol = pos.col - 1;
                }
                break;
        }

        focusElement(navRows[targetRow][targetCol]);
    });

    // Auto-focus first focusable on TV
    if (window._tvInfo && window._tvInfo.isTVMode) {
        setTimeout(() => {
            focusElement(navRows[0][0]);
        }, 200);
    }
})();

// ===== GAMEPAD SUPPORT (Xbox / DualShock / DualSense / generic) =====
(function () {
    const GP_DEADZONE = 0.3;
    const GP_SCROLL_SPEED = 8;
    const GP_NAV_DELAY = 180;
    let gpPrevButtons = [];
    let gpAnimId = null;
    let gpConnected = false;
    let gpLastNavTime = 0;

    const parentLink = document.getElementById('parent-link');
    const setRootBtn = document.getElementById('set-root-btn');
    const folderRows = Array.from(document.querySelectorAll('[data-folder-row]'));

    // Build navigation rows (same structure as D-pad nav)
    const navRows = [];
    const headerRow = [];
    if (parentLink) headerRow.push(parentLink);
    if (setRootBtn) headerRow.push(setRootBtn);
    if (headerRow.length > 0) navRows.push(headerRow);
    folderRows.forEach(row => {
        const items = Array.from(row.querySelectorAll('[data-nav-item]'));
        if (items.length > 0) navRows.push(items);
    });

    if (navRows.length === 0) return;

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

    function btnNav(gp, i) {
        if (!gp.buttons[i] || !gp.buttons[i].pressed) return false;
        const prev = gpPrevButtons[i] || false;
        if (!prev) return true;
        if (performance.now() - gpLastNavTime > GP_NAV_DELAY) return true;
        return false;
    }

    function findPos() {
        const active = document.activeElement;
        for (let r = 0; r < navRows.length; r++) {
            const c = navRows[r].indexOf(active);
            if (c !== -1) return { row: r, col: c };
        }
        return null;
    }

    function navigate(direction) {
        const pos = findPos();
        if (!pos) {
            focusEl(navRows[0][0]);
            gpLastNavTime = performance.now();
            return;
        }

        let tr = pos.row, tc = pos.col;
        switch (direction) {
            case 'down':
                tr = Math.min(pos.row + 1, navRows.length - 1);
                tc = Math.min(pos.col, navRows[tr].length - 1);
                break;
            case 'up':
                tr = Math.max(pos.row - 1, 0);
                tc = Math.min(pos.col, navRows[tr].length - 1);
                break;
            case 'right':
                if (pos.col + 1 < navRows[pos.row].length) tc = pos.col + 1;
                break;
            case 'left':
                if (pos.col - 1 >= 0) tc = pos.col - 1;
                break;
        }
        focusEl(navRows[tr][tc]);
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
            if (btnNav(gp, 14)) navigate('left');
            if (btnNav(gp, 15)) navigate('right');
            if (btnNav(gp, 12)) navigate('up');
            if (btnNav(gp, 13)) navigate('down');

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
                if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
                else document.documentElement.requestFullscreen().catch(() => { });
            }

            // Left stick vertical → scroll page
            const lsY = Math.abs(gp.axes[1]) > GP_DEADZONE ? gp.axes[1] : 0;
            if (lsY !== 0) window.scrollBy(0, lsY * GP_SCROLL_SPEED);

            // Left stick horizontal → navigate left/right (with repeat)
            const lsX = Math.abs(gp.axes[0]) > 0.6 ? gp.axes[0] : 0;
            if (lsX !== 0 && performance.now() - gpLastNavTime > GP_NAV_DELAY) {
                navigate(lsX < 0 ? 'left' : 'right');
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
