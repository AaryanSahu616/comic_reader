// ===== DEVICE GUIDE TAB SWITCHER =====
document.addEventListener('DOMContentLoaded', () => {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');

            // Remove active from all buttons & panes
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            // Set active
            btn.classList.add('active');
            const targetPane = document.getElementById(`tab-${targetTab}`);
            if (targetPane) {
                targetPane.classList.add('active');
            }
        });
    });

    // Smooth scroll for internal links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            const targetEl = document.querySelector(targetId);
            if (targetEl) {
                e.preventDefault();
                targetEl.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Live Gamepad Connection Notice on Landing Page
    window.addEventListener('gamepadconnected', (e) => {
        const badge = document.getElementById('gamepad-live-badge');
        if (badge) {
            badge.style.display = 'inline-flex';
            badge.textContent = `🎮 Gamepad detected: ${e.gamepad.id.split('(')[0].trim()}`;
        }
    });

    window.addEventListener('gamepaddisconnected', () => {
        const badge = document.getElementById('gamepad-live-badge');
        if (badge) {
            const gps = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
            if (gps.length === 0) {
                badge.style.display = 'none';
            }
        }
    });

    if (navigator.getGamepads && Array.from(navigator.getGamepads()).some(Boolean)) {
        const badge = document.getElementById('gamepad-live-badge');
        if (badge) badge.style.display = 'inline-flex';
    }
});
