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

// ===== CORE STATE =====
const readerConfig = window.READER_CONFIG || {};
const images = readerConfig.images || [];
const fileId = readerConfig.fileId || '';
let currentIndex = 0;
let isAnimating = false;
let currentImgElement = null;

// Zoom & Pan state
let zoomLevel = 1.0;
let panX = 0;
let panY = 0;
const ZOOM_MIN = 1.0;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.5;
const PAN_STEP = 100;
let panAnimationId = null;
let zoomIndicatorTimeout = null;

// DOM refs
const container = document.getElementById('slider-container');
const counterElement = document.getElementById('page-counter');
const uiBar = document.getElementById('ui-bar');
const zoomDisplay = document.getElementById('zoom-display');
const zoomIndicator = document.getElementById('zoom-indicator');
const backBtn = document.getElementById('back-btn');
const preloadBarFill = document.getElementById('preload-bar-fill');
const preloadBar = document.getElementById('preload-bar');
const preloadLabel = document.getElementById('preload-label');

// ===== IMAGE PRELOADER ENGINE =====
const PAGE_CACHE = new Map(); // pageIndex → 'loading' | 'loaded' | 'error'
const PRELOAD_CONCURRENCY = 3;
let preloadQueue = [];
let activePreloads = 0;
let loadedCount = 0;

function updatePreloadUI() {
    const total = images.length;
    const pct = total > 0 ? (loadedCount / total) * 100 : 0;
    preloadBarFill.style.width = pct + '%';
    if (loadedCount < total) {
        preloadLabel.textContent = `${loadedCount}/${total} cached`;
        preloadBar.classList.remove('complete');
        preloadLabel.classList.remove('complete');
    } else {
        preloadLabel.textContent = `All ${total} pages cached`;
        preloadBar.classList.add('complete');
        preloadLabel.classList.add('complete');
    }
}

function preloadPage(pageIndex) {
    if (PAGE_CACHE.has(pageIndex)) return; // Already loading or loaded
    if (pageIndex < 0 || pageIndex >= images.length) return;

    PAGE_CACHE.set(pageIndex, 'loading');
    activePreloads++;

    const img = new Image();
    img.onload = () => {
        PAGE_CACHE.set(pageIndex, 'loaded');
        activePreloads--;
        loadedCount++;
        updatePreloadUI();
        drainQueue();
    };
    img.onerror = () => {
        PAGE_CACHE.set(pageIndex, 'error');
        activePreloads--;
        drainQueue();
    };
    img.src = getImageUrl(images[pageIndex]);
}

function drainQueue() {
    while (activePreloads < PRELOAD_CONCURRENCY && preloadQueue.length > 0) {
        const idx = preloadQueue.shift();
        if (!PAGE_CACHE.has(idx)) {
            preloadPage(idx);
        } // else skip already cached, continue draining
    }
}

function schedulePreload(fromIndex) {
    // Build priority-ordered queue:
    // Phase 1: Immediate batch — next 3 pages + 1 previous
    const immediate = [];
    for (let i = 1; i <= 3; i++) {
        if (fromIndex + i < images.length) immediate.push(fromIndex + i);
    }
    if (fromIndex - 1 >= 0) immediate.push(fromIndex - 1);

    // Phase 2: Background sweep — all remaining forward, then backward
    const background = [];
    for (let i = 4; fromIndex + i < images.length; i++) {
        background.push(fromIndex + i);
    }
    for (let i = 2; fromIndex - i >= 0; i++) {
        background.push(fromIndex - i);
    }

    // Merge: immediate first, then background, skip already cached
    preloadQueue = [...immediate, ...background].filter(idx => !PAGE_CACHE.has(idx));
    drainQueue();
}

function getImageUrl(pageIndex) {
    return `/image?file_id=${encodeURIComponent(fileId)}&page_index=${pageIndex}`;
}

// ===== ZOOM & PAN (native scroll) =====
function isZoomed() {
    return zoomLevel > ZOOM_MIN + 0.01;
}

