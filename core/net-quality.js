// ==============================================
// core/net-quality.js
// قياس جودة الاتصال + تصنيف (fast/medium/slow/very-slow)
// ==============================================
// يعتمد على: firebase/firebase.js + firebase/resilience.js
// يعطي: window.QamarNet
// ==============================================
// ⭐ v1:
//   1. يقيس: effectiveType, rtt, downlink, successRate
//   2. يصنّف: fast (>=80) | medium (>=55) | slow (>=30) | very-slow (<30)
//   3. مراقبة دورية كل 30s + onchange فوري
//   4. تخزين localStorage (5 min TTL)
//   5. يستمع لـ QamarResilience (heartbeat + reconnect)
//   6. API نظيف: get/score/getMetrics/onChange/isAtLeast
// ==============================================

(function () {
    'use strict';

    if (window.QamarNet) return;

    const LOG_TAG = '[NET]';
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
        MEASURE_INTERVAL_MS: 30 * 1000,
        PING_TIMEOUT_MS: 5000,
        HISTORY_SIZE: 10,
        STORAGE_KEY: 'qamar_net_quality',
        STORAGE_TTL_MS: 5 * 60 * 1000,
        THRESHOLDS: {
            FAST: 80,
            MEDIUM: 55,
            SLOW: 30
        }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        current: 'medium',
        score: 55,
        metrics: {
            rtt: null,
            downlink: null,
            effectiveType: null,
            saveData: false,
            online: true,
            successRate: 1.0,
            lastMeasure: 0,
            measuredCount: 0,
            rttHistory: []
        },
        listeners: [],
        intervalTimer: null,
        _initialized: false
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onChange(cb) {
        if (typeof cb !== 'function') return function () {};
        State.listeners.push(cb);
        return function off() {
            State.listeners = State.listeners.filter(function (h) { return h !== cb; });
        };
    }

    function _emit(name, payload) {
        if (window.EventBus) {
            try { window.EventBus.emit(name, payload); } catch (e) {}
        }
        State.listeners.slice().forEach(function (cb) {
            try { cb({ name: name, data: payload }); } catch (e) {}
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Storage                                         */
    /* ══════════════════════════════════════════════ */
    function _loadFromStorage() {
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.at) return null;
            if (Date.now() - data.at > CONFIG.STORAGE_TTL_MS) return null;
            return data;
        } catch (e) { return null; }
    }

    function _saveToStorage() {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
                current: State.current,
                score: State.score,
                metrics: State.metrics,
                at: Date.now()
            }));
        } catch (e) {}
    }

    /* ══════════════════════════════════════════════ */
    /* Score calculation                               */
    /* ══════════════════════════════════════════════ */
    function _scoreFromEffectiveType(type) {
        switch (type) {
            case '4g':      return 100;
            case '3g':      return 60;
            case '2g':      return 25;
            case 'slow-2g': return 10;
            default:        return 50;
        }
    }

    function _scoreFromRtt(rtt) {
        if (rtt === null || rtt === undefined) return 50;
        if (rtt < 50)   return 100;
        if (rtt < 150)  return 80;
        if (rtt < 400)  return 50;
        if (rtt < 800)  return 25;
        return 10;
    }

    function _scoreFromDownlink(mbps) {
        if (mbps === null || mbps === undefined) return 50;
        if (mbps >= 10)  return 100;
        if (mbps >= 5)   return 80;
        if (mbps >= 1)   return 50;
        if (mbps >= 0.5) return 25;
        return 10;
    }

    function _scoreFromSuccessRate(rate) {
        if (rate === null || rate === undefined) return 50;
        return Math.round(Math.max(0, Math.min(1, rate)) * 100);
    }

    function _computeScore() {
        if (!State.metrics.online) return 0;

        const sET = _scoreFromEffectiveType(State.metrics.effectiveType);
        const sRtt = _scoreFromRtt(State.metrics.rtt);
        const sDl  = _scoreFromDownlink(State.metrics.downlink);
        const sSr  = _scoreFromSuccessRate(State.metrics.successRate);

        const score = Math.round(
            sET * 0.20 +
            sRtt * 0.30 +
            sDl  * 0.20 +
            sSr  * 0.30
        );

        return Math.max(0, Math.min(100, score));
    }

    function _classify(score) {
        if (score >= CONFIG.THRESHOLDS.FAST) return 'fast';
        if (score >= CONFIG.THRESHOLDS.MEDIUM) return 'medium';
        if (score >= CONFIG.THRESHOLDS.SLOW) return 'slow';
        return 'very-slow';
    }

    /* ══════════════════════════════════════════════ */
    /* Ping (via QamarFB .info/connected)              */
    /* ══════════════════════════════════════════════ */
    function _ping() {
        if (!window.QamarFB || !window.QamarFB.isReady || !window.QamarFB.isReady()) {
            return Promise.resolve(null);
        }
        const start = Date.now();
        return window.QamarFB.get('.info/connected', CONFIG.PING_TIMEOUT_MS)
            .then(function () {
                return Date.now() - start;
            })
            .catch(function () {
                return null;
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Navigator connection                            */
    /* ══════════════════════════════════════════════ */
    function _readNavigatorConnection() {
        const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!c) return;
        if (c.effectiveType) State.metrics.effectiveType = c.effectiveType;
        if (typeof c.downlink === 'number') State.metrics.downlink = c.downlink;
        if (typeof c.saveData === 'boolean') State.metrics.saveData = c.saveData;
    }

    /* ══════════════════════════════════════════════ */
    /* Success/Failure tracking                        */
    /* ══════════════════════════════════════════════ */
    const _successHistory = [];

    function _recordSuccess() {
        _successHistory.push(1);
        if (_successHistory.length > 10) _successHistory.shift();
        _updateSuccessRate();
    }

    function _recordFailure() {
        _successHistory.push(0);
        if (_successHistory.length > 10) _successHistory.shift();
        _updateSuccessRate();
    }

    function _updateSuccessRate() {
        if (_successHistory.length === 0) {
            State.metrics.successRate = 1.0;
            return;
        }
        const sum = _successHistory.reduce(function (a, b) { return a + b; }, 0);
        State.metrics.successRate = sum / _successHistory.length;
    }

    /* ══════════════════════════════════════════════ */
    /* RTT history                                     */
    /* ══════════════════════════════════════════════ */
    function _pushRtt(rtt) {
        State.metrics.rttHistory.push(rtt);
        if (State.metrics.rttHistory.length > CONFIG.HISTORY_SIZE) {
            State.metrics.rttHistory.shift();
        }
        const recent = State.metrics.rttHistory.slice(-3);
        const avg = recent.reduce(function (a, b) { return a + b; }, 0) / recent.length;
        State.metrics.rtt = Math.round(avg);
    }

    /* ══════════════════════════════════════════════ */
    /* Main measure                                    */
    /* ══════════════════════════════════════════════ */
    function measure() {
        if (!State._initialized) return Promise.resolve(State.current);

        _readNavigatorConnection();
        State.metrics.online = (navigator.onLine !== false);

        return _ping().then(function (rtt) {
            if (rtt !== null) {
                _pushRtt(rtt);
                _recordSuccess();
            } else {
                _recordFailure();
            }

            const oldScore = State.score;
            const oldClass = State.current;

            State.score = _computeScore();
            State.current = _classify(State.score);
            State.metrics.lastMeasure = Date.now();
            State.metrics.measuredCount++;

            _saveToStorage();

            if (oldClass !== State.current) {
                Logger.info('📶 Net quality:', oldClass, '→', State.current,
                            '(score: ' + State.score + ')');
                _emit('net:changed', {
                    from: oldClass,
                    to: State.current,
                    score: State.score
                });
            }

            _emit('net:measured', {
                current: State.current,
                score: State.score,
                metrics: Object.assign({}, State.metrics)
            });

            return State.current;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Bootstrap                                       */
    /* ══════════════════════════════════════════════ */
    function _applyLoadedState(data) {
        State.current = data.current || 'medium';
        State.score = data.score || 55;
        if (data.metrics) {
            State.metrics = Object.assign(State.metrics, data.metrics);
        }
        Logger.info('📶 Net quality (from cache):', State.current, '(score:', State.score + ')');
    }

    function _start() {
        if (State._initialized) return;
        State._initialized = true;

        const cached = _loadFromStorage();
        if (cached) {
            _applyLoadedState(cached);
        }

        setTimeout(function () { measure(); }, 300);

        State.intervalTimer = setInterval(function () {
            measure();
        }, CONFIG.MEASURE_INTERVAL_MS);

        _bindBrowserEvents();
        _bindResilienceEvents();

        Logger.info('📦 [net-quality] started');
    }

    function _bindBrowserEvents() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', function () {
                Logger.info('🌐 Browser: online');
                State.metrics.online = true;
                setTimeout(measure, 500);
            });
            window.addEventListener('offline', function () {
                Logger.info('🌐 Browser: offline');
                State.metrics.online = false;
                const oldClass = State.current;
                State.score = 0;
                State.current = 'very-slow';
                if (oldClass !== State.current) {
                    _emit('net:changed', {
                        from: oldClass,
                        to: State.current,
                        score: 0
                    });
                }
            });
        }

        const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (c && typeof c.addEventListener === 'function') {
            c.addEventListener('change', function () {
                Logger.debug('📶 navigator.connection changed');
                measure();
            });
        }
    }

    function _bindResilienceEvents() {
        if (!window.QamarResilience || typeof window.QamarResilience.on !== 'function') {
            setTimeout(_bindResilienceEvents, 1500);
            return;
        }

        try {
            window.QamarResilience.on('heartbeat', function (d) {
                if (d && typeof d.rtt === 'number') {
                    _pushRtt(d.rtt);
                }
                _recordSuccess();
            });

            window.QamarResilience.on('heartbeat:failed', function () {
                _recordFailure();
            });

            window.QamarResilience.on('reconnected', function () {
                Logger.info('📶 Reconnected — re-measuring');
                setTimeout(measure, 500);
            });

            window.QamarResilience.on('disconnected', function () {
                State.metrics.online = false;
                _recordFailure();
            });

            Logger.debug('📡 Bound to QamarResilience events');
        } catch (e) {
            Logger.warn('Failed to bind resilience events:', e.message);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Public API                                      */
    /* ══════════════════════════════════════════════ */
    const ORDER = { 'very-slow': 0, 'slow': 1, 'medium': 2, 'fast': 3 };

    window.QamarNet = {
        CONFIG: CONFIG,

        get: function () { return State.current; },
        score: function () { return State.score; },
        getMetrics: function () {
            return Object.assign({}, State.metrics, {
                rttHistory: State.metrics.rttHistory.slice()
            });
        },
        measure: measure,

        isFast: function () { return State.current === 'fast'; },
        isVerySlow: function () { return State.current === 'very-slow'; },
        isOnline: function () { return State.metrics.online !== false; },
        isAtLeast: function (level) { return ORDER[State.current] >= ORDER[level]; },
        isAtMost:  function (level) { return ORDER[State.current] <= ORDER[level]; },

        onChange: onChange,

        getStatus: function () {
            return {
                current: State.current,
                score: State.score,
                metrics: window.QamarNet.getMetrics(),
                initialized: State._initialized,
                listeners: State.listeners.length
            };
        }
    };

    /* ══════════════════════════════════════════════ */
    /* Auto-start                                      */
    /* ══════════════════════════════════════════════ */
    function _autoStart() {
        if (window.QamarFB && window.QamarFB.isReady && window.QamarFB.isReady()) {
            _start();
            return;
        }
        if (window.EventBus) {
            window.EventBus.once('boot:ready', function () {
                _start();
            });
            setTimeout(function () {
                if (!State._initialized) _start();
            }, 3000);
        } else {
            setTimeout(_start, 1500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _autoStart);
    } else {
        _autoStart();
    }

    Logger.info('📦 [net-quality.js] loaded');
})();
