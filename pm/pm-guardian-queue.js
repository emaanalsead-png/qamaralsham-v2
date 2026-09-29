// ==============================================
// pm/pm-guardian-queue.js — قناة فورية للأحداث
// ==============================================
// يعتمد على: firebase.js + auth.js + ranks.js + audit.js + adaptive.js
// يعطي: window.QamarGuardianQueue
// ==============================================
// ⭐ v1:
//   1. queue فورية للأحداث المشتبه فيها
//   2. أي مستخدم 90+ يستطيع المعالجة
//   3. قفل موزّع على كل حدث (transaction)
//   4. Polling كل 15s (Android-friendly)
//   5. الملك يستلم كل شيء في guardian_inbox
//   6. تعطيل تلقائي عند very-slow
//   7. تنظيف تلقائي (24h)
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [guardian-queue] firebase.js not loaded!');
        return;
    }

    if (window.QamarGuardianQueue && window.QamarGuardianQueue.__v1) return;

    const LOG_TAG = '[GQ]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice(arguments))); }
    };

    // (إصلاح سريع لخطأ محتمل)
    Logger.error = function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); };

    /* ══════════════════════════════════════════════ */
    /* Config                                          */
    /* ══════════════════════════════════════════════ */
    const CONFIG = {
        QUEUE_ROOT: 'guardian_alerts_queue',
        INBOX_ROOT: 'guardian_inbox',
        POLL_INTERVAL_MS: 15 * 1000,        // 15s (Android-friendly)
        POLL_INTERVAL_SLOW_MS: 45 * 1000,   // على نت بطيء
        MAX_QUEUE_SIZE: 200,                // حد الأمان
        DELETE_AFTER_MS: 30 * 1000,         // 30s بعد المعالجة
        CLEANUP_OLD_MS: 24 * 60 * 60 * 1000,// 24h
        PROCESSED_TTL_MS: 60 * 1000,        // 60s — تجاهل المُعالَج
        MIN_LEVEL: 90,                      // فقط 90+
        PREVIEW_MAX: 120,
        WORD_MAX: 20
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        listening: false,
        pollTimer: null,
        processedIds: {},       // { autoId: timestamp } — تجاهل سريع
        listeners: [],
        lastProcessedAt: 0,
        stats: {
            pushed: 0,
            processed: 0,
            failed: 0,
            skipped: 0
        },
        _initialized: false,
        _adaptiveBound: false,
        _cleanedAt: 0
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onQueueEvent(cb) {
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
        } catch (e) {}
        return '—';
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        const u = (window.AppState && window.AppState.user) || null;
        return u ? Number(u.rankLevel) || 0 : 0;
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _canProcess() {
        // ⭐ يسمح لأي مستخدم 90+ (حتى لو الملك غير متصل)
        return _myLevel() >= CONFIG.MIN_LEVEL;
    }

    function _isQueueEnabled() {
        if (window.QamarAdaptive && typeof window.QamarAdaptive.isEnabled === 'function') {
            return window.QamarAdaptive.isEnabled('botPollingEnabled');
        }
        return true;
    }

    function _getPollInterval() {
        if (window.QamarAdaptive && typeof window.QamarAdaptive.get === 'function') {
            const profile = window.QamarAdaptive.getProfileName();
            if (profile === 'slow' || profile === 'very-slow') {
                return CONFIG.POLL_INTERVAL_SLOW_MS;
            }
        }
        return CONFIG.POLL_INTERVAL_MS;
    }

    function _maskWord(w) {
        if (!w) return '***';
        const s = String(w);
        if (s.length <= 2) return s[0] + '*';
        if (s.length <= 4) return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
        return s[0] + '*'.repeat(Math.min(s.length - 2, 5)) + s[s.length - 1];
    }

    function _sanitizePreview(s) {
        if (!s) return '';
        return String(s).replace(/\s+/g, ' ').trim().substring(0, CONFIG.PREVIEW_MAX);
    }

    function _now() { return Date.now(); }

    /* ══════════════════════════════════════════════ */
    /* PUSH — يُستدعى من pm.js                         */
    /* ══════════════════════════════════════════════ */
    /**
     * يُضاف حدث مشتبه فيه للـ queue.
     * @param {Object} event
     * @returns {Promise<{ok, key}>}
     */
    function push(event) {
        if (!event || typeof event !== 'object') {
            return Promise.reject(new Error('event مطلوب'));
        }
        if (!event.type) {
            return Promise.reject(new Error('type مطلوب'));
        }

        return Promise.resolve().then(function () {
            // فحص الحد
            return _checkQueueSize();
        }).then(function (canPush) {
            if (!canPush) {
                Logger.warn('Queue at max size — dropping new event');
                State.stats.failed++;
                return { ok: false, reason: 'queue-full' };
            }

            const me = _getCurrentUid();
            const meName = _getCurrentName();
            const now = _now();

            const payload = {
                type: event.type,
                severity: event.severity || 'info',

                suspectUid: event.suspectUid || null,
                suspectName: event.suspectName || null,
                suspectAvatar: event.suspectAvatar || null,

                victimUid: event.victimUid || null,
                victimName: event.victimName || null,

                matchedWordMasked: event.matchedWord ? _maskWord(event.matchedWord) : null,
                messagePreview: _sanitizePreview(event.messagePreview),
                side: event.side || 'unknown',

                reporterUid: me,
                reporterName: meName,

                at: window.QamarFB.serverTime(),
                status: 'pending',
                _processed: false
            };

            return window.QamarFB.push(CONFIG.QUEUE_ROOT, payload).then(function (key) {
                State.stats.pushed++;
                Logger.info('📤 Queue push:', event.type, '→', key);
                _emit('guardian-queue:pushed', { key: key, event: payload });
                return { ok: true, key: key };
            });
        }).catch(function (e) {
            Logger.warn('push failed:', e.message);
            State.stats.failed++;
            return { ok: false, error: e.message };
        });
    }

    function _checkQueueSize() {
        return window.QamarFB.get(CONFIG.QUEUE_ROOT).then(function (data) {
            if (!data) return true;
            const count = Object.keys(data).length;
            if (count > CONFIG.MAX_QUEUE_SIZE) {
                Logger.warn('Queue size:', count, '— max exceeded');
                return false;
            }
            return true;
        }).catch(function () { return true; });
    }

    /* ══════════════════════════════════════════════ */
    /* PROCESS — transaction per event                 */
    /* ══════════════════════════════════════════════ */
    function _processEvent(key, data) {
        if (!data) return Promise.resolve({ skipped: 'no-data' });

        // تجاهل إذا معالج بالفعل
        if (data._processed === true) {
            State.stats.skipped++;
            return Promise.resolve({ skipped: 'already-processed' });
        }

        // تجاهل إذا في الذاكرة المحلية
        if (State.processedIds[key]) {
            State.stats.skipped++;
            return Promise.resolve({ skipped: 'local-cache' });
        }

        // ⭐ Transaction — أول من يكتب يفوز
        return window.QamarFB.transaction(
            CONFIG.QUEUE_ROOT + '/' + key + '/_processed',
            function (cur) {
                if (cur === true) return undefined;  // abort
                return true;
            }
        ).then(function (r) {
            if (!r || !r.committed) {
                State.stats.skipped++;
                State.processedIds[key] = _now();
                return { skipped: 'abort' };
            }

            // ⭐ فزنا — نحن المعالج
            State.processedIds[key] = _now();

            // 1) اكتب في guardian_inbox/{king_uid}
            return _writeToInbox(key, data).then(function () {
                // 2) حدّث status
                return window.QamarFB.update(CONFIG.QUEUE_ROOT + '/' + key, {
                    status: 'done',
                    _processedAt: window.QamarFB.serverTime(),
                    _processedBy: _getCurrentUid()
                }).catch(function () {});
            }).then(function () {
                // 3) احذف بعد 30s
                setTimeout(function () {
                    window.QamarFB.remove(CONFIG.QUEUE_ROOT + '/' + key)
                        .catch(function () {});
                    delete State.processedIds[key];
                }, CONFIG.DELETE_AFTER_MS);

                State.stats.processed++;
                Logger.info('✅ Queue processed:', key);
                _emit('guardian-queue:processed', { key: key, event: data });
                return { ok: true, key: key };
            });
        }).catch(function (e) {
            Logger.warn('process failed:', e.message);
            State.stats.failed++;
            return { error: e.message };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Write to guardian_inbox                         */
    /* ══════════════════════════════════════════════ */
    function _writeToInbox(queueKey, event) {
        return window.QamarFB.get('config/king_uid').then(function (kingUid) {
            if (!kingUid) {
                Logger.warn('king_uid not set — inbox write skipped');
                return null;
            }

            const sevIcon = event.severity === 'kick' ? '🚪' : (event.severity === 'jail' ? '⚠️' : 'ℹ️');
            const sevLabel = event.severity === 'kick' ? 'كلمة طرد' :
                            (event.severity === 'jail' ? 'كلمة سجن' : 'تنبيه');

            const text = [
                sevIcon + ' ' + sevLabel + ' — رسالة خاصة',
                '',
                '👤 المُخالف: ' + (event.suspectName || '—'),
                '👤 الضحية: ' + (event.victimName || '—'),
                '📝 كلمة: ' + (event.matchedWordMasked || '—'),
                '💬 ' + (event.messagePreview || '—').substring(0, 80),
                '',
                '🕐 ' + new Date().toLocaleString('ar-EG'),
                '🔍 اكتشفه: ' + (event.reporterName || '—')
            ].join('\n');

            const inboxPayload = {
                from: 'guardian_queue',
                fromName: '🚔 السجان',
                type: event.type,
                severity: event.severity,
                queueKey: queueKey,
                suspectUid: event.suspectUid,
                suspectName: event.suspectName,
                suspectAvatar: event.suspectAvatar,
                victimUid: event.victimUid,
                victimName: event.victimName,
                matchedWord: event.matchedWordMasked,
                messagePreview: event.messagePreview,
                side: event.side,
                reporterUid: event.reporterUid,
                reporterName: event.reporterName,
                text: text,
                at: window.QamarFB.serverTime(),
                read: false
            };

            const inboxKey = window.QamarFB.ref(CONFIG.INBOX_ROOT + '/' + kingUid).push().key;
            return window.QamarFB.set(CONFIG.INBOX_ROOT + '/' + kingUid + '/' + inboxKey, inboxPayload);
        }).catch(function (e) {
            Logger.warn('writeToInbox failed:', e.message);
            return null;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* POLL — يقرأ الجديد ويعالج                       */
    /* ══════════════════════════════════════════════ */
    function _poll() {
        if (!_canProcess()) return Promise.resolve({ skipped: 'no-perm' });
        if (!_isQueueEnabled()) return Promise.resolve({ skipped: 'disabled' });

        // اقرأ آخر 50 حدث
        return window.QamarFB.query(CONFIG.QUEUE_ROOT, {
            orderByChild: 'at',
            limitToLast: 50,
            returnArray: true
        }).then(function (arr) {
            if (!arr || arr.length === 0) return { processed: 0 };

            // فلترة: pending + ليس في processedIds
            const pending = arr.filter(function (r) {
                const d = r.data || {};
                if (d._processed === true) return false;
                if (State.processedIds[r.id]) return false;
                return true;
            });

            if (pending.length === 0) return { processed: 0 };

            // معالجة تسلسلية (لتقليل الضغط)
            let chain = Promise.resolve();
            let processed = 0;

            pending.forEach(function (r) {
                chain = chain.then(function () {
                    return _processEvent(r.id, r.data).then(function (res) {
                        if (res && res.ok) processed++;
                    });
                });
            });

            return chain.then(function () {
                State.lastProcessedAt = _now();
                if (processed > 0) {
                    Logger.info('📥 Queue poll: processed', processed, 'events');
                }
                return { processed: processed };
            });
        }).catch(function (e) {
            Logger.warn('poll failed:', e.message);
            return { error: e.message };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* LISTEN — start polling                          */
    /* ══════════════════════════════════════════════ */
    function listen() {
        if (State.listening) return;
        if (!_canProcess()) {
            Logger.debug('Cannot listen — level < ' + CONFIG.MIN_LEVEL);
            return;
        }

        State.listening = true;

        // poll أولي بعد 3s
        setTimeout(function () { _poll(); }, 3000);

        // دوري
        const interval = _getPollInterval();
        State.pollTimer = setInterval(_poll, interval);

        Logger.info('👂 Guardian queue listening (interval:', interval + 'ms, level:', _myLevel() + ')');
        _emit('guardian-queue:listening', { interval: interval });
    }

    function stop() {
        if (State.pollTimer) {
            clearInterval(State.pollTimer);
            State.pollTimer = null;
        }
        State.listening = false;
        Logger.info('👂 Guardian queue stopped');
        _emit('guardian-queue:stopped', {});
    }

    /* ══════════════════════════════════════════════ */
    /* PROCESS ALL — عند login (batch)                 */
    /* ══════════════════════════════════════════════ */
    function processAll() {
        if (!_canProcess()) return Promise.resolve({ skipped: 'no-perm' });

        return window.QamarFB.get(CONFIG.QUEUE_ROOT).then(function (data) {
            if (!data) return { processed: 0 };
            const keys = Object.keys(data).filter(function (k) {
                return !data[k]._processed && !State.processedIds[k];
            });

            if (keys.length === 0) return { processed: 0 };

            Logger.info('📥 processAll:', keys.length, 'pending events');

            let chain = Promise.resolve();
            let n = 0;

            keys.slice(0, 100).forEach(function (key) {
                chain = chain.then(function () {
                    return _processEvent(key, data[key]).then(function (r) {
                        if (r && r.ok) n++;
                    });
                });
            });

            return chain.then(function () {
                return { processed: n, total: keys.length };
            });
        }).catch(function () { return { processed: 0 }; });
    }

    /* ══════════════════════════════════════════════ */
    /* CLEANUP — حذف الأقدم من 24h                     */
    /* ══════════════════════════════════════════════ */
    function cleanupOld() {
        const now = _now();
        if (now - State._cleanedAt < 60 * 60 * 1000) return Promise.resolve({ skipped: 'recent' });
        State._cleanedAt = now;

        const cutoff = now - CONFIG.CLEANUP_OLD_MS;

        return window.QamarFB.get(CONFIG.QUEUE_ROOT).then(function (data) {
            if (!data) return { cleaned: 0 };
            const updates = {};
            let cleaned = 0;

            Object.keys(data).forEach(function (key) {
                const e = data[key];
                if (!e || !e.at) return;
                if (e.at < cutoff) {
                    updates[CONFIG.QUEUE_ROOT + '/' + key] = null;
                    cleaned++;
                }
            });

            if (cleaned === 0) return { cleaned: 0 };

            return window.QamarFB.multiUpdate(updates).then(function () {
                Logger.info('🧹 Cleaned', cleaned, 'old queue events');
                return { cleaned: cleaned };
            });
        }).catch(function () { return { cleaned: 0 }; });
    }

    /* ══════════════════════════════════════════════ */
    /* Adaptive binding                                */
    /* ══════════════════════════════════════════════ */
    function _bindAdaptive() {
        if (State._adaptiveBound) return;
        if (!window.QamarAdaptive || typeof window.QamarAdaptive.onFeatureChange !== 'function') {
            setTimeout(_bindAdaptive, 1000);
            return;
        }
        State._adaptiveBound = true;

        window.QamarAdaptive.onFeatureChange('botPollingEnabled', function (payload) {
            if (payload.value === false) {
                Logger.info('⏸️ Queue stopped (net slow)');
                stop();
            } else {
                Logger.info('▶️ Queue resumed');
                listen();
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

        // ابدأ عند تسجيل الدخول
        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (p.isLoggedIn) {
                    setTimeout(function () {
                        if (_canProcess()) {
                            processAll().then(function () {
                                listen();
                            });
                        }
                    }, 3000);

                    // تنظيف كل ساعة
                    setTimeout(function () { cleanupOld(); }, 60 * 1000);
                } else {
                    stop();
                }
            });
        }

        Logger.info('📦 [pm-guardian-queue.js] initialized');
    }

    if (window.QamarBoot && typeof window.QamarBoot.whenReady === 'function') {
        window.QamarBoot.whenReady('background', function () {
            setTimeout(_init, 1000);
        });
    } else if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 2000);
        });
    } else {
        setTimeout(_init, 5000);
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            listening: State.listening,
            myLevel: _myLevel(),
            canProcess: _canProcess(),
            queueEnabled: _isQueueEnabled(),
            pollInterval: _getPollInterval(),
            processedIdsCount: Object.keys(State.processedIds).length,
            lastProcessedAt: State.lastProcessedAt,
            stats: Object.assign({}, State.stats)
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarGuardianQueue = {
        __v1: true,
        CONFIG: CONFIG,

        // Push (من pm.js)
        push: push,

        // Process
        listen: listen,
        stop: stop,
        processAll: processAll,
        poll: _poll,
        cleanupOld: cleanupOld,

        // Events
        onQueueEvent: onQueueEvent,

        // Debug
        getStatus: getStatus,
        _forceCleanLocal: function () {
            State.processedIds = {};
        }
    };

    Logger.info('📦 [pm-guardian-queue.js] loaded — decentralized monitoring');
})();
