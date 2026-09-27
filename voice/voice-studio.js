// ==============================================
// voice/voice-studio.js
// Personal studio (80+) — recording + 6 effects
// ==============================================
// يعتمد على: firebase.js + auth.js + ranks.js + pm-voice.js + room-voice.js
// يعطي: window.QamarVoiceStudio
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [voice-studio] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[STU]';
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
        MIN_LEVEL: 80,
        MAX_DURATION_MS: 5 * 60 * 1000,        // 5 دقائق
        MAX_RECORDINGS: 10,
        SESSIONS_PATH: 'studio_sessions',
        RECORDINGS_PATH: 'studio_recordings',
        TIPS_PATH: 'studio_tips_seen',
        DEFAULT_MIME_CANDIDATES: [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
            'audio/mpeg'
        ],
        DEFAULT_EFFECTS: {
            bass: 0,     // -40 إلى +40
            mid: 0,
            treble: 0,
            echo: 0,     // 0-100
            reverb: 0,   // 0-100
            volume: 100  // 0-100
        },
        // 13 رسالة للبوت — كل زر له رسالته
        BOT_TIPS: {
            record:     'اضغط لتسجيل صوتك. يمكنك التحدث حتى 5 دقائق. جودة التسجيل عالية مع خفض الضوضاء.',
            stop:       'أوقف التسجيل هنا. سيتم حفظ الصوتية تلقائياً ويمكنك معاينتها قبل المشاركة.',
            pause:      'أوقف التسجيل مؤقتاً. اضغط مرة أخرى للاستئناف من حيث توقفت.',
            bass:       'التحكم في الصوت العميق (Bass). ارفع للصوت الدافئ، اخفض للصوت الخفيف.',
            mid:        'التحكم في الأصوات المتوسطة (Mid). ارفع لوضوح الصوت، اخفض للصوت الناعم.',
            treble:     'التحكم في الأصوات العالية (Treble). ارفع للحدة واللمعان، اخفض للنعومة.',
            echo:       'إضافة صدى الصوت (Echo). مناسب للقرآن والأناشيد. 0 = بدون صدى.',
            reverb:     'إضافة رنين الغرفة (Reverb). يعطي إحساس المسجد أو القاعة. 0 = بدون رنين.',
            volume:     'مستوى الصوت النهائي. 100 = الصوت الأصلي، أقل = أهدأ.',
            preview:    'استمع لتسجيلك قبل المشاركة. هنا تسمع كيف سيصل للآخرين.',
            download:   'حمّل تسجيلك على جهازك. سيكون بصيغة صوتية قياسية.',
            share:      'شارك تسجيلك في الروم أو أرسله على الخاص. في الخاص يُسمع مرة واحدة فقط.',
            discard:    'احذف التسجيل الحالي. لا يمكن التراجع عن الحذف.'
        }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        opened: false,
        active: false,
        recording: false,
        paused: false,
        startedAt: 0,
        pausedMs: 0,
        pausedAt: 0,
        durationMs: 0,

        mediaStream: null,
        audioContext: null,
        sourceNode: null,
        effectsChain: null,        // { bass, mid, treble, echo, reverb, volume }
        mediaRecorder: null,
        chunks: [],
        mimeType: null,

        currentBlob: null,
        currentUrl: null,

        effects: Object.assign({}, CONFIG.DEFAULT_EFFECTS),

        durationTimer: null,
        listeners: [],
        _initialized: false,

        // UI
        panelEl: null,
        tipEl: null,
        tipCleanup: null,
        seenTips: {},              // { buttonId: true }

        // للحد الأقصى
        autoStopAt: 0
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onStudioEvent(cb) {
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

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _canUseStudio() {
        if (_isKing()) return true;
        return _myLevel() >= CONFIG.MIN_LEVEL;
    }

    function _toast(msg) {
        if (window.showToast) { try { window.showToast('fa-info-circle', msg); return; } catch (e) {} }
        Logger.info('toast:', msg);
    }

    function _detectMime() {
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return 'audio/webm';
        for (let i = 0; i < CONFIG.DEFAULT_MIME_CANDIDATES.length; i++) {
            if (MediaRecorder.isTypeSupported(CONFIG.DEFAULT_MIME_CANDIDATES[i])) {
                return CONFIG.DEFAULT_MIME_CANDIDATES[i];
            }
        }
        return 'audio/webm';
    }

    function _fmtTime(ms) {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }

    /* ══════════════════════════════════════════════ */
    /* Session lock                                    */
    /* ══════════════════════════════════════════════ */
    function _lockSession() {
        const uid = _getCurrentUid();
        if (!uid) return Promise.resolve(false);
        return window.QamarFB.set(CONFIG.SESSIONS_PATH + '/' + uid, {
            active: true,
            startedAt: window.QamarFB.serverTime()
        }).then(function () {
            // onDisconnect — احذف تلقائي عند الإغلاق
            try {
                const r = window.QamarFB.ref(CONFIG.SESSIONS_PATH + '/' + uid);
                if (r && r.onDisconnect) r.onDisconnect().remove();
            } catch (e) {}
            return true;
        }).catch(function () { return false; });
    }

    function _unlockSession() {
        const uid = _getCurrentUid();
        if (!uid) return Promise.resolve();
        return window.QamarFB.remove(CONFIG.SESSIONS_PATH + '/' + uid).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Tips (البوت — رسائل الشرح)                      */
    /* ══════════════════════════════════════════════ */
    function _loadSeenTips() {
        const uid = _getCurrentUid();
        if (!uid) return Promise.resolve();
        return window.QamarFB.get(CONFIG.TIPS_PATH + '/' + uid).then(function (data) {
            State.seenTips = data || {};
        }).catch(function () { State.seenTips = {}; });
    }

    function _markTipSeen(buttonId) {
        const uid = _getCurrentUid();
        if (!uid || !buttonId) return;
        State.seenTips[buttonId] = true;
        window.QamarFB.set(CONFIG.TIPS_PATH + '/' + uid + '/' + buttonId, window.QamarFB.serverTime())
            .catch(function () {});
    }

    // يعرض التوستيب إذا لم يُشاهد من قبل
    function _showTipFor(buttonId, anchorEl) {
        if (!buttonId) return;
        // إذا شوهد من قبل → لا شيء
        if (State.seenTips[buttonId]) return;

        const text = CONFIG.BOT_TIPS[buttonId];
        if (!text) return;

        _showTip(text, anchorEl, function () {
            _markTipSeen(buttonId);
        });
    }

    function _showTip(text, anchorEl, onClose) {
        _closeTip();

        const tip = document.createElement('div');
        tip.className = 'studio-tip';
        tip.style.cssText =
            'position:fixed;z-index:14000;max-width:280px;' +
            'background:linear-gradient(135deg,rgba(212,175,55,0.95),rgba(184,134,11,0.95));' +
            'color:#0a0a15;padding:12px 14px;border-radius:14px;' +
            'font-family:inherit;font-size:13px;font-weight:700;' +
            'box-shadow:0 10px 32px rgba(0,0,0,0.6);line-height:1.5;' +
            'direction:rtl;text-align:right;';

        // عنوان + نص
        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;font-weight:900;';
        titleEl.innerHTML = '<span style="font-size:16px">🎼</span><span>موسيقار الشام</span>';
        tip.appendChild(titleEl);

        const textEl = document.createElement('div');
        textEl.textContent = text;
        textEl.style.cssText = 'margin-bottom:10px;';
        tip.appendChild(textEl);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'حسناً';
        btn.style.cssText =
            'display:block;width:100%;padding:8px;border:none;border-radius:8px;' +
            'background:rgba(10,10,21,0.85);color:#ffd700;font-family:inherit;' +
            'font-weight:900;font-size:13px;cursor:pointer;';
        btn.onclick = function (e) {
            e.preventDefault();
            _closeTip();
            if (onClose) try { onClose(); } catch (err) {}
        };
        tip.appendChild(btn);

        document.body.appendChild(tip);
        State.tipEl = tip;

        // موضعه قرب الزر
        if (anchorEl && anchorEl.getBoundingClientRect) {
            const r = anchorEl.getBoundingClientRect();
            const tw = tip.offsetWidth || 280;
            const th = tip.offsetHeight || 150;
            let left = r.left + r.width / 2 - tw / 2;
            let top = r.top - th - 10;
            if (top < 10) top = r.bottom + 10;
            if (left < 10) left = 10;
            if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
            tip.style.left = left + 'px';
            tip.style.top = top + 'px';
        } else {
            tip.style.left = '50%';
            tip.style.top = '50%';
            tip.style.transform = 'translate(-50%,-50%)';
        }

        // إغلاق عند النقر خارجاً
        setTimeout(function () {
            const closer = function (e) {
                if (State.tipEl && !State.tipEl.contains(e.target) && e.target !== anchorEl) {
                    _closeTip();
                    document.removeEventListener('click', closer, true);
                }
            };
            document.addEventListener('click', closer, true);
            State.tipCleanup = function () {
                document.removeEventListener('click', closer, true);
            };
        }, 80);
    }

    function _closeTip() {
        if (State.tipEl && State.tipEl.parentNode) {
            State.tipEl.parentNode.removeChild(State.tipEl);
        }
        State.tipEl = null;
        if (State.tipCleanup) {
            try { State.tipCleanup(); } catch (e) {}
            State.tipCleanup = null;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Audio chain                                     */
    /* ══════════════════════════════════════════════ */
    function _buildAudioChain(stream) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error('AudioContext غير متاح');

        State.audioContext = new AC();
        const ctx = State.audioContext;

        const source = ctx.createMediaStreamSource(stream);
        State.sourceNode = source;

        // Bass — lowshelf 200Hz
        const bass = ctx.createBiquadFilter();
        bass.type = 'lowshelf';
        bass.frequency.value = 200;
        bass.gain.value = State.effects.bass; // dB

        // Mid — peaking 1000Hz
        const mid = ctx.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.Q.value = 0.7;
        mid.gain.value = State.effects.mid;

        // Treble — highshelf 3000Hz
        const treble = ctx.createBiquadFilter();
        treble.type = 'highshelf';
        treble.frequency.value = 3000;
        treble.gain.value = State.effects.treble;

        // Echo — delay + feedback
        const delay = ctx.createDelay(1.5);
        delay.delayTime.value = 0.3;
        const feedback = ctx.createGain();
        feedback.gain.value = 0;
        const echoMix = ctx.createGain();
        echoMix.gain.value = 0;

        // Reverb — convolver
        const convolver = ctx.createConvolver();
        const reverbMix = ctx.createGain();
        reverbMix.gain.value = 0;
        // impulse بسيط (توليد)
        try {
            convolver.buffer = _generateImpulse(ctx, 1.5, 2.5);
        } catch (e) {}

        // Volume — gain
        const volume = ctx.createGain();
        volume.gain.value = State.effects.volume / 100;

        // السلسلة:
        // source → bass → mid → treble → [dry + (echo) + (reverb)] → volume → destination
        source.connect(bass);
        bass.connect(mid);
        mid.connect(treble);
        treble.connect(volume);

        // Echo path
        treble.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(echoMix);
        echoMix.connect(volume);

        // Reverb path
        treble.connect(convolver);
        convolver.connect(reverbMix);
        reverbMix.connect(volume);

        // destination
        const dest = ctx.createMediaStreamDestination();
        volume.connect(dest);

        // hook للـ MediaRecorder
        State.effectsChain = {
            bass: bass, mid: mid, treble: treble,
            delay: delay, feedback: feedback, echoMix: echoMix,
            convolver: convolver, reverbMix: reverbMix,
            volume: volume, dest: dest
        };

        return dest.stream;
    }

    function _generateImpulse(ctx, duration, decay) {
        const rate = ctx.sampleRate;
        const length = rate * duration;
        const impulse = ctx.createBuffer(2, length, rate);
        for (let c = 0; c < 2; c++) {
            const channel = impulse.getChannelData(c);
            for (let i = 0; i < length; i++) {
                channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
        return impulse;
    }

    function _applyEffectsToChain() {
        const c = State.effectsChain;
        if (!c) return;
        try {
            c.bass.gain.value = State.effects.bass;
            c.mid.gain.value = State.effects.mid;
            c.treble.gain.value = State.effects.treble;
            c.delay.delayTime.value = 0.2 + (State.effects.echo / 100) * 0.6;
            c.feedback.gain.value = (State.effects.echo / 100) * 0.45;
            c.echoMix.gain.value = State.effects.echo / 100;
            c.reverbMix.gain.value = State.effects.reverb / 100;
            c.volume.gain.value = State.effects.volume / 100;
        } catch (e) {}
    }

    /* ══════════════════════════════════════════════ */
    /* Recording                                       */
    /* ══════════════════════════════════════════════ */
    function startRecording() {
        return Promise.resolve().then(function () {
            if (!_canUseStudio()) throw new Error('هذه الميزة لمستوى 80+');
            if (State.recording) throw new Error('التسجيل جارٍ بالفعل');
            if (!State.opened) throw new Error('افتح الاستوديو أولاً');

            // اطلب المايك
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('المتصفح لا يدعم الوصول للمايك');
            }
            return navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
        }).then(function (stream) {
            State.mediaStream = stream;
            // ابني السلسلة
            const processedStream = _buildAudioChain(stream);

            // اختر mime
            State.mimeType = _detectMime();

            // ابدأ MediaRecorder
            State.chunks = [];
            State.mediaRecorder = new MediaRecorder(processedStream, { mimeType: State.mimeType });
            State.mediaRecorder.ondataavailable = function (ev) {
                if (ev.data && ev.data.size > 0) State.chunks.push(ev.data);
            };
            State.mediaRecorder.onstop = _onRecordingStop;
            State.mediaRecorder.start(250); // chunk كل 250ms

            State.recording = true;
            State.paused = false;
            State.startedAt = Date.now();
            State.pausedMs = 0;

            // timer للعرض
            State.durationTimer = setInterval(_updateDuration, 200);

            // حد 5 دقائق
            State.autoStopAt = Date.now() + CONFIG.MAX_DURATION_MS;

            _applyEffectsToChain();
            _emit('studio:recordingStarted', {});
            Logger.info('🎙️ Studio recording started');
            return { ok: true };
        }).catch(function (e) {
            Logger.warn('startRecording failed:', e.message);
            _cleanupMedia();
            _emit('studio:error', { error: e.message });
            throw e;
        });
    }

    function pauseRecording() {
        if (!State.recording || State.paused) return { ok: false };
        try { State.mediaRecorder.pause(); } catch (e) { return { ok: false }; }
        State.paused = true;
        State.pausedAt = Date.now();
        return { ok: true };
    }

    function resumeRecording() {
        if (!State.recording || !State.paused) return { ok: false };
        try { State.mediaRecorder.resume(); } catch (e) { return { ok: false }; }
        State.pausedMs += Date.now() - State.pausedAt;
        State.paused = false;
        return { ok: true };
    }

    function stopRecording() {
        return new Promise(function (resolve, reject) {
            if (!State.recording) return reject(new Error('لا يوجد تسجيل'));
            if (State.mediaRecorder && State.mediaRecorder.state !== 'inactive') {
                State.mediaRecorder.onstop = function () {
                    _onRecordingStop();
                    resolve({ ok: true, blob: State.currentBlob, duration: State.durationMs });
                };
                try { State.mediaRecorder.stop(); } catch (e) { reject(e); }
            } else {
                reject(new Error('لا يوجد تسجيل نشط'));
            }
        });
    }

    function cancelRecording() {
        try {
            if (State.mediaRecorder && State.mediaRecorder.state !== 'inactive') {
                State.mediaRecorder.onstop = null;
                State.mediaRecorder.stop();
            }
        } catch (e) {}
        State.chunks = [];
        _cleanupMedia();
        State.currentBlob = null;
        if (State.currentUrl) {
            try { URL.revokeObjectURL(State.currentUrl); } catch (e) {}
            State.currentUrl = null;
        }
        State.recording = false;
        State.paused = false;
        _emit('studio:recordingCancelled', {});
        return { ok: true };
    }

    function _onRecordingStop() {
        try {
            const blob = new Blob(State.chunks, { type: State.mimeType || 'audio/webm' });
            State.currentBlob = blob;

            if (State.currentUrl) {
                try { URL.revokeObjectURL(State.currentUrl); } catch (e) {}
            }
            State.currentUrl = URL.createObjectURL(blob);

            _cleanupMedia();

            State.recording = false;
            State.paused = false;

            // احفظ تلقائياً
            _saveRecording(blob, State.durationMs).catch(function () {});

            _emit('studio:recordingStopped', {
                size: blob.size,
                duration: State.durationMs,
                mime: blob.type
            });
            Logger.info('🎙️ Recording stopped:', blob.size, 'bytes');
        } catch (e) {
            Logger.error('onRecordingStop error:', e.message);
        }
    }

    function _updateDuration() {
        if (!State.recording) return;
        const now = Date.now();
        let elapsed = now - State.startedAt - State.pausedMs;
        if (State.paused) elapsed = State.pausedAt - State.startedAt - State.pausedMs;
        State.durationMs = Math.min(elapsed, CONFIG.MAX_DURATION_MS);

        // حدث
        _emit('studio:tick', { duration: State.durationMs });

        // حد أقصى
        if (State.durationMs >= CONFIG.MAX_DURATION_MS) {
            Logger.info('⏰ Max duration reached — auto-stop');
            stopRecording().catch(function () {});
        }
    }

    function _cleanupMedia() {
        if (State.durationTimer) {
            clearInterval(State.durationTimer);
            State.durationTimer = null;
        }
        if (State.mediaStream) {
            try { State.mediaStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
            State.mediaStream = null;
        }
        if (State.audioContext) {
            try { State.audioContext.close(); } catch (e) {}
            State.audioContext = null;
        }
        State.sourceNode = null;
        State.effectsChain = null;
        State.mediaRecorder = null;
    }

    /* ══════════════════════════════════════════════ */
    /* Save recording                                  */
    /* ══════════════════════════════════════════════ */
    function _saveRecording(blob, duration) {
        const uid = _getCurrentUid();
        if (!uid || !blob) return Promise.resolve(null);

        // حد أقصى 10 → احذف الأقدم
        return window.QamarFB.get(CONFIG.RECORDINGS_PATH + '/' + uid).then(function (data) {
            if (data) {
                const ids = Object.keys(data).sort(function (a, b) {
                    return (data[a].createdAt || 0) - (data[b].createdAt || 0);
                });
                if (ids.length >= CONFIG.MAX_RECORDINGS) {
                    const toRemove = ids.slice(0, ids.length - CONFIG.MAX_RECORDINGS + 1);
                    const updates = {};
                    toRemove.forEach(function (rid) {
                        updates[CONFIG.RECORDINGS_PATH + '/' + uid + '/' + rid] = null;
                    });
                    window.QamarFB.multiUpdate(updates).catch(function () {});
                }
            }

            const rid = 'rec_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
            const payload = {
                rid: rid,
                duration: duration,
                size: blob.size,
                mime: blob.type,
                effects: Object.assign({}, State.effects),
                createdAt: window.QamarFB.serverTime(),
                url: null // سيُملأ عند الرفع في media/uploader.js
            };

            return window.QamarFB.set(CONFIG.RECORDINGS_PATH + '/' + uid + '/' + rid, payload)
                .then(function () {
                    _emit('studio:recordingSaved', { rid: rid, duration: duration });
                    return payload;
                });
        }).catch(function (e) {
            Logger.warn('saveRecording failed:', e.message);
            return null;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Effects API (6)                                 */
    /* ══════════════════════════════════════════════ */
    function setEffect(name, value) {
        if (!(name in State.effects)) return { ok: false };
        const v = Number(value);
        if (isNaN(v)) return { ok: false };

        // حدود
        if (name === 'bass' || name === 'mid' || name === 'treble') {
            State.effects[name] = Math.max(-40, Math.min(40, v));
        } else if (name === 'volume') {
            State.effects[name] = Math.max(0, Math.min(100, v));
        } else {
            State.effects[name] = Math.max(0, Math.min(100, v));
        }

        _applyEffectsToChain();
        _emit('studio:effectChanged', { name: name, value: State.effects[name] });
        return { ok: true, name: name, value: State.effects[name] };
    }

    function setBass(v)    { return setEffect('bass', v); }
    function setMid(v)     { return setEffect('mid', v); }
    function setTreble(v)  { return setEffect('treble', v); }
    function setEcho(v)    { return setEffect('echo', v); }
    function setReverb(v)  { return setEffect('reverb', v); }
    function setVolume(v)  { return setEffect('volume', v); }

    function resetEffects() {
        State.effects = Object.assign({}, CONFIG.DEFAULT_EFFECTS);
        _applyEffectsToChain();
        _emit('studio:effectsReset', {});
        return { ok: true, effects: State.effects };
    }

    function getEffects() {
        return Object.assign({}, State.effects);
    }

    /* ══════════════════════════════════════════════ */
    /* Preview / Download / Discard                    */
    /* ══════════════════════════════════════════════ */
    function preview() {
        if (!State.currentUrl) return { ok: false, reason: 'no-recording' };
        const audio = new Audio(State.currentUrl);
        audio.play().catch(function (e) {
            Logger.warn('preview failed:', e.message);
        });
        return { ok: true };
    }

    function download(filename) {
        if (!State.currentUrl || !State.currentBlob) return { ok: false };
        const a = document.createElement('a');
        a.href = State.currentUrl;
        a.download = filename || ('qamar-studio-' + Date.now() + '.webm');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return { ok: true };
    }

    function discard() {
        if (State.currentUrl) {
            try { URL.revokeObjectURL(State.currentUrl); } catch (e) {}
            State.currentUrl = null;
        }
        State.currentBlob = null;
        State.durationMs = 0;
        _emit('studio:discarded', {});
        return { ok: true };
    }

    function getCurrentBlob() { return State.currentBlob; }
    function getCurrentUrl()  { return State.currentUrl; }

    /* ══════════════════════════════════════════════ */
    /* Share                                           */
    /* ══════════════════════════════════════════════ */
    function shareToPM(toUid, options) {
        return Promise.resolve().then(function () {
            if (!State.currentBlob) throw new Error('لا يوجد تسجيل');
            if (!window.QamarPMVoice) throw new Error('نظام PM غير جاهز');

            // ارفع أولاً (uploader) ثم أرسل
            if (window.QamarUploader && typeof window.QamarUploader.uploadAudio === 'function') {
                return window.QamarUploader.uploadAudio(State.currentBlob).then(function (url) {
                    return window.QamarPMVoice.sendVoice(toUid, url, {
                        duration: State.durationMs,
                        size: State.currentBlob.size,
                        mime: State.currentBlob.type
                    }, options || {});
                });
            }

            // fallback — dataURL
            return new Promise(function (resolve, reject) {
                const r = new FileReader();
                r.onloadend = function () { resolve(r.result); };
                r.onerror = function () { reject(new Error('تعذر القراءة')); };
                r.readAsDataURL(State.currentBlob);
            }).then(function (url) {
                return window.QamarPMVoice.sendVoice(toUid, url, {
                    duration: State.durationMs,
                    size: State.currentBlob.size,
                    mime: State.currentBlob.type
                }, options || {});
            });
        }).then(function () {
            _emit('studio:shared', { to: toUid, target: 'pm' });
            return { ok: true };
        });
    }

    function shareToRoom(roomId, options) {
        return Promise.resolve().then(function () {
            if (!State.currentBlob) throw new Error('لا يوجد تسجيل');
            if (!window.QamarRoomVoice) throw new Error('نظام الروم غير جاهز');

            if (window.QamarUploader && typeof window.QamarUploader.uploadAudio === 'function') {
                return window.QamarUploader.uploadAudio(State.currentBlob).then(function (url) {
                    // الروم يستخدم room_voice_msgs (يُبنى لاحقاً في room-voice)
                    // نطلق حدث، ومن سيستمع يرفعه
                    _emit('studio:shareToRoom', {
                        roomId: roomId, url: url, duration: State.durationMs,
                        size: State.currentBlob.size, mime: State.currentBlob.type
                    });
                    if (window.EventBus) {
                        try {
                            window.EventBus.emit('room:voiceMsg', {
                                roomId: roomId, url: url,
                                duration: State.durationMs,
                                size: State.currentBlob.size,
                                mime: State.currentBlob.type
                            });
                        } catch (e) {}
                    }
                    return { ok: true };
                });
            }
            throw new Error('نظام الرفع غير جاهز');
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Recordings (persisted)                          */
    /* ══════════════════════════════════════════════ */
    function getRecordings() {
        const uid = _getCurrentUid();
        if (!uid) return Promise.resolve([]);
        return window.QamarFB.get(CONFIG.RECORDINGS_PATH + '/' + uid).then(function (data) {
            if (!data) return [];
            return Object.keys(data).map(function (rid) {
                return Object.assign({ _id: rid }, data[rid]);
            }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        }).catch(function () { return []; });
    }

    function deleteRecording(rid) {
        return Promise.resolve().then(function () {
            const uid = _getCurrentUid();
            if (!uid || !rid) throw new Error('بيانات ناقصة');
            return window.QamarFB.remove(CONFIG.RECORDINGS_PATH + '/' + uid + '/' + rid)
                .then(function () {
                    _emit('studio:recordingDeleted', { rid: rid });
                    return { ok: true };
                });
        });
    }

    function listAllRecordings(uid) {
        return Promise.resolve().then(function () {
            if (!_isKing()) throw new Error('فقط الملك');
            if (!uid) throw new Error('uid مطلوب');
            return window.QamarFB.get(CONFIG.RECORDINGS_PATH + '/' + uid).then(function (data) {
                if (!data) return [];
                return Object.keys(data).map(function (rid) {
                    return Object.assign({ _id: rid }, data[rid]);
                }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* UI Panel                                        */
    /* ══════════════════════════════════════════════ */
    function _findPanelParent() {
        return document.getElementById('chat-area') ||
               document.querySelector('.chat-area') ||
               document.querySelector('.chat-container') ||
               document.body;
    }

    function _buildPanel() {
        if (State.panelEl && State.panelEl.parentNode) return State.panelEl;

        const parent = _findPanelParent();
        const panel = document.createElement('div');
        panel.id = 'studio-panel';
        panel.className = 'studio-panel';
        panel.style.cssText =
            'position:fixed;inset:0;z-index:13500;' +
            'background:linear-gradient(135deg,rgba(10,10,21,0.96),rgba(17,7,36,0.96));' +
            'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
            'display:flex;flex-direction:column;align-items:center;' +
            'justify-content:center;padding:20px;direction:rtl;' +
            'font-family:inherit;color:#f3f4f6;overflow-y:auto;';

        panel.innerHTML = '';

        // رأس
        const header = document.createElement('div');
        header.style.cssText = 'text-align:center;margin-bottom:20px;';
        header.innerHTML =
            '<div style="font-size:42px;margin-bottom:6px;">🎙️</div>' +
            '<div style="font-size:20px;font-weight:900;color:#ffd700;">استوديو التسجيل</div>' +
            '<div style="font-size:12px;color:#9ca3af;margin-top:4px;">موسيقار الشام في خدمتك</div>';
        panel.appendChild(header);

        // مؤقت
        const timer = document.createElement('div');
        timer.id = 'studio-timer';
        timer.style.cssText =
            'font-family:monospace;font-size:34px;font-weight:900;color:#ffd700;' +
            'margin-bottom:16px;letter-spacing:2px;';
        timer.textContent = '00:00';
        panel.appendChild(timer);

        // زر التسجيل الرئيسي (كبير)
        const recordBtn = _buildBigButton({
            id: 'record',
            label: 'تسجيل',
            icon: '🎙️',
            bg: 'linear-gradient(135deg,#ff4444,#cc0000)',
            size: 110,
            onclick: function (e) {
                e.preventDefault();
                _handleButton('record', e.currentTarget, function () {
                    if (State.recording) {
                        stopRecording().catch(function (err) { _toast(err.message); });
                    } else {
                        startRecording().catch(function (err) { _toast(err.message); });
                    }
                });
            }
        });
        panel.appendChild(recordBtn);

        // أزرار مساعدة (صف)
        const row1 = document.createElement('div');
        row1.style.cssText = 'display:flex;gap:14px;margin-top:20px;flex-wrap:wrap;justify-content:center;';

        row1.appendChild(_buildBigButton({
            id: 'pause', label: 'إيقاف مؤقت', icon: '⏸️',
            bg: 'linear-gradient(135deg,#ffa500,#cc7700)', size: 70,
            onclick: function (e) {
                e.preventDefault();
                _handleButton('pause', e.currentTarget, function () {
                    if (State.paused) resumeRecording(); else pauseRecording();
                });
            }
        }));

        row1.appendChild(_buildBigButton({
            id: 'preview', label: 'معاينة', icon: '▶️',
            bg: 'linear-gradient(135deg,#3b82f6,#1e40af)', size: 70,
            onclick: function (e) {
                e.preventDefault();
                _handleButton('preview', e.currentTarget, function () {
                    preview();
                });
            }
        }));

        row1.appendChild(_buildBigButton({
            id: 'download', label: 'تحميل', icon: '⬇️',
            bg: 'linear-gradient(135deg,#4ade80,#166534)', size: 70,
            onclick: function (e) {
                e.preventDefault();
                _handleButton('download', e.currentTarget, function () {
                    download();
                });
            }
        }));

        row1.appendChild(_buildBigButton({
            id: 'discard', label: 'إلغاء', icon: '🗑️',
            bg: 'linear-gradient(135deg,#6b7280,#374151)', size: 70,
            onclick: function (e) {
                e.preventDefault();
                _handleButton('discard', e.currentTarget, function () {
                    if (window.confirm) {
                        if (!window.confirm('حذف التسجيل الحالي؟')) return;
                    }
                    cancelRecording();
                    discard();
                });
            }
        }));

        panel.appendChild(row1);

        // المؤثرات (6 sliders)
        const fxWrap = document.createElement('div');
        fxWrap.style.cssText =
            'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));' +
            'gap:12px;margin-top:24px;max-width:600px;width:100%;';

        const effectsList = [
            { id: 'bass',    label: 'Bass',   icon: '🎚️', min: -40, max: 40, def: 0 },
            { id: 'mid',     label: 'Mid',    icon: '🎚️', min: -40, max: 40, def: 0 },
            { id: 'treble',  label: 'Treble', icon: '🎚️', min: -40, max: 40, def: 0 },
            { id: 'echo',    label: 'صدى',    icon: '🔊', min: 0,  max: 100, def: 0 },
            { id: 'reverb',  label: 'رنين',   icon: '🏛️', min: 0,  max: 100, def: 0 },
            { id: 'volume',  label: 'الصوت',  icon: '🔉', min: 0,  max: 100, def: 100 }
        ];

        effectsList.forEach(function (fx) {
            const wrap = document.createElement('div');
            wrap.style.cssText =
                'background:rgba(255,255,255,0.04);border:1px solid rgba(212,175,55,0.2);' +
                'border-radius:12px;padding:10px;';

            const head = document.createElement('div');
            head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
            head.innerHTML =
                '<span style="font-size:14px">' + fx.icon + '</span>' +
                '<span style="font-size:12px;font-weight:900;color:#ffd700;">' + fx.label + '</span>' +
                '<span class="fx-val" data-fx="' + fx.id + '" style="margin-right:auto;font-size:11px;color:#9ca3af;">' + fx.def + '</span>';
            wrap.appendChild(head);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = fx.min;
            slider.max = fx.max;
            slider.value = State.effects[fx.id];
            slider.dataset.fx = fx.id;
            slider.style.cssText = 'width:100%;cursor:pointer;';
            slider.addEventListener('input', function (ev) {
                const v = Number(ev.target.value);
                setEffect(fx.id, v);
                const vEl = wrap.querySelector('.fx-val');
                if (vEl) vEl.textContent = v;
            });
            slider.addEventListener('click', function (ev) {
                ev.stopPropagation();
            });
            wrap.appendChild(slider);

            // زر الشرح للبوت
            wrap.addEventListener('click', function (ev) {
                if (ev.target === slider) return;
                _handleButton(fx.id, wrap, null);
            });

            fxWrap.appendChild(wrap);
        });

        panel.appendChild(fxWrap);

        // زر الإغلاق
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕  إغلاق الاستوديو';
        closeBtn.style.cssText =
            'margin-top:24px;padding:10px 22px;border-radius:12px;' +
            'background:rgba(255,68,68,0.15);color:#ff8888;' +
            'border:1px solid rgba(255,68,68,0.4);font-family:inherit;' +
            'font-weight:900;font-size:13px;cursor:pointer;';
        closeBtn.onclick = function (e) {
            e.preventDefault();
            close();
        };
        panel.appendChild(closeBtn);

        parent.appendChild(panel);
        State.panelEl = panel;
        return panel;
    }

    function _buildBigButton(opts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'studio-btn-' + opts.id;
        btn.dataset.btnId = opts.id;
        btn.style.cssText =
            'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
            'gap:6px;width:' + opts.size + 'px;height:' + opts.size + 'px;' +
            'border-radius:50%;background:' + opts.bg + ';' +
            'color:#fff;border:none;cursor:pointer;font-family:inherit;' +
            'box-shadow:0 8px 24px rgba(0,0,0,0.5);transition:transform 0.15s;';
        btn.innerHTML =
            '<div style="font-size:' + (opts.size > 90 ? 36 : 26) + 'px;line-height:1;">' + opts.icon + '</div>' +
            '<div style="font-size:' + (opts.size > 90 ? 13 : 11) + 'px;font-weight:900;">' + opts.label + '</div>';
        btn.addEventListener('mouseenter', function () { btn.style.transform = 'scale(1.06)'; });
        btn.addEventListener('mouseleave', function () { btn.style.transform = 'scale(1)'; });
        btn.addEventListener('click', opts.onclick);
        return btn;
    }

    // معالج موحد: عرض البوت + تنفيذ الإجراء
    function _handleButton(buttonId, anchorEl, action) {
        // اعرض التوستيب أولاً إذا لم يُشاهد
        if (!State.seenTips[buttonId] && CONFIG.BOT_TIPS[buttonId]) {
            _showTip(CONFIG.BOT_TIPS[buttonId], anchorEl, function () {
                _markTipSeen(buttonId);
                if (action) try { action(); } catch (e) {}
            });
            return;
        }
        // نفّذ الإجراء
        if (action) try { action(); } catch (e) { Logger.warn('action error:', e.message); }
    }

    function _updateTimerEl() {
        const el = document.getElementById('studio-timer');
        if (!el) return;
        const ms = State.durationMs || 0;
        el.textContent = _fmtTime(ms);
    }

    /* ══════════════════════════════════════════════ */
    /* Open / Close                                    */
    /* ══════════════════════════════════════════════ */
    function open() {
        return Promise.resolve().then(function () {
            if (!_canUseStudio()) {
                throw new Error('هذه الميزة لمستوى 80+');
            }
            if (State.opened) return { ok: true, already: true };

            State.opened = true;
            _loadSeenTips();
            _lockSession();
            _buildPanel();
            _updateTimerEl();

            // استمع للـ tick
            if (State.listeners.indexOf(_updateTimerEl) === -1) {
                onStudioEvent(function (ev) {
                    if (ev.type === 'studio:tick') _updateTimerEl();
                });
            }

            _emit('studio:opened', {});
            Logger.info('🎙️ Studio opened');
            return { ok: true };
        }).catch(function (e) {
            Logger.warn('open failed:', e.message);
            _emit('studio:error', { error: e.message });
            throw e;
        });
    }

    function close() {
        return Promise.resolve().then(function () {
            if (!State.opened) return { ok: true };
            // نظّف
            try { cancelRecording(); } catch (e) {}
            try { discard(); } catch (e) {}
            _closeTip();
            _unlockSession();
            if (State.panelEl && State.panelEl.parentNode) {
                State.panelEl.parentNode.removeChild(State.panelEl);
            }
            State.panelEl = null;
            State.opened = false;
            State.seenTips = {}; // يُعاد تحميله في الدخول القادم
            _emit('studio:closed', {});
            Logger.info('🎙️ Studio closed');
            return { ok: true };
        });
    }

    function isOpen() { return State.opened; }
    function isRecording() { return State.recording; }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;

        // عند تغيير الغرفة → أغلق
        if (window.EventBus) {
            window.EventBus.on('room:changed', function () {
                if (State.opened) close();
            });
        }
        // عند تسجيل الخروج
        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (!p.isLoggedIn && State.opened) close();
            });
        }
        // عند إغلاق الصفحة
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', function () {
                try { cancelRecording(); } catch (e) {}
                _unlockSession();
            });
        }

        Logger.info('📦 [voice-studio.js] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 2800);
        });
    } else {
        setTimeout(_init, 9000);
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            opened: State.opened,
            recording: State.recording,
            paused: State.paused,
            duration: State.durationMs,
            hasBlob: !!State.currentBlob,
            canUse: _canUseStudio(),
            myLevel: _myLevel(),
            isKing: _isKing(),
            effects: Object.assign({}, State.effects),
            seenTipsCount: Object.keys(State.seenTips).length,
            mimeType: State.mimeType
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarVoiceStudio = {
        CONFIG: CONFIG,

        // Lifecycle
        open: open,
        close: close,
        isOpen: isOpen,
        isRecording: isRecording,

        // Recording
        startRecording: startRecording,
        pauseRecording: pauseRecording,
        resumeRecording: resumeRecording,
        stopRecording: stopRecording,
        cancelRecording: cancelRecording,

        // Effects
        setEffect: setEffect,
        setBass: setBass,
        setMid: setMid,
        setTreble: setTreble,
        setEcho: setEcho,
        setReverb: setReverb,
        setVolume: setVolume,
        resetEffects: resetEffects,
        getEffects: getEffects,

        // Preview / Download
        preview: preview,
        download: download,
        discard: discard,
        getCurrentBlob: getCurrentBlob,
        getCurrentUrl: getCurrentUrl,

        // Share
        shareToPM: shareToPM,
        shareToRoom: shareToRoom,

        // Recordings
        getRecordings: getRecordings,
        deleteRecording: deleteRecording,
        listAllRecordings: listAllRecordings,

        // Events
        onStudioEvent: onStudioEvent,

        // Debug
        getStatus: getStatus
    };

    Logger.info('📦 [voice-studio.js] loaded | min-level:', CONFIG.MIN_LEVEL);
})();
