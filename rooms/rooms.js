// ==============================================
// rooms/rooms.js
// Room navigation + members + King room management
// ==============================================
// يعتمد على: firebase.js + constants.js + state.js + auth.js + ranks.js + chat.js
// يعطي: window.QamarRooms
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [rooms] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[RM]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.from ? 'array' : 'array')); }
    };
    // Fix the logger (bug above)
    Logger.warn = function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); };
    Logger.error = function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); };

    /* ══════════════════════════════════════════════ */
    /* Config                                          */
    /* ══════════════════════════════════════════════ */
    const CONFIG = {
        CUSTOM_ROOMS_PATH: 'custom_rooms',
        ROOM_MEMBERS_PATH: 'room_members',
        PRESENCE_PATH: 'user_presence',
        ROOM_MUTES_PATH: 'room_mutes',
        CACHE_TTL_MS: 30000
    };

    // الغرف الحصرية للملك (وأصحاب 90+ بصلاحية)
    const ROYAL_ONLY_ROOMS = ['royal', 'jail', 'bot_training'];

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        current: null,
        members: {},            // { roomId: { uid: {name, avatar, ...} } }
        memberCounts: {},       // { roomId: number }
        customRooms: {},        // غرف الملك الإضافية
        roomMutes: {},          // { roomId: boolean }
        cache: { rooms: null, at: 0 },
        listeners: [],
        watchers: {},           // { roomId: {handle} }
        _initialized: false
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onRoomEvent(cb) {
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

    function _isGuest() {
        if (window.QamarAuth && window.QamarAuth.isGuest) return window.QamarAuth.isGuest();
        return false;
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    function _hasPerm(key) {
        if (window.QamarRanks && window.QamarRanks.hasPermission) {
            return window.QamarRanks.hasPermission(key);
        }
        return false;
    }

    // صلاحية دخول الغرف الحصرية (royal, jail, bot_training)
    function _canEnterRoyalRooms() {
        if (_isKing()) return true;
        if (_myLevel() >= 90) {
            // الملك يمنح can_enter_royal يدوياً
            if (_hasPerm('can_enter_royal')) return true;
        }
        return false;
    }

    // الـ 90+ يستطيعون إضافة غرف؟
    function _canCreateRoom() {
        return _isKing();
    }

    /* ══════════════════════════════════════════════ */
    /* Load rooms — base + custom                      */
    /* ══════════════════════════════════════════════ */
    function _getBaseRooms() {
        return (window.QAMAR && window.QAMAR.ROOMS) ? window.QAMAR.ROOMS : {};
    }

    function _loadCustomRooms(force) {
        if (!force && State.cache.rooms && (Date.now() - State.cache.at) < CONFIG.CACHE_TTL_MS) {
            return Promise.resolve(State.customRooms);
        }
        return window.QamarFB.get(CONFIG.CUSTOM_ROOMS_PATH)
            .then(function (data) {
                State.customRooms = data || {};
                State.cache.rooms = State.customRooms;
                State.cache.at = Date.now();
                return State.customRooms;
            })
            .catch(function () {
                State.customRooms = {};
                return {};
            });
    }

    function _loadRoomMutes(force) {
        return window.QamarFB.get(CONFIG.ROOM_MUTES_PATH)
            .then(function (data) {
                State.roomMutes = data || {};
                return State.roomMutes;
            })
            .catch(function () { State.roomMutes = {}; return {}; });
    }

    function getAll() {
        const base = _getBaseRooms();
        const all = Object.assign({}, base);
        // دمج الغرف المخصصة
        Object.keys(State.customRooms).forEach(function (id) {
            if (!all[id]) all[id] = State.customRooms[id];
        });
        return all;
    }

    /* ══════════════════════════════════════════════ */
    /* Visibility                                      */
    /* ══════════════════════════════════════════════ */
    function _isRoomVisible(roomId, room) {
        if (!room) return false;
        // الملك يرى كل شيء
        if (_isKing()) return true;

        // غرف حصرية (royal, jail, bot_training)
        if (ROYAL_ONLY_ROOMS.indexOf(roomId) !== -1) {
            return _canEnterRoyalRooms();
        }

        // السجن: للمسجونين فقط
        if (roomId === 'jail') {
            const u = (window.AppState && window.AppState.user) || {};
            return u.isJailed === true;
        }

        // public / all → الجميع
        const vis = room.visibleTo || 'all';
        if (vis === 'all') return true;

        // royal → special
        if (vis === 'royal') return _canEnterRoyalRooms();

        // owner+
        if (vis === 'owner+') return _myLevel() >= 75;

        // grandowner+
        if (vis === 'grandowner+') return _myLevel() >= 80;

        // jailed
        if (vis === 'jailed') {
            const u = (window.AppState && window.AppState.user) || {};
            return u.isJailed === true;
        }

        // king
        if (vis === 'king') return _isKing();

        return false;
    }

    function listVisible() {
        const all = getAll();
        const out = [];
        Object.keys(all).forEach(function (roomId) {
            const room = all[roomId];
            if (!room) return;
            if (room.invisible && !_isKing()) return;   // غرف مخفية
            if (!_isRoomVisible(roomId, room)) return;

            out.push(Object.assign({}, room, {
                id: roomId,
                memberCount: State.memberCounts[roomId] || 0,
                muted: !!State.roomMutes[roomId],
                custom: !!State.customRooms[roomId]
            }));
        });
        // رتب: العامة أولاً ثم الخاصة
        out.sort(function (a, b) {
            const aP = a.type === 'public' ? 0 : 1;
            const bP = b.type === 'public' ? 0 : 1;
            return aP - bP;
        });
        return out;
    }

    function getById(roomId) {
        const all = getAll();
        const room = all[roomId];
        if (!room) return null;
        return Object.assign({}, room, {
            id: roomId,
            memberCount: State.memberCounts[roomId] || 0,
            muted: !!State.roomMutes[roomId]
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Check can enter                                 */
    /* ══════════════════════════════════════════════ */
    function canEnter(roomId) {
        return Promise.resolve().then(function () {
            if (!roomId) return { ok: false, reason: 'معرّف الغرفة مطلوب' };
            const room = getById(roomId);
            if (!room) return { ok: false, reason: 'الغرفة غير موجودة' };

            // 1) محظور من الغرفة (kick)
            const uid = _getCurrentUid();
            if (uid) {
                return window.QamarFB.exists('room_kicks/' + roomId + '/' + uid)
                    .then(function (kicked) {
                        if (kicked) return { ok: false, reason: 'أنت مطرود من هذه الغرفة' };

                        // 2) هل الغرفة مخفية؟
                        if (!_isRoomVisible(roomId, room)) {
                            return { ok: false, reason: 'لا تملك صلاحية دخول هذه الغرفة' };
                        }

                        // 3) هل الغرفة ممتلئة؟
                        const max = room.maxUsers;
                        if (max && max > 0) {
                            const current = State.memberCounts[roomId] || 0;
                            // استثناء: studio (max=1) — الملك يمكنه الدخول مع صاحبه
                            if (roomId === 'studio') {
                                if (current >= max && !_isKing()) {
                                    return { ok: false, reason: 'الاستوديو مشغول حالياً' };
                                }
                            } else if (current >= max) {
                                return { ok: false, reason: 'الغرفة ممتلئة' };
                            }
                        }

                        return { ok: true, room: room };
                    });
            }
            return { ok: true, room: room };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Enter room                                      */
    /* ══════════════════════════════════════════════ */
    function switchTo(roomId, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            if (!roomId) throw new Error('roomId مطلوب');

            const uid = _getCurrentUid();
            if (!uid) throw new Error('غير مسجل');

            // إذا نفس الغرفة → لا شيء
            if (State.current === roomId && !options.force) {
                return { ok: true, alreadyIn: true, roomId: roomId };
            }

            return canEnter(roomId).then(function (check) {
                if (!check.ok) {
                    _emit('room:denied', { roomId: roomId, reason: check.reason });
                    throw new Error(check.reason);
                }

                // اخرج من الغرفة السابقة
                return _leaveCurrent().then(function () {
                    return _enterRoom(roomId, uid);
                });
            });
        });
    }

    function _enterRoom(roomId, uid) {
        const now = window.QamarFB.serverTime();

        const updates = {};
        // presence
        updates['user_presence/' + uid + '/state'] = 'online';
        updates['user_presence/' + uid + '/room'] = roomId;
        updates['user_presence/' + uid + '/lastChanged'] = now;
        // room_members
        updates['room_members/' + roomId + '/' + uid] = {
            at: now,
            forced: false
        };
        // users/$uid/currentRoom
        updates['users/' + uid + '/currentRoom'] = roomId;
        updates['users/' + uid + '/lastSeen'] = now;

        return window.QamarFB.multiUpdate(updates).then(function () {
            State.current = roomId;

            // AppState
            if (window.AppState) {
                try { window.AppState.setRoom(roomId); } catch (e) {}
            }

            // localStorage
            try { localStorage.setItem('qamar_last_room', roomId); } catch (e) {}

            // Chat: signOut القديم + start الجديد
            if (window.QamarChat) {
                try { window.QamarChat.stop(); } catch (e) {}
                try { window.QamarChat.start(roomId); } catch (e) {}
            }

            // تتبع الأعضاء
            _watchMembers(roomId);

            Logger.info('✅ Entered room:', roomId);
            _emit('room:entered', { roomId: roomId });
            _emit('room:changed', { roomId: roomId });
            return { ok: true, roomId: roomId };
        });
    }

    function _leaveCurrent() {
        const uid = _getCurrentUid();
        const roomId = State.current;
        if (!uid || !roomId) return Promise.resolve();

        const updates = {};
        updates['room_members/' + roomId + '/' + uid] = null;
        updates['user_presence/' + uid + '/state'] = 'away';
        updates['user_presence/' + uid + '/lastChanged'] = window.QamarFB.serverTime();

        _unwatchMembers(roomId);

        return window.QamarFB.multiUpdate(updates).then(function () {
            _emit('room:left', { roomId: roomId });
        }).catch(function () {});
    }

    function leave() {
        return _leaveCurrent().then(function () {
            State.current = null;
            if (window.QamarChat) {
                try { window.QamarChat.stop(); } catch (e) {}
            }
            return { ok: true };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Watch members of room                           */
    /* ══════════════════════════════════════════════ */
    function _watchMembers(roomId) {
        if (State.watchers[roomId]) return;

        const handle = window.QamarFB.onValue('room_members/' + roomId, function (data) {
            State.members[roomId] = data || {};
            State.memberCounts[roomId] = Object.keys(State.members[roomId]).length;
            _emit('room:members', {
                roomId: roomId,
                members: State.members[roomId],
                count: State.memberCounts[roomId]
            });
        }, function () {});

        State.watchers[roomId] = handle;
    }

    function _unwatchMembers(roomId) {
        const h = State.watchers[roomId];
        if (h && h.off) {
            try { h.off(); } catch (e) {}
        }
        delete State.watchers[roomId];
    }

    function getMembers(roomId) {
        roomId = roomId || State.current;
        return State.members[roomId] || {};
    }

    function getMemberCount(roomId) {
        if (!roomId) return 0;
        return State.memberCounts[roomId] || 0;
    }

    function isInRoom(uid, roomId) {
        if (!uid || !roomId) return false;
        return !!((State.members[roomId] || {})[uid]);
    }

    /* ══════════════════════════════════════════════ */
    /* Force move (King / 80+)                         */
    /* ══════════════════════════════════════════════ */
    function forceMove(targetUid, roomId, reason) {
        return Promise.resolve().then(function () {
            if (!_isKing() && _myLevel() < 80) {
                throw new Error('غير مصرّح — تحتاج 80+ أو الملك');
            }
            if (!targetUid || !roomId) throw new Error('بيانات ناقصة');

            const now = window.QamarFB.serverTime();
            const updates = {};
            updates['user_presence/' + targetUid + '/state'] = 'online';
            updates['user_presence/' + targetUid + '/room'] = roomId;
            updates['user_presence/' + targetUid + '/forced'] = true;
            updates['user_presence/' + targetUid + '/lastChanged'] = now;
            updates['room_members/' + roomId + '/' + targetUid] = {
                at: now,
                forced: true,
                by: _getCurrentUid(),
                reason: reason || null
            };
            updates['users/' + targetUid + '/currentRoom'] = roomId;
            updates['users/' + targetUid + '/lastSeen'] = now;

            return window.QamarFB.multiUpdate(updates).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('transfer', {
                        targetUid: targetUid,
                        roomId: roomId,
                        reason: reason || '—'
                    });
                }
                _emit('room:forceMove', { uid: targetUid, roomId: roomId });
                return { ok: true };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Room kicks — طرد دائم من غرفة                   */
    /* ══════════════════════════════════════════════ */
    function kickFromRoom(targetUid, roomId, reason) {
        return Promise.resolve().then(function () {
            if (!_isKing() && _myLevel() < 65) {
                throw new Error('غير مصرّح');
            }
            if (!targetUid || !roomId) throw new Error('بيانات ناقصة');
            if (targetUid === _getCurrentUid()) throw new Error('لا يمكنك طرد نفسك');

            const now = window.QamarFB.serverTime();
            const updates = {};
            updates['room_kicks/' + roomId + '/' + targetUid] = {
                at: now,
                by: _getCurrentUid(),
                byName: (window.AppState && window.AppState.user && window.AppState.user.name) || '—',
                reason: reason || null
            };
            // إذا كان المستخدم في الغرفة → انقله لـ general
            const presence = State.members[roomId] || {};
            if (presence[targetUid]) {
                updates['user_presence/' + targetUid + '/room'] = 'general';
                updates['room_members/' + roomId + '/' + targetUid] = null;
                updates['room_members/general/' + targetUid] = {
                    at: now,
                    forced: true
                };
            }

            return window.QamarFB.multiUpdate(updates).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('kick', {
                        targetUid: targetUid,
                        roomId: roomId,
                        reason: reason || '—'
                    });
                }
                _emit('room:kicked', { uid: targetUid, roomId: roomId });
                return { ok: true };
            });
        });
    }

    function unkickFromRoom(targetUid, roomId) {
        return Promise.resolve().then(function () {
            if (!_isKing() && _myLevel() < 65) {
                throw new Error('غير مصرّح');
            }
            if (!targetUid || !roomId) throw new Error('بيانات ناقصة');

            return window.QamarFB.remove('room_kicks/' + roomId + '/' + targetUid)
                .then(function () {
                    _emit('room:unkicked', { uid: targetUid, roomId: roomId });
                    return { ok: true };
                });
        });
    }

    function listKicks(roomId) {
        return window.QamarFB.children('room_kicks/' + roomId)
            .then(function (data) {
                if (!data) return [];
                return Object.keys(data).map(function (uid) {
                    return Object.assign({ uid: uid }, data[uid]);
                }).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
            })
            .catch(function () { return []; });
    }

    /* ══════════════════════════════════════════════ */
    /* ═══ KING: Add custom room                    ═══ */
    /* ══════════════════════════════════════════════ */
    function addRoom(roomConfig) {
        return Promise.resolve().then(function () {
            if (!_canCreateRoom()) {
                throw new Error('فقط الملك يمكنه إضافة غرف');
            }

            const name = (roomConfig && roomConfig.name) || '';
            const icon = (roomConfig && roomConfig.icon) || '🌙';
            const type = (roomConfig && roomConfig.type) || 'public';
            const visibleTo = (roomConfig && roomConfig.visibleTo) || 'all';
            const micCount = (roomConfig && Number(roomConfig.micCount)) || 4;
            const maxUsers = roomConfig && roomConfig.maxUsers ? Number(roomConfig.maxUsers) : null;
            const allowMic = roomConfig && roomConfig.allowMic !== undefined ? !!roomConfig.allowMic : true;

            if (!name || name.length < 2) throw new Error('اسم الغرفة مطلوب (حرفان على الأقل)');
            if (name.length > 30) throw new Error('اسم الغرفة طويل جداً');

            // id من اسم لاتيني (slug) أو تلقائي
            let id = (roomConfig && roomConfig.id) || '';
            if (!id) {
                id = 'room_' + Date.now().toString(36);
            }
            // نظّف id
            id = String(id).replace(/[^a-zA-Z0-9_]/g, '').substring(0, 30);
            if (!id) id = 'room_' + Date.now().toString(36);

            // تحقق من عدم الوجود
            const all = getAll();
            if (all[id]) throw new Error('معرّف الغرفة مستخدم');

            const payload = {
                id: id,
                name: name,
                icon: icon,
                type: type,
                visibleTo: visibleTo,
                micCount: micCount,
                maxUsers: maxUsers,
                allowMic: allowMic,
                custom: true,
                createdBy: _getCurrentUid(),
                createdByName: (window.AppState && window.AppState.user && window.AppState.user.name) || '—',
                createdAt: window.QamarFB.serverTime()
            };

            return window.QamarFB.set(CONFIG.CUSTOM_ROOMS_PATH + '/' + id, payload)
                .then(function () {
                    State.customRooms[id] = payload;
                    State.cache.rooms = State.customRooms;
                    State.cache.at = Date.now();

                    if (window.QamarAudit) {
                        window.QamarAudit.log('createRoom', {
                            roomId: id,
                            details: { name: name, type: type }
                        });
                    }

                    _emit('room:created', { roomId: id, room: payload });
                    Logger.info('✅ Custom room added:', id);
                    return { ok: true, roomId: id, room: payload };
                });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* ═══ KING: Delete custom room                 ═══ */
    /* ══════════════════════════════════════════════ */
    function deleteRoom(roomId) {
        return Promise.resolve().then(function () {
            if (!_canCreateRoom()) {
                throw new Error('فقط الملك يمكنه حذف غرف');
            }
            if (!roomId) throw new Error('roomId مطلوب');

            // لا تحذف الغرف الأساسية
            const base = _getBaseRooms();
            if (base[roomId] && !State.customRooms[roomId]) {
                throw new Error('لا يمكن حذف غرفة أساسية — استخدم كتم الغرفة');
            }
            if (!State.customRooms[roomId]) {
                throw new Error('الغرفة غير موجودة أو ليست مخصصة');
            }

            const updates = {};
            updates[CONFIG.CUSTOM_ROOMS_PATH + '/' + roomId] = null;
            updates['room_members/' + roomId] = null;
            updates['room_messages/' + roomId] = null;
            updates['room_settings/' + roomId] = null;
            updates['room_kicks/' + roomId] = null;
            updates[CONFIG.ROOM_MUTES_PATH + '/' + roomId] = null;

            return window.QamarFB.multiUpdate(updates).then(function () {
                delete State.customRooms[roomId];
                State.cache.rooms = State.customRooms;
                State.cache.at = Date.now();

                if (State.current === roomId) {
                    State.current = null;
                }

                if (window.QamarAudit) {
                    window.QamarAudit.log('deleteRoom', { roomId: roomId });
                }

                _emit('room:deleted', { roomId: roomId });
                Logger.info('🗑️ Custom room deleted:', roomId);
                return { ok: true, roomId: roomId };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* ═══ KING: Mute / Unmute entire room          ═══ */
    /* ══════════════════════════════════════════════ */
    function muteRoom(roomId, reason) {
        return Promise.resolve().then(function () {
            if (!_isKing()) throw new Error('فقط الملك يمكنه كتم غرفة كاملة');
            if (!roomId) throw new Error('roomId مطلوب');

            const payload = {
                at: window.QamarFB.serverTime(),
                by: _getCurrentUid(),
                byName: (window.AppState && window.AppState.user && window.AppState.user.name) || '—',
                reason: reason || null
            };

            return window.QamarFB.set(CONFIG.ROOM_MUTES_PATH + '/' + roomId, payload)
                .then(function () {
                    State.roomMutes[roomId] = payload;

                    if (window.QamarAudit) {
                        window.QamarAudit.log('muteRoom', {
                            roomId: roomId,
                            reason: reason || '—'
                        });
                    }

                    _emit('room:muted', { roomId: roomId });
                    Logger.info('🔇 Room muted:', roomId);
                    return { ok: true, roomId: roomId };
                });
        });
    }

    function unmuteRoom(roomId) {
        return Promise.resolve().then(function () {
            if (!_isKing()) throw new Error('فقط الملك');
            if (!roomId) throw new Error('roomId مطلوب');

            return window.QamarFB.remove(CONFIG.ROOM_MUTES_PATH + '/' + roomId)
                .then(function () {
                    delete State.roomMutes[roomId];

                    if (window.QamarAudit) {
                        window.QamarAudit.log('unmute', { roomId: roomId });
                    }

                    _emit('room:unmuted', { roomId: roomId });
                    return { ok: true, roomId: roomId };
                });
        });
    }

    function isRoomMuted(roomId) {
        if (!roomId) return false;
        return !!State.roomMutes[roomId];
    }

    /* ══════════════════════════════════════════════ */
    /* Save / Restore last room                        */
    /* ══════════════════════════════════════════════ */
    function getLastRoom() {
        try {
            return localStorage.getItem('qamar_last_room') || null;
        } catch (e) { return null; }
    }

    function saveLastRoom(roomId) {
        try {
            if (roomId) localStorage.setItem('qamar_last_room', roomId);
        } catch (e) {}
    }

    function getCurrent() {
        return State.current || getLastRoom();
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;

        // حمّل بيانات أولية
        _loadCustomRooms(true);
        _loadRoomMutes(true);

        // راقب تسجيل الدخول
        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (p.isLoggedIn && p.uid) {
                    // حمّل الغرف المخصصة مرة أخرى
                    _loadCustomRooms(true);
                    _loadRoomMutes(true);
                    // سجّل في presence
                    const last = getLastRoom();
                    if (!last) {
                        // لا نجبر على الدخول — المستخدم يختار
                        Logger.debug('No last room — waiting for user selection');
                    }
                }
            });
        }

        Logger.info('📦 [rooms.js] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 1200);
        });
    } else {
        setTimeout(_init, 5000);
    }

    /* ══════════════════════════════════════════════ */
    /* Status / Debug                                  */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            current: State.current,
            visibleCount: listVisible().length,
            customCount: Object.keys(State.customRooms).length,
            watchedRooms: Object.keys(State.watchers),
            mutedRooms: Object.keys(State.roomMutes),
            isKing: _isKing(),
            myLevel: _myLevel(),
            canEnterRoyal: _canEnterRoyalRooms(),
            canCreate: _canCreateRoom()
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarRooms = {
        CONFIG: CONFIG,

        // Read
        getAll: getAll,
        listVisible: listVisible,
        getById: getById,
        getCurrent: getCurrent,
        canEnter: canEnter,

        // Enter / Leave
        switchTo: switchTo,
        leave: leave,

        // Members
        getMembers: getMembers,
        getMemberCount: getMemberCount,
        isInRoom: isInRoom,

        // Force / Kick
        forceMove: forceMove,
        kickFromRoom: kickFromRoom,
        unkickFromRoom: unkickFromRoom,
        listKicks: listKicks,

        // King: Custom rooms
        addRoom: addRoom,
        deleteRoom: deleteRoom,

        // King: Mute room
        muteRoom: muteRoom,
        unmuteRoom: unmuteRoom,
        isRoomMuted: isRoomMuted,

        // Last room
        getLastRoom: getLastRoom,
        saveLastRoom: saveLastRoom,

        // Reload
        reload: function () {
            return Promise.all([_loadCustomRooms(true), _loadRoomMutes(true)]);
        },

        // Events
        onRoomEvent: onRoomEvent,

        // Debug
        getStatus: getStatus
    };

    window.QamarRooms = QamarRooms;

    Logger.info('📦 [rooms.js] loaded');
})();
