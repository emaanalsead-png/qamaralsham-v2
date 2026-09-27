// ==============================================
// security/audit.js
// Comprehensive audit log for admin actions
// ==============================================
// يعتمد على: firebase.js + auth.js + ranks.js
// يعطي: window.QamarAudit
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [audit] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[AUD]';
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
        ROOT: 'audit_log/general',
        RATE_WINDOW_MS: 60 * 1000,          // دقيقة
        RATE_MAX: 20,                        // 20 عملية/دقيقة
        MAX_FIELD_LENGTH: 500,               // 500 حرف
        DEFAULT_LIMIT: 100,                  // افتراضي في list
        MAX_LIMIT: 500,                      // أقصى حد في list
        CACHE_TTL_MS: 30 * 1000              // كاش 30 ثانية
    };

    /* ══════════════════════════════════════════════ */
    /* Allowed types — قائمة شمولية (~35)              */
    /* ══════════════════════════════════════════════ */
    const TYPES = {
        // ─── Users ───
        promote:           'ترقية',
        demote:            'تخفيض',
        assignQueen:       'تعيين رتبة 95',
        removeQueen:       'إزالة رتبة 95',
        grantPerm:         'منح صلاحية',
        revokePerm:        'سحب صلاحية',
        grantPermBatch:    'منح صلاحيات متعددة',
        revokeAllPerms:    'سحب كل الصلاحيات',
        warn:              'تحذير',
        kick:              'طرد من غرفة',
        kickAll:           'طرد كامل',
        jail:              'سجن',
        unjail:            'إخراج من السجن',
        transfer:          'نقل إلى غرفة',
        forceMove:         'نقل إجباري',

        // ─── Bans ───
        banTemp:           'حظر مؤقت',
        banPerm:           'حظر دائم',
        unban:             'إلغاء حظر',
        banDevice:         'حظر جهاز',
        unbanDevice:       'إلغاء حظر جهاز',
        banIP:             'حظر IP',
        unbanIP:           'إلغاء حظر IP',

        // ─── Mutes ───
        muteGlobal:        'كتم دائم',
        muteRoom:          'كتم في غرفة',
        unmute:            'إلغاء كتم',

        // ─── Messages ───
        deleteMsg:         'حذف رسالة',
        editMsg:           'تعديل رسالة',
        hideMsg:           'إخفاء رسالة',
        deletePM:          'حذف رسالة خاصة',
        archivePM:         'أرشفة رسالة خاصة',

        // ─── Rooms ───
        editRoom:          'تعديل غرفة',
        createRoom:        'إنشاء غرفة',
        deleteRoom:        'حذف غرفة',
        resetRoom:         'إعادة تعيين غرفة',
        broadcast:         'إذاعة',
        sendAlert:         'إرسال تنبيه',
        systemMsg:         'رسالة نظام',

        // ─── Bots ───
        trainBot:          'تدريب بوت',
        editBotMemory:     'تعديل ذاكرة بوت',
        clearBotMemory:    'مسح ذاكرة بوت',
        toggleBot:         'تشغيل/إيقاف بوت',

        // ─── Reports ───
        resolveReport:     'حل تقرير',
        archiveReport:     'أرشفة تقرير',
        deleteReport:      'حذف تقرير',

        // ─── Suspects ───
        addSuspect:        'إضافة مشتبه',
        removeSuspect:     'إزالة مشتبه',
        monitor:           'مراقبة',

        // ─── Stories ───
        deleteStory:       'حذف حالة',
        hideStory:         'إخفاء حالة',

        // ─── System ───
        clearAudit:        'مسح سجل',
        editSettings:      'تعديل إعدادات',
        cleanerRun:        'تشغيل منظف',

        // ─── Voice ───
        voiceKick:         'طرد من المايك',
        voiceMute:         'كتم مايك',
        voiceUnmute:       'فتح مايك',
        voiceMonitor:      'مراقبة صوتية',

        // ─── Other ───
        custom:            'عملية مخصصة'
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        rateMap: {},         // { uid: [timestamps] }
        cache: {
            recent: null,
            cachedAt: 0
        },
        listeners: []
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onAudit(cb) {
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
            if (window.QamarAuth && window.QamarAuth.getDisplayName) {
                return window.QamarAuth.getDisplayName();
            }
        } catch (e) {}
        return '—';
    }

    function _truncate(val, max) {
        max = max || CONFIG.MAX_FIELD_LENGTH;
        if (val === null || val === undefined) return null;
        const s = String(val);
        if (s.length <= max) return s;
        return s.substring(0, max - 3) + '...';
    }

    function _sanitizeObject(obj, depth) {
        depth = depth || 0;
        if (depth > 3) return '[deep]';
        if (obj === null || obj === undefined) return null;
        if (typeof obj === 'string') return _truncate(obj);
        if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
        if (Array.isArray(obj)) {
            return obj.slice(0, 20).map(function (v) { return _sanitizeObject(v, depth + 1); });
        }
        if (typeof obj === 'object') {
            const out = {};
            Object.keys(obj).slice(0, 20).forEach(function (k) {
                out[k] = _sanitizeObject(obj[k], depth + 1);
            });
            return out;
        }
        return String(obj);
    }

    /* ══════════════════════════════════════════════ */
    /* Rate limit                                      */
    /* ══════════════════════════════════════════════ */
    function _checkRate(uid) {
        if (!uid) return false;
        const now = Date.now();
        if (!State.rateMap[uid]) State.rateMap[uid] = [];
        State.rateMap[uid] = State.rateMap[uid].filter(function (t) {
            return now - t < CONFIG.RATE_WINDOW_MS;
        });
        if (State.rateMap[uid].length >= CONFIG.RATE_MAX) {
            return false;
        }
        State.rateMap[uid].push(now);
        return true;
    }

    /* ══════════════════════════════════════════════ */
    /* Write — log an action                           */
    /* ══════════════════════════════════════════════ */
    function log(type, payload) {
        if (!type || TYPES[type] === undefined) {
            Logger.warn('Unknown audit type:', type);
            return Promise.resolve({ ok: false, reason: 'unknown-type' });
        }

        const uid = _getCurrentUid();
        if (!uid) {
            Logger.warn('No user — cannot log');
            return Promise.resolve({ ok: false, reason: 'no-user' });
        }

        if (!_checkRate(uid)) {
            Logger.warn('Audit rate limit exceeded for', uid.substring(0, 8));
            return Promise.resolve({ ok: false, reason: 'rate-limit' });
        }

        payload = payload || {};

        const entry = {
            type: type,
            label: TYPES[type],
            byUid: uid,
            byName: _getCurrentName(),
            at: window.QamarFB.serverTime(),
            // حقول قياسية
            targetUid:  payload.targetUid  || null,
            targetName: payload.targetName ? _truncate(payload.targetName, 60) : null,
            roomId:     payload.roomId     || null,
            reason:     payload.reason     ? _truncate(payload.reason)     : null,
            details:    payload.details    ? _sanitizeObject(payload.details) : null,
            // مرجع
            msgId:      payload.msgId      || null,
            deviceId:   payload.deviceId   || null,
            duration:   payload.duration   || null,
            amount:     payload.amount     || null
        };

        return window.QamarFB.push(CONFIG.ROOT, entry)
            .then(function (key) {
                Logger.debug('📝 Audit logged:', type, '→', key);
                _emit('audit:logged', { key: key, entry: entry });
                // ابطل الكاش
                State.cache.recent = null;
                State.cache.cachedAt = 0;
                return { ok: true, key: key, entry: entry };
            })
            .catch(function (e) {
                Logger.warn('audit log write failed:', e.message);
                return { ok: false, reason: e.message };
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Convenience logger                              */
    /* ══════════════════════════════════════════════ */
    function logAction(type, targetUid, details) {
        details = details || {};
        return log(type, {
            targetUid: targetUid,
            targetName: details.targetName || null,
            reason: details.reason || null,
            roomId: details.roomId || null,
            duration: details.duration || null,
            amount: details.amount || null,
            msgId: details.msgId || null,
            deviceId: details.deviceId || null,
            details: details.extra || null
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Read — permissions check                        */
    /* ══════════════════════════════════════════════ */
    function _canRead() {
        // حسب القواعد: rankLevel >= 90
        if (window.QamarRanks) {
            if (window.QamarRanks.isKing()) return true;
            if (window.QamarRanks.myLevel && window.QamarRanks.myLevel() >= 90) return true;
        }
        return false;
    }

    /* ══════════════════════════════════════════════ */
    /* Read — list with filters                        */
    /* ══════════════════════════════════════════════ */
    function list(filters) {
        filters = filters || {};
        if (!_canRead()) {
            return Promise.reject(new Error('غير مصرّح بقراءة السجل'));
        }

        const limit = Math.min(filters.limit || CONFIG.DEFAULT_LIMIT, CONFIG.MAX_LIMIT);

        // استخدم الكاش للـ "الأحدث بدون فلترة"
        const noFilters = !filters.type && !filters.actorUid && !filters.targetUid &&
                          !filters.roomId && !filters.from && !filters.to;

        if (noFilters && State.cache.recent && (Date.now() - State.cache.cachedAt) < CONFIG.CACHE_TTL_MS) {
            if (State.cache.recent.length >= limit) {
                return Promise.resolve(State.cache.recent.slice(0, limit));
            }
        }

        const queryOpts = {
            orderByChild: 'at',
            limitToLast: Math.min(limit * 2, CONFIG.MAX_LIMIT),
            returnArray: true
        };

        return window.QamarFB.query(CONFIG.ROOT, queryOpts)
            .then(function (arr) {
                let entries = (arr || []).map(function (r) {
                    return Object.assign({ _key: r.id }, r.data);
                });

                // فلترة
                if (filters.type) {
                    entries = entries.filter(function (e) { return e.type === filters.type; });
                }
                if (filters.actorUid) {
                    entries = entries.filter(function (e) { return e.byUid === filters.actorUid; });
                }
                if (filters.targetUid) {
                    entries = entries.filter(function (e) { return e.targetUid === filters.targetUid; });
                }
                if (filters.roomId) {
                    entries = entries.filter(function (e) { return e.roomId === filters.roomId; });
                }
                if (filters.from) {
                    entries = entries.filter(function (e) { return (e.at || 0) >= filters.from; });
                }
                if (filters.to) {
                    entries = entries.filter(function (e) { return (e.at || 0) <= filters.to; });
                }

                // الأحدث أولاً
                entries.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
                entries = entries.slice(0, limit);

                if (noFilters) {
                    State.cache.recent = entries;
                    State.cache.cachedAt = Date.now();
                }
                return entries;
            })
            .catch(function (e) {
                Logger.warn('list failed:', e.message);
                return [];
            });
    }

    function listByUser(targetUid, limit) {
        return list({ targetUid: targetUid, limit: limit || CONFIG.DEFAULT_LIMIT });
    }

    function listByActor(actorUid, limit) {
        return list({ actorUid: actorUid, limit: limit || CONFIG.DEFAULT_LIMIT });
    }

    function listByType(type, limit) {
        return list({ type: type, limit: limit || CONFIG.DEFAULT_LIMIT });
    }

    function listByRoom(roomId, limit) {
        return list({ roomId: roomId, limit: limit || CONFIG.DEFAULT_LIMIT });
    }

    function getRecent(limit) {
        return list({ limit: limit || CONFIG.DEFAULT_LIMIT });
    }

    /* ══════════════════════════════════════════════ */
    /* Stats                                           */
    /* ══════════════════════════════════════════════ */
    function getStats() {
        if (!_canRead()) {
            return Promise.reject(new Error('غير مصرّح'));
        }
        return list({ limit: CONFIG.MAX_LIMIT }).then(function (entries) {
            const byType = {};
            const byActor = {};
            let oldest = null, newest = null;

            entries.forEach(function (e) {
                byType[e.type] = (byType[e.type] || 0) + 1;
                byActor[e.byUid] = (byActor[e.byUid] || 0) + 1;
                if (!oldest || e.at < oldest) oldest = e.at;
                if (!newest || e.at > newest) newest = e.at;
            });

            return {
                total: entries.length,
                byType: byType,
                byActor: byActor,
                oldest: oldest,
                newest: newest
            };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Count                                           */
    /* ══════════════════════════════════════════════ */
    function countAll() {
        if (!_canRead()) return Promise.reject(new Error('غير مصرّح'));
        return window.QamarFB.get(CONFIG.ROOT).then(function (data) {
            if (!data) return 0;
            return Object.keys(data).length;
        }).catch(function () { return 0; });
    }

    /* ══════════════════════════════════════════════ */
    /* Clear old (auto — للـ cleaners)                 */
    /* ══════════════════════════════════════════════ */
    function clearOld(daysOld) {
        daysOld = daysOld || 30;
        const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

        return window.QamarFB.get(CONFIG.ROOT).then(function (data) {
            if (!data) return { removed: 0, scanned: 0 };

            const updates = {};
            let scanned = 0, removed = 0;

            Object.keys(data).forEach(function (key) {
                const entry = data[key];
                if (!entry) return;
                scanned++;
                if (entry.at && entry.at < cutoff) {
                    updates[CONFIG.ROOT + '/' + key] = null;
                    removed++;
                }
            });

            if (removed === 0) return { removed: 0, scanned: scanned, cutoff: cutoff };

            // دفعات لتفادي payload ضخم
            const keys = Object.keys(updates);
            const BATCH = 200;
            const batches = [];
            for (let i = 0; i < keys.length; i += BATCH) {
                const b = {};
                keys.slice(i, i + BATCH).forEach(function (k) { b[k] = null; });
                batches.push(b);
            }

            return batches.reduce(function (p, b) {
                return p.then(function () { return window.QamarFB.multiUpdate(b); });
            }, Promise.resolve()).then(function () {
                State.cache.recent = null;
                State.cache.cachedAt = 0;
                Logger.info('🧹 Cleared', removed, 'old audit entries');
                return { removed: removed, scanned: scanned, cutoff: cutoff };
            });
        }).catch(function (e) {
            return { removed: 0, error: e.message };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Clear all (manual — King only)                  */
    /* ══════════════════════════════════════════════ */
    function clearAll() {
        if (!window.QamarRanks || !window.QamarRanks.isKing()) {
            return Promise.reject(new Error('فقط الملك يمكنه مسح السجل كاملاً'));
        }
        return window.QamarFB.remove(CONFIG.ROOT).then(function () {
            State.cache.recent = null;
            State.cache.cachedAt = 0;
            Logger.info('🗑️ Audit log cleared completely');
            _emit('audit:cleared', {});
            return { ok: true };
        });
    }

    function clearByType(type) {
        if (!window.QamarRanks || !window.QamarRanks.isKing()) {
            return Promise.reject(new Error('فقط الملك'));
        }
        if (!TYPES[type]) return Promise.reject(new Error('نوع غير معروف'));

        return window.QamarFB.get(CONFIG.ROOT).then(function (data) {
            if (!data) return { removed: 0 };
            const updates = {};
            let removed = 0;
            Object.keys(data).forEach(function (key) {
                if (data[key] && data[key].type === type) {
                    updates[CONFIG.ROOT + '/' + key] = null;
                    removed++;
                }
            });
            if (removed === 0) return { removed: 0 };
            return window.QamarFB.multiUpdate(updates).then(function () {
                State.cache.recent = null;
                return { removed: removed };
            });
        });
    }

    function clearByActor(actorUid) {
        if (!window.QamarRanks || !window.QamarRanks.isKing()) {
            return Promise.reject(new Error('فقط الملك'));
        }
        if (!actorUid) return Promise.reject(new Error('actorUid مطلوب'));

        return window.QamarFB.get(CONFIG.ROOT).then(function (data) {
            if (!data) return { removed: 0 };
            const updates = {};
            let removed = 0;
            Object.keys(data).forEach(function (key) {
                if (data[key] && data[key].byUid === actorUid) {
                    updates[CONFIG.ROOT + '/' + key] = null;
                    removed++;
                }
            });
            if (removed === 0) return { removed: 0 };
            return window.QamarFB.multiUpdate(updates).then(function () {
                State.cache.recent = null;
                return { removed: removed };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Export / Import                                 */
    /* ══════════════════════════════════════════════ */
    function exportJSON() {
        if (!_canRead()) return Promise.reject(new Error('غير مصرّح'));
        return list({ limit: CONFIG.MAX_LIMIT }).then(function (entries) {
            return JSON.stringify(entries, null, 2);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Debug                                           */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        const uid = _getCurrentUid();
        return {
            canRead: _canRead(),
            typesCount: Object.keys(TYPES).length,
            rateUsed: uid ? (State.rateMap[uid] || []).length : 0,
            rateMax: CONFIG.RATE_MAX,
            cachedAt: State.cache.cachedAt,
            cacheSize: State.cache.recent ? State.cache.recent.length : 0
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarAudit = {
        // Config
        CONFIG: CONFIG,
        TYPES: TYPES,

        // Write
        log: log,
        logAction: logAction,

        // Read
        list: list,
        listByUser: listByUser,
        listByActor: listByActor,
        listByType: listByType,
        listByRoom: listByRoom,
        getRecent: getRecent,

        // Stats
        getStats: getStats,
        countAll: countAll,

        // Cleanup
        clearOld: clearOld,
        clearAll: clearAll,
        clearByType: clearByType,
        clearByActor: clearByActor,

        // Export
        exportJSON: exportJSON,

        // Events
        onAudit: onAudit,

        // Debug
        getStatus: getStatus
    };

    window.QamarAudit = QamarAudit;

    Logger.info('📦 [audit.js] loaded | types:', Object.keys(TYPES).length);
})();
