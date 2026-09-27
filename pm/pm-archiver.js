// ==============================================
// pm/pm-archiver.js
// Archive old PM messages to save space
// ==============================================
// يعتمد على: firebase.js + pm.js + auth.js + ranks.js
// يعطي: window.QamarPMArchiver
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [pm-archiver] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[ARC]';
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
        INDEX_ROOT: 'pm_archive_index',
        LOCK_PATH: 'system/pm_archiver_lock',
        KEEP_RECENT: 50,
        AUTO_TRIGGER_AT: 200,
        INTERVAL_MS: 6 * 60 * 60 * 1000,     // 6 ساعات
        LOCK_TTL_MS: 10 * 60 * 1000,          // 10 دقائق
        ARCHIVE_BATCH: 100,                    // 100 رسالة لكل أرشفة
        RETENTION_MS: 365 * 24 * 60 * 60 * 1000, // سنة
        CHUNK_SIZE: 50                          // عند الجلب من الأرشيف
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        intervalTimer: null,
        running: false,
        instanceId: null,
        listeners: [],
        _initialized: false,
        lastRunAt: 0,
        stats: { totalArchived: 0, totalChatsProcessed: 0, lastError: null }
    };

    State.instanceId = 'arc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onArchiverEvent(cb) {
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

    function _isKingUid(uid) {
        if (!uid) return false;
        // اقرأ config/king_uid إذا متاح في الكاش
        if (window.AppState && window.AppState.kingUid) {
            return uid === window.AppState.kingUid;
        }
        return false;
    }

    function _msgPath(ownerUid, otherUid) {
        return CONFIG.MSG_ROOT + '/' + ownerUid + '/' + otherUid;
    }

    function _archivePath(ownerUid, otherUid) {
        return CONFIG.ARCHIVE_ROOT + '/' + ownerUid + '/' + otherUid;
    }

    function _indexPath(ownerUid, otherUid) {
        return CONFIG.INDEX_ROOT + '/' + ownerUid + '/' + otherUid;
    }

    /* ══════════════════════════════════════════════ */
    /* Distributed Lock                                */
    /* ══════════════════════════════════════════════ */
    function _acquireLock() {
        return window.QamarFB.transaction(CONFIG.LOCK_PATH, function (cur) {
            if (cur && cur.instanceId === State.instanceId) {
                return { instanceId: State.instanceId, at: Date.now() };
            }
            if (cur && cur.at && (Date.now() - cur.at) < CONFIG.LOCK_TTL_MS) {
                return undefined; // abort — قفل نشط
            }
            return { instanceId: State.instanceId, at: Date.now() };
        }).then(function (r) {
            return !!(r && r.committed && r.snapshot && r.snapshot.instanceId === State.instanceId);
        }).catch(function () { return false; });
    }

    function _releaseLock() {
        return window.QamarFB.transaction(CONFIG.LOCK_PATH, function (cur) {
            if (cur && cur.instanceId === State.instanceId) return null;
            return undefined;
        }).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Archive one chat                                */
    /* ══════════════════════════════════════════════ */
    function archiveChat(ownerUid, otherUid, options) {
        options = options || {};
        const keepRecent = options.keepRecent !== undefined ? options.keepRecent : CONFIG.KEEP_RECENT;

        if (!ownerUid || !otherUid) {
            return Promise.reject(new Error('ownerUid و otherUid مطلوبان'));
        }

        // اقرأ رسائل النشط
        return window.QamarFB.get(_msgPath(ownerUid, otherUid)).then(function (data) {
            if (!data) return { archived: 0, reason: 'empty' };

            const entries = Object.keys(data).map(function (msgId) {
                return Object.assign({ _id: msgId }, data[msgId]);
            });

            // رتب حسب time
            entries.sort(function (a, b) { return (a.time || 0) - (b.time || 0); });

            const total = entries.length;
            const toKeep = entries.slice(-keepRecent);
            const toArchive = entries.slice(0, total - keepRecent);

            if (toArchive.length === 0) {
                return { archived: 0, reason: 'below-threshold', total: total };
            }

            // حدد الدفعة (لا نأرشف أكثر من ARCHIVE_BATCH في جلسة واحدة)
            const batch = toArchive.slice(0, CONFIG.ARCHIVE_BATCH);

            const updates = {};
            batch.forEach(function (m) {
                // انقل للأرشيف
                updates[_archivePath(ownerUid, otherUid) + '/' + m._id] = m;
                // احذف من النشط
                updates[_msgPath(ownerUid, otherUid) + '/' + m._id] = null;
            });

            // حدّث الفهرس
            const now = window.QamarFB.serverTime();
            return window.QamarFB.get(_indexPath(ownerUid, otherUid)).then(function (idx) {
                const prevCount = (idx && Number(idx.count)) || 0;
                const prevTotal = (idx && Number(idx.totalArchived)) || 0;
                updates[_indexPath(ownerUid, otherUid)] = {
                    count: prevCount + batch.length,
                    totalArchived: prevTotal + batch.length,
                    lastArchive: now,
                    keepRecent: keepRecent,
                    lastBatch: batch.length
                };

                return window.QamarFB.multiUpdate(updates).then(function () {
                    Logger.info('📦 Archived', batch.length, 'messages for', ownerUid.substring(0, 6) + '↔' + otherUid.substring(0, 6));
                    _emit('pm:archived', {
                        ownerUid: ownerUid,
                        otherUid: otherUid,
                        archived: batch.length,
                        remaining: total - batch.length
                    });
                    return { archived: batch.length, remaining: total - batch.length };
                });
            });
        }).catch(function (e) {
            Logger.warn('archiveChat failed:', e.message);
            return { archived: 0, error: e.message };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Archive all chats of user                       */
    /* ══════════════════════════════════════════════ */
    function archiveAllForUser(ownerUid, options) {
        options = options || {};
        if (!ownerUid) ownerUid = _getCurrentUid();
        if (!ownerUid) return Promise.resolve({ archived: 0, reason: 'no-uid' });

        // لا يؤرشف الملك إلا بتصريح (بسبب الرقابة)
        if (_isKingUid(ownerUid) && !options.force) {
            return Promise.resolve({ archived: 0, reason: 'king-protected' });
        }

        return window.QamarFB.children(_msgPath(ownerUid, ''))
            .then(function (chats) {
                if (!chats) return { archived: 0 };
                const chatUids = Object.keys(chats);
                let totalArchived = 0;
                let processed = 0;

                // نسلسل العمليات
                let chain = Promise.resolve();
                chatUids.forEach(function (otherUid) {
                    chain = chain.then(function () {
                        // تحقق أن المحادثة تحتاج أرشفة
                        const chat = chats[otherUid] || {};
                        const msgCount = Object.keys(chat).length;
                        if (msgCount <= CONFIG.AUTO_TRIGGER_AT) {
                            return { archived: 0 };
                        }
                        return archiveChat(ownerUid, otherUid, options).then(function (r) {
                            totalArchived += (r.archived || 0);
                            processed++;
                            return r;
                        });
                    });
                });

                return chain.then(function () {
                    return {
                        archived: totalArchived,
                        chatsProcessed: processed,
                        totalChats: chatUids.length
                    };
                });
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Manual: archive current user (convenience)      */
    /* ══════════════════════════════════════════════ */
    function archiveMine() {
        return archiveAllForUser(_getCurrentUid(), { force: false });
    }

    /* ══════════════════════════════════════════════ */
    /* Read from archive                               */
    /* ══════════════════════════════════════════════ */
    function getArchivedMessages(otherUid, options) {
        options = options || {};
        const me = _getCurrentUid();
        if (!me || !otherUid) return Promise.resolve([]);

        const limit = Math.min(options.limit || CONFIG.CHUNK_SIZE, 200);
        const offset = Math.max(options.offset || 0, 0);

        return window.QamarFB.get(_archivePath(me, otherUid)).then(function (data) {
            if (!data) return [];

            const entries = Object.keys(data).map(function (msgId) {
                return Object.assign({ _id: msgId }, data[msgId]);
            }).filter(function (m) { return !m.deleted; });

            // رتب حسب time (الأحدث أولاً)
            entries.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });

            // slice من offset
            const sliced = entries.slice(offset, offset + limit);
            return sliced;
        }).catch(function () { return []; });
    }

    function countArchived(otherUid) {
        const me = _getCurrentUid();
        if (!me || !otherUid) return Promise.resolve(0);
        return window.QamarFB.get(_archivePath(me, otherUid)).then(function (data) {
            if (!data) return 0;
            return Object.keys(data).length;
        }).catch(function () { return 0; });
    }

    function getArchiveIndex(otherUid) {
        const me = _getCurrentUid();
        if (!me || !otherUid) return Promise.resolve(null);
        return window.QamarFB.get(_indexPath(me, otherUid))
            .catch(function () { return null; });
    }

    /* ══════════════════════════════════════════════ */
    /* Clear archive (يدوي)                            */
    /* ══════════════════════════════════════════════ */
    function clearArchive(otherUid) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me || !otherUid) throw new Error('بيانات ناقصة');

            const updates = {};
            updates[_archivePath(me, otherUid)] = null;
            updates[_indexPath(me, otherUid)] = null;

            return window.QamarFB.multiUpdate(updates).then(function () {
                Logger.info('🗑️ Archive cleared:', otherUid.substring(0, 8));
                _emit('pm:archiveCleared', { otherUid: otherUid });
                return { ok: true };
            });
        });
    }

    function clearAllArchives() {
        return Promise.resolve().then(function () {
            if (!_isKing()) throw new Error('فقط الملك');
            const me = _getCurrentUid();
            if (!me) throw new Error('غير مسجل');

            const updates = {};
            updates[_archivePath(me, '')] = null;
            updates[_indexPath(me, '')] = null;

            return window.QamarFB.multiUpdate(updates).then(function () {
                Logger.info('🗑️ All archives cleared');
                return { ok: true };
            });
        });
    }

    // تفريغ أرشيف مستخدم آخر (للملك)
    function clearUserArchive(userUid) {
        return Promise.resolve().then(function () {
            if (!_isKing()) throw new Error('فقط الملك');
            if (!userUid) throw new Error('uid مطلوب');

            const updates = {};
            updates[_archivePath(userUid, '')] = null;
            updates[_indexPath(userUid, '')] = null;

            return window.QamarFB.multiUpdate(updates).then(function () {
                Logger.info('🗑️ User archive cleared:', userUid.substring(0, 8));
                return { ok: true };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* King API: archive user                          */
    /* ══════════════════════════════════════════════ */
    function archiveUser(userUid) {
        return Promise.resolve().then(function () {
            if (!_isKing()) throw new Error('فقط الملك');
            if (!userUid) throw new Error('uid مطلوب');
            return archiveAllForUser(userUid, { force: true });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Cleanup: delete archives > retention            */
    /* ══════════════════════════════════════════════ */
    function cleanupOldArchives() {
        const me = _getCurrentUid();
        if (!me) return Promise.resolve({ deleted: 0 });

        return window.QamarFB.children(_archivePath(me, ''))
            .then(function (chats) {
                if (!chats) return { deleted: 0 };
                const cutoff = Date.now() - CONFIG.RETENTION_MS;
                const updates = {};
                let deleted = 0;

                Object.keys(chats).forEach(function (otherUid) {
                    const msgs = chats[otherUid];
                    if (!msgs) return;
                    Object.keys(msgs).forEach(function (msgId) {
                        const m = msgs[msgId];
                        if (m && m.time && m.time < cutoff) {
                            updates[_archivePath(me, otherUid) + '/' + msgId] = null;
                            deleted++;
                        }
                    });
                });

                if (deleted === 0) return { deleted: 0 };
                return window.QamarFB.multiUpdate(updates).then(function () {
                    Logger.info('🧹 Deleted', deleted, 'old archived messages');
                    return { deleted: deleted };
                });
            }).catch(function () { return { deleted: 0 }; });
    }

    /* ══════════════════════════════════════════════ */
    /* Auto-run cycle                                  */
    /* ══════════════════════════════════════════════ */
    function _runCycle(force) {
        if (State.running && !force) return Promise.resolve({ skipped: 'running' });
        State.running = true;

        return _acquireLock().then(function (acquired) {
            if (!acquired && !force) {
                Logger.debug('Lock not acquired — skipping');
                State.running = false;
                return { skipped: 'locked' };
            }
            const me = _getCurrentUid();
            if (!me) {
                State.running = false;
                return { skipped: 'no-user' };
            }
            return archiveMine().then(function (r) {
                State.lastRunAt = Date.now();
                State.stats.totalArchived += (r.archived || 0);
                State.stats.totalChatsProcessed += (r.chatsProcessed || 0);
                return r;
            });
        }).then(function (r) {
            State.running = false;
            return _releaseLock().then(function () { return r; });
        }).catch(function (e) {
            State.running = false;
            State.stats.lastError = e.message;
            Logger.warn('cycle failed:', e.message);
            return _releaseLock().then(function () { return { error: e.message }; });
        });
    }

    function start() {
        if (State.intervalTimer) return;
        // أول تشغيل بعد 30 ثانية
        setTimeout(function () { _runCycle(false); }, 30000);
        State.intervalTimer = setInterval(function () {
            _runCycle(false);
        }, CONFIG.INTERVAL_MS);
        Logger.info('▶️ Auto-archiver started | interval:', CONFIG.INTERVAL_MS / 1000 / 60, 'min');
    }

    function stop() {
        if (State.intervalTimer) {
            clearInterval(State.intervalTimer);
            State.intervalTimer = null;
        }
        Logger.info('⏹️ Auto-archiver stopped');
    }

    /* ══════════════════════════════════════════════ */
    /* Hook: عند تجاوز 200 رسالة → أرشفة فورية         */
    /* ══════════════════════════════════════════════ */
    function _hookAutoTrigger() {
        if (!window.EventBus) return;
        window.EventBus.on('pm:sent', function (p) {
            // بعد إرسال رسالة → افحص
            if (!p || !p.toUid) return;
            const me = _getCurrentUid();
            if (!me) return;
            // عدد رسائل المحادثة
            window.QamarFB.get(_msgPath(me, p.toUid)).then(function (data) {
                if (!data) return;
                const n = Object.keys(data).length;
                if (n > CONFIG.AUTO_TRIGGER_AT) {
                    // أرشف (بدون قفل — سريع)
                    archiveChat(me, p.toUid).catch(function () {});
                }
            }).catch(function () {});
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;

        _hookAutoTrigger();

        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (p.isLoggedIn) {
                    // ابدأ الدورة بعد دخول
                    setTimeout(function () { start(); }, 5000);
                } else {
                    stop();
                }
            });
        }

        Logger.info('📦 [pm-archiver.js] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 2500);
        });
    } else {
        setTimeout(_init, 7000);
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            running: State.running,
            instanceId: State.instanceId,
            lastRunAt: State.lastRunAt,
            keepRecent: CONFIG.KEEP_RECENT,
            autoTriggerAt: CONFIG.AUTO_TRIGGER_AT,
            retention: CONFIG.RETENTION_MS / 1000 / 60 / 60 / 24 + ' days',
            stats: State.stats
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarPMArchiver = {
        CONFIG: CONFIG,

        // Lifecycle
        start: start,
        stop: stop,

        // Manual archive
        archiveChat: archiveChat,
        archiveAllForUser: archiveAllForUser,
        archiveMine: archiveMine,
        archiveUser: archiveUser,

        // Read archive
        getArchivedMessages: getArchivedMessages,
        countArchived: countArchived,
        getArchiveIndex: getArchiveIndex,

        // Clear
        clearArchive: clearArchive,
        clearAllArchives: clearAllArchives,
        clearUserArchive: clearUserArchive,
        cleanupOldArchives: cleanupOldArchives,

        // Manual run
        runCycle: function () { return _runCycle(true); },

        // Events
        onArchiverEvent: onArchiverEvent,

        // Debug
        getStatus: getStatus
    };

    Logger.info('📦 [pm-archiver.js] loaded | keep:', CONFIG.KEEP_RECENT, '| trigger:', CONFIG.AUTO_TRIGGER_AT);
})();
