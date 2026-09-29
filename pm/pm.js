// ==============================================
// pm/pm.js v2 — guardian-queue integration + adaptive
// ==============================================
// يعتمد على: firebase.js + auth.js + session.js + ranks.js + guardian-queue.js + adaptive.js
// يعطي: window.QamarPM
// ==============================================
// ⭐ v2 (فوق v1):
//   1. يكتب في guardian_alerts_queue فوراً عند send()
//   2. لا يمنع الإرسال (ينبّه فقط)
//   3. Rate limit للتنبيهات (منع spam queue)
//   4. Typing — يعتمد على QamarAdaptive
//   5. QamarBoot.whenReady
//   6. كل السابق محفوظ
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [pm] firebase.js not loaded!');
        return;
    }

    if (window.QamarPM && window.QamarPM.__v2) return;

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
        RATE_MS: 1000,
        TYPING_TIMEOUT_MS: 4000,
        MAX_LENGTH: 2000,
        MESSAGES_LIMIT: 50,
        CHATS_LIMIT: 100,
        PREVIEW_LENGTH: 80,
        // ⭐ v2: queue push rate limit
        ALERT_RATE_MS: 30 * 1000,   // لا نُنبّه أكثر من مرة كل 30s لنفس الشخص
        ALERT_DEDUP_TTL_MS: 5 * 60 * 1000  // تجاهل نفس الكلمة 5 دقائق
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        currentChat: null,
        messages: [],
        chatsList: [],
        typingUsers: {},
        unreadCount: 0,
        lastSentAt: 0,
        lastSentText: '',
        typingTimer: null,
        msgListener: null,
        chatsListener: null,
        typingListener: null,
        typingUserTimers: {},
        listeners: [],
        blocks: {},
        _initialized: false,
        _adaptiveBound: false,
        // ⭐ v2
        alertDedup: {},          // { 'uid:word': timestamp }
        alertRateMap: {}         // { uid: lastPushAt }
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

    function _getRateMs() {
        if (window.QamarAdaptive && typeof window.QamarAdaptive.get === 'function') {
            return window.QamarAdaptive.get('debounceMs') || CONFIG.RATE_MS;
        }
        return CONFIG.RATE_MS;
    }

    function _isTypingEnabled() {
        if (window.QamarAdaptive && typeof window.QamarAdaptive.isEnabled === 'function') {
            return window.QamarAdaptive.isEnabled('typingEnabled');
        }
        return true;
    }

    function _sanitizeText(text) {
        if (!text) return '';
        return String(text).trim().substring(0, CONFIG.MAX_LENGTH);
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

    function _now() { return Date.now(); }

    /* ══════════════════════════════════════════════ */
    /* Paths                                           */
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
    /* ⭐ v2: Violation detection                     */
    /* ══════════════════════════════════════════════ */
    function _matchWordSimple(text, list) {
        if (!text || !list || !list.length) return null;
        const lower = String(text).toLowerCase();
        for (let i = 0; i < list.length; i++) {
            const w = list[i];
            if (!w || w.length < 2) continue;
            if (lower.indexOf(String(w).toLowerCase()) !== -1) return w;
        }
        return null;
    }

    function _checkViolation(text, toUid, otherName) {
        // فحص فقط إذا bot-commands محمّل
        if (!window.QamarBotCommands) return null;
        const BotsState = window.QamarBots && window.QamarBots.__state;
        const botState = window.QamarBots ? window.QamarBots.__getState && window.QamarBots.__getState() : null;
        return null;  // لا شيء هنا — سنستخدم واجهة QamarBotCommands
    }

    // ⭐ v2: يستخدم واجهة QamarBotCommands للمطابقة الموحّدة
    function _detectViolation(text) {
        if (!window.QamarBotCommands || typeof window.QamarBotCommands.testMatch !== 'function') {
            return null;
        }
        try {
            const m = window.QamarBotCommands.testMatch(text);
            if (!m) return null;
            if (m.kick) return { word: m.kick, severity: 'kick' };
            if (m.bad) return { word: m.bad, severity: 'jail' };
            return null;
        } catch (e) {
            return null;
        }
    }

    // ⭐ v2: يرسل للـ queue مع rate limit + dedup
    function _pushToQueue(text, toUid, otherName, otherAvatar) {
        if (!window.QamarGuardianQueue || typeof window.QamarGuardianQueue.push !== 'function') {
            return;
        }

        const viol = _detectViolation(text);
        if (!viol) return;

        const me = _getCurrentUid();
        if (!me) return;

        // rate limit — لا نُنبّه أكثر من مرة كل 30s لنفس المستخدم
        const lastPush = State.alertRateMap[me] || 0;
        if (_now() - lastPush < CONFIG.ALERT_RATE_MS) {
            Logger.debug('Queue alert rate-limited');
            return;
        }

        // dedup — نفس الكلمة خلال 5 دقائق
        const dedupKey = me + ':' + viol.word;
        const lastDedup = State.alertDedup[dedupKey] || 0;
        if (_now() - lastDedup < CONFIG.ALERT_DEDUP_TTL_MS) {
            Logger.debug('Queue alert deduplicated');
            return;
        }

        State.alertRateMap[me] = _now();
        State.alertDedup[dedupKey] = _now();

        // اجلب avatar المستخدم الحالي
        const meUser = _getCurrentUser() || {};

        window.QamarGuardianQueue.push({
            type: 'pm_violation',
            severity: viol.severity,
            suspectUid: me,
            suspectName: meUser.name || '—',
            suspectAvatar: meUser.avatar || null,
            victimUid: toUid,
            victimName: otherName || '—',
            matchedWord: viol.word,
            messagePreview: String(text).substring(0, 120),
            side: 'send'
        }).then(function () {
            Logger.info('📤 PM violation → queue |', viol.severity, '|', viol.word.substring(0, 3) + '...');
        }).catch(function (e) {
            Logger.warn('queue push failed:', e.message);
        });
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
        const now = _now();
        const rateMs = _getRateMs();
        if (now - State.lastSentAt < rateMs) {
            const rem = Math.ceil((rateMs - (now - State.lastSentAt)) / 1000);
            return { ok: false, remaining: rem || 1 };
        }
        if (text === State.lastSentText && (now - State.lastSentAt) < 3000) {
            return { ok: false, duplicate: true };
        }
        return { ok: true };
    }

    /* ══════════════════════════════════════════════ */
    /* Send                                            */
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
                // ⭐ v2: فحص المخالفة قبل الإرسال (لا يمنع الإرسال)
                if (clean) {
                    _pushToQueue(clean, toUid, options.otherName, options.otherAvatar);
                }

                const now = window.QamarFB.serverTime();
                const myUser = _getCurrentUser() || {};

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

                const payloadToThem = Object.assign({}, payloadFromMe, {
                    fromName: myUser.name || '—',
                    fromAvatar: myUser.avatar || null
                });

                const newRef = window.QamarFB.ref(_msgPath(me, toUid)).push();
                const msgId = newRef.key;

                const updates = {};
                updates[_msgPath(me, toUid) + '/' + msgId] = payloadFromMe;
                updates[_msgPath(toUid, me) + '/' + msgId] = payloadToThem;

                updates[_chatPath(me, toUid)] = {
                    otherUid: toUid,
                    otherName: options.otherName || '—',
                    otherAvatar: options.otherAvatar || null,
                    lastMessage: _preview(clean || '[مرفق]'),
                    lastTime: now,
                    lastFromMe: true,
                    unread: 0
                };

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
                State.lastSentAt = _now();
                State.lastSentText = clean;
                _setTyping(false, toUid);

                _emit('pm:sent', { toUid: toUid });
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
    /* Read                                            */
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

    function listChats() {
        const me = _getCurrentUid();
        if (!me) return Promise.resolve([]);
        return window.QamarFB.children(_chatPath(me, ''))
            .then(function (data) {
                if (!data) return [];
                const list = Object.keys(data).map(function (otherUid) {
                    return Object.assign({ otherUid: otherUid }, data[otherUid]);
                });
                let filtered = list.filter(function (c) { return !c.deletedAt; });
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
    /* Mark as read                                    */
    /* ══════════════════════════════════════════════ */
    function markAsRead(otherUid) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid) return { ok: false };

            const now = window.QamarFB.serverTime();
            const updates = {};
            updates[_chatPath(me, otherUid) + '/unread'] = 0;

            return window.QamarFB.get(_msgPath(me, otherUid)).then(function (data) {
                if (data) {
                    Object.keys(data).forEach(function (msgId) {
                        const m = data[msgId];
                        if (m && m.fromUid === otherUid && !m.read) {
                            updates[_msgPath(me, otherUid) + '/' + msgId + '/read'] = true;
                            updates[_msgPath(me, otherUid) + '/' + msgId + '/readAt'] = now;
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
    /* ⭐ v2: Typing — adaptive                       */
    /* ══════════════════════════════════════════════ */
    function _setTyping(isTyping, toUid) {
        const me = _getCurrentUid();
        if (!me || !toUid) return;

        // ⭐ v2: تعطيل على النت البطيء
        if (isTyping && !_isTypingEnabled()) return;

        const path = _typingPath(me, toUid);

        if (isTyping) {
            window.QamarFB.set(path, window.QamarFB.serverTime()).catch(function () {});
        } else {
            window.QamarFB.remove(path).catch(function () {});
        }
    }

    function setTyping(otherUid, isTyping) {
        if (State.typingTimer) {
            clearTimeout(State.typingTimer);
            State.typingTimer = null;
        }
        _setTyping(isTyping, otherUid);
        if (isTyping) {
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

    function _startTypingWatch(otherUid) {
        _stopTypingWatch();
        const me = _getCurrentUid();
        if (!me || !otherUid) return;

        // ⭐ v2: لا نستمع على النت البطيء
        if (!_isTypingEnabled()) return;

        const path = _typingPath(otherUid, me);
        State.typingListener = window.QamarFB.onValue(path, function (val) {
            const now = _now();
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
        return (_now() - t) < CONFIG.TYPING_TIMEOUT_MS;
    }

    /* ══════════════════════════════════════════════ */
    /* Delete                                          */
    /* ══════════════════════════════════════════════ */
    function deleteMessage(otherUid, msgId) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid || !msgId) throw new Error('بيانات ناقصة');

            const path = _msgPath(me, otherUid) + '/' + msgId;
            return window.QamarFB.get(path).then(function (m) {
                const updates = {};
                updates[path + '/deleted'] = true;
                updates[path + '/deletedAt'] = window.QamarFB.serverTime();
                updates[path + '/originalText'] = m ? (m.text || '') : '';
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

        const msgPath = _msgPath(me, otherUid);
        State.msgListener = window.QamarFB.onLatest(msgPath, CONFIG.MESSAGES_LIMIT, function (arr) {
            const list = arr.map(function (r) {
                return Object.assign({ _id: r.id }, r.data);
            });
            State.messages = list;
            _emit('pm:messages', { otherUid: otherUid, messages: list });
        }, function () {});

        _startTypingWatch(otherUid);
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
    /* Status helper                                   */
    /* ══════════════════════════════════════════════ */
    function getMessageStatus(msg) {
        if (!msg) return null;
        if (msg.read) return 'read';
        if (msg.delivered) return 'delivered';
        return 'sent';
    }

    /* ══════════════════════════════════════════════ */
    /* ⭐ v2: Adaptive bind                            */
    /* ══════════════════════════════════════════════ */
    function _bindAdaptive() {
        if (State._adaptiveBound) return;
        if (!window.QamarAdaptive || typeof window.QamarAdaptive.onFeatureChange !== 'function') {
            setTimeout(_bindAdaptive, 1000);
            return;
        }
        State._adaptiveBound = true;

        window.QamarAdaptive.onFeatureChange('typingEnabled', function (payload) {
            if (payload.value === false) {
                Logger.info('⏸️ Typing disabled (net slow)');
                _stopTypingWatch();
            } else if (State.currentChat) {
                Logger.info('▶️ Typing enabled — restarting watch');
                _startTypingWatch(State.currentChat);
            }
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;

        _bindAdaptive();

        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (!p.isLoggedIn) {
                    stop();
                    _unwatchChats();
                    State.chatsList = [];
                    State.unreadCount = 0;
                    State.alertDedup = {};
                    State.alertRateMap = {};
                } else if (p.uid) {
                    watchChats(function () {
                        getUnreadCount().then(function (n) {
                            _emit('pm:unread', { count: n });
                        });
                    });
                }
            });
        }

        Logger.info('📦 [pm.js v2] initialized');
    }

    if (window.QamarBoot && typeof window.QamarBoot.whenReady === 'function') {
        window.QamarBoot.whenReady('background', function () {
            setTimeout(_init, 800);
        });
    } else if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 1200);
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
            rateMs: _getRateMs(),
            typingEnabled: _isTypingEnabled(),
            queueAvailable: !!window.QamarGuardianQueue,
            alertDedupCount: Object.keys(State.alertDedup).length
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarPM = {
        __v2: true,
        CONFIG: CONFIG,

        send: send,
        sendWithAttachment: sendWithAttachment,
        sendReply: sendReply,

        getMessages: getMessages,
        listChats: listChats,
        getChat: getChat,
        getUnreadCount: getUnreadCount,
        getUnreadFrom: getUnreadFrom,

        markAsRead: markAsRead,
        markAllDelivered: markAllDelivered,
        getMessageStatus: getMessageStatus,

        deleteMessage: deleteMessage,
        deleteChat: deleteChat,
        restoreChat: restoreChat,

        blockUser: blockUser,
        unblockUser: unblockUser,
        isBlocked: isBlocked,
        isBlockedBy: isBlockedBy,

        start: start,
        stop: stop,
        watchChats: watchChats,

        setTyping: setTyping,
        stopTyping: stopTyping,
        isUserTyping: isUserTyping,

        onPMEvent: onPMEvent,

        getStatus: getStatus
    };

    Logger.info('📦 [pm.js v2] loaded — queue + adaptive');
})();