// Calculate the displayed image dimensions (object-fit: contain)
function getDisplayDimensions() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!currentImgElement) return { displayW: vw, displayH: vh };
    const imgNatW = currentImgElement.naturalWidth || vw;
    const imgNatH = currentImgElement.naturalHeight || vh;
    const aspectRatio = imgNatW / imgNatH;
    let displayW, displayH;
    if (vw / vh > aspectRatio) {
        displayH = vh;
        displayW = vh * aspectRatio;
    } else {
        displayW = vw;
        displayH = vw / aspectRatio;
    }
    return { displayW, displayH };
}

// Apply zoom by resizing the image and enabling native scroll
function applyZoom() {
    if (!currentImgElement) return;
    if (isZoomed()) {
        const { displayW, displayH } = getDisplayDimensions();
        const zoomedW = displayW * zoomLevel;
        const zoomedH = displayH * zoomLevel;
        // Switch image to actual-size mode
        currentImgElement.style.position = 'relative';
        currentImgElement.style.width = zoomedW + 'px';
        currentImgElement.style.height = zoomedH + 'px';
        currentImgElement.style.objectFit = 'fill';
        currentImgElement.style.top = 'auto';
        currentImgElement.style.left = 'auto';
        currentImgElement.style.transform = 'none';
        // Enable native scrolling — use position:fixed to escape body overflow
        container.classList.add('zoomed');
        container.style.position = 'fixed';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100vw';
        container.style.height = '100vh';
        document.body.classList.add('has-zoom');
    } else {
        // Reset to default fit-contain mode
        currentImgElement.style.position = 'absolute';
        currentImgElement.style.width = '100%';
        currentImgElement.style.height = '100%';
        currentImgElement.style.objectFit = 'contain';
        currentImgElement.style.top = '0';
        currentImgElement.style.left = '0';
        currentImgElement.style.transform = 'none';
        container.classList.remove('zoomed');
        container.style.position = 'relative';
        container.style.top = '';
        container.style.left = '';
        container.style.width = '100vw';
        container.style.height = '100dvh';
        container.scrollTop = 0;
        container.scrollLeft = 0;
        document.body.classList.remove('has-zoom');
    }
}

function setZoom(newZoom, showIndicator = true) {
    const oldZoom = zoomLevel;
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    // Round to avoid floating point drift
    zoomLevel = Math.round(zoomLevel * 10) / 10;

    applyZoom();

    // Always display top of page after zooming
    if (isZoomed()) {
        requestAnimationFrame(() => {
            container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
            container.scrollTop = 0;
        });
    }

    // Update displays
    const label = zoomLevel.toFixed(1) + '×';
    zoomDisplay.textContent = label;
    if (showIndicator && oldZoom !== zoomLevel) {
        zoomIndicator.textContent = label;
        zoomIndicator.classList.add('visible');
        clearTimeout(zoomIndicatorTimeout);
        zoomIndicatorTimeout = setTimeout(() => {
            zoomIndicator.classList.remove('visible');
        }, 1500);
    }
}

function resetZoom() {
    setZoom(ZOOM_MIN);
}

// Scroll the container by pixel amounts (for d-pad panning)
function panBy(dx, dy) {
    container.scrollLeft -= dx;
    container.scrollTop -= dy;
}

