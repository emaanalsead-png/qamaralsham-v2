// ==============================================
// core/adaptive.js
// قيم ديناميكية حسب جودة الاتصال
// ==============================================
// يعتمد على: firebase/resilience.js + core/net-quality.js
// يعطي: window.QamarAdaptive
// ==============================================
// ⭐ v1:
//   1. جدول 19 مفتاح × 4 مستويات (fast/medium/slow/very-slow)
//   2. override يدوي لأي مفتاح
//   3. onChange + onFeatureChange
//   4. يستمع لـ QamarNet.onChange
//   5. getProfile كامل
// ==============================================

(function () {
    'use strict';

    if (window.QamarAdaptive) return;

    const LOG_TAG = '[ADP]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); }
    };

    /* ══════════════════════════════════════════════ */
    /* الجدول الكامل — القيم لكل مستوى                  */
    /* ══════════════════════════════════════════════ */
    const PROFILES = {
        'fast': {
            heartbeatMs:         20000,
            presenceRefreshMs:   30000,
            typingEnabled:       true,
            typingTimeoutMs:     4000,
            messageLimit:        50,
            batchWindowMs:       300,
            debounceMs:          800,
            retryMaxRetries:     5,
            cleanersIntervalMs:  6 * 60 * 60 * 1000,
            imageQuality:        0.88,
            imageMaxSize:        1920,
            pmScanEnabled:       true,
            pmScanIntervalMs:    5 * 60 * 1000,
            botPollingEnabled:   true,
            emojiLazyLoad:       true,
            storiesEnabled:      true,
            voiceMonitorEnabled: true,
            lazyLoadKingRoom:    false,
            deferHeavyModules:   0
        },
        'medium': {
            heartbeatMs:         30000,
            presenceRefreshMs:   45000,
            typingEnabled:       true,
            typingTimeoutMs:     5000,
            messageLimit:        30,
            batchWindowMs:       500,
            debounceMs:          1000,
            retryMaxRetries:     4,
            cleanersIntervalMs:  12 * 60 * 60 * 1000,
            imageQuality:        0.80,
            imageMaxSize:        1600,
            pmScanEnabled:       true,
            pmScanIntervalMs:    10 * 60 * 1000,
            botPollingEnabled:   true,
            emojiLazyLoad:       true,
            storiesEnabled:      true,
            voiceMonitorEnabled: true,
            lazyLoadKingRoom:    false,
            deferHeavyModules:   2000
        },
        'slow': {
            heartbeatMs:         60000,
            presenceRefreshMs:   90000,
            typingEnabled:       false,
            typingTimeoutMs:     0,
            messageLimit:        20,
            batchWindowMs:       1000,
            debounceMs:          1500,
            retryMaxRetries:     3,
            cleanersIntervalMs:  24 * 60 * 60 * 1000,
            imageQuality:        0.70,
            imageMaxSize:        1200,
            pmScanEnabled:       true,
            pmScanIntervalMs:    15 * 60 * 1000,
            botPollingEnabled:   true,
            emojiLazyLoad:       true,
            storiesEnabled:      true,
            voiceMonitorEnabled: true,
            lazyLoadKingRoom:    true,
            deferHeavyModules:   5000
        },
        'very-slow': {
            heartbeatMs:         90000,
            presenceRefreshMs:   120000,
            typingEnabled:       false,
            typingTimeoutMs:     0,
            messageLimit:        15,
            batchWindowMs:       1500,
            debounceMs:          2000,
            retryMaxRetries:     2,
            cleanersIntervalMs:  24 * 60 * 60 * 1000,
            imageQuality:        0.60,
            imageMaxSize:        1000,
            pmScanEnabled:       false,
            pmScanIntervalMs:    0,
            botPollingEnabled:   false,
            emojiLazyLoad:       false,
            storiesEnabled:      false,
            voiceMonitorEnabled: false,
            lazyLoadKingRoom:    true,
            deferHeavyModules:   10000
        }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        currentProfile: 'medium',       // افتراضي آمن
        values: Object.assign({}, PROFILES['medium']),  // القيم الفعّالة (مع overrides)
        overrides: {},                  // { key: value }  ← يدوي
        listeners: [],
        featureListeners: {},           // { featureKey: [cb, ...] }
        _initialized: false,
        _lastSnapshot: null
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

    function onFeatureChange(featureKey, cb) {
        if (typeof cb !== 'function') return function () {};
        if (!State.featureListeners[featureKey]) State.featureListeners[featureKey] = [];
        State.featureListeners[featureKey].push(cb);
        return function off() {
            if (!State.featureListeners[featureKey]) return;
            State.featureListeners[featureKey] = State.featureListeners[featureKey].filter(function (h) { return h !== cb; });
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

    function _emitFeature(featureKey, payload) {
        const arr = State.featureListeners[featureKey];
        if (!arr) return;
        arr.slice().forEach(function (cb) {
            try { cb(payload); } catch (e) {}
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Snapshot — للحساسية عند التغيّر                 */
    /* ══════════════════════════════════════════════ */
    function _snapshotValues() {
        const keys = Object.keys(State.values);
        const out = {};
        keys.forEach(function (k) { out[k] = State.values[k]; });
        return out;
    }

    function _findChangedKeys(oldSnap, newSnap) {
        const changed = [];
        const keys = Object.keys(newSnap);
        keys.forEach(function (k) {
            if (oldSnap[k] !== newSnap[k]) changed.push(k);
        });
        return changed;
    }

    /* ══════════════════════════════════════════════ */
    /* Apply profile                                   */
    /* ══════════════════════════════════════════════ */
    function _applyProfile(profileName, silent) {
        const profile = PROFILES[profileName];
        if (!profile) {
            Logger.warn('Unknown profile:', profileName);
            return;
        }

        const oldSnapshot = State._lastSnapshot || _snapshotValues();

        State.currentProfile = profileName;

        // انسخ الجدول ثم طبّق الـ overrides
        State.values = Object.assign({}, profile);
        Object.keys(State.overrides).forEach(function (k) {
            State.values[k] = State.overrides[k];
        });

        const newSnapshot = _snapshotValues();
        const changedKeys = _findChangedKeys(oldSnapshot, newSnapshot);
        State._lastSnapshot = newSnapshot;

        if (!silent) {
            Logger.info('⚙️ Adaptive profile:', profileName,
                '(changed: ' + (changedKeys.length > 0 ? changedKeys.join(', ') : 'none') + ')');
        }

        // أطلق onChange
        _emit('adaptive:changed', {
            profile: profileName,
            changedKeys: changedKeys,
            values: Object.assign({}, State.values)
        });

        // أطلق onFeatureChange لكل مفتاح تغيّر
        changedKeys.forEach(function (key) {
            _emitFeature(key, {
                profile: profileName,
                value: State.values[key]
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Listen to QamarNet                              */
    /* ══════════════════════════════════════════════ */
    function _bindNetQuality() {
        if (!window.QamarNet || typeof window.QamarNet.onChange !== 'function') {
            setTimeout(_bindNetQuality, 1000);
            return;
        }

        try {
            // اقرأ الحالة الحالية
            const current = window.QamarNet.get();
            _applyProfile(current, true);

            // استمع للتغيّرات
            window.QamarNet.onChange(function (payload) {
                const from = payload && payload.from;
                const to = payload && payload.to;
                if (!to) return;
                Logger.info('📶 Net changed:', from, '→', to, '(score:', payload.score + ')');
                _applyProfile(to, false);
            });

            Logger.debug('📡 Bound to QamarNet');
        } catch (e) {
            Logger.warn('Failed to bind QamarNet:', e.message);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Public API                                      */
    /* ══════════════════════════════════════════════ */
    function get(key) {
        if (!(key in State.values)) {
            Logger.warn('Unknown adaptive key:', key);
            return undefined;
        }
        return State.values[key];
    }

    function set(key, value) {
        if (!(key in State.values)) {
            Logger.warn('Unknown adaptive key:', key);
            return false;
        }
        State.overrides[key] = value;
        const oldSnapshot = State._lastSnapshot || _snapshotValues();
        State.values[key] = value;
        State._lastSnapshot = _snapshotValues();
        _emit('adaptive:overridden', { key: key, value: value });
        if (oldSnapshot[key] !== value) {
            _emitFeature(key, {
                profile: State.currentProfile,
                value: value,
                override: true
            });
        }
        Logger.debug('Adaptive override:', key, '=', value);
        return true;
    }

    function reset(key) {
        if (!(key in State.overrides)) return false;
        delete State.overrides[key];
        _applyProfile(State.currentProfile, false);
        Logger.debug('Adaptive override removed:', key);
        return true;
    }

    function resetAll() {
        State.overrides = {};
        _applyProfile(State.currentProfile, false);
        Logger.debug('All adaptive overrides cleared');
        return true;
    }

    function isEnabled(key) {
        return get(key) === true;
    }

    function getProfile() {
        return Object.assign({}, State.values);
    }

    function getProfileName() {
        return State.currentProfile;
    }

    /* ══════════════════════════════════════════════ */
    /* Auto-start                                      */
    /* ══════════════════════════════════════════════ */
    function _start() {
        if (State._initialized) return;
        State._initialized = true;

        State._lastSnapshot = _snapshotValues();
        _bindNetQuality();

        Logger.info('📦 [adaptive] started | profile:', State.currentProfile);
        Logger.debug('Profile values:', State.values);
    }

    function _autoStart() {
        // إن QamarNet موجود → ابدأ
        if (window.QamarNet) {
            _start();
            return;
        }

        // وإلا، انتظره ثم ابدأ
        var attempts = 0;
        var t = setInterval(function () {
            attempts++;
            if (window.QamarNet) {
                clearInterval(t);
                _start();
            }
            if (attempts >= 40) {
                clearInterval(t);
                // fallback: ابدأ بـ medium
                Logger.warn('QamarNet not available — using medium profile');
                _start();
            }
        }, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _autoStart);
    } else {
        _autoStart();
    }

    /* ══════════════════════════════════════════════ */
    /* Status / Debug                                  */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            profile: State.currentProfile,
            overridesCount: Object.keys(State.overrides).length,
            values: Object.assign({}, State.values),
            availableProfiles: Object.keys(PROFILES),
            totalKeys: Object.keys(State.values).length
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarAdaptive = {
        // Constants
        PROFILES: PROFILES,

        // Read
        get: get,
        isEnabled: isEnabled,
        getProfile: getProfile,
        getProfileName: getProfileName,

        // Manual override
        set: set,
        reset: reset,
        resetAll: resetAll,

        // Events
        onChange: onChange,
        onFeatureChange: onFeatureChange,

        // Debug
        getStatus: getStatus
    };

    Logger.info('📦 [adaptive.js] loaded |', Object.keys(PROFILES).length, 'profiles ×',
        Object.keys(PROFILES.medium).length, 'keys');
})();
