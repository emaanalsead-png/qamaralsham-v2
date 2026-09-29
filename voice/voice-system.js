// ==============================================
// voice/voice-system.js
// WebRTC mesh voice system
// ==============================================
// يعتمد على: firebase.js + room-voice.js + auth.js + ranks.js
// يعطي: window.QamarVoiceSystem
// ==============================================
// ✅ v2.2: تصدير callbacks + getters لـ voice-monitor
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [voice-system] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[VS]';
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
        SIGNALS_ROOT: 'room_voice',
        SPEAKING_THRESHOLD: 15,
        SPEAKING_CHECK_MS: 200,
        MAX_RECONNECT_ATTEMPTS: 3,
        RECONNECT_BACKOFF_MS: 1500,
        SIGNAL_CLEANUP_MS: 30 * 1000,
        AUDIO_CONSTRAINTS: {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                googEchoCancellation: true,
                googNoiseSuppression: true
            },
            video: false
        },
        ICE_SERVERS: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        connected: false,
        roomId: null,
        mySlot: -1,
        myUid: null,

        localStream: null,
        audioContext: null,
        analyser: null,
        dataArray: null,
        speakingTimer: null,
        isSpeaking: false,
        muted: false,

        peers: {},              // { peerUid: { pc, audioEl, signals, reconnects } }
        remoteAudios: {},       // { peerUid: audioEl }  ⭐ للـ monitor
        speakersData: {},       // ⭐ آخر قائمة speakers
        participantsData: {},   // ⭐ آخر قائمة participants

        signalsListener: null,
        speakersListener: null,

        personalMutes: {},
        personalMutedAll: false,

        onSpeakersChange: null,  // ⭐ callback مسجّل من voice-monitor

        explicitDisconnect: false,
        listeners: [],
        _initialized: false
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onVoiceSystemEvent(cb) {
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

    function _signalsPath(roomId, toUid) {
        return CONFIG.SIGNALS_ROOT + '/' + roomId + '/signals/' + toUid;
    }

    function _randomId() {
        return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    }

    /* ══════════════════════════════════════════════ */
    /* Get user media                                  */
    /* ══════════════════════════════════════════════ */
    function _getUserMedia() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return Promise.reject(new Error('متصفحك لا يدعم الوصول للمايك'));
        }
        return navigator.mediaDevices.getUserMedia(CONFIG.AUDIO_CONSTRAINTS);
    }

    /* ══════════════════════════════════════════════ */
    /* Audio analysis                                  */
    /* ══════════════════════════════════════════════ */
    function _startAudioAnalysis() {
        if (!State.localStream) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            State.audioContext = new AC();
            const source = State.audioContext.createMediaStreamSource(State.localStream);
            State.analyser = State.audioContext.createAnalyser();
            State.analyser.fftSize = 512;
            State.analyser.smoothingTimeConstant = 0.5;
            source.connect(State.analyser);
            State.dataArray = new Uint8Array(State.analyser.frequencyBinCount);

            State.speakingTimer = setInterval(_checkSpeaking, CONFIG.SPEAKING_CHECK_MS);
        } catch (e) {
            Logger.warn('AudioContext init failed:', e.message);
        }
    }

    function _stopAudioAnalysis() {
        if (State.speakingTimer) { clearInterval(State.speakingTimer); State.speakingTimer = null; }
        if (State.audioContext) { try { State.audioContext.close(); } catch (e) {} State.audioContext = null; }
        State.analyser = null;
        State.dataArray = null;
        State.isSpeaking = false;
    }

    function _checkSpeaking() {
        if (!State.analyser || !State.dataArray) return;
        try {
            State.analyser.getByteFrequencyData(State.dataArray);
            let sum = 0;
            for (let i = 0; i < State.dataArray.length; i++) sum += State.dataArray[i];
            const avg = sum / State.dataArray.length;
            const speaking = avg > CONFIG.SPEAKING_THRESHOLD && !State.muted;

            if (speaking !== State.isSpeaking) {
                State.isSpeaking = speaking;
                if (window.QamarRoomVoice && window.QamarRoomVoice.updateSpeakingState) {
                    try { window.QamarRoomVoice.updateSpeakingState(State.myUid, speaking); } catch (e) {}
                }
                _emit('voice:speaking', { uid: State.myUid, speaking: speaking });
            }
        } catch (e) {}
    }

    /* ══════════════════════════════════════════════ */
    /* Peer Connection                                 */
    /* ══════════════════════════════════════════════ */
    function _createPeer(peerUid, initiator) {
        if (State.peers[peerUid]) {
            Logger.debug('Peer already exists:', peerUid.substring(0, 8));
            return State.peers[peerUid];
        }

        const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });
        const peer = {
            pc: pc, audioEl: null, signals: {}, reconnects: 0, isInitiator: !!initiator
        };
        State.peers[peerUid] = peer;

        if (State.localStream) {
            State.localStream.getTracks().forEach(function (track) {
                pc.addTrack(track, State.localStream);
            });
        }

        pc.onicecandidate = function (ev) {
            if (ev.candidate) {
                _sendSignal(peerUid, 'ice', {
                    candidate: ev.candidate.candidate,
                    sdpMid: ev.candidate.sdpMid,
                    sdpMLineIndex: ev.candidate.sdpMLineIndex
                });
            }
        };

        pc.ontrack = function (ev) {
            Logger.debug('Track from', peerUid.substring(0, 8));
            const stream = ev.streams[0] || new MediaStream([ev.track]);
            _attachAudio(peerUid, stream);
        };

        pc.onconnectionstatechange = function () {
            Logger.debug('PC state:', peerUid.substring(0, 8), pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                _attemptReconnect(peerUid);
            }
            _emit('voice:peerState', { uid: peerUid, state: pc.connectionState });
        };

        if (initiator) _createOffer(peerUid);

        _emit('voice:peerAdded', { uid: peerUid });
        return peer;
    }

    function _attachAudio(peerUid, stream) {
        const peer = State.peers[peerUid];
        if (!peer) return;

        if (peer.audioEl && peer.audioEl.parentNode) {
            peer.audioEl.parentNode.removeChild(peer.audioEl);
        }

        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.srcObject = stream;
        audio.style.display = 'none';
        audio.dataset.peer = peerUid;
        document.body.appendChild(audio);
        peer.audioEl = audio;

        // ⭐ نسجّل في remoteAudios للـ monitor
        State.remoteAudios[peerUid] = audio;

        _applyPersonalMuteToPeer(peerUid);
    }

    function _applyPersonalMuteToPeer(peerUid) {
        const peer = State.peers[peerUid];
        if (!peer || !peer.audioEl) return;
        const muted = State.personalMutedAll || !!State.personalMutes[peerUid];
        peer.audioEl.muted = muted;
        peer.audioEl.volume = muted ? 0 : 1;
    }

    function _removePeer(peerUid, notify) {
        const peer = State.peers[peerUid];
        if (!peer) return;
        try { peer.pc.close(); } catch (e) {}
        if (peer.audioEl && peer.audioEl.parentNode) {
            peer.audioEl.parentNode.removeChild(peer.audioEl);
        }
        delete State.peers[peerUid];
        delete State.remoteAudios[peerUid];   // ⭐
        if (notify !== false) _emit('voice:peerRemoved', { uid: peerUid });
    }

    function _removeAllPeers() {
        Object.keys(State.peers).forEach(function (uid) { _removePeer(uid, false); });
        State.peers = {};
        State.remoteAudios = {};              // ⭐
    }

    /* ══════════════════════════════════════════════ */
    /* Offer / Answer / ICE                            */
    /* ══════════════════════════════════════════════ */
    function _createOffer(peerUid) {
        const peer = State.peers[peerUid];
        if (!peer) return Promise.resolve();
        return peer.pc.createOffer()
            .then(function (offer) {
                return peer.pc.setLocalDescription(offer).then(function () { return offer; });
            })
            .then(function (offer) {
                _sendSignal(peerUid, 'offer', { sdp: offer.sdp, type: offer.type });
            })
            .catch(function (e) { Logger.warn('createOffer failed:', e.message); });
    }

    function _handleOffer(fromUid, payload) {
        const peer = _createPeer(fromUid, false);
        return peer.pc.setRemoteDescription(new RTCSessionDescription(payload))
            .then(function () { return peer.pc.createAnswer(); })
            .then(function (answer) {
                return peer.pc.setLocalDescription(answer).then(function () { return answer; });
            })
            .then(function (answer) {
                _sendSignal(fromUid, 'answer', { sdp: answer.sdp, type: answer.type });
            })
            .catch(function (e) { Logger.warn('handleOffer failed:', e.message); });
    }

    function _handleAnswer(fromUid, payload) {
        const peer = State.peers[fromUid];
        if (!peer) return;
        if (peer.pc.signalingState === 'stable') return;
        return peer.pc.setRemoteDescription(new RTCSessionDescription(payload))
            .catch(function (e) { Logger.warn('handleAnswer failed:', e.message); });
    }

    function _handleIce(fromUid, payload) {
        const peer = State.peers[fromUid];
        if (!peer) return;
        if (!payload || !payload.candidate) return;
        const cand = new RTCIceCandidate({
            candidate: payload.candidate,
            sdpMid: payload.sdpMid,
            sdpMLineIndex: payload.sdpMLineIndex
        });
        peer.pc.addIceCandidate(cand).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Signaling                                       */
    /* ══════════════════════════════════════════════ */
    function _sendSignal(toUid, type, payload) {
        if (!State.roomId || !toUid) return Promise.resolve();
        const rid = _randomId();
        const path = _signalsPath(State.roomId, toUid) + '/' + rid;
        return window.QamarFB.set(path, {
            fromUid: State.myUid,
            type: type,
            payload: payload,
            at: window.QamarFB.serverTime()
        }).then(function () {
            setTimeout(function () { window.QamarFB.remove(path).catch(function () {}); }, CONFIG.SIGNAL_CLEANUP_MS);
        }).catch(function () {});
    }

    function _startSignalsListener() {
        _stopSignalsListener();
        if (!State.roomId || !State.myUid) return;
        const path = _signalsPath(State.roomId, State.myUid);
        State.signalsListener = window.QamarFB.onChildAdded(path, function (data, rid) {
            if (!data || !data.fromUid || !data.type) return;
            if (data.fromUid === State.myUid) return;
            try {
                if (data.type === 'offer') _handleOffer(data.fromUid, data.payload);
                else if (data.type === 'answer') _handleAnswer(data.fromUid, data.payload);
                else if (data.type === 'ice') _handleIce(data.fromUid, data.payload);
            } finally {
                window.QamarFB.remove(path + '/' + rid).catch(function () {});
            }
        }, function () {});
    }

    function _stopSignalsListener() {
        if (State.signalsListener && State.signalsListener.off) {
            try { State.signalsListener.off(); } catch (e) {}
        }
        State.signalsListener = null;
    }

    /* ══════════════════════════════════════════════ */
    /* Speakers listener                               */
    /* ══════════════════════════════════════════════ */
    function _startSpeakersListener() {
        _stopSpeakersListener();
        if (!State.roomId) return;

        const path = CONFIG.SIGNALS_ROOT + '/' + State.roomId + '/speakers';
        State.speakersListener = window.QamarFB.onValue(path, function (data) {
            const speakers = data || {};
            State.speakersData = speakers;
            _syncPeersWithSpeakers(speakers);

            // ⭐ v2.2: أخبر voice-monitor
            if (typeof State.onSpeakersChange === 'function') {
                try { State.onSpeakersChange(speakers); } catch (e) {
                    Logger.warn('onSpeakersChange callback error:', e.message);
                }
            }
        }, function () {});
    }

    function _stopSpeakersListener() {
        if (State.speakersListener && State.speakersListener.off) {
            try { State.speakersListener.off(); } catch (e) {}
        }
        State.speakersListener = null;
    }

    function _syncPeersWithSpeakers(speakers) {
        const known = {};

        Object.keys(speakers).forEach(function (slotKey) {
            const s = speakers[slotKey];
            if (!s || !s.uid) return;
            if (s.uid === State.myUid) return;
            known[s.uid] = true;

            if (!State.peers[s.uid]) {
                _createPeer(s.uid, true);
            }
        });

        Object.keys(State.peers).forEach(function (uid) {
            if (!known[uid]) _removePeer(uid, true);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Reconnect                                       */
    /* ══════════════════════════════════════════════ */
    function _attemptReconnect(peerUid) {
        const peer = State.peers[peerUid];
        if (!peer) return;
        if (peer.reconnects >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
            _removePeer(peerUid, true);
            return;
        }
        peer.reconnects++;
        const delay = CONFIG.RECONNECT_BACKOFF_MS * peer.reconnects;
        setTimeout(function () {
            if (!State.peers[peerUid]) return;
            _removePeer(peerUid, false);
            _createPeer(peerUid, true);
        }, delay);
    }

    /* ══════════════════════════════════════════════ */
    /* Connect / Disconnect                            */
    /* ══════════════════════════════════════════════ */
    function connect(roomId, slotIndex) {
        if (State.connected && State.roomId === roomId) {
            return Promise.resolve({ ok: true, already: true });
        }
        if (!roomId) return Promise.reject(new Error('roomId مطلوب'));
        if (slotIndex === undefined || slotIndex === null || slotIndex < 0) {
            return Promise.reject(new Error('slot مطلوب'));
        }

        State.explicitDisconnect = false;
        State.roomId = roomId;
        State.mySlot = Number(slotIndex);
        State.myUid = _getCurrentUid();
        if (!State.myUid) return Promise.reject(new Error('غير مسجل'));

        Logger.info('🎙️ Connecting voice... room:', roomId, 'slot:', State.mySlot);

        return _getUserMedia().then(function (stream) {
            State.localStream = stream;
            if (State.muted) stream.getAudioTracks().forEach(function (t) { t.enabled = false; });
            _startAudioAnalysis();
            _startSignalsListener();
            _startSpeakersListener();
            State.connected = true;

            _emit('voice:connected', { roomId: roomId, slot: State.mySlot });
            if (window.QamarRoomVoice && window.QamarRoomVoice.updateMuteState) {
                try { window.QamarRoomVoice.updateMuteState(State.myUid, State.muted); } catch (e) {}
            }
            return { ok: true };
        }).catch(function (e) {
            Logger.error('connect failed:', e.message);
            _emit('voice:error', { error: e.message });
            throw e;
        });
    }

    function disconnect() {
        State.explicitDisconnect = true;
        try { _stopSignalsListener(); } catch (e) {}
        try { _stopSpeakersListener(); } catch (e) {}
        try { _stopAudioAnalysis(); } catch (e) {}
        _removeAllPeers();

        if (State.localStream) {
            try { State.localStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
            State.localStream = null;
        }

        if (State.myUid && State.roomId) {
            window.QamarFB.remove(_signalsPath(State.roomId, State.myUid)).catch(function () {});
        }

        State.connected = false;
        State.roomId = null;
        State.mySlot = -1;
        State.myUid = null;
        State.speakersData = {};
        State.participantsData = {};

        _emit('voice:disconnected', {});
        Logger.info('🎙️ Voice disconnected');
        return Promise.resolve({ ok: true });
    }

    function mute(muted) {
        State.muted = !!muted;
        if (State.localStream) {
            State.localStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
        }
        if (window.QamarRoomVoice && window.QamarRoomVoice.updateMuteState && State.myUid) {
            try { window.QamarRoomVoice.updateMuteState(State.myUid, State.muted); } catch (e) {}
        }
        _emit('voice:muteChanged', { muted: State.muted });
        return { ok: true, muted: State.muted };
    }

    function toggleMute() { return mute(!State.muted); }

    function applyMutes(personalMutes, personalMutedAll) {
        State.personalMutes = personalMutes || {};
        State.personalMutedAll = !!personalMutedAll;
        Object.keys(State.peers).forEach(_applyPersonalMuteToPeer);
    }

    function setVolume(peerUid, volume) {
        const peer = State.peers[peerUid];
        if (!peer || !peer.audioEl) return;
        const v = Math.max(0, Math.min(1, Number(volume) || 0));
        peer.audioEl.volume = v;
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function isConnected() { return State.connected; }
    function getPeers() { return Object.keys(State.peers); }
    function getLocalStream() { return State.localStream; }

    function getStatus() {
        return {
            initialized: State._initialized,
            connected: State.connected,
            roomId: State.roomId,
            mySlot: State.mySlot,
            myUid: State.myUid ? State.myUid.substring(0, 8) : null,
            peers: Object.keys(State.peers).length,
            remoteAudios: Object.keys(State.remoteAudios).length,
            muted: State.muted,
            speaking: State.isSpeaking,
            hasStream: !!State.localStream,
            hasAudioContext: !!State.audioContext,
            personalMutes: Object.keys(State.personalMutes).length,
            personalMutedAll: State.personalMutedAll,
            hasSpeakersCallback: typeof State.onSpeakersChange === 'function'
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;

        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (!p.isLoggedIn && State.connected) disconnect();
            });
        }

        if (window.EventBus) {
            window.EventBus.on('room:changed', function () {
                if (State.connected) disconnect();
            });
        }

        Logger.info('📦 [voice-system.js] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () { setTimeout(_init, 2600); });
    } else {
        setTimeout(_init, 8000);
    }

    /* ══════════════════════════════════════════════ */
    /* ⭐ v2.2: Hooks for voice-monitor                */
    /* ══════════════════════════════════════════════ */
    function _registerSpeakersCallback(cb) {
        State.onSpeakersChange = (typeof cb === 'function') ? cb : null;
        Logger.info('📡 voice-monitor callback registered:', !!State.onSpeakersChange);
        // إن كانت هناك بيانات جاهزة، أرسلها فوراً
        if (State.onSpeakersChange && Object.keys(State.speakersData).length > 0) {
            try { State.onSpeakersChange(State.speakersData); } catch (e) {}
        }
    }

    function _unregisterSpeakersCallback() {
        State.onSpeakersChange = null;
    }

    function _getMicStream() {
        return State.localStream || null;
    }

    function _getRemoteAudios() {
        return State.remoteAudios || {};
    }

    function _getSpeakersData() {
        return State.speakersData || {};
    }

    function _getParticipantsData() {
        return State.participantsData || {};
    }

    // يستدعى من room-voice عند تحديث participants
    function _setParticipantsData(data) {
        State.participantsData = data || {};
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarVoiceSystem = {
        CONFIG: CONFIG,

        // Lifecycle
        connect: connect,
        disconnect: disconnect,
        mute: mute,
        toggleMute: toggleMute,

        // Personal
        applyMutes: applyMutes,
        setVolume: setVolume,

        // Status
        isConnected: isConnected,
        getPeers: getPeers,
        getLocalStream: getLocalStream,

        // Events
        onVoiceSystemEvent: onVoiceSystemEvent,

        // ⭐ v2.2: Hooks for voice-monitor
        _registerSpeakersCallback: _registerSpeakersCallback,
        _unregisterSpeakersCallback: _unregisterSpeakersCallback,
        _getMicStream: _getMicStream,
        _getRemoteAudios: _getRemoteAudios,
        _getSpeakersData: _getSpeakersData,
        _getParticipantsData: _getParticipantsData,
        _setParticipantsData: _setParticipantsData,

        // Debug
        getStatus: getStatus
    };

    // Aliases قديمة (توافق مع النسخة السابقة)
    window.VoiceSystem = window.QamarVoiceSystem;

    Logger.info('📦 [voice-system.js] v2.2 loaded | monitor hooks exported');
})();
