// ==============================================
// bots/bot-commands.js
// Bot logic: guardian + hakawati + quiz + islamic + musician + ambassador
// ==============================================
// يعتمد على: bots.js + firebase.js + constants.js + state.js + auth.js + ranks.js + audit.js
// يعطي: window.QamarBotCommands
// ==============================================

(function () {
    'use strict';

    if (!window.QamarBots) {
        console.error('❌ [bot-commands] bots.js not loaded!');
        return;
    }

    const LOG_TAG = '[CMD]';
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
        MEM_ROOT: 'bot_memory',
        LOCKS_ROOT: 'bot_locks',
        INBOX_ROOT: 'guardian_inbox',
        USERS_ROOT: 'users',

        HAKAWATI_TRIGGERS: ['حكواتي', 'بووت', 'البووت', 'البوت', 'بوت'],
        AUTO_REPLY_COOLDOWN_MS: 10 * 1000,

        WELCOME_LOCK_TTL_MS: 5 * 60 * 1000,
        WELCOME_COOLDOWN_MS: 5 * 60 * 1000,

        SYSTEM_MSG_INTERVAL_MS: 30 * 60 * 1000,
        SYSTEM_MSG_LOCK_TTL_MS: 31 * 60 * 1000,

        JAILS_BEFORE_BAN: 3,
        PERMANENT_BAN_MS: 365 * 24 * 60 * 60 * 1000,
        AGE_LIMIT_MS: 5 * 60 * 1000,

        QUIZ_INTERVAL_MS: 5 * 60 * 1000,
        QUIZ_WINDOW_MS: 5 * 60 * 1000,
        QUIZ_HINT_MS: 60 * 1000,
        QUIZ_REVEAL_MS: 120 * 1000,
        QUIZ_MAX_WINNERS: 3,
        QUIZ_POINTS: { 1: 10, 2: 5, 3: 2 },

        ISLAMIC_INTERVAL_MS: 2 * 60 * 1000,

        PM_SCAN_INTERVAL_MS: 5 * 60 * 1000,
        PM_ALERT_DEDUP_MS: 10 * 60 * 1000,

        IMMUNE_LEVEL: 90,
        KING_LEVEL: 100,

        BAD_WORD_WHITELIST: [
            'حمار وحشي',
            'كلب الحراسة',
            'يا حمار',
            'أبو كلب',
            'كلب الصيد'
        ]
    };

    /* ══════════════════════════════════════════════ */
    /* Bot profile SVGs                                */
    /* ══════════════════════════════════════════════ */
    const BOT_SVGS = {
        ambassador: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
            '<defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#d4af37"/><stop offset="1" stop-color="#84cc16"/>' +
            '</linearGradient></defs>' +
            '<rect width="100" height="100" rx="22" fill="#0a0a15"/>' +
            '<rect x="22" y="30" width="56" height="50" rx="6" fill="url(#g1)"/>' +
            '<circle cx="78" cy="42" r="4" fill="#0a0a15"/>' +
            '<rect x="28" y="56" width="44" height="3" rx="1.5" fill="#0a0a15" opacity="0.5"/>' +
            '</svg>',

        hakawati: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
            '<defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#9c27b0"/><stop offset="1" stop-color="#d4af37"/>' +
            '</linearGradient></defs>' +
            '<rect width="100" height="100" rx="22" fill="#0a0a15"/>' +
            '<path d="M20 32 Q20 26 26 26 L48 26 L48 76 L26 76 Q20 76 20 70 Z" fill="url(#g2)"/>' +
            '<path d="M80 32 Q80 26 74 26 L52 26 L52 76 L74 76 Q80 76 80 70 Z" fill="url(#g2)"/>' +
            '<line x1="50" y1="26" x2="50" y2="76" stroke="#d4af37" stroke-width="1.5"/>' +
            '<line x1="28" y1="38" x2="42" y2="38" stroke="#0a0a15" stroke-width="1.5" opacity="0.6"/>' +
            '<line x1="28" y1="46" x2="42" y2="46" stroke="#0a0a15" stroke-width="1.5" opacity="0.6"/>' +
            '<line x1="58" y1="38" x2="72" y2="38" stroke="#0a0a15" stroke-width="1.5" opacity="0.6"/>' +
            '<line x1="58" y1="46" x2="72" y2="46" stroke="#0a0a15" stroke-width="1.5" opacity="0.6"/>' +
            '</svg>',

        quiz: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
            '<defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#ff9800"/><stop offset="1" stop-color="#ffd700"/>' +
            '</linearGradient></defs>' +
            '<rect width="100" height="100" rx="22" fill="#0a0a15"/>' +
            '<circle cx="50" cy="50" r="30" fill="none" stroke="url(#g3)" stroke-width="4"/>' +
            '<circle cx="50" cy="50" r="20" fill="none" stroke="url(#g3)" stroke-width="3"/>' +
            '<circle cx="50" cy="50" r="10" fill="none" stroke="url(#g3)" stroke-width="2"/>' +
            '<circle cx="50" cy="50" r="4" fill="#ff9800"/>' +
            '</svg>',

        guardian: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
            '<defs><linearGradient id="g4" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#ff4444"/><stop offset="1" stop-color="#8b0000"/>' +
            '</linearGradient></defs>' +
            '<rect width="100" height="100" rx="22" fill="#0a0a15"/>' +
            '<path d="M50 20 L74 30 L74 56 Q74 72 50 82 Q26 72 26 56 L26 30 Z" fill="url(#g4)"/>' +
            '<path d="M50 28 L68 35 L68 56 Q68 68 50 76 Q32 68 32 56 L32 35 Z" fill="#0a0a15" opacity="0.4"/>' +
            '<path d="M40 52 L48 60 L62 42" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>',

        islamic: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
            '<defs><radialGradient id="g5" cx="0.35" cy="0.35">' +
            '<stop offset="0" stop-color="#fffef0"/>' +
            '<stop offset="0.4" stop-color="#ffd700"/>' +
            '<stop offset="1" stop-color="#b8860b"/>' +
            '</radialGradient></defs>' +
            '<rect width="100" height="100" rx="22" fill="#0a0a15"/>' +
            '<path d="M 62 22 A 28 28 0 1 0 62 78 A 22 22 0 1 1 62 22 Z" fill="url(#g5)"/>' +
            '<circle cx="32" cy="32" r="1.5" fill="#ffd700"/>' +
            '<circle cx="28" cy="60" r="1.2" fill="#ffd700"/>' +
            '<circle cx="36" cy="72" r="1" fill="#ffd700"/>' +
            '</svg>',

        musician: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
            '<defs><linearGradient id="g6" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#a855f7"/><stop offset="1" stop-color="#d4af37"/>' +
            '</linearGradient></defs>' +
            '<rect width="100" height="100" rx="22" fill="#0a0a15"/>' +
            '<circle cx="38" cy="66" r="10" fill="url(#g6)"/>' +
            '<circle cx="66" cy="60" r="10" fill="url(#g6)"/>' +
            '<rect x="45" y="30" width="3" height="42" fill="url(#g6)"/>' +
            '<rect x="73" y="24" width="3" height="42" fill="url(#g6)"/>' +
            '<rect x="45" y="24" width="31" height="8" fill="url(#g6)"/>' +
            '</svg>'
    };

    /* ══════════════════════════════════════════════ */
    /* System messages (30 min)                        */
    /* ══════════════════════════════════════════════ */
    const SYSTEM_MESSAGES = [
        // 🤝 احترام
        { cat: 'respect', text: 'احترم أخاك كما تحب أن تُحترم' },
        { cat: 'respect', text: 'الكلمة الطيبة صدقة، فلا تبخل بها' },
        { cat: 'respect', text: 'احترام الآخرين ليس ضعفاً بل قوة' },
        // 🎯 مشاركة
        { cat: 'engage', text: 'شاركنا رأيك، فوجودك يُثري المكان' },
        { cat: 'engage', text: 'كل مشاركة تُضيف للحوار قيمة' },
        { cat: 'engage', text: 'لا تتردد في الكتابة، هذا بيتك الثاني' },
        // 🌙 ترحيب جماعي (يُبدَّل {room})
        { cat: 'welcome', text: 'أهلاً وسهلاً بكل من في {room}' },
        { cat: 'welcome', text: 'نوّرتوا {room}، يا أهلاً وسهلاً' },
        { cat: 'welcome', text: 'مرحباً بالجميع في {room}' },
        // 🤍 صلاة
        { cat: 'salah', text: 'اللهم صلِّ وسلِّم على نبينا محمد' },
        { cat: 'salah', text: 'اللهم صلِّ على محمد وعلى آل محمد' },
        { cat: 'salah', text: 'صلى الله عليه وسلم تسليماً كثيراً' },
        // 📜 حكمة
        { cat: 'wisdom', text: 'قيمة المرء ما يُحسنه' },
        { cat: 'wisdom', text: 'خير الكلام ما قلّ ودلّ' },
        { cat: 'wisdom', text: 'من صبر، ظفر' },
        // 📌 قواعد
        { cat: 'rules', text: 'التجريح والإساءة يُعاقبان في هذا المكان' },
        { cat: 'rules', text: 'احترم قوانين الروم، فهي لحماية الجميع' },
        { cat: 'rules', text: 'الروم للجميع، فشارك بلطف' }
    ];

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        badWords: [],
        kickWords: [],
        hakawati: {},
        hakawatiAuto: {},
        quiz: [],
        islamic: [],
        currentQuiz: null,
        autoReplyCooldown: {},
        processedMsgs: new Set(),
        pmAlertDedup: {},
        intervalTimers: [],
        forcedListener: null,
        pmHookInstalled: false,
        listeners: [],
        botProfilesReady: false,
        lastRoom: null,
        _initialized: false
    };

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
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        const u = _getCurrentUser();
        return u ? Number(u.rankLevel) || 0 : 0;
    }

    function _isKing() {
        return _myLevel() >= CONFIG.KING_LEVEL;
    }

    function _isGuest() {
        if (window.QamarAuth && window.QamarAuth.isGuest) return window.QamarAuth.isGuest();
        return false;
    }

    function _getCurrentRoom() {
        if (window.AppState && window.AppState.currentRoom) return window.AppState.currentRoom;
        try { return localStorage.getItem('qamar_last_room') || 'general'; } catch (e) { return 'general'; }
    }

    function _getRoomName(roomId) {
        if (window.QAMAR && window.QAMAR.ROOMS && window.QAMAR.ROOMS[roomId]) {
            return window.QAMAR.ROOMS[roomId].name || roomId;
        }
        return roomId;
    }

    function _toArray(val) {
        if (!val) return [];
        if (Array.isArray(val)) return val.filter(Boolean);
        if (typeof val === 'object') return Object.values(val).filter(Boolean);
        return [];
    }

    function _esc(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function _now() { return Date.now(); }

    /* ══════════════════════════════════════════════ */
    /* Normalize + Match                               */
    /* ══════════════════════════════════════════════ */
    function _normalize(text) {
        if (!text) return '';
        let s = String(text).toLowerCase().trim();
        if (window.QAMAR && window.QAMAR.ARABIC_EQUIVALENTS) {
            Object.keys(window.QAMAR.ARABIC_EQUIVALENTS).forEach(function (alt) {
                s = s.split(alt).join(window.QAMAR.ARABIC_EQUIVALENTS[alt]);
            });
        }
        s = s.replace(/\u0640/g, '')
             .replace(/[أإآٱا]/g, 'ا')
             .replace(/[يىئ]/g, 'ي')
             .replace(/ة/g, 'ه')
             .replace(/[\u064B-\u065F\u0670]/g, '')
             .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
             .replace(/(.)\1{1,}/g, '$1')
             .replace(/\s+/g, ' ');
        return s;
    }

    function _isWhitelisted(text) {
        const n = _normalize(text);
        for (let i = 0; i < CONFIG.BAD_WORD_WHITELIST.length; i++) {
            if (n.indexOf(_normalize(CONFIG.BAD_WORD_WHITELIST[i])) !== -1) return true;
        }
        return false;
    }

    function _buildSeparatedRegex(word) {
        const chars = String(word).split('');
        const pattern = chars.map(function (ch) {
            return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('[\\s.\\-_*·+•]{1,2}');
        return new RegExp(pattern, 'i');
    }

    function _matchWord(text, list) {
        if (!text || !list || !list.length) return null;
        if (_isWhitelisted(text)) return null;

        const normalized = _normalize(text);
        const collapsed = String(text).toLowerCase().replace(/\u0640/g, '').replace(/(.)\1{1,}/g, '$1');

        for (let i = 0; i < list.length; i++) {
            const raw = list[i];
            const w = _normalize(raw);
            if (!w || w.length < 2) continue;
            if (normalized.indexOf(w) !== -1) return raw;
            if (collapsed.indexOf(w) !== -1) return raw;
            if (w.length >= 3) {
                try { if (_buildSeparatedRegex(w).test(normalized)) return raw; } catch (e) {}
            }
        }
        return null;
    }

    function _maskWord(w) {
        if (!w) return '***';
        const s = String(w);
        if (s.length <= 2) return s[0] + '*';
        return s[0] + '*'.repeat(Math.min(s.length - 2, 5)) + s[s.length - 1];
    }

    function _simpleHash(str) {
        let h = 5381;
        const s = String(str);
        for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    /* ══════════════════════════════════════════════ */
    /* Bot profiles (King only)                        */
    /* ══════════════════════════════════════════════ */
    function ensureBotProfiles() {
        if (State.botProfilesReady) return Promise.resolve(true);
        if (!_isKing()) return Promise.resolve(false);

        const defs = window.QamarBots.BOT_DEFS;
        const promises = Object.keys(defs).map(function (botId) {
            const def = defs[botId];
            const botUid = 'bot_' + botId;
            return window.QamarFB.get(CONFIG.USERS_ROOT + '/' + botUid).then(function (existing) {
                if (existing) return null; // موجود
                const svg = BOT_SVGS[botId] || BOT_SVGS.guardian;
                const avatar = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
                const payload = {
                    uid: botUid,
                    name: def.name,
                    code: 'BOT·' + botId.substring(0, 3).toUpperCase(),
                    avatar: avatar,
                    color: def.color,
                    bio: def.description,
                    rank: 'Bot',
                    rankLevel: 0,
                    isBot: true,
                    botId: botId,
                    isGuest: false,
                    createdAt: window.QamarFB.serverTime(),
                    lastSeen: window.QamarFB.serverTime()
                };
                return window.QamarFB.set(CONFIG.USERS_ROOT + '/' + botUid, payload);
            }).catch(function (e) {
                Logger.warn('ensureBotProfile ' + botId + ':', e.message);
                return null;
            });
        });

        return Promise.all(promises).then(function () {
            State.botProfilesReady = true;
            Logger.info('✅ Bot profiles ensured (6 bots)');
            return true;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onCmdEvent(cb) {
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
    /* Memory                                          */
    /* ══════════════════════════════════════════════ */
    function loadMemory() {
        return Promise.all([
            window.QamarFB.get(CONFIG.MEM_ROOT + '/badWords').catch(function () { return null; }),
            window.QamarFB.get(CONFIG.MEM_ROOT + '/kickWords').catch(function () { return null; }),
            window.QamarFB.get(CONFIG.MEM_ROOT + '/hakawati').catch(function () { return null; }),
            window.QamarFB.get(CONFIG.MEM_ROOT + '/hakawati_auto').catch(function () { return null; }),
            window.QamarFB.get(CONFIG.MEM_ROOT + '/quiz').catch(function () { return null; }),
            window.QamarFB.get(CONFIG.MEM_ROOT + '/islamic').catch(function () { return null; })
        ]).then(function (r) {
            State.badWords = _toArray(r[0]).map(function (x) { return typeof x === 'string' ? x : (x.text || ''); }).filter(Boolean);
            State.kickWords = _toArray(r[1]).map(function (x) { return typeof x === 'string' ? x : (x.text || ''); }).filter(Boolean);
            State.hakawati = r[2] || {};
            State.hakawatiAuto = r[3] || {};
            State.quiz = _toArray(r[4]);
            State.islamic = _toArray(r[5]).map(function (x) { return typeof x === 'string' ? x : (x.text || ''); }).filter(Boolean);
            Logger.info('📚 Memory | bad:', State.badWords.length, '| kick:', State.kickWords.length, '| quiz:', State.quiz.length);
            _emit('bot-commands:memoryLoaded', getStatus());
        });
    }

    function reloadMemory() {
        return loadMemory().then(function () { return { ok: true }; });
    }

    /* ══════════════════════════════════════════════ */
    /* Immunity + King check                           */
    /* ══════════════════════════════════════════════ */
    function _isImmune(uid) {
        if (!uid) return Promise.resolve(false);
        return window.QamarFB.get('users/' + uid + '/rankLevel').then(function (lvl) {
            return (Number(lvl) || 0) >= CONFIG.IMMUNE_LEVEL;
        }).catch(function () { return false; });
    }

    function _isKingUser(uid) {
        if (!uid) return Promise.resolve(false);
        return window.QamarFB.get('users/' + uid + '/rankLevel').then(function (lvl) {
            return (Number(lvl) || 0) >= CONFIG.KING_LEVEL;
        }).catch(function () { return false; });
    }

    /* ══════════════════════════════════════════════ */
    /* ═══════ GUARDIAN (rooms) ═══════                */
    /* ══════════════════════════════════════════════ */
    function _handleKickWord(msg, kickWord, roomId) {
        const uid = msg.senderUid;
        if (!uid) return Promise.resolve();

        return _isImmune(uid).then(function (immune) {
            if (immune) return null;

            return _hideMessage(msg, roomId, 'kick_word:' + kickWord).then(function () {
                return window.QamarFB.get('users/' + uid).then(function (u) {
                    u = u || {};
                    const now = _now();
                    const updates = {};
                    updates['users/' + uid + '/isBanned'] = true;
                    updates['users/' + uid + '/permanentBan'] = true;
                    updates['users/' + uid + '/bannedUntil'] = now + CONFIG.PERMANENT_BAN_MS;
                    updates['users/' + uid + '/banReason'] = 'كلمة طرد: ' + _maskWord(kickWord);
                    updates['users/' + uid + '/bannedBy'] = 'bot_guardian';
                    updates['users/' + uid + '/bannedByName'] = 'السجان';
                    updates['users/' + uid + '/bannedAt'] = window.QamarFB.serverTime();
                    updates['users/' + uid + '/kickCount'] = (Number(u.kickCount) || 0) + 1;

                    return window.QamarFB.multiUpdate(updates).then(function () {
                        _tryBanDevice(uid).catch(function () {});
                        const text = '🚪 السجان طرد ' + (msg.senderName || '—') + ' نهائياً!\n' +
                                     '❌ كلمة محظورة: ' + _maskWord(kickWord) + '\n' +
                                     '⏰ الحظر: دائم + بصمة الجهاز';
                        return window.QamarBots.botSpeak('guardian', roomId, text, { force: true });
                    });
                });
            });
        }).then(function () {
            if (window.QamarAudit) {
                window.QamarAudit.log('banPerm', {
                    targetUid: uid, targetName: msg.senderName,
                    reason: 'كلمة طرد: ' + _maskWord(kickWord)
                });
            }
        }).catch(function (e) { Logger.warn('handleKickWord:', e.message); });
    }

    function _handleBadWord(msg, badWord, roomId) {
        const uid = msg.senderUid;
        if (!uid) return Promise.resolve();

        return _isImmune(uid).then(function (immune) {
            if (immune) return null;

            return _hideMessage(msg, roomId, 'bad_word:' + badWord).then(function () {
                return window.QamarFB.get('users/' + uid).then(function (u) {
                    u = u || {};
                    const now = _now();
                    const warnCount = (Number(u.warnings) || 0) + 1;
                    let jailCount = Number(u.jailCount) || 0;
                    const lastJailAt = Number(u.lastJailAt) || 0;
                    const JAIL = (window.QAMAR && window.QAMAR.JAIL) || {
                        FIRST_OFFENSE_MS: 2 * 60 * 1000,
                        ESCALATION_WINDOW_MS: 10 * 60 * 1000,
                        MAX_AUTO_JAIL_MS: 15 * 60 * 1000,
                        ESCALATION_MULTIPLIER: 2
                    };

                    if (jailCount >= CONFIG.JAILS_BEFORE_BAN) {
                        const updates = {};
                        updates['users/' + uid + '/isBanned'] = true;
                        updates['users/' + uid + '/permanentBan'] = true;
                        updates['users/' + uid + '/bannedUntil'] = now + CONFIG.PERMANENT_BAN_MS;
                        updates['users/' + uid + '/banReason'] = '3 سجنات متكررة';
                        updates['users/' + uid + '/bannedBy'] = 'bot_guardian';
                        updates['users/' + uid + '/bannedByName'] = 'السجان';
                        updates['users/' + uid + '/bannedAt'] = window.QamarFB.serverTime();
                        return window.QamarFB.multiUpdate(updates).then(function () {
                            _tryBanDevice(uid).catch(function () {});
                            return window.QamarBots.botSpeak('guardian', roomId,
                                '🚫 السجان حظر ' + (msg.senderName || '—') + ' نهائياً!\n⚠️ بعد 3 سجنات متكررة', { force: true });
                        });
                    }

                    const withinWindow = (now - lastJailAt) < JAIL.ESCALATION_WINDOW_MS;
                    let duration = withinWindow && jailCount > 0
                        ? JAIL.FIRST_OFFENSE_MS * Math.pow(JAIL.ESCALATION_MULTIPLIER, jailCount)
                        : JAIL.FIRST_OFFENSE_MS;
                    duration = Math.min(duration, JAIL.MAX_AUTO_JAIL_MS);
                    if (!withinWindow) jailCount = 0;

                    const newJailCount = jailCount + 1;
                    const jailUntil = now + duration;
                    const minutes = Math.ceil(duration / 60000);
                    const remaining = CONFIG.JAILS_BEFORE_BAN - newJailCount;

                    const updates = {};
                    updates['users/' + uid + '/isJailed'] = true;
                    updates['users/' + uid + '/jailUntil'] = jailUntil;
                    updates['users/' + uid + '/jailCount'] = newJailCount;
                    updates['users/' + uid + '/jailReason'] = 'كلمة ممنوعة: ' + _maskWord(badWord);
                    updates['users/' + uid + '/lastJailAt'] = now;
                    updates['users/' + uid + '/warnings'] = warnCount;

                    const curRoom = roomId || _getCurrentRoom();
                    if (curRoom && curRoom !== 'jail') {
                        updates['users/' + uid + '/lastRoomBeforeJail'] = curRoom;
                    }

                    updates['user_presence/' + uid + '/state'] = 'online';
                    updates['user_presence/' + uid + '/room'] = 'jail';
                    updates['user_presence/' + uid + '/forced'] = true;
                    updates['user_presence/' + uid + '/lastChanged'] = now;
                    updates['user_presence/' + uid + '/forcedReason'] = 'jail';

                    return window.QamarFB.multiUpdate(updates).then(function () {
                        _scheduleJailRelease(uid, duration);

                        const warnLine = remaining > 0
                            ? '⚠️ تبقّى ' + remaining + ' سجن قبل الطرد'
                            : '🚨 هذا آخر تحذير قبل الطرد الدائم!';
                        const text = '🚔 السجان قبض على ' + (msg.senderName || '—') + '\n' +
                                     '❌ كلمة ممنوعة: ' + _maskWord(badWord) + '\n' +
                                     '⚠️ التحذير رقم: ' + warnCount + '\n' +
                                     '⛓️ السجن: ' + minutes + ' دقيقة\n' +
                                     '🚪 تم نقله إلى السجن\n' + warnLine;
                        return window.QamarBots.botSpeak('guardian', roomId, text, { force: true });
                    }).then(function () {
                        if (window.QamarAudit) {
                            window.QamarAudit.log('jail', {
                                targetUid: uid, targetName: msg.senderName,
                                reason: 'كلمة ممنوعة',
                                duration: duration
                            });
                        }
                    });
                });
            });
        }).catch(function (e) { Logger.warn('handleBadWord:', e.message); });
    }

    function _scheduleJailRelease(uid, duration) {
        if (duration > 30 * 60 * 1000) return;
        setTimeout(function () {
            window.QamarFB.get('users/' + uid).then(function (u) {
                if (!u || !u.isJailed) return;
                const until = Number(u.jailUntil) || 0;
                if (_now() < until) return;
                const updates = {};
                updates['users/' + uid + '/isJailed'] = false;
                updates['users/' + uid + '/jailUntil'] = 0;
                updates['users/' + uid + '/jailReleasedAt'] = _now();

                const lastRoom = u.lastRoomBeforeJail || 'general';
                updates['user_presence/' + uid + '/room'] = lastRoom;
                updates['user_presence/' + uid + '/forced'] = true;
                updates['user_presence/' + uid + '/lastChanged'] = _now();
                updates['user_presence/' + uid + '/forcedReason'] = 'jail_release';
                updates['users/' + uid + '/lastRoomBeforeJail'] = null;

                window.QamarFB.multiUpdate(updates).then(function () {
                    if (u.name) {
                        window.QamarBots.botSpeak('guardian', 'general',
                            '🔓 ' + u.name + ' خرج من السجن', { force: true });
                    }
                }).catch(function () {});
            }).catch(function () {});
        }, Math.min(duration + 2000, 30 * 60 * 1000));
    }

    function _hideMessage(msg, roomId, reason) {
        const msgId = msg._id || msg._fbKey;
        if (!msgId || !roomId) return Promise.resolve();
        const updates = {};
        updates['room_messages/' + roomId + '/' + msgId + '/hidden'] = true;
        updates['room_messages/' + roomId + '/' + msgId + '/hiddenBy'] = 'bot_guardian';
        updates['room_messages/' + roomId + '/' + msgId + '/hiddenAt'] = window.QamarFB.serverTime();
        updates['room_messages/' + roomId + '/' + msgId + '/hiddenReason'] = reason || 'auto';
        return window.QamarFB.multiUpdate(updates).catch(function () {});
    }

    function _tryBanDevice(uid) {
        return window.QamarFB.get('users/' + uid + '/devices').then(function (devices) {
            if (!devices) return;
            const updates = {};
            const now = _now();
            Object.keys(devices).forEach(function (deviceId) {
                updates['banned_devices/' + deviceId] = {
                    uid: uid,
                    reason: 'حظر دائم من السجان',
                    by: 'bot_guardian',
                    byName: 'السجان',
                    at: now,
                    auto: true
                };
            });
            if (Object.keys(updates).length === 0) return;
            return window.QamarFB.multiUpdate(updates);
        }).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* ═══════ GUARDIAN (PM — notify only) ═══════    */
    /* ══════════════════════════════════════════════ */
    function _installPmHooks() {
        if (State.pmHookInstalled) return;
        if (!window.QamarPM) return;

        State.pmHookInstalled = true;

        if (typeof window.QamarPM.send === 'function') {
            const _origSend = window.QamarPM.send;
            window.QamarPM.send = function (toUid, text, options) {
                if (text && (State.kickWords.length + State.badWords.length > 0)) {
                    _checkPmViolation(toUid, text, 'send').catch(function () {});
                }
                return _origSend.call(this, toUid, text, options);
            };
        }

        if (window.EventBus) {
            window.EventBus.on('pm:messages', function (payload) {
                if (!payload || !payload.otherUid || !Array.isArray(payload.messages)) return;
                payload.messages.slice(-5).forEach(function (m) {
                    if (!m || !m.text) return;
                    if (m.fromUid === _getCurrentUid()) return;
                    _checkPmViolation(m.fromUid, m.text, 'receive', payload.otherUid).catch(function () {});
                });
            });
        }
    }

    function _checkPmViolation(otherUid, text, side, conversationWith) {
        return Promise.resolve().then(function () {
            const me = _getCurrentUid();
            if (!me) return;

            const kick = _matchWord(text, State.kickWords);
            const bad = kick ? null : _matchWord(text, State.badWords);
            const matched = kick || bad;
            if (!matched) return;

            const hash = _simpleHash(me + '|' + otherUid + '|' + matched + '|' + text.substring(0, 40));
            const last = State.pmAlertDedup[hash];
            if (last && (_now() - last) < CONFIG.PM_ALERT_DEDUP_MS) return;
            State.pmAlertDedup[hash] = _now();

            const senderUid = (side === 'receive') ? otherUid : me;
            const recipientUid = (side === 'receive') ? me : otherUid;

            Promise.all([
                window.QamarFB.get('users/' + senderUid).catch(function () { return null; }),
                window.QamarFB.get('users/' + recipientUid).catch(function () { return null; })
            ]).then(function (r) {
                const sender = r[0] || {};
                const recipient = r[1] || {};

                _sendGuardianInbox({
                    type: 'pm_violation',
                    severity: kick ? 'kick' : 'jail',
                    suspectUid: senderUid,
                    suspectName: sender.name || '—',
                    suspectAvatar: sender.avatar || null,
                    victimUid: recipientUid,
                    victimName: recipient.name || '—',
                    matchedWord: _maskWord(matched),
                    messagePreview: String(text).substring(0, 120),
                    side: side
                });
            }).catch(function () {});
        }).catch(function (e) { Logger.warn('checkPmViolation:', e.message); });
    }

    function _sendGuardianInbox(alert) {
        return window.QamarFB.get('config/king_uid').then(function (kingUid) {
            if (!kingUid) return;
            const rid = 'ga_' + _now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
            const payload = Object.assign({
                from: 'bot_guardian',
                fromName: 'السجان',
                at: window.QamarFB.serverTime(),
                read: false
            }, alert);

            const sevIcon = alert.severity === 'kick' ? '🚪' : '⚠️';
            payload.text = sevIcon + ' رسالة خاصة مريبة\n' +
                           '👤 المُخالف: ' + (alert.suspectName || '—') + '\n' +
                           '👤 الضحية: ' + (alert.victimName || '—') + '\n' +
                           '📝 كلمة: ' + (alert.matchedWord || '—') + '\n' +
                           '💬 ' + (alert.messagePreview || '—').substring(0, 80) + '\n' +
                           '🕐 ' + new Date().toLocaleString('ar-EG');

            return window.QamarFB.set(CONFIG.INBOX_ROOT + '/' + kingUid + '/' + rid, payload)
                .then(function () {
                    _emit('guardian:inbox', { alert: payload });
                    Logger.info('📬 Guardian inbox alert:', alert.type);
                });
        }).catch(function (e) { Logger.warn('sendGuardianInbox:', e.message); });
    }

    /* ══════════════════════════════════════════════ */
    /* ═══════ HAKAWATI ═══════                       */
    /* ══════════════════════════════════════════════ */
    function _hasHakawatiTrigger(text) {
        if (!text) return false;
        for (let i = 0; i < CONFIG.HAKAWATI_TRIGGERS.length; i++) {
            if (text.indexOf(CONFIG.HAKAWATI_TRIGGERS[i]) !== -1) return true;
        }
        return false;
    }

    function _stripHakawatiTriggers(text) {
        let t = String(text);
        CONFIG.HAKAWATI_TRIGGERS.forEach(function (tr) {
            t = t.split(tr).join(' ');
        });
        return t.replace(/\s+/g, ' ').trim();
    }

    function _findHakawatiReply(question) {
        if (!question) return null;
        const merged = Object.assign({}, State.hakawati);
        const text = _normalize(question);
        if (!text) return null;
        let best = null, bestLen = 0;
        Object.keys(merged).forEach(function (k) {
            const key = _normalize(k);
            if (key && text.indexOf(key) !== -1 && key.length > bestLen) {
                const v = merged[k];
                best = (typeof v === 'string') ? v : (v.text || '');
                bestLen = key.length;
            }
        });
        return best;
    }

    function _findAutoReply(text) {
        if (!text) return null;
        const keys = Object.keys(State.hakawatiAuto);
        if (!keys.length) return null;
        const n = _normalize(text);
        let best = null, bestIdx = Infinity, bestLen = 0, bestKey = '';
        keys.forEach(function (k) {
            const key = _normalize(k);
            if (!key) return;
            const idx = n.indexOf(key);
            if (idx === -1) return;
            if (idx < bestIdx || (idx === bestIdx && key.length > bestLen)) {
                const v = State.hakawatiAuto[k];
                best = (typeof v === 'string') ? v : (v.text || '');
                bestIdx = idx;
                bestLen = key.length;
                bestKey = k;
            }
        });
        return best ? { reply: best, key: bestKey } : null;
    }

    function _handleHakawati(msg, roomId) {
        const text = String(msg.text || '');
        const uid = msg.senderUid;

        // trigger → يرد حتى على الملك
        if (_hasHakawatiTrigger(text)) {
            const q = _stripHakawatiTriggers(text);
            if (!q) return;
            const reply = _findHakawatiReply(q);
            if (reply) {
                setTimeout(function () {
                    window.QamarBots.botSpeak('hakawati', roomId, '📖 ' + reply, { force: true });
                }, 900);
            }
            return;
        }

        // auto-reply → يستثني الملك (شبحية)
        if (_isKing()) return;

        const auto = _findAutoReply(text);
        if (!auto) return;

        const cooldownKey = uid + '::' + auto.key;
        const last = State.autoReplyCooldown[cooldownKey];
        if (last && (_now() - last) < CONFIG.AUTO_REPLY_COOLDOWN_MS) return;
        State.autoReplyCooldown[cooldownKey] = _now();

        setTimeout(function () {
            window.QamarBots.botSpeak('hakawati', roomId, '📖 ' + auto.reply, { force: true });
        }, 700);
    }

    /* ══════════════════════════════════════════════ */
    /* ═══════ QUIZ ═══════                           */
    /* ══════════════════════════════════════════════ */
    function _buildHint(answer) {
        if (!answer) return '؟؟؟';
        const s = String(answer);
        let out = '';
        for (let i = 0; i < s.length; i++) {
            const ch = s.charAt(i);
            if (ch === ' ') { out += ' '; continue; }
            out += (i % 2 === 0) ? ch : '--';
        }
        return out;
    }

    function _postQuiz() {
        const list = State.quiz.length > 0 ? State.quiz : [];
        if (!list.length) return;
        const q = list[Math.floor(Math.random() * list.length)];
        const answersArr = _toArray(q.answers).map(function (x) { return String(x); });
        if (!answersArr.length) return;

        const startedAt = _now();
        const text = '🎯 سؤال جديد!\n\n' + (q.q || '—') + '\n\n⏳ أول 3 إجابات صحيحة: 10 / 5 / 2 نقطة';

        window.QamarFB.set(CONFIG.LOCKS_ROOT + '/quiz_current', {
            question: q.q || '',
            answers: answersArr,
            startedAt: startedAt,
            winnersCount: 0,
            winners: {},
            hintPosted: false,
            closed: false
        }).then(function () {
            window.QamarBots.botSpeak('quiz', 'quiz', text, { force: true });

            setTimeout(function () {
                window.QamarFB.get(CONFIG.LOCKS_ROOT + '/quiz_current').then(function (c) {
                    if (!c || c.startedAt !== startedAt || c.closed) return;
                    if ((c.winnersCount || 0) === 0) {
                        window.QamarBots.botSpeak('quiz', 'quiz', '💡 ' + _buildHint(answersArr[0]), { force: true });
                        window.QamarFB.update(CONFIG.LOCKS_ROOT + '/quiz_current', { hintPosted: true }).catch(function () {});
                    }
                    setTimeout(function () {
                        window.QamarFB.get(CONFIG.LOCKS_ROOT + '/quiz_current').then(function (c2) {
                            if (!c2 || c2.startedAt !== startedAt || c2.closed) return;
                            window.QamarBots.botSpeak('quiz', 'quiz', '💡 الإجابة: ' + answersArr[0], { force: true });
                            window.QamarFB.update(CONFIG.LOCKS_ROOT + '/quiz_current', { closed: true }).catch(function () {});
                            setTimeout(function () {
                                window.QamarFB.remove(CONFIG.LOCKS_ROOT + '/quiz_current').catch(function () {});
                            }, 5000);
                        }).catch(function () {});
                    }, CONFIG.QUIZ_REVEAL_MS - CONFIG.QUIZ_HINT_MS);
                }).catch(function () {});
            }, CONFIG.QUIZ_HINT_MS);
        }).catch(function (e) { Logger.warn('postQuiz:', e.message); });
    }

    function _checkQuizAnswer(msg, roomId) {
        if (roomId !== 'quiz') return;
        const text = String(msg.text || '').trim();
        if (!text) return;

        // الملك لا يحتسب
        if (_isKing()) return;

        window.QamarFB.get(CONFIG.LOCKS_ROOT + '/quiz_current').then(function (qz) {
            if (!qz || qz.closed) return;
            if (_now() - (qz.startedAt || 0) > CONFIG.QUIZ_WINDOW_MS) return;

            const answers = _toArray(qz.answers).map(String);
            const ua = _normalize(text);
            const isMatch = answers.some(function (a) { return ua === _normalize(a); });
            if (!isMatch) return;

            window.QamarFB.transaction(CONFIG.LOCKS_ROOT + '/quiz_current/winnersCount', function (c) {
                const n = (c || 0);
                if (n >= CONFIG.QUIZ_MAX_WINNERS) return;
                return n + 1;
            }).then(function (r) {
                if (!r || !r.committed) return;
                const rank = r.snapshot;
                const points = CONFIG.QUIZ_POINTS[rank] || 0;
                const updates = {};
                updates[CONFIG.LOCKS_ROOT + '/quiz_current/winners/' + msg.senderUid] = {
                    rank: rank, name: msg.senderName, at: _now(), points: points
                };
                window.QamarFB.multiUpdate(updates).catch(function () {});

                window.QamarFB.transaction('bot_data/quiz/scores/' + msg.senderUid, function (c) {
                    return (c || 0) + points;
                }).catch(function () {});

                const emoji = rank === 1 ? '🥇' : (rank === 2 ? '🥈' : '🥉');
                window.QamarBots.botSpeak('quiz', 'quiz', emoji + ' ' + (msg.senderName || '—') + ' — +' + points + ' نقطة', { force: true });
            }).catch(function () {});
        }).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* ═══════ ISLAMIC (periodic) ═══════              */
    /* ══════════════════════════════════════════════ */
    function _postIslamic() {
        const lib = (window.ISLAMIC_LIBRARY && window.ISLAMIC_LIBRARY.length) ? window.ISLAMIC_LIBRARY : [];
        const all = lib.length ? lib : State.islamic;
        if (!all.length) return;
        const lastKey = 'qamar_last_islamic';
        const last = localStorage.getItem(lastKey) || '';
        let pick = '';
        for (let i = 0; i < 5; i++) {
            pick = all[Math.floor(Math.random() * all.length)];
            if (pick !== last) break;
        }
        try { localStorage.setItem(lastKey, pick); } catch (e) {}
        window.QamarBots.botSpeak('islamic', 'islamic', pick, { force: true });
    }

    /* ══════════════════════════════════════════════ */
    /* ═══════ MUSICIAN ═══════                       */
    /* ══════════════════════════════════════════════ */
    function _musicianWelcome(uid, roomId) {
        if (roomId !== 'studio') return;
        const now = _now();
        const key = CONFIG.LOCKS_ROOT + '/welcome_musician/' + roomId + '/' + uid;
        window.QamarFB.transaction(key, function (c) {
            if (c && (now - (c.at || 0)) < CONFIG.WELCOME_COOLDOWN_MS) return;
            return { at: now };
        }).then(function (r) {
            if (!r || !r.committed) return;
            window.QamarFB.get('users/' + uid).then(function (u) {
                if (!u) return;
                if ((Number(u.rankLevel) || 0) >= CONFIG.IMMUNE_LEVEL) return; // شبحية
                const name = u.name || '—';
                const text = '🎵 أهلاً ' + name + ' في استوديو قمر الشام!\n\n' +
                             'أنا موسيقار الشام 🎼 — رفيقك هنا.\n\n' +
                             '🔒 الاستوديو آمن ومخصّص لك وحدك — صوتك لا يخرج من جهازك.\n' +
                             '🎛️ 6 مؤثرات جاهزة: Bass · Mid · Treble · Echo · Reverb · Volume\n' +
                             '🎙️ اضغط الزر الأحمر الكبير للتسجيل (5 دقائق كحد أقصى).\n\n' +
                             '📌 كل زر له شرح مختصر — مرّ عليه وستفهم دوره.';
                window.QamarBots.botSpeak('musician', roomId, text, { force: true });
            }).catch(function () {});
        }).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* ═══════ WELCOME (join room) ═══════             */
    /* ══════════════════════════════════════════════ */
    function _sendWelcome(uid, roomId) {
        if (!uid || !roomId) return;
        if (roomId === 'studio' || roomId === 'jail') return;

        // شبحية — لا نرحّب بالملك أو 90+
        return window.QamarFB.get('users/' + uid).then(function (u) {
            if (!u) return;
            const lvl = Number(u.rankLevel) || 0;
            if (lvl >= CONFIG.IMMUNE_LEVEL) return;

            const now = _now();
            const key = CONFIG.LOCKS_ROOT + '/welcome/' + roomId + '/' + uid;
            return window.QamarFB.transaction(key, function (c) {
                if (c && (now - (c.at || 0)) < CONFIG.WELCOME_LOCK_TTL_MS) return;
                return { at: now };
            }).then(function (r) {
                if (!r || !r.committed) return;

                const name = u.name || '—';
                const avatar = u.avatar || null;
                const roomName = _getRoomName(roomId);

                // استخدم botSpeak مع attachment مخصص
                const text = '🚪 انضم ' + name + ' إلى ' + roomName;

                // نص بسيط + metadata
                return window.QamarBots.botSpeak('ambassador', roomId, text, {
                    force: true,
                    isSystem: true,
                    metadata: {
                        isWelcome: true,
                        welcomeFor: uid,
                        welcomeName: name,
                        welcomeAvatar: avatar,
                        roomName: roomName,
                        roomId: roomId
                    }
                });
            });
        }).catch(function (e) { Logger.warn('sendWelcome:', e.message); });
    }

    /* ══════════════════════════════════════════════ */
    /* ═══════ System messages (30 min) ═══════        */
    /* ══════════════════════════════════════════════ */
    function _pickSystemMessage(roomId) {
        const roomName = _getRoomName(roomId);
        const pick = SYSTEM_MESSAGES[Math.floor(Math.random() * SYSTEM_MESSAGES.length)];
        return pick.text.replace('{room}', roomName);
    }

    function _postSystemMessage() {
        const roomId = _getCurrentRoom();
        if (!roomId) return;
        if (roomId === 'jail' || roomId === 'studio') return;

        const now = _now();
        const lockKey = CONFIG.LOCKS_ROOT + '/system_msg/' + roomId + '/lock';

        window.QamarFB.transaction(lockKey, function (c) {
            if (c && (now - (c.at || 0)) < CONFIG.SYSTEM_MSG_LOCK_TTL_MS) return;
            return { at: now, by: _getCurrentUid() || 'unknown' };
        }).then(function (r) {
            if (!r || !r.committed) return;

            const text = _pickSystemMessage(roomId);
            return window.QamarBots.botSpeak('ambassador', roomId, text, {
                force: true,
                isSystem: true,
                metadata: {
                    isSystemMsg: true,
                    category: 'periodic'
                }
            }).then(function (res) {
                // سجّل البصمة
                if (res && res.ok) {
                    window.QamarFB.set(CONFIG.LOCKS_ROOT + '/system_msg/' + roomId + '/lastPost', {
                        at: now,
                        text: text
                    }).catch(function () {});
                }
                return res;
            });
        }).catch(function (e) { Logger.warn('postSystemMessage:', e.message); });
    }

    /* ══════════════════════════════════════════════ */
    /* ═══════ Forced Transfer Listener ═══════        */
    /* ══════════════════════════════════════════════ */
    function _installForcedListener() {
        const uid = _getCurrentUid();
        if (!uid) { setTimeout(_installForcedListener, 2000); return; }

        if (State.forcedListener && State.forcedListener.off) {
            try { State.forcedListener.off(); } catch (e) {}
        }

        State.forcedListener = window.QamarFB.onValue('user_presence/' + uid, function (p) {
            if (!p || p.forced !== true || !p.room) return;
            const currentRoom = (window.AppState && window.AppState.currentRoom) || _getCurrentRoom();
            if (p.room === currentRoom) {
                window.QamarFB.update('user_presence/' + uid, {
                    forced: null, forcedReason: null
                }).catch(function () {});
                return;
            }
            const reason = p.forcedReason || 'system';
            if (window.QamarRooms && typeof window.QamarRooms.switchTo === 'function') {
                window.QamarRooms.switchTo(p.room, { force: true }).catch(function () {});
            } else if (window.EventBus) {
                try { window.EventBus.emit('room:changed', { roomId: p.room }); } catch (e) {}
            }

            if (window.showToast) {
                const msgs = {
                    jail: '⛓️ تم نقلك إلى السجن',
                    jail_release: '🔓 تم إخراجك من السجن',
                    kick_from_room: '🚪 تم نقلك إلى غرفة أخرى'
                };
                window.showToast('fa-exchange-alt', msgs[reason] || '📢 تم نقلك');
            }

            setTimeout(function () {
                window.QamarFB.update('user_presence/' + uid, {
                    forced: null, forcedReason: null
                }).catch(function () {});
            }, 1500);
        }, function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Room change (welcome)                           */
    /* ══════════════════════════════════════════════ */
    function _onRoomChanged(payload) {
        const roomId = (payload && payload.roomId) || payload;
        if (!roomId) return;
        const uid = _getCurrentUid();
        if (!uid) return;

        // تجنّب التكرار عند بدء التشغيل
        if (State.lastRoom === null) {
            State.lastRoom = roomId;
            return;
        }
        if (State.lastRoom === roomId) return;
        State.lastRoom = roomId;

        // رسالة الانضمام
        _sendWelcome(uid, roomId).catch(function () {});

        // موسيقار (استديو)
        if (roomId === 'studio') {
            _musicianWelcome(uid, roomId);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Incoming message router                         */
    /* ══════════════════════════════════════════════ */
    function _onIncoming(payload) {
        if (!payload || !payload.msg) return;
        const msg = payload.msg;
        const roomId = payload.roomId || _getCurrentRoom();
        if (!roomId) return;

        // dedup
        const key = (msg.senderUid || '') + '_' + (msg.time || 0) + '_' + String(msg.text || '').substring(0, 30);
        if (State.processedMsgs.has(key)) return;
        State.processedMsgs.add(key);
        if (State.processedMsgs.size > 2000) {
            const arr = Array.from(State.processedMsgs);
            arr.slice(0, 500).forEach(function (k) { State.processedMsgs.delete(k); });
        }

        const text = String(msg.text || '');
        if (!text) return;
        if (text.charAt(0) === '!') return;

        // 1) كلمة طرد
        const kick = _matchWord(text, State.kickWords);
        if (kick) { _handleKickWord(msg, kick, roomId); return; }

        // 2) كلمة سجن
        const bad = _matchWord(text, State.badWords);
        if (bad) { _handleBadWord(msg, bad, roomId); return; }

        // 3) Quiz
        if (roomId === 'quiz') {
            _checkQuizAnswer(msg, roomId);
        }

        // 4) حكواتي
        _handleHakawati(msg, roomId);
    }

    /* ══════════════════════════════════════════════ */
    /* Periodic tasks                                  */
    /* ══════════════════════════════════════════════ */
    function _startPeriodicTasks() {
        // Islamic
        State.intervalTimers.push(setInterval(function () {
            const room = _getCurrentRoom();
            if (room !== 'islamic') return;
            if (window.QamarBots.isBotEnabled('islamic')) _postIslamic();
        }, CONFIG.ISLAMIC_INTERVAL_MS));

        // Quiz
        State.intervalTimers.push(setInterval(function () {
            const room = _getCurrentRoom();
            if (room !== 'quiz') return;
            if (window.QamarBots.isBotEnabled('quiz')) _postQuiz();
        }, CONFIG.QUIZ_INTERVAL_MS));

        // System messages (30 min) — أول تشغيل بعد 30 دقيقة
        setTimeout(function () {
            _postSystemMessage();
            State.intervalTimers.push(setInterval(_postSystemMessage, CONFIG.SYSTEM_MSG_INTERVAL_MS));
        }, CONFIG.SYSTEM_MSG_INTERVAL_MS);

        // PM background scan (King only)
        State.intervalTimers.push(setInterval(function () {
            if (!_isKing()) return;
            _pmScanRecent().catch(function () {});
        }, CONFIG.PM_SCAN_INTERVAL_MS));
    }

    function _pmScanRecent() {
        return window.QamarFB.get('user_private_messages').then(function (all) {
            if (!all) return;
            const cutoff = _now() - 5 * 60 * 1000;
            const me = _getCurrentUid();
            Object.keys(all).forEach(function (uidA) {
                if (uidA === me) return;
                const chatsA = all[uidA] || {};
                Object.keys(chatsA).forEach(function (uidB) {
                    if (uidA > uidB) return;
                    const msgs = chatsA[uidB] || {};
                    Object.keys(msgs).forEach(function (msgId) {
                        const m = msgs[msgId];
                        if (!m || !m.text) return;
                        if (!m.time || m.time < cutoff) return;
                        if (m.isBot) return;
                        const kick = _matchWord(m.text, State.kickWords);
                        const bad = kick ? null : _matchWord(m.text, State.badWords);
                        if (!kick && !bad) return;
                        _sendGuardianInbox({
                            type: 'pm_violation',
                            severity: kick ? 'kick' : 'jail',
                            suspectUid: m.fromUid,
                            suspectName: m.fromName || '—',
                            suspectAvatar: m.fromAvatar || null,
                            victimUid: m.toUid,
                            victimName: '—',
                            matchedWord: _maskWord(kick || bad),
                            messagePreview: String(m.text).substring(0, 120),
                            side: 'background'
                        });
                    });
                });
            });
        }).catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* Public: notify (system messages)                */
    /* ══════════════════════════════════════════════ */
    function notify(kind, target, options) {
        options = options || {};
        // تأخير ثانية
        return new Promise(function (resolve) {
            setTimeout(function () {
                window.QamarBots.broadcastSystem(kind, target, null, options)
                    .then(resolve).catch(function () { resolve({ ok: false }); });
            }, 1000);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            badWords: State.badWords.length,
            kickWords: State.kickWords.length,
            hakawati: Object.keys(State.hakawati).length,
            hakawatiAuto: Object.keys(State.hakawatiAuto).length,
            quiz: State.quiz.length,
            islamic: State.islamic.length,
            pmHookInstalled: State.pmHookInstalled,
            forcedListenerActive: !!State.forcedListener,
            isKing: _isKing(),
            isGuest: _isGuest(),
            intervalTimers: State.intervalTimers.length,
            processedMsgs: State.processedMsgs.size,
            pmAlertDedup: Object.keys(State.pmAlertDedup).length,
            botProfilesReady: State.botProfilesReady
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _boot() {
        Promise.all([
            loadMemory(),
            window.QamarBots.init().catch(function () {})
        ]).then(function () {
            State._initialized = true;

            // استمع للرسائل الواردة
            if (window.EventBus) {
                window.EventBus.on('bots:incoming', _onIncoming);
                window.EventBus.on('bot:message', _onIncoming);
                window.EventBus.on('room:changed', _onRoomChanged);
            }

            _installPmHooks();
            _installForcedListener();
            _startPeriodicTasks();

            // استمع لتغيير الرتب (رسائل النظام — بعد ثانية)
            if (window.QamarRanks && window.QamarRanks.onRankChange) {
                window.QamarRanks.onRankChange(function (payload) {
                    if (payload.action === 'promote' || payload.action === 'demote' ||
                        payload.action === 'assignQueen' || payload.action === 'removeQueen') {
                        notify(payload.action, { uid: payload.uid }, {
                            newRank: payload.rank || '',
                            byName: (_getCurrentUser() || {}).name || '—'
                        });
                    }
                });
            }

            // إنشاء بروفايلات البوتات (King only)
            if (_isKing()) {
                setTimeout(function () {
                    ensureBotProfiles().catch(function () {});
                }, 2000);
            }

            // الملك يسجّل عند دخوله
            if (window.QamarAuth && window.QamarAuth.onAuthChange) {
                window.QamarAuth.onAuthChange(function (p) {
                    if (p.isLoggedIn && _isKing() && !State.botProfilesReady) {
                        setTimeout(function () {
                            ensureBotProfiles().catch(function () {});
                        }, 2000);
                    }
                });
            }

            // تحديث lastRoom الحالي
            State.lastRoom = _getCurrentRoom();

            Logger.info('✅ [bot-commands] ready');
            _emit('bot-commands:ready', getStatus());
        }).catch(function (e) {
            Logger.error('boot failed:', e.message);
        });
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_boot, 1500);
        });
    } else {
        setTimeout(_boot, 4000);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarBotCommands = {
        CONFIG: CONFIG,
        SYSTEM_MESSAGES: SYSTEM_MESSAGES,
        BOT_SVGS: BOT_SVGS,

        reloadMemory: reloadMemory,
        ensureBotProfiles: ensureBotProfiles,
        notify: notify,

        // Testing
        testMatch: function (text) {
            return {
                kick: _matchWord(text, State.kickWords),
                bad: _matchWord(text, State.badWords)
            };
        },

        getStatus: getStatus,
        onCmdEvent: onCmdEvent
    };

    Logger.info('📦 [bot-commands.js] loaded');
})();
