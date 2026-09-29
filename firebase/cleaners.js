// ==============================================
// firebase/cleaners.js
// Scheduled auto-cleanup jobs
// ==============================================
// يعتمد على: firebase.js + resilience.js
// يعطي: window.QamarCleaners
// ==============================================
// ✅ v2.1: ينتظر auth + الملك فقط (لا permission_denied)
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [cleaners] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[CLN]';
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
        STORIES_TTL_MS:       24 * 60 * 60 * 1000,
        STORIES_INTERVAL_MS:  6 * 60 * 60 * 1000,
        VOICE_MSGS_TTL_MS:    60 * 60 * 1000,
        VOICE_MSGS_INTERVAL_MS: 15 * 60 * 1000,
        PM_VOICE_INTERVAL_MS: 30 * 60 * 1000,
        AUDIT_TTL_MS:         30 * 24 * 60 * 60 * 1000,
        AUDIT_INTERVAL_MS:    24 * 60 * 60 * 1000,
        NOTIF_TTL_MS:         7 * 24 * 60 * 60 * 1000,
        NOTIF_INTERVAL_MS:    12 * 60 * 60 * 1000,
        LOCK_CLEAN_INTERVAL_MS: 10 * 60 * 1000,
        SESSION_INTERVAL_MS:  24 * 60 * 60 * 1000,
        LOCK_TIMEOUT_MS:      30 * 60 * 1000,
        MAX_BATCH_SIZE:       200,
        // ⭐ v2.1
        FIRST_RUN_DELAY_MS:   45000,     // 45s بعد التحميل
        MIN_LEVEL:            90          // 90+ أو الملك
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        jobs: {},
        running: false,
        startedAt: 0,
        instanceId: null,
        activeJobs: {},
        // ⭐ v2.1: إذا فشل قفل واحد بسبب الصلاحيات → أوقف الكل
        _permDenied: false
    };

    function _genInstanceId() {
        return 'inst_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    }
    State.instanceId = _genInstanceId();

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _hasUser() {
        return !!(window.auth && window.auth.currentUser);
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) {
            try { return window.QamarRanks.isKing(); } catch (e) { return false; }
        }
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) {
            try { return window.QamarRanks.myLevel(); } catch (e) { return 0; }
        }
        return 0;
    }

    // ⭐ v2.1: cleaners تعمل فقط لمن 90+ أو الملك
    function _canRunCleaners() {
        if (!_hasUser()) return false;
        if (_isKing()) return true;
        return _myLevel() >= CONFIG.MIN_LEVEL;
    }

    /* ══════════════════════════════════════════════ */
    /* Distributed Lock                                */
    /* ══════════════════════════════════════════════ */
    const LOCK_ROOT = 'system';

    function _lockPath(jobName) {
        return LOCK_ROOT + '/' + jobName + '_lock';
    }

    function _acquireLock(jobName) {
        // ⭐ v2.1: إذا فشل سابقاً → لا تحاول مجدداً
        if (State._permDenied) {
            return Promise.resolve({ acquired: false, data: null, reason: 'disabled' });
        }

        const path = _lockPath(jobName);
        const myLock = {
            instanceId: State.instanceId,
            at: Date.now()
        };

        return window.QamarFB.transaction(path, function (current) {
            if (!current) return myLock;
            if (Date.now() - (current.at || 0) > CONFIG.LOCK_TIMEOUT_MS) {
                return myLock;
            }
            if (current.instanceId === State.instanceId) {
                return myLock;
            }
            return undefined;
        }).then(function (res) {
            return {
                acquired: !!(res && res.committed && res.snapshot && res.snapshot.instanceId === State.instanceId),
                data: res ? res.snapshot : null
            };
        }).catch(function (err) {
            const msg = (err && err.message) || '';
            // ⭐ v2.1: إذا permission_denied → أوقف كل الـ cleaners
            if (msg.indexOf('permission') !== -1 || msg.indexOf('PERMISSION') !== -1) {
                if (!State._permDenied) {
                    State._permDenied = true;
                    Logger.warn('🔒 Cleaners disabled — permission denied on system locks');
                }
            } else {
                Logger.debug('Lock acquire failed for', jobName, msg);
            }
            return { acquired: false, data: null };
        });
    }

    function _releaseLock(jobName) {
        if (State._permDenied) return Promise.resolve();
        const path = _lockPath(jobName);
        return window.QamarFB.transaction(path, function (current) {
            if (!current) return null;
            if (current.instanceId !== State.instanceId) return undefined;
            return null;
        }).catch(function () { return null; });
    }

    /* ══════════════════════════════════════════════ */
    /* Job Runner                                      */
    /* ══════════════════════════════════════════════ */
    function _registerJob(name, fn, intervalMs) {
        if (State.jobs[name]) {
            Logger.warn('Job already registered:', name);
            return;
        }
        State.jobs[name] = {
            name: name,
            fn: fn,
            intervalMs: intervalMs,
            timer: null,
            lastRun: 0,
            lastResult: null,
            runs: 0,
            errors: 0
        };
    }

    function _runJob(name, force) {
        const job = State.jobs[name];
        if (!job) return Promise.resolve({ skipped: 'unknown' });

        // ⭐ v2.1: تحقق أولاً
        if (!force && !_canRunCleaners()) {
            return Promise.resolve({ skipped: 'no-permission' });
        }

        if (State._permDenied) {
            return Promise.resolve({ skipped: 'disabled' });
        }

        if (State.activeJobs[name]) {
            return Promise.resolve({ skipped: 'running' });
        }

        State.activeJobs[name] = true;

        return _acquireLock(name).then(function (lock) {
            if (!lock.acquired && !force) {
                State.activeJobs[name] = false;
                return { skipped: 'locked' };
            }

            Logger.info('🔧 Running job:', name);
            const start = Date.now();

            return Promise.resolve()
                .then(function () { return job.fn(); })
                .then(function (result) {
                    const elapsed = Date.now() - start;
                    job.lastRun = Date.now();
                    job.lastResult = { ok: true, elapsed: elapsed, result: result };
                    job.runs++;
                    Logger.info('✅ Job done:', name, '(' + elapsed + 'ms)');
                    return { ok: true, elapsed: elapsed, result: result };
                })
                .catch(function (err) {
                    job.lastRun = Date.now();
                    job.lastResult = { ok: false, error: err.message };
                    job.errors++;
                    const msg = err.message || '';
                    if (msg.indexOf('permission') === -1 && msg.indexOf('PERMISSION') === -1) {
                        Logger.warn('Job failed:', name, msg);
                    }
                    return { ok: false, error: msg };
                })
                .then(function (r) {
                    State.activeJobs[name] = false;
                    return _releaseLock(name).then(function () { return r; });
                });
        }).catch(function (err) {
            State.activeJobs[name] = false;
            Logger.debug('Job runner error:', name, err.message);
            return { ok: false, error: err.message };
        });
    }

    function _scheduleJob(name) {
        const job = State.jobs[name];
        if (!job) return;
        if (job.timer) clearTimeout(job.timer);

        const run = function () {
            _runJob(name).then(function () {
                if (State._permDenied) return; // لا تعيد الجدولة
                job.timer = setTimeout(run, job.intervalMs);
            });
        };

        // أول تشغيل بعد 45 ثانية (لكي يمنح الوقت للمستخدم)
        job.timer = setTimeout(run, CONFIG.FIRST_RUN_DELAY_MS);
    }

    function _startJob(name) {
        _scheduleJob(name);
    }

    function _stopJob(name) {
        const job = State.jobs[name];
        if (job && job.timer) {
            clearTimeout(job.timer);
            job.timer = null;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* JOB 1: Stories Cleaner                          */
    /* ══════════════════════════════════════════════ */
    function _cleanStories() {
        const cutoff = Date.now();
        return window.QamarFB.children('stories').then(function (users) {
            if (!users) return { scanned: 0, removed: 0 };
            const updates = {};
            let scanned = 0, removed = 0;

            Object.keys(users).forEach(function (uid) {
                const userStories = users[uid];
                if (!userStories || typeof userStories !== 'object') return;
                Object.keys(userStories).forEach(function (sid) {
                    const story = userStories[sid];
                    if (!story) return;
                    scanned++;
                    const expiresAt = story.expiresAt || ((story.createdAt || 0) + CONFIG.STORIES_TTL_MS);
                    if (expiresAt > 0 && expiresAt < cutoff) {
                        updates['stories/' + uid + '/' + sid] = null;
                        removed++;
                    }
                });
            });

            if (removed === 0) return { scanned: scanned, removed: 0 };

            const keys = Object.keys(updates);
            const batches = [];
            for (let i = 0; i < keys.length; i += CONFIG.MAX_BATCH_SIZE) {
                const batch = {};
                keys.slice(i, i + CONFIG.MAX_BATCH_SIZE).forEach(function (k) { batch[k] = null; });
                batches.push(batch);
            }

            return batches.reduce(function (p, b) {
                return p.then(function () { return window.QamarFB.multiUpdate(b); });
            }, Promise.resolve()).then(function () {
                return { scanned: scanned, removed: removed };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* JOB 2: Room Voice Messages Cleaner              */
    /* ══════════════════════════════════════════════ */
    function _cleanRoomVoiceMsgs() {
        const now = Date.now();
        return window.QamarFB.children('room_voice_msgs').then(function (rooms) {
            if (!rooms) return { scanned: 0, removed: 0 };
            const updates = {};
            let scanned = 0, removed = 0;

            Object.keys(rooms).forEach(function (roomId) {
                const msgs = rooms[roomId];
                if (!msgs) return;
                Object.keys(msgs).forEach(function (rid) {
                    const m = msgs[rid];
                    if (!m) return;
                    scanned++;
                    const exp = m.expiresAt || ((m.createdAt || 0) + CONFIG.VOICE_MSGS_TTL_MS);
                    if (exp > 0 && exp < now) {
                        updates['room_voice_msgs/' + roomId + '/' + rid] = null;
                        removed++;
                    }
                });
            });

            if (removed === 0) return { scanned: scanned, removed: 0 };

            const keys = Object.keys(updates);
            const batches = [];
            for (let i = 0; i < keys.length; i += CONFIG.MAX_BATCH_SIZE) {
                const batch = {};
                keys.slice(i, i + CONFIG.MAX_BATCH_SIZE).forEach(function (k) { batch[k] = null; });
                batches.push(batch);
            }

            return batches.reduce(function (p, b) {
                return p.then(function () { return window.QamarFB.multiUpdate(b); });
            }, Promise.resolve()).then(function () {
                return { scanned: scanned, removed: removed };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* JOB 3: PM Voice Messages Cleaner                */
    /* ══════════════════════════════════════════════ */
    function _cleanPMVoiceMsgs() {
        return window.QamarFB.children('pm_voice_msgs').then(function (users) {
            if (!users) return { scanned: 0, removed: 0 };
            const updates = {};
            let scanned = 0, removed = 0;

            Object.keys(users).forEach(function (uid) {
                const msgs = users[uid];
                if (!msgs) return;
                Object.keys(msgs).forEach(function (rid) {
                    const m = msgs[rid];
                    if (!m) return;
                    scanned++;
                    if (m.viewed === true) {
                        updates['pm_voice_msgs/' + uid + '/' + rid] = null;
                        removed++;
                    }
                });
            });

            if (removed === 0) return { scanned: scanned, removed: 0 };

            const keys = Object.keys(updates);
            const batches = [];
            for (let i = 0; i < keys.length; i += CONFIG.MAX_BATCH_SIZE) {
                const batch = {};
                keys.slice(i, i + CONFIG.MAX_BATCH_SIZE).forEach(function (k) { batch[k] = null; });
                batches.push(batch);
            }

            return batches.reduce(function (p, b) {
                return p.then(function () { return window.QamarFB.multiUpdate(b); });
            }, Promise.resolve()).then(function () {
                return { scanned: scanned, removed: removed };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* JOB 4: Locks Cleanup                            */
    /* ══════════════════════════════════════════════ */
    function _cleanStaleLocks() {
        const cutoff = Date.now() - CONFIG.LOCK_TIMEOUT_MS;
        const jobs = ['stories_cleaner', 'room_voice_cleaner', 'pm_voice_cleaner',
                      'audit_cleaner', 'notif_cleaner', 'session_cleaner'];
        const updates = {};

        return Promise.all(jobs.map(function (j) {
            return window.QamarFB.get(_lockPath(j)).catch(function () { return null; });
        })).then(function (locks) {
            locks.forEach(function (lock, i) {
                if (lock && lock.at < cutoff) {
                    updates[_lockPath(jobs[i])] = null;
                }
            });
            if (Object.keys(updates).length === 0) return { cleaned: 0 };
            return window.QamarFB.multiUpdate(updates).then(function () {
                return { cleaned: Object.keys(updates).length };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* JOB 5: Audit Log Cleaner                        */
    /* ══════════════════════════════════════════════ */
    function _cleanAuditLog() {
        const cutoff = Date.now() - CONFIG.AUDIT_TTL_MS;
        return window.QamarFB.children('audit_log').then(function (rooms) {
            if (!rooms) return { scanned: 0, removed: 0 };
            const updates = {};
            let scanned = 0, removed = 0;

            Object.keys(rooms).forEach(function (rid) {
                const logs = rooms[rid];
                if (!logs) return;
                Object.keys(logs).forEach(function (logId) {
                    const l = logs[logId];
                    if (!l) return;
                    scanned++;
                    if (l.at && l.at < cutoff) {
                        updates['audit_log/' + rid + '/' + logId] = null;
                        removed++;
                    }
                });
            });

            if (removed === 0) return { scanned: scanned, removed: 0 };

            const keys = Object.keys(updates);
            const batches = [];
            for (let i = 0; i < keys.length; i += CONFIG.MAX_BATCH_SIZE) {
                const batch = {};
                keys.slice(i, i + CONFIG.MAX_BATCH_SIZE).forEach(function (k) { batch[k] = null; });
                batches.push(batch);
            }

            return batches.reduce(function (p, b) {
                return p.then(function () { return window.QamarFB.multiUpdate(b); });
            }, Promise.resolve()).then(function () {
                return { scanned: scanned, removed: removed };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* JOB 6: Notifications Cleaner                    */
    /* ══════════════════════════════════════════════ */
    function _cleanNotifications() {
        const cutoff = Date.now() - CONFIG.NOTIF_TTL_MS;
        return window.QamarFB.children('user_notifications').then(function (users) {
            if (!users) return { scanned: 0, removed: 0 };
            const updates = {};
            let scanned = 0, removed = 0;

            Object.keys(users).forEach(function (uid) {
                const notifs = users[uid];
                if (!notifs) return;
                Object.keys(notifs).forEach(function (nid) {
                    const n = notifs[nid];
                    if (!n) return;
                    scanned++;
                    if (n.time && n.time < cutoff) {
                        updates['user_notifications/' + uid + '/' + nid] = null;
                        removed++;
                    }
                });
            });

            if (removed === 0) return { scanned: scanned, removed: 0 };

            const keys = Object.keys(updates);
            const batches = [];
            for (let i = 0; i < keys.length; i += CONFIG.MAX_BATCH_SIZE) {
                const batch = {};
                keys.slice(i, i + CONFIG.MAX_BATCH_SIZE).forEach(function (k) { batch[k] = null; });
                batches.push(batch);
            }

            return batches.reduce(function (p, b) {
                return p.then(function () { return window.QamarFB.multiUpdate(b); });
            }, Promise.resolve()).then(function () {
                return { scanned: scanned, removed: removed };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* JOB 7: Session Cleaner                          */
    /* ══════════════════════════════════════════════ */
    function _cleanStaleSessions() {
        const cutoff = Date.now() - (2 * 60 * 1000);
        return window.QamarFB.children('room_voice').then(function (rooms) {
            if (!rooms) return { scanned: 0, removed: 0 };
            const updates = {};
            let scanned = 0, removed = 0;

            Object.keys(rooms).forEach(function (rid) {
                const parts = rooms[rid] && rooms[rid].participants;
                if (!parts) return;
                Object.keys(parts).forEach(function (uid) {
                    const p = parts[uid];
                    if (!p) return;
                    scanned++;
                    const hb = p.heartbeat || p.at || 0;
                    if (hb > 0 && hb < cutoff) {
                        updates['room_voice/' + rid + '/participants/' + uid] = null;
                        removed++;
                    }
                });
            });

            if (removed === 0) return { scanned: scanned, removed: 0 };

            return window.QamarFB.multiUpdate(updates).then(function () {
                return { scanned: scanned, removed: removed };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* JOB 8: Voice Monitor Lock Cleaner               */
    /* ══════════════════════════════════════════════ */
    function _cleanVoiceMonitorLocks() {
        const cutoff = Date.now() - (5 * 60 * 1000);
        return window.QamarFB.children('voice_monitor_lock').then(function (locks) {
            if (!locks) return { cleaned: 0 };
            const updates = {};
            let cleaned = 0;
            Object.keys(locks).forEach(function (rid) {
                const l = locks[rid];
                if (l && l.at && l.at < cutoff) {
                    updates['voice_monitor_lock/' + rid] = null;
                    cleaned++;
                }
            });
            if (cleaned === 0) return { cleaned: 0 };
            return window.QamarFB.multiUpdate(updates).then(function () {
                return { cleaned: cleaned };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Register Jobs                                   */
    /* ══════════════════════════════════════════════ */
    _registerJob('stories_cleaner',       _cleanStories,           CONFIG.STORIES_INTERVAL_MS);
    _registerJob('room_voice_cleaner',    _cleanRoomVoiceMsgs,     CONFIG.VOICE_MSGS_INTERVAL_MS);
    _registerJob('pm_voice_cleaner',      _cleanPMVoiceMsgs,       CONFIG.PM_VOICE_INTERVAL_MS);
    _registerJob('lock_cleaner',          _cleanStaleLocks,        CONFIG.LOCK_CLEAN_INTERVAL_MS);
    _registerJob('audit_cleaner',         _cleanAuditLog,          CONFIG.AUDIT_INTERVAL_MS);
    _registerJob('notif_cleaner',         _cleanNotifications,     CONFIG.NOTIF_INTERVAL_MS);
    _registerJob('session_cleaner',       _cleanStaleSessions,     CONFIG.SESSION_INTERVAL_MS);
    _registerJob('voice_monitor_cleaner', _cleanVoiceMonitorLocks, 10 * 60 * 1000);

    /* ══════════════════════════════════════════════ */
    /* Public API                                      */
    /* ══════════════════════════════════════════════ */
    function _doStart() {
        if (State.running) return;
        State.running = true;
        State.startedAt = Date.now();
        State._permDenied = false;
        Logger.info('🚀 Starting cleaners (instance=' + State.instanceId + ')');
        Object.keys(State.jobs).forEach(_startJob);
    }

    // ⭐ v2.1: start() تنتظر مستخدم مؤهل
    function start() {
        if (State.running) return;

        // إذا المستخدم مؤهل الآن → ابدأ
        if (_canRunCleaners()) {
            _doStart();
            return;
        }

        // وإلا → انتظر تغيير auth
        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (p.isLoggedIn && _canRunCleaners() && !State.running) {
                    Logger.info('👤 Cleaners: user now eligible — starting');
                    setTimeout(_doStart, 3000);
                } else if (!p.isLoggedIn && State.running) {
                    stop();
                }
            });
        }
    }

    function stop() {
        State.running = false;
        Object.keys(State.jobs).forEach(_stopJob);
        Logger.info('Stopped');
    }

    function runNow(name) {
        if (!_canRunCleaners()) {
            return Promise.resolve({ skipped: 'no-permission' });
        }
        if (name) return _runJob(name, true);
        return Promise.all(Object.keys(State.jobs).map(function (n) {
            return _runJob(n, true);
        }));
    }

    function getStatus() {
        const out = {
            running: State.running,
            startedAt: State.startedAt,
            instanceId: State.instanceId,
            permDenied: State._permDenied,
            canRun: _canRunCleaners(),
            jobs: {}
        };
        Object.keys(State.jobs).forEach(function (name) {
            const j = State.jobs[name];
            out.jobs[name] = {
                intervalMs: j.intervalMs,
                lastRun: j.lastRun,
                lastResult: j.lastResult,
                runs: j.runs,
                errors: j.errors,
                isRunning: !!State.activeJobs[name]
            };
        });
        return out;
    }

    function registerCustomJob(name, fn, intervalMs) {
        _registerJob(name, fn, intervalMs);
        if (State.running) _startJob(name);
    }

    /* ══════════════════════════════════════════════ */
    /* Auto-start                                      */
    /* ══════════════════════════════════════════════ */
    function _autoStart() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(start, 30000);
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                setTimeout(start, 30000);
            });
        }
    }
    _autoStart();

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarCleaners = {
        start: start,
        stop: stop,
        runNow: runNow,
        getStatus: getStatus,
        registerCustomJob: registerCustomJob,
        CONFIG: CONFIG
    };

    Logger.info('📦 [cleaners.js v2.1] loaded | jobs:', Object.keys(State.jobs).length);
})();
