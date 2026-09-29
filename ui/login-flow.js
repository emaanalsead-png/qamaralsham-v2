// ==============================================
// ui/login-flow.js v2.2
// يربط شاشة الدخول بـ QamarAuth + يفتح main-app
// ==============================================
// يعتمد على: auth.js + session.js + chat.js
// يعطي: window.QamarLoginFlow
// ==============================================
// ✅ v2.2: يبدأ الشات مباشرة بدون Firebase writes
//          (يزيل permission_denied على user_presence)
// ==============================================

(function () {
    'use strict';

    if (!window.QamarAuth) {
        console.error('❌ [login-flow] auth.js not loaded!');
        return;
    }

    if (window.QamarLoginFlow && window.QamarLoginFlow.__v22) return;

    const LOG_TAG = '[LOGIN]';
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
        DEFAULT_ROOM: 'general',
        LAST_ROOM_KEY: 'qamar_last_room',
        AUTO_START_DELAY_MS: 400
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        els: {},
        ready: false,
        busy: false,
        listeners: [],
        _initialized: false
    };

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

    function _showError(msg) {
        const el = State.els.error;
        if (!el) return;
        el.textContent = msg || 'حدث خطأ';
        el.classList.remove('hidden');
    }

    function _hideError() {
        const el = State.els.error;
        if (!el) return;
        el.textContent = '';
        el.classList.add('hidden');
    }

    function _setBusy(busy, which) {
        State.busy = !!busy;
        const btns = [
            State.els.guestBtn,
            State.els.loginBtn,
            State.els.registerBtn,
            State.els.forgotBtn
        ];
        btns.forEach(function (b) {
            if (!b) return;
            if (busy) {
                b.disabled = true;
                b.dataset.origText = b.dataset.origText || b.innerHTML;
                if (b === which) {
                    b.innerHTML = '<span class="spinner"></span> جاري...';
                }
            } else {
                b.disabled = false;
                if (b.dataset.origText) {
                    b.innerHTML = b.dataset.origText;
                }
            }
        });
    }

    function _toast(msg) {
        if (window.showToast) {
            try { window.showToast('fa-info-circle', msg); return; } catch (e) {}
        }
        Logger.info('toast:', msg);
    }

    /* ══════════════════════════════════════════════ */
    /* التبويبات                                       */
    /* ══════════════════════════════════════════════ */
    function switchTab(tabId) {
        if (!tabId) return;
        _qa('.ls-tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.lsTab === tabId);
        });
        _qa('.ls-panel').forEach(function (p) {
            p.classList.toggle('active', p.dataset.lsPanel === tabId);
        });
        _hideError();
    }

    function _bindTabs() {
        _qa('.ls-tab').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                switchTab(btn.dataset.lsTab);
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Actions                                         */
    /* ══════════════════════════════════════════════ */
    function _doGuest() {
        if (State.busy) return;
        _hideError();
        _setBusy(true, State.els.guestBtn);

        window.QamarAuth.signInAsGuest()
            .then(function (r) {
                Logger.info('✅ Guest sign-in OK:', r.uid.substring(0, 8));
                _onAuthSuccess(r);
            })
            .catch(function (err) {
                Logger.error('Guest sign-in failed:', err.message);
                _showError(err.message || 'تعذر الدخول كزائر');
                _setBusy(false);
            });
    }

    function _doLogin() {
        if (State.busy) return;
        _hideError();

        const email = (State.els.email && State.els.email.value || '').trim();
        const password = (State.els.password && State.els.password.value || '');

        if (!email) { _showError('البريد مطلوب'); return; }
        if (!password) { _showError('كلمة المرور مطلوبة'); return; }

        _setBusy(true, State.els.loginBtn);

        window.QamarAuth.signIn(email, password)
            .then(function (r) {
                Logger.info('✅ Member sign-in OK');
                _onAuthSuccess(r);
            })
            .catch(function (err) {
                Logger.error('Member sign-in failed:', err.message);
                _showError(err.message || 'البريد أو كلمة المرور غير صحيحة');
                _setBusy(false);
            });
    }

    function _doRegister() {
        if (State.busy) return;
        _hideError();

        const email = (State.els.regEmail && State.els.regEmail.value || '').trim();
        const password = (State.els.regPassword && State.els.regPassword.value || '');
        const name = (State.els.regName && State.els.regName.value || '').trim();

        if (!email) { _showError('البريد مطلوب'); return; }
        if (!password) { _showError('كلمة المرور مطلوبة'); return; }
        if (password.length < 6) { _showError('كلمة المرور قصيرة (6 أحرف على الأقل)'); return; }
        if (name && name.length < 2) { _showError('الاسم قصير جداً'); return; }

        _setBusy(true, State.els.registerBtn);

        window.QamarAuth.register(email, password, { displayName: name })
            .then(function (r) {
                Logger.info('✅ Register OK (upgraded=' + !!r.upgraded + ')');
                _onAuthSuccess(r, { isRegister: true });
            })
            .catch(function (err) {
                Logger.error('Register failed:', err.message);
                _showError(err.message || 'تعذر إنشاء الحساب');
                _setBusy(false);
            });
    }

    function _doForgot() {
        if (State.busy) return;
        _hideError();

        const email = (State.els.email && State.els.email.value || '').trim();
        if (!email) { _showError('اكتب البريد أولاً'); return; }

        _setBusy(true, State.els.forgotBtn);

        window.QamarAuth.resetPassword(email)
            .then(function () {
                _toast('📧 تم إرسال رابط الاستعادة إلى ' + email);
                _setBusy(false);
            })
            .catch(function (err) {
                _showError(err.message || 'تعذر إرسال الرابط');
                _setBusy(false);
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Post-login                                      */
    /* ══════════════════════════════════════════════ */
    function _onAuthSuccess(result, options) {
        options = options || {};

        _ensureUserRecord(result).then(function () {
            _showApp();
            setTimeout(function () {
                _autoEnterRoom();
            }, CONFIG.AUTO_START_DELAY_MS);
        }).catch(function (e) {
            Logger.warn('ensureUserRecord failed:', e.message);
            _showApp();
            setTimeout(function () {
                _autoEnterRoom();
            }, CONFIG.AUTO_START_DELAY_MS);
        });
    }

    /* ⭐ v2.2: اختيار الغرفة — مباشرة بدون Firebase writes */
    function _autoEnterRoom() {
        return Promise.resolve().then(function () {
            // 1) آخر غرفة محفوظة
            let roomId = null;
            try { roomId = localStorage.getItem(CONFIG.LAST_ROOM_KEY); } catch (e) {}
            if (!roomId) roomId = CONFIG.DEFAULT_ROOM;

            Logger.info('🎯 Auto-entering room:', roomId);

            // ⭐ v2.2: نحدّث localStorage + AppState فقط (بدون Firebase)
            try {
                localStorage.setItem(CONFIG.LAST_ROOM_KEY, roomId);
            } catch (e) {}

            if (window.AppState) {
                try { window.AppState.setRoom(roomId); } catch (e) {}
            }

            // 2) ابدأ الشات مباشرة — بدون room_members/user_presence
            if (window.QamarChat && typeof window.QamarChat.start === 'function') {
                try {
                    window.QamarChat.start(roomId);
                    Logger.info('✅ Chat started:', roomId);
                    _emit('login-flow:roomEntered', { roomId: roomId });
                } catch (e) {
                    Logger.warn('Chat start failed:', e.message);
                }
            } else {
                Logger.warn('QamarChat not available');
            }

            // 3) أطلق room:changed ليستمع له chat-ui + room-voice
            if (window.EventBus) {
                try {
                    window.EventBus.emit('room:changed', { roomId: roomId });
                } catch (e) {}
            }

            // 4) حدّث واجهة الهيدر يدوياً
            _updateHeaderRoom(roomId);

            return { ok: true, roomId: roomId };
        }).catch(function (e) {
            Logger.warn('_autoEnterRoom failed:', e.message);
        });
    }

    // ⭐ v2.2: تحديث الهيدر يدوياً (بدل room-settings)
    function _updateHeaderRoom(roomId) {
        try {
            const rooms = (window.QAMAR && window.QAMAR.ROOMS) ? window.QAMAR.ROOMS : {};
            const room = rooms[roomId];
            if (!room) return;

            const iconEl = document.getElementById('room-icon');
            const titleEl = document.getElementById('room-title');
            if (iconEl) iconEl.textContent = room.icon || '🌍';
            if (titleEl) titleEl.textContent = room.name || roomId;
        } catch (e) {}
    }

    // إنشاء سجل المستخدم في Firebase إن لم يكن موجوداً
    function _ensureUserRecord(authResult) {
        return Promise.resolve().then(function () {
            const uid = authResult.uid;
            if (!uid) return null;
            if (!window.QamarFB) return null;

            return window.QamarFB.get('users/' + uid).then(function (existing) {
                const now = window.QamarFB.serverTime();
                const isGuest = !!authResult.isGuest;
                const u = window.QamarAuth.getCurrentUser() || {};
                const fallbackName = 'زائر-' + uid.substring(0, 4);

                if (existing) {
                    const updates = {};
                    updates['users/' + uid + '/lastSeen'] = now;
                    if (isGuest) updates['users/' + uid + '/isGuest'] = true;
                    return window.QamarFB.multiUpdate(updates).then(function () {
                        _syncSession(existing);
                        return existing;
                    }).catch(function (e) {
                        Logger.debug('update existing user failed:', e.message);
                        _syncSession(existing);
                        return existing;
                    });
                }

                const name = u.displayName || (isGuest ? fallbackName : 'عضو جديد');
                const code = _generateCode(name, uid);

                const payload = {
                    uid: uid,
                    name: name,
                    code: code,
                    avatar: null,
                    bio: '',
                    rank: 'User',
                    rankLevel: 50,
                    isGuest: isGuest,
                    isEmailUser: !isGuest,
                    email: u.email || null,
                    createdAt: now,
                    lastSeen: now,
                    currentRoom: null,
                    isBanned: false,
                    isJailed: false
                };

                const updates = {};
                updates['users/' + uid] = payload;
                updates['user_names/' + name] = uid;
                updates['user_codes/' + code] = uid;

                return window.QamarFB.multiUpdate(updates).then(function () {
                    _syncSession(payload);
                    return payload;
                }).catch(function (e) {
                    Logger.debug('create user record failed:', e.message);
                    _syncSession(payload);
                    return payload;
                });
            });
        }).catch(function (e) {
            Logger.warn('ensureUserRecord:', e.message);
            return null;
        });
    }

    function _generateCode(name, uid) {
        if (window.generateUserCode) {
            try { return window.generateUserCode(name, uid); } catch (e) {}
        }
        const clean = (name || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const prefix = clean.substring(0, 2) || 'U' + Math.floor(Math.random() * 9 + 1);
        let hash = 5381;
        const src = String(uid || Date.now());
        for (let i = 0; i < src.length; i++) {
            hash = ((hash * 33) ^ src.charCodeAt(i)) >>> 0;
        }
        return prefix + '·' + hash.toString(36).toUpperCase().padStart(3, '0').slice(-3);
    }

    function _syncSession(userData) {
        if (!userData) return;
        try {
            if (window.QamarSession && window.QamarSession.saveSession) {
                window.QamarSession.saveSession();
            }
            if (window.AppState && window.AppState.setUser) {
                window.AppState.setUser(userData, !!userData.isGuest);
            }
        } catch (e) {}
    }

    /* ══════════════════════════════════════════════ */
    /* Show / Hide                                     */
    /* ══════════════════════════════════════════════ */
    function _showApp() {
        const login = document.getElementById('login-screen');
        const app = document.getElementById('main-app');
        if (login) {
            login.style.transition = 'opacity 0.3s ease';
            login.style.opacity = '0';
            setTimeout(function () {
                if (login) login.classList.add('hidden');
            }, 300);
        }
        if (app) {
            app.classList.remove('hidden');
            app.style.opacity = '0';
            app.style.transition = 'opacity 0.3s ease';
            setTimeout(function () { app.style.opacity = '1'; }, 50);
        }

        if (window.QamarBoot && typeof window.QamarBoot.hideLoader === 'function') {
            try { window.QamarBoot.hideLoader(); } catch (e) {}
        }

        _setBusy(false);
        _emit('login-flow:success', {});
        Logger.info('🎉 App shown — user logged in');
    }

    function _showLogin() {
        const login = document.getElementById('login-screen');
        const app = document.getElementById('main-app');
        if (app) app.classList.add('hidden');
        if (login) {
            login.classList.remove('hidden');
            login.style.opacity = '1';
        }
        _setBusy(false);
        _hideError();
    }

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onLoginEvent(cb) {
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
    /* Bind DOM                                        */
    /* ══════════════════════════════════════════════ */
    function _findEls() {
        State.els = {
            loginScreen: document.getElementById('login-screen'),
            mainApp: document.getElementById('main-app'),
            error: document.getElementById('ls-error'),
            guestBtn: document.getElementById('ls-guest-btn'),
            loginBtn: document.getElementById('ls-login-btn'),
            registerBtn: document.getElementById('ls-register-btn'),
            forgotBtn: document.getElementById('ls-forgot-btn'),
            email: document.getElementById('ls-email'),
            password: document.getElementById('ls-password'),
            regEmail: document.getElementById('ls-reg-email'),
            regPassword: document.getElementById('ls-reg-password'),
            regName: document.getElementById('ls-reg-name')
        };
    }

    function _bindActions() {
        if (State.els.guestBtn) {
            State.els.guestBtn.addEventListener('click', function (e) {
                e.preventDefault(); _doGuest();
            });
        }
        if (State.els.loginBtn) {
            State.els.loginBtn.addEventListener('click', function (e) {
                e.preventDefault(); _doLogin();
            });
        }
        if (State.els.registerBtn) {
            State.els.registerBtn.addEventListener('click', function (e) {
                e.preventDefault(); _doRegister();
            });
        }
        if (State.els.forgotBtn) {
            State.els.forgotBtn.addEventListener('click', function (e) {
                e.preventDefault(); _doForgot();
            });
        }

        [State.els.email, State.els.password].forEach(function (el) {
            if (el) el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); _doLogin(); }
            });
        });
        [State.els.regEmail, State.els.regPassword, State.els.regName].forEach(function (el) {
            if (el) el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); _doRegister(); }
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Auth state watcher                              */
    /* ══════════════════════════════════════════════ */
    function _watchAuth() {
        if (!window.QamarAuth || !window.QamarAuth.onAuthChange) return;
        window.QamarAuth.onAuthChange(function (payload) {
            if (payload && payload.isLoggedIn) {
                const login = document.getElementById('login-screen');
                if (login && !login.classList.contains('hidden')) {
                    _showApp();
                    setTimeout(function () { _autoEnterRoom(); }, CONFIG.AUTO_START_DELAY_MS);
                }
            } else {
                _showLogin();
            }
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function init() {
        if (State._initialized) return true;
        _findEls();

        if (!State.els.guestBtn) {
            Logger.warn('login-screen not found — will retry');
            return false;
        }

        _bindTabs();
        _bindActions();
        _watchAuth();

        State._initialized = true;
        Logger.info('📦 [login-flow.js v2.2] initialized');
        return true;
    }

    function _autoInit() {
        if (!init()) setTimeout(_autoInit, 800);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(_autoInit, 500);
        });
    } else {
        setTimeout(_autoInit, 500);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarLoginFlow = {
        __v22: true,
        init: init,
        switchTab: switchTab,
        signInAsGuest: _doGuest,
        signIn: _doLogin,
        register: _doRegister,
        forgotPassword: _doForgot,
        showApp: _showApp,
        showLogin: _showLogin,
        enterRoom: _autoEnterRoom,
        onLoginEvent: onLoginEvent,
        getStatus: function () {
            return {
                initialized: State._initialized,
                busy: State.busy,
                hasGuestBtn: !!State.els.guestBtn,
                hasLoginBtn: !!State.els.loginBtn,
                hasRegisterBtn: !!State.els.registerBtn,
                defaultRoom: CONFIG.DEFAULT_ROOM
            };
        }
    };

    Logger.info('📦 [login-flow.js v2.2] loaded — no Firebase writes');
})();