// ===== PAGE NAVIGATION =====
function showPage(index, init = false) {
    if (index < 0 || index >= images.length || (index === currentIndex && !init) || isAnimating) return;
    isAnimating = true;
    const isNext = index > currentIndex;
    currentIndex = index;
    counterElement.innerText = `${currentIndex + 1} / ${images.length}`;

    // Preserve current zoom level
    const currentZoom = zoomLevel;

    const newImg = document.createElement('img');
    newImg.className = 'comic-page';
    newImg.src = getImageUrl(images[currentIndex]);
    newImg.draggable = false;

    // Temporarily un-zoom for a clean slide transition
    if (isZoomed()) {
        container.classList.remove('zoomed');
        container.style.position = 'relative';
        container.style.top = '';
        container.style.left = '';
        document.body.classList.remove('has-zoom');
        if (currentImgElement) {
            currentImgElement.style.position = 'absolute';
            currentImgElement.style.width = '100%';
            currentImgElement.style.height = '100%';
            currentImgElement.style.objectFit = 'contain';
            currentImgElement.style.top = '0';
            currentImgElement.style.left = '0';
            currentImgElement.style.transform = 'none';
        }
    }
    container.scrollTop = 0;
    container.scrollLeft = 0;

    if (init) {
        newImg.style.transform = 'translate3d(0, 0, 0)';
        container.appendChild(newImg);
        currentImgElement = newImg;
        isAnimating = false;

        if (currentZoom > ZOOM_MIN + 0.01) {
            newImg.onload = () => {
                applyZoom();
                container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
                container.scrollTop = 0;
            };
        }
    } else {
        // Add sliding class for page transition animation
        newImg.classList.add('sliding');
        newImg.style.transform = isNext ? 'translate3d(100vw, 0, 0)' : 'translate3d(-100vw, 0, 0)';
        newImg.style.willChange = 'transform';
        container.appendChild(newImg);
        void newImg.offsetWidth; // Force reflow

        if (currentImgElement) {
            currentImgElement.classList.add('sliding');
            currentImgElement.style.willChange = 'transform';
            currentImgElement.style.transform = isNext ? 'translate3d(-100vw, 0, 0)' : 'translate3d(100vw, 0, 0)';
        }
        newImg.style.transform = 'translate3d(0, 0, 0)';

        const oldImg = currentImgElement;
        currentImgElement = newImg;

        // Helper: apply zoom only after the new image is fully loaded
        function applyZoomWhenReady() {
            if (currentImgElement !== newImg) return; // Page changed again
            applyZoom();
            requestAnimationFrame(() => {
                container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
                container.scrollTop = 0;
            });
        }

        setTimeout(() => {
            if (oldImg && oldImg.parentNode) oldImg.parentNode.removeChild(oldImg);
            // Remove sliding class and will-change after transition
            newImg.classList.remove('sliding');
            newImg.style.willChange = 'auto';
            isAnimating = false;

            // Re-apply zoom to the new page — but only after it's loaded
            if (currentZoom > ZOOM_MIN + 0.01) {
                if (newImg.naturalWidth && newImg.naturalHeight) {
                    // Image already loaded (was cached)
                    applyZoomWhenReady();
                } else {
                    // Wait for image to finish loading
                    newImg.addEventListener('load', applyZoomWhenReady, { once: true });
                }
            }
        }, 300);
    }

    // Trigger preloading from new position
    schedulePreload(currentIndex);
}

// ===== FULLSCREEN (CSS fallback) =====
function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
        document.documentElement.classList.remove('css-fullscreen');
    } else {
        document.documentElement.requestFullscreen().then(() => {
            document.documentElement.classList.remove('css-fullscreen');
        }).catch(() => {
            // Fullscreen API failed — use CSS fallback
            document.documentElement.classList.toggle('css-fullscreen');
        });
    }
}

// ===== BACK BUTTON HANDLER =====
function handleBack() {
    if (isZoomed()) {
        resetZoom();
    } else {
        // Navigate back to library
        window.location.href = backBtn.href;
    }
}

// ===== UI BUTTON EVENTS =====
document.getElementById('fullscreen-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
});
document.getElementById('zoom-in-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    setZoom(zoomLevel + ZOOM_STEP);
});
document.getElementById('zoom-out-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    setZoom(zoomLevel - ZOOM_STEP);
});
document.getElementById('zoom-reset-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    resetZoom();
});

// ===== TOUCH HANDLING (all devices) =====
let touchstartX = 0; let touchstartY = 0;
let touchStartScrollLeft = 0;
let touchStartScrollTop = 0;
let pinchStartDist = 0;
let pinchStartZoom = 1.0;
let isTouchPanning = false;

function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

container.addEventListener('touchstart', e => {
    // Pinch-to-zoom: track initial distance between two fingers
    if (e.touches.length === 2) {
        pinchStartDist = getTouchDist(e.touches);
        pinchStartZoom = zoomLevel;
        e.preventDefault();
        return;
    }

    touchstartX = e.changedTouches[0].screenX;
    touchstartY = e.changedTouches[0].screenY;
    isTouchPanning = false;

    if (isZoomed()) {
        touchStartScrollLeft = container.scrollLeft;
        touchStartScrollTop = container.scrollTop;
        isTouchPanning = true;
    }
}, { passive: false });

