// ==============================================
// rooms/room-voice.js v2.1
// Room voice slots + participants + music
// ==============================================
// يعتمد على: firebase.js + constants.js + rooms.js + auth.js + ranks.js
// يعطي: window.QamarRoomVoice
// ==============================================
// ✅ v2.1: لا heartbeat للزوار — يمنع spam permission_denied
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [room-voice] firebase.js not loaded!');
        return;
    }

    if (window.QamarRoomVoice && window.QamarRoomVoice.__v21) return;

    const LOG_TAG = '[RV]';
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
        ROOT: 'room_voice',
        HEARTBEAT_MS: 20000,
        STALE_PARTICIPANT_MS: 90000,
        MIN_KICK_LEVEL: 65,
        MUSIC_AUTO_CLEAR_MS: 60 * 60 * 1000
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        currentRoom: null,
        slots: [],
        participants: {},
        personalMutes: {},
        personalMutedAll: false,
        micCount: 0,
        heartbeatTimer: null,
        slotsListener: null,
        participantsListener: null,
        listeners: [],
        _initialized: false,
        barEl: null,
        contextMenuEl: null,
        contextMenuCleanup: null,
        _permDenied: false
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onVoiceEvent(cb) {
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

    function _getCurrentUser() {
        try {
            if (window.AppState && window.AppState.user) return window.AppState.user;
            if (window.QamarSession && window.QamarSession.getData) return window.QamarSession.getData();
        } catch (e) {}
        return null;
    }

    function _isGuest() {
        if (window.QamarAuth && window.QamarAuth.isGuest) return window.QamarAuth.isGuest();
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _canKickFromMic() {
        return _isKing() || _myLevel() >= CONFIG.MIN_KICK_LEVEL;
    }

    // ⭐ v2.1: هل نحن مؤهلون للكتابة؟
    function _canWrite() {
        if (!window.auth || !window.auth.currentUser) return false;
        if (State._permDenied) return false;
        // الزوار لا يكتبون presence
        if (_isGuest()) return false;
        return true;
    }

    function _getRoomConfig(roomId) {
        const base = (window.QAMAR && window.QAMAR.ROOMS) ? window.QAMAR.ROOMS[roomId] : null;
        if (base) return base;
        if (window.QamarRooms && typeof window.QamarRooms.getById === 'function') {
            return window.QamarRooms.getById(roomId);
        }
        return null;
    }

    function _getMicCount(roomId) {
        const cfg = _getRoomConfig(roomId);
        if (!cfg) return 0;
        if (cfg.allowMic === false) return 0;
        return Number(cfg.micCount) || 0;
    }

    /* ══════════════════════════════════════════════ */
    /* Slots — read                                    */
    /* ══════════════════════════════════════════════ */
    function getSlots(roomId) {
        roomId = roomId || State.currentRoom;
        if (!roomId) return [];
        const total = State.micCount || _getMicCount(roomId);
        const out = [];
        for (let i = 0; i < total; i++) {
            const s = State.slots[i] || null;
            out.push(s ? Object.assign({}, s, { slot: i }) : { slot: i, uid: null });
        }
        return out;
    }

    function getSlot(roomId, index) {
        const all = getSlots(roomId);
        return all[index] || null;
    }

    function isSlotFree(roomId, index) {
        const s = getSlot(roomId, index);
        return !!(s && !s.uid);
    }

    function findUserSlot(roomId, uid) {
        if (!uid) return -1;
        const all = getSlots(roomId);
        for (let i = 0; i < all.length; i++) {
            if (all[i] && all[i].uid === uid) return i;
        }
        return -1;
    }

    function isSpeaker(roomId, uid) {
        return findUserSlot(roomId, uid) !== -1;
    }

    function getSpeakers(roomId) {
        return getSlots(roomId).filter(function (s) { return s && s.uid; });
    }

    /* ══════════════════════════════════════════════ */
    /* Slots — write                                   */
    /* ══════════════════════════════════════════════ */
    function joinMic(roomId, slotIndex) {
        return Promise.resolve().then(function () {
            roomId = roomId || State.currentRoom;
            const uid = _getCurrentUid();
            if (!uid) throw new Error('غير مسجل');
            if (!roomId) throw new Error('لا توجد غرفة');
            if (!_canWrite()) throw new Error('ميزة المايك للمسجلين فقط');

            const micCount = State.micCount || _getMicCount(roomId);
            if (micCount === 0) throw new Error('لا يوجد مايك في هذه الغرفة');

            if (slotIndex === undefined || slotIndex === null) {
                const all = getSlots(roomId);
                for (let i = 0; i < all.length; i++) {
                    if (!all[i].uid) { slotIndex = i; break; }
                }
                if (slotIndex === undefined || slotIndex === null) {
                    throw new Error('كل المايكات مشغولة');
                }
            }

            slotIndex = Number(slotIndex);
            if (slotIndex < 0 || slotIndex >= micCount) {
                throw new Error('رقم المايك غير صحيح');
            }

            const mySlot = findUserSlot(roomId, uid);
            if (mySlot !== -1 && mySlot !== slotIndex) {
                return window.QamarFB.remove(CONFIG.ROOT + '/' + roomId + '/speakers/' + mySlot)
                    .then(function () { return _doJoin(roomId, slotIndex, uid); });
            }
            if (mySlot === slotIndex) {
                return { ok: true, alreadyIn: true, slot: slotIndex };
            }

            return window.QamarFB.transaction(
                CONFIG.ROOT + '/' + roomId + '/speakers/' + slotIndex,
                function (cur) {
                    if (cur && cur.uid && cur.uid !== uid) {
                        return undefined;
                    }
                    return _buildSpeakerPayload(uid);
                }
            ).then(function (r) {
                if (!r || !r.committed) throw new Error('المايك مشغول');
                return _doJoin(roomId, slotIndex, uid);
            });
        });
    }

    function _doJoin(roomId, slotIndex, uid) {
        _emit('voice:joined', { roomId: roomId, slot: slotIndex, uid: uid });

        if (window.EventBus) {
            try {
                window.EventBus.emit('voice:joinRequest', {
                    roomId: roomId, slot: slotIndex, uid: uid
                });
            } catch (e) {}
        }

        if (window.QamarVoiceSystem && typeof window.QamarVoiceSystem.connect === 'function') {
            try { window.QamarVoiceSystem.connect(roomId, slotIndex); } catch (e) {
                Logger.warn('voice-system connect failed:', e.message);
            }
        }

        Logger.info('🎙️ Joined mic:', roomId, 'slot', slotIndex);
        return { ok: true, slot: slotIndex };
    }

    function _buildSpeakerPayload(uid) {
        const u = _getCurrentUser() || {};
        return {
            uid: uid,
            name: u.name || '—',
            code: u.code || null,
            avatar: u.avatar || null,
            rank: u.rank || 'User',
            rankLevel: Number(u.rankLevel) || 50,
            muted: false,
            speaking: false,
            mode: 'voice',
            music: null,
            joinedAt: window.QamarFB.serverTime()
        };
    }

    function leaveMic(roomId) {
        return Promise.resolve().then(function () {
            roomId = roomId || State.currentRoom;
            const uid = _getCurrentUid();
            if (!uid || !roomId) return { ok: true, skipped: true };

            const mySlot = findUserSlot(roomId, uid);
            if (mySlot === -1) return { ok: true, notIn: true };

            return window.QamarFB.remove(CONFIG.ROOT + '/' + roomId + '/speakers/' + mySlot)
                .then(function () {
                    _emit('voice:left', { roomId: roomId, uid: uid, slot: mySlot });
                    if (window.QamarVoiceSystem && typeof window.QamarVoiceSystem.disconnect === 'function') {
                        try { window.QamarVoiceSystem.disconnect(); } catch (e) {}
                    }
                    Logger.info('🚪 Left mic:', roomId);
                    return { ok: true };
                });
        });
    }

    function leaveAll() {
        const roomId = State.currentRoom;
        if (!roomId) return Promise.resolve({ ok: true });
        return leaveMic(roomId).then(function () {
            _stopHeartbeat();
            return { ok: true };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Mute self                                       */
    /* ══════════════════════════════════════════════ */
    function muteSelf(roomId) {
        roomId = roomId || State.currentRoom;
        const uid = _getCurrentUid();
        if (!roomId || !uid) return Promise.resolve({ ok: false });
        const slot = findUserSlot(roomId, uid);
        if (slot === -1) return Promise.resolve({ ok: false, reason: 'not-in-mic' });

        return window.QamarFB.update(
            CONFIG.ROOT + '/' + roomId + '/speakers/' + slot,
            { muted: true }
        ).then(function () {
            if (window.QamarVoiceSystem && typeof window.QamarVoiceSystem.mute === 'function') {
                try { window.QamarVoiceSystem.mute(true); } catch (e) {}
            }
            return { ok: true };
        });
    }

    function unmuteSelf(roomId) {
        roomId = roomId || State.currentRoom;
        const uid = _getCurrentUid();
        if (!roomId || !uid) return Promise.resolve({ ok: false });
        const slot = findUserSlot(roomId, uid);
        if (slot === -1) return Promise.resolve({ ok: false, reason: 'not-in-mic' });

        return window.QamarFB.update(
            CONFIG.ROOT + '/' + roomId + '/speakers/' + slot,
            { muted: false }
        ).then(function () {
            if (window.QamarVoiceSystem && typeof window.QamarVoiceSystem.mute === 'function') {
                try { window.QamarVoiceSystem.mute(false); } catch (e) {}
            }
            return { ok: true };
        });
    }

    function toggleSelfMute(roomId) {
        roomId = roomId || State.currentRoom;
        const uid = _getCurrentUid();
        if (!uid) return Promise.resolve({ ok: false });
        const slot = findUserSlot(roomId, uid);
        if (slot === -1) return Promise.resolve({ ok: false });
        const s = State.slots[slot];
        if (s && s.muted) return unmuteSelf(roomId);
        return muteSelf(roomId);
    }

    /* ══════════════════════════════════════════════ */
    /* Moderation                                      */
    /* ══════════════════════════════════════════════ */
    function muteUser(roomId, targetUid) {
        return Promise.resolve().then(function () {
            if (!_canKickFromMic()) throw new Error('تحتاج مستوى 65');
            roomId = roomId || State.currentRoom;
            if (!roomId || !targetUid) throw new Error('بيانات ناقصة');
            if (targetUid === _getCurrentUid()) throw new Error('استخدم كتم نفسك');

            const slot = findUserSlot(roomId, targetUid);
            if (slot === -1) throw new Error('ليس في المايك');

            const target = State.slots[slot] || {};
            const targetLvl = Number(target.rankLevel) || 0;
            if (!_isKing() && targetLvl >= _myLevel()) {
                throw new Error('لا يمكنك كتم من هو بنفس رتبتك أو أعلى');
            }

            return window.QamarFB.update(
                CONFIG.ROOT + '/' + roomId + '/speakers/' + slot,
                { muted: true, mutedBy: _getCurrentUid() }
            ).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('voiceMute', {
                        targetUid: targetUid,
                        targetName: target.name || '—',
                        roomId: roomId
                    });
                }
                _emit('voice:userMuted', { uid: targetUid, roomId: roomId });
                return { ok: true };
            });
        });
    }

    function unmuteUser(roomId, targetUid) {
        return Promise.resolve().then(function () {
            if (!_canKickFromMic()) throw new Error('تحتاج مستوى 65');
            roomId = roomId || State.currentRoom;
            if (!roomId || !targetUid) throw new Error('بيانات ناقصة');
            const slot = findUserSlot(roomId, targetUid);
            if (slot === -1) throw new Error('ليس في المايك');
            return window.QamarFB.update(
                CONFIG.ROOT + '/' + roomId + '/speakers/' + slot,
                { muted: false, mutedBy: null }
            ).then(function () {
                _emit('voice:userUnmuted', { uid: targetUid, roomId: roomId });
                return { ok: true };
            });
        });
    }

    function kickFromMic(roomId, targetUid, reason) {
        return Promise.resolve().then(function () {
            if (!_canKickFromMic()) throw new Error('تحتاج مستوى 65');
            roomId = roomId || State.currentRoom;
            if (!roomId || !targetUid) throw new Error('بيانات ناقصة');
            if (targetUid === _getCurrentUid()) throw new Error('استخدم مغادرة المايك');

            const slot = findUserSlot(roomId, targetUid);
            if (slot === -1) throw new Error('ليس في المايك');

            const target = State.slots[slot] || {};
            const targetLvl = Number(target.rankLevel) || 0;
            if (!_isKing() && targetLvl >= _myLevel()) {
                throw new Error('لا يمكنك طرد من هو بنفس رتبتك أو أعلى');
            }

            return window.QamarFB.remove(CONFIG.ROOT + '/' + roomId + '/speakers/' + slot)
                .then(function () {
                    window.QamarFB.push('user_notifications/' + targetUid, {
                        type: 'mic_kick',
                        roomId: roomId,
                        reason: reason || '—',
                        byName: (_getCurrentUser() || {}).name || '—',
                        at: window.QamarFB.serverTime(),
                        read: false
                    }).catch(function () {});

                    if (window.QamarAudit) {
                        window.QamarAudit.log('voiceKick', {
                            targetUid: targetUid,
                            targetName: target.name || '—',
                            roomId: roomId,
                            reason: reason || '—'
                        });
                    }

                    _emit('voice:userKicked', { uid: targetUid, roomId: roomId, slot: slot });
                    Logger.info('👢 Kicked from mic:', targetUid.substring(0, 8));
                    return { ok: true };
                });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Personal mutes                                  */
    /* ══════════════════════════════════════════════ */
    function muteSpeakerForMe(uid) {
        if (!uid) return;
        State.personalMutes[uid] = true;
        _emit('voice:personalMute', { uid: uid, muted: true });
        _applyPersonalMutes();
    }

    function unmuteSpeakerForMe(uid) {
        if (!uid) return;
        delete State.personalMutes[uid];
        _emit('voice:personalMute', { uid: uid, muted: false });
        _applyPersonalMutes();
    }

    function toggleSpeakerForMe(uid) {
        if (!uid) return;
        if (State.personalMutes[uid]) unmuteSpeakerForMe(uid);
        else muteSpeakerForMe(uid);
    }

    function muteAllForMe() {
        State.personalMutedAll = true;
        _emit('voice:personalMuteAll', { muted: true });
        _applyPersonalMutes();
    }

    function unmuteAllForMe() {
        State.personalMutedAll = false;
        State.personalMutes = {};
        _emit('voice:personalMuteAll', { muted: false });
        _applyPersonalMutes();
    }

    function isSpeakerMutedForMe(uid) {
        if (!uid) return false;
        if (State.personalMutedAll) return true;
        return !!State.personalMutes[uid];
    }

    function _applyPersonalMutes() {
        if (window.QamarVoiceSystem && typeof window.QamarVoiceSystem.applyMutes === 'function') {
            try { window.QamarVoiceSystem.applyMutes(State.personalMutes, State.personalMutedAll); } catch (e) {}
        }
        _renderBar();
    }

    /* ══════════════════════════════════════════════ */
    /* Music                                           */
    /* ══════════════════════════════════════════════ */
    function setMusic(roomId, url, title) {
        return Promise.resolve().then(function () {
            roomId = roomId || State.currentRoom;
            const uid = _getCurrentUid();
            if (!uid) throw new Error('غير مسجل');
            if (!roomId) throw new Error('لا توجد غرفة');

            const mySlot = findUserSlot(roomId, uid);
            if (mySlot === -1) throw new Error('يجب أن تكون في المايك');
            if (!url) throw new Error('رابط الموسيقى مطلوب');

            return window.QamarFB.update(
                CONFIG.ROOT + '/' + roomId + '/speakers/' + mySlot,
                { music: { url: String(url), title: title || '🎵', at: window.QamarFB.serverTime() } }
            ).then(function () {
                _emit('voice:musicSet', { roomId: roomId, url: url, title: title, by: uid });
                Logger.info('🎵 Music set in', roomId);
                return { ok: true };
            });
        });
    }

    function clearMusic(roomId, slotIndex) {
        return Promise.resolve().then(function () {
            roomId = roomId || State.currentRoom;
            if (!roomId) throw new Error('لا توجد غرفة');

            let slot = slotIndex;
            if (slot === undefined || slot === null) {
                const all = getSlots(roomId);
                for (let i = 0; i < all.length; i++) {
                    if (all[i].uid && all[i].music) { slot = i; break; }
                }
            }
            if (slot === undefined || slot === null) return { ok: true, noMusic: true };

            const s = State.slots[slot];
            if (!s) return { ok: true };
            const isMine = s.uid === _getCurrentUid();
            if (!isMine && !_canKickFromMic()) {
                throw new Error('لا يمكنك إيقاف موسيقى غيرك');
            }

            return window.QamarFB.remove(
                CONFIG.ROOT + '/' + roomId + '/speakers/' + slot + '/music'
            ).then(function () {
                _emit('voice:musicCleared', { roomId: roomId, slot: slot });
                return { ok: true };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* ⭐ v2.1: Heartbeat — للمسجلين فقط              */
    /* ══════════════════════════════════════════════ */
    function _startHeartbeat() {
        // ⭐ v2.1: لا heartbeat للزوار
        if (!_canWrite()) {
            Logger.debug('Heartbeat skipped (no permission)');
            return;
        }
        _stopHeartbeat();
        _heartbeatTick();
        State.heartbeatTimer = setInterval(_heartbeatTick, CONFIG.HEARTBEAT_MS);
    }

    function _stopHeartbeat() {
        if (State.heartbeatTimer) {
            clearInterval(State.heartbeatTimer);
            State.heartbeatTimer = null;
        }
    }

    function _heartbeatTick() {
        const uid = _getCurrentUid();
        const roomId = State.currentRoom;
        if (!uid || !roomId) return;
        // ⭐ v2.1: لا ترسل إذا لا صلاحية
        if (!_canWrite()) return;

        const path = CONFIG.ROOT + '/' + roomId + '/participants/' + uid;
        const payload = {
            at: window.QamarFB.serverTime(),
            name: (_getCurrentUser() || {}).name || '—'
        };

        window.QamarFB.set(path, payload).catch(function (e) {
            const msg = (e && e.message) || '';
            if (msg.indexOf('permission') !== -1 || msg.indexOf('PERMISSION') !== -1) {
                State._permDenied = true;
                _stopHeartbeat();
                Logger.info('🔒 Heartbeat disabled (permission denied)');
            } else {
                Logger.warn('heartbeat failed:', msg);
            }
        });
    }

    function _bindOnDisconnect(roomId) {
        if (!roomId || !window.QamarFB || !window.QamarFB.ref) return;
        // ⭐ v2.1: لا نُسجّل للزوار
        if (!_canWrite()) return;
        try {
            const uid = _getCurrentUid();
            if (!uid) return;
            const r = window.QamarFB.ref(CONFIG.ROOT + '/' + roomId + '/participants/' + uid);
            if (r && r.onDisconnect) {
                r.onDisconnect().remove();
            }
            const mySlot = findUserSlot(roomId, uid);
            if (mySlot !== -1) {
                const sr = window.QamarFB.ref(CONFIG.ROOT + '/' + roomId + '/speakers/' + mySlot);
                if (sr && sr.onDisconnect) sr.onDisconnect().remove();
            }
        } catch (e) {
            Logger.debug('onDisconnect bind failed:', e.message);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Listeners                                       */
    /* ══════════════════════════════════════════════ */
    function _attachListeners(roomId) {
        _detachListeners();
        if (!roomId) return;

        State.slotsListener = window.QamarFB.onValue(
            CONFIG.ROOT + '/' + roomId + '/speakers',
            function (data) {
                const arr = [];
                if (data && typeof data === 'object') {
                    Object.keys(data).forEach(function (k) {
                        const idx = parseInt(k, 10);
                        if (!isNaN(idx)) arr[idx] = data[k];
                    });
                }
                State.slots = arr;
                _emit('voice:slots', { roomId: roomId, slots: getSlots(roomId) });
                _renderBar();
            },
            function () {}
        );

        State.participantsListener = window.QamarFB.onValue(
            CONFIG.ROOT + '/' + roomId + '/participants',
            function (data) {
                State.participants = data || {};
                _pruneStaleParticipants();
            },
            function () {}
        );
    }

    function _detachListeners() {
        if (State.slotsListener && State.slotsListener.off) {
            try { State.slotsListener.off(); } catch (e) {}
        }
        State.slotsListener = null;
        if (State.participantsListener && State.participantsListener.off) {
            try { State.participantsListener.off(); } catch (e) {}
        }
        State.participantsListener = null;
    }

    function _pruneStaleParticipants() {
        if (!_canWrite()) return;
        const now = Date.now();
        const updates = {};
        let n = 0;
        Object.keys(State.participants).forEach(function (uid) {
            const p = State.participants[uid];
            if (!p || !p.at) return;
            if (now - p.at > CONFIG.STALE_PARTICIPANT_MS) {
                updates[CONFIG.ROOT + '/' + State.currentRoom + '/participants/' + uid] = null;
                n++;
            }
        });
        if (n > 0) {
            window.QamarFB.multiUpdate(updates).catch(function () {});
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Enter / Leave room                              */
    /* ══════════════════════════════════════════════ */
    function enterRoom(roomId) {
        if (!roomId) return Promise.resolve({ ok: false });
        return leaveAll().then(function () {
            State.currentRoom = roomId;
            State.micCount = _getMicCount(roomId);
            State.slots = [];
            _attachListeners(roomId);
            _bindOnDisconnect(roomId);
            _startHeartbeat();
            _renderBar();
            Logger.info('🎙️ Voice entered room:', roomId, '| mics:', State.micCount);
            return { ok: true, micCount: State.micCount };
        });
    }

    function leaveRoom() {
        return leaveAll().then(function () {
            _detachListeners();
            const uid = _getCurrentUid();
            const roomId = State.currentRoom;
            if (uid && roomId && _canWrite()) {
                window.QamarFB.remove(CONFIG.ROOT + '/' + roomId + '/participants/' + uid).catch(function () {});
            }
            State.currentRoom = null;
            State.slots = [];
            State.participants = {};
            _renderBar();
            return { ok: true };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* UI — Voice bar                                  */
    /* ══════════════════════════════════════════════ */
    function _findBarParent() {
        return document.getElementById('voice-bar') ||
               document.querySelector('.voice-bar') ||
               document.querySelector('#chat-area') ||
               document.querySelector('.chat-area') ||
               document.querySelector('.messages-container') ||
               null;
    }

    function _ensureBar() {
        if (State.barEl && State.barEl.parentNode) return State.barEl;
        const parent = _findBarParent();
        if (!parent) return null;

        const bar = document.createElement('div');
        bar.id = 'voice-bar';
        bar.className = 'voice-bar';
        bar.style.cssText =
            'display:flex;gap:8px;padding:8px 10px;' +
            'background:rgba(10,10,21,0.85);border-bottom:1px solid rgba(212,175,55,0.2);' +
            'overflow-x:auto;direction:rtl;align-items:center;' +
            '-webkit-overflow-scrolling:touch;';

        if (parent.firstChild) parent.insertBefore(bar, parent.firstChild);
        else parent.appendChild(bar);

        State.barEl = bar;
        return bar;
    }

    function _renderBar() {
        if (State.micCount === 0) {
            if (State.barEl && State.barEl.parentNode) {
                State.barEl.parentNode.removeChild(State.barEl);
            }
            State.barEl = null;
            return;
        }

        const bar = _ensureBar();
        if (!bar) return;

        bar.innerHTML = '';

        const me = _getCurrentUid();
        const slots = getSlots();

        slots.forEach(function (slot) {
            const el = _buildSlotEl(slot, me);
            bar.appendChild(el);
        });
    }

    function _buildSlotEl(slot, meUid) {
        const el = document.createElement('div');
        el.className = 'voice-slot';
        el.dataset.slot = slot.slot;
        if (slot.uid) el.dataset.uid = slot.uid;

        const isMine = slot.uid === meUid;
        const isSpeaking = slot.speaking === true;
        const isMuted = slot.muted === true;
        const hasMusic = !!slot.music;
        const personalMuted = slot.uid ? isSpeakerMutedForMe(slot.uid) : false;

        el.style.cssText =
            'flex-shrink:0;display:flex;flex-direction:column;align-items:center;' +
            'justify-content:center;min-width:56px;height:56px;' +
            'border-radius:14px;padding:4px;cursor:pointer;position:relative;' +
            'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);' +
            'transition:all 0.2s;';

        if (slot.uid) {
            el.style.background = 'rgba(212,175,55,0.08)';
            el.style.borderColor = 'rgba(212,175,55,0.3)';
        }
        if (isSpeaking) {
            el.style.boxShadow = '0 0 0 2px #ffd700, 0 0 12px rgba(255,215,0,0.6)';
        }
        if (isMuted) el.style.opacity = '0.55';
        if (personalMuted) el.style.filter = 'grayscale(0.5)';

        const av = document.createElement('img');
        av.src = slot.avatar || (window.getDefaultAvatar
            ? window.getDefaultAvatar(slot.name || 'م')
            : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="%23111" stroke="%23d4af37" stroke-width="1.5"/><text x="20" y="26" text-anchor="middle" font-size="16">🎙️</text></svg>');
        av.style.cssText =
            'width:32px;height:32px;border-radius:50%;object-fit:cover;' +
            'background:#111;border:1px solid rgba(212,175,55,0.4);';
        av.onerror = function () {
            av.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="%23111" stroke="%23d4af37" stroke-width="1.5"/><text x="20" y="26" text-anchor="middle" font-size="16">🎙️</text></svg>';
        };
        el.appendChild(av);

        if (slot.uid && slot.name) {
            const nm = document.createElement('div');
            nm.style.cssText = 'font-size:9px;color:#f3f4f6;margin-top:2px;' +
                'max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            nm.textContent = slot.name;
            el.appendChild(nm);
        }

        if (isMuted) {
            const b = document.createElement('div');
            b.textContent = '🔇';
            b.style.cssText = 'position:absolute;top:2px;left:2px;font-size:11px;';
            el.appendChild(b);
        }
        if (hasMusic) {
            const b = document.createElement('div');
            b.textContent = '🎵';
            b.style.cssText = 'position:absolute;top:2px;right:2px;font-size:11px;';
            el.appendChild(b);
        }
        if (personalMuted) {
            const b = document.createElement('div');
            b.textContent = '🔕';
            b.style.cssText = 'position:absolute;bottom:2px;left:2px;font-size:10px;';
            el.appendChild(b);
        }

        el.addEventListener('click', function (e) {
            e.stopPropagation();
            _onSlotClick(slot, e);
        });
        el.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            _onSlotClick(slot, e);
        });

        return el;
    }

    /* ══════════════════════════════════════════════ */
    /* Slot menu                                       */
    /* ══════════════════════════════════════════════ */
    function _onSlotClick(slot, ev) {
        const me = _getCurrentUid();
        if (!slot || !me) return;

        const isMine = slot.uid === me;
        const isEmpty = !slot.uid;

        if (isEmpty) {
            joinMic(State.currentRoom, slot.slot).catch(function (e) {
                _toast(e.message || 'تعذر الدخول');
            });
            return;
        }

        if (isMine) {
            _openSlotMenu(slot, ev, [
                { icon: slot.muted ? '🔊' : '🔇', label: slot.muted ? 'فتح المايك' : 'كتم المايك', action: 'toggleMute' },
                { icon: '🎵', label: 'تشغيل موسيقى', action: 'music' },
                { icon: '🚪', label: 'خروج من المايك', action: 'leave', danger: true }
            ]);
            return;
        }

        const actions = [
            { icon: isSpeakerMutedForMe(slot.uid) ? '🔔' : '🔕',
              label: isSpeakerMutedForMe(slot.uid) ? 'إلغاء كتمه لي' : 'كتمه لي',
              action: 'personalMute' }
        ];
        if (_canKickFromMic()) {
            const targetLvl = Number(slot.rankLevel) || 0;
            const canKick = _isKing() || targetLvl < _myLevel();
            if (canKick) {
                actions.push({ icon: slot.muted ? '🔊' : '🔇',
                    label: slot.muted ? 'إلغاء كتمه للكل' : 'كتمه للكل',
                    action: 'muteGlobal' });
                actions.push({ icon: '👢', label: 'طرد من المايك', action: 'kick', danger: true });
            }
        }

        _openSlotMenu(slot, ev, actions);
    }

    function _openSlotMenu(slot, ev, actions) {
        _closeSlotMenu();

        const menu = document.createElement('div');
        menu.className = 'voice-slot-menu';
        menu.style.cssText = 'position:fixed;z-index:12500;' +
            'background:rgba(15,15,20,0.98);border:1px solid rgba(212,175,55,0.4);' +
            'border-radius:14px;padding:6px;direction:rtl;font-family:inherit;' +
            'box-shadow:0 10px 32px rgba(0,0,0,0.7);min-width:180px;';

        actions.forEach(function (a) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;' +
                'background:transparent;border:none;color:' +
                (a.danger ? '#ff8888' : '#f3f4f6') + ';padding:10px 12px;' +
                'font-family:inherit;font-size:13px;font-weight:700;' +
                'border-radius:8px;cursor:pointer;text-align:right;';
            btn.onmouseenter = function () { btn.style.background = 'rgba(212,175,55,0.1)'; };
            btn.onmouseleave = function () { btn.style.background = 'transparent'; };
            btn.innerHTML = '<span style="font-size:16px">' + a.icon + '</span><span>' + _esc(a.label) + '</span>';
            btn.onclick = function (e) {
                e.preventDefault();
                _closeSlotMenu();
                _execSlotAction(a.action, slot);
            };
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        State.contextMenuEl = menu;

        let x, y;
        if (ev && typeof ev.clientX === 'number' && ev.clientX > 0) {
            x = ev.clientX; y = ev.clientY;
        } else {
            x = window.innerWidth / 2; y = 100;
        }
        const rect = menu.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 8;
        const maxY = window.innerHeight - rect.height - 8;
        if (x > maxX) x = Math.max(8, maxX);
        if (y > maxY) y = Math.max(8, maxY);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        setTimeout(function () {
            const closer = function (e) {
                if (State.contextMenuEl && !State.contextMenuEl.contains(e.target)) {
                    _closeSlotMenu();
                    document.removeEventListener('click', closer, true);
                }
            };
            document.addEventListener('click', closer, true);
            State.contextMenuCleanup = function () {
                document.removeEventListener('click', closer, true);
            };
        }, 50);
    }

    function _closeSlotMenu() {
        if (State.contextMenuEl && State.contextMenuEl.parentNode) {
            State.contextMenuEl.parentNode.removeChild(State.contextMenuEl);
        }
        State.contextMenuEl = null;
        if (State.contextMenuCleanup) {
            try { State.contextMenuCleanup(); } catch (e) {}
            State.contextMenuCleanup = null;
        }
    }

    function _execSlotAction(action, slot) {
        if (!action || !slot) return;
        const roomId = State.currentRoom;

        switch (action) {
            case 'toggleMute':
                if (slot.muted) unmuteSelf(roomId).catch(function (e) { _toast(e.message); });
                else muteSelf(roomId).catch(function (e) { _toast(e.message); });
                break;
            case 'leave':
                leaveMic(roomId).catch(function (e) { _toast(e.message); });
                break;
            case 'personalMute':
                toggleSpeakerForMe(slot.uid);
                break;
            case 'muteGlobal':
                if (slot.muted) unmuteUser(roomId, slot.uid).catch(function (e) { _toast(e.message); });
                else muteUser(roomId, slot.uid).catch(function (e) { _toast(e.message); });
                break;
            case 'kick':
                kickFromMic(roomId, slot.uid, 'طرد من المايك').catch(function (e) { _toast(e.message); });
                break;
            case 'music':
                _promptMusic(slot);
                break;
        }
    }

    function _promptMusic(slot) {
        const url = window.prompt('رابط الموسيقى (mp3/stream):', '');
        if (!url) return;
        const title = window.prompt('اسم الأغنية (اختياري):', '🎵') || '🎵';
        setMusic(State.currentRoom, url, title).catch(function (e) {
            _toast(e.message || 'تعذر تشغيل الموسيقى');
        });
    }

    function _esc(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function _toast(msg) {
        if (window.showToast) { try { window.showToast('fa-info-circle', msg); return; } catch (e) {} }
        Logger.info('toast:', msg);
    }

    /* ══════════════════════════════════════════════ */
    /* External hooks                                  */
    /* ══════════════════════════════════════════════ */
    function updateSpeakingState(uid, speaking) {
        if (!uid || !State.currentRoom) return;
        const slot = findUserSlot(State.currentRoom, uid);
        if (slot === -1) return;
        if (State.slots[slot]) State.slots[slot].speaking = !!speaking;
        _renderBar();
    }

    function updateMuteState(uid, muted) {
        if (!uid || !State.currentRoom) return;
        const slot = findUserSlot(State.currentRoom, uid);
        if (slot === -1) return;
        if (State.slots[slot]) State.slots[slot].muted = !!muted;
        _renderBar();
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;

        if (window.EventBus) {
            window.EventBus.on('room:changed', function (p) {
                // ⭐ v2.1: يقبل نص أو كائن
                const roomId = (typeof p === 'string') ? p : (p && p.roomId);
                if (roomId) enterRoom(roomId);
            });
            window.EventBus.on('auth:signout', function () {
                leaveRoom();
            });
        }

        if (window.QamarRooms && typeof window.QamarRooms.getCurrent === 'function') {
            const r = window.QamarRooms.getCurrent();
            if (r) setTimeout(function () { enterRoom(r); }, 500);
        }

        Logger.info('📦 [room-voice.js v2.1] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 1800);
        });
    } else {
        setTimeout(_init, 6000);
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            currentRoom: State.currentRoom,
            micCount: State.micCount,
            slotsCount: (State.slots || []).length,
            speakersCount: getSpeakers().length,
            participantsCount: Object.keys(State.participants || {}).length,
            mySlot: findUserSlot(State.currentRoom, _getCurrentUid()),
            personalMutesCount: Object.keys(State.personalMutes).length,
            personalMutedAll: State.personalMutedAll,
            canKickFromMic: _canKickFromMic(),
            heartbeatActive: !!State.heartbeatTimer,
            permDenied: State._permDenied
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarRoomVoice = {
        __v21: true,
        CONFIG: CONFIG,
        enterRoom: enterRoom,
        leaveRoom: leaveRoom,
        getSlots: getSlots,
        getSlot: getSlot,
        isSlotFree: isSlotFree,
        findUserSlot: findUserSlot,
        isSpeaker: isSpeaker,
        getSpeakers: getSpeakers,
        joinMic: joinMic,
        leaveMic: leaveMic,
        leaveAll: leaveAll,
        muteSelf: muteSelf,
        unmuteSelf: unmuteSelf,
        toggleSelfMute: toggleSelfMute,
        muteUser: muteUser,
        unmuteUser: unmuteUser,
        kickFromMic: kickFromMic,
        muteSpeakerForMe: muteSpeakerForMe,
        unmuteSpeakerForMe: unmuteSpeakerForMe,
        toggleSpeakerForMe: toggleSpeakerForMe,
        muteAllForMe: muteAllForMe,
        unmuteAllForMe: unmuteAllForMe,
        isSpeakerMutedForMe: isSpeakerMutedForMe,
        setMusic: setMusic,
        clearMusic: clearMusic,
        render: _renderBar,
        updateSpeakingState: updateSpeakingState,
        updateMuteState: updateMuteState,
        onVoiceEvent: onVoiceEvent,
        getStatus: getStatus
    };

    window.QamarRoomVoice = QamarRoomVoice;

    Logger.info('📦 [room-voice.js v2.1] loaded | no-guest-heartbeat');
})();
