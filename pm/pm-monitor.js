// ==============================================
// pm/pm-monitor.js
// King-only: read/restore/delete all PMs
// ==============================================
// يعتمد على: firebase.js + pm.js + pm-archiver.js + auth.js + ranks.js + audit.js
// يعطي: window.QamarPMMonitor
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [pm-monitor] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[MON]';
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
        MSG_ROOT: 'user_private_messages',
        ARCHIVE_ROOT: 'private_archive',
        CHATS_ROOT: 'user_private_chats',
        RATE_WINDOW_MS: 60000,
        RATE_MAX_OPS: 30,
        DEFAULT_LIMIT: 50,
        MAX_LIMIT: 300
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        rateMap: {},
        listeners: [],
        _initialized: false,
        cachedUsers: null,
        cachedAt: 0
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onMonitorEvent(cb) {
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

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _canMonitor() {
        return _isKing();
    }

    function _assertKing() {
        if (!_canMonitor()) throw new Error('فقط الملك يمكنه الوصول لهذه الميزة');
    }

    function _checkRate() {
        const uid = _getCurrentUid();
        if (!uid) return false;
        const now = Date.now();
        if (!State.rateMap[uid]) State.rateMap[uid] = [];
        State.rateMap[uid] = State.rateMap[uid].filter(function (t) {
            return now - t < CONFIG.RATE_WINDOW_MS;
        });
        if (State.rateMap[uid].length >= CONFIG.RATE_MAX_OPS) return false;
        State.rateMap[uid].push(now);
        return true;
    }

    function _msgPath(ownerUid, otherUid) {
        return CONFIG.MSG_ROOT + '/' + ownerUid + '/' + otherUid;
    }

    function _archivePath(ownerUid, otherUid) {
        return CONFIG.ARCHIVE_ROOT + '/' + ownerUid + '/' + otherUid;
    }

    function _chatPath(ownerUid, otherUid) {
        return CONFIG.CHATS_ROOT + '/' + ownerUid + '/' + otherUid;
    }

    function _preview(s, n) {
        s = String(s == null ? '' : s);
        n = n || 60;
        return s.length > n ? s.substring(0, n - 3) + '...' : s;
    }

    /* ══════════════════════════════════════════════ */
    /* List users                                      */
    /* ══════════════════════════════════════════════ */
    function listUsers(options) {
        options = options || {};
        return Promise.resolve().then(function () {
            _assertKing();
            const limit = Math.min(options.limit || CONFIG.DEFAULT_LIMIT, CONFIG.MAX_LIMIT);

            // 1) اقرأ كل من له رسائل (نشطة)
            return window.QamarFB.children(CONFIG.MSG_ROOT).then(function (active) {
                // 2) اقرأ كل من له أرشيف
                return window.QamarFB.children(CONFIG.ARCHIVE_ROOT).then(function (archived) {
                    const uids = {};
                    if (active) Object.keys(active).forEach(function (u) { uids[u] = true; });
                    if (archived) Object.keys(archived).forEach(function (u) { uids[u] = true; });

                    const uidList = Object.keys(uids).slice(0, limit);

                    // 3) اجلب بيانات المستخدمين
                    return Promise.all(uidList.map(function (uid) {
                        return window.QamarFB.get('users/' + uid).then(function (u) {
                            const activeChats = active && active[uid] ? Object.keys(active[uid]) : [];
                            const archivedChats = archived && archived[uid] ? Object.keys(archived[uid]) : [];
                            const allPartners = {};
                            activeChats.forEach(function (p) { allPartners[p] = true; });
                            archivedChats.forEach(function (p) { allPartners[p] = true; });
                            return {
                                uid: uid,
                                name: (u && u.name) || '—',
                                avatar: (u && u.avatar) || null,
                                rank: (u && u.rank) || 'User',
                                rankLevel: (u && Number(u.rankLevel)) || 0,
                                chatsCount: Object.keys(allPartners).length,
                                activeChats: activeChats.length,
                                archivedChats: archivedChats.length
                            };
                        }).catch(function () {
                            return { uid: uid, name: '—', chatsCount: 0 };
                        });
                    }));
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* List chats of a user                            */
    /* ══════════════════════════════════════════════ */
    function listChatsOf(ownerUid, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            _assertKing();
            if (!ownerUid) throw new Error('ownerUid مطلوب');
            const limit = Math.min(options.limit || CONFIG.DEFAULT_LIMIT, CONFIG.MAX_LIMIT);

            return window.QamarFB.children(_msgPath(ownerUid, '')).then(function (active) {
                return window.QamarFB.children(_archivePath(ownerUid, '')).then(function (archived) {
                    const map = {};

                    if (active) {
                        Object.keys(active).forEach(function (otherUid) {
                            const msgs = active[otherUid] || {};
                            const arr = Object.keys(msgs).map(function (k) { return msgs[k]; });
                            arr.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
                            const last = arr[0];
                            map[otherUid] = {
                                otherUid: otherUid,
                                activeCount: arr.length,
                                archivedCount: 0,
                                lastMessage: last ? _preview(last.text) : '',
                                lastTime: last ? last.time : 0,
                                unread: 0
                            };
                        });
                    }

                    if (archived) {
                        Object.keys(archived).forEach(function (otherUid) {
                            const msgs = archived[otherUid] || {};
                            const n = Object.keys(msgs).length;
                            if (!map[otherUid]) {
                                map[otherUid] = {
                                    otherUid: otherUid,
                                    activeCount: 0,
                                    archivedCount: n,
                                    lastMessage: '',
                                    lastTime: 0,
                                    unread: 0
                                };
                            } else {
                                map[otherUid].archivedCount = n;
                            }
                        });
                    }

                    // اجلب أسماء + unread
                    const otherUids = Object.keys(map);
                    return Promise.all(otherUids.map(function (otherUid) {
                        return Promise.all([
                            window.QamarFB.get('users/' + otherUid).catch(function () { return null; }),
                            window.QamarFB.get(_chatPath(ownerUid, otherUid)).catch(function () { return null; })
                        ]).then(function (r) {
                            const u = r[0], chat = r[1];
                            const entry = map[otherUid];
                            entry.otherName = (u && u.name) || '—';
                            entry.otherAvatar = (u && u.avatar) || null;
                            entry.otherRank = (u && u.rank) || 'User';
                            entry.unread = (chat && Number(chat.unread)) || 0;
                            entry.deletedAt = (chat && chat.deletedAt) || null;
                            return entry;
                        });
                    })).then(function (list) {
                        list.sort(function (a, b) { return (b.lastTime || 0) - (a.lastTime || 0); });
                        return list.slice(0, limit);
                    });
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* List messages (merge both sides)                */
    /* ══════════════════════════════════════════════ */
    function listMessages(ownerUid, otherUid, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            _assertKing();
            if (!ownerUid || !otherUid) throw new Error('uid مطلوب');

            const limit = Math.min(options.limit || CONFIG.DEFAULT_LIMIT, CONFIG.MAX_LIMIT);
            const includeArchive = options.includeArchive !== false; // default true
            const includeDeleted = options.includeDeleted !== false; // default true

            const promises = [
                window.QamarFB.get(_msgPath(ownerUid, otherUid)).catch(function () { return {}; }),
                window.QamarFB.get(_msgPath(otherUid, ownerUid)).catch(function () { return {}; })
            ];
            if (includeArchive) {
                promises.push(window.QamarFB.get(_archivePath(ownerUid, otherUid)).catch(function () { return {}; }));
                promises.push(window.QamarFB.get(_archivePath(otherUid, ownerUid)).catch(function () { return {}; }));
            }

            return Promise.all(promises).then(function (results) {
                const merged = {};  // msgId → best version

                function _addAll(container, isArchive) {
                    if (!container) return;
                    Object.keys(container).forEach(function (msgId) {
                        const m = Object.assign({ _id: msgId }, container[msgId]);
                        if (isArchive) m._archived = true;
                        // دمج — أفضل نسخة (التي فيها read/delivered)
                        const prev = merged[msgId];
                        if (!prev) {
                            merged[msgId] = m;
                        } else {
                            // احتفظ بالحقول الأكثر اكتمالاً
                            merged[msgId] = Object.assign({}, prev, m);
                        }
                    });
                }

                _addAll(results[0], false);
                _addAll(results[1], false);
                if (includeArchive && results[2]) _addAll(results[2], true);
                if (includeArchive && results[3]) _addAll(results[3], true);

                let list = Object.keys(merged).map(function (k) { return merged[k]; });

                if (!includeDeleted) {
                    list = list.filter(function (m) { return !m.deleted; });
                }

                list.sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
                if (list.length > limit) list = list.slice(-limit);

                return list;
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Get single message                              */
    /* ══════════════════════════════════════════════ */
    function getMessage(ownerUid, otherUid, msgId) {
        return Promise.resolve().then(function () {
            _assertKing();
            if (!ownerUid || !otherUid || !msgId) throw new Error('بيانات ناقصة');
            // جرب من نسخة owner
            return window.QamarFB.get(_msgPath(ownerUid, otherUid) + '/' + msgId).then(function (m) {
                if (m) return Object.assign({ _id: msgId, _side: 'owner' }, m);
                return window.QamarFB.get(_msgPath(otherUid, ownerUid) + '/' + msgId).then(function (m2) {
                    if (m2) return Object.assign({ _id: msgId, _side: 'other' }, m2);
                    return window.QamarFB.get(_archivePath(ownerUid, otherUid) + '/' + msgId).then(function (m3) {
                        if (m3) return Object.assign({ _id: msgId, _side: 'owner-archived', _archived: true }, m3);
                        return null;
                    });
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Get deleted messages                            */
    /* ══════════════════════════════════════════════ */
    function getDeletedMessages(ownerUid, otherUid) {
        return listMessages(ownerUid, otherUid, {
            includeArchive: true,
            includeDeleted: true,
            limit: CONFIG.MAX_LIMIT
        }).then(function (list) {
            return list.filter(function (m) { return m.deleted; });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Restore message                                 */
    /* ══════════════════════════════════════════════ */
    function restoreMessage(ownerUid, otherUid, msgId) {
        return Promise.resolve().then(function () {
            _assertKing();
            if (!_checkRate()) throw new Error('محاولات كثيرة — انتظر');
            if (!ownerUid || !otherUid || !msgId) throw new Error('بيانات ناقصة');

            // اقرأ الرسالة من النسختين
            return Promise.all([
                window.QamarFB.get(_msgPath(ownerUid, otherUid) + '/' + msgId).catch(function () { return null; }),
                window.QamarFB.get(_msgPath(otherUid, ownerUid) + '/' + msgId).catch(function () { return null; })
            ]).then(function (res) {
                const a = res[0], b = res[1];
                const src = a || b;
                if (!src) throw new Error('الرسالة غير موجودة');

                const original = src.originalText || src.text || '';
                if (!original) throw new Error('لا يوجد نص أصلي للاسترجاع');

                const now = window.QamarFB.serverTime();
                const patch = {
                    text: original,
                    deleted: false,
                    deletedAt: null,
                    deletedBy: null,
                    restored: true,
                    restoredAt: now,
                    restoredBy: _getCurrentUid()
                };

                const updates = {};
                if (a !== null) {
                    Object.keys(patch).forEach(function (k) {
                        updates[_msgPath(ownerUid, otherUid) + '/' + msgId + '/' + k] = patch[k];
                    });
                }
                if (b !== null) {
                    Object.keys(patch).forEach(function (k) {
                        updates[_msgPath(otherUid, ownerUid) + '/' + msgId + '/' + k] = patch[k];
                    });
                }

                return window.QamarFB.multiUpdate(updates).then(function () {
                    if (window.QamarAudit) {
                        window.QamarAudit.log('deletePM', {
                            targetUid: ownerUid,
                            msgId: msgId,
                            reason: 'restore message'
                        });
                    }
                    _emit('monitor:messageRestored', {
                        ownerUid: ownerUid, otherUid: otherUid, msgId: msgId
                    });
                    Logger.info('↩️ Message restored:', msgId);
                    return { ok: true };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Delete message                                  */
    /* ══════════════════════════════════════════════ */
    function deleteMessage(ownerUid, otherUid, msgId, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            _assertKing();
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            if (!ownerUid || !otherUid || !msgId) throw new Error('بيانات ناقصة');

            const permanent = !!options.permanent;
            const bothSides = options.bothSides !== false; // default true

            const updates = {};
            if (permanent) {
                updates[_msgPath(ownerUid, otherUid) + '/' + msgId] = null;
                if (bothSides) updates[_msgPath(otherUid, ownerUid) + '/' + msgId] = null;
                updates[_archivePath(ownerUid, otherUid) + '/' + msgId] = null;
                if (bothSides) updates[_archivePath(otherUid, ownerUid) + '/' + msgId] = null;
            } else {
                const now = window.QamarFB.serverTime();
                const patch = {
                    deleted: true,
                    deletedAt: now,
                    deletedBy: _getCurrentUid(),
                    deletedByKing: true
                };
                // نحفظ النص الأصلي
                return window.QamarFB.get(_msgPath(ownerUid, otherUid) + '/' + msgId).then(function (m) {
                    if (m && !m.originalText) {
                        patch.originalText = m.text || '';
                    }
                    Object.keys(patch).forEach(function (k) {
                        updates[_msgPath(ownerUid, otherUid) + '/' + msgId + '/' + k] = patch[k];
                    });
                    if (bothSides) {
                        Object.keys(patch).forEach(function (k) {
                            updates[_msgPath(otherUid, ownerUid) + '/' + msgId + '/' + k] = patch[k];
                        });
                    }
                    updates[_msgPath(ownerUid, otherUid) + '/' + msgId + '/text'] = '';
                    updates[_msgPath(ownerUid, otherUid) + '/' + msgId + '/attachment'] = null;
                    if (bothSides) {
                        updates[_msgPath(otherUid, ownerUid) + '/' + msgId + '/text'] = '';
                        updates[_msgPath(otherUid, ownerUid) + '/' + msgId + '/attachment'] = null;
                    }
                    return null;
                });
            }
            return null;
        }).then(function () {
            // نفّذ الحذف الدائم بعد التجهيز
            // (نتعامل مع الحالتين في promise chain أعلاه)
            return true;
        }).then(function () {
            // الحذف الدائم يستخدم updates مباشرة في التنفيذ
            // نعيد هنا في حالة soft فقط
            return { ok: true, permanent: false };
        });
    }

    // نسخة موحّدة تعمل فعلياً
    function deleteMessageSafe(ownerUid, otherUid, msgId, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            _assertKing();
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            if (!ownerUid || !otherUid || !msgId) throw new Error('بيانات ناقصة');

            const permanent = !!options.permanent;
            const bothSides = options.bothSides !== false;

            if (permanent) {
                const updates = {};
                updates[_msgPath(ownerUid, otherUid) + '/' + msgId] = null;
                if (bothSides) updates[_msgPath(otherUid, ownerUid) + '/' + msgId] = null;
                updates[_archivePath(ownerUid, otherUid) + '/' + msgId] = null;
                if (bothSides) updates[_archivePath(otherUid, ownerUid) + '/' + msgId] = null;

                return window.QamarFB.multiUpdate(updates).then(function () {
                    if (window.QamarAudit) {
                        window.QamarAudit.log('deletePM', {
                            targetUid: ownerUid, msgId: msgId,
                            reason: 'permanent delete by King'
                        });
                    }
                    _emit('monitor:messageDeleted', {
                        ownerUid: ownerUid, otherUid: otherUid, msgId: msgId, permanent: true
                    });
                    return { ok: true, permanent: true };
                });
            }

            // soft
            return window.QamarFB.get(_msgPath(ownerUid, otherUid) + '/' + msgId).then(function (m) {
                if (!m) {
                    return window.QamarFB.get(_msgPath(otherUid, ownerUid) + '/' + msgId).then(function (m2) {
                        return m2;
                    });
                }
                return m;
            }).then(function (existing) {
                if (!existing) throw new Error('الرسالة غير موجودة');

                const now = window.QamarFB.serverTime();
                const patch = {
                    deleted: true,
                    deletedAt: now,
                    deletedBy: _getCurrentUid(),
                    deletedByKing: true,
                    originalText: existing.originalText || existing.text || '',
                    text: '',
                    attachment: null
                };

                const updates = {};
                Object.keys(patch).forEach(function (k) {
                    updates[_msgPath(ownerUid, otherUid) + '/' + msgId + '/' + k] = patch[k];
                });
                if (bothSides) {
                    Object.keys(patch).forEach(function (k) {
                        updates[_msgPath(otherUid, ownerUid) + '/' + msgId + '/' + k] = patch[k];
                    });
                }

                return window.QamarFB.multiUpdate(updates).then(function () {
                    if (window.QamarAudit) {
                        window.QamarAudit.log('deletePM', {
                            targetUid: ownerUid, msgId: msgId,
                            reason: 'soft delete by King'
                        });
                    }
                    _emit('monitor:messageDeleted', {
                        ownerUid: ownerUid, otherUid: otherUid, msgId: msgId, permanent: false
                    });
                    return { ok: true, permanent: false };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Delete all deleted messages of a chat          */
    /* ══════════════════════════════════════════════ */
    function deleteAllDeleted(ownerUid, otherUid, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            _assertKing();
            if (!ownerUid || !otherUid) throw new Error('uid مطلوب');

            const bothSides = options.bothSides !== false;

            return getDeletedMessages(ownerUid, otherUid).then(function (list) {
                if (list.length === 0) return { deleted: 0 };
                const updates = {};
                list.forEach(function (m) {
                    if (!m || !m._id) return;
                    updates[_msgPath(ownerUid, otherUid) + '/' + m._id] = null;
                    if (bothSides) updates[_msgPath(otherUid, ownerUid) + '/' + m._id] = null;
                    updates[_archivePath(ownerUid, otherUid) + '/' + m._id] = null;
                    if (bothSides) updates[_archivePath(otherUid, ownerUid) + '/' + m._id] = null;
                });

                return window.QamarFB.multiUpdate(updates).then(function () {
                    if (window.QamarAudit) {
                        window.QamarAudit.log('deletePM', {
                            targetUid: ownerUid,
                            reason: 'purge deleted messages',
                            amount: list.length
                        });
                    }
                    _emit('monitor:messagesPurged', {
                        ownerUid: ownerUid, otherUid: otherUid, count: list.length
                    });
                    return { deleted: list.length };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Delete entire chat                              */
    /* ══════════════════════════════════════════════ */
    function deleteChat(ownerUid, otherUid, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            _assertKing();
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            if (!ownerUid || !otherUid) throw new Error('uid مطلوب');

            const side = options.side || 'both'; // 'owner' | 'other' | 'both'

            const updates = {};
            if (side === 'owner' || side === 'both') {
                updates[_msgPath(ownerUid, otherUid)] = null;
                updates[_archivePath(ownerUid, otherUid)] = null;
                updates[_chatPath(ownerUid, otherUid)] = null;
            }
            if (side === 'other' || side === 'both') {
                updates[_msgPath(otherUid, ownerUid)] = null;
                updates[_archivePath(otherUid, ownerUid)] = null;
                updates[_chatPath(otherUid, ownerUid)] = null;
            }

            return window.QamarFB.multiUpdate(updates).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('deletePM', {
                        targetUid: ownerUid,
                        reason: 'delete entire chat (' + side + ')',
                        details: { otherUid: otherUid, side: side }
                    });
                }
                _emit('monitor:chatDeleted', {
                    ownerUid: ownerUid, otherUid: otherUid, side: side
                });
                Logger.info('🗑️ Chat deleted:', side);
                return { ok: true, side: side };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Stats                                           */
    /* ══════════════════════════════════════════════ */
    function getStats(ownerUid) {
        return Promise.resolve().then(function () {
            _assertKing();
            if (!ownerUid) throw new Error('uid مطلوب');

            return Promise.all([
                window.QamarFB.get(_msgPath(ownerUid, '')).catch(function () { return {}; }),
                window.QamarFB.get(_archivePath(ownerUid, '')).catch(function () { return {}; })
            ]).then(function (r) {
                const active = r[0] || {};
                const archived = r[1] || {};
                let activeMsgs = 0, archivedMsgs = 0, deletedMsgs = 0;

                Object.keys(active).forEach(function (otherUid) {
                    const chat = active[otherUid] || {};
                    Object.keys(chat).forEach(function (msgId) {
                        activeMsgs++;
                        if (chat[msgId] && chat[msgId].deleted) deletedMsgs++;
                    });
                });
                Object.keys(archived).forEach(function (otherUid) {
                    const chat = archived[otherUid] || {};
                    archivedMsgs += Object.keys(chat).length;
                });

                return {
                    uid: ownerUid,
                    chats: Object.keys(active).length,
                    activeMessages: activeMsgs,
                    archivedMessages: archivedMsgs,
                    deletedMessages: deletedMsgs,
                    total: activeMsgs + archivedMsgs
                };
            });
        });
    }

    function getGlobalStats() {
        return Promise.resolve().then(function () {
            _assertKing();
            return window.QamarFB.children(CONFIG.MSG_ROOT).then(function (active) {
                return window.QamarFB.children(CONFIG.ARCHIVE_ROOT).then(function (archived) {
                    const activeUsers = active ? Object.keys(active).length : 0;
                    const archivedUsers = archived ? Object.keys(archived).length : 0;
                    let totalMsgs = 0, totalArchived = 0;

                    if (active) {
                        Object.keys(active).forEach(function (u) {
                            Object.keys(active[u] || {}).forEach(function (o) {
                                totalMsgs += Object.keys(active[u][o] || {}).length;
                            });
                        });
                    }
                    if (archived) {
                        Object.keys(archived).forEach(function (u) {
                            Object.keys(archived[u] || {}).forEach(function (o) {
                                totalArchived += Object.keys(archived[u][o] || {}).length;
                            });
                        });
                    }

                    return {
                        users: activeUsers,
                        usersWithArchive: archivedUsers,
                        activeMessages: totalMsgs,
                        archivedMessages: totalArchived,
                        total: totalMsgs + totalArchived
                    };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Search users (client-side)                      */
    /* ══════════════════════════════════════════════ */
    function searchUsers(query, options) {
        options = options || {};
        return listUsers(options).then(function (list) {
            const q = String(query || '').trim().toLowerCase();
            if (!q) return list;
            return list.filter(function (u) {
                return (u.name || '').toLowerCase().indexOf(q) !== -1 ||
                       (u.uid || '').toLowerCase().indexOf(q) !== -1;
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        const uid = _getCurrentUid();
        return {
            initialized: State._initialized,
            isKing: _isKing(),
            canMonitor: _canMonitor(),
            rateUsed: uid ? (State.rateMap[uid] || []).length : 0,
            rateMax: CONFIG.RATE_MAX_OPS
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;
        Logger.info('📦 [pm-monitor.js] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 2200);
        });
    } else {
        setTimeout(_init, 7000);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarPMMonitor = {
        CONFIG: CONFIG,

        // Lists
        listUsers: listUsers,
        listChatsOf: listChatsOf,
        listMessages: listMessages,

        // Single
        getMessage: getMessage,
        getDeletedMessages: getDeletedMessages,

        // Restore
        restoreMessage: restoreMessage,

        // Delete
        deleteMessage: deleteMessageSafe,
        deleteAllDeleted: deleteAllDeleted,
        deleteChat: deleteChat,

        // Stats
        getStats: getStats,
        getGlobalStats: getGlobalStats,

        // Search
        searchUsers: searchUsers,

        // Events
        onMonitorEvent: onMonitorEvent,

        // Debug
        getStatus: getStatus
    };

    Logger.info('📦 [pm-monitor.js] loaded');
})();
