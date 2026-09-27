// ==============================================
// core/boot.js
// Startup + orchestration
// ==============================================

(function () {
    'use strict';

    const BOOT_MIN_MS = 400;
    const BOOT_MAX_MS = 15000;

    const Boot = {
        startedAt: Date.now(),
        modules: {},
        status: 'pending',

        /* ═══ Register a module for startup ═══ */
        register: function (name, initFn) {
            this.modules[name] = { init: initFn, status: 'pending', error: null };
        },

        /* ═══ Update loader status ═══ */
        _setStatus: function (text, ready) {
            const el = document.getElementById('qamar-boot-status');
            if (!el) return;
            el.textContent = text;
            if (ready) el.classList.add('ready');
            else el.classList.remove('ready');
        },

        /* ═══ Hide loader ═══ */
        _hideLoader: function () {
            const loader = document.getElementById('qamar-boot-loader');
            if (!loader) return;
            const elapsed = Date.now() - this.startedAt;
            const remaining = Math.max(0, BOOT_MIN_MS - elapsed);
            setTimeout(function () {
                loader.classList.add('qamar-boot-hide');
                setTimeout(function () {
                    if (loader.parentNode) loader.parentNode.removeChild(loader);
                }, 450);
            }, remaining);
        },

        /* ═══ Main init ═══ */
        async run() {
            this.status = 'running';
            console.log('🚀 [boot] starting...');

            try {
                // 1. Wait for Firebase
                this._setStatus('جاري تهيئة Firebase...', false);
                if (typeof window.waitForFirebase === 'function') {
                    await window.waitForFirebase(BOOT_MAX_MS);
                    console.log('✅ [boot] Firebase ready');
                } else {
                    console.warn('⚠️ [boot] waitForFirebase not available');
                }

                // 2. Wait for auth
                this._setStatus('جاري التحقق من الجلسة...', false);
                if (typeof window.waitForAuth === 'function') {
                    try { await window.waitForAuth(5000); } catch (e) {}
                }

                // 3. Load session from localStorage
                if (typeof window.loadSession === 'function') {
                    try {
                        const user = window.loadSession();
                        if (user) {
                            window.AppState.setUser(user, user.isGuest === true);
                            console.log('✅ [boot] session restored:', user.name);
                        }
                    } catch (e) {
                        console.warn('[boot] loadSession failed:', e);
                    }
                }

                // 4. Run registered modules
                this._setStatus('جاري تشغيل الأنظمة...', false);
                await this._initModules();

                // 5. Ready
                this._setStatus('جاهز ✨', true);
                this.status = 'ready';
                window.EventBus.emit('boot:ready');
                console.log('✅ [boot] all systems ready');

            } catch (e) {
                console.error('❌ [boot] failed:', e);
                this._setStatus('فشل التشغيل — استمرار بدون Firebase', false);
                this.status = 'failed';
                window.EventBus.emit('boot:failed', e);
            }

            // Always hide loader
            this._hideLoader();

            // Expose
            window.__qamarBooted = true;
            window.__qamarBootStatus = this.status;
        },

        async _initModules() {
            const names = Object.keys(this.modules);
            for (const name of names) {
                const m = this.modules[name];
                try {
                    this._setStatus('جاري تشغيل: ' + name, false);
                    await Promise.resolve(m.init());
                    m.status = 'ready';
                    console.log('✅ [boot] module ready:', name);
                } catch (e) {
                    m.status = 'failed';
                    m.error = e;
                    console.error('❌ [boot] module failed:', name, e);
                }
            }
        }
    };

    /* ══════════════════════════════════════════════ */
    /* Auto-start                                     */
    /* ══════════════════════════════════════════════ */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(function () { Boot.run(); }, 50);
        });
    } else {
        setTimeout(function () { Boot.run(); }, 50);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarBoot = Boot;

    console.log('📦 [boot] loaded');
})();
