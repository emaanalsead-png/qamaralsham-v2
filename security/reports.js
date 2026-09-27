// ==============================================
// security/reports.js
// User reports system (submit + review + archive)
// ==============================================
// يعتمد على: firebase.js + auth.js + ranks.js + audit.js
// يعطي: window.QamarReports
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [reports] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[REP]';
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
        ROOT: 'reports',
        ARCHIVE_ROOT: 'reports_archive',
        MIN_REVIEW_LEVEL: 80,               // 80+ يرى التقارير
        MIN_SUBMIT_LEVEL: 50,               // أي عضو مسجل
        RATE_WINDOW_MS: 60 * 1000,
        RATE_MAX: 5,                        // 5 تقارير/دقيقة
        DEDUP_WINDOW_MS: 24 * 60 * 60 * 1000,
        MAX_REASON_LENGTH: 200,
        MAX_NOTE_LENGTH: 500,
        DEFAULT_LIMIT: 50,
        MAX_LIMIT: 200,
        CACHE_TTL_MS: 30 * 1000
    };

    /* ══════════════════════════════════════════════ */
    /* Reasons                                         */
    /* ══════════════════════════════════════════════ */
    const REASONS = {
        abuse:          'إساءة / تحرش',
        spam:           'سبام / إعلانات',
        inappropriate:  'محتوى غير لائق',
        misinformation: 'معلومات كاذبة',
        impersonation:  'انتحال شخصية',
        threaten:       'تهديد',
        other:          'أخرى'
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        rateMap: {},         // { uid: [timestamps] }
        dedupMap: {},        // { key: timestamp }
        cache: {
            active: null,
            activeCount: 0,
            cachedAt: 0
        },
        listeners: [],
        activeCount: 0
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onReportEvent(cb) {
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

    function _isGuest() {
        if (window.QamarAuth && window.QamarAuth.isGuest) return window.QamarAuth.isGuest();
        return false;
    }

    function _canReview() {
        if (_isKing()) return true;
        return _myLevel() >= CONFIG.MIN_REVIEW_LEVEL;
    }

    function _canSubmit() {
        if (_isGuest()) return false;
        const u = _getCurrentUser();
        if (!u) return false;
        const lvl = Number(u.rankLevel) || 50;
        return lvl >= CONFIG.MIN_SUBMIT_LEVEL;
    }

    function _sanitize(str, max) {
        if (str === null || str === undefined) return null;
        const s = String(str);
        if (s.length <= max) return s;
        return s.substring(0, max - 3) + '...';
    }

    /* ══════════════════════════════════════════════ */
    /* Rate limit                                      */
    /* ══════════════════════════════════════════════ */
    function _checkRate(uid) {
        const now = Date.now();
        if (!State.rateMap[uid]) State.rateMap[uid] = [];
        State.rateMap[uid] = State.rateMap[uid].filter(function (t) {
            return now - t < CONFIG.RATE_WINDOW_MS;
        });
        if (State.rateMap[uid].length >= CONFIG.RATE_MAX) return false;
        State.rateMap[uid].push(now);
        return true;
    }

    /* ══════════════════════════════════════════════ */
    /* Dedup — منع التقارير المكررة                    */
    /* ══════════════════════════════════════════════ */
    function _dedupKey(reporterUid, targetUid, messageKey) {
        return reporterUid + '__' + targetUid + '__' + (messageKey || 'none');
    }

    function _isDuplicate(reporterUid, targetUid, messageKey) {
        const key = _dedupKey(reporterUid, targetUid, messageKey);
        const last = State.dedupMap[key];
        if (last && (Date.now() - last) < CONFIG.DEDUP_WINDOW_MS) {
            return true;
        }
        State.dedupMap[key] = Date.now();
        return false;
    }

    /* ══════════════════════════════════════════════ */
    /* Submit report                                   */
    /* ══════════════════════════════════════════════ */
    function submitReport(targetUid, reason, options) {
        options = options || {};

        return Promise.resolve().then(function () {
            if (!_canSubmit()) {
                throw new Error('لا يمكنك الإبلاغ — سجّل دخول كعضو أولاً');
            }
            if (!targetUid) throw new Error('targetUid مطلوب');

            const reporterUid = _getCurrentUid();
            if (!reporterUid) throw new Error('غير مسجل');
            if (reporterUid === targetUid) throw new Error('لا يمكنك الإبلاغ عن نفسك');

            // التحقق من السبب
            let reasonText = '';
            if (typeof reason === 'string' && REASONS[reason]) {
                reasonText = REASONS[reason];
            } else if (typeof reason === 'string' && reason.trim().length >= 3) {
                reasonText = reason.trim();
            } else {
                throw new Error('السبب مطلوب');
            }
            reasonText = _sanitize(reasonText, CONFIG.MAX_REASON_LENGTH);

            // Rate limit
            if (!_checkRate(reporterUid)) {
                throw new Error('محاولات كثيرة — حاول لاحقاً');
            }

            // Dedup
            const messageKey = options.messageKey || null;
            if (_isDuplicate(reporterUid, targetUid, messageKey)) {
                throw new Error('لقد أبلغت عن هذا خلال 24 ساعة');
            }

            const reporter = _getCurrentUser() || {};

            const payload = {
                reporterUid: reporterUid,
                reporterName: reporter.name || '—',
                reporterAvatar: reporter.avatar || null,
                reporterCode: reporter.code || null,

                targetUid: targetUid,
                targetName: options.targetName || '—',
                targetAvatar: options.targetAvatar || null,
                targetCode: options.targetCode || null,

                reason: reasonText,
                reasonKey: REASONS[reason] ? reason : 'other',

                messageText: _sanitize(options.messageText, CONFIG.MAX_REASON_LENGTH) || null,
                messageKey: messageKey,

                roomId: options.roomId || null,
                isPrivate: options.isPrivate === true,

                time: window.QamarFB.serverTime(),
                status: 'active'
            };

            return window.QamarFB.push(CONFIG.ROOT, payload)
                .then(function (rid) {
                    Logger.info('📢 Report submitted:', rid, '→', targetUid.substring(0, 8));

                    // سجّل في audit
                    if (window.QamarAudit) {
                        window.QamarAudit.log('systemMsg', {
                            targetUid: targetUid,
                            targetName: options.targetName,
                            reason: 'تقرير جديد: ' + reasonText,
                            msgId: rid
                        });
                    }

                    // إشعار للملك
                    _notifyReviewers(rid, payload);

                    // إشعار المُبلِّغ
                    window.QamarFB.push('user_notifications/' + reporterUid, {
                        type: 'report_sent',
                        reportId: rid,
                        targetName: payload.targetName,
                        at: window.QamarFB.serverTime(),
                        read: false
                    }).catch(function () {});

                    _emit('report:new', { id: rid, report: payload });
                    _invalidateCache();
                    return { ok: true, id: rid };
                })
                .catch(function (e) {
                    Logger.error('submitReport failed:', e.message);
                    throw e;
                });
        });
    }

    function _notifyReviewers(reportId, payload) {
        // إشعار الملك
        window.QamarFB.get('config/king_uid').then(function (kingUid) {
            if (!kingUid) return;
            return window.QamarFB.push('guardian_inbox/' + kingUid, {
                from: payload.reporterUid,
                fromName: payload.reporterName,
                type: 'new_report',
                reportId: reportId,
                targetUid: payload.targetUid,
                targetName: payload.targetName,
                reason: payload.reason,
                at: window.QamarFB.serverTime(),
                read: false
            });
        }).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Read                                            */
    /* ══════════════════════════════════════════════ */
    function _invalidateCache() {
        State.cache.active = null;
        State.cache.activeCount = 0;
        State.cache.cachedAt = 0;
    }

    function listActive(filters) {
        filters = filters || {};
        if (!_canReview()) {
            return Promise.reject(new Error('غير مصرّح — تحتاج مستوى 80'));
        }

        // كاش للـ "بدون فلترة"
        const noFilters = !filters.targetUid && !filters.reporterUid &&
                          !filters.roomId && !filters.reasonKey;
        if (noFilters && State.cache.active &&
            (Date.now() - State.cache.cachedAt) < CONFIG.CACHE_TTL_MS) {
            return Promise.resolve(State.cache.active.slice());
        }

        return window.QamarFB.children(CONFIG.ROOT)
            .then(function (data) {
                if (!data) return [];
                let entries = Object.keys(data).map(function (id) {
                    return Object.assign({ _id: id }, data[id]);
                });

                // فلترة
                entries = entries.filter(function (e) { return e.status !== 'archived'; });
                if (filters.targetUid) {
                    entries = entries.filter(function (e) { return e.targetUid === filters.targetUid; });
                }
                if (filters.reporterUid) {
                    entries = entries.filter(function (e) { return e.reporterUid === filters.reporterUid; });
                }
                if (filters.roomId) {
                    entries = entries.filter(function (e) { return e.roomId === filters.roomId; });
                }
                if (filters.reasonKey) {
                    entries = entries.filter(function (e) { return e.reasonKey === filters.reasonKey; });
                }
                if (filters.status) {
                    entries = entries.filter(function (e) { return e.status === filters.status; });
                }

                // الأحدث أولاً
                entries.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
                const limit = Math.min(filters.limit || CONFIG.DEFAULT_LIMIT, CONFIG.MAX_LIMIT);
                entries = entries.slice(0, limit);

                if (noFilters) {
                    State.cache.active = entries;
                    State.cache.activeCount = entries.length;
                    State.cache.cachedAt = Date.now();
                }
                return entries;
            })
            .catch(function (e) {
                if (e && (e.code === 'PERMISSION_DENIED' || /permission/i.test(e.message || ''))) {
                    Logger.warn('لا تملك صلاحية قراءة التقارير (تحتاج 90+ في Firebase Rules)');
                    return [];
                }
                Logger.warn('listActive error:', e.message);
                return [];
            });
    }

    function listArchived(filters) {
        filters = filters || {};
        if (!_canReview()) {
            return Promise.reject(new Error('غير مصرّح'));
        }
        return window.QamarFB.children(CONFIG.ARCHIVE_ROOT)
            .then(function (data) {
                if (!data) return [];
                let entries = Object.keys(data).map(function (id) {
                    return Object.assign({ _id: id }, data[id]);
                });
                entries.sort(function (a, b) { return (b.archivedAt || b.time || 0) - (a.archivedAt || a.time || 0); });
                const limit = Math.min(filters.limit || CONFIG.DEFAULT_LIMIT, CONFIG.MAX_LIMIT);
                return entries.slice(0, limit);
            })
            .catch(function () { return []; });
    }

    function getById(reportId) {
        if (!reportId) return Promise.resolve(null);
        return window.QamarFB.get(CONFIG.ROOT + '/' + reportId)
            .then(function (r) {
                if (!r) return null;
                return Object.assign({ _id: reportId }, r);
            })
            .catch(function () { return null; });
    }

    function countActive() {
        if (!_canReview()) return Promise.resolve(0);
        // كاش
        if (State.cache.activeCount > 0 &&
            (Date.now() - State.cache.cachedAt) < CONFIG.CACHE_TTL_MS) {
            return Promise.resolve(State.cache.activeCount);
        }
        return window.QamarFB.get(CONFIG.ROOT)
            .then(function (data) {
                if (!data) { State.activeCount = 0; return 0; }
                let n = 0;
                Object.keys(data).forEach(function (k) {
                    if (data[k] && data[k].status !== 'archived') n++;
                });
                State.activeCount = n;
                State.cache.activeCount = n;
                State.cache.cachedAt = Date.now();
                return n;
            })
            .catch(function () { return 0; });
    }

    function getStats() {
        if (!_canReview()) return Promise.reject(new Error('غير مصرّح'));
        return window.QamarFB.children(CONFIG.ROOT).then(function (data) {
            const stats = {
                total: 0,
                byStatus: {},
                byReason: {},
                byTarget: {},
                byReporter: {}
            };
            if (!data) return stats;
            Object.keys(data).forEach(function (id) {
                const r = data[id];
                if (!r) return;
                stats.total++;
                stats.byStatus[r.status || 'unknown'] = (stats.byStatus[r.status || 'unknown'] || 0) + 1;
                stats.byReason[r.reasonKey || 'other'] = (stats.byReason[r.reasonKey || 'other'] || 0) + 1;
                stats.byTarget[r.targetUid] = (stats.byTarget[r.targetUid] || 0) + 1;
                stats.byReporter[r.reporterUid] = (stats.byReporter[r.reporterUid] || 0) + 1;
            });
            return stats;
        }).catch(function () { return { total: 0 }; });
    }

    /* ══════════════════════════════════════════════ */
    /* Resolve                                         */
    /* ══════════════════════════════════════════════ */
    function resolveReport(reportId, actionTaken, note) {
        return Promise.resolve().then(function () {
            if (!_canReview()) throw new Error('غير مصرّح');
            if (!reportId) throw new Error('reportId مطلوب');
            if (!actionTaken || actionTaken.trim().length < 2) {
                throw new Error('الإجراء المتخذ مطلوب');
            }

            return window.QamarFB.get(CONFIG.ROOT + '/' + reportId).then(function (r) {
                if (!r) throw new Error('التقرير غير موجود');

                const updates = {};
                updates[CONFIG.ROOT + '/' + reportId + '/status'] = 'resolved';
                updates[CONFIG.ROOT + '/' + reportId + '/resolvedAt'] = window.QamarFB.serverTime();
                updates[CONFIG.ROOT + '/' + reportId + '/resolvedBy'] = _getCurrentUid();
                updates[CONFIG.ROOT + '/' + reportId + '/resolvedByName'] = _getCurrentUser() ? _getCurrentUser().name : '—';
                updates[CONFIG.ROOT + '/' + reportId + '/actionTaken'] = _sanitize(actionTaken, CONFIG.MAX_NOTE_LENGTH);
                updates[CONFIG.ROOT + '/' + reportId + '/resolutionNote'] = _sanitize(note, CONFIG.MAX_NOTE_LENGTH) || null;

                return window.QamarFB.multiUpdate(updates).then(function () {
                    if (window.QamarAudit) {
                        window.QamarAudit.log('resolveReport', {
                            targetUid: r.targetUid,
                            targetName: r.targetName,
                            reason: actionTaken,
                            msgId: reportId,
                            details: { note: note || null }
                        });
                    }
                    // إشعار للمُبلِّغ
                    window.QamarFB.push('user_notifications/' + r.reporterUid, {
                        type: 'report_resolved',
                        reportId: reportId,
                        targetName: r.targetName,
                        action: actionTaken,
                        at: window.QamarFB.serverTime(),
                        read: false
                    }).catch(function () {});

                    _emit('report:resolved', { id: reportId, action: actionTaken });
                    _invalidateCache();
                    Logger.info('✅ Report resolved:', reportId);
                    return { ok: true, id: reportId };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Archive                                         */
    /* ══════════════════════════════════════════════ */
    function archiveReport(reportId) {
        return Promise.resolve().then(function () {
            if (!_canReview()) throw new Error('غير مصرّح');
            if (!reportId) throw new Error('reportId مطلوب');

            return window.QamarFB.get(CONFIG.ROOT + '/' + reportId).then(function (r) {
                if (!r) throw new Error('التقرير غير موجود');

                const archived = Object.assign({}, r, {
                    status: 'archived',
                    archivedAt: Date.now(),
                    archivedBy: _getCurrentUid(),
                    archivedByName: _getCurrentUser() ? _getCurrentUser().name : '—'
                });

                const updates = {};
                updates[CONFIG.ARCHIVE_ROOT + '/' + reportId] = archived;
                updates[CONFIG.ROOT + '/' + reportId] = null;

                return window.QamarFB.multiUpdate(updates).then(function () {
                    if (window.QamarAudit) {
                        window.QamarAudit.log('archiveReport', {
                            targetUid: r.targetUid,
                            targetName: r.targetName,
                            msgId: reportId
                        });
                    }
                    _emit('report:archived', { id: reportId });
                    _invalidateCache();
                    Logger.info('📦 Report archived:', reportId);
                    return { ok: true, id: reportId };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Delete                                          */
    /* ══════════════════════════════════════════════ */
    function deleteReport(reportId, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            if (!_isKing() && _myLevel() < CONFIG.MIN_REVIEW_LEVEL) {
                throw new Error('غير مصرّح');
            }
            if (!reportId) throw new Error('reportId مطلوب');

            const fromArchive = options.fromArchive === true;
            const path = (fromArchive ? CONFIG.ARCHIVE_ROOT : CONFIG.ROOT) + '/' + reportId;

            return window.QamarFB.remove(path).then(function () {
                if (window.QamarAudit) {
                    window.QamarAudit.log('deleteReport', {
                        msgId: reportId,
                        details: { fromArchive: fromArchive }
                    });
                }
                _emit('report:deleted', { id: reportId, fromArchive: fromArchive });
                _invalidateCache();
                Logger.info('🗑️ Report deleted:', reportId);
                return { ok: true, id: reportId };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Restore from archive                            */
    /* ══════════════════════════════════════════════ */
    function restoreFromArchive(reportId) {
        return Promise.resolve().then(function () {
            if (!_canReview()) throw new Error('غير مصرّح');
            if (!reportId) throw new Error('reportId مطلوب');

            return window.QamarFB.get(CONFIG.ARCHIVE_ROOT + '/' + reportId).then(function (r) {
                if (!r) throw new Error('التقرير غير موجود في الأرشيف');

                const restored = Object.assign({}, r, {
                    status: 'active',
                    restoredAt: window.QamarFB.serverTime(),
                    restoredBy: _getCurrentUid()
                });
                delete restored.archivedAt;
                delete restored.archivedBy;
                delete restored.archivedByName;

                const updates = {};
                updates[CONFIG.ROOT + '/' + reportId] = restored;
                updates[CONFIG.ARCHIVE_ROOT + '/' + reportId] = null;

                return window.QamarFB.multiUpdate(updates).then(function () {
                    _emit('report:restored', { id: reportId });
                    _invalidateCache();
                    Logger.info('↩️ Report restored:', reportId);
                    return { ok: true, id: reportId };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Bulk actions                                    */
    /* ══════════════════════════════════════════════ */
    function archiveAllResolved() {
        return Promise.resolve().then(function () {
            if (!_canReview()) throw new Error('غير مصرّح');
            return window.QamarFB.children(CONFIG.ROOT).then(function (data) {
                if (!data) return { archived: 0 };
                const updates = {};
                let count = 0;
                const now = Date.now();
                Object.keys(data).forEach(function (id) {
                    const r = data[id];
                    if (r && r.status === 'resolved') {
                        updates[CONFIG.ARCHIVE_ROOT + '/' + id] = Object.assign({}, r, {
                            status: 'archived',
                            archivedAt: now,
                            archivedBy: _getCurrentUid(),
                            auto: true
                        });
                        updates[CONFIG.ROOT + '/' + id] = null;
                        count++;
                    }
                });
                if (count === 0) return { archived: 0 };
                return window.QamarFB.multiUpdate(updates).then(function () {
                    _invalidateCache();
                    return { archived: count };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        const uid = _getCurrentUid();
        return {
            canSubmit: _canSubmit(),
            canReview: _canReview(),
            myLevel: _myLevel(),
            isKing: _isKing(),
            rateUsed: uid ? (State.rateMap[uid] || []).length : 0,
            rateMax: CONFIG.RATE_MAX,
            cacheSize: State.cache.active ? State.cache.active.length : 0,
            activeCount: State.activeCount,
            reasonsCount: Object.keys(REASONS).length
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarReports = {
        // Config
        CONFIG: CONFIG,
        REASONS: REASONS,

        // Submit
        submitReport: submitReport,

        // Read
        listActive: listActive,
        listArchived: listArchived,
        getById: getById,
        countActive: countActive,
        getStats: getStats,

        // Actions
        resolveReport: resolveReport,
        archiveReport: archiveReport,
        deleteReport: deleteReport,
        restoreFromArchive: restoreFromArchive,
        archiveAllResolved: archiveAllResolved,

        // Events
        onReportEvent: onReportEvent,

        // Debug
        getStatus: getStatus
    };

    window.QamarReports = QamarReports;

    Logger.info('📦 [reports.js] loaded | reasons:', Object.keys(REASONS).length, '| review level:', CONFIG.MIN_REVIEW_LEVEL);
})();
