// ==============================================
// security/bans.js
// User ban management (temp + permanent)
// ==============================================
// يعتمد على: firebase.js + auth.js + ranks.js + audit.js + device-guard.js
// يعطي: window.QamarBans
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [bans] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[BAN]';
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
        MIN_BAN_LEVEL: 90,               // 90+ فقط يمكنه الحظر
        MIN_UNBAN_LEVEL: 90,             // 90+ يمكنه إلغاء الحظر
        MIN_REASON_LENGTH: 3,
        MAX_REASON_LENGTH: 200,
        // مدد جاهزة (بالملّي ثانية) — المنفذ يختار
        DURATIONS: {
            '1h':   1 * 60 * 60 * 1000,
            '6h':   6 * 60 * 60 * 1000,
            '1d':  24 * 60 * 60 * 1000,
            '3d':   3 * 24 * 60 * 60 * 1000,
            '1w':   7 * 24 * 60 * 60 * 1000,
            '1m':  30 * 24 * 60 * 60 * 1000
        }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        listeners: [],
        cache: {}   // { uid: { banInfo, at } }
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onBanEvent(cb) {
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

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) {
            return window.QamarRanks.myLevel();
        }
        return 0;
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _canBan() {
        if (_isKing()) return true;
        return _myLevel() >= CONFIG.MIN_BAN_LEVEL;
    }

    function _canUnban() {
        if (_isKing()) return true;
        return _myLevel() >= CONFIG.MIN_UNBAN_LEVEL;
    }

    /* ══════════════════════════════════════════════ */
    /* Resolve duration                                */
    /* ══════════════════════════════════════════════ */
    function _resolveDuration(duration) {
        if (typeof duration === 'number' && duration > 0) {
            return duration;  // ms مباشرة
        }
        if (typeof duration === 'string' && CONFIG.DURATIONS[duration]) {
            return CONFIG.DURATIONS[duration];
        }
        return null;
    }

    /* ══════════════════════════════════════════════ */
    /* Check ban                                       */
    /* ══════════════════════════════════════════════ */
    function checkUserBan(uid) {
        if (!uid) return Promise.resolve({ banned: false });
        return window.QamarFB.get('users/' + uid)
            .then(function (data) {
                if (!data) return { banned: false };
                return _evaluateBan(data, uid);
            })
            .catch(function (e) {
                Logger.warn('checkUserBan error:', e.message);
                return { banned: false };
            });
    }

    function _evaluateBan(userData, uid) {
        if (!userData.isBanned) return { banned: false };

        // حظر دائم
        if (userData.permanentBan === true) {
            return {
                banned: true,
                permanent: true,
                reason: userData.banReason || '—',
                bannedAt: userData.bannedAt || null,
                bannedBy: userData.bannedBy || null,
                bannedByName: userData.bannedByName || null
            };
        }

        // حظر مؤقت
        const until = Number(userData.bannedUntil) || 0;
        if (until > 0 && Date.now() < until) {
            return {
                banned: true,
                permanent: false,
                until: until,
                remainingMs: until - Date.now(),
                reason: userData.banReason || '—',
                bannedAt: userData.bannedAt || null,
                bannedBy: userData.bannedBy || null,
                bannedByName: userData.bannedByName || null
            };
        }

        // انتهى الحظر المؤقت — نظّفه (background)
        _autoCleanupExpired(uid);
        return { banned: false, expired: true };
    }

    function isBanned(uid) {
        return checkUserBan(uid).then(function (r) { return r.banned; });
    }

    function getBanInfo(uid) {
        if (!uid) return Promise.resolve(null);
        // كاش
        const c = State.cache[uid];
        if (c && Date.now() - c.at < 30000) {
            return Promise.resolve(c.banInfo);
        }
        return checkUserBan(uid).then(function (r) {
            State.cache[uid] = { banInfo: r, at: Date.now() };
            return r.banned ? r : null;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Auto cleanup expired bans                       */
    /* ══════════════════════════════════════════════ */
    function _autoCleanupExpired(uid) {
        const updates = {};
        updates['users/' + uid + '/isBanned'] = false;
        updates['users/' + uid + '/bannedUntil'] = null;
        updates['users/' + uid + '/banReason'] = null;
        updates['users/' + uid + '/bannedBy'] = null;
        updates['users/' + uid + '/bannedByName'] = null;
        updates['users/' + uid + '/bannedAt'] = null;
        window.QamarFB.multiUpdate(updates).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Notifications                                   */
    /* ══════════════════════════════════════════════ */
    function _notifyUser(uid, banInfo, permanent) {
        if (!uid) return Promise.resolve();
        const payload = {
            type: 'ban',
            permanent: permanent,
            reason: banInfo.reason,
            until: permanent ? null : banInfo.until,
            byName: banInfo.bannedByName || '—',
            at: window.QamarFB.serverTime(),
            read: false
        };
        return window.QamarFB.push('user_notifications/' + uid, payload)
            .catch(function (e) { Logger.warn('notify user failed:', e.message); });
    }

    function _notifyKing(banInfo, targetUid, permanent) {
        // اقرأ king_uid
        return window.QamarFB.get('config/king_uid').then(function (kingUid) {
            if (!kingUid || kingUid === _getCurrentUid()) return null;
            const payload = {
                from: _getCurrentUid(),
                fromName: _getCurrentName(),
                type: permanent ? 'ban_perm' : 'ban_temp',
                targetUid: targetUid,
                targetName: banInfo.targetName || '—',
                reason: banInfo.reason,
                until: permanent ? null : banInfo.until,
                at: window.QamarFB.serverTime(),
                read: false
            };
            return window.QamarFB.push('guardian_inbox/' + kingUid, payload);
        }).catch(function () { return null; });
    }

    /* ══════════════════════════════════════════════ */
    /* Kick — force signOut                            */
    /* ══════════════════════════════════════════════ */
    function _kickIfSelf(targetUid) {
        const currentUid = _getCurrentUid();
        if (currentUid !== targetUid) return false;

        // إذا كنت أنا المحظور → اخرج فوراً
        Logger.warn('🚫 You are banned — signing out now');
        if (window.QamarSession && window.QamarSession.clearSession) {
            try { window.QamarSession.clearSession(); } catch (e) {}
        }
        setTimeout(function () {
            if (window.QamarAuth && window.QamarAuth.signOut) {
                window.QamarAuth.signOut().catch(function () {});
            } else if (window.auth) {
                window.auth.signOut().catch(function () {});
            }
        }, 200);
        return true;
    }

    function kickIfBanned() {
        const uid = _getCurrentUid();
        if (!uid) return Promise.resolve({ kicked: false });
        return checkUserBan(uid).then(function (r) {
            if (r.banned) {
                _kickIfSelf(uid);
                return { kicked: true, banInfo: r };
            }
            return { kicked: false };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Ban user — temporary                            */
    /* ══════════════════════════════════════════════ */
    function banUser(targetUid, duration, reason, options) {
        options = options || {};

        return Promise.resolve().then(function () {
            // فحوصات
            if (!_canBan()) {
                throw new Error('غير مصرّح — تحتاج مستوى 90 أو الملك');
            }
            if (!targetUid) throw new Error('targetUid مطلوب');
            if (!reason || reason.trim().length < CONFIG.MIN_REASON_LENGTH) {
                throw new Error('السبب مطلوب (3 أحرف على الأقل)');
            }
            if (reason.length > CONFIG.MAX_REASON_LENGTH) {
                throw new Error('السبب طويل جداً (200 حرف كحد أقصى)');
            }

            const ms = _resolveDuration(duration);
            if (!ms || ms <= 0) {
                throw new Error('مدة الحظر غير صحيحة');
            }

            const currentUid = _getCurrentUid();
            if (targetUid === currentUid) throw new Error('لا يمكنك حظر نفسك');

            const until = Date.now() + ms;
            const reasonT = reason.trim();

            // اقرأ المستخدم الهدف
            return window.QamarFB.get('users/' + targetUid).then(function (target) {
                if (!target) throw new Error('المستخدم غير موجود');

                // حمايات
                if (target.rank === 'King') throw new Error('لا يمكن حظر الملك');
                if (!_isKing()) {
                    const targetLvl = Number(target.rankLevel) || 0;
                    if (targetLvl >= _myLevel()) {
                        throw new Error('لا يمكنك حظر من هو بنفس رتبتك أو أعلى');
                    }
                }

                const updates = {};
                updates['users/' + targetUid + '/isBanned'] = true;
                updates['users/' + targetUid + '/bannedUntil'] = until;
                updates['users/' + targetUid + '/permanentBan'] = false;
                updates['users/' + targetUid + '/banReason'] = reasonT;
                updates['users/' + targetUid + '/bannedBy'] = currentUid;
                updates['users/' + targetUid + '/bannedByName'] = _getCurrentName();
                updates['users/' + targetUid + '/bannedAt'] = window.QamarFB.serverTime();

                return window.QamarFB.multiUpdate(updates).then(function () {
                    const banInfo = {
                        reason: reasonT,
                        until: until,
                        bannedBy: currentUid,
                        bannedByName: _getCurrentName(),
                        targetName: target.name || '—'
                    };

                    // سجّل في audit
                    if (window.QamarAudit) {
                        window.QamarAudit.log('banTemp', {
                            targetUid: targetUid,
                            targetName: target.name,
                            reason: reasonT,
                            duration: ms,
                            details: { until: until }
                        });
                    }

                    // إشعارات
                    _notifyUser(targetUid, banInfo, false);
                    _notifyKing(banInfo, targetUid, false);

                    // طرد فوري إذا كان الهدف = أنا (مستحيل هنا — تحققنا مسبقاً)
                    // لكن نجدد الجلسة إذا كان الهدف موجوداً في نفس الجلسة
                    // (في حالة التبويبات المتعددة → signOut موزّع)
                    if (typeof BroadcastChannel !== 'undefined') {
                        try {
                            const bc = new BroadcastChannel('qamar_ban');
                            bc.postMessage({ type: 'ban', uid: targetUid, until: until });
                            bc.close();
                        } catch (e) {}
                    }

                    _emit('ban:added', { uid: targetUid, permanent: false, until: until });
                    Logger.info('🚫 Temp ban:', targetUid.substring(0, 8), 'for', ms + 'ms');
                    return { ok: true, uid: targetUid, until: until, duration: ms };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Ban user — permanent                            */
    /* ══════════════════════════════════════════════ */
    function permanentBan(targetUid, reason, options) {
        options = options || {};
        const autoBanDevice = options.autoBanDevice !== false;  // افتراضي: نعم

        return Promise.resolve().then(function () {
            if (!_canBan()) {
                throw new Error('غير مصرّح — تحتاج مستوى 90 أو الملك');
            }
            if (!targetUid) throw new Error('targetUid مطلوب');
            if (!reason || reason.trim().length < CONFIG.MIN_REASON_LENGTH) {
                throw new Error('السبب مطلوب (3 أحرف على الأقل)');
            }
            if (reason.length > CONFIG.MAX_REASON_LENGTH) {
                throw new Error('السبب طويل جداً');
            }

            const currentUid = _getCurrentUid();
            if (targetUid === currentUid) throw new Error('لا يمكنك حظر نفسك');

            const reasonT = reason.trim();

            return window.QamarFB.get('users/' + targetUid).then(function (target) {
                if (!target) throw new Error('المستخدم غير موجود');
                if (target.rank === 'King') throw new Error('لا يمكن حظر الملك');
                if (!_isKing()) {
                    const targetLvl = Number(target.rankLevel) || 0;
                    if (targetLvl >= _myLevel()) {
                        throw new Error('لا يمكنك حظر من هو بنفس رتبتك أو أعلى');
                    }
                }

                const updates = {};
                updates['users/' + targetUid + '/isBanned'] = true;
                updates['users/' + targetUid + '/permanentBan'] = true;
                updates['users/' + targetUid + '/bannedUntil'] = null;
                updates['users/' + targetUid + '/banReason'] = reasonT;
                updates['users/' + targetUid + '/bannedBy'] = currentUid;
                updates['users/' + targetUid + '/bannedByName'] = _getCurrentName();
                updates['users/' + targetUid + '/bannedAt'] = window.QamarFB.serverTime();

                return window.QamarFB.multiUpdate(updates).then(function () {
                    const banInfo = {
                        reason: reasonT,
                        bannedBy: currentUid,
                        bannedByName: _getCurrentName(),
                        targetName: target.name || '—'
                    };

                    // سجّل في audit
                    if (window.QamarAudit) {
                        window.QamarAudit.log('banPerm', {
                            targetUid: targetUid,
                            targetName: target.name,
                            reason: reasonT
                        });
                    }

                    // إشعارات
                    _notifyUser(targetUid, banInfo, true);
                    _notifyKing(banInfo, targetUid, true);

                    // حظر الجهاز تلقائياً
                    let devicePromise = Promise.resolve({ skipped: true });
                    if (autoBanDevice && window.QamarDeviceGuard) {
                        // اجلب أجهزة المستخدم
                        devicePromise = window.QamarFB.get('device_registry')
                            .then(function (all) {
                                if (!all) return { devices: [] };
                                const deviceIds = [];
                                Object.keys(all).forEach(function (deviceId) {
                                    if (all[deviceId] && all[deviceId][targetUid]) {
                                        deviceIds.push(deviceId);
                                    }
                                });
                                return { devices: deviceIds };
                            })
                            .then(function (r) {
                                if (!r.devices || r.devices.length === 0) {
                                    return { banned: 0 };
                                }
                                const updates2 = {};
                                r.devices.forEach(function (deviceId) {
                                    updates2['banned_devices/' + deviceId] = {
                                        uid: targetUid,
                                        name: target.name || '—',
                                        reason: 'حظر دائم: ' + reasonT,
                                        by: currentUid,
                                        byName: _getCurrentName(),
                                        at: window.QamarFB.serverTime(),
                                        auto: true
                                    };
                                });
                                return window.QamarFB.multiUpdate(updates2).then(function () {
                                    Logger.info('🚫 Auto-banned', r.devices.length, 'device(s)');
                                    // سجّل في audit
                                    if (window.QamarAudit) {
                                        window.QamarAudit.log('banDevice', {
                                            targetUid: targetUid,
                                            targetName: target.name,
                                            reason: 'تلقائي بعد حظر دائم',
                                            amount: r.devices.length,
                                            details: { deviceIds: r.devices }
                                        });
                                    }
                                    return { banned: r.devices.length };
                                });
                            })
                            .catch(function (e) {
                                Logger.warn('auto-ban device failed:', e.message);
                                return { error: e.message };
                            });
                    }

                    return devicePromise.then(function (devResult) {
                        _emit('ban:added', { uid: targetUid, permanent: true, deviceBanned: devResult });
                        Logger.info('🚫 Permanent ban:', targetUid.substring(0, 8));
                        return {
                            ok: true,
                            uid: targetUid,
                            permanent: true,
                            deviceBanned: devResult && devResult.banned ? devResult.banned : 0
                        };
                    });
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Unban                                           */
    /* ══════════════════════════════════════════════ */
    function unbanUser(targetUid, options) {
        options = options || {};
        const alsoDevice = options.alsoDevice !== false;  // افتراضي: نعم

        return Promise.resolve().then(function () {
            if (!_canUnban()) {
                throw new Error('غير مصرّح — تحتاج مستوى 90 أو الملك');
            }
            if (!targetUid) throw new Error('targetUid مطلوب');

            return window.QamarFB.get('users/' + targetUid).then(function (target) {
                if (!target) throw new Error('المستخدم غير موجود');
                if (!target.isBanned) throw new Error('هذا المستخدم غير محظور');

                const updates = {};
                updates['users/' + targetUid + '/isBanned'] = false;
                updates['users/' + targetUid + '/bannedUntil'] = null;
                updates['users/' + targetUid + '/permanentBan'] = false;
                updates['users/' + targetUid + '/banReason'] = null;
                updates['users/' + targetUid + '/bannedBy'] = null;
                updates['users/' + targetUid + '/bannedByName'] = null;
                updates['users/' + targetUid + '/bannedAt'] = null;

                return window.QamarFB.multiUpdate(updates).then(function () {
                    // إلغاء حظر الأجهزة أيضاً
                    let devicePromise = Promise.resolve({ unbanned: 0 });
                    if (alsoDevice && window.QamarDeviceGuard) {
                        devicePromise = window.QamarFB.get('device_registry')
                            .then(function (all) {
                                if (!all) return [];
                                const ids = [];
                                Object.keys(all).forEach(function (deviceId) {
                                    if (all[deviceId] && all[deviceId][targetUid]) {
                                        ids.push(deviceId);
                                    }
                                });
                                return ids;
                            })
                            .then(function (ids) {
                                if (ids.length === 0) return { unbanned: 0 };
                                const up2 = {};
                                ids.forEach(function (id) {
                                    up2['banned_devices/' + id] = null;
                                });
                                return window.QamarFB.multiUpdate(up2).then(function () {
                                    return { unbanned: ids.length };
                                });
                            })
                            .catch(function () { return { unbanned: 0 }; });
                    }

                    // سجّل في audit
                    if (window.QamarAudit) {
                        window.QamarAudit.log('unban', {
                            targetUid: targetUid,
                            targetName: target.name
                        });
                    }

                    return devicePromise.then(function (devResult) {
                        State.cache[targetUid] = null;
                        delete State.cache[targetUid];
                        _emit('ban:removed', { uid: targetUid });
                        Logger.info('✅ Unbanned:', targetUid.substring(0, 8));
                        return {
                            ok: true,
                            uid: targetUid,
                            deviceUnbanned: devResult.unbanned || 0
                        };
                    });
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* List banned                                     */
    /* ══════════════════════════════════════════════ */
    function listBanned(options) {
        options = options || {};
        if (!_canUnban() && !_isKing()) {
            return Promise.reject(new Error('غير مصرّح'));
        }

        return window.QamarFB.children('users').then(function (users) {
            if (!users) return [];
            const list = [];
            const now = Date.now();
            Object.keys(users).forEach(function (uid) {
                const u = users[uid];
                if (!u || !u.isBanned) return;
                const permanent = u.permanentBan === true;
                const until = Number(u.bannedUntil) || 0;
                // تجاهل المنتهية
                if (!permanent && until > 0 && until < now) return;

                list.push({
                    uid: uid,
                    name: u.name || '—',
                    avatar: u.avatar || null,
                    rank: u.rank || 'User',
                    permanent: permanent,
                    until: until,
                    reason: u.banReason || '—',
                    bannedBy: u.bannedBy || null,
                    bannedByName: u.bannedByName || '—',
                    bannedAt: u.bannedAt || null
                });
            });
            list.sort(function (a, b) { return (b.bannedAt || 0) - (a.bannedAt || 0); });
            return list;
        }).catch(function (e) {
            Logger.warn('listBanned error:', e.message);
            return [];
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Cleanup expired (background / manual)           */
    /* ══════════════════════════════════════════════ */
    function cleanupExpired() {
        return window.QamarFB.children('users').then(function (users) {
            if (!users) return { cleaned: 0 };
            const now = Date.now();
            const updates = {};
            let cleaned = 0;
            Object.keys(users).forEach(function (uid) {
                const u = users[uid];
                if (!u || !u.isBanned) return;
                if (u.permanentBan === true) return;
                const until = Number(u.bannedUntil) || 0;
                if (until > 0 && until < now) {
                    updates['users/' + uid + '/isBanned'] = false;
                    updates['users/' + uid + '/bannedUntil'] = null;
                    updates['users/' + uid + '/banReason'] = null;
                    updates['users/' + uid + '/bannedBy'] = null;
                    updates['users/' + uid + '/bannedByName'] = null;
                    updates['users/' + uid + '/bannedAt'] = null;
                    cleaned++;
                }
            });
            if (cleaned === 0) return { cleaned: 0 };
            return window.QamarFB.multiUpdate(updates).then(function () {
                Logger.info('🧹 Cleaned', cleaned, 'expired bans');
                return { cleaned: cleaned };
            });
        }).catch(function () { return { cleaned: 0 }; });
    }

    /* ══════════════════════════════════════════════ */
    /* Listen to own ban (broadcast channel)           */
    /* ══════════════════════════════════════════════ */
    function _startBanWatcher() {
        if (typeof BroadcastChannel === 'undefined') return;
        try {
            const bc = new BroadcastChannel('qamar_ban');
            bc.onmessage = function (ev) {
                const data = ev.data || {};
                if (data.type === 'ban' && data.uid === _getCurrentUid()) {
                    Logger.warn('🚫 Received ban broadcast — signing out');
                    _kickIfSelf(data.uid);
                }
            };
        } catch (e) {}
    }

    /* ══════════════════════════════════════════════ */
    /* Hook into auth changes                          */
    /* ══════════════════════════════════════════════ */
    function _hookAuth() {
        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (payload) {
                if (payload.isLoggedIn && payload.uid) {
                    setTimeout(function () {
                        kickIfBanned().then(function (r) {
                            if (r.kicked) Logger.warn('Kicked banned user on login');
                        });
                    }, 800);
                }
            });
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Debug                                           */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            canBan: _canBan(),
            canUnban: _canUnban(),
            myLevel: _myLevel(),
            isKing: _isKing(),
            cacheSize: Object.keys(State.cache).length,
            durations: Object.keys(CONFIG.DURATIONS)
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        _hookAuth();
        _startBanWatcher();
        // نظّف المنتهية بعد 30 ثانية
        setTimeout(function () { cleanupExpired().catch(function () {}); }, 30000);
        Logger.info('📦 [bans.js] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 1000);
        });
    } else {
        setTimeout(_init, 4000);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarBans = {
        // Config
        CONFIG: CONFIG,

        // Write
        banUser: banUser,
        permanentBan: permanentBan,
        unbanUser: unbanUser,

        // Read
        checkUserBan: checkUserBan,
        getBanInfo: getBanInfo,
        isBanned: isBanned,
        listBanned: listBanned,

        // Kick
        kickIfBanned: kickIfBanned,

        // Cleanup
        cleanupExpired: cleanupExpired,

        // Events
        onBanEvent: onBanEvent,

        // Debug
        getStatus: getStatus
    };

    window.QamarBans = QamarBans;

    Logger.info('📦 [bans.js] loaded | durations:', Object.keys(CONFIG.DURATIONS).join(', '));
})();