container.addEventListener('touchmove', e => {
    // Pinch-to-zoom: scale zoom based on finger distance change
    if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getTouchDist(e.touches);
        const scale = dist / pinchStartDist;
        const newZoom = Math.round(pinchStartZoom * scale * 10) / 10;
        setZoom(newZoom, true);
        return;
    }

    // When zoomed, native scroll handles panning via overflow:auto + touch-action
    // No manual intervention needed — the browser does it
}, { passive: false });

container.addEventListener('touchend', e => {
    // Ignore if pinch just ended (still have a finger down, or just lifted second)
    if (e.touches.length > 0) return;

    const touchendX = e.changedTouches[0].screenX;
    const touchendY = e.changedTouches[0].screenY;
    const dx = touchendX - touchstartX;
    const dy = touchendY - touchstartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (isZoomed()) {
        // When zoomed: swipe at the scroll edge navigates pages
        const atLeftEdge = container.scrollLeft <= 1;
        const atRightEdge = container.scrollLeft >= container.scrollWidth - container.clientWidth - 1;
        const isHorizontalSwipe = absDx > absDy && absDx > 60;

        if (isHorizontalSwipe) {
            if (dx < -60 && atRightEdge) {
                // Swiped left at right edge → next page
                showPage(currentIndex + 1);
            } else if (dx > 60 && atLeftEdge) {
                // Swiped right at left edge → previous page
                showPage(currentIndex - 1);
            }
        }
        return;
    }

    // Not zoomed: normal swipe page navigation
    if (absDx > absDy && absDx > 50) {
        if (dx < -50) showPage(currentIndex + 1);
        else if (dx > 50) showPage(currentIndex - 1);
    }
});

// ===== MOUSE DRAG-TO-PAN (for zoomed mode) =====
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragScrollLeft = 0;
let dragScrollTop = 0;
let hasDragged = false;

container.addEventListener('mousedown', e => {
    if (!isZoomed()) return;
    // Don't drag from UI elements
    if (e.target.closest('.ui-overlay')) return;
    isDragging = true;
    hasDragged = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragScrollLeft = container.scrollLeft;
    dragScrollTop = container.scrollTop;
    container.classList.add('grabbing');
    e.preventDefault();
});

document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDragged = true;
    }
    container.scrollLeft = dragScrollLeft - dx;
    container.scrollTop = dragScrollTop - dy;
});

document.addEventListener('mouseup', e => {
    if (isDragging) {
        isDragging = false;
        container.classList.remove('grabbing');
    }
});

// ===== WHEEL: trackpad pinch-to-zoom + horizontal scroll =====
container.addEventListener('wheel', e => {
    // Trackpad pinch-to-zoom: browsers fire wheel events with ctrlKey=true
    if (e.ctrlKey) {
        e.preventDefault();
        // deltaY is negative when pinching out (zoom in), positive when pinching in (zoom out)
        const zoomSensitivity = 0.01;
        const delta = -e.deltaY * zoomSensitivity;
        setZoom(zoomLevel + delta);
        return;
    }

    if (!isZoomed()) return;

    // Shift+wheel scrolls horizontally when zoomed
    if (e.shiftKey) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
    }
    // Normal wheel already scrolls vertically via native overflow:auto
}, { passive: false });

// ===== CLICK NAV (preserved) =====
container.addEventListener('click', e => {
    if (isZoomed()) {
        // When zoomed, click toggles UI only (but not after dragging)
        if (!hasDragged) {
            uiBar.classList.toggle('hidden');
        }
        return;
    }
    if (e.clientX < window.innerWidth * 0.3) showPage(currentIndex - 1);
    else if (e.clientX > window.innerWidth * 0.7) showPage(currentIndex + 1);
    else uiBar.classList.toggle('hidden');
});

// ===== KEYBOARD / D-PAD / REMOTE CONTROL =====
// Fire TV Remote keyCodes:
//   D-pad: Up=38, Down=40, Left=37, Right=39
//   Select/Enter: 13
//   Back: 4
//   Play/Pause: 179
//   Rewind: 227
//   Fast Forward: 228

// Continuous pan tracking
const keysDown = new Set();
let continuousPanId = null;
// Zoom cycle levels for Play/Pause button
const ZOOM_LEVELS = [1.0, 1.5, 2.0, 2.5, 3.0];

