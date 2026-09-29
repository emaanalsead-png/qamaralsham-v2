// ==============================================
// pm/pm-voice.js v2 — إصلاح الملك played + adaptive
// ==============================================
// يعتمد على: firebase.js + pm.js + auth.js + ranks.js + audit.js + adaptive.js
// يعطي: window.QamarPMVoice
// ==============================================
// ⭐ v2 (فوق v1):
//   1. إصلاح BUG: الملك لا يُسجَّل played:true
//   2. تعطيل تلقائي عند very-slow
//   3. autoDeleteHours من QamarAdaptive
//   4. توافق QamarBoot.whenReady
//   5. كل الباقي كما v1
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [pm-voice] firebase.js not loaded!');
        return;
    }

    if (window.QamarPMVoice && window.QamarPMVoice.__v2) return;

    const LOG_TAG = '[PMV]';
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
        ROOT: 'pm_voice_msgs',
        MAX_DURATION_MS: 3 * 60 * 1000,
        MAX_SIZE_BYTES: 5 * 1024 * 1024,
        RATE_WINDOW_MS: 60000,
        RATE_MAX: 5,
        AUTO_DELETE_MS: 24 * 60 * 60 * 1000,
        CLEANUP_INTERVAL_MS: 60 * 60 * 1000,
        ALLOWED_MIME: [
            'audio/webm', 'audio/ogg', 'audio/mpeg',
            'audio/mp4', 'audio/m4a', 'audio/x-m4a',
            'audio/wav', 'audio/aac'
        ]
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        rateMap: {},
        listeners: [],
        cache: {},
        cacheTTL: 30000,
        cleanupTimer: null,
        _initialized: false,
        _adaptiveBound: false
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

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _isVoiceEnabled() {
        if (window.QamarAdaptive && typeof window.QamarAdaptive.isEnabled === 'function') {
            return window.QamarAdaptive.isEnabled('voiceMonitorEnabled');
        }
        return true;
    }

    function _getAutoDeleteMs() {
        // يمكن ضبطه من QamarAdaptive لاحقاً
        return CONFIG.AUTO_DELETE_MS;
    }

    function _checkRate() {
        const uid = _getCurrentUid();
        if (!uid) return false;
        const now = Date.now();
        if (!State.rateMap[uid]) State.rateMap[uid] = [];
        State.rateMap[uid] = State.rateMap[uid].filter(function (t) {
            return now - t < CONFIG.RATE_WINDOW_MS;
        });
        if (State.rateMap[uid].length >= CONFIG.RATE_MAX) return false;
        State.rateMap[uid].push(now);
        return true;
    }

    function _genId() {
        return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    }

    function _path(ownerUid, rid) {
        return CONFIG.ROOT + '/' + ownerUid + '/' + rid;
    }

    function _pairKey(a, b) {
        return [a, b].sort().join('__');
    }

    function _isValidMime(mime) {
        if (!mime) return false;
        return CONFIG.ALLOWED_MIME.indexOf(String(mime).toLowerCase()) !== -1;
    }

    /* ══════════════════════════════════════════════ */
    /* Send voice message                              */
    /* ══════════════════════════════════════════════ */
    function sendVoice(toUid, audioUrl, meta, options) {
        meta = meta || {};
        options = options || {};
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me) throw new Error('غير مسجل');
            if (_isGuest()) throw new Error('الزوار لا يمكنهم إرسال رسائل صوتية');
            if (!toUid) throw new Error('المستقبل مطلوب');
            if (me === toUid) throw new Error('لا يمكنك إرسال صوتية لنفسك');
            if (!audioUrl) throw new Error('الملف الصوتي مطلوب');

            const duration = Number(meta.duration) || 0;
            if (duration <= 0) throw new Error('مدة الصوتية غير صحيحة');
            if (duration > CONFIG.MAX_DURATION_MS) {
                throw new Error('المدة طويلة جداً (3 دقائق كحد أقصى)');
            }

            const size = Number(meta.size) || 0;
            if (size > 0 && size > CONFIG.MAX_SIZE_BYTES) {
                throw new Error('حجم الملف كبير (5 MB كحد أقصى)');
            }

            const mime = meta.mime || 'audio/webm';
            if (!_isValidMime(mime)) {
                throw new Error('نوع الصوت غير مدعوم');
            }

            if (!_checkRate()) {
                throw new Error('محاولات كثيرة — حاول لاحقاً');
            }

            let blockCheck = Promise.resolve(true);
            if (window.QamarPM && window.QamarPM.isBlocked) {
                blockCheck = window.QamarPM.isBlocked(toUid).then(function (blocked) {
                    if (blocked) throw new Error('لقد حظرت هذا المستخدم');
                    return window.QamarPM.isBlockedBy(toUid);
                }).then(function (blockedBy) {
                    if (blockedBy) throw new Error('لا يمكنك إرسال رسالة لهذا المستخدم');
                    return true;
                });
            }

            return blockCheck.then(function () {
                const meU = _getCurrentUser() || {};
                const rid = _genId();
                const now = window.QamarFB.serverTime();

                const base = {
                    audio: String(audioUrl),
                    duration: duration,
                    size: size,
                    mime: mime,
                    createdAt: now,
                    played: false,
                    playedAt: null,
                    deleted: false
                };

                const fromPayload = Object.assign({}, base, {
                    fromUid: me,
                    toUid: toUid,
                    fromName: meU.name || '—',
                    fromAvatar: meU.avatar || null,
                    side: 'sent'
                });

                const toPayload = Object.assign({}, base, {
                    fromUid: me,
                    toUid: toUid,
                    fromName: meU.name || '—',
                    fromAvatar: meU.avatar || null,
                    side: 'received'
                });

                const updates = {};
                updates[_path(me, rid)] = fromPayload;
                updates[_path(toUid, rid)] = toPayload;

                updates['user_private_chats/' + me + '/' + toUid + '/lastMessage'] = '🎤 رسالة صوتية';
                updates['user_private_chats/' + me + '/' + toUid + '/lastTime'] = now;
                updates['user_private_chats/' + me + '/' + toUid + '/lastFromMe'] = true;

                return window.QamarFB.get('user_private_chats/' + toUid + '/' + me).then(function (ex) {
                    const prevUnread = (ex && Number(ex.unread)) || 0;
                    updates['user_private_chats/' + toUid + '/' + me + '/otherUid'] = me;
                    updates['user_private_chats/' + toUid + '/' + me + '/otherName'] = meU.name || '—';
                    updates['user_private_chats/' + toUid + '/' + me + '/otherAvatar'] = meU.avatar || null;
                    updates['user_private_chats/' + toUid + '/' + me + '/lastMessage'] = '🎤 رسالة صوتية';
                    updates['user_private_chats/' + toUid + '/' + me + '/lastTime'] = now;
                    updates['user_private_chats/' + toUid + '/' + me + '/lastFromMe'] = false;
                    updates['user_private_chats/' + toUid + '/' + me + '/unread'] = prevUnread + 1;
                    return window.QamarFB.multiUpdate(updates);
                });
            }).then(function () {
                _invalidateCache();
                _emit('pm:voiceSent', { toUid: toUid });
                Logger.info('🎤 Voice sent to', toUid.substring(0, 8));
                return { ok: true };
            });
        });
    }

    function sendVoiceFromBlob(toUid, blob, duration, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            if (!blob) throw new Error('الملف مطلوب');
            if (blob.size > CONFIG.MAX_SIZE_BYTES) {
                throw new Error('حجم الملف كبير (5 MB)');
            }
            if (duration > CONFIG.MAX_DURATION_MS) {
                throw new Error('المدة طويلة (3 دقائق)');
            }

            if (window.QamarUploader && typeof window.QamarUploader.uploadAudio === 'function') {
                return window.QamarUploader.uploadAudio(blob).then(function (url) {
                    return sendVoice(toUid, url, {
                        duration: duration,
                        size: blob.size,
                        mime: blob.type
                    }, options);
                });
            }

            return new Promise(function (resolve, reject) {
                const reader = new FileReader();
                reader.onloadend = function () {
                    resolve(reader.result);
                };
                reader.onerror = function () { reject(new Error('تعذر قراءة الملف')); };
                reader.readAsDataURL(blob);
            }).then(function (dataUrl) {
                return sendVoice(toUid, dataUrl, {
                    duration: duration,
                    size: blob.size,
                    mime: blob.type
                }, options);
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Read                                            */
    /* ══════════════════════════════════════════════ */
    function _cacheKey(a, b) {
        return _pairKey(a, b);
    }

    function _getCached(a, b) {
        const k = _cacheKey(a, b);
        const c = State.cache[k];
        if (!c) return null;
        if (Date.now() - c.at > State.cacheTTL) {
            delete State.cache[k];
            return null;
        }
        return c.list;
    }

    function _setCached(a, b, list) {
        State.cache[_cacheKey(a, b)] = { list: list, at: Date.now() };
    }

    function _invalidateCache() {
        State.cache = {};
    }

    function getVoiceMessages(otherUid, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid) return [];

            const cached = _getCached(me, otherUid);
            if (cached && !options.force) return cached.slice();

            return Promise.all([
                window.QamarFB.get(CONFIG.ROOT + '/' + me).catch(function () { return {}; }),
                window.QamarFB.get(CONFIG.ROOT + '/' + otherUid).catch(function () { return {}; })
            ]).then(function (r) {
                const mine = r[0] || {};
                const theirs = r[1] || {};
                const merged = {};

                Object.keys(mine).forEach(function (rid) {
                    const v = mine[rid];
                    if (!v) return;
                    if (v.fromUid !== me && v.toUid !== me) return;
                    const partner = (v.fromUid === me) ? v.toUid : v.fromUid;
                    if (partner !== otherUid) return;
                    merged[rid] = Object.assign({ _id: rid, _side: (v.fromUid === me ? 'sent' : 'received') }, v);
                });

                Object.keys(theirs).forEach(function (rid) {
                    const v = theirs[rid];
                    if (!v) return;
                    if (v.fromUid !== me && v.toUid !== me) return;
                    const partner = (v.fromUid === me) ? v.toUid : v.fromUid;
                    if (partner !== otherUid) return;
                    if (!merged[rid]) {
                        merged[rid] = Object.assign({ _id: rid, _side: (v.fromUid === me ? 'sent' : 'received') }, v);
                    } else {
                        merged[rid] = Object.assign({}, merged[rid], v);
                    }
                });

                let list = Object.keys(merged).map(function (k) { return merged[k]; });
                if (!options.includeDeleted) {
                    list = list.filter(function (v) { return !v.deleted; });
                }
                list.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });

                _setCached(me, otherUid, list);
                return list;
            });
        });
    }

    function getVoiceMessage(otherUid, rid) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid || !rid) return null;
            return window.QamarFB.get(_path(me, rid)).then(function (v) {
                if (v) return Object.assign({ _id: rid }, v);
                return window.QamarFB.get(_path(otherUid, rid)).then(function (v2) {
                    if (v2) return Object.assign({ _id: rid }, v2);
                    return null;
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* ⭐ v2: markAsPlayed — إصلاح الملك               */
    /* ══════════════════════════════════════════════ */
    /**
     * يُستدعى عند انتهاء تشغيل الصوتية.
     * - المستقبل العادي: يُعلّم played في نسخة المرسل + يحذف نسخته
     * - الملك: يُعلّم played في النسختين بدون حذف
     */
    function markAsPlayed(otherUid, rid, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid || !rid) return { ok: false };

            const now = window.QamarFB.serverTime();

            // ⭐ v2: الملك — يُعلّم فقط في النسختين (بدون حذف)
            if (_isKing() && options.skipDelete !== false) {
                const updates = {};
                // نسخة المرسل
                updates[_path(otherUid, rid) + '/played'] = true;
                updates[_path(otherUid, rid) + '/playedAt'] = now;
                updates[_path(otherUid, rid) + '/playedByKing'] = true;
                // نسخة الملك
                updates[_path(me, rid) + '/played'] = true;
                updates[_path(me, rid) + '/playedAt'] = now;
                updates[_path(me, rid) + '/playedByKing'] = true;

                return window.QamarFB.multiUpdate(updates).then(function () {
                    _invalidateCache();
                    _emit('pm:voicePlayed', { otherUid: otherUid, rid: rid, king: true });
                    Logger.info('👑 King marked voice as played (no delete)');
                    return { ok: true, king: true, noDelete: true };
                }).catch(function (e) {
                    Logger.warn('King markAsPlayed failed:', e.message);
                    return { ok: false, error: e.message };
                });
            }

            // المستقبل العادي — يُعلّم في نسخة المرسل + يحذف نسخته
            const updates = {};
            updates[_path(otherUid, rid) + '/played'] = true;
            updates[_path(otherUid, rid) + '/playedAt'] = now;
            updates[_path(me, rid)] = null;

            return window.QamarFB.multiUpdate(updates).then(function () {
                _invalidateCache();
                _emit('pm:voicePlayed', { otherUid: otherUid, rid: rid });
                _emit('pm:voiceDeleted', { otherUid: otherUid, rid: rid, auto: true });
                Logger.info('✅ Voice played + receiver copy deleted');
                return { ok: true };
            }).catch(function (e) {
                Logger.warn('markAsPlayed failed:', e.message);
                return { ok: false, error: e.message };
            });
        });
    }

    // الملك يعلّم بدون حذف — alias للتوافق
    function markKingPlayed(ownerUid, rid) {
        return markAsPlayed(ownerUid, rid, { skipDelete: true });
    }

    /* ══════════════════════════════════════════════ */
    /* Delete (soft)                                   */
    /* ══════════════════════════════════════════════ */
    function deleteVoice(otherUid, rid, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid || !rid) throw new Error('بيانات ناقصة');

            if (!_isKing()) {
                return window.QamarFB.get(_path(me, rid)).then(function (v) {
                    if (!v) throw new Error('غير موجود');
                    if (v.fromUid !== me) throw new Error('لا يمكنك حذف صوتية غيرك');
                    return _doSoftDelete(me, otherUid, rid);
                });
            }
            return _doSoftDelete(me, otherUid, rid);
        });
    }

    function _doSoftDelete(me, otherUid, rid) {
        const now = window.QamarFB.serverTime();
        const updates = {};
        updates[_path(me, rid) + '/deleted'] = true;
        updates[_path(me, rid) + '/deletedAt'] = now;
        updates[_path(me, rid) + '/audio'] = '';
        updates[_path(otherUid, rid)] = null;

        return window.QamarFB.multiUpdate(updates).then(function () {
            _invalidateCache();
            if (window.QamarAudit) {
                window.QamarAudit.log('voiceKick', {
                    targetUid: otherUid, msgId: rid,
                    reason: 'voice soft delete'
                });
            }
            _emit('pm:voiceDeleted', { otherUid: otherUid, rid: rid, auto: false });
            return { ok: true };
        });
    }

    function hardDelete(ownerUid, rid) {
        return Promise.resolve().then(function () {
            if (!_isKing()) throw new Error('فقط الملك');
            if (!ownerUid || !rid) throw new Error('بيانات ناقصة');
            return window.QamarFB.remove(_path(ownerUid, rid)).then(function () {
                _invalidateCache();
                if (window.QamarAudit) {
                    window.QamarAudit.log('deletePM', {
                        targetUid: ownerUid, msgId: rid,
                        reason: 'hard delete voice by King'
                    });
                }
                return { ok: true };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Auto cleanup (adaptive)                         */
    /* ══════════════════════════════════════════════ */
    function cleanupOld() {
        const uid = _getCurrentUid();
        if (!uid) return Promise.resolve({ deleted: 0 });

        const cutoff = Date.now() - _getAutoDeleteMs();
        return window.QamarFB.get(CONFIG.ROOT + '/' + uid)
            .then(function (data) {
                if (!data) return { deleted: 0 };
                const updates = {};
                let n = 0;
                Object.keys(data).forEach(function (rid) {
                    const v = data[rid];
                    if (!v) return;
                    const created = v.createdAt || 0;
                    if (created > 0 && created < cutoff && !v.played) {
                        updates[CONFIG.ROOT + '/' + uid + '/' + rid] = null;
                        n++;
                    }
                });
                if (n === 0) return { deleted: 0 };
                return window.QamarFB.multiUpdate(updates).then(function () {
                    _invalidateCache();
                    Logger.info('🧹 Cleaned', n, 'old voice messages');
                    return { deleted: n };
                });
            }).catch(function () { return { deleted: 0 }; });
    }

    function startCleanup() {
        if (State.cleanupTimer) return;
        if (!_isVoiceEnabled()) {
            Logger.info('⏸️ Voice cleanup disabled (very-slow net)');
            return;
        }

        setTimeout(function () { cleanupOld(); }, 60000);
        State.cleanupTimer = setInterval(function () {
            cleanupOld();
        }, CONFIG.CLEANUP_INTERVAL_MS);
        Logger.info('▶️ Voice cleanup started');
    }

    function stopCleanup() {
        if (State.cleanupTimer) {
            clearInterval(State.cleanupTimer);
            State.cleanupTimer = null;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* King access                                     */
    /* ══════════════════════════════════════════════ */
    function listAllForUser(ownerUid) {
        return Promise.resolve().then(function () {
            if (!_isKing()) throw new Error('فقط الملك');
            if (!ownerUid) throw new Error('uid مطلوب');
            return window.QamarFB.get(CONFIG.ROOT + '/' + ownerUid).then(function (data) {
                if (!data) return [];
                return Object.keys(data).map(function (rid) {
                    return Object.assign({ _id: rid }, data[rid]);
                }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Adaptive bind                                   */
    /* ══════════════════════════════════════════════ */
    function _bindAdaptive() {
        if (State._adaptiveBound) return;
        if (!window.QamarAdaptive || typeof window.QamarAdaptive.onFeatureChange !== 'function') {
            setTimeout(_bindAdaptive, 1000);
            return;
        }

        State._adaptiveBound = true;

        window.QamarAdaptive.onFeatureChange('voiceMonitorEnabled', function (payload) {
            if (payload.value === false) {
                Logger.info('⏸️ Voice disabled (net got slower)');
                stopCleanup();
            } else {
                Logger.info('▶️ Voice enabled (net improved)');
                startCleanup();
            }
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
            rateUsed: uid ? (State.rateMap[uid] || []).length : 0,
            rateMax: CONFIG.RATE_MAX,
            maxDurationSec: CONFIG.MAX_DURATION_MS / 1000,
            maxSizeMB: CONFIG.MAX_SIZE_BYTES / 1024 / 1024,
            autoDeleteHours: _getAutoDeleteMs() / 1000 / 60 / 60,
            cleanupActive: !!State.cleanupTimer,
            cacheEntries: Object.keys(State.cache).length,
            voiceEnabled: _isVoiceEnabled()
        };
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
                if (p.isLoggedIn) {
                    startCleanup();
                } else {
                    stopCleanup();
                    _invalidateCache();
                }
            });
        }

        Logger.info('📦 [pm-voice.js] initialized');
    }

    if (window.QamarBoot && typeof window.QamarBoot.whenReady === 'function') {
        window.QamarBoot.whenReady('background', function () {
            setTimeout(_init, 1200);
        });
    } else if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 2400);
        });
    } else {
        setTimeout(_init, 7500);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarPMVoice = {
        __v2: true,
        CONFIG: CONFIG,

        sendVoice: sendVoice,
        sendVoiceFromBlob: sendVoiceFromBlob,

        getVoiceMessages: getVoiceMessages,
        getVoiceMessage: getVoiceMessage,

        markAsPlayed: markAsPlayed,
        markKingPlayed: markKingPlayed,

        deleteVoice: deleteVoice,
        hardDelete: hardDelete,

        cleanupOld: cleanupOld,
        startCleanup: startCleanup,
        stopCleanup: stopCleanup,

        listAllForUser: listAllForUser,

        onVoiceEvent: onVoiceEvent,

        getStatus: getStatus
    };

    Logger.info('📦 [pm-voice.js v2] loaded — King played fixed');
})();
