// ==============================================
// firebase/resilience.js
// Retry + reconnect + offline recovery
// ==============================================
// يعتمد على: firebase/firebase.js + firebase/optimizers.js
// يعطي: window.QamarResilience
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [resilience] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[RES]';
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
        MAX_RETRIES: 5,
        BASE_DELAY_MS: 1000,
        MAX_DELAY_MS: 30000,
        BACKOFF_FACTOR: 2,
        JITTER_MS: 300,
        HEARTBEAT_MS: 30000,
        CIRCUIT_FAILURE_THRESHOLD: 5,
        CIRCUIT_OPEN_MS: 60000,
        SYNC_INTERVAL_MS: 5 * 60 * 1000
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        connected: false,
        lastConnectedAt: 0,
        lastDisconnectedAt: 0,
        reconnectCount: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        circuitOpen: false,
        circuitOpenUntil: 0,
        consecutiveFailures: 0,
        serverOffset: 0,
        lastHeartbeat: 0,
        heartbeatTimer: null,
        reconnectListener: null,
        eventListeners: {}
    };

    /* ══════════════════════════════════════════════ */
    /* Event Emitter (داخلي)                          */
    /* ══════════════════════════════════════════════ */
    const Events = {
        on: function (name, handler) {
            if (!State.eventListeners[name]) State.eventListeners[name] = [];
            State.eventListeners[name].push(handler);
            return function off() { Events.off(name, handler); };
        },
        off: function (name, handler) {
            if (!State.eventListeners[name]) return;
            if (!handler) { delete State.eventListeners[name]; return; }
            State.eventListeners[name] = State.eventListeners[name].filter(function (h) { return h !== handler; });
        },
        emit: function (name) {
            const args = Array.prototype.slice.call(arguments, 1);
            const arr = State.eventListeners[name];
            if (!arr) return;
            arr.slice().forEach(function (h) {
                try { h.apply(null, args); }
                catch (e) { Logger.warn('Event handler error for', name, e); }
            });
        }
    };

    /* ══════════════════════════════════════════════ */
    /* Retry with Exponential Backoff                  */
    /* ══════════════════════════════════════════════ */
    function _delay(attempt) {
        const base = Math.min(
            CONFIG.BASE_DELAY_MS * Math.pow(CONFIG.BACKOFF_FACTOR, attempt),
            CONFIG.MAX_DELAY_MS
        );
        const jitter = Math.random() * CONFIG.JITTER_MS;
        return base + jitter;
    }

    function _sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // الدالة الرئيسية: retry مع backoff
    // operationFn يجب أن ترجع Promise
    function retry(operationFn, options) {
        options = options || {};
        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : CONFIG.MAX_RETRIES;
        const label = options.label || 'operation';
        const shouldRetry = options.shouldRetry || _defaultShouldRetry;
        const onRetry = options.onRetry || null;

        let attempt = 0;

        function execute() {
            return Promise.resolve()
                .then(function () { return operationFn(attempt); })
                .then(function (result) {
                    State.totalSuccesses++;
                    State.consecutiveFailures = 0;
                    return result;
                })
                .catch(function (err) {
                    State.totalFailures++;
                    State.consecutiveFailures++;

                    // إذا PERMISSION_DENIED → لا فائدة من الإعادة
                    if (err && err.code === 'PERMISSION_DENIED') {
                        Logger.warn(label + ': PERMISSION_DENIED — no retry');
                        throw err;
                    }

                    // تحقق من شرط الإعادة
                    if (attempt >= maxRetries) {
                        Logger.error(label + ': max retries exceeded');
                        throw err;
                    }

                    if (!shouldRetry(err, attempt)) {
                        Logger.warn(label + ': shouldRetry=false');
                        throw err;
                    }

                    // Circuit breaker
                    if (_shouldOpenCircuit()) {
                        Logger.warn(label + ': circuit is OPEN');
                        throw err;
                    }

                    attempt++;
                    const delay = _delay(attempt);
                    Logger.debug(label + ': retry #' + attempt + ' in ' + Math.round(delay) + 'ms');

                    if (onRetry) {
                        try { onRetry(attempt, err, delay); } catch (e) {}
                    }

                    Events.emit('retry', { label: label, attempt: attempt, delay: delay, error: err });

                    return _sleep(delay).then(execute);
                });
        }

        return execute();
    }

    function _defaultShouldRetry(err, attempt) {
        if (!err) return true;
        const code = err.code || '';
        // لا تعيد للإخفاقات الدائمة
        if (code === 'PERMISSION_DENIED') return false;
        if (code === 'INVALID_ARGUMENT') return false;
        if (code === 'INVALID_TOKEN') return false;
        // أعد للإخفاقات المؤقتة
        return true;
    }

    /* ══════════════════════════════════════════════ */
    /* Circuit Breaker                                 */
    /* ══════════════════════════════════════════════ */
    function _shouldOpenCircuit() {
        if (State.circuitOpen) {
            // هل انتهت المدة؟
            if (Date.now() >= State.circuitOpenUntil) {
                State.circuitOpen = false;
                State.consecutiveFailures = 0;
                Logger.info('Circuit closed — resuming operations');
                Events.emit('circuit:closed');
                return false;
            }
            return true;
        }
        if (State.consecutiveFailures >= CONFIG.CIRCUIT_FAILURE_THRESHOLD) {
            State.circuitOpen = true;
            State.circuitOpenUntil = Date.now() + CONFIG.CIRCUIT_OPEN_MS;
            Logger.warn('Circuit OPEN for ' + CONFIG.CIRCUIT_OPEN_MS + 'ms');
            Events.emit('circuit:open', State.circuitOpenUntil);
            return true;
        }
        return false;
    }

    function circuitStatus() {
        return {
            open: State.circuitOpen,
            openUntil: State.circuitOpenUntil,
            consecutiveFailures: State.consecutiveFailures,
            remainingMs: State.circuitOpen ? Math.max(0, State.circuitOpenUntil - Date.now()) : 0
        };
    }

    function resetCircuit() {
        State.circuitOpen = false;
        State.circuitOpenUntil = 0;
        State.consecutiveFailures = 0;
        Logger.info('Circuit reset manually');
    }

    /* ══════════════════════════════════════════════ */
    /* Wrapped Operations                              */
    /* ══════════════════════════════════════════════ */

    function safeGet(path, options) {
        options = options || {};
        return retry(function () {
            return window.QamarFB.get(path);
        }, { label: 'get ' + path, maxRetries: options.maxRetries });
    }

    function safeSet(path, value, options) {
        options = options || {};
        return retry(function () {
            return window.QamarFB.set(path, value);
        }, { label: 'set ' + path, maxRetries: options.maxRetries })
        .catch(function (err) {
            // إذا فشل نهائياً → احفظه في offline queue
            if (options.queueOnFail !== false && err && err.code !== 'PERMISSION_DENIED') {
                if (window.QamarOpt && window.QamarOpt.enqueue) {
                    window.QamarOpt.enqueue({ type: 'set', path: path, value: value });
                }
            }
            throw err;
        });
    }

    function safeUpdate(path, updates, options) {
        options = options || {};
        return retry(function () {
            return window.QamarFB.update(path, updates);
        }, { label: 'update ' + path, maxRetries: options.maxRetries })
        .catch(function (err) {
            if (options.queueOnFail !== false && err && err.code !== 'PERMISSION_DENIED') {
                if (window.QamarOpt && window.QamarOpt.enqueue) {
                    window.QamarOpt.enqueue({ type: 'update', path: path, value: updates });
                }
            }
            throw err;
        });
    }

    function safePush(path, value, options) {
        options = options || {};
        return retry(function () {
            return window.QamarFB.push(path, value);
        }, { label: 'push ' + path, maxRetries: options.maxRetries })
        .catch(function (err) {
            if (options.queueOnFail !== false && err && err.code !== 'PERMISSION_DENIED') {
                if (window.QamarOpt && window.QamarOpt.enqueue) {
                    window.QamarOpt.enqueue({ type: 'push', path: path, value: value });
                }
            }
            throw err;
        });
    }

    function safeRemove(path, options) {
        options = options || {};
        return retry(function () {
            return window.QamarFB.remove(path);
        }, { label: 'remove ' + path, maxRetries: options.maxRetries });
    }

    /* ══════════════════════════════════════════════ */
    /* Connection Monitor                              */
    /* ══════════════════════════════════════════════ */
    function _startConnectionMonitor() {
        if (State.reconnectListener) return;

        // مراقبة Firebase connection
        State.reconnectListener = window.QamarFB.onConnectionChange(function (connected) {
            const wasConnected = State.connected;
            State.connected = connected;

            if (connected && !wasConnected) {
                // عاد الاتصال
                State.lastConnectedAt = Date.now();
                if (State.lastDisconnectedAt > 0) {
                    State.reconnectCount++;
                }
                Logger.info('✅ Reconnected (count: ' + State.reconnectCount + ')');
                Events.emit('reconnected', { count: State.reconnectCount });
                _onReconnect();

            } else if (!connected && wasConnected) {
                // فقد الاتصال
                State.lastDisconnectedAt = Date.now();
                Logger.warn('⚠️ Disconnected');
                Events.emit('disconnected');
            }
        });

        // مراقبة navigator online/offline
        if (typeof window !== 'undefined') {
            window.addEventListener('online', function () {
                Logger.info('🌐 Browser online');
                Events.emit('browser:online');
                setTimeout(_onReconnect, 1000);
            });
            window.addEventListener('offline', function () {
                Logger.warn('🌐 Browser offline');
                Events.emit('browser:offline');
            });
        }
    }

    function _onReconnect() {
        Logger.info('🔄 Reconnect handling...');
        _startHeartbeat();
        _syncServerTime();
        _flushQueue();
    }

    /* ══════════════════════════════════════════════ */
    /* Heartbeat                                       */
    /* ══════════════════════════════════════════════ */
    function _startHeartbeat() {
        if (State.heartbeatTimer) clearInterval(State.heartbeatTimer);
        State.heartbeatTimer = setInterval(function () {
            _heartbeat();
        }, CONFIG.HEARTBEAT_MS);
    }

    function _stopHeartbeat() {
        if (State.heartbeatTimer) {
            clearInterval(State.heartbeatTimer);
            State.heartbeatTimer = null;
        }
    }

    function _heartbeat() {
        if (!window.QamarFB.isReady()) return;
        State.lastHeartbeat = Date.now();

        // قراءة خفيفة من Firebase
        const start = Date.now();
        window.QamarFB.get('.info/connected', 5000)
            .then(function (v) {
                const rtt = Date.now() - start;
                Events.emit('heartbeat', { rtt: rtt });
                Logger.debug('💓 Heartbeat RTT: ' + rtt + 'ms');
            })
            .catch(function () {
                Events.emit('heartbeat:failed');
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Server Time Sync                                */
    /* ══════════════════════════════════════════════ */
    function _syncServerTime() {
        return window.QamarFB.serverOffset()
            .then(function (offset) {
                State.serverOffset = offset;
                Logger.debug('⏰ Server offset: ' + offset + 'ms');
                Events.emit('time:synced', offset);
                return offset;
            })
            .catch(function () { return 0; });
    }

    // الوقت المصحح (يساوي سيرفر + فرق)
    function now() {
        return Date.now() + State.serverOffset;
    }

    /* ══════════════════════════════════════════════ */
    /* Offline Queue flush                             */
    /* ══════════════════════════════════════════════ */
    function _flushQueue() {
        if (!window.QamarOpt || !window.QamarOpt.flushOfflineQueue) return Promise.resolve(0);
        return window.QamarOpt.flushOfflineQueue()
            .then(function (n) {
                if (n > 0) {
                    Logger.info('📤 Flushed ' + n + ' offline ops');
                    Events.emit('queue:flushed', n);
                }
                return n;
            })
            .catch(function () { return 0; });
    }

    /* ══════════════════════════════════════════════ */
    /* Public API                                      */
    /* ══════════════════════════════════════════════ */
    function isConnected() { return State.connected; }
    function getServerOffset() { return State.serverOffset; }

    function start() {
        if (State._started) return;
        State._started = true;

        Logger.info('🚀 Starting resilience system...');

        // ابدأ المراقبة
        _startConnectionMonitor();
        _startHeartbeat();

        // مزامنة الوقت (مع تأخير بسيط)
        setTimeout(_syncServerTime, 1500);

        // مزامنة دورية
        setInterval(_syncServerTime, CONFIG.SYNC_INTERVAL_MS);

        // مراقبة الاتصال المبدئي
        const checkConn = setInterval(function () {
            if (window.QamarFB.isReady()) {
                clearInterval(checkConn);
                window.QamarFB.get('.info/connected').then(function (v) {
                    if (v === true) {
                        State.connected = true;
                        State.lastConnectedAt = Date.now();
                        Logger.info('✅ Initially connected');
                        Events.emit('connected');
                    }
                }).catch(function(){});
            }
        }, 500);

        Logger.info('📦 [resilience.js] started');
    }

    function stop() {
        _stopHeartbeat();
        if (State.reconnectListener && State.reconnectListener.off) {
            State.reconnectListener.off();
        }
        State._started = false;
        Logger.info('Stopped');
    }

    function getStats() {
        return {
            connected: State.connected,
            reconnectCount: State.reconnectCount,
            totalSuccesses: State.totalSuccesses,
            totalFailures: State.totalFailures,
            consecutiveFailures: State.consecutiveFailures,
            circuitOpen: State.circuitOpen,
            circuitRemainingMs: State.circuitOpen ? Math.max(0, State.circuitOpenUntil - Date.now()) : 0,
            serverOffset: State.serverOffset,
            lastHeartbeat: State.lastHeartbeat,
            lastConnectedAt: State.lastConnectedAt,
            lastDisconnectedAt: State.lastDisconnectedAt
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Manual test — للاستخدام في debug فقط            */
    /* ══════════════════════════════════════════════ */
    function _testRetry() {
        let tries = 0;
        return retry(function () {
            tries++;
            if (tries < 3) return Promise.reject(new Error('Simulated failure ' + tries));
            return Promise.resolve('success on try ' + tries);
        }, { label: 'test', maxRetries: 5 }).then(function (r) {
            Logger.info('Test retry passed:', r);
            return r;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarResilience = {
        // Lifecycle
        start: start,
        stop: stop,

        // Core
        retry: retry,
        safeGet: safeGet,
        safeSet: safeSet,
        safeUpdate: safeUpdate,
        safePush: safePush,
        safeRemove: safeRemove,

        // State
        isConnected: isConnected,
        getServerOffset: getServerOffset,
        now: now,
        getStats: getStats,

        // Circuit
        circuitStatus: circuitStatus,
        resetCircuit: resetCircuit,

        // Events
        on: Events.on,
        off: Events.off,

        // Debug
        _testRetry: _testRetry,

        // Config
        CONFIG: CONFIG
    };

    window.QamarResilience = QamarResilience;

    // ابدأ تلقائياً
    start();

    Logger.info('📦 [resilience.js] loaded');
})();