function startContinuousPan() {
    if (continuousPanId) return;
    function tick() {
        let dx = 0, dy = 0;
        if (keysDown.has('ArrowLeft')) dx += PAN_STEP * 0.4;
        if (keysDown.has('ArrowRight')) dx -= PAN_STEP * 0.4;
        if (keysDown.has('ArrowUp')) dy += PAN_STEP * 0.4;
        if (keysDown.has('ArrowDown')) dy -= PAN_STEP * 0.4;
        if (dx !== 0 || dy !== 0) {
            panBy(dx, dy);
        }
        if (keysDown.size > 0) {
            continuousPanId = requestAnimationFrame(tick);
        } else {
            continuousPanId = null;
        }
    }
    continuousPanId = requestAnimationFrame(tick);
}

function stopContinuousPan() {
    if (continuousPanId) {
        cancelAnimationFrame(continuousPanId);
        continuousPanId = null;
    }
}

document.addEventListener('keydown', e => {
    const key = e.key;
    const keyCode = e.keyCode;

    // Back button: Fire TV (keyCode 4), WebOS (keyCode 461)
    if (keyCode === 4 || keyCode === 461) {
        e.preventDefault();
        handleBack();
        return;
    }

    // ── Fire TV media buttons ──
    // Rewind (⏪) → previous page (always, regardless of zoom)
    if (keyCode === 227) {
        e.preventDefault();
        showPage(currentIndex - 1);
        return;
    }
    // Fast Forward (⏩) → next page (always, regardless of zoom)
    if (keyCode === 228) {
        e.preventDefault();
        showPage(currentIndex + 1);
        return;
    }
    // Play/Pause → cycle zoom levels (1× → 1.5× → 2× → 2.5× → 3× → 1×)
    if (keyCode === 179) {
        e.preventDefault();
        // Find next zoom level in cycle
        let nextIdx = 0;
        for (let i = 0; i < ZOOM_LEVELS.length; i++) {
            if (Math.abs(zoomLevel - ZOOM_LEVELS[i]) < 0.05) {
                nextIdx = (i + 1) % ZOOM_LEVELS.length;
                break;
            }
        }
        setZoom(ZOOM_LEVELS[nextIdx]);
        return;
    }

    // ── Arrow keys / D-pad ──
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
        e.preventDefault();

        const isTV = window._tvInfo && window._tvInfo.isTVMode;

        if (isTV && isZoomed()) {
            // TV D-pad: pan the zoomed image (no mouse/trackpad available)
            if (!keysDown.has(key)) {
                keysDown.add(key);
                const dx = key === 'ArrowLeft' ? PAN_STEP : key === 'ArrowRight' ? -PAN_STEP : 0;
                const dy = key === 'ArrowUp' ? PAN_STEP : key === 'ArrowDown' ? -PAN_STEP : 0;
                panBy(dx, dy);
                startContinuousPan();
            }
        } else if (isTV) {
            // TV at 1×: track keys so held-key → zoom → pan works seamlessly
            if (!keysDown.has(key)) {
                keysDown.add(key);
            }
        } else {
            // PC/Laptop: arrows always navigate pages (panning via mouse/trackpad)
            if (key === 'ArrowRight') showPage(currentIndex + 1);
            else if (key === 'ArrowLeft') showPage(currentIndex - 1);
            else if (key === 'ArrowUp' || key === 'ArrowDown') {
                uiBar.classList.toggle('hidden');
            }
        }
        return;
    }

    // Enter / Select — toggle UI
    if (key === 'Enter') {
        // Don't capture if a button is focused
        if (document.activeElement && document.activeElement.closest('.ui-overlay')) return;
        e.preventDefault();
        uiBar.classList.toggle('hidden');
        return;
    }

    // Zoom in: + / = (keyCodes 187 numpad 107)
    if (key === '+' || key === '=' || keyCode === 187 || keyCode === 107) {
        e.preventDefault();
        setZoom(zoomLevel + ZOOM_STEP);
        return;
    }
    // Zoom out: - (keyCodes 189, numpad 109)
    if (key === '-' || keyCode === 189 || keyCode === 109) {
        e.preventDefault();
        setZoom(zoomLevel - ZOOM_STEP);
        return;
    }
    // Reset zoom: 0 (keyCodes 48, numpad 96)
    if (key === '0' || keyCode === 48 || keyCode === 96) {
        e.preventDefault();
        resetZoom();
        return;
    }

    // Fullscreen toggle
    if (key === 'f' || key === 'F') {
        toggleFullscreen();
        return;
    }
});

