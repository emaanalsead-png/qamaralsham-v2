// ==============================================
// security/device-guard.js v2.1
// Device identification + Multi-account detection
// ==============================================
// يعتمد على: firebase.js + auth.js + ranks.js
// يعطي: window.QamarDeviceGuard
// ==============================================
// ✅ v2.1: ينتظر auth + الملك/المسجل فقط
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [device-guard] firebase.js not loaded!');
        return;
    }

    if (window.QamarDeviceGuard && window.QamarDeviceGuard.__v21) return;

    const LOG_TAG = '[DG]';
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
        UUID_KEY: 'qamar_device_uuid',
        UUID_COOKIE: 'qamar_uuid',
        COOKIE_DAYS: 5 * 365,
        IP_SERVICE: 'https://ipwho.is/',
        IP_TIMEOUT_MS: 6000,
        AUDIO_TIMEOUT_MS: 2500
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        uuid: null,
        deviceId: null,
        fingerprint: { canvas: null, audio: null, hardware: null },
        ipInfo: null,
        ipHash: null,
        ready: false,
        readyPromise: null,
        listeners: [],
        banned: false,
        banInfo: null,
        notified: false,
        _permDenied: false
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onDeviceEvent(cb) {
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
    function _getCookie(name) {
        try {
            const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
            return match ? decodeURIComponent(match[1]) : null;
        } catch (e) { return null; }
    }

    function _setCookie(name, value, days) {
        try {
            const expires = new Date(Date.now() + days * 86400000).toUTCString();
            document.cookie = name + '=' + encodeURIComponent(value) +
                '; expires=' + expires + '; path=/; SameSite=Lax';
            return true;
        } catch (e) { return false; }
    }

    function _generateUUID() {
        try {
            if (window.crypto && window.crypto.randomUUID) {
                return window.crypto.randomUUID();
            }
            if (window.crypto && window.crypto.getRandomValues) {
                const arr = new Uint8Array(16);
                window.crypto.getRandomValues(arr);
                return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
            }
        } catch (e) {}
        return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    }

    function _getOrCreateUUID() {
        let uuid = null;
        try { uuid = localStorage.getItem(CONFIG.UUID_KEY); } catch (e) {}
        if (!uuid) uuid = _getCookie(CONFIG.UUID_COOKIE);
        if (!uuid) uuid = _generateUUID();
        try { localStorage.setItem(CONFIG.UUID_KEY, uuid); } catch (e) {}
        _setCookie(CONFIG.UUID_COOKIE, uuid, CONFIG.COOKIE_DAYS);
        return uuid;
    }

    function _sha256(str) {
        if (!str) return Promise.resolve(null);
        if (window.crypto && window.crypto.subtle && window.TextEncoder) {
            try {
                const buf = new TextEncoder().encode(String(str));
                return window.crypto.subtle.digest('SHA-256', buf).then(function (hash) {
                    return Array.from(new Uint8Array(hash))
                        .map(function (b) { return b.toString(16).padStart(2, '0'); })
                        .join('');
                }).catch(function () { return _simpleHash(str); });
            } catch (e) {
                return Promise.resolve(_simpleHash(str));
            }
        }
        return Promise.resolve(_simpleHash(str));
    }

    function _simpleHash(str) {
        let h = 5381;
        const s = String(str);
        for (let i = 0; i < s.length; i++) {
            h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        }
        let h2 = 5381;
        for (let i = s.length - 1; i >= 0; i--) {
            h2 = ((h2 * 33) ^ s.charCodeAt(i)) >>> 0;
        }
        return h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
    }

    function _canvasRaw() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 220;
            canvas.height = 40;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.font = '14px "Arial"';
            ctx.fillText('🌙 Qamar,الشام', 2, 15);
            ctx.fillStyle = 'rgba(102,204,0,0.7)';
            ctx.fillText('🌙 Qamar,الشام', 4, 17);
            ctx.beginPath();
            ctx.arc(50, 25, 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,100,50,0.5)';
            ctx.fill();
            return canvas.toDataURL();
        } catch (e) {
            return null;
        }
    }

    function _audioRaw() {
        return new Promise(function (resolve) {
            try {
                const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                if (!AC) { resolve(null); return; }
                const ctx = new AC(1, 44100, 44100);
                const osc = ctx.createOscillator();
                osc.type = 'triangle';
                osc.frequency.value = 10000;
                const comp = ctx.createDynamicsCompressor();
                comp.threshold.value = -50;
                comp.knee.value = 40;
                comp.ratio.value = 12;
                comp.attack.value = 0;
                comp.release.value = 0.25;
                osc.connect(comp);
                comp.connect(ctx.destination);
                osc.start(0);
                let resolved = false;
                const timer = setTimeout(function () {
                    if (!resolved) { resolved = true; resolve(null); }
                }, CONFIG.AUDIO_TIMEOUT_MS);
                ctx.startRendering().then(function (buffer) {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timer);
                    try {
                        const data = buffer.getChannelData(0);
                        let sum = 0;
                        for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]);
                        resolve(sum.toFixed(6));
                    } catch (e) { resolve(null); }
                }).catch(function () {
                    if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); }
                });
            } catch (e) {
                resolve(null);
            }
        });
    }

    function _hardwareRaw() {
        const parts = [];
        try { parts.push('cores=' + (navigator.hardwareConcurrency || 0)); } catch (e) {}
        try { parts.push('platform=' + (navigator.platform || 'x')); } catch (e) {}
        try { parts.push('touch=' + (navigator.maxTouchPoints || 0)); } catch (e) {}
        return parts.join('|');
    }

    function _fetchIP() {
        return new Promise(function (resolve) {
            if (!window.fetch) { resolve(null); return; }
            let done = false;
            const timer = setTimeout(function () {
                if (!done) { done = true; resolve(null); }
            }, CONFIG.IP_TIMEOUT_MS);
            try {
                const controller = (window.AbortController) ? new AbortController() : null;
                const opts = controller ? { signal: controller.signal } : {};
                fetch(CONFIG.IP_SERVICE, opts)
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (done) return;
                        done = true;
                        clearTimeout(timer);
                        resolve(data || null);
                    })
                    .catch(function () {
                        if (done) return;
                        done = true;
                        clearTimeout(timer);
                        resolve(null);
                    });
            } catch (e) {
                if (!done) { done = true; clearTimeout(timer); resolve(null); }
            }
        });
    }

    function _computeDeviceId() {
        const c = State.fingerprint.canvas || 'no-canvas';
        const a = State.fingerprint.audio || 'no-audio';
        const h = State.fingerprint.hardware || 'no-hw';
        const raw = 'canvas:' + c + '|audio:' + a + '|hw:' + h;
        return _sha256(raw);
    }

    function _sanitizeKey(s) {
        return String(s || '')
            .replace(/[.#$/\[\]\s]+/g, '_')
            .substring(0, 60);
    }

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
            if (window.QamarAuth && window.QamarAuth.getDisplayName) {
                const dn = window.QamarAuth.getDisplayName();
                if (dn) return dn;
            }
        } catch (e) {}
        return null;
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    // ⭐ v2.1: هل نحن مؤهلون للكتابة في Firebase؟
    function _canRegister() {
        if (!window.auth || !window.auth.currentUser) return false;
        if (State._permDenied) return false;
        // الزوار لا يسجّلون أجهزة (تجنب spam)
        const u = window.auth.currentUser;
        if (u.isAnonymous) return false;
        return true;
    }

    /* ══════════════════════════════════════════════ */
    /* Main init                                       */
    /* ══════════════════════════════════════════════ */
    function initDevice() {
        if (State.ready) return Promise.resolve(State);
        if (State.readyPromise) return State.readyPromise;
        State.readyPromise = _doInit();
        return State.readyPromise;
    }

    function _doInit() {
        Logger.info('🔍 Initializing...');
        State.uuid = _getOrCreateUUID();

        const canvasRaw = _canvasRaw();
        return Promise.all([
            canvasRaw ? _sha256(canvasRaw) : Promise.resolve(null),
            _audioRaw().then(function (a) { return a ? _sha256(a) : null; }),
            _sha256(_hardwareRaw())
        ]).then(function (results) {
            State.fingerprint.canvas = results[0];
            State.fingerprint.audio = results[1];
            State.fingerprint.hardware = results[2];
            return _computeDeviceId();
        }).then(function (deviceId) {
            State.deviceId = deviceId;
            Logger.info('✅ Device ID:', deviceId.substring(0, 12) + '...');

            _fetchIP().then(function (info) {
                State.ipInfo = info;
                if (info && info.ip) {
                    _sha256(info.ip).then(function (h) { State.ipHash = h; });
                }
            });

            const authWait = (window.QamarAuth && window.QamarAuth.waitForAuth)
                ? window.QamarAuth.waitForAuth(5000)
                : Promise.resolve();
            return authWait;
        }).then(function () {
            // ⭐ v2.1: إذا لا مستخدم مسجل → لا نكتب
            if (!_canRegister()) {
                State.ready = true;
                Logger.info('✅ Device guard ready (no-user, no-write)');
                _emit('device:ready', { registered: false, reason: 'no-user' });
                return State;
            }
            return checkBan();
        }).then(function (banResult) {
            if (banResult && banResult.banned) {
                State.ready = true;
                _emit('device:ready', { banned: true, banInfo: banResult.info });
                return State;
            }
            if (!_canRegister()) return State;
            return registerDevice();
        }).then(function () {
            if (!_canRegister()) return State;
            return checkNotification();
        }).then(function () {
            State.ready = true;
            Logger.info('✅ Device guard ready');
            _emit('device:ready', { banned: false });
            return State;
        }).catch(function (e) {
            Logger.warn('init failed:', e.message);
            State.ready = true;
            _emit('device:ready', { banned: false, error: e.message });
            return State;
        });
    }

    function checkBan() {
        if (!State.deviceId) return Promise.resolve({ banned: false });
        if (!_canRegister()) return Promise.resolve({ banned: false });
        return window.QamarFB.get('banned_devices/' + State.deviceId)
            .then(function (ban) {
                if (ban) {
                    State.banned = true;
                    State.banInfo = ban;
                    Logger.warn('🚫 Device BANNED');
                    _emit('device:banned', ban);
                    if (window.QamarAuth && window.QamarAuth.signOut) {
                        setTimeout(function () {
                            window.QamarAuth.signOut().catch(function () {});
                        }, 500);
                    }
                    return { banned: true, info: ban };
                }
                return { banned: false };
            })
            .catch(function () {
                return { banned: false };
            });
    }

    function registerDevice() {
        const uid = _getCurrentUid();
        if (!uid || !State.deviceId) return Promise.resolve({ registered: false });
        if (!_canRegister()) return Promise.resolve({ registered: false, reason: 'not-eligible' });

        const name = _getCurrentName() || '—';
        const now = window.QamarFB.serverTime();

        const updates = {};
        updates['device_registry/' + State.deviceId + '/' + uid] = {
            name: name,
            at: now,
            uuid: State.uuid
        };

        if (State.ipHash) {
            updates['device_ip_map/' + State.ipHash + '/uids/' + uid] = { name: name, at: now };
            updates['ip_registry/' + State.ipHash + '/' + uid] = {
                name: name,
                at: now,
                ip: (State.ipInfo && State.ipInfo.ip) ? State.ipInfo.ip : null
            };
        }

        return window.QamarFB.multiUpdate(updates)
            .then(function () {
                Logger.debug('✅ Device registered');
                return { registered: true };
            })
            .catch(function (e) {
                const msg = (e && e.message) || '';
                // ⭐ v2.1: permission_denied → أوقف كل المحاولات
                if (msg.indexOf('permission') !== -1 || msg.indexOf('PERMISSION') !== -1) {
                    State._permDenied = true;
                    Logger.info('🔒 Device registration disabled (permission denied)');
                } else {
                    Logger.warn('registerDevice error:', msg);
                }
                return { registered: false, error: msg };
            });
    }

    function checkNotification() {
        const uid = _getCurrentUid();
        const name = _getCurrentName();
        if (!uid || !State.deviceId || !name) {
            return Promise.resolve({ notified: false, reason: 'missing' });
        }
        if (!_canRegister()) return Promise.resolve({ notified: false, reason: 'not-eligible' });

        const key = _sanitizeKey(name) + '__' + State.deviceId.substring(0, 16);

        return window.QamarFB.get('bot_data/device_seen/' + key)
            .then(function (existing) {
                if (existing) return { notified: false, alreadySent: true };

                const payload = {
                    uid: uid, name: name,
                    deviceId: State.deviceId,
                    ip: (State.ipInfo && State.ipInfo.ip) ? State.ipInfo.ip : null,
                    ipHash: State.ipHash || null,
                    at: window.QamarFB.serverTime(),
                    status: 'pending',
                    type: 'new_device_name'
                };

                const updates = {};
                updates['multi_account_alerts/' + key] = payload;
                updates['bot_data/device_seen/' + key] = window.QamarFB.serverTime();

                return window.QamarFB.multiUpdate(updates).then(function () {
                    State.notified = true;
                    Logger.info('📢 Notification sent to King');
                    _emit('device:multiAccount', payload);
                    return { notified: true, payload: payload };
                });
            })
            .catch(function () {
                return { notified: false };
            });
    }

    function banDevice(deviceId, targetUid, targetName, reason) {
        if (!_isKing()) return Promise.reject(new Error('فقط الملك يمكنه حظر الأجهزة'));
        if (!deviceId) return Promise.reject(new Error('deviceId مطلوب'));

        const payload = {
            uid: targetUid || null,
            by: _getCurrentUid(),
            byName: _getCurrentName() || '—',
            name: targetName || '—',
            reason: reason || '—',
            at: window.QamarFB.serverTime()
        };

        return window.QamarFB.set('banned_devices/' + deviceId, payload)
            .then(function () {
                _emit('device:banAdded', { deviceId: deviceId, payload: payload });
                return { ok: true, deviceId: deviceId };
            });
    }

    function unbanDevice(deviceId) {
        if (!_isKing()) return Promise.reject(new Error('فقط الملك'));
        if (!deviceId) return Promise.reject(new Error('deviceId مطلوب'));
        return window.QamarFB.remove('banned_devices/' + deviceId)
            .then(function () {
                _emit('device:banRemoved', { deviceId: deviceId });
                return { ok: true, deviceId: deviceId };
            });
    }

    function listBannedDevices() {
        if (!_isKing()) return Promise.reject(new Error('فقط الملك'));
        return window.QamarFB.children('banned_devices')
            .then(function (data) {
                if (!data) return [];
                return Object.keys(data).map(function (deviceId) {
                    return Object.assign({ deviceId: deviceId }, data[deviceId]);
                }).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
            })
            .catch(function () { return []; });
    }

    function getDeviceId() { return State.deviceId; }
    function getUUID() { return State.uuid; }
    function isReady() { return State.ready; }
    function isBanned() { return State.banned; }
    function getBanInfo() { return State.banInfo; }

    function getDeviceInfo() {
        return {
            deviceId: State.deviceId,
            uuid: State.uuid,
            fingerprint: {
                canvas: State.fingerprint.canvas,
                audio: State.fingerprint.audio,
                hardware: State.fingerprint.hardware
            },
            ipInfo: State.ipInfo,
            ipHash: State.ipHash,
            ready: State.ready,
            banned: State.banned,
            banInfo: State.banInfo
        };
    }

    function waitReady(timeoutMs) {
        timeoutMs = timeoutMs || 8000;
        if (State.ready) return Promise.resolve(State);
        if (!State.readyPromise) initDevice();
        return Promise.race([
            State.readyPromise,
            new Promise(function (resolve) {
                setTimeout(function () { resolve(State); }, timeoutMs);
            })
        ]);
    }

    function getStatus() {
        return {
            ready: State.ready,
            deviceId: State.deviceId ? State.deviceId.substring(0, 16) + '...' : null,
            uuid: State.uuid ? State.uuid.substring(0, 12) + '...' : null,
            banned: State.banned,
            notified: State.notified,
            permDenied: State._permDenied,
            canRegister: _canRegister()
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarDeviceGuard = {
        __v21: true,
        init: initDevice,
        waitReady: waitReady,
        isReady: isReady,
        getDeviceId: getDeviceId,
        getUUID: getUUID,
        getDeviceInfo: getDeviceInfo,
        isBanned: isBanned,
        getBanInfo: getBanInfo,
        checkBan: checkBan,
        registerDevice: registerDevice,
        checkNotification: checkNotification,
        banDevice: banDevice,
        unbanDevice: unbanDevice,
        listBannedDevices: listBannedDevices,
        onDeviceEvent: onDeviceEvent,
        getStatus: getStatus
    };

    Logger.info('📦 [device-guard.js v2.1] loaded — auth-wait + user-only');

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(function () {
                initDevice().catch(function (e) {
                    Logger.warn('auto init failed:', e.message);
                });
            }, 500);
        });
    } else {
        setTimeout(function () {
            initDevice().catch(function (e) {
                Logger.warn('auto init failed:', e.message);
            });
        }, 3000);
    }
})();
