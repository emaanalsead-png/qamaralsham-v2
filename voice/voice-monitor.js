// ==============================================
// voice/voice-monitor.js
// Auto-record suspects + upload to Telegram
// ==============================================
// يعتمد على: firebase.js + suspects.js + room-voice.js + voice-system.js + audit.js
// يعطي: window.QamarVoiceMonitor
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [voice-monitor] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[VM]';
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
        LOCK_PATH: 'voice_monitor_lock',
        ALERTS_PATH: 'king_alerts',
        TELEGRAM_CONFIG_PATH: 'config/telegram',
        SEGMENT_MS: 5 * 60 * 1000,       // 5 دقائق لكل جزء
        LOCK_TTL_MS: 10 * 60 * 1000,     // 10 دقائق
        MAX_RETRY_UPLOAD: 3,
        RETRY_DELAY_MS: 2000,
        UPLOAD_TIMEOUT_MS: 60000
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        // بيانات Telegram (من Firebase)
        telegram: null,                  // { botToken, chatId, enabled }

        // المراقبة الحالية
        monitoring: false,
        currentRoom: null,
        currentTargetUid: null,
        currentTargetName: null,
        lockAcquiredAt: 0,

        // التسجيل
        audioContext: null,
        sourceNode: null,
        destNode: null,
        mediaRecorder: null,
        chunks: [],
        segmentStartAt: 0,
        segmentTimer: null,
        segmentIndex: 0,
        totalSegments: 0,

        // listeners
        listeners: [],
        unsubs: [],

        // instance ID للقفل
        instanceId: 'vm_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),

        _initialized: false,
        _lastTargetUid: null
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

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _canMonitor() {
        // الملك فقط (رتبة 100)
        return _isKing();
    }

    function _toast(msg) {
        if (window.showToast) { try { window.showToast('fa-info-circle', msg); return; } catch (e) {} }
        Logger.info('toast:', msg);
    }

    function _timeStr(ts) {
        const d = new Date(ts || Date.now());
        return d.toLocaleString('ar-EG', { hour12: false });
    }

    /* ══════════════════════════════════════════════ */
    /* Load Telegram config                            */
    /* ══════════════════════════════════════════════ */
    function _loadTelegramConfig(force) {
        if (!force && State.telegram && State.telegram.botToken) {
            return Promise.resolve(State.telegram);
        }
        return window.QamarFB.get(CONFIG.TELEGRAM_CONFIG_PATH)
            .then(function (data) {
                if (data && data.botToken && data.chatId) {
                    State.telegram = {
                        botToken: String(data.botToken),
                        chatId: String(data.chatId),
                        enabled: data.enabled !== false
                    };
                    Logger.info('✅ Telegram config loaded');
                    return State.telegram;
                }
                Logger.warn('Telegram config missing — please set config/telegram');
                State.telegram = null;
                return null;
            })
            .catch(function (e) {
                Logger.warn('loadTelegramConfig error:', e.message);
                return null;
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Distributed Lock                                */
    /* ══════════════════════════════════════════════ */
    function _lockPath(roomId) {
        return CONFIG.LOCK_PATH + '/' + roomId;
    }

    function _acquireLock(roomId) {
        return window.QamarFB.transaction(_lockPath(roomId), function (cur) {
            if (cur && cur.instanceId === State.instanceId) {
                return { instanceId: State.instanceId, at: Date.now(), byUid: _getCurrentUid(), byName: _getCurrentName() };
            }
            if (cur && cur.at && (Date.now() - cur.at) < CONFIG.LOCK_TTL_MS) {
                return undefined; // abort — قفل نشط
            }
            return {
                instanceId: State.instanceId,
                at: Date.now(),
                byUid: _getCurrentUid(),
                byName: _getCurrentName(),
                roomId: roomId
            };
        }).then(function (r) {
            const ok = !!(r && r.committed && r.snapshot && r.snapshot.instanceId === State.instanceId);
            if (ok) State.lockAcquiredAt = Date.now();
            return ok;
        }).catch(function () { return false; });
    }

    function _refreshLock(roomId) {
        return window.QamarFB.transaction(_lockPath(roomId), function (cur) {
            if (!cur || cur.instanceId !== State.instanceId) return undefined;
            return Object.assign({}, cur, { at: Date.now() });
        }).catch(function () {});
    }

    function _releaseLock(roomId) {
        return window.QamarFB.transaction(_lockPath(roomId), function (cur) {
            if (cur && cur.instanceId === State.instanceId) return null;
            return undefined;
        }).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Find <audio> element of target uid              */
    /* ══════════════════════════════════════════════ */
    function _findAudioElement(uid) {
        if (!uid) return null;
        const all = document.querySelectorAll('audio[data-peer]');
        for (let i = 0; i < all.length; i++) {
            if (all[i].dataset.peer === uid) return all[i];
        }
        return null;
    }

    /* ══════════════════════════════════════════════ */
    /* Start monitoring a suspect                      */
    /* ══════════════════════════════════════════════ */
    function _startMonitoring(roomId, targetUid, targetName) {
        if (State.monitoring) {
            Logger.debug('Already monitoring — ignore');
            return Promise.resolve({ skipped: true });
        }
        if (!_canMonitor()) return Promise.resolve({ skipped: 'not-king' });

        return _loadTelegramConfig().then(function () {
            return _acquireLock(roomId);
        }).then(function (acquired) {
            if (!acquired) {
                Logger.debug('Lock not acquired for room', roomId, '— skipping');
                return { skipped: 'locked' };
            }

            // ابحث عن عنصر الصوت
            const audioEl = _findAudioElement(targetUid);
            if (!audioEl) {
                Logger.warn('Audio element for target not found:', targetUid.substring(0, 8));
                _releaseLock(roomId);
                return { skipped: 'no-audio-el' };
            }

            return _beginRecording(roomId, targetUid, targetName, audioEl).then(function () {
                return { ok: true, uid: targetUid, roomId: roomId };
            });
        }).catch(function (e) {
            Logger.error('startMonitoring failed:', e.message);
            _releaseLock(roomId);
            return { error: e.message };
        });
    }

    function _beginRecording(roomId, targetUid, targetName, audioEl) {
        return new Promise(function (resolve, reject) {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return reject(new Error('AudioContext غير متاح'));

                State.audioContext = new AC();
                const ctx = State.audioContext;

                // أنشئ source من <audio>
                State.sourceNode = ctx.createMediaElementSource(audioEl);
                // صِل للـ destination الأصلي (المستخدم لازم يسمع)
                State.sourceNode.connect(ctx.destination);
                // صِل لـ MediaStreamDestination للتسجيل
                State.destNode = ctx.createMediaStreamDestination();
                State.sourceNode.connect(State.destNode);

                // ابدأ MediaRecorder
                const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm';

                State.chunks = [];
                State.mediaRecorder = new MediaRecorder(State.destNode.stream, { mimeType: mime });
                State.mediaRecorder.ondataavailable = function (ev) {
                    if (ev.data && ev.data.size > 0) State.chunks.push(ev.data);
                };
                State.mediaRecorder.onstop = _onSegmentStop;
                State.mediaRecorder.start(1000); // chunk كل ثانية

                State.monitoring = true;
                State.currentRoom = roomId;
                State.currentTargetUid = targetUid;
                State.currentTargetName = targetName || '—';
                State.segmentStartAt = Date.now();
                State.segmentIndex = 0;
                State.totalSegments = 0;

                // timer لقطع الأجزاء كل 5 دقائق
                if (State.segmentTimer) clearInterval(State.segmentTimer);
                State.segmentTimer = setInterval(_rotateSegment, CONFIG.SEGMENT_MS);

                // heartbeat للقفل كل دقيقتين
                if (State.lockHeartbeat) clearInterval(State.lockHeartbeat);
                State.lockHeartbeat = setInterval(function () {
                    if (State.monitoring && State.currentRoom) {
                        _refreshLock(State.currentRoom);
                    }
                }, 2 * 60 * 1000);

                Logger.info('🎙️ Monitoring started:', targetName, 'in', roomId);
                _emit('voice-monitor:started', {
                    roomId: roomId, uid: targetUid, name: targetName
                });
                resolve(true);
            } catch (e) {
                Logger.error('beginRecording failed:', e.message);
                _cleanup();
                reject(e);
            }
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Segment rotation (كل 5 دقائق)                   */
    /* ══════════════════════════════════════════════ */
    function _rotateSegment() {
        if (!State.monitoring) return;
        if (!State.mediaRecorder || State.mediaRecorder.state !== 'recording') return;
        Logger.info('🔄 Rotating segment #' + State.segmentIndex);
        try { State.mediaRecorder.stop(); } catch (e) {}
    }

    function _onSegmentStop() {
        // اجمع الـ blob
        const chunks = State.chunks.slice();
        State.chunks = [];
        State.segmentIndex++;

        if (chunks.length === 0) {
            // لا شيء — ربما قطعة فارغة
            return;
        }

        const blob = new Blob(chunks, { type: 'audio/webm' });
        const duration = Date.now() - State.segmentStartAt;
        State.segmentStartAt = Date.now();

        // ارفع في الخلفية
        _uploadToTelegram(blob, duration, State.segmentIndex).catch(function (e) {
            Logger.warn('upload failed:', e.message);
        });

        // استمر بالجزء التالي إذا ما زلنا نراقب
        if (State.monitoring && State.currentRoom) {
            try {
                State.mediaRecorder = new MediaRecorder(State.destNode.stream, { mimeType: 'audio/webm' });
                State.mediaRecorder.ondataavailable = function (ev) {
                    if (ev.data && ev.data.size > 0) State.chunks.push(ev.data);
                };
                State.mediaRecorder.onstop = _onSegmentStop;
                State.mediaRecorder.start(1000);
            } catch (e) {
                Logger.error('restart recorder failed:', e.message);
            }
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Stop monitoring                                 */
    /* ══════════════════════════════════════════════ */
    function _stopMonitoring(reason) {
        if (!State.monitoring) return Promise.resolve({ ok: true, skipped: true });

        Logger.info('⏹️ Stopping monitoring. Reason:', reason || 'unknown');

        // أوقف الـ timer
        if (State.segmentTimer) {
            clearInterval(State.segmentTimer);
            State.segmentTimer = null;
        }
        if (State.lockHeartbeat) {
            clearInterval(State.lockHeartbeat);
            State.lockHeartbeat = null;
        }

        // أوقف MediaRecorder (يُطلق onstop → يرفع الجزء الأخير)
        return new Promise(function (resolve) {
            try {
                if (State.mediaRecorder && State.mediaRecorder.state !== 'inactive') {
                    const origStop = State.mediaRecorder.onstop;
                    State.mediaRecorder.onstop = function () {
                        try { if (origStop) origStop(); } catch (e) {}
                        resolve(true);
                    };
                    State.mediaRecorder.stop();
                } else {
                    resolve(true);
                }
            } catch (e) {
                resolve(false);
            }
        }).then(function () {
            // احذف القفل
            return _releaseLock(State.currentRoom);
        }).then(function () {
            _cleanup();
            _emit('voice-monitor:stopped', { reason: reason || 'unknown' });
            return { ok: true };
        });
    }

    function _cleanup() {
        try {
            if (State.sourceNode) {
                try { State.sourceNode.disconnect(); } catch (e) {}
            }
            if (State.destNode) {
                try { State.destNode.disconnect(); } catch (e) {}
            }
            if (State.audioContext) {
                try { State.audioContext.close(); } catch (e) {}
            }
        } catch (e) {}
        State.monitoring = false;
        State.audioContext = null;
        State.sourceNode = null;
        State.destNode = null;
        State.mediaRecorder = null;
        State.chunks = [];
        State.currentRoom = null;
        State.currentTargetUid = null;
        State.currentTargetName = null;
        State.segmentStartAt = 0;
        State.segmentIndex = 0;
    }

    /* ══════════════════════════════════════════════ */
    /* Upload to Telegram                              */
    /* ══════════════════════════════════════════════ */
    function _uploadToTelegram(blob, durationMs, segmentIndex) {
        if (!blob || blob.size === 0) return Promise.resolve({ ok: false, reason: 'empty' });
        if (!State.telegram || !State.telegram.botToken || !State.telegram.chatId) {
            Logger.warn('Telegram config missing');
            return Promise.resolve({ ok: false, reason: 'no-config' });
        }
        if (State.telegram.enabled === false) {
            return Promise.resolve({ ok: false, reason: 'disabled' });
        }

        const caption = [
            '🚨 تسجيل مشبوه',
            '👤 ' + (State.currentTargetName || '—'),
            '🏠 ' + (State.currentRoom || '—'),
            '🕒 ' + _timeStr(),
            '⏱️ ' + Math.round(durationMs / 1000) + 'ث',
            '📦 جزء #' + segmentIndex
        ].join('\n');

        const url = 'https://api.telegram.org/bot' + State.telegram.botToken + '/sendAudio';

        // FormData
        const fd = new FormData();
        fd.append('chat_id', State.telegram.chatId);
        fd.append('audio', blob, 'qamar-monitor-' + Date.now() + '.webm');
        fd.append('caption', caption);
        fd.append('title', 'تسجيل مشبوه — ' + (State.currentTargetName || '—'));
        fd.append('parse_mode', 'HTML');

        return _fetchWithRetry(url, {
            method: 'POST',
            body: fd
        }, CONFIG.MAX_RETRY_UPLOAD).then(function (result) {
            if (result && result.ok) {
                const msgId = result.result && result.result.message_id;
                Logger.info('✅ Uploaded to Telegram (msgId=' + msgId + ')');
                // سجّل في Firebase
                _logAlert({
                    type: 'voice_record',
                    suspects: [State.currentTargetUid],
                    targetUid: State.currentTargetUid,
                    targetName: State.currentTargetName,
                    byUid: _getCurrentUid(),
                    byName: _getCurrentName(),
                    room: State.currentRoom,
                    duration: durationMs,
                    size: blob.size,
                    tgMessageId: msgId,
                    segmentIndex: segmentIndex,
                    createdAt: window.QamarFB.serverTime()
                });
                _emit('voice-monitor:uploaded', { msgId: msgId, segmentIndex: segmentIndex });
                return { ok: true, msgId: msgId };
            }
            throw new Error('Telegram upload failed: ' + JSON.stringify(result));
        }).catch(function (e) {
            Logger.error('Telegram upload error:', e.message);
            _emit('voice-monitor:uploadError', { error: e.message, segmentIndex: segmentIndex });
            throw e;
        });
    }

    function _fetchWithRetry(url, options, retries) {
        retries = retries || 1;
        return _fetchOnce(url, options).catch(function (e) {
            if (retries <= 1) throw e;
            Logger.warn('Upload retry... (' + retries + ' left)');
            return new Promise(function (res) {
                setTimeout(res, CONFIG.RETRY_DELAY_MS);
            }).then(function () {
                return _fetchWithRetry(url, options, retries - 1);
            });
        });
    }

    function _fetchOnce(url, options) {
        return new Promise(function (resolve, reject) {
            const timer = setTimeout(function () {
                reject(new Error('Upload timeout'));
            }, CONFIG.UPLOAD_TIMEOUT_MS);

            fetch(url, options)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    clearTimeout(timer);
                    if (data && data.ok) resolve(data);
                    else reject(new Error('Telegram returned: ' + (data && data.description ? data.description : 'unknown')));
                })
                .catch(function (e) {
                    clearTimeout(timer);
                    reject(e);
                });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Log to king_alerts                              */
    /* ══════════════════════════════════════════════ */
    function _logAlert(payload) {
        if (!payload) return Promise.resolve();
        return window.QamarFB.push(CONFIG.ALERTS_PATH, payload)
            .then(function (rid) {
                Logger.debug('King alert saved:', rid);
                return rid;
            })
            .catch(function (e) {
                Logger.warn('logAlert failed:', e.message);
            });
    }

    /* ══════════════════════════════════════════════ */
    /* External hooks — من room-voice و suspects       */
    /* ══════════════════════════════════════════════ */
    function onVoiceJoin(uid, context) {
        if (!uid) return;
        if (!_canMonitor()) return;
        // فحص إذا كان مشبوهاً
        if (!window.QamarSuspects) return;
        const isSuspect = window.QamarSuspects.isSuspectSync
            ? window.QamarSuspects.isSuspectSync(uid)
            : false;
        if (!isSuspect) return;
        // احصل على اسم المشبوه
        const roomId = (context && context.roomId) || (window.QamarRoomVoice && window.QamarRoomVoice.getStatus
            ? window.QamarRoomVoice.getStatus().currentRoom
            : null);
        if (!roomId) return;

        const name = (context && context.name) || '—';
        // انتظر قليلاً حتى ينشأ <audio>
        setTimeout(function () {
            _startMonitoring(roomId, uid, name);
        }, 1500);
    }

    function onVoiceLeft(uid) {
        if (!uid) return;
        if (!State.monitoring) return;
        if (uid === State.currentTargetUid) {
            Logger.info('👋 Target left — stopping monitor');
            _stopMonitoring('target-left');
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Public API                                      */
    /* ══════════════════════════════════════════════ */
    function start() {
        if (State._initialized) return;
        State._initialized = true;

        // حمّل بيانات Telegram
        _loadTelegramConfig(true);

        // سجّل المستمعين
        if (window.EventBus) {
            const off1 = window.EventBus.on('voice:joined', function (p) {
                if (p && p.uid) onVoiceJoin(p.uid, p);
            });
            const off2 = window.EventBus.on('voice:left', function (p) {
                if (p && p.uid) onVoiceLeft(p.uid);
            });
            const off3 = window.EventBus.on('suspect:voiceJoined', function (p) {
                if (p && p.uid) onVoiceJoin(p.uid, p.context || {});
            });
            // عند تغيير الغرفة → أوقف
            const off4 = window.EventBus.on('room:changed', function () {
                if (State.monitoring) _stopMonitoring('room-changed');
            });
            // عند الخروج → أوقف
            const off5 = window.EventBus.on('auth:signout', function () {
                if (State.monitoring) _stopMonitoring('signout');
            });

            State.unsubs = [off1, off2, off3, off4, off5];
        }

        Logger.info('📦 [voice-monitor.js] started');
    }

    function stop() {
        State.unsubs.forEach(function (off) {
            try { if (off) off(); } catch (e) {}
        });
        State.unsubs = [];
        if (State.monitoring) _stopMonitoring('manual');
        State._initialized = false;
        Logger.info('📦 [voice-monitor.js] stopped');
    }

    function isMonitoring() { return State.monitoring; }
    function getCurrentTarget() {
        return State.monitoring ? {
            uid: State.currentTargetUid,
            name: State.currentTargetName,
            room: State.currentRoom,
            startedAt: State.segmentStartAt,
            segment: State.segmentIndex
        } : null;
    }

    function forceStop() { return _stopMonitoring('forced'); }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(start, 3000);
        });
    } else {
        setTimeout(start, 9000);
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            monitoring: State.monitoring,
            currentTarget: State.currentTargetUid ? State.currentTargetUid.substring(0, 8) : null,
            currentTargetName: State.currentTargetName,
            currentRoom: State.currentRoom,
            segmentIndex: State.segmentIndex,
            hasTelegramConfig: !!(State.telegram && State.telegram.botToken),
            instanceId: State.instanceId,
            canMonitor: _canMonitor()
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarVoiceMonitor = {
        CONFIG: CONFIG,

        // Lifecycle
        start: start,
        stop: stop,
        isMonitoring: isMonitoring,
        getCurrentTarget: getCurrentTarget,
        forceStop: forceStop,

        // Config
        reloadTelegramConfig: function () { return _loadTelegramConfig(true); },

        // Test (للاستخدام اليدوي)
        testUpload: function (blob) {
            return _uploadToTelegram(blob, 0, 0);
        },

        // Events
        onMonitorEvent: onMonitorEvent,

        // Debug
        getStatus: getStatus
    };

    Logger.info('📦 [voice-monitor.js] loaded');
})();
