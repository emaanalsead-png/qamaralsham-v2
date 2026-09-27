// ==============================================
// security/suspects.js
// King's suspects list + auto-record hooks
// ==============================================
// يعتمد على: firebase.js + auth.js + ranks.js + audit.js
// يعطي: window.QamarSuspects
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [suspects] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[SUS]';
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
        ROOT: 'king_suspects',
        ALERTS_ROOT: 'king_alerts',
        CACHE_TTL_MS: 60 * 1000
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        // نسخة محلية كاملة لقائمة المشبوهين (uid → data)
        cache: {},
        cachedAt: 0,
        listeners: [],
        // قائمة UIDs (سريعة للفحص)
        uidSet: {}
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onSuspectsEvent(cb) {
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
            try { cb({ type: name, data: payload }); } catch (e) {}
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _getCurrentUid() {
        if (window.QamarAuth && window.QamarAuth.getUid) return window.QamarAuth.getUid();
        return window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;
    }

    function _getCurrentName() {
        try {
            if (window.AppState && window.AppState.user && window.AppState.user.name) {
                return window.AppState.user.name;
            }
            if (window.QamarSession && window.QamarSession.getData) {
                const s = window.QamarSession.getData();
                if (s && s.name) return s.name;
            }
        } catch (e) {}
        return '—';
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    /* ══════════════════════════════════════════════ */
    /* Cache                                           */
    /* ══════════════════════════════════════════════ */
    function _rebuildSet(data) {
        State.uidSet = {};
        if (data) {
            Object.keys(data).forEach(function (uid) {
                State.uidSet[uid] = true;
            });
        }
    }

    function _isCacheFresh() {
        return (Date.now() - State.cachedAt) < CONFIG.CACHE_TTL_MS;
    }

    function _invalidate() {
        State.cache = {};
        State.uidSet = {};
        State.cachedAt = 0;
    }

    /* ══════════════════════════════════════════════ */
    /* Load suspects (only King)                       */
    /* ══════════════════════════════════════════════ */
    function _loadIfNeeded(force) {
        if (!_isKing()) {
            return Promise.resolve({});
        }
        if (!force && _isCacheFresh() && State.cachedAt > 0) {
            return Promise.resolve(State.cache);
        }
        return window.QamarFB.children(CONFIG.ROOT)
            .then(function (data) {
                State.cache = data || {};
                _rebuildSet(State.cache);
                State.cachedAt = Date.now();
                return State.cache;
            })
            .catch(function (e) {
                Logger.warn('load failed:', e.message);
                State.cache = {};
                _rebuildSet({});
                State.cachedAt = Date.now();
                return {};
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Read                                            */
    /* ══════════════════════════════════════════════ */
    function listAll(force) {
        if (!_isKing()) {
            return Promise.resolve([]);
        }
        return _loadIfNeeded(force).then(function (data) {
            return Object.keys(data).map(function (uid) {
                return Object.assign({ uid: uid }, data[uid]);
            }).sort(function (a, b) {
                return (b.addedAt || 0) - (a.addedAt || 0);
            });
        });
    }

    function getSuspect(uid, force) {
        if (!_isKing() || !uid) return Promise.resolve(null);
        return _loadIfNeeded(force).then(function (data) {
            if (!data[uid]) return null;
            return Object.assign({ uid: uid }, data[uid]);
        });
    }

    // boolean check (from cache if available)
    function isSuspect(uid) {
        if (!uid) return false;
        // إذا عندنا كاش طازج
        if (_isCacheFresh() && State.cachedAt > 0) {
            return !!State.uidSet[uid];
        }
        // fallback: قراءة مباشرة (الملك فقط يستطيع)
        if (!_isKing()) return false;
        return window.QamarFB.exists(CONFIG.ROOT + '/' + uid)
            .catch(function () { return false; });
    }

    // اسم متزامن (لا يعتمد على Firebase)
    function isSuspectSync(uid) {
        if (!uid) return false;
        return !!State.uidSet[uid];
    }

    function count() {
        if (!_isKing()) return Promise.resolve(0);
        return _loadIfNeeded().then(function (data) {
            return Object.keys(data).length;
        });
    }

    function listUids() {
        if (!_isKing()) return Promise.resolve([]);
        return _loadIfNeeded().then(function () {
            return Object.keys(State.uidSet);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Add suspect (King only)                         */
    /* ══════════════════════════════════════════════ */
    function addSuspect(uid, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            if (!_isKing()) {
                throw new Error('فقط الملك يمكنه إدارة المشبوهين');
            }
            if (!uid) throw new Error('uid مطلوب');

            const currentUid = _getCurrentUid();
            if (uid === currentUid) throw new Error('لا يمكنك إضافة نفسك');

            // اقرأ بيانات المستخدم الهدف
            return window.QamarFB.get('users/' + uid).then(function (u) {
                if (!u) throw new Error('المستخدم غير موجود');

                const payload = {
                    name: u.name || options.name || '—',
                    avatar: u.avatar || null,
                    code: u.code || null,
                    addedAt: window.QamarFB.serverTime(),
                    addedBy: currentUid,
                    addedByName: _getCurrentName()
                };

                return window.QamarFB.set(CONFIG.ROOT + '/' + uid, payload)
                    .then(function () {
                        // حدّث الكاش المحلي
                        State.cache[uid] = payload;
                        State.uidSet[uid] = true;

                        // سجّل في audit
                        if (window.QamarAudit) {
                            window.QamarAudit.log('addSuspect', {
                                targetUid: uid,
                                targetName: payload.name
                            });
                        }

                        _emit('suspect:added', { uid: uid, data: payload });
                        Logger.info('👁️ Suspect added:', uid.substring(0, 8));
                        return { ok: true, uid: uid, data: payload };
                    });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Remove suspect (King only)                      */
    /* ══════════════════════════════════════════════ */
    function removeSuspect(uid) {
        return Promise.resolve().then(function () {
            if (!_isKing()) {
                throw new Error('فقط الملك يمكنه إدارة المشبوهين');
            }
            if (!uid) throw new Error('uid مطلوب');

            return window.QamarFB.get(CONFIG.ROOT + '/' + uid).then(function (existing) {
                if (!existing) throw new Error('هذا المستخدم ليس في القائمة');

                return window.QamarFB.remove(CONFIG.ROOT + '/' + uid).then(function () {
                    delete State.cache[uid];
                    delete State.uidSet[uid];

                    if (window.QamarAudit) {
                        window.QamarAudit.log('removeSuspect', {
                            targetUid: uid,
                            targetName: existing.name || '—'
                        });
                    }

                    _emit('suspect:removed', { uid: uid });
                    Logger.info('✅ Suspect removed:', uid.substring(0, 8));
                    return { ok: true, uid: uid };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Toggle                                          */
    /* ══════════════════════════════════════════════ */
    function toggleSuspect(uid) {
        return isSuspect(uid).then(function (is) {
            if (is) return removeSuspect(uid);
            return addSuspect(uid);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Clear all (King only)                           */
    /* ══════════════════════════════════════════════ */
    function clearAll() {
        return Promise.resolve().then(function () {
            if (!_isKing()) {
                throw new Error('فقط الملك');
            }
            return window.QamarFB.remove(CONFIG.ROOT).then(function () {
                _invalidate();
                if (window.QamarAudit) {
                    window.QamarAudit.log('removeSuspect', {
                        details: { clearedAll: true }
                    });
                }
                _emit('suspect:cleared', {});
                Logger.info('🧹 All suspects cleared');
                return { ok: true };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Alerts — log king_alerts                        */
    /* ══════════════════════════════════════════════ */
    function logAlert(payload) {
        if (!payload) return Promise.resolve(null);
        if (window.QamarRanks && !window.QamarRanks.isKing()) {
            // فقط الملك أو voice-monitor المتصفح
            // لكن القاعدة تسمح بـ auth != null → نسمح
        }

        const entry = Object.assign({
            createdAt: window.QamarFB.serverTime()
        }, payload);

        return window.QamarFB.push(CONFIG.ALERTS_ROOT, entry)
            .then(function (key) {
                _emit('alert:logged', { id: key, data: entry });
                return key;
            })
            .catch(function (e) {
                Logger.warn('logAlert failed:', e.message);
                return null;
            });
    }

    function listAlerts(limit) {
        if (!_isKing()) return Promise.resolve([]);
        limit = limit || 50;
        return window.QamarFB.query(CONFIG.ALERTS_ROOT, {
            orderByChild: 'createdAt',
            limitToLast: limit,
            returnArray: true
        }).then(function (arr) {
            return (arr || []).map(function (r) {
                return Object.assign({ _id: r.id }, r.data);
            }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        }).catch(function () { return []; });
    }

    /* ══════════════════════════════════════════════ */
    /* Hook — يُستدعى من voice-monitor عند انضمام مايك  */
    /* ══════════════════════════════════════════════ */
    function onVoiceJoin(uid, context) {
        // hook للتسجيل التلقائي (voice-monitor.js يستدعيه)
        if (!uid) return Promise.resolve({ trigger: false });
        return isSuspect(uid).then(function (yes) {
            if (yes) {
                Logger.info('👁️ Suspect joined voice:', uid.substring(0, 8));
                _emit('suspect:voiceJoined', { uid: uid, context: context || {} });
                return { trigger: true, uid: uid, context: context || {} };
            }
            return { trigger: false };
        });
    }

    // متزامن — voice-monitor يستخدمه للسرعة
    function shouldRecord(uid) {
        return isSuspectSync(uid);
    }

    /* ══════════════════════════════════════════════ */
    /* Real-time listener (King only)                  */
    /* ══════════════════════════════════════════════ */
    function watch() {
        if (!_isKing()) return null;
        try {
            const handle = window.QamarFB.onValue(CONFIG.ROOT, function (data) {
                State.cache = data || {};
                _rebuildSet(State.cache);
                State.cachedAt = Date.now();
                _emit('suspect:changed', { count: Object.keys(State.cache).length });
            });
            Logger.info('👁️ Watching suspects (King)');
            return handle;
        } catch (e) {
            Logger.warn('watch failed:', e.message);
            return null;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            isKing: _isKing(),
            cachedCount: Object.keys(State.cache).length,
            cacheFresh: _isCacheFresh(),
            cachedAt: State.cachedAt
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Init — watch when King logs in                  */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (payload) {
                if (payload.isLoggedIn && _isKing()) {
                    setTimeout(function () {
                        _loadIfNeeded(true).then(function () {
                            watch();
                        });
                    }, 1500);
                } else if (!payload.isLoggedIn) {
                    _invalidate();
                }
            });
        }
        Logger.info('📦 [suspects.js] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 1200);
        });
    } else {
        setTimeout(_init, 5000);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarSuspects = {
        // Config
        CONFIG: CONFIG,

        // Read
        listAll: listAll,
        getSuspect: getSuspect,
        isSuspect: isSuspect,
        isSuspectSync: isSuspectSync,
        count: count,
        listUids: listUids,

        // Write
        addSuspect: addSuspect,
        removeSuspect: removeSuspect,
        toggleSuspect: toggleSuspect,
        clearAll: clearAll,

        // Alerts
        logAlert: logAlert,
        listAlerts: listAlerts,

        // Hooks (voice-monitor)
        onVoiceJoin: onVoiceJoin,
        shouldRecord: shouldRecord,

        // Live
        watch: watch,
        invalidate: _invalidate,

        // Events
        onSuspectsEvent: onSuspectsEvent,

        // Debug
        getStatus: getStatus
    };

    window.QamarSuspects = QamarSuspects;

    Logger.info('📦 [suspects.js] loaded');
})();
