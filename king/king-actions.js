// ==============================================
// king/king-actions.js
// 15 King actions + permission gates
// ==============================================
// يعتمد على: firebase.js + state.js + auth.js + ranks.js + audit.js + bans.js + rooms.js
// يعطي: window.QamarKingActions
// ==============================================
// ⚡ تحسينات السرعة (نت ضعيف):
//   1. _fetchFields — يقرأ فقط الحقول المطلوبة (متوازية)
//   2. cache محلي 30 ثانية لكل مستخدم
//   3. إزالة Promise chains الزائدة
//   4. لا listener على Firebase — فقط once
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [king-actions] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[KA]';
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
        KING_LEVEL: 100,
        ROYAL_LEVEL: 90,
        PERMANENT_BAN_MS: 365 * 24 * 60 * 60 * 1000,
        MAX_JAIL_MINUTES: 120,
        MAX_BAN_HOURS: 24 * 7,
        MIN_REASON_LENGTH: 2,
        MAX_REASON_LENGTH: 200,
        WARNINGS_BEFORE_JAIL: 3,
        AUTO_JAIL_ON_WARN_EXCEEDED_MIN: 5,
        CACHE_TTL_MS: 30 * 1000
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        listeners: [],
        targetCache: {},        // { uid: { data, at } }
        _initialized: false
    };

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _getCurrentUid() {
        if (window.QamarAuth && window.QamarAuth.getUid) return window.QamarAuth.getUid();
        return window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;
    }

    function _getCurrentUser() {
        try {
            if (window.AppState && window.AppState.user) return window.AppState.user;
            if (window.QamarSession && window.QamarSession.getData) return window.QamarSession.getData();
        } catch (e) {}
        return null;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        const u = _getCurrentUser();
        return u ? Number(u.rankLevel) || 0 : 0;
    }

    function _isKing100() { return _myLevel() >= CONFIG.KING_LEVEL; }

    function _myName() {
        const u = _getCurrentUser();
        return u && u.name ? u.name : '—';
    }

    function _reasonClean(reason) {
        if (!reason) return '';
        return String(reason).trim().substring(0, CONFIG.MAX_REASON_LENGTH);
    }

    function _requireReason(reason, label) {
        const r = _reasonClean(reason);
        if (!r || r.length < CONFIG.MIN_REASON_LENGTH) {
            throw new Error((label || 'السبب') + ' مطلوب (' + CONFIG.MIN_REASON_LENGTH + ' أحرف على الأقل)');
        }
        return r;
    }

    function _emit(name, payload) {
        if (window.EventBus) {
            try { window.EventBus.emit(name, payload); } catch (e) {}
        }
        State.listeners.slice().forEach(function (cb) {
            try { cb({ type: name, data: payload }); } catch (e) {}
        });
    }

    function _toast(msg, icon) {
        if (window.showToast) { try { window.showToast(icon || 'fa-info-circle', msg); return; } catch (e) {} }
        Logger.info(msg);
    }

    function _notifyBot(kind, targetUid, targetName, options) {
        if (!window.QamarBotCommands || typeof window.QamarBotCommands.notify !== 'function') {
            return Promise.resolve();
        }
        return window.QamarBotCommands.notify(kind, {
            uid: targetUid, name: targetName
        }, Object.assign({ byName: _myName() }, options || {})).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* ⭐ التحسين 1+2: cache + قراءة حقول محددة        */
    /* ══════════════════════════════════════════════ */
    function _cacheGet(uid) {
        const c = State.targetCache[uid];
        if (!c) return null;
        if (Date.now() - c.at > CONFIG.CACHE_TTL_MS) {
            delete State.targetCache[uid];
            return null;
        }
        return c.data;
    }

    function _cacheSet(uid, data) {
        State.targetCache[uid] = { data: data, at: Date.now() };
    }

    function _cacheClear(uid) {
        if (uid) delete State.targetCache[uid];
        else State.targetCache = {};
    }

    // ⭐ قراءة حقول محددة فقط (بدل النود كامل)
    function _fetchFields(uid, fields, skipCache) {
        if (!uid) return Promise.reject(new Error('uid مطلوب'));
        if (!Array.isArray(fields) || !fields.length) return Promise.reject(new Error('fields مطلوبة'));

        // فحص الـ cache
        if (!skipCache) {
            const cached = _cacheGet(uid);
            if (cached) {
                let allPresent = true;
                for (let i = 0; i < fields.length; i++) {
                    if (!(fields[i] in cached)) { allPresent = false; break; }
                }
                if (allPresent) {
                    const out = { uid: uid };
                    fields.forEach(function (f) { out[f] = cached[f]; });
                    return Promise.resolve(out);
                }
            }
        }

        // قراءة متوازية
        return Promise.all(fields.map(function (f) {
            return window.QamarFB.get('users/' + uid + '/' + f)
                .then(function (v) { return { f: f, v: v }; })
                .catch(function () { return { f: f, v: null }; });
        })).then(function (results) {
            const out = { uid: uid };
            let any = false;
            results.forEach(function (r) {
                out[r.f] = r.v;
                if (r.v !== null && r.v !== undefined) any = true;
            });
            if (!any) throw new Error('المستخدم غير موجود');

            // حدّث الـ cache
            const cached = _cacheGet(uid) || {};
            Object.assign(cached, out);
            _cacheSet(uid, cached);

            return out;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Permission gates                                */
    /* ══════════════════════════════════════════════ */
    function canDo(permKey) {
        if (_isKing100()) return true;
        if (window.QamarRanks && typeof window.QamarRanks.hasPermission === 'function') {
            return window.QamarRanks.hasPermission(permKey);
        }
        return false;
    }

    function canActOn(targetUid, targetLevel) {
        if (!targetUid) return { ok: false, reason: 'uid مطلوب' };
        if (targetUid === _getCurrentUid()) return { ok: false, reason: 'لا يمكنك التصرف على نفسك' };

        const my = _myLevel();
        const tgt = Number(targetLevel) || 0;

        if (_isKing100()) {
            if (tgt >= CONFIG.KING_LEVEL) return { ok: false, reason: 'لا يمكنك التصرف على الملك' };
            return { ok: true };
        }
        if (tgt >= my) return { ok: false, reason: 'الهدف بنفس مستواك أو أعلى' };
        return { ok: true };
    }

    /* ══════════════════════════════════════════════ */
    /* ⭐ helper: خفيف + cache                         */
    /* ══════════════════════════════════════════════ */
    function _getTargetSummary(uid) {
        return _fetchFields(uid, ['name', 'rank', 'rankLevel']);
    }

    /* ══════════════════════════════════════════════ */
    /* 1. Promote                                      */
    /* ══════════════════════════════════════════════ */
    function promote(uid, newRank) {
        if (!canDo('canPromote')) return Promise.reject(new Error('لا تملك صلاحية الترقية'));
        if (!uid || !newRank) return Promise.reject(new Error('بيانات ناقصة'));
        if (!window.QamarRanks || typeof window.QamarRanks.promote !== 'function') {
            return Promise.reject(new Error('ranks.promote غير متاح'));
        }

        return _getTargetSummary(uid).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            return window.QamarRanks.promote(uid, newRank).then(function () {
                _cacheClear(uid);
                _notifyBot('promote', uid, target.name, {
                    newRank: newRank, oldRank: target.rank
                });
                _emit('king:promoted', { uid: uid, newRank: newRank });
                return { ok: true, uid: uid, newRank: newRank, oldRank: target.rank };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 2. Demote                                       */
    /* ══════════════════════════════════════════════ */
    function demote(uid, newRank) {
        if (!canDo('canDemote')) return Promise.reject(new Error('لا تملك صلاحية التخفيض'));
        if (!uid || !newRank) return Promise.reject(new Error('بيانات ناقصة'));
        if (!window.QamarRanks || typeof window.QamarRanks.demote !== 'function') {
            return Promise.reject(new Error('ranks.demote غير متاح'));
        }

        return _getTargetSummary(uid).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            return window.QamarRanks.demote(uid, newRank).then(function () {
                _cacheClear(uid);
                _notifyBot('demote', uid, target.name, {
                    newRank: newRank, oldRank: target.rank
                });
                _emit('king:demoted', { uid: uid, newRank: newRank });
                return { ok: true, uid: uid, newRank: newRank, oldRank: target.rank };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 3. Warn                                         */
    /* ══════════════════════════════════════════════ */
    function warn(uid, reason) {
        if (!canDo('canWarn')) return Promise.reject(new Error('لا تملك صلاحية التحذير'));
        const r = _reasonClean(reason) || 'تحذير إداري';

        return _fetchFields(uid, ['name', 'rank', 'rankLevel', 'warnings']).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            const current = Number(target.warnings) || 0;
            const newCount = current + 1;
            const now = window.QamarFB.serverTime();

            return window.QamarFB.transaction('users/' + uid + '/warnings', function (c) {
                return (Number(c) || 0) + 1;
            }).then(function (trx) {
                const realCount = trx && trx.snapshot ? trx.snapshot : newCount;

                const updates = {};
                updates['users/' + uid + '/lastWarnAt'] = now;
                updates['users/' + uid + '/lastWarnBy'] = _getCurrentUid();
                updates['users/' + uid + '/lastWarnReason'] = r;
                window.QamarFB.multiUpdate(updates).catch(function () {});

                _cacheClear(uid);

                if (window.QamarAudit) {
                    window.QamarAudit.log('warn', {
                        targetUid: uid, targetName: target.name, reason: r
                    });
                }
                _notifyBot('punish', uid, target.name, {
                    punishment: 'تحذير', reason: r
                });
                _emit('king:warned', { uid: uid, count: realCount });

                if (realCount >= CONFIG.WARNINGS_BEFORE_JAIL) {
                    return jail(uid, CONFIG.AUTO_JAIL_ON_WARN_EXCEEDED_MIN,
                        'تجاوز ' + CONFIG.WARNINGS_BEFORE_JAIL + ' تحذيرات')
                        .catch(function () {})
                        .then(function () {
                            return { ok: true, uid: uid, count: realCount, autoJailed: true };
                        });
                }
                return { ok: true, uid: uid, count: realCount };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 4. Jail                                         */
    /* ══════════════════════════════════════════════ */
    function jail(uid, minutes, reason) {
        if (!canDo('canJail')) return Promise.reject(new Error('لا تملك صلاحية السجن'));
        const m = Number(minutes);
        if (!m || m < 1) return Promise.reject(new Error('المدة غير صحيحة'));
        if (m > CONFIG.MAX_JAIL_MINUTES) return Promise.reject(new Error('الحد الأقصى ' + CONFIG.MAX_JAIL_MINUTES + ' دقيقة'));
        const r = _reasonClean(reason) || 'سجن إداري';

        return _fetchFields(uid, ['name', 'rankLevel', 'jailCount', 'currentRoom']).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            const now = Date.now();
            const jailUntil = now + m * 60 * 1000;
            const curRoom = target.currentRoom || (window.AppState && window.AppState.currentRoom) || 'general';

            const updates = {};
            updates['users/' + uid + '/isJailed'] = true;
            updates['users/' + uid + '/jailUntil'] = jailUntil;
            updates['users/' + uid + '/jailReason'] = r;
            updates['users/' + uid + '/lastJailAt'] = now;
            updates['users/' + uid + '/jailCount'] = (Number(target.jailCount) || 0) + 1;

            if (curRoom && curRoom !== 'jail') {
                updates['users/' + uid + '/lastRoomBeforeJail'] = curRoom;
            }

            updates['user_presence/' + uid + '/state'] = 'online';
            updates['user_presence/' + uid + '/room'] = 'jail';
            updates['user_presence/' + uid + '/forced'] = true;
            updates['user_presence/' + uid + '/lastChanged'] = now;
            updates['user_presence/' + uid + '/forcedReason'] = 'jail';

            return window.QamarFB.multiUpdate(updates).then(function () {
                _cacheClear(uid);
                if (window.QamarAudit) {
                    window.QamarAudit.log('jail', {
                        targetUid: uid, targetName: target.name,
                        reason: r, duration: m * 60 * 1000
                    });
                }
                _notifyBot('punish', uid, target.name, {
                    punishment: 'سجن ' + m + ' دقيقة', reason: r
                });
                _emit('king:jailed', { uid: uid, minutes: m });
                return { ok: true, uid: uid, minutes: m, until: jailUntil };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 5. Release                                      */
    /* ══════════════════════════════════════════════ */
    function release(uid) {
        if (!canDo('canJail')) return Promise.reject(new Error('لا تملك صلاحية الإفراج'));

        return _fetchFields(uid, ['name', 'isJailed', 'lastRoomBeforeJail']).then(function (target) {
            if (!target.isJailed) throw new Error('هذا المستخدم ليس مسجوناً');

            const now = Date.now();
            const lastRoom = target.lastRoomBeforeJail || 'general';

            const updates = {};
            updates['users/' + uid + '/isJailed'] = false;
            updates['users/' + uid + '/jailUntil'] = 0;
            updates['users/' + uid + '/jailReleasedAt'] = now;
            updates['users/' + uid + '/lastRoomBeforeJail'] = null;

            updates['user_presence/' + uid + '/room'] = lastRoom;
            updates['user_presence/' + uid + '/forced'] = true;
            updates['user_presence/' + uid + '/lastChanged'] = now;
            updates['user_presence/' + uid + '/forcedReason'] = 'jail_release';

            return window.QamarFB.multiUpdate(updates).then(function () {
                _cacheClear(uid);
                if (window.QamarAudit) {
                    window.QamarAudit.log('unjail', {
                        targetUid: uid, targetName: target.name, reason: 'إفراج إداري'
                    });
                }
                _emit('king:released', { uid: uid });
                return { ok: true, uid: uid, backTo: lastRoom };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 6. Ban temporary                                */
    /* ══════════════════════════════════════════════ */
    function banTemp(uid, hours, reason) {
        if (!canDo('canBan')) return Promise.reject(new Error('لا تملك صلاحية الحظر'));
        const h = Number(hours);
        if (!h || h < 1) return Promise.reject(new Error('المدة غير صحيحة'));
        if (h > CONFIG.MAX_BAN_HOURS) return Promise.reject(new Error('الحد الأقصى ' + CONFIG.MAX_BAN_HOURS + ' ساعة'));
        const r = _requireReason(reason, 'سبب الحظر');

        return _getTargetSummary(uid).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            if (!window.QamarBans || typeof window.QamarBans.banUser !== 'function') {
                throw new Error('bans.js غير متاح');
            }

            return window.QamarBans.banUser(uid, h * 60 * 60 * 1000, r).then(function () {
                _cacheClear(uid);
                _notifyBot('ban', uid, target.name, { reason: r });
                _emit('king:banned', { uid: uid, hours: h });
                return { ok: true, uid: uid, hours: h };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 7. Ban permanent                                */
    /* ══════════════════════════════════════════════ */
    function banPerm(uid, reason, options) {
        options = options || {};
        if (!canDo('canBan')) return Promise.reject(new Error('لا تملك صلاحية الحظر'));
        const r = _requireReason(reason, 'سبب الحظر');

        return _getTargetSummary(uid).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            if (!window.QamarBans || typeof window.QamarBans.permanentBan !== 'function') {
                throw new Error('bans.js غير متاح');
            }

            return window.QamarBans.permanentBan(uid, r, {
                autoBanDevice: options.autoBanDevice !== false
            }).then(function (res) {
                _cacheClear(uid);
                _notifyBot('ban', uid, target.name, { reason: r, extra: 'حظر دائم' });
                _emit('king:permBanned', { uid: uid, deviceBanned: res.deviceBanned || 0 });
                return { ok: true, uid: uid, deviceBanned: res.deviceBanned || 0 };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 8. Unban                                        */
    /* ══════════════════════════════════════════════ */
    function unban(uid) {
        if (!canDo('canUnban')) return Promise.reject(new Error('لا تملك صلاحية إلغاء الحظر'));
        if (!uid) return Promise.reject(new Error('uid مطلوب'));
        if (!window.QamarBans || typeof window.QamarBans.unbanUser !== 'function') {
            return Promise.reject(new Error('bans.js غير متاح'));
        }
        return window.QamarBans.unbanUser(uid).then(function (res) {
            _cacheClear(uid);
            _emit('king:unbanned', { uid: uid });
            return { ok: true, uid: uid, deviceUnbanned: res.deviceUnbanned || 0 };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 9. Kick from room                               */
    /* ══════════════════════════════════════════════ */
    function kickFromRoom(uid, roomId, reason) {
        if (!canDo('canKickFromRoom')) return Promise.reject(new Error('لا تملك صلاحية الطرد من الغرفة'));
        if (!uid || !roomId) return Promise.reject(new Error('بيانات ناقصة'));
        const r = _reasonClean(reason) || 'طرد إداري';

        return _getTargetSummary(uid).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            if (window.QamarRooms && typeof window.QamarRooms.kickFromRoom === 'function') {
                return window.QamarRooms.kickFromRoom(uid, roomId, r).then(function () {
                    _emit('king:kicked', { uid: uid, roomId: roomId });
                    return { ok: true, uid: uid, roomId: roomId };
                });
            }

            const now = window.QamarFB.serverTime();
            const updates = {};
            updates['room_kicks/' + roomId + '/' + uid] = {
                at: now, by: _getCurrentUid(), byName: _myName(), reason: r
            };
            return window.QamarFB.multiUpdate(updates).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('kick', {
                        targetUid: uid, targetName: target.name, roomId: roomId, reason: r
                    });
                }
                _emit('king:kicked', { uid: uid, roomId: roomId });
                return { ok: true, uid: uid, roomId: roomId };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 10. Mute global                                 */
    /* ══════════════════════════════════════════════ */
    function muteGlobal(uid, reason) {
        if (!canDo('canMuteGlobal')) return Promise.reject(new Error('لا تملك صلاحية الكتم الكامل'));
        if (!uid) return Promise.reject(new Error('uid مطلوب'));
        const r = _reasonClean(reason) || 'كتم إداري';

        return _getTargetSummary(uid).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            return window.QamarFB.set('users/' + uid + '/mutes/global', {
                at: window.QamarFB.serverTime(),
                by: _getCurrentUid(),
                byName: _myName(),
                reason: r
            }).then(function () {
                _cacheClear(uid);
                if (window.QamarAudit) {
                    window.QamarAudit.log('muteGlobal', {
                        targetUid: uid, targetName: target.name, reason: r
                    });
                }
                _notifyBot('punish', uid, target.name, {
                    punishment: 'كتم كامل', reason: r
                });
                _emit('king:mutedGlobal', { uid: uid });
                return { ok: true, uid: uid };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 11. Mute in room                                */
    /* ══════════════════════════════════════════════ */
    function muteInRoom(uid, roomId, reason) {
        if (!canDo('canMuteInRoom')) return Promise.reject(new Error('لا تملك صلاحية الكتم في الغرفة'));
        if (!uid || !roomId) return Promise.reject(new Error('بيانات ناقصة'));
        const r = _reasonClean(reason) || 'كتم إداري';

        return _getTargetSummary(uid).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            return window.QamarFB.set('users/' + uid + '/mutes/' + roomId, {
                at: window.QamarFB.serverTime(),
                by: _getCurrentUid(),
                byName: _myName(),
                reason: r
            }).then(function () {
                _cacheClear(uid);
                if (window.QamarAudit) {
                    window.QamarAudit.log('muteRoom', {
                        targetUid: uid, targetName: target.name, roomId: roomId, reason: r
                    });
                }
                _emit('king:mutedInRoom', { uid: uid, roomId: roomId });
                return { ok: true, uid: uid, roomId: roomId };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 12. Unmute                                      */
    /* ══════════════════════════════════════════════ */
    function unmute(uid, roomId) {
        if (!canDo('canMuteGlobal') && !canDo('canMuteInRoom')) {
            return Promise.reject(new Error('لا تملك صلاحية فك الكتم'));
        }
        if (!uid) return Promise.reject(new Error('uid مطلوب'));

        const path = roomId
            ? 'users/' + uid + '/mutes/' + roomId
            : 'users/' + uid + '/mutes/global';

        return window.QamarFB.remove(path).then(function () {
            _cacheClear(uid);
            if (window.QamarAudit) {
                window.QamarAudit.log('unmute', {
                    targetUid: uid, roomId: roomId || 'global'
                });
            }
            _emit('king:unmuted', { uid: uid, roomId: roomId || null });
            return { ok: true, uid: uid, roomId: roomId || null };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 13. Transfer                                    */
    /* ══════════════════════════════════════════════ */
    function transfer(uid, toRoomId, reason) {
        if (!canDo('canTransferUsers')) return Promise.reject(new Error('لا تملك صلاحية النقل'));
        if (!uid || !toRoomId) return Promise.reject(new Error('بيانات ناقصة'));
        const r = _reasonClean(reason) || 'نقل إداري';

        return _getTargetSummary(uid).then(function (target) {
            const check = canActOn(uid, target.rankLevel);
            if (!check.ok) throw new Error(check.reason);

            if (window.QamarRooms && typeof window.QamarRooms.forceMove === 'function') {
                return window.QamarRooms.forceMove(uid, toRoomId, r).then(function () {
                    _emit('king:transferred', { uid: uid, roomId: toRoomId });
                    return { ok: true, uid: uid, toRoomId: toRoomId };
                });
            }

            const now = Date.now();
            const updates = {};
            updates['user_presence/' + uid + '/state'] = 'online';
            updates['user_presence/' + uid + '/room'] = toRoomId;
            updates['user_presence/' + uid + '/forced'] = true;
            updates['user_presence/' + uid + '/lastChanged'] = now;
            updates['user_presence/' + uid + '/forcedReason'] = 'admin_transfer';
            updates['user_presence/' + uid + '/forcedBy'] = _getCurrentUid();

            return window.QamarFB.multiUpdate(updates).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('transfer', {
                        targetUid: uid, targetName: target.name, roomId: toRoomId, reason: r
                    });
                }
                _emit('king:transferred', { uid: uid, roomId: toRoomId });
                return { ok: true, uid: uid, toRoomId: toRoomId };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 14. Give points                                 */
    /* ══════════════════════════════════════════════ */
    function givePoints(uid, amount) {
        if (!canDo('canGivePoints')) return Promise.reject(new Error('لا تملك صلاحية إهداء النقاط'));
        const a = Number(amount);
        if (!a || a < 1) return Promise.reject(new Error('العدد غير صحيح'));
        if (a > 10000) return Promise.reject(new Error('الحد الأقصى 10000 نقطة'));
        if (!uid) return Promise.reject(new Error('uid مطلوب'));

        const isSelf = (uid === _getCurrentUid());
        if (isSelf && !_isKing100() && !canDo('canGiveSelfPoints')) {
            return Promise.reject(new Error('لا يمكنك إهداء نقاط لنفسك'));
        }

        // ⚡ للأهداف غير نفسنا: نجلب rankLevel فقط
        const pre = isSelf
            ? Promise.resolve({ uid: uid, name: _myName(), rankLevel: _myLevel() })
            : _fetchFields(uid, ['name', 'rankLevel']);

        return pre.then(function (target) {
            if (!isSelf) {
                const check = canActOn(uid, target.rankLevel);
                if (!check.ok) throw new Error(check.reason);
            }

            return window.QamarFB.transaction('bot_data/quiz/scores/' + uid, function (c) {
                return (Number(c) || 0) + a;
            }).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('editSettings', {
                        targetUid: uid, targetName: target.name,
                        amount: a, reason: 'إهداء نقاط'
                    });
                }
                _notifyBot('reward', uid, target.name, { amount: a });
                _emit('king:pointsGiven', { uid: uid, amount: a });
                return { ok: true, uid: uid, amount: a };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 15. Delete account                              */
    /* ══════════════════════════════════════════════ */
    function deleteAccount(uid, options) {
        options = options || {};
        if (!_isKing100()) return Promise.reject(new Error('حذف الحساب للملك فقط'));

        return _fetchFields(uid, ['name', 'rankLevel', 'code']).then(function (target) {
            if (uid === _getCurrentUid()) throw new Error('لا يمكنك حذف حسابك');
            if (Number(target.rankLevel) >= CONFIG.KING_LEVEL) {
                throw new Error('لا يمكنك حذف حساب الملك');
            }

            return window.QamarFB.get('users/' + uid + '/devices')
                .catch(function () { return null; })
                .then(function (devices) {
                    const updates = {};
                    updates['users/' + uid] = null;
                    updates['user_presence/' + uid] = null;
                    if (target.name) updates['user_names/' + target.name] = null;
                    if (target.code) updates['user_codes/' + target.code] = null;

                    if (options.banDevices !== false && devices) {
                        Object.keys(devices).forEach(function (deviceId) {
                            updates['banned_devices/' + deviceId] = {
                                uid: uid,
                                name: target.name || '—',
                                reason: 'حذف حساب',
                                by: _getCurrentUid(),
                                byName: _myName(),
                                at: window.QamarFB.serverTime()
                            };
                        });
                    }

                    return window.QamarFB.multiUpdate(updates).then(function () {
                        _cacheClear(uid);
                        if (window.QamarAudit) {
                            window.QamarAudit.log('deletePM', {
                                targetUid: uid, targetName: target.name,
                                reason: 'حذف حساب نهائي'
                            });
                        }
                        _emit('king:accountDeleted', { uid: uid });
                        return { ok: true, uid: uid };
                    });
                });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Batch helper                                    */
    /* ══════════════════════════════════════════════ */
    function runAction(name, args) {
        args = args || [];
        const map = {
            promote: promote, demote: demote, warn: warn, jail: jail, release: release,
            banTemp: banTemp, banPerm: banPerm, unban: unban,
            kickFromRoom: kickFromRoom, muteGlobal: muteGlobal, muteInRoom: muteInRoom,
            unmute: unmute, transfer: transfer, givePoints: givePoints,
            deleteAccount: deleteAccount
        };
        const fn = map[name];
        if (!fn) return Promise.reject(new Error('أمر غير معروف: ' + name));
        return fn.apply(null, args);
    }

    /* ══════════════════════════════════════════════ */
    /* Status / Debug                                  */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            isKing100: _isKing100(),
            myLevel: _myLevel(),
            cacheSize: Object.keys(State.targetCache).length,
            permissions: {
                canPromote: canDo('canPromote'),
                canDemote: canDo('canDemote'),
                canWarn: canDo('canWarn'),
                canJail: canDo('canJail'),
                canBan: canDo('canBan'),
                canUnban: canDo('canUnban'),
                canKickFromRoom: canDo('canKickFromRoom'),
                canMuteGlobal: canDo('canMuteGlobal'),
                canMuteInRoom: canDo('canMuteInRoom'),
                canTransferUsers: canDo('canTransferUsers'),
                canGivePoints: canDo('canGivePoints')
            }
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarKingActions = {
        CONFIG: CONFIG,
        canDo: canDo,
        canActOn: canActOn,
        promote: promote, demote: demote, warn: warn, jail: jail, release: release,
        banTemp: banTemp, banPerm: banPerm, unban: unban,
        kickFromRoom: kickFromRoom, muteGlobal: muteGlobal, muteInRoom: muteInRoom,
        unmute: unmute, transfer: transfer, givePoints: givePoints,
        deleteAccount: deleteAccount,
        runAction: runAction,
        clearCache: _cacheClear,
        getStatus: getStatus
    };

    State._initialized = true;
    Logger.info('📦 [king-actions.js] loaded | 15 actions | cache', CONFIG.CACHE_TTL_MS + 'ms');
})();
