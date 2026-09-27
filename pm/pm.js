// ==============================================
// pm/pm.js
// Private messages — WhatsApp-style
// ==============================================
// يعتمد على: firebase.js + auth.js + session.js + ranks.js
// يعطي: window.QamarPM
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [pm] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[PM]';
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
        ROOT: 'user_private_messages',
        CHATS_ROOT: 'user_private_chats',
        TYPING_ROOT: 'user_private_typing',
        BLOCKS_ROOT: 'user_private_blocks',
        RATE_MS: 1000,                  // ⚠️ ثانية واحدة
        TYPING_TIMEOUT_MS: 4000,        // مسح تلقائي
        MAX_LENGTH: 2000,
        MESSAGES_LIMIT: 50,
        CHATS_LIMIT: 100,
        PREVIEW_LENGTH: 80
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        currentChat: null,
        messages: [],
        chatsList: [],
        typingUsers: {},            // { uid: timestamp }
        unreadCount: 0,
        lastSentAt: 0,
        lastSentText: '',
        typingTimer: null,
        msgListener: null,
        chatsListener: null,
        typingListener: null,
        typingUserTimers: {},
        listeners: [],
        blocks: {},                 // cache
        _initialized: false
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onPMEvent(cb) {
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

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _sanitizeText(text) {
        if (!text) return '';
        return String(text).trim().substring(0, CONFIG.MAX_LENGTH);
    }

    function _escape(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function _preview(text, max) {
        max = max || CONFIG.PREVIEW_LENGTH;
        if (!text) return '';
        const s = String(text);
        if (s.length <= max) return s;
        return s.substring(0, max - 3) + '...';
    }

    function _toast(msg) {
        if (window.showToast) { try { window.showToast('fa-info-circle', msg); return; } catch (e) {} }
        Logger.info('toast:', msg);
    }

    /* ══════════════════════════════════════════════ */
    /* Messages path                                   */
    /* ══════════════════════════════════════════════ */
    function _msgPath(ownerUid, otherUid) {
        return CONFIG.ROOT + '/' + ownerUid + '/' + otherUid;
    }

    function _chatPath(ownerUid, otherUid) {
        return CONFIG.CHATS_ROOT + '/' + ownerUid + '/' + otherUid;
    }

    function _typingPath(uid, otherUid) {
        return CONFIG.TYPING_ROOT + '/' + uid + '/' + otherUid;
    }

    function _blockPath(ownerUid, otherUid) {
        return CONFIG.BLOCKS_ROOT + '/' + ownerUid + '/' + otherUid;
    }

    /* ══════════════════════════════════════════════ */
    /* Blocks                                          */
    /* ══════════════════════════════════════════════ */
    function isBlocked(otherUid) {
        const me = _getCurrentUid();
        if (!me || !otherUid) return Promise.resolve(false);
        return window.QamarFB.exists(_blockPath(me, otherUid))
            .catch(function () { return false; });
    }

    function isBlockedBy(otherUid) {
        const me = _getCurrentUid();
        if (!me || !otherUid) return Promise.resolve(false);
        return window.QamarFB.exists(_blockPath(otherUid, me))
            .catch(function () { return false; });
    }

    function blockUser(otherUid) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me) throw new Error('غير مسجل');
            if (!otherUid) throw new Error('uid مطلوب');
            if (me === otherUid) throw new Error('لا يمكنك حظر نفسك');

            return window.QamarFB.set(_blockPath(me, otherUid), {
                at: window.QamarFB.serverTime()
            }).then(function () {
                _emit('pm:blocked', { uid: otherUid });
                Logger.info('🚫 Blocked:', otherUid.substring(0, 8));
                return { ok: true };
            });
        });
    }

    function unblockUser(otherUid) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me) throw new Error('غير مسجل');
            if (!otherUid) throw new Error('uid مطلوب');

            return window.QamarFB.remove(_blockPath(me, otherUid))
                .then(function () {
                    _emit('pm:unblocked', { uid: otherUid });
                    return { ok: true };
                });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Rate limit                                      */
    /* ══════════════════════════════════════════════ */
    function _checkRate(text) {
        const now = Date.now();
        if (now - State.lastSentAt < CONFIG.RATE_MS) {
            const rem = Math.ceil((CONFIG.RATE_MS - (now - State.lastSentAt)) / 1000);
            return { ok: false, remaining: rem || 1 };
        }
        if (text === State.lastSentText && (now - State.lastSentAt) < 3000) {
            return { ok: false, duplicate: true };
        }
        return { ok: true };
    }

    /* ══════════════════════════════════════════════ */
    /* Send message                                    */
    /* ══════════════════════════════════════════════ */
    function send(toUid, text, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me) throw new Error('غير مسجل');
            if (_isGuest()) throw new Error('الزوار لا يمكنهم إرسال رسائل خاصة');
            if (!toUid) throw new Error('المستقبل مطلوب');
            if (me === toUid) throw new Error('لا يمكنك إرسال رسالة لنفسك');

            const clean = _sanitizeText(text);
            if (!clean && !options.attachment) throw new Error('الرسالة فارغة');

            // rate
            const rate = _checkRate(clean);
            if (!rate.ok) {
                if (rate.duplicate) throw new Error('لا تكرر نفس الرسالة');
                throw new Error('انتظر ' + rate.remaining + ' ثانية');
            }

            // فحص الحظر
            return isBlocked(toUid).then(function (blockedByMe) {
                if (blockedByMe) throw new Error('لقد حظرت هذا المستخدم — ألغِ الحظر أولاً');
                return isBlockedBy(toUid).then(function (blockedByThem) {
                    if (blockedByThem) throw new Error('لا يمكنك إرسال رسالة لهذا المستخدم');
                    return true;
                });
            }).then(function () {
                const now = window.QamarFB.serverTime();
                const myUser = _getCurrentUser() || {};

                // payload للأرسل
                const payloadFromMe = {
                    fromUid: me,
                    toUid: toUid,
                    text: clean,
                    time: now,
                    read: false,
                    delivered: false,
                    deleted: false,
                    replyTo: options.replyTo || null,
                    attachment: options.attachment || null,
                    edited: false
                };

                // payload للمستقبل (يُعاد استخدام نفس البنية + إضافة fromName/fromAvatar)
                const payloadToThem = Object.assign({}, payloadFromMe, {
                    fromName: myUser.name || '—',
                    fromAvatar: myUser.avatar || null
                });

                // أنشئ push في مساري (نفس msgId للطرفين)
                const newRef = window.QamarFB.ref(_msgPath(me, toUid)).push();
                const msgId = newRef.key;

                const updates = {};
                updates[_msgPath(me, toUid) + '/' + msgId] = payloadFromMe;
                updates[_msgPath(toUid, me) + '/' + msgId] = payloadToThem;

                // chat indices
                updates[_chatPath(me, toUid)] = {
                    otherUid: toUid,
                    otherName: options.otherName || '—',
                    otherAvatar: options.otherAvatar || null,
                    lastMessage: _preview(clean || '[مرفق]'),
                    lastTime: now,
                    lastFromMe: true,
                    unread: 0
                };
                // للمستقبل — unread يزداد
                return window.QamarFB.get(_chatPath(toUid, me)).then(function (existing) {
                    const prevUnread = (existing && Number(existing.unread)) || 0;
                    updates[_chatPath(toUid, me)] = {
                        otherUid: me,
                        otherName: myUser.name || '—',
                        otherAvatar: myUser.avatar || null,
                        lastMessage: _preview(clean || '[مرفق]'),
                        lastTime: now,
                        lastFromMe: false,
                        unread: prevUnread + 1
                    };
                    return window.QamarFB.multiUpdate(updates);
                });
            }).then(function () {
                State.lastSentAt = Date.now();
                State.lastSentText = clean;
                // أوقف "جاري الكتابة"
                _setTyping(false, toUid);

                _emit('pm:sent', { toUid: toUid });
                Logger.debug('📤 PM sent to', toUid.substring(0, 8));
                return { ok: true };
            });
        });
    }

    function sendWithAttachment(toUid, text, attachment, options) {
        options = options || {};
        options.attachment = attachment;
        return send(toUid, text, options);
    }

    function sendReply(toUid, text, originalMsg, options) {
        options = options || {};
        options.replyTo = {
            msgId: originalMsg._id || originalMsg.msgId,
            senderUid: originalMsg.fromUid,
            senderName: originalMsg.fromName || '—',
            text: _preview(originalMsg.text || '', 100)
        };
        return send(toUid, text, options);
    }

    /* ══════════════════════════════════════════════ */
    /* Read — messages                                 */
    /* ══════════════════════════════════════════════ */
    function getMessages(otherUid, limit) {
        const me = _getCurrentUid();
        if (!me || !otherUid) return Promise.resolve([]);
        limit = limit || CONFIG.MESSAGES_LIMIT;

        return window.QamarFB.query(_msgPath(me, otherUid), {
            orderByChild: 'time',
            limitToLast: limit,
            returnArray: true
        }).then(function (arr) {
            if (!arr) return [];
            return arr.map(function (r) {
                return Object.assign({ _id: r.id }, r.data);
            }).filter(function (m) { return !m.deleted; });
        }).catch(function () { return []; });
    }

    /* ══════════════════════════════════════════════ */
    /* Read — chats list                               */
    /* ══════════════════════════════════════════════ */
    function listChats() {
        const me = _getCurrentUid();
        if (!me) return Promise.resolve([]);
        return window.QamarFB.children(_chatPath(me, ''))
            .then(function (data) {
                if (!data) return [];
                const list = Object.keys(data).map(function (otherUid) {
                    return Object.assign({ otherUid: otherUid }, data[otherUid]);
                });
                // احذف المحذوفة
                let filtered = list.filter(function (c) { return !c.deletedAt; });
                // رتب حسب آخر رسالة
                filtered.sort(function (a, b) {
                    return (b.lastTime || 0) - (a.lastTime || 0);
                });
                State.chatsList = filtered;
                return filtered;
            }).catch(function () { return []; });
    }

    function getChat(otherUid) {
        const me = _getCurrentUid();
        if (!me || !otherUid) return Promise.resolve(null);
        return window.QamarFB.get(_chatPath(me, otherUid))
            .then(function (c) {
                if (!c) return null;
                return Object.assign({ otherUid: otherUid }, c);
            }).catch(function () { return null; });
    }

    /* ══════════════════════════════════════════════ */
    /* Unread                                          */
    /* ══════════════════════════════════════════════ */
    function getUnreadCount() {
        const me = _getCurrentUid();
        if (!me) return Promise.resolve(0);
        return window.QamarFB.children(_chatPath(me, ''))
            .then(function (data) {
                if (!data) return 0;
                let total = 0;
                Object.keys(data).forEach(function (k) {
                    const c = data[k];
                    if (c && c.unread) total += Number(c.unread);
                });
                State.unreadCount = total;
                return total;
            }).catch(function () { return 0; });
    }

    function getUnreadFrom(otherUid) {
        const me = _getCurrentUid();
        if (!me || !otherUid) return Promise.resolve(0);
        return window.QamarFB.get(_chatPath(me, otherUid) + '/unread')
            .then(function (v) { return Number(v) || 0; })
            .catch(function () { return 0; });
    }

    /* ══════════════════════════════════════════════ */
    /* Mark as read + delivered                        */
    /* ══════════════════════════════════════════════ */
    function markAsRead(otherUid) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid) return { ok: false };

            const now = window.QamarFB.serverTime();
            const updates = {};

            // صفّر unread في chat
            updates[_chatPath(me, otherUid) + '/unread'] = 0;

            // علّم رسائل الطرف الآخر مقروءة (في نسختي)
            return window.QamarFB.get(_msgPath(me, otherUid)).then(function (data) {
                if (data) {
                    Object.keys(data).forEach(function (msgId) {
                        const m = data[msgId];
                        if (m && m.fromUid === otherUid && !m.read) {
                            updates[_msgPath(me, otherUid) + '/' + msgId + '/read'] = true;
                            updates[_msgPath(me, otherUid) + '/' + msgId + '/readAt'] = now;
                            // علّم نسخة الطرف الآخر أيضاً
                            updates[_msgPath(otherUid, me) + '/' + msgId + '/read'] = true;
                            updates[_msgPath(otherUid, me) + '/' + msgId + '/readAt'] = now;
                        }
                    });
                }
                if (Object.keys(updates).length <= 1) {
                    return { ok: true, nothing: true };
                }
                return window.QamarFB.multiUpdate(updates).then(function () {
                    _emit('pm:read', { otherUid: otherUid });
                    return { ok: true };
                });
            });
        });
    }

    function markAllDelivered(otherUid) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid) return { ok: false };

            const now = window.QamarFB.serverTime();
            const updates = {};

            return window.QamarFB.get(_msgPath(me, otherUid)).then(function (data) {
                if (!data) return { ok: true };
                Object.keys(data).forEach(function (msgId) {
                    const m = data[msgId];
                    if (m && m.fromUid === otherUid && !m.delivered) {
                        updates[_msgPath(me, otherUid) + '/' + msgId + '/delivered'] = true;
                        updates[_msgPath(me, otherUid) + '/' + msgId + '/deliveredAt'] = now;
                        // نسخة الطرف الآخر
                        updates[_msgPath(otherUid, me) + '/' + msgId + '/delivered'] = true;
                        updates[_msgPath(otherUid, me) + '/' + msgId + '/deliveredAt'] = now;
                    }
                });
                if (Object.keys(updates).length === 0) return { ok: true };
                return window.QamarFB.multiUpdate(updates).then(function () {
                    _emit('pm:delivered', { otherUid: otherUid });
                    return { ok: true };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Typing indicator                                */
    /* ══════════════════════════════════════════════ */
    function _setTyping(isTyping, toUid) {
        const me = _getCurrentUid();
        if (!me || !toUid) return;
        const path = _typingPath(me, toUid);

        if (isTyping) {
            window.QamarFB.set(path, window.QamarFB.serverTime()).catch(function () {});
        } else {
            window.QamarFB.remove(path).catch(function () {});
        }
    }

    // للاستخدام من UI — أثناء الكتابة
    function setTyping(otherUid, isTyping) {
        if (State.typingTimer) {
            clearTimeout(State.typingTimer);
            State.typingTimer = null;
        }
        _setTyping(isTyping, otherUid);
        if (isTyping) {
            // أرسل ping مرة أخرى قبل ما ينتهي
            State.typingTimer = setTimeout(function () {
                State.typingTimer = null;
            }, CONFIG.TYPING_TIMEOUT_MS - 500);
        }
    }

    function stopTyping(otherUid) {
        if (State.typingTimer) {
            clearTimeout(State.typingTimer);
            State.typingTimer = null;
        }
        _setTyping(false, otherUid);
    }

    // ابدأ الاستماع لـ typing من الطرف الآخر
    function _startTypingWatch(otherUid) {
        _stopTypingWatch();
        const me = _getCurrentUid();
        if (!me || !otherUid) return;

        const path = _typingPath(otherUid, me);
        State.typingListener = window.QamarFB.onValue(path, function (val) {
            const now = Date.now();
            if (val) {
                State.typingUsers[otherUid] = now;
                if (State.typingUserTimers[otherUid]) clearTimeout(State.typingUserTimers[otherUid]);
                State.typingUserTimers[otherUid] = setTimeout(function () {
                    delete State.typingUsers[otherUid];
                    _emit('pm:typing', { uid: otherUid, isTyping: false });
                }, CONFIG.TYPING_TIMEOUT_MS);
                _emit('pm:typing', { uid: otherUid, isTyping: true });
            } else {
                delete State.typingUsers[otherUid];
                if (State.typingUserTimers[otherUid]) clearTimeout(State.typingUserTimers[otherUid]);
                _emit('pm:typing', { uid: otherUid, isTyping: false });
            }
        }, function () {});
    }

    function _stopTypingWatch() {
        if (State.typingListener && State.typingListener.off) {
            try { State.typingListener.off(); } catch (e) {}
        }
        State.typingListener = null;
        Object.keys(State.typingUserTimers).forEach(function (k) {
            clearTimeout(State.typingUserTimers[k]);
        });
        State.typingUserTimers = {};
        State.typingUsers = {};
    }

    function isUserTyping(uid) {
        if (!uid) return false;
        const t = State.typingUsers[uid];
        if (!t) return false;
        return (Date.now() - t) < CONFIG.TYPING_TIMEOUT_MS;
    }

    /* ══════════════════════════════════════════════ */
    /* Delete                                          */
    /* ══════════════════════════════════════════════ */
    function deleteMessage(otherUid, msgId) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid || !msgId) throw new Error('بيانات ناقصة');

            const path = _msgPath(me, otherUid) + '/' + msgId;
            const updates = {};
            updates[path + '/deleted'] = true;
            updates[path + '/deletedAt'] = window.QamarFB.serverTime();
            updates[path + '/originalText'] = null; // سيُقرأ قبل
            // احفظ النص الأصلي
            return window.QamarFB.get(path).then(function (m) {
                if (m) updates[path + '/originalText'] = m.text || '';
                updates[path + '/text'] = '';
                updates[path + '/attachment'] = null;
                return window.QamarFB.multiUpdate(updates);
            }).then(function () {
                _emit('pm:messageDeleted', { otherUid: otherUid, msgId: msgId });
                return { ok: true };
            });
        });
    }

    function deleteChat(otherUid) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid) throw new Error('بيانات ناقصة');

            const now = window.QamarFB.serverTime();
            const updates = {};
            updates[_chatPath(me, otherUid) + '/deletedAt'] = now;
            updates[_chatPath(me, otherUid) + '/unread'] = 0;

            return window.QamarFB.multiUpdate(updates).then(function () {
                _emit('pm:chatDeleted', { otherUid: otherUid });
                Logger.info('🗑️ Chat deleted (my side):', otherUid.substring(0, 8));
                return { ok: true };
            });
        });
    }

    function restoreChat(otherUid) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid) throw new Error('بيانات ناقصة');
            return window.QamarFB.remove(_chatPath(me, otherUid) + '/deletedAt')
                .then(function () {
                    _emit('pm:chatRestored', { otherUid: otherUid });
                    return { ok: true };
                });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Listeners                                       */
    /* ══════════════════════════════════════════════ */
    function start(otherUid) {
        if (!otherUid) return;
        stop();
        State.currentChat = otherUid;

        const me = _getCurrentUid();
        if (!me) return;

        // رسائل
        const msgPath = _msgPath(me, otherUid);
        State.msgListener = window.QamarFB.onLatest(msgPath, CONFIG.MESSAGES_LIMIT, function (arr) {
            const list = arr.map(function (r) {
                return Object.assign({ _id: r.id }, r.data);
            });
            State.messages = list;
            _emit('pm:messages', { otherUid: otherUid, messages: list });
        }, function () {});

        // typing
        _startTypingWatch(otherUid);

        // علّم كل الرسائل delivered
        markAllDelivered(otherUid).catch(function () {});
    }

    function stop() {
        if (State.msgListener && State.msgListener.off) {
            try { State.msgListener.off(); } catch (e) {}
        }
        State.msgListener = null;
        _stopTypingWatch();
        if (State.currentChat) {
            _setTyping(false, State.currentChat);
        }
        State.currentChat = null;
    }

    function watchChats(cb) {
        const me = _getCurrentUid();
        if (!me) return null;
        _unwatchChats();
        State.chatsListener = window.QamarFB.onValue(_chatPath(me, ''), function (data) {
            const list = data ? Object.keys(data).map(function (otherUid) {
                return Object.assign({ otherUid: otherUid }, data[otherUid]);
            }).filter(function (c) { return !c.deletedAt; })
              .sort(function (a, b) { return (b.lastTime || 0) - (a.lastTime || 0); }) : [];
            State.chatsList = list;
            if (cb) cb(list);
            _emit('pm:chats', { chats: list });
        }, function () {});
        return State.chatsListener;
    }

    function _unwatchChats() {
        if (State.chatsListener && State.chatsListener.off) {
            try { State.chatsListener.off(); } catch (e) {}
        }
        State.chatsListener = null;
    }

    /* ══════════════════════════════════════════════ */
    /* External: read status for display               */
    /* ══════════════════════════════════════════════ */
    function getMessageStatus(msg) {
        if (!msg) return null;
        if (msg.read) return 'read';           // ✓✓
        if (msg.delivered) return 'delivered'; // ✓✓
        return 'sent';                          // ✓
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;

        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (!p.isLoggedIn) {
                    stop();
                    _unwatchChats();
                    State.chatsList = [];
                    State.unreadCount = 0;
                } else if (p.uid) {
                    // راقب القائمة + العدّاد
                    watchChats(function () {
                        getUnreadCount().then(function (n) {
                            _emit('pm:unread', { count: n });
                        });
                    });
                }
            });
        }

        Logger.info('📦 [pm.js] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 2000);
        });
    } else {
        setTimeout(_init, 6500);
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            currentChat: State.currentChat,
            messagesCount: State.messages.length,
            chatsCount: State.chatsList.length,
            unreadCount: State.unreadCount,
            typingUsers: Object.keys(State.typingUsers),
            isGuest: _isGuest(),
            rateMs: CONFIG.RATE_MS
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarPM = {
        CONFIG: CONFIG,

        // Send
        send: send,
        sendWithAttachment: sendWithAttachment,
        sendReply: sendReply,

        // Read
        getMessages: getMessages,
        listChats: listChats,
        getChat: getChat,
        getUnreadCount: getUnreadCount,
        getUnreadFrom: getUnreadFrom,

        // Status
        markAsRead: markAsRead,
        markAllDelivered: markAllDelivered,
        getMessageStatus: getMessageStatus,

        // Delete
        deleteMessage: deleteMessage,
        deleteChat: deleteChat,
        restoreChat: restoreChat,

        // Block
        blockUser: blockUser,
        unblockUser: unblockUser,
        isBlocked: isBlocked,
        isBlockedBy: isBlockedBy,

        // Listen
        start: start,
        stop: stop,
        watchChats: watchChats,

        // Typing
        setTyping: setTyping,
        stopTyping: stopTyping,
        isUserTyping: isUserTyping,

        // Events
        onPMEvent: onPMEvent,

        // Debug
        getStatus: getStatus
    };

    Logger.info('📦 [pm.js] loaded | rate:', CONFIG.RATE_MS + 'ms');
})();
