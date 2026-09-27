// ==============================================
// auth/session.js
// Session persistence + restoration (24h TTL)
// ==============================================
// يعتمد على: firebase.js + utils.js + auth.js
// يعطي: window.QamarSession
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

    /* ══════════════════════════════════════════════ */
    /* Config                                          */
    /* ══════════════════════════════════════════════ */
    const CONFIG = {
        STORAGE_KEY: 'qamar_session_v2',
        TTL_MS: 24 * 60 * 60 * 1000,      // 24 ساعة
        CHECK_INTERVAL_MS: 60 * 1000,     // فحص كل دقيقة
        TOUCH_INTERVAL_MS: 2 * 60 * 1000, // حدّث النشاط كل دقيقتين
        VERSION: 1
    };

    // الحقول التي تُحفظ
    const PERSONAL_FIELDS = [
        'uid', 'name', 'code', 'avatar',
        'rank', 'rankLevel', 'isGuest', 'isEmailUser',
        'email', 'country', 'family', 'gender', 'age'
    ];

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        data: null,             // الجلسة الحالية
        lastSaved: 0,
        lastTouched: 0,
        lastCheck: 0,
        checkTimer: null,
        touchTimer: null,
        listeners: [],
        _started: false
    };

    /* ══════════════════════════════════════════════ */
    /* Listeners (محلي)                                */
    /* ══════════════════════════════════════════════ */
    function onSessionChange(cb) {
        if (typeof cb !== 'function') return function () {};
        State.listeners.push(cb);
        return function off() {
            State.listeners = State.listeners.filter(function (h) { return h !== cb; });
        };
    }

    function _emit(eventName, payload) {
        // EventBus العام
        if (window.EventBus) {
            try { window.EventBus.emit(eventName, payload); } catch (e) {}
        }
        // المستمعون المحليون (لأحداث الجلسة فقط)
        if (eventName === 'session:changed') {
            State.listeners.slice().forEach(function (cb) {
                try { cb(payload); } catch (e) { Logger.warn('listener error:', e); }
            });
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Build session object from current user          */
    /* ══════════════════════════════════════════════ */
    function _buildSession(user) {
        if (!user) return null;
        const now = Date.now();
        const isGuest = !!user.isAnonymous;
        const isEmailUser = !isGuest && !!user.email;

        // اقرأ بيانات إضافية من AppState (إن وُجدت)
        const appUser = (window.AppState && window.AppState.user) ? window.AppState.user : {};

        const session = {
            _v: CONFIG.VERSION,
            signedInAt: State.data && State.data.signedInAt ? State.data.signedInAt : now,
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
                session.email = user.email || null;
            } else if (f === 'name') {
                session.name = user.displayName || appUser.name || null;
            } else {
                session[f] = appUser[f] !== undefined ? appUser[f] : null;
            }
        });

        return session;
    }

    /* ══════════════════════════════════════════════ */
    /* Save session                                    */
    /* ══════════════════════════════════════════════ */
    function saveSession(userOrSession) {
        try {
            let session;
            if (userOrSession && userOrSession.uid && !userOrSession._v) {
                // هذا user → ابنِ الجلسة
                session = _buildSession(userOrSession);
            } else if (userOrSession && userOrSession._v) {
                // هذا session جاهز
                session = userOrSession;
            } else if (userOrSession === undefined) {
                // استخدم الحالي من auth
                const u = (window.QamarAuth && window.QamarAuth.getCurrentUser)
                    ? window.QamarAuth.getCurrentUser()
                    : (window.auth ? window.auth.currentUser : null);
                if (!u) {
                    Logger.warn('saveSession: no current user');
                    return false;
                }
                session = _buildSession(u);
            } else {
                Logger.warn('saveSession: invalid input');
                return false;
            }

            if (!session || !session.uid) {
                Logger.warn('saveSession: session has no uid');
                return false;
            }

            State.data = session;
            State.lastSaved = Date.now();

            if (window.safeSetJSON) {
                window.safeSetJSON(CONFIG.STORAGE_KEY, session);
            } else {
                localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(session));
            }

            Logger.info('💾 Session saved: uid=' + session.uid.substring(0, 8) + '... (TTL: 24h)');
            _emit('session:saved', session);
            _emit('session:changed', { action: 'saved', session: session });
            return true;

        } catch (e) {
            Logger.error('saveSession error:', e);
            return false;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Load session (من localStorage فقط)              */
    /* ══════════════════════════════════════════════ */
    function loadSession() {
        try {
            let data;
            if (window.safeGetJSON) {
                data = window.safeGetJSON(CONFIG.STORAGE_KEY, null);
            } else {
                const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
                data = raw ? JSON.parse(raw) : null;
            }

            if (!data || !data.uid) {
                Logger.debug('No saved session');
                return null;
            }

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
            Logger.info('📂 Session loaded from storage: uid=' + data.uid.substring(0, 8) + '...');
            return data;

        } catch (e) {
            Logger.error('loadSession error:', e);
            return null;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Check expiration                                */
    /* ══════════════════════════════════════════════ */
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

    /* ══════════════════════════════════════════════ */
    /* Restore session (مع التحقق من Firebase)         */
    /* ══════════════════════════════════════════════ */
    function restoreSession() {
        const s = loadSession();
        if (!s) {
            return Promise.resolve({ restored: false, reason: 'no-session' });
        }

        // طابق UID مع firebase.auth الحالي
        const currentUid = window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;

        if (!currentUid) {
            // Firebase لم يجهز بعد — انتظر قليلاً
            Logger.debug('restoreSession: waiting for auth...');
            return (window.QamarAuth && window.QamarAuth.waitForAuth
                ? window.QamarAuth.waitForAuth(5000)
                : Promise.resolve()
            ).then(function () {
                return _verifyWithFirebase(s);
            });
        }

        return _verifyWithFirebase(s);
    }

    function _verifyWithFirebase(sessionData) {
        const currentUid = window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;

        if (!currentUid) {
            Logger.warn('restoreSession: no auth user — session saved but not active');
            return { restored: false, reason: 'no-auth', session: sessionData };
        }

        if (currentUid !== sessionData.uid) {
            Logger.warn('restoreSession: UID mismatch — saving fresh session');
            // المستخدم تغيّر → احفظ الجلسة الجديدة
            const u = window.auth.currentUser;
            saveSession(u);
            return { restored: false, reason: 'uid-mismatch', freshSaved: true };
        }

        // UID متطابق — الجلسة صالحة
        Logger.info('✅ Session restored successfully');
        _emit('session:restored', sessionData);
        _emit('session:changed', { action: 'restored', session: sessionData });
        return { restored: true, session: sessionData };
    }

    /* ══════════════════════════════════════════════ */
    /* Clear session                                   */
    /* ══════════════════════════════════════════════ */
    function clearSession() {
        try {
            State.data = null;
            State.lastSaved = 0;
            State.lastTouched = 0;

            if (window.localStorage) {
                localStorage.removeItem(CONFIG.STORAGE_KEY);
            }

            Logger.info('🗑️ Session cleared');
            _emit('session:cleared');
            _emit('session:changed', { action: 'cleared' });
            return true;
        } catch (e) {
            Logger.error('clearSession error:', e);
            return false;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Update session (partial)                        */
    /* ══════════════════════════════════════════════ */
    function updateSession(updates) {
        if (!updates || typeof updates !== 'object') return false;
        if (!State.data) {
            // لا جلسة → ابنِ واحدة
            const u = window.auth ? window.auth.currentUser : null;
            if (u) saveSession(u);
            if (!State.data) return false;
        }

        // دمج الحقول المسموحة فقط
        PERSONAL_FIELDS.forEach(function (f) {
            if (updates[f] !== undefined) {
                State.data[f] = updates[f];
            }
        });

        State.data.lastActiveAt = Date.now();
        State.lastSaved = Date.now();

        if (window.safeSetJSON) {
            window.safeSetJSON(CONFIG.STORAGE_KEY, State.data);
        } else {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(State.data));
        }

        Logger.debug('🔄 Session updated');
        _emit('session:changed', { action: 'updated', session: State.data });
        return true;
    }

    /* ══════════════════════════════════════════════ */
    /* Touch (update lastActiveAt)                     */
    /* ══════════════════════════════════════════════ */
    function touchSession() {
        if (!State.data) return false;
        const now = Date.now();
        if (now - State.lastTouched < CONFIG.TOUCH_INTERVAL_MS) return false;

        State.lastTouched = now;
        State.data.lastActiveAt = now;
        // لا نمدد expiresAt — 24 ساعة من signedInAt فقط

        try {
            if (window.safeSetJSON) {
                window.safeSetJSON(CONFIG.STORAGE_KEY, State.data);
            } else {
                localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(State.data));
            }
        } catch (e) {}

        return true;
    }

    /* ══════════════════════════════════════════════ */
    /* Sync with Firebase (المستخدم الحي)              */
    /* ══════════════════════════════════════════════ */
    function syncWithFirebase() {
        const u = window.auth ? window.auth.currentUser : null;
        if (!u) return Promise.resolve({ synced: false, reason: 'no-user' });

        return window.QamarFB.get('users/' + u.uid).then(function (data) {
            if (!data) {
                Logger.debug('syncWithFirebase: no DB user yet');
                return { synced: false, reason: 'no-db-user' };
            }

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

            updateSession(updates);
            Logger.info('✅ Session synced with Firebase DB');
            return { synced: true, updates: updates };
        }).catch(function (e) {
            Logger.warn('syncWithFirebase error:', e.message);
            return { synced: false, reason: e.message };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Expiration checker (background)                 */
    /* ══════════════════════════════════════════════ */
    function _startChecker() {
        if (State.checkTimer) return;
        State.checkTimer = setInterval(function () {
            State.lastCheck = Date.now();
            if (!State.data) return;

            if (isSessionExpired(State.data)) {
                Logger.warn('⏰ Session expired — signing out');
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

        // سجّل خروج
        if (window.QamarAuth && window.QamarAuth.signOut) {
            window.QamarAuth.signOut().catch(function (e) {
                Logger.warn('auto signOut after expiry failed:', e.message);
            });
        } else if (window.auth) {
            window.auth.signOut().catch(function () {});
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Touch on activity                               */
    /* ══════════════════════════════════════════════ */
    function _startActivityTracker() {
        if (State.touchTimer) return;
        State.touchTimer = setInterval(function () {
            if (State.data) touchSession();
        }, CONFIG.TOUCH_INTERVAL_MS);

        // أحداث المستخدم
        if (typeof document !== 'undefined') {
            ['click', 'keydown', 'touchstart'].forEach(function (ev) {
                document.addEventListener(ev, function () {
                    if (State.data) touchSession();
                }, { passive: true });
            });
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Start / Stop                                    */
    /* ══════════════════════════════════════════════ */
    function start() {
        if (State._started) return;
        State._started = true;

        // اربط مع auth إذا متاح
        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (payload) {
                if (payload.isLoggedIn) {
                    // جدّد الجلسة عند تسجيل الدخول
                    saveSession(payload.user);
                } else {
                    // مسح عند الخروج
                    clearSession();
                }
            });
        }

        _startChecker();
        _startActivityTracker();

        Logger.info('📦 [session.js] started');
    }

    function stop() {
        _stopChecker();
        if (State.touchTimer) {
            clearInterval(State.touchTimer);
            State.touchTimer = null;
        }
        State._started = false;
        Logger.info('Stopped');
    }

    /* ══════════════════════════════════════════════ */
    /* Status / Debug                                  */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            hasSession: !!State.data,
            uid: State.data ? State.data.uid : null,
            isGuest: State.data ? !!State.data.isGuest : null,
            name: State.data ? State.data.name : null,
            rank: State.data ? State.data.rank : null,
            ageMs: getSessionAge(),
            remainingMs: getRemainingMs(),
            expired: State.data ? isSessionExpired(State.data) : null,
            lastSaved: State.lastSaved,
            lastTouched: State.lastTouched,
            lastCheck: State.lastCheck,
            started: State._started
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarSession = {
        // Core
        saveSession: saveSession,
        loadSession: loadSession,
        restoreSession: restoreSession,
        clearSession: clearSession,
        updateSession: updateSession,
        touchSession: touchSession,

        // Checks
        isSessionExpired: isSessionExpired,
        isSessionValid: isSessionValid,
        getSessionAge: getSessionAge,
        getRemainingMs: getRemainingMs,

        // Sync
        syncWithFirebase: syncWithFirebase,

        // Data
        getData: function () { return State.data; },

        // Events
        onSessionChange: onSessionChange,

        // Lifecycle
        start: start,
        stop: stop,

        // Debug
        getStatus: getStatus,

        // Config
        CONFIG: CONFIG
    };

    window.QamarSession = QamarSession;

    // سجّل loadSession على window (يستخدمها boot.js)
    window.loadSession = loadSession;

    // ابدأ تلقائياً
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(start, 100);
        });
    } else {
        setTimeout(start, 100);
    }

    Logger.info('📦 [session.js] loaded');
})();
