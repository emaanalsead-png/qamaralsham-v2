// ==============================================
// auth/auth.js
// Mixed auth — Guests (Anonymous) + Members (Email)
// ==============================================
// يعتمد على: firebase.js + resilience.js + EventBus
// يعطي: window.QamarAuth
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [auth] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[AUTH]';
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
        MIN_PASSWORD_LENGTH: 6,
        AUTH_WAIT_TIMEOUT: 8000,
        ERROR_MESSAGES: {
            'auth/email-already-in-use':    'البريد الإلكتروني مستخدم بالفعل',
            'auth/invalid-email':           'البريد الإلكتروني غير صحيح',
            'auth/operation-not-allowed':   'هذه العملية غير مفعّلة',
            'auth/weak-password':           'كلمة المرور ضعيفة جداً (6 أحرف على الأقل)',
            'auth/user-disabled':           'هذا الحساب معطّل',
            'auth/user-not-found':          'لا يوجد حساب بهذا البريد',
            'auth/wrong-password':          'كلمة المرور غير صحيحة',
            'auth/invalid-credential':      'البريد أو كلمة المرور غير صحيحة',
            'auth/too-many-requests':       'محاولات كثيرة — حاول لاحقاً',
            'auth/network-request-failed':  'تعذر الاتصال — تحقق من الإنترنت',
            'auth/requires-recent-login':   'أعد تسجيل الدخول لإتمام العملية',
            'auth/operation-not-supported-in-this-environment': 'العملية غير مدعومة في هذا المتصفح',
            'auth/unauthorized-domain':     'هذا النطاق غير مصرّح به في Firebase'
        }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        currentUser: null,
        isReady: false,
        readyPromise: null,
        authUnsubscribe: null,
        listeners: [],
        lastSignInAt: 0,
        _signingOut: false,
        _switching: false
    };

    /* ══════════════════════════════════════════════ */
    /* Error translation                               */
    /* ══════════════════════════════════════════════ */
    function _translateError(err) {
        if (!err) return 'حدث خطأ غير معروف';
        const code = err.code || '';
        if (CONFIG.ERROR_MESSAGES[code]) return CONFIG.ERROR_MESSAGES[code];
        return err.message || 'حدث خطأ';
    }

    function _wrapError(err) {
        const code = (err && err.code) || 'unknown';
        const msg = _translateError(err);
        const wrapped = new Error(msg);
        wrapped.code = code;
        wrapped.original = err;
        return wrapped;
    }

    /* ══════════════════════════════════════════════ */
    /* Ready promise                                   */
    /* ══════════════════════════════════════════════ */
    function waitForAuth(timeoutMs) {
        if (State.readyPromise) return State.readyPromise;
        timeoutMs = timeoutMs || CONFIG.AUTH_WAIT_TIMEOUT;

        State.readyPromise = new Promise(function (resolve) {
            if (!window.auth) {
                Logger.warn('auth SDK not available');
                setTimeout(function () { resolve(false); }, 500);
                return;
            }

            let resolved = false;
            const timer = setTimeout(function () {
                if (resolved) return;
                resolved = true;
                State.isReady = true;
                Logger.warn('auth ready timeout — proceeding anyway');
                resolve(false);
            }, timeoutMs);

            const unsub = window.auth.onAuthStateChanged(function (user) {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                State.isReady = true;
                State.currentUser = user || null;
                Logger.info('auth ready — user:', user ? (user.isAnonymous ? 'guest' : user.email) : 'none');
                resolve(true);
            });

            State._initialUnsub = unsub;
        });

        return State.readyPromise;
    }

    /* ══════════════════════════════════════════════ */
    /* Auth state listener                             */
    /* ══════════════════════════════════════════════ */
    function _startAuthListener() {
        if (!window.auth) return;
        if (State.authUnsubscribe) return;

        State.authUnsubscribe = window.auth.onAuthStateChanged(function (user) {
            State.currentUser = user || null;
            const isGuest = !!(user && user.isAnonymous);

            if (window.AppState) {
                try { window.AppState.isGuest = isGuest; } catch (e) {}
            }

            _emitAuthChange(user);
        });
    }

    function _emitAuthChange(user) {
        const isGuest = !!(user && user.isAnonymous);
        const payload = {
            user: user,
            uid: user ? user.uid : null,
            isGuest: isGuest,
            isLoggedIn: !!user,
            isMember: !!(user && !user.isAnonymous)
        };

        if (window.EventBus) {
            try { window.EventBus.emit('auth:state', payload); } catch (e) {}
        }

        State.listeners.slice().forEach(function (cb) {
            try { cb(payload); } catch (e) { Logger.warn('listener error:', e); }
        });
    }

    function onAuthChange(cb) {
        if (typeof cb !== 'function') return function () {};
        State.listeners.push(cb);
        if (State.isReady) {
            const u = State.currentUser;
            setTimeout(function () {
                try {
                    cb({
                        user: u,
                        uid: u ? u.uid : null,
                        isGuest: !!(u && u.isAnonymous),
                        isLoggedIn: !!u,
                        isMember: !!(u && !u.isAnonymous)
                    });
                } catch (e) {}
            }, 0);
        }
        return function off() {
            State.listeners = State.listeners.filter(function (h) { return h !== cb; });
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Internal: signOut first (لتبديل الحساب)         */
    /* ══════════════════════════════════════════════ */
    function _signOutCurrent() {
        if (!window.auth || !window.auth.currentUser) return Promise.resolve();
        return window.auth.signOut().catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Guest (Anonymous) sign-in                       */
    /* ══════════════════════════════════════════════ */
    function signInAsGuest() {
        if (!window.auth) return Promise.reject(new Error('Firebase Auth غير متاح'));

        // إذا مسجل فعلاً كزائر
        if (State.currentUser && State.currentUser.isAnonymous) {
            return Promise.resolve({
                user: State.currentUser,
                uid: State.currentUser.uid,
                isGuest: true,
                alreadySignedIn: true
            });
        }

        // إذا مسجل بحساب عضو → لا تسجل دخول زائر
        if (State.currentUser && !State.currentUser.isAnonymous) {
            return Promise.reject(new Error('أنت مسجل حالياً كعضو — اخرج أولاً'));
        }

        const doSign = function () { return window.auth.signInAnonymously(); };
        const p = window.QamarResilience
            ? window.QamarResilience.retry(doSign, { label: 'signInAnonymously', maxRetries: 3 })
            : doSign();

        return p.then(function (cred) {
            State.currentUser = cred.user;
            State.lastSignInAt = Date.now();
            Logger.info('✅ Signed in as guest:', cred.user.uid);

            if (window.EventBus) {
                try { window.EventBus.emit('auth:guest', cred.user); } catch (e) {}
            }

            return { user: cred.user, uid: cred.user.uid, isGuest: true };
        }).catch(function (err) {
            Logger.error('signInAsGuest failed:', err.code);
            if (window.EventBus) {
                try { window.EventBus.emit('auth:error', _wrapError(err)); } catch (e) {}
            }
            throw _wrapError(err);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Email/Password sign-in                          */
    /* ══════════════════════════════════════════════ */
    function signIn(email, password) {
        if (!email || !password) {
            return Promise.reject(_wrapError({ code: 'custom/missing', message: 'البريد وكلمة المرور مطلوبان' }));
        }
        if (!window.auth) return Promise.reject(new Error('Firebase Auth غير متاح'));

        // إذا زائر مسجل → اخرج أولاً
        const pre = (State.currentUser && State.currentUser.isAnonymous)
            ? _signOutCurrent()
            : Promise.resolve();

        return pre
            .then(function () {
                return window.auth.signInWithEmailAndPassword(email, password);
            })
            .then(function (cred) {
                State.currentUser = cred.user;
                State.lastSignInAt = Date.now();
                Logger.info('✅ Signed in as member:', cred.user.email);

                if (window.EventBus) {
                    try { window.EventBus.emit('auth:signin', cred.user); } catch (e) {}
                }

                return { user: cred.user, uid: cred.user.uid, isGuest: false, isMember: true };
            })
            .catch(function (err) {
                Logger.error('signIn failed:', err.code);
                if (window.EventBus) {
                    try { window.EventBus.emit('auth:error', _wrapError(err)); } catch (e) {}
                }
                throw _wrapError(err);
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Register new member (email/password)            */
    /* ══════════════════════════════════════════════ */
    // ⚠️ ملاحظة: إذا كان المستخدم زائراً → يتم تسجيل خروجه أولاً
    // ثم إنشاء حساب عضو جديد مستقل
    function register(email, password, options) {
        options = options || {};
        if (!email || !password) {
            return Promise.reject(_wrapError({ code: 'custom/missing', message: 'البريد وكلمة المرور مطلوبان' }));
        }
        if (password.length < CONFIG.MIN_PASSWORD_LENGTH) {
            return Promise.reject(_wrapError({ code: 'auth/weak-password' }));
        }
        if (!window.auth) return Promise.reject(new Error('Firebase Auth غير متاح'));

        // إذا زائر مسجل → اخرج أولاً (لا ترقية)
        const pre = (State.currentUser && State.currentUser.isAnonymous)
            ? _signOutCurrent()
            : Promise.resolve();

        return pre
            .then(function () {
                return window.auth.createUserWithEmailAndPassword(email, password);
            })
            .then(function (cred) {
                State.currentUser = cred.user;
                Logger.info('✅ Registered as member:', email);

                if (options.displayName && cred.user.updateProfile) {
                    return cred.user.updateProfile({ displayName: options.displayName })
                        .then(function () { return cred; })
                        .catch(function () { return cred; });
                }
                return cred;
            })
            .then(function (cred) {
                if (window.EventBus) {
                    try { window.EventBus.emit('auth:register', cred.user); } catch (e) {}
                }
                return {
                    user: cred.user,
                    uid: cred.user.uid,
                    isGuest: false,
                    isMember: true
                };
            })
            .catch(function (err) {
                Logger.error('register failed:', err.code);
                if (window.EventBus) {
                    try { window.EventBus.emit('auth:error', _wrapError(err)); } catch (e) {}
                }
                throw _wrapError(err);
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Sign out                                        */
    /* ══════════════════════════════════════════════ */
    function signOut() {
        if (!window.auth) return Promise.reject(new Error('Firebase Auth غير متاح'));
        if (State._signingOut) return Promise.resolve({ alreadySigningOut: true });
        State._signingOut = true;

        const oldUser = State.currentUser;

        return window.auth.signOut()
            .then(function () {
                State.currentUser = null;
                State._signingOut = false;
                Logger.info('✅ Signed out');

                if (window.EventBus) {
                    try { window.EventBus.emit('auth:signout', oldUser); } catch (e) {}
                }
                return { ok: true };
            })
            .catch(function (err) {
                State._signingOut = false;
                Logger.error('signOut failed:', err.code);
                throw _wrapError(err);
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Reset password                                  */
    /* ══════════════════════════════════════════════ */
    function resetPassword(email) {
        if (!email) return Promise.reject(_wrapError({ code: 'custom/missing', message: 'البريد مطلوب' }));
        if (!window.auth) return Promise.reject(new Error('Firebase Auth غير متاح'));

        return window.auth.sendPasswordResetEmail(email)
            .then(function () {
                Logger.info('✅ Reset email sent to:', email);
                if (window.EventBus) {
                    try { window.EventBus.emit('auth:reset-sent', email); } catch (e) {}
                }
                return { ok: true, email: email };
            })
            .catch(function (err) { throw _wrapError(err); });
    }

    /* ══════════════════════════════════════════════ */
    /* Change password                                 */
    /* ══════════════════════════════════════════════ */
    function changePassword(currentPassword, newPassword) {
        const u = State.currentUser;
        if (!u) return Promise.reject(_wrapError({ code: 'custom/no-user', message: 'غير مسجل' }));
        if (u.isAnonymous) return Promise.reject(_wrapError({ code: 'custom/guest', message: 'الزوار لا يمكنهم تغيير كلمة المرور' }));
        if (!newPassword || newPassword.length < CONFIG.MIN_PASSWORD_LENGTH) {
            return Promise.reject(_wrapError({ code: 'auth/weak-password' }));
        }
        if (!u.email) return Promise.reject(_wrapError({ code: 'custom/no-email', message: 'لا يوجد بريد للحساب' }));

        const credential = firebase.auth.EmailAuthProvider.credential(u.email, currentPassword);
        return u.reauthenticateWithCredential(credential)
            .then(function () { return u.updatePassword(newPassword); })
            .then(function () {
                Logger.info('✅ Password changed');
                return { ok: true };
            })
            .catch(function (err) { throw _wrapError(err); });
    }

    /* ══════════════════════════════════════════════ */
    /* Delete account                                  */
    /* ══════════════════════════════════════════════ */
    function deleteAccount() {
        const u = State.currentUser;
        if (!u) return Promise.reject(_wrapError({ code: 'custom/no-user', message: 'غير مسجل' }));

        return u.delete()
            .then(function () {
                State.currentUser = null;
                Logger.info('✅ Account deleted');
                if (window.EventBus) {
                    try { window.EventBus.emit('auth:deleted'); } catch (e) {}
                }
                return { ok: true };
            })
            .catch(function (err) { throw _wrapError(err); });
    }

    /* ══════════════════════════════════════════════ */
    /* Getters                                         */
    /* ══════════════════════════════════════════════ */
    function getCurrentUser() {
        return State.currentUser || (window.auth ? window.auth.currentUser : null);
    }

    function getUid() {
        const u = getCurrentUser();
        return u ? u.uid : null;
    }

    function isGuest() {
        const u = getCurrentUser();
        return !!(u && u.isAnonymous);
    }

    function isLoggedIn() {
        return !!getCurrentUser();
    }

    function isEmailUser() {
        const u = getCurrentUser();
        return !!(u && !u.isAnonymous && u.email);
    }

    // alias — نفس isEmailUser لكن اسم أوضح
    function isMember() {
        return isEmailUser();
    }

    function getEmail() {
        const u = getCurrentUser();
        return u && u.email ? u.email : null;
    }

    function getDisplayName() {
        const u = getCurrentUser();
        return u && u.displayName ? u.displayName : null;
    }

    /* ══════════════════════════════════════════════ */
    /* Token                                           */
    /* ══════════════════════════════════════════════ */
    function getIdToken(forceRefresh) {
        const u = getCurrentUser();
        if (!u) return Promise.resolve(null);
        return u.getIdToken(!!forceRefresh).catch(function () { return null; });
    }

    /* ══════════════════════════════════════════════ */
    /* Update profile                                  */
    /* ══════════════════════════════════════════════ */
    function updateProfile(updates) {
        const u = getCurrentUser();
        if (!u) return Promise.reject(_wrapError({ code: 'custom/no-user', message: 'غير مسجل' }));
        return u.updateProfile(updates || {})
            .then(function () {
                Logger.info('✅ Profile updated');
                return { ok: true };
            })
            .catch(function (err) { throw _wrapError(err); });
    }

    function updateEmail(newEmail, password) {
        const u = getCurrentUser();
        if (!u) return Promise.reject(_wrapError({ code: 'custom/no-user', message: 'غير مسجل' }));
        if (u.isAnonymous) return Promise.reject(_wrapError({ code: 'custom/guest', message: 'الزوار لا يمكنهم تغيير البريد' }));
        if (!newEmail) return Promise.reject(_wrapError({ code: 'auth/invalid-email' }));

        const doUpdate = function () { return u.updateEmail(newEmail); };

        if (password && u.email) {
            const cred = firebase.auth.EmailAuthProvider.credential(u.email, password);
            return u.reauthenticateWithCredential(cred).then(doUpdate)
                .then(function () { return { ok: true }; })
                .catch(function (err) { throw _wrapError(err); });
        }
        return doUpdate()
            .then(function () { return { ok: true }; })
            .catch(function (err) { throw _wrapError(err); });
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (!window.auth) {
            Logger.error('Firebase auth SDK not available');
            return;
        }
        _startAuthListener();
        Logger.info('📦 [auth.js] initialized');
    }

    if (window.auth) {
        _init();
    } else if (typeof window.waitForFirebase === 'function') {
        window.waitForFirebase().then(_init).catch(function () {
            Logger.error('waitForFirebase failed');
        });
    }

    window.waitForAuth = waitForAuth;

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarAuth = {
        // Lifecycle
        waitForAuth: waitForAuth,

        // Guest
        signInAsGuest: signInAsGuest,

        // Email (members)
        signIn: signIn,
        register: register,
        signOut: signOut,

        // Password
        resetPassword: resetPassword,
        changePassword: changePassword,

        // Profile
        updateProfile: updateProfile,
        updateEmail: updateEmail,
        deleteAccount: deleteAccount,

        // Getters
        getCurrentUser: getCurrentUser,
        getUid: getUid,
        getEmail: getEmail,
        getDisplayName: getDisplayName,
        isGuest: isGuest,
        isLoggedIn: isLoggedIn,
        isEmailUser: isEmailUser,
        isMember: isMember,

        // Token
        getIdToken: getIdToken,

        // Events
        onAuthChange: onAuthChange,

        // Helpers
        translateError: _translateError,

        // Config
        CONFIG: CONFIG
    };

    window.QamarAuth = QamarAuth;

    Logger.info('📦 [auth.js] loaded');
})();
