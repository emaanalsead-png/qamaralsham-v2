// ==============================================
// auth/session.js v2.1 — force refresh from Firebase
// ==============================================
// يعتمد على: firebase.js + utils.js + auth.js
// يعطي: window.QamarSession
// ==============================================
// ⭐ v2.1: يجبر قراءة rank/rankLevel من Firebase عند الدخول
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [session] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[SES]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); }
    };

    const CONFIG = {
        STORAGE_KEY: 'qamar_session_v2',
        TTL_MS: 24 * 60 * 60 * 1000,
        CHECK_INTERVAL_MS: 60 * 1000,
        TOUCH_INTERVAL_MS: 2 * 60 * 1000,
        SYNC_DELAY_MS: 1500,
        VERSION: 1
    };

    const PERSONAL_FIELDS = [
        'uid', 'name', 'code', 'avatar',
        'rank', 'rankLevel', 'isGuest', 'isEmailUser',
        'email', 'country', 'family', 'gender', 'age'
    ];

    const State = {
        data: null,
        lastSaved: 0,
        lastTouched: 0,
        lastCheck: 0,
        checkTimer: null,
        touchTimer: null,
        syncTimer: null,
        listeners: [],
        _started: false
    };

    function onSessionChange(cb) {
        if (typeof cb !== 'function') return function () {};
        State.listeners.push(cb);
        return function off() {
            State.listeners = State.listeners.filter(function (h) { return h !== cb; });
        };
    }

    function _emit(eventName, payload) {
        if (window.EventBus) {
            try { window.EventBus.emit(eventName, payload); } catch (e) {}
        }
        if (eventName === 'session:changed') {
            State.listeners.slice().forEach(function (cb) {
                try { cb(payload); } catch (e) { Logger.warn('listener error:', e); }
            });
        }
    }

    function _buildSession(user) {
        if (!user) return null;
        const now = Date.now();
        const isGuest = !!user.isAnonymous;
        const isEmailUser = !isGuest && !!user.email;
        const appUser = (window.AppState && window.AppState.user) ? window.AppState.user : {};
        const prev = State.data || {};

        const session = {
            _v: CONFIG.VERSION,
            signedInAt: prev.signedInAt || now,
            lastActiveAt: now,
            expiresAt: now + CONFIG.TTL_MS
        };

        PERSONAL_FIELDS.forEach(function (f) {
            if (f === 'uid') {
                session.uid = user.uid;
            } else if (f === 'isGuest') {
                session.isGuest = isGuest;
            } else if (f === 'isEmailUser') {
                session.isEmailUser = isEmailUser;
            } else if (f === 'email') {
                session.email = user.email || prev.email || null;
            } else if (f === 'name') {
                session.name = user.displayName || appUser.name || prev.name || null;
            } else {
                // ⭐ v2.1: احتفظ بالقيمة القديمة إذا الجديدة فارغة
                var nv = appUser[f];
                var ov = prev[f];
                if (nv !== undefined && nv !== null) session[f] = nv;
                else if (ov !== undefined && ov !== null) session[f] = ov;
                else session[f] = null;
            }
        });

        return session;
    }

    function saveSession(userOrSession) {
        try {
            let session;
            if (userOrSession && userOrSession.uid && !userOrSession._v) {
                session = _buildSession(userOrSession);
            } else if (userOrSession && userOrSession._v) {
                session = userOrSession;
            } else if (userOrSession === undefined) {
                const u = (window.QamarAuth && window.QamarAuth.getCurrentUser)
                    ? window.QamarAuth.getCurrentUser()
                    : (window.auth ? window.auth.currentUser : null);
                if (!u) return false;
                session = _buildSession(u);
            } else {
                return false;
            }

            if (!session || !session.uid) return false;

            State.data = session;
            State.lastSaved = Date.now();

            if (window.safeSetJSON) {
                window.safeSetJSON(CONFIG.STORAGE_KEY, session);
            } else {
                localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(session));
            }

            Logger.info('💾 Session saved: uid=' + session.uid.substring(0, 8) + '... rank=' + session.rank);
            _emit('session:saved', session);
            _emit('session:changed', { action: 'saved', session: session });
            return true;
        } catch (e) {
            Logger.error('saveSession error:', e);
            return false;
        }
    }

    function loadSession() {
        try {
            let data;
            if (window.safeGetJSON) {
                data = window.safeGetJSON(CONFIG.STORAGE_KEY, null);
            } else {
                const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
                data = raw ? JSON.parse(raw) : null;
            }

            if (!data || !data.uid) return null;

            if (data._v !== CONFIG.VERSION) {
                Logger.warn('Session version mismatch — clearing');
                clearSession();
                return null;
            }

            if (isSessionExpired(data)) {
                Logger.warn('Session expired — clearing');
                clearSession();
                _emit('session:expired', data);
                return null;
            }

            State.data = data;
            Logger.info('📂 Session loaded: uid=' + data.uid.substring(0, 8) + '... rank=' + data.rank);
            return data;
        } catch (e) {
            Logger.error('loadSession error:', e);
            return null;
        }
    }

    function isSessionExpired(sessionData) {
        const s = sessionData || State.data;
        if (!s || !s.expiresAt) return true;
        return Date.now() >= s.expiresAt;
    }

    function isSessionValid() {
        if (!State.data) return false;
        return !isSessionExpired(State.data);
    }

    function getSessionAge() {
        if (!State.data || !State.data.signedInAt) return 0;
        return Date.now() - State.data.signedInAt;
    }

    function getRemainingMs() {
        if (!State.data || !State.data.expiresAt) return 0;
        return Math.max(0, State.data.expiresAt - Date.now());
    }

    function restoreSession() {
        const s = loadSession();
        if (!s) return Promise.resolve({ restored: false, reason: 'no-session' });

        const currentUid = window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;

        if (!currentUid) {
            return (window.QamarAuth && window.QamarAuth.waitForAuth
                ? window.QamarAuth.waitForAuth(5000)
                : Promise.resolve()
            ).then(function () { return _verifyWithFirebase(s); });
        }

        return _verifyWithFirebase(s);
    }

    function _verifyWithFirebase(sessionData) {
        const currentUid = window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;

        if (!currentUid) {
            return { restored: false, reason: 'no-auth', session: sessionData };
        }

        if (currentUid !== sessionData.uid) {
            const u = window.auth.currentUser;
            saveSession(u);
            // ⭐ v2.1: بعد الحفظ، جدّد من Firebase
            setTimeout(syncWithFirebase, CONFIG.SYNC_DELAY_MS);
            return { restored: false, reason: 'uid-mismatch', freshSaved: true };
        }

        Logger.info('✅ Session restored');
        _emit('session:restored', sessionData);
        _emit('session:changed', { action: 'restored', session: sessionData });
        return { restored: true, session: sessionData };
    }

    function clearSession() {
        try {
            State.data = null;
            State.lastSaved = 0;
            State.lastTouched = 0;
            if (window.localStorage) localStorage.removeItem(CONFIG.STORAGE_KEY);
            Logger.info('🗑️ Session cleared');
            _emit('session:cleared');
            _emit('session:changed', { action: 'cleared' });
            return true;
        } catch (e) { return false; }
    }

    function updateSession(updates) {
        if (!updates || typeof updates !== 'object') return false;
        if (!State.data) {
            const u = window.auth ? window.auth.currentUser : null;
            if (u) saveSession(u);
            if (!State.data) return false;
        }

        PERSONAL_FIELDS.forEach(function (f) {
            if (updates[f] !== undefined && updates[f] !== null) {
                State.data[f] = updates[f];
            }
        });

        State.data.lastActiveAt = Date.now();
        State.lastSaved = Date.now();

        try {
            if (window.safeSetJSON) window.safeSetJSON(CONFIG.STORAGE_KEY, State.data);
            else localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(State.data));
        } catch (e) {}

        _emit('session:changed', { action: 'updated', session: State.data });
        return true;
    }

    function touchSession() {
        if (!State.data) return false;
        const now = Date.now();
        if (now - State.lastTouched < CONFIG.TOUCH_INTERVAL_MS) return false;
        State.lastTouched = now;
        State.data.lastActiveAt = now;
        try {
            if (window.safeSetJSON) window.safeSetJSON(CONFIG.STORAGE_KEY, State.data);
            else localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(State.data));
        } catch (e) {}
        return true;
    }

    // ⭐ v2.1: المهم — syncWithFirebase مع كشف التغيير
    function syncWithFirebase() {
        const u = window.auth ? window.auth.currentUser : null;
        if (!u) return Promise.resolve({ synced: false, reason: 'no-user' });

        return window.QamarFB.get('users/' + u.uid).then(function (data) {
            if (!data) return { synced: false, reason: 'no-db-user' };

            const updates = {
                name: data.name || null,
                code: data.code || null,
                avatar: data.avatar || null,
                rank: data.rank || 'User',
                rankLevel: data.rankLevel || 50,
                country: data.country || null,
                family: data.family || null,
                gender: data.gender || null,
                age: data.age || null
            };

            // افحص التغيير
            const oldRank = State.data ? State.data.rank : null;
            const newRank = updates.rank;

            updateSession(updates);
            Logger.info('✅ Session synced: rank=' + newRank + ' (was ' + oldRank + ')');

            // ⭐ إذا تغيرت الرتبة → أخبر الجميع
            if (oldRank !== newRank) {
                Logger.info('🔄 RANK CHANGED: ' + oldRank + ' → ' + newRank);
                _emit('session:rankChanged', { old: oldRank, new: newRank, rankLevel: updates.rankLevel });
                if (window.EventBus) {
                    try { window.EventBus.emit('rank:changed', { uid: u.uid, rank: newRank, level: updates.rankLevel }); } catch (e) {}
                }
            }

            return { synced: true, updates: updates, rankChanged: oldRank !== newRank };
        }).catch(function (e) {
            Logger.warn('syncWithFirebase error:', e.message);
            return { synced: false, reason: e.message };
        });
    }

    function _startChecker() {
        if (State.checkTimer) return;
        State.checkTimer = setInterval(function () {
            State.lastCheck = Date.now();
            if (!State.data) return;
            if (isSessionExpired(State.data)) {
                Logger.warn('⏰ Session expired');
                _handleExpired();
            }
        }, CONFIG.CHECK_INTERVAL_MS);
    }

    function _stopChecker() {
        if (State.checkTimer) {
            clearInterval(State.checkTimer);
            State.checkTimer = null;
        }
    }

    function _handleExpired() {
        _emit('session:expired', State.data);
        clearSession();
        if (window.QamarAuth && window.QamarAuth.signOut) {
            window.QamarAuth.signOut().catch(function () {});
        } else if (window.auth) {
            window.auth.signOut().catch(function () {});
        }
    }

    function _startActivityTracker() {
        if (State.touchTimer) return;
        State.touchTimer = setInterval(function () {
            if (State.data) touchSession();
        }, CONFIG.TOUCH_INTERVAL_MS);

        if (typeof document !== 'undefined') {
            ['click', 'keydown', 'touchstart'].forEach(function (ev) {
                document.addEventListener(ev, function () {
                    if (State.data) touchSession();
                }, { passive: true });
            });
        }
    }

    // ⭐ v2.1: أهم تعديل — Force refresh عند الدخول
    function start() {
        if (State._started) return;
        State._started = true;

        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (payload) {
                if (payload.isLoggedIn) {
                    saveSession(payload.user);
                    // ⭐ اجبر قراءة Firebase بعد لحظة
                    if (State.syncTimer) clearTimeout(State.syncTimer);
                    State.syncTimer = setTimeout(function () {
                        syncWithFirebase();
                    }, CONFIG.SYNC_DELAY_MS);
                } else {
                    clearSession();
                }
            });
        }

        // ⭐ إذا كان هناك جلسة موجودة + auth → جدّد فوراً
        if (State.data && window.auth && window.auth.currentUser) {
            if (State.syncTimer) clearTimeout(State.syncTimer);
            State.syncTimer = setTimeout(function () {
                syncWithFirebase();
            }, CONFIG.SYNC_DELAY_MS);
        }

        _startChecker();
        _startActivityTracker();
        Logger.info('📦 [session.js v2.1] started');
    }

    function stop() {
        _stopChecker();
        if (State.touchTimer) { clearInterval(State.touchTimer); State.touchTimer = null; }
        if (State.syncTimer) { clearTimeout(State.syncTimer); State.syncTimer = null; }
        State._started = false;
    }

    function getStatus() {
        return {
            hasSession: !!State.data,
            uid: State.data ? State.data.uid : null,
            isGuest: State.data ? !!State.data.isGuest : null,
            name: State.data ? State.data.name : null,
            rank: State.data ? State.data.rank : null,
            rankLevel: State.data ? State.data.rankLevel : null,
            ageMs: getSessionAge(),
            remainingMs: getRemainingMs(),
            expired: State.data ? isSessionExpired(State.data) : null,
            lastSaved: State.lastSaved,
            lastTouched: State.lastTouched,
            lastCheck: State.lastCheck,
            started: State._started
        };
    }

    const QamarSession = {
        saveSession: saveSession,
        loadSession: loadSession,
        restoreSession: restoreSession,
        clearSession: clearSession,
        updateSession: updateSession,
        touchSession: touchSession,
        isSessionExpired: isSessionExpired,
        isSessionValid: isSessionValid,
        getSessionAge: getSessionAge,
        getRemainingMs: getRemainingMs,
        syncWithFirebase: syncWithFirebase,
        getData: function () { return State.data; },
        onSessionChange: onSessionChange,
        start: start,
        stop: stop,
        getStatus: getStatus,
        CONFIG: CONFIG
    };

    window.QamarSession = QamarSession;
    window.loadSession = loadSession;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 100); });
    } else {
        setTimeout(start, 100);
    }

    Logger.info('📦 [session.js v2.1] loaded');
})();