document.addEventListener('keyup', e => {
    keysDown.delete(e.key);
    if (keysDown.size === 0) {
        stopContinuousPan();
    }
});

// ===== GAMEPAD SUPPORT (Xbox / DualShock / DualSense / generic) =====
// Standard Gamepad mapping (works with any "standard" mapped controller):
//   Buttons:
//     0 = A / Cross          1 = B / Circle
//     2 = X / Square         3 = Y / Triangle
//     4 = LB / L1            5 = RB / R1
//     6 = LT / L2            7 = RT / R2
//     8 = Back / Share       9 = Start / Options
//    10 = L3 (stick click)  11 = R3 (stick click)
//    12 = D-pad Up          13 = D-pad Down
//    14 = D-pad Left        15 = D-pad Right
//   Axes:
//     0 = Left stick X      1 = Left stick Y
//     2 = Right stick X     3 = Right stick Y

const GP_DEADZONE = 0.15;
const GP_SCROLL_SPEED = 14;    // pixels per frame for left stick scroll
const GP_ZOOM_SPEED = 0.03;    // zoom delta per frame for right stick
let gpPrevButtons = [];        // previous frame button states for edge detection
let gpAnimId = null;
let gpConnected = false;
let gpZoomAccum = 0;           // accumulator for smooth fractional zoom

window.addEventListener('gamepadconnected', e => {
    console.log(`Gamepad connected: ${e.gamepad.id} [${e.gamepad.mapping}]`);
    gpConnected = true;
    if (!gpAnimId) startGamepadLoop();
});

window.addEventListener('gamepaddisconnected', e => {
    console.log(`Gamepad disconnected: ${e.gamepad.id}`);
    const gamepads = navigator.getGamepads();
    gpConnected = Array.from(gamepads).some(gp => gp !== null);
    if (!gpConnected && gpAnimId) {
        cancelAnimationFrame(gpAnimId);
        gpAnimId = null;
    }
});

function getGamepad() {
    const gamepads = navigator.getGamepads();
    for (const gp of gamepads) {
        if (gp && gp.connected) return gp;
    }
    return null;
}

function gpButtonPressed(gp, index) {
    return gp.buttons.length > index && gp.buttons[index] && gp.buttons[index].pressed;
}

function gpButtonJustPressed(gp, index) {
    if (gp.buttons.length <= index) return false;
    const now = gp.buttons[index].pressed;
    const prev = gpPrevButtons[index] || false;
    return now && !prev;
}

function applyStickDeadzone(value) {
    return Math.abs(value) > GP_DEADZONE ? value : 0;
}

// Smooth zoom: accumulates fractional changes and applies once they cross 0.05
function gpSmoothZoom(delta) {
    if (delta === 0) {
        // Reset accumulator when stick is neutral so next tilt starts fresh
        gpZoomAccum = 0;
        return;
    }
    gpZoomAccum += delta;
    // Apply zoom when accumulator has built up enough
    if (Math.abs(gpZoomAccum) >= 0.05) {
        const rawTarget = zoomLevel + gpZoomAccum;
        // Round to nearest 0.1 for clean display
        const snapped = Math.round(rawTarget * 10) / 10;
        const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, snapped));
        if (clamped !== zoomLevel) {
            // Bypass setZoom's rounding — set directly
            zoomLevel = clamped;
            applyZoom();
            if (isZoomed()) {
                requestAnimationFrame(() => {
                    container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
                    container.scrollTop = 0;
                });
            }
            const label = zoomLevel.toFixed(1) + '×';
            zoomDisplay.textContent = label;
            zoomIndicator.textContent = label;
            zoomIndicator.classList.add('visible');
            clearTimeout(zoomIndicatorTimeout);
            zoomIndicatorTimeout = setTimeout(() => {
                zoomIndicator.classList.remove('visible');
            }, 1500);
        }
        gpZoomAccum = 0;
    }
}

