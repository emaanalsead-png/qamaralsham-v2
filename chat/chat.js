// ==============================================
// chat/chat.js v2.1 — fixed room:changed payload + safe catch
// ==============================================
// يعتمد على: firebase.js + auth.js + session.js + optimizers.js + constants.js
// يعطي: window.QamarChat
// ==============================================
// ⭐ v2.1:
//   1. أُزيل listener لـ room:changed (rooms.js يستدعي start مباشرة)
//   2. safe promise chain (لا .catch على undefined)
//   3. _refreshUserIndex محمي
//   4. تشخيص أفضل
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [chat] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[CHAT]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); }
    };

    const CONFIG = {
        MESSAGE_INTERVAL_MS: 5000,
        DUPLICATE_WINDOW_MS: 10000,
        MAX_MESSAGE_LENGTH: 2000,
        MESSAGES_LIMIT: 100,
        TOUCH_INTERVAL_MS: 120000
    };

    const State = {
        currentRoom: null,
        listener: null,
        messages: [],
        lastMessageTime: 0,
        lastMessageText: '',
        lastMessageAt: 0,
        lastTouchAt: 0,
        listeners: [],
        started: false,
        userCodeIndex: {}
    };

    function onChatEvent(cb) {
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

    // ⭐ v2.1: safe promise helper
    function _safePromiseChain(p) {
        if (p && typeof p.then === 'function' && typeof p.catch === 'function') {
            return p;
        }
        return Promise.resolve(p);
    }

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

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    function _canHide() { return _myLevel() >= 65; }

    function _sanitizeText(text) {
        if (!text) return '';
        return String(text).trim().substring(0, CONFIG.MAX_MESSAGE_LENGTH);
    }

    function _buildPayload(text, options) {
        options = options || {};
        const user = _getCurrentUser() || {};
        const uid = _getCurrentUid();
        const isGuest = _isGuest();

        const payload = {
            senderUid: uid,
            senderName: user.name || (isGuest ? 'زائر' : '—'),
            senderCode: user.code || null,
            senderAvatar: user.avatar || null,
            senderColor: user.color || null,
            senderRank: user.rank || 'User',
            senderRankLevel: Number(user.rankLevel) || 50,
            senderFrame: user.avatarFrame || null,
            senderNameColor: user.nameColor || null,
            senderNameGradient: user.nameGradient || null,
            senderNameBgColor: user.nameBgColor || null,
            senderNameBgGradient: user.nameBgGradient || null,
            senderCinemaText: user.cinemaTextStyle || null,
            senderCinemaBg: user.cinemaBgStyle || null,
            text: text,
            mentions: options.mentions || [],
            replyTo: options.replyTo || null,
            time: window.QamarFB.serverTime(),
            edited: false,
            deleted: false
        };

        if (options.attachment) payload.attachment = options.attachment;
        return payload;
    }

    function _extractMentions(text) {
        if (window.extractMentions) {
            try { return window.extractMentions(text) || []; } catch (e) {}
        }
        if (!text) return [];
        const names = Object.keys(State.userCodeIndex);
        if (names.length === 0) return [];
        const out = [];
        names.forEach(function (name) {
            if (!name) return;
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp('(?:^|\\s)' + escaped + '(?=\\s|$|[,،.!؟])', 'u');
            if (regex.test(text)) {
                if (out.indexOf(name) === -1) out.push(name);
            }
        });
        return out;
    }

    function _mentionsToUids(mentions) {
        if (!mentions || mentions.length === 0) return [];
        return mentions.map(function (name) {
            return {
                name: name,
                uid: State.userCodeIndex[name] || null
            };
        });
    }

    // ⭐ v2.1: محمي من undefined
    function _refreshUserIndex() {
        if (!window.QamarFB || typeof window.QamarFB.get !== 'function') return;
        try {
            const p = window.QamarFB.get('user_names');
            _safePromiseChain(p).then(function (data) {
                if (data) {
                    State.userCodeIndex = data;
                    Logger.debug('User index updated:', Object.keys(data).length, 'names');
                }
            }).catch(function () {});
        } catch (e) {
            Logger.warn('refreshUserIndex error:', e.message);
        }
    }

    function _isMuted(uid, roomId) {
        if (!uid) return Promise.resolve(false);
        if (!window.QamarFB || typeof window.QamarFB.get !== 'function') return Promise.resolve(false);
        try {
            const p = window.QamarFB.get('users/' + uid + '/mutes');
            return _safePromiseChain(p).then(function (mutes) {
                if (!mutes) return false;
                if (mutes.global === true) return true;
                if (roomId && mutes[roomId] === true) return true;
                return false;
            }).catch(function () { return false; });
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    function _checkRate() {
        const now = Date.now();
        if (now - State.lastMessageTime < CONFIG.MESSAGE_INTERVAL_MS) {
            const remaining = Math.ceil((CONFIG.MESSAGE_INTERVAL_MS - (now - State.lastMessageTime)) / 1000);
            return { ok: false, reason: 'rate', remaining: remaining };
        }
        return { ok: true };
    }

    function _isDuplicate(text) {
        const now = Date.now();
        if (text === State.lastMessageText && (now - State.lastMessageAt) < CONFIG.DUPLICATE_WINDOW_MS) {
            return true;
        }
        return false;
    }

    function _isPublicRoom(roomId) {
        const room = window.QAMAR && window.QAMAR.ROOMS ? window.QAMAR.ROOMS[roomId] : null;
        if (!room) return false;
        return room.visibleTo === 'all';
    }

    function send(text, options) {
        options = options || {};
        const roomId = options.roomId || State.currentRoom;

        return Promise.resolve().then(function () {
            if (!roomId || typeof roomId !== 'string') throw new Error('لا توجد غرفة محددة');
            if (!_getCurrentUid()) throw new Error('غير مسجل');

            const clean = _sanitizeText(text);
            if (!clean && !options.attachment) throw new Error('الرسالة فارغة');

            if (_isGuest() && !_isPublicRoom(roomId)) {
                throw new Error('الزوار لا يمكنهم الكتابة في هذه الغرفة');
            }

            const rate = _checkRate();
            if (!rate.ok) {
                throw new Error('انتظر ' + rate.remaining + ' ثانية قبل الإرسال');
            }

            if (_isDuplicate(clean)) {
                throw new Error('لا تكرر نفس الرسالة');
            }

            const mentions = _extractMentions(clean);
            const mentionsData = _mentionsToUids(mentions);

            let replyTo = null;
            if (options.replyTo) {
                replyTo = {
                    msgId: options.replyTo.msgId || options.replyTo._id || null,
                    senderUid: options.replyTo.senderUid || null,
                    senderName: options.replyTo.senderName || '—',
                    text: (options.replyTo.text || '').substring(0, 100)
                };
            }

            const payload = _buildPayload(clean, {
                mentions: mentionsData,
                replyTo: replyTo,
                attachment: options.attachment || null
            });

            return _isMuted(_getCurrentUid(), roomId).then(function (muted) {
                if (muted) throw new Error('أنت مكتوم في هذه الغرفة');
                return window.QamarFB.push('room_messages/' + roomId, payload);
            }).then(function (msgId) {
                State.lastMessageTime = Date.now();
                State.lastMessageText = clean;
                State.lastMessageAt = Date.now();

                _touchLastSeen();

                if (window.QamarOpt && typeof window.QamarOpt.cacheMessage === 'function') {
                    try { window.QamarOpt.cacheMessage(roomId, msgId, payload); } catch (e) {}
                }

                Logger.debug('📤 Sent to', roomId, '→', msgId);
                _emit('chat:sent', { msgId: msgId, roomId: roomId, payload: payload });
                return { ok: true, msgId: msgId, roomId: roomId };
            });
        });
    }

    function sendWithAttachment(text, attachment, options) {
        options = options || {};
        options.attachment = attachment;
        return send(text, options);
    }

    function sendReply(text, originalMessage, options) {
        options = options || {};
        options.replyTo = {
            msgId: originalMessage._id || originalMessage.msgId,
            senderUid: originalMessage.senderUid,
            senderName: originalMessage.senderName,
            text: originalMessage.text
        };
        return send(text, options);
    }

    function deleteMessage(msgId, roomId) {
        roomId = roomId || State.currentRoom;
        return Promise.resolve().then(function () {
            if (!roomId || !msgId) throw new Error('بيانات ناقصة');

            return window.QamarFB.get('room_messages/' + roomId + '/' + msgId).then(function (msg) {
                if (!msg) throw new Error('الرسالة غير موجودة');
                if (msg.deleted) return { ok: true, alreadyDeleted: true };

                const uid = _getCurrentUid();
                const isOwner = msg.senderUid === uid;
                const isHigh = _myLevel() >= 90 || _isKing();

                if (!isOwner && !isHigh) {
                    throw new Error('لا تملك صلاحية حذف هذه الرسالة');
                }

                const updates = {};
                const basePath = 'room_messages/' + roomId + '/' + msgId;
                updates[basePath + '/deleted'] = true;
                updates[basePath + '/deletedAt'] = window.QamarFB.serverTime();
                updates[basePath + '/deletedBy'] = uid;
                updates[basePath + '/originalText'] = msg.text || '';
                if (msg.attachment) updates[basePath + '/originalAttachment'] = msg.attachment;
                updates[basePath + '/text'] = '';
                updates[basePath + '/attachment'] = null;

                return window.QamarFB.multiUpdate(updates).then(function () {
                    if (window.QamarAudit) {
                        window.QamarAudit.log('deleteMsg', {
                            targetUid: msg.senderUid,
                            targetName: msg.senderName,
                            roomId: roomId,
                            msgId: msgId,
                            details: { byOwner: isOwner }
                        });
                    }
                    _emit('chat:messageDeleted', { msgId: msgId, roomId: roomId });
                    return { ok: true, msgId: msgId };
                });
            });
        });
    }

    function hideMessage(msgId, reason, roomId) {
        roomId = roomId || State.currentRoom;
        return Promise.resolve().then(function () {
            if (!_canHide()) throw new Error('تحتاج مستوى 65 للإخفاء');
            if (!roomId || !msgId) throw new Error('بيانات ناقصة');

            const basePath = 'room_messages/' + roomId + '/' + msgId;
            const updates = {};
            updates[basePath + '/hidden'] = true;
            updates[basePath + '/hiddenBy'] = _getCurrentUid();
            updates[basePath + '/hiddenAt'] = window.QamarFB.serverTime();
            updates[basePath + '/hiddenReason'] = reason || null;

            return window.QamarFB.multiUpdate(updates).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('hideMsg', { roomId: roomId, msgId: msgId, reason: reason || '—' });
                }
                _emit('chat:messageHidden', { msgId: msgId, roomId: roomId });
                return { ok: true, msgId: msgId };
            });
        });
    }

    function editMessage(msgId, newText, roomId) {
        roomId = roomId || State.currentRoom;
        return Promise.resolve().then(function () {
            if (!_isKing()) throw new Error('فقط الملك يمكنه التعديل');
            const clean = _sanitizeText(newText);
            if (!clean) throw new Error('النص فارغ');

            const basePath = 'room_messages/' + roomId + '/' + msgId;
            const updates = {};
            updates[basePath + '/text'] = clean;
            updates[basePath + '/edited'] = true;
            updates[basePath + '/editedAt'] = window.QamarFB.serverTime();

            return window.QamarFB.multiUpdate(updates).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('editMsg', { roomId: roomId, msgId: msgId });
                }
                _emit('chat:messageEdited', { msgId: msgId, roomId: roomId });
                return { ok: true, msgId: msgId };
            });
        });
    }

    function _touchLastSeen() {
        const now = Date.now();
        if (now - State.lastTouchAt < CONFIG.TOUCH_INTERVAL_MS) return;
        State.lastTouchAt = now;
        const uid = _getCurrentUid();
        if (!uid) return;
        const updates = {};
        updates['users/' + uid + '/lastSeen'] = window.QamarFB.serverTime();
        if (State.currentRoom) {
            updates['users/' + uid + '/currentRoom'] = State.currentRoom;
        }
        try {
            const p = window.QamarFB.multiUpdate(updates);
            _safePromiseChain(p).catch(function () {});
        } catch (e) {}
    }

    // ⭐ v2.1: بديل آمن لاسترجاع الرسائل من الكاش
    function _loadCachedMessages(roomId) {
        if (!window.QamarOpt || typeof window.QamarOpt.getCachedMessages !== 'function') return;
        try {
            const p = window.QamarOpt.getCachedMessages(roomId, CONFIG.MESSAGES_LIMIT);
            _safePromiseChain(p).then(function (cached) {
                if (cached && cached.length > 0) {
                    _emit('chat:cachedMessages', { roomId: roomId, messages: cached });
                }
            }).catch(function () {});
        } catch (e) {
            Logger.warn('loadCachedMessages error:', e.message);
        }
    }

    function start(roomId) {
        if (!roomId || typeof roomId !== 'string') {
            Logger.warn('start: roomId must be a string, got:', typeof roomId);
            return;
        }
        if (State.currentRoom === roomId && State.listener) {
            Logger.debug('Already listening to', roomId);
            return;
        }

        stop();

        State.currentRoom = roomId;
        State.messages = [];

        Logger.info('▶️ Listening to room:', roomId);

        _refreshUserIndex();
        _loadCachedMessages(roomId);

        const path = 'room_messages/' + roomId;

        try {
            State.listener = window.QamarFB.onLatest(path, CONFIG.MESSAGES_LIMIT, function (messages) {
                const list = messages.map(function (m) {
                    return Object.assign({ _id: m.id }, m.data);
                });

                if (window.QamarOpt && typeof window.QamarOpt.cacheMessages === 'function') {
                    try { window.QamarOpt.cacheMessages(roomId, messages); } catch (e) {}
                }

                State.messages = list;
                _emit('chat:messages', { roomId: roomId, messages: list });
            }, function (err) {
                Logger.error('listener error:', err);
                _emit('chat:error', { roomId: roomId, error: err });
            });
        } catch (e) {
            Logger.error('onLatest threw:', e.message);
            State.listener = null;
        }

        State.started = true;
        _emit('chat:started', { roomId: roomId });
    }

    function stop() {
        if (State.listener && State.listener.off) {
            try { State.listener.off(); } catch (e) {}
        }
        State.listener = null;
        State.started = false;
        _emit('chat:stopped', { roomId: State.currentRoom });
    }

    function getRecent(limit) {
        limit = limit || CONFIG.MESSAGES_LIMIT;
        return State.messages.slice(-limit);
    }

    function getMessage(msgId) {
        if (!State.currentRoom || !msgId) return Promise.resolve(null);
        return window.QamarFB.get('room_messages/' + State.currentRoom + '/' + msgId)
            .then(function (m) {
                if (!m) return null;
                return Object.assign({ _id: msgId }, m);
            })
            .catch(function () { return null; });
    }

    function getRoom() { return State.currentRoom; }

    function clearRoomCache(roomId) {
        roomId = roomId || State.currentRoom;
        if (window.QamarOpt && typeof window.QamarOpt.clearCachedMessages === 'function' && roomId) {
            try {
                const p = window.QamarOpt.clearCachedMessages(roomId);
                return _safePromiseChain(p).catch(function () { return 0; });
            } catch (e) {}
        }
        return Promise.resolve(0);
    }

    function getStatus() {
        return {
            started: State.started,
            currentRoom: State.currentRoom,
            messagesCount: State.messages.length,
            lastMessageTime: State.lastMessageTime,
            lastMessageText: State.lastMessageText ? State.lastMessageText.substring(0, 30) : null,
            userCodeIndexSize: Object.keys(State.userCodeIndex).length,
            isGuest: _isGuest(),
            isKing: _isKing(),
            myLevel: _myLevel()
        };
    }

    // ⭐ v2.1: _init — لا نستمع لـ room:changed (rooms.js يستدعي start مباشرة)
    function _init() {
        // راقب تغيير الجلسة فقط
        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (!p.isLoggedIn) stop();
            });
        }

        Logger.info('📦 [chat.js v2.1] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 1500);
        });
    } else {
        setTimeout(_init, 5000);
    }

    const QamarChat = {
        CONFIG: CONFIG,
        start: start,
        stop: stop,
        getRoom: getRoom,
        send: send,
        sendWithAttachment: sendWithAttachment,
        sendReply: sendReply,
        deleteMessage: deleteMessage,
        hideMessage: hideMessage,
        editMessage: editMessage,
        getRecent: getRecent,
        getMessage: getMessage,
        clearRoomCache: clearRoomCache,
        refreshUserIndex: _refreshUserIndex,
        onChatEvent: onChatEvent,
        getStatus: getStatus
    };

    window.QamarChat = QamarChat;

    Logger.info('📦 [chat.js v2.1] loaded — room:changed fix');
})();
