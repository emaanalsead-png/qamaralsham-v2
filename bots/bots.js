// ==============================================
// bots/bots.js
// Base infrastructure for 6 bots
// ==============================================
// يعتمد على: firebase.js + constants.js + state.js + auth.js + ranks.js
// يعطي: window.QamarBots
// ==============================================
// ✅ v2.2: انتظار auth قبل القراءة (لا permission_denied)
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [bots] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[BOT]';
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
        CONFIG_ROOT: 'bot_memory/bots',
        LOCK_ROOT: 'bot_locks/bots',
        DEFAULT_RATE_MS: 3000,
        DEFAULT_COOLDOWN_MS: 5000,
        LOCK_TTL_MS: 30 * 1000,
        MESSAGE_MAX_AGE_MS: 5 * 60 * 1000,
        MAX_TEXT_LENGTH: 2000
    };

    /* ══════════════════════════════════════════════ */
    /* Bots Registry — 6 bots                          */
    /* ══════════════════════════════════════════════ */
    const BOT_DEFS = {
        ambassador: {
            id: 'ambassador', name: 'سفير الشام', icon: '🚪', color: '#84cc16',
            description: 'يرحّب بالأعضاء ويرسل رسائل النظام',
            allowedRooms: ['*'], defaultRateMs: 2000, defaultCooldownMs: 5000, isSystem: true
        },
        hakawati: {
            id: 'hakawati', name: 'حكواتي الشام', icon: '📖', color: '#9c27b0',
            description: 'يرد على الكلمات المفتاحية',
            allowedRooms: ['*'], defaultRateMs: 1500, defaultCooldownMs: 3000, isSystem: false
        },
        quiz: {
            id: 'quiz', name: 'الشاطر', icon: '🎯', color: '#ff9800',
            description: 'يدير المسابقات',
            allowedRooms: ['quiz'], defaultRateMs: 3000, defaultCooldownMs: 10000, isSystem: false
        },
        guardian: {
            id: 'guardian', name: 'السجان', icon: '🚔', color: '#ff4444',
            description: 'يحمي المكان من المخالفات',
            allowedRooms: ['*'], defaultRateMs: 3000, defaultCooldownMs: 5000, isSystem: false
        },
        islamic: {
            id: 'islamic', name: 'قمر الشام', icon: '🌙', color: '#d4af37',
            description: 'أدعية وأذكار',
            allowedRooms: ['islamic'], defaultRateMs: 5000, defaultCooldownMs: 30000, isSystem: false
        },
        musician: {
            id: 'musician', name: 'موسيقار الشام', icon: '🎵', color: '#a855f7',
            description: 'يشرح التسجيل وأمان الاستديو',
            allowedRooms: ['studio'], defaultRateMs: 5000, defaultCooldownMs: 15000, isSystem: false
        }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        configs: {},
        lastSentAt: {},
        lastSentText: {},
        lastProcessedMsgId: null,
        instanceId: 'bot_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),
        initialized: false,
        listeners: []
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onBotsEvent(cb) {
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

    function _getCurrentRoom() {
        if (window.AppState && window.AppState.currentRoom) return window.AppState.currentRoom;
        if (window.QamarRooms && window.QamarRooms.getCurrent) {
            const r = window.QamarRooms.getCurrent();
            if (r) return r;
        }
        try { return localStorage.getItem('qamar_last_room') || null; } catch (e) { return null; }
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    function _sanitizeText(text) {
        if (!text) return '';
        return String(text).trim().substring(0, CONFIG.MAX_TEXT_LENGTH);
    }

    function _now() { return Date.now(); }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function initBots() {
        if (State.initialized) return Promise.resolve(true);

        // ⭐ لا تقرأ إذا لا يوجد مستخدم
        if (!window.auth || !window.auth.currentUser) {
            _applyConfigs({});
            State.initialized = true;
            Logger.info('✅ Bots initialized (defaults, no user)');
            return Promise.resolve(true);
        }

        return window.QamarFB.get(CONFIG.CONFIG_ROOT).then(function (data) {
            _applyConfigs(data || {});
            State.initialized = true;
            Logger.info('✅ Bots initialized:', Object.keys(BOT_DEFS).length);
            _emit('bots:ready', { bots: Object.keys(BOT_DEFS) });
            return true;
        }).catch(function (e) {
            Logger.warn('initBots error — using defaults:', e.message);
            _applyConfigs({});
            State.initialized = true;
            return true;
        });
    }

    function _applyConfigs(stored) {
        Object.keys(BOT_DEFS).forEach(function (botId) {
            const def = BOT_DEFS[botId];
            const s = stored[botId] || {};
            State.configs[botId] = {
                enabled: s.enabled !== undefined ? !!s.enabled : true,
                rateMs: Number(s.rateMs) || def.defaultRateMs,
                cooldownMs: Number(s.cooldownMs) || def.defaultCooldownMs,
                allowedRooms: Array.isArray(s.allowedRooms) ? s.allowedRooms : def.allowedRooms
            };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Getters                                         */
    /* ══════════════════════════════════════════════ */
    function getBot(botId) {
        const def = BOT_DEFS[botId];
        if (!def) return null;
        const cfg = State.configs[botId] || {};
        return Object.assign({}, def, {
            enabled: cfg.enabled !== false,
            rateMs: cfg.rateMs || def.defaultRateMs,
            cooldownMs: cfg.cooldownMs || def.defaultCooldownMs,
            allowedRooms: cfg.allowedRooms || def.allowedRooms
        });
    }

    function getAllBots() { return Object.keys(BOT_DEFS).map(getBot); }

    function isBotEnabled(botId) {
        const c = State.configs[botId];
        return !!(c && c.enabled !== false);
    }

    function getBotConfig(botId) { return State.configs[botId] || null; }

    /* ══════════════════════════════════════════════ */
    /* canWriteInRoom                                  */
    /* ══════════════════════════════════════════════ */
    function canWriteInRoom(botId, roomId) {
        const def = BOT_DEFS[botId];
        if (!def || !roomId) return false;
        if (def.allowedRooms.indexOf('*') !== -1) return true;
        return def.allowedRooms.indexOf(roomId) !== -1;
    }

    /* ══════════════════════════════════════════════ */
    /* Distributed Lock                                */
    /* ══════════════════════════════════════════════ */
    function _lockPath(botId) { return CONFIG.LOCK_ROOT + '/' + botId + '/lock'; }

    function _acquireLock(botId) {
        const path = _lockPath(botId);
        const mine = { instanceId: State.instanceId, at: _now() };
        return window.QamarFB.transaction(path, function (cur) {
            if (cur && cur.instanceId === State.instanceId) return mine;
            if (cur && cur.at && (_now() - cur.at) < CONFIG.LOCK_TTL_MS) return undefined;
            return mine;
        }).then(function (r) {
            return !!(r && r.committed && r.snapshot && r.snapshot.instanceId === State.instanceId);
        }).catch(function () { return false; });
    }

    function _releaseLock(botId) {
        const path = _lockPath(botId);
        return window.QamarFB.transaction(path, function (cur) {
            if (cur && cur.instanceId === State.instanceId) return null;
            return undefined;
        }).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Rate + Cooldown                                 */
    /* ══════════════════════════════════════════════ */
    function _checkLocalRate(botId) {
        const cfg = State.configs[botId];
        if (!cfg) return false;
        const last = State.lastSentAt[botId] || 0;
        return (_now() - last) >= (cfg.rateMs || CONFIG.DEFAULT_RATE_MS);
    }

    function _checkCooldown(botId, text) {
        const cfg = State.configs[botId];
        if (!cfg) return true;
        const last = State.lastSentText[botId];
        const lastAt = State.lastSentAt[botId] || 0;
        if (!last) return true;
        if (text === last && (_now() - lastAt) < (cfg.cooldownMs || CONFIG.DEFAULT_COOLDOWN_MS)) {
            return false;
        }
        return true;
    }

    function _checkRemoteRate(botId) {
        const cfg = State.configs[botId];
        if (!cfg) return Promise.resolve(true);
        return window.QamarFB.get(CONFIG.LOCK_ROOT + '/' + botId + '/stats/lastActive')
            .then(function (remote) {
                if (!remote || typeof remote !== 'number') return true;
                return (_now() - remote) >= (cfg.rateMs || CONFIG.DEFAULT_RATE_MS);
            })
            .catch(function () { return true; });
    }

    /* ══════════════════════════════════════════════ */
    /* botSpeak                                        */
    /* ══════════════════════════════════════════════ */
    function botSpeak(botId, roomId, text, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            const def = BOT_DEFS[botId];
            if (!def) throw new Error('بوت غير معروف: ' + botId);
            if (!roomId) throw new Error('roomId مطلوب');
            if (!text) throw new Error('النص فارغ');

            if (!isBotEnabled(botId) && !options.force) return { skipped: 'disabled' };
            if (!canWriteInRoom(botId, roomId) && !options.force) return { skipped: 'room-not-allowed' };
            if (!_checkLocalRate(botId) && !options.force) return { skipped: 'rate-local' };

            const cleanText = _sanitizeText(text);
            if (!_checkCooldown(botId, cleanText) && !options.force) return { skipped: 'cooldown' };

            return _acquireLock(botId).then(function (ok) {
                if (!ok && !options.force) return { skipped: 'locked' };

                const rateCheck = options.force ? Promise.resolve(true) : _checkRemoteRate(botId);

                return rateCheck.then(function (canSend) {
                    if (!canSend && !options.force) return { skipped: 'rate-remote' };

                    const payload = _buildBotMessage(botId, roomId, cleanText, options);

                    return window.QamarFB.push('room_messages/' + roomId, payload).then(function (msgId) {
                        State.lastSentAt[botId] = _now();
                        State.lastSentText[botId] = cleanText;

                        window.QamarFB.transaction(
                            CONFIG.LOCK_ROOT + '/' + botId + '/stats',
                            function (cur) {
                                cur = cur || {};
                                return {
                                    msgCount: (Number(cur.msgCount) || 0) + 1,
                                    lastActive: _now()
                                };
                            }
                        ).catch(function () {});

                        _emit('bots:spoke', { botId: botId, roomId: roomId, msgId: msgId, text: cleanText });
                        Logger.debug('🤖 Bot spoke:', botId, '→', roomId);
                        return { ok: true, msgId: msgId };
                    });
                });
            }).then(function (r) {
                return _releaseLock(botId).then(function () { return r; });
            });
        });
    }

    function _buildBotMessage(botId, roomId, text, options) {
        const def = BOT_DEFS[botId];
        const avatar = 'https://ui-avatars.com/api/?name=' +
            encodeURIComponent(def.name) +
            '&background=0a0a15&color=' + def.color.replace('#', '') +
            '&bold=true&size=128';

        const payload = {
            senderUid: 'bot_' + botId,
            senderName: def.name,
            senderCode: null,
            senderAvatar: avatar,
            senderColor: def.color,
            senderRank: 'Bot',
            senderRankLevel: 0,
            senderFrame: null,
            senderNameColor: def.color,
            senderNameGradient: null,
            senderNameBgColor: null,
            senderNameBgGradient: null,
            senderCinemaText: null,
            senderCinemaBg: null,
            text: text,
            mentions: [],
            replyTo: null,
            time: window.QamarFB.serverTime(),
            edited: false,
            deleted: false,
            isBot: true,
            botId: botId
        };

        if (options.attachment) payload.attachment = options.attachment;
        if (options.metadata) payload.botMetadata = options.metadata;
        if (options.isSystem) payload.isSystem = true;

        return payload;
    }

    /* ══════════════════════════════════════════════ */
    /* broadcastSystem                                 */
    /* ══════════════════════════════════════════════ */
    function broadcastSystem(kind, target, text, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            const roomId = options.roomId || _getCurrentRoom() || 'general';
            const cleanText = _sanitizeText(text);
            const finalText = cleanText || _buildSystemText(kind, target, options);

            return botSpeak('ambassador', roomId, finalText, {
                force: true,
                isSystem: true,
                metadata: {
                    kind: kind,
                    targetUid: target && target.uid ? target.uid : null,
                    targetName: target && target.name ? target.name : null
                }
            });
        });
    }

    function _buildSystemText(kind, target, options) {
        const name = (target && target.name) ? target.name : '—';
        const by = options.byName || '—';
        const reason = options.reason || '';

        switch (kind) {
            case 'promote': return '🎉 مبروك ' + name + ' — ترقية إلى ' + (options.newRank || 'رتبة جديدة') + ' من ' + by;
            case 'demote':  return '📉 تم تخفيض ' + name + ' إلى ' + (options.newRank || 'رتبة أدنى') + ' من ' + by;
            case 'reward':  return '🎁 أُهدي ' + name + ' ' + (options.amount || 0) + ' نقطة من ' + by;
            case 'punish':  return '⚠️ ' + name + ' — ' + (options.punishment || 'عقوبة') + ' من ' + by + (reason ? ' — السبب: ' + reason : '');
            case 'ban':     return '🚪 تم حظر ' + name + ' من ' + by + (reason ? ' — السبب: ' + reason : '');
            case 'custom':  return options.text || '';
            default:        return options.text || '';
        }
    }

    /* ══════════════════════════════════════════════ */
    /* routeMessage                                    */
    /* ══════════════════════════════════════════════ */
    function routeMessage(msg, roomId) {
        return Promise.resolve().then(function () {
            if (!msg || !msg.text) return { routed: 0 };
            if (msg.isBot) return { routed: 0, reason: 'from-bot' };
            if (msg.senderUid && String(msg.senderUid).indexOf('bot_') === 0) return { routed: 0, reason: 'from-bot' };
            if (msg.hidden === true) return { routed: 0, reason: 'hidden' };

            if (msg.time && typeof msg.time === 'number') {
                if (_now() - msg.time > CONFIG.MESSAGE_MAX_AGE_MS) return { routed: 0, reason: 'too-old' };
            }

            const text = String(msg.text);
            if (text.length > CONFIG.MAX_TEXT_LENGTH) return { routed: 0, reason: 'too-long' };

            if (!roomId) roomId = _getCurrentRoom();

            const payload = { msg: msg, roomId: roomId, text: text };

            _emit('bots:incoming', payload);
            if (window.EventBus) {
                try { window.EventBus.emit('bot:message', payload); } catch (e) {}
            }

            return { routed: 1 };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* EventBus hooks — يقبل الاسمين                  */
    /* ══════════════════════════════════════════════ */
    function _handleBusMessage(payload) {
        if (payload && payload.message) {
            routeMessage(payload.message, payload.roomId).catch(function () {});
            return;
        }
        if (payload && Array.isArray(payload.messages) && payload.messages.length > 0) {
            const last = payload.messages[payload.messages.length - 1];
            if (!last) return;
            const key = (last._id || '') + '|' + (last.time || 0);
            if (State.lastProcessedMsgId === key) return;
            State.lastProcessedMsgId = key;

            routeMessage(last, payload.roomId).catch(function () {});
        }
    }

    function _bindBus() {
        if (!window.EventBus) return;
        window.EventBus.on('chat:message', _handleBusMessage);
        window.EventBus.on('chat:messages', _handleBusMessage);
        Logger.info('📡 Bus hooks: chat:message + chat:messages');
    }

    /* ══════════════════════════════════════════════ */
    /* King: toggle bot                                */
    /* ══════════════════════════════════════════════ */
    function enableBot(botId)  { return _setBotField(botId, 'enabled', true); }
    function disableBot(botId) { return _setBotField(botId, 'enabled', false); }

    function _setBotField(botId, field, value) {
        return Promise.resolve().then(function () {
            if (!_isKing() && _myLevel() < 90) throw new Error('غير مصرّح — الملك أو 90+ فقط');
            if (!BOT_DEFS[botId]) throw new Error('بوت غير معروف: ' + botId);

            const path = CONFIG.CONFIG_ROOT + '/' + botId + '/' + field;
            return window.QamarFB.set(path, value).then(function () {
                if (!State.configs[botId]) State.configs[botId] = {};
                State.configs[botId][field] = value;

                if (window.QamarAudit) {
                    window.QamarAudit.log('toggleBot', {
                        reason: (field === 'enabled'
                            ? (value ? 'تشغيل ' : 'إيقاف ') + BOT_DEFS[botId].name
                            : 'تعديل ' + field + ' لـ ' + BOT_DEFS[botId].name),
                        details: { botId: botId, field: field, value: value }
                    });
                }

                _emit('bots:configChanged', { botId: botId, field: field, value: value });
                Logger.info('⚙️ Bot', botId, field, '→', value);
                return { ok: true, botId: botId, field: field, value: value };
            });
        });
    }

    function setBotRate(botId, rateMs) {
        const v = Number(rateMs);
        if (isNaN(v) || v < 500) return Promise.reject(new Error('قيمة غير صحيحة (الحد الأدنى 500ms)'));
        return _setBotField(botId, 'rateMs', v);
    }

    function setBotCooldown(botId, cooldownMs) {
        const v = Number(cooldownMs);
        if (isNaN(v) || v < 1000) return Promise.reject(new Error('قيمة غير صحيحة (الحد الأدنى 1000ms)'));
        return _setBotField(botId, 'cooldownMs', v);
    }

    function setBotRooms(botId, allowedRooms) {
        if (!Array.isArray(allowedRooms)) return Promise.reject(new Error('يجب أن تكون مصفوفة'));
        return _setBotField(botId, 'allowedRooms', allowedRooms);
    }

    /* ══════════════════════════════════════════════ */
    /* Stats                                           */
    /* ══════════════════════════════════════════════ */
    function getStats() {
        return window.QamarFB.get(CONFIG.LOCK_ROOT).then(function (data) { return data || {}; })
            .catch(function () { return {}; });
    }

    /* ══════════════════════════════════════════════ */
    /* Status / Debug                                  */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        const out = {
            initialized: State.initialized,
            instanceId: State.instanceId,
            isKing: _isKing(),
            myLevel: _myLevel(),
            lastProcessedMsgId: State.lastProcessedMsgId,
            bots: {}
        };
        Object.keys(BOT_DEFS).forEach(function (botId) {
            const cfg = State.configs[botId] || {};
            out.bots[botId] = {
                name: BOT_DEFS[botId].name,
                enabled: cfg.enabled !== false,
                rateMs: cfg.rateMs || BOT_DEFS[botId].defaultRateMs,
                cooldownMs: cfg.cooldownMs || BOT_DEFS[botId].defaultCooldownMs,
                allowedRooms: cfg.allowedRooms || BOT_DEFS[botId].allowedRooms,
                lastSentAgo: State.lastSentAt[botId] ? (_now() - State.lastSentAt[botId]) : null
            };
        });
        return out;
    }

    /* ══════════════════════════════════════════════ */
    /* Boot                                            */
    /* ══════════════════════════════════════════════ */
    // ⭐ FIXED: انتظر auth ثم اقرأ (لا permission_denied)
    function _boot() {
        const waitAuth = function () {
            if (window.QamarAuth && typeof window.QamarAuth.waitForAuth === 'function') {
                return window.QamarAuth.waitForAuth(8000);
            }
            return Promise.resolve();
        };

        waitAuth().then(function () {
            const hasUser = !!(window.auth && window.auth.currentUser);
            if (!hasUser) {
                _applyConfigs({});
                State.initialized = true;
                Logger.info('📦 [bots.js] ready (defaults, no user)');
                return null;
            }
            return initBots();
        }).then(function () {
            _bindBus();
            if (State.initialized) {
                Logger.info('📦 [bots.js] ready');
            }
        }).catch(function (e) {
            Logger.warn('bots boot error:', e.message);
        });
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () { setTimeout(_boot, 800); });
    } else {
        setTimeout(_boot, 3000);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarBots = {
        CONFIG: CONFIG,
        BOT_DEFS: BOT_DEFS,
        init: initBots,
        getBot: getBot,
        getAllBots: getAllBots,
        isBotEnabled: isBotEnabled,
        getBotConfig: getBotConfig,
        canWriteInRoom: canWriteInRoom,
        botSpeak: botSpeak,
        broadcastSystem: broadcastSystem,
        routeMessage: routeMessage,
        enableBot: enableBot,
        disableBot: disableBot,
        setBotRate: setBotRate,
        setBotCooldown: setBotCooldown,
        setBotRooms: setBotRooms,
        getStats: getStats,
        onBotsEvent: onBotsEvent,
        getStatus: getStatus
    };

    Logger.info('📦 [bots.js] v2.2 loaded | bots:', Object.keys(BOT_DEFS).length);
})();