function startGamepadLoop() {
    function tick() {
        const gp = getGamepad();
        if (!gp) {
            gpAnimId = null;
            return;
        }

        // ── D-pad: page navigation (edge-triggered) ──
        if (gpButtonJustPressed(gp, 14)) {
            showPage(currentIndex - 1);
        }
        if (gpButtonJustPressed(gp, 15)) {
            showPage(currentIndex + 1);
        }
        if (gpButtonJustPressed(gp, 12)) {
            uiBar.classList.toggle('hidden');
        }
        if (gpButtonJustPressed(gp, 13)) {
            uiBar.classList.toggle('hidden');
        }

        // ── Face buttons (edge-triggered) ──
        if (gpButtonJustPressed(gp, 0)) {
            // A / Cross → toggle UI bar
            uiBar.classList.toggle('hidden');
        }
        if (gpButtonJustPressed(gp, 1)) {
            // B / Circle → back (reset zoom or navigate back)
            handleBack();
        }
        if (gpButtonJustPressed(gp, 2)) {
            // X / Square → toggle fullscreen
            toggleFullscreen();
        }
        if (gpButtonJustPressed(gp, 3)) {
            // Y / Triangle → reset zoom
            resetZoom();
        }

        // ── Bumpers: zoom in/out step (edge-triggered) ──
        if (gpButtonJustPressed(gp, 5)) {
            setZoom(zoomLevel + ZOOM_STEP);
        }
        if (gpButtonJustPressed(gp, 4)) {
            setZoom(zoomLevel - ZOOM_STEP);
        }

        // ── Triggers: fine zoom (continuous, analog pressure) ──
        const lt = gp.buttons.length > 6 && gp.buttons[6] ? gp.buttons[6].value : 0;
        const rt = gp.buttons.length > 7 && gp.buttons[7] ? gp.buttons[7].value : 0;
        if (rt > 0.1 || lt > 0.1) {
            gpSmoothZoom((rt - lt) * GP_ZOOM_SPEED);
        }

        // ── Left stick: scroll / pan when zoomed (continuous) ──
        if (isZoomed()) {
            const lsX = applyStickDeadzone(gp.axes[0] || 0);
            const lsY = applyStickDeadzone(gp.axes[1] || 0);
            if (lsX !== 0 || lsY !== 0) {
                container.scrollLeft += lsX * GP_SCROLL_SPEED;
                container.scrollTop += lsY * GP_SCROLL_SPEED;
            }
        }

        // ── Right stick Y-axis: zoom (continuous) ──
        const rsY = applyStickDeadzone(gp.axes.length > 3 ? (gp.axes[3] || 0) : 0);
        // Push up (negative Y) = zoom in, push down = zoom out
        gpSmoothZoom(-rsY * GP_ZOOM_SPEED);

        // ── Start / Options button ──
        if (gpButtonJustPressed(gp, 9)) {
            toggleFullscreen();
        }
        if (gpButtonJustPressed(gp, 8)) {
            uiBar.classList.toggle('hidden');
        }

        // ── Stick clicks ──
        if (gpButtonJustPressed(gp, 10)) {
            // L3 → reset scroll to center/top
            if (isZoomed()) {
                container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
                container.scrollTop = 0;
            }
        }
        if (gpButtonJustPressed(gp, 11)) {
            // R3 → reset zoom
            resetZoom();
        }

        // Save button states for edge detection next frame
        gpPrevButtons = [];
        for (let i = 0; i < gp.buttons.length; i++) {
            gpPrevButtons[i] = gp.buttons[i].pressed;
        }

        gpAnimId = requestAnimationFrame(tick);
    }

    gpAnimId = requestAnimationFrame(tick);
}

// Check on load in case gamepad was already connected
if (navigator.getGamepads && Array.from(navigator.getGamepads()).some(gp => gp !== null)) {
    gpConnected = true;
    startGamepadLoop();
}

// ===== INIT =====
if (images.length > 0) {
    showPage(0, true);
    // Kick off initial preload
    updatePreloadUI();
} else {
    container.innerHTML = "<p style='color:#94a3b8; font-size:1.2rem;'>No images found.</p>";
}

// Focus management for TV — don't let focus get lost
if (window._tvInfo && window._tvInfo.isTVMode) {
    document.addEventListener('focusout', (e) => {
        setTimeout(() => {
            if (!document.activeElement || document.activeElement === document.body) {
                container.focus();
            }
        }, 100);
    });
    container.setAttribute('tabindex', '-1');
}
