// ==============================================
// core/boot.js v2 — orchestrator موحّد
// ==============================================
// يعتمد على: كل الملفات (يُحمَّل بعدها)
// يعطي: window.QamarBoot
// ==============================================

(function () {
    'use strict';

    if (window.QamarBoot) return;

    const LOG_TAG = '[BOOT]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); }
    };

    /* ══════════════════════════════════════════════ */
    /* Config                                          */
    /* ══════════════════════════════════════════════ */
    const CONFIG = {
        MIN_LOADER_MS: 800,
        MAX_WAIT_MS: 20000,
        STAGES: ['core', 'auth', 'chat', 'background', 'ready'],
        EXPECTED_MS: {
            core: 1500,
            auth: 800,
            chat: 1000,
            background: 3000,
            ready: 200
        }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        startedAt: 0,
        currentStage: null,
        completedStages: {},
        stageTimings: {},
        listeners: {},
        status: 'pending',
        failureReason: null,
        _resolvedReady: false
    };

    /* ══════════════════════════════════════════════ */
    /* Loader UI                                       */
    /* ══════════════════════════════════════════════ */
    function _getLoaderEls() {
        return {
            root: document.getElementById('qamar-boot-loader'),
            status: document.getElementById('qamar-boot-status'),
            bar: document.getElementById('qamar-boot-bar'),
            barTrack: document.getElementById('qamar-boot-bar-track'),
            title: document.getElementById('qamar-boot-title')
        };
    }

    function _setLoaderStatus(text, ready) {
        const els = _getLoaderEls();
        if (!els.status) return;
        els.status.textContent = text;
        if (ready) els.status.classList.add('ready');
        else els.status.classList.remove('ready');
    }

    function _setLoaderProgress(pct) {
        const els = _getLoaderEls();
        if (!els.barTrack || !els.bar) return;
        els.bar.style.animation = 'none';
        els.bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
        els.bar.style.transition = 'width 0.4s ease';
        els.bar.style.left = '0';
        els.bar.style.transform = 'none';
        els.bar.style.background = 'linear-gradient(90deg, #d4af37, #ffd700)';
        els.bar.style.borderRadius = '3px';
    }

    function _hideLoader() {
        const els = _getLoaderEls();
        if (!els.root) return;
        const elapsed = Date.now() - State.startedAt;
        const remaining = Math.max(0, CONFIG.MIN_LOADER_MS - elapsed);
        setTimeout(function () {
            els.root.classList.add('qamar-boot-hide');
            setTimeout(function () {
                if (els.root && els.root.parentNode) {
                    els.root.parentNode.removeChild(els.root);
                }
            }, 450);
        }, remaining);
    }

    /* ══════════════════════════════════════════════ */
    /* Stage events                                    */
    /* ══════════════════════════════════════════════ */
    function whenReady(stage, cb) {
        if (typeof cb !== 'function') return function () {};

        if (State.completedStages[stage]) {
            setTimeout(cb, 0);
            return function () {};
        }

        if (!State.listeners[stage]) State.listeners[stage] = [];
        State.listeners[stage].push(cb);

        return function off() {
            if (!State.listeners[stage]) return;
            State.listeners[stage] = State.listeners[stage].filter(function (h) { return h !== cb; });
        };
    }

    function _emitStage(stage) {
        State.completedStages[stage] = Date.now();
        Logger.info('✅ Stage:', stage,
            '(' + (State.stageTimings[stage] || 0) + 'ms)');

        if (window.EventBus) {
            try { window.EventBus.emit('boot:stage:' + stage, { stage: stage }); } catch (e) {}
        }

        const arr = State.listeners[stage];
        if (arr) {
            arr.slice().forEach(function (cb) {
                try { cb({ stage: stage }); } catch (e) {
                    Logger.warn('Stage listener error:', e);
                }
            });
            State.listeners[stage] = [];
        }

        if (stage === 'ready') {
            if (!State._resolvedReady) {
                State._resolvedReady = true;
                State.status = 'ready';
                if (window.EventBus) {
                    try { window.EventBus.emit('boot:ready', {}); } catch (e) {}
                }
            }
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Stage runners                                   */
    /* ══════════════════════════════════════════════ */
    async function _runStage(stage, fn, label) {
        const start = Date.now();
        State.currentStage = stage;

        if (label) _setLoaderStatus(label, false);

        try {
            await Promise.resolve().then(fn);
            State.stageTimings[stage] = Date.now() - start;
            _emitStage(stage);
        } catch (e) {
            Logger.error('Stage ' + stage + ' failed:', e.message || e);
            State.stageTimings[stage] = Date.now() - start;
            _emitStage(stage);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Stage 0 — core                                  */
    /* ══════════════════════════════════════════════ */
    async function _stageCore() {
        _setLoaderProgress(10);

        if (typeof window.waitForFirebase === 'function') {
            try { await window.waitForFirebase(CONFIG.MAX_WAIT_MS); }
            catch (e) { Logger.warn('waitForFirebase failed:', e.message); }
        } else {
            Logger.warn('waitForFirebase not available');
        }
        _setLoaderProgress(25);

        if (!window.QamarFB) {
            Logger.warn('QamarFB not ready after Firebase init');
        }

        if (window.QamarNet && typeof window.QamarNet.measure === 'function') {
            try {
                await Promise.race([
                    window.QamarNet.measure(),
                    new Promise(function (r) { setTimeout(r, 2000); })
                ]);
            } catch (e) {}
        }
        _setLoaderProgress(35);

        if (window.QamarAdaptive) {
            Logger.debug('Adaptive profile:', window.QamarAdaptive.getProfileName());
        }

        _setLoaderStatus('جاري تجهيز الأنظمة...', false);
    }

    /* ══════════════════════════════════════════════ */
    /* Stage 1 — auth                                  */
    /* ══════════════════════════════════════════════ */
    async function _stageAuth() {
        _setLoaderProgress(45);

        if (window.QamarAuth && typeof window.QamarAuth.waitForAuth === 'function') {
            try { await window.QamarAuth.waitForAuth(6000); }
            catch (e) {}
        }
        _setLoaderProgress(55);

        if (window.QamarSession && typeof window.QamarSession.loadSession === 'function') {
            try { window.QamarSession.loadSession(); } catch (e) {}
        }

        _setLoaderStatus('جاهز — يمكنك الدخول الآن', true);
        _setLoaderProgress(60);
    }

    /* ══════════════════════════════════════════════ */
    /* Stage 2 — chat                                  */
    /* ══════════════════════════════════════════════ */
    async function _stageChat() {
        _setLoaderProgress(70);

        await _waitForGlobals([
            'QamarChat',
            'QamarChatInput',
            'QamarChatUI',
            'QamarRooms'
        ], 4000);

        _setLoaderProgress(80);
    }

    /* ══════════════════════════════════════════════ */
    /* Stage 3 — background                            */
    /* ══════════════════════════════════════════════ */
    async function _stageBackground() {
        const deferMs = (window.QamarAdaptive && typeof window.QamarAdaptive.get === 'function')
            ? (window.QamarAdaptive.get('deferHeavyModules') || 0)
            : 2000;

        if (deferMs > 0) {
            Logger.info('⏳ Deferring background modules by', deferMs + 'ms');
            await _sleep(deferMs);
        }

        _setLoaderProgress(90);

        await _waitForGlobals([
            'QamarBots',
            'QamarBotCommands',
            'QamarCleaners',
            'QamarDeviceGuard',
            'QamarPM',
            'QamarReports',
            'QamarBans'
        ], 6000);

        _setLoaderProgress(98);
    }

    /* ══════════════════════════════════════════════ */
    /* Stage 4 — ready                                 */
    /* ══════════════════════════════════════════════ */
    // ⭐ FIXED: اخفِ اللودر دائماً (كان ينتظر تسجيل دخول)
    async function _stageReady() {
        _setLoaderProgress(100);
        _setLoaderStatus('جاهز ✨', true);

        setTimeout(function () {
            _hideLoader();
        }, 400);
    }

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _sleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    function _waitForGlobals(names, timeoutMs) {
        const start = Date.now();
        return new Promise(function (resolve) {
            const check = function () {
                const allReady = names.every(function (n) {
                    return window[n] !== undefined && window[n] !== null;
                });
                if (allReady) {
                    Logger.debug('Globals ready:', names.join(', '));
                    return resolve(true);
                }
                if (Date.now() - start >= timeoutMs) {
                    const missing = names.filter(function (n) {
                        return !window[n] || window[n] === null;
                    });
                    Logger.warn('Timeout waiting for globals:', missing.join(', '));
                    return resolve(false);
                }
                setTimeout(check, 100);
            };
            check();
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Main run                                        */
    /* ══════════════════════════════════════════════ */
    async function run() {
        if (State.status === 'running' || State.status === 'ready') return;

        State.status = 'running';
        State.startedAt = Date.now();

        Logger.info('🚀 [boot] starting...');
        _setLoaderProgress(5);
        _setLoaderStatus('جاري التحميل...', false);

        await _runStage('core', _stageCore, 'جاري تهيئة Firebase...');
        await _runStage('auth', _stageAuth, 'جاري تجهيز الجلسة...');
        await _runStage('chat', _stageChat, 'جاري تهيئة الشات...');
        await _runStage('background', _stageBackground, 'جاري تحميل البوتات...');
        await _runStage('ready', _stageReady, null);

        const total = Date.now() - State.startedAt;
        Logger.info('✅ [boot] all systems ready in', total + 'ms');
        Logger.info('Stage timings:',
            Object.keys(State.stageTimings).map(function (k) {
                return k + '=' + State.stageTimings[k] + 'ms';
            }).join(', '));

        try {
            window.__qamarBooted = true;
            window.__qamarBootStatus = 'ready';
            window.__qamarBootTimings = Object.assign({}, State.stageTimings);
        } catch (e) {}
    }

    /* ══════════════════════════════════════════════ */
    /* Failure                                         */
    /* ══════════════════════════════════════════════ */
    function fail(reason) {
        State.status = 'failed';
        State.failureReason = reason || 'unknown';
        _setLoaderStatus('فشل التشغيل — يمكنك المتابعة يدوياً', false);
        Logger.error('❌ [boot] failed:', reason);
        if (window.EventBus) {
            try { window.EventBus.emit('boot:failed', { reason: reason }); } catch (e) {}
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Reset loader                                    */
    /* ══════════════════════════════════════════════ */
    function hideLoader() {
        _hideLoader();
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStage() {
        return State.currentStage;
    }

    function status() {
        return {
            status: State.status,
            currentStage: State.currentStage,
            completedStages: Object.keys(State.completedStages),
            stageTimings: Object.assign({}, State.stageTimings),
            startedAt: State.startedAt,
            elapsed: State.startedAt ? (Date.now() - State.startedAt) : 0,
            failureReason: State.failureReason
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Auto-start                                      */
    /* ══════════════════════════════════════════════ */
    function _autoStart() {
        setTimeout(function () {
            run().catch(function (e) {
                Logger.error('Boot run error:', e);
                fail(e.message || 'run-error');
            });
        }, 50);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _autoStart);
    } else {
        _autoStart();
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarBoot = {
        CONFIG: CONFIG,
        run: run,
        fail: fail,
        hideLoader: hideLoader,
        whenReady: whenReady,
        getStage: getStage,
        status: status
    };

    window.QamarBootLite = window.QamarBoot;

    Logger.info('📦 [boot.js v2] loaded |', CONFIG.STAGES.length, 'stages');
})();
