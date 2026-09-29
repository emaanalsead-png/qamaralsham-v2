// ==============================================
// bots/guardian-inbox.js
// King-only reader: guardian_inbox → PM (with clickable avatar)
// ==============================================
// يعتمد على: bots.js + bot-commands.js + firebase.js + auth.js + ranks.js
// يعطي: window.QamarGuardianInbox
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [guardian-inbox] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[GIN]';
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
        INBOX_ROOT: 'guardian_inbox',
        PM_ROOT: 'user_private_messages',
        CHATS_ROOT: 'user_private_chats',
        NOTIF_ROOT: 'user_notifications',
        BOT_UID: 'bot_guardian',
        BOT_NAME: '🚔 السجان',
        BOT_AVATAR: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#ff4444"/><stop offset="1" stop-color="#8b0000"/>' +
            '</linearGradient></defs>' +
            '<rect width="100" height="100" rx="22" fill="#0a0a15"/>' +
            '<path d="M50 20 L74 30 L74 56 Q74 72 50 82 Q26 72 26 56 L26 30 Z" fill="url(#g)"/>' +
            '<path d="M40 52 L48 60 L62 42" stroke="#fff" stroke-width="4" fill="none" ' +
            'stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>'
        ),
        KING_LEVEL: 100,
        MESSAGE_KEY_LEN: 40,
        OBSERVER_DEBOUNCE_MS: 80,
        BATCH_FLUSH_MS: 300
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        kingUid: null,
        inboxListener: null,
        domObserver: null,
        processedAlerts: new Set(),
        msgCacheByText: {},          // { 'first40chars': payload }
        pendingQueue: [],            // إشعارات واردة قبل pm:messages
        pendingFlushTimer: null,
        _initialized: false,
        listeners: [],
        toastCount: 0,
        lastToastAt: 0
    };

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

    function _isKing100() {
        return _myLevel() >= CONFIG.KING_LEVEL;
    }

    function _esc(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function _now() { return Date.now(); }

    function _timeAgo(ts) {
        if (!ts) return '';
        const d = Math.floor((_now() - ts) / 1000);
        if (d < 60) return 'الآن';
        const m = Math.floor(d / 60);
        if (m < 60) return 'قبل ' + m + ' د';
        const h = Math.floor(m / 60);
        if (h < 24) return 'قبل ' + h + ' س';
        const dd = Math.floor(h / 24);
        return 'قبل ' + dd + ' ي';
    }

    function _textKey(text) {
        return String(text || '').replace(/\s+/g, ' ').trim().substring(0, CONFIG.MESSAGE_KEY_LEN);
    }

    function _toast(msg) {
        if (window.showToast) {
            try { window.showToast('fa-shield', msg); return; } catch (e) {}
        }
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
    /* Build PM payload                                */
    /* ══════════════════════════════════════════════ */
    function _buildPmPayload(alert, msgId, originalInboxKey) {
        const sevIcon = alert.severity === 'kick' ? '🚪' : '⚠️';
        const severityLabel = alert.severity === 'kick' ? 'كلمة طرد (خطر)' : 'كلمة سجن (تحذير)';

        const suspectName = alert.suspectName || '—';
        const victimName = alert.victimName || '—';
        const matched = alert.matchedWord || '—';
        const preview = (alert.messagePreview || '').substring(0, 200);

        // النص الأساسي (سيُعرض داخل البطاقة)
        const textLines = [
            sevIcon + ' رسالة خاصة مريبة',
            '👤 المُخالف: ' + suspectName,
            '👤 الضحية: ' + victimName,
            '📝 كلمة: ' + matched,
            '💬 ' + preview,
            '🕐 ' + new Date().toLocaleString('ar-EG')
        ];
        const text = textLines.join('\n');

        return {
            fromUid: CONFIG.BOT_UID,
            toUid: State.kingUid,
            text: text,
            time: window.QamarFB.serverTime(),
            read: false,
            delivered: true,
            deleted: false,
            replyTo: null,
            attachment: null,
            edited: false,
            isGuardianInbox: true,
            guardianAlert: {
                alertId: originalInboxKey || null,
                severity: alert.severity || 'jail',
                suspectUid: alert.suspectUid || null,
                suspectName: suspectName,
                suspectAvatar: alert.suspectAvatar || null,
                victimUid: alert.victimUid || null,
                victimName: victimName,
                matchedWord: matched,
                messagePreview: preview,
                side: alert.side || 'unknown'
            }
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Insert inbox alert as PM                        */
    /* ══════════════════════════════════════════════ */
    function _insertAsPm(originalInboxKey, alert) {
        if (!State.kingUid) return Promise.resolve({ skipped: 'no-king' });
        if (!originalInboxKey) return Promise.resolve({ skipped: 'no-key' });

        // dedup
        if (State.processedAlerts.has(originalInboxKey)) {
            return Promise.resolve({ skipped: 'already' });
        }
        State.processedAlerts.add(originalInboxKey);

        // استخدم نفس الـ key في PM (يمنع التكرار حتى بعد refresh)
        const pmPath = CONFIG.PM_ROOT + '/' + State.kingUid + '/' + CONFIG.BOT_UID + '/' + originalInboxKey;

        // تحقق إذا موجود مسبقاً
        return window.QamarFB.exists(pmPath).then(function (exists) {
            if (exists) {
                // موجود مسبقاً — احذف الإشعار فقط (نظّف inbox)
                return window.QamarFB.remove(CONFIG.INBOX_ROOT + '/' + State.kingUid + '/' + originalInboxKey)
                    .then(function () { return { skipped: 'pm-exists' }; });
            }

            const payload = _buildPmPayload(alert, originalInboxKey, originalInboxKey);
            const textKey = _textKey(payload.text);

            // خزّن في cache للعرض المخصص لاحقاً
            State.msgCacheByText[textKey] = {
                payload: payload,
                alert: payload.guardianAlert,
                msgId: originalInboxKey
            };

            // اقرأ chat index (للـ unread)
            return window.QamarFB.get(CONFIG.CHATS_ROOT + '/' + State.kingUid + '/' + CONFIG.BOT_UID)
                .catch(function () { return null; })
                .then(function (existing) {
                    const prevUnread = (existing && Number(existing.unread)) || 0;
                    const now = _now();

                    const updates = {};

                    // 1) PM message
                    updates[pmPath] = payload;

                    // 2) chat index (للملك)
                    updates[CONFIG.CHATS_ROOT + '/' + State.kingUid + '/' + CONFIG.BOT_UID] = {
                        otherUid: CONFIG.BOT_UID,
                        otherName: CONFIG.BOT_NAME,
                        otherAvatar: CONFIG.BOT_AVATAR,
                        lastMessage: '🚨 تحذير من السجان',
                        lastTime: now,
                        lastFromMe: false,
                        unread: prevUnread + 1
                    };

                    // 3) إشعار للملك
                    const notifKey = window.QamarFB.ref(CONFIG.NOTIF_ROOT + '/' + State.kingUid).push().key;
                    updates[CONFIG.NOTIF_ROOT + '/' + State.kingUid + '/' + notifKey] = {
                        type: 'guardian_inbox',
                        fromUid: CONFIG.BOT_UID,
                        fromName: CONFIG.BOT_NAME,
                        fromAvatar: CONFIG.BOT_AVATAR,
                        preview: '🚨 تحذير: ' + (alert.suspectName || '—'),
                        alertId: originalInboxKey,
                        suspectUid: alert.suspectUid || null,
                        at: now,
                        read: false
                    };

                    // 4) احذف من inbox (نُقل بنجاح)
                    updates[CONFIG.INBOX_ROOT + '/' + State.kingUid + '/' + originalInboxKey] = null;

                    return window.QamarFB.multiUpdate(updates).then(function () {
                        Logger.info('📨 Inbox → PM:', originalInboxKey);
                        return { ok: true, msgId: originalInboxKey };
                    });
                });
        }).catch(function (e) {
            Logger.warn('_insertAsPm failed:', e.message);
            return { ok: false, error: e.message };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Toast + badge                                   */
    /* ══════════════════════════════════════════════ */
    function _notifyKingNewAlert(alert) {
        // Toast (throttled: max كل 4 ثوانٍ)
        const now = _now();
        if (now - State.lastToastAt > 4000) {
            State.lastToastAt = now;
            const sev = alert.severity === 'kick' ? '🚪' : '⚠️';
            _toast(sev + ' تحذير جديد من السجان — ' + (alert.suspectName || '—'));
        }

        // badge من pm.js يُحدّث نفسه
        if (window.syncPMSlot && typeof window.syncPMSlot === 'function') {
            try { window.syncPMSlot(); } catch (e) {}
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Listen to inbox                                 */
    /* ══════════════════════════════════════════════ */
    function _startInboxListener() {
        if (!State.kingUid) return;
        if (State.inboxListener) {
            try { State.inboxListener.off(); } catch (e) {}
        }

        const path = CONFIG.INBOX_ROOT + '/' + State.kingUid;
        State.inboxListener = window.QamarFB.onChildAdded(path, function (data, key) {
            if (!data) return;
            Logger.debug('📥 Inbox alert received:', key);
            _insertAsPm(key, data).then(function (r) {
                if (r && r.ok) {
                    _notifyKingNewAlert(data);
                    _emit('guardian-inbox:received', { alertId: key, alert: data });
                }
            });
        }, function (err) {
            Logger.warn('inbox listener error:', err.message || err);
        });

        Logger.info('👁️ Guardian inbox listener started (King)');
    }

    function _stopInboxListener() {
        if (State.inboxListener) {
            try { State.inboxListener.off(); } catch (e) {}
        }
        State.inboxListener = null;
    }

    /* ══════════════════════════════════════════════ */
    /* PM display: render custom card                  */
    /* ══════════════════════════════════════════════ */
    function _ensureStyles() {
        if (document.getElementById('gin-styles')) return;
        const s = document.createElement('style');
        s.id = 'gin-styles';
        s.textContent = [
            '.gin-card{background:linear-gradient(135deg,rgba(120,0,0,0.35),rgba(0,0,0,0.5));',
            'border:2px solid #ff4444;border-radius:14px;padding:12px;margin:2px 0;',
            'font-family:inherit;direction:rtl;text-align:right;max-width:100%;box-sizing:border-box;}',

            '.gin-head{display:flex;align-items:center;gap:6px;margin-bottom:10px;',
            'padding-bottom:8px;border-bottom:1px dashed rgba(255,68,68,0.35);}',

            '.gin-head-icon{font-size:20px;line-height:1;}',
            '.gin-head-title{color:#ff8888;font-size:12px;font-weight:900;flex:1;}',
            '.gin-head-time{color:#888;font-size:10px;}',

            '.gin-suspect{display:flex;align-items:center;gap:10px;margin-bottom:8px;}',
            '.gin-suspect-avatar{width:54px;height:54px;border-radius:50%;',
            'border:3px solid #ff4444;object-fit:cover;cursor:pointer;flex-shrink:0;',
            'background:#111;transition:transform 0.15s;}',
            '.gin-suspect-avatar:hover{transform:scale(1.06);',
            'box-shadow:0 0 14px rgba(255,68,68,0.8);}',

            '.gin-suspect-info{flex:1;min-width:0;}',
            '.gin-suspect-name{color:#fff;font-size:14px;font-weight:900;',
            'cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.gin-suspect-name:hover{color:#ff8888;text-decoration:underline;}',
            '.gin-suspect-rank{color:#888;font-size:10px;margin-top:2px;}',

            '.gin-row{color:#ccc;font-size:11px;margin:4px 0;line-height:1.5;}',
            '.gin-row b{color:#ff8888;}',

            '.gin-message{background:rgba(0,0,0,0.45);border-radius:8px;padding:8px 10px;',
            'color:#ffcccc;font-size:12px;line-height:1.5;margin:8px 0;',
            'word-break:break-word;font-style:italic;}',

            '.gin-matched{color:#fbbf24;font-weight:900;}',

            '.gin-victim{color:#93c5fd;font-size:11px;margin-top:4px;}',

            '.gin-actions{display:flex;gap:6px;margin-top:10px;padding-top:10px;',
            'border-top:1px dashed rgba(255,68,68,0.35);}',

            '.gin-btn{padding:8px 14px;border-radius:8px;font-family:inherit;',
            'font-size:11px;font-weight:900;cursor:pointer;border:none;flex:1;}',
            '.gin-btn.view{background:rgba(59,130,246,0.25);color:#93c5fd;',
            'border:1px solid rgba(59,130,246,0.5);}',
            '.gin-btn.view:hover{background:rgba(59,130,246,0.4);}',
            '.gin-btn.gold{background:linear-gradient(135deg,#ffd700,#b8860b);',
            'color:#000;border:none;}'
        ].join('');
        document.head.appendChild(s);
    }

    function _buildCardHtml(alert, time) {
        const sevIcon = alert.severity === 'kick' ? '🚪' : '⚠️';
        const sevLabel = alert.severity === 'kick' ? 'كلمة طرد' : 'كلمة سجن';
        const suspectName = alert.suspectName || '—';
        const suspectAvatar = alert.suspectAvatar || ('https://ui-avatars.com/api/?name=' +
            encodeURIComponent(suspectName) + '&background=8b0000&color=fff&bold=true&size=128');
        const victimName = alert.victimName || '—';
        const preview = (alert.messagePreview || '').substring(0, 200);
        const matched = alert.matchedWord || '—';

        const suspectUidAttr = alert.suspectUid ? _esc(alert.suspectUid) : '';
        const suspectNameAttr = _esc(suspectName);

        return '' +
            '<div class="gin-head">' +
                '<span class="gin-head-icon">' + sevIcon + '</span>' +
                '<span class="gin-head-title">' + _esc(sevLabel) + ' — رسالة خاصة</span>' +
                '<span class="gin-head-time">' + _esc(time || '') + '</span>' +
            '</div>' +
            '<div class="gin-suspect">' +
                '<img class="gin-suspect-avatar" ' +
                    'src="' + _esc(suspectAvatar) + '" ' +
                    'data-suspect-uid="' + suspectUidAttr + '" ' +
                    'data-suspect-name="' + suspectNameAttr + '" ' +
                    'alt="' + suspectNameAttr + '">' +
                '<div class="gin-suspect-info">' +
                    '<div class="gin-suspect-name" ' +
                        'data-suspect-uid="' + suspectUidAttr + '" ' +
                        'data-suspect-name="' + suspectNameAttr + '">' +
                        _esc(suspectName) +
                    '</div>' +
                    '<div class="gin-suspect-rank">اضغط الصورة أو الاسم لفتح البروفايل</div>' +
                    '<div class="gin-victim">👤 الضحية: ' + _esc(victimName) + '</div>' +
                '</div>' +
            '</div>' +
            (preview ? '<div class="gin-message">"' + _esc(preview) + '"</div>' : '') +
            '<div class="gin-row">📝 الكلمة: <span class="gin-matched">' + _esc(matched) + '</span></div>' +
            '<div class="gin-row"><b>👑 نصيحة:</b> افتح البروفايل ثم اتخذ القرار من زر الأوامر</div>' +
            '<div class="gin-actions">' +
                '<button class="gin-btn view" data-action="open-profile" ' +
                    'data-suspect-uid="' + suspectUidAttr + '" ' +
                    'data-suspect-name="' + suspectNameAttr + '">👤 فتح البروفايل</button>' +
            '</div>';
    }

    function _attachProfileOpenHandler(cardEl) {
        const clickables = cardEl.querySelectorAll('[data-suspect-uid]');
        clickables.forEach(function (el) {
            el.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                const uid = el.getAttribute('data-suspect-uid');
                const name = el.getAttribute('data-suspect-name') || '';
                if (!uid) return;
                _openProfile(uid, name);
            });
        });
    }

    function _openProfile(uid, name) {
        try {
            if (typeof window.openUserProfile === 'function') {
                window.openUserProfile(uid, name);
                return;
            }
        } catch (e) {}
        try {
            if (window.parent && window.parent !== window &&
                typeof window.parent.openUserProfile === 'function') {
                window.parent.openUserProfile(uid, name);
                return;
            }
        } catch (e) {}
        // fallback
        try {
            localStorage.setItem('profile_target_uid', uid);
            localStorage.setItem('profile_target_name', name);
            const iframe = document.getElementById('profile-iframe');
            if (iframe) {
                iframe.src = 'profile.html?uid=' + encodeURIComponent(uid) + '&t=' + Date.now();
                const f = document.getElementById('profile-frame-container');
                if (f) f.style.display = 'block';
            }
        } catch (e) {
            Logger.warn('open profile failed:', e.message);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* DOM observation — replace PM msg with card      */
    /* ══════════════════════════════════════════════ */
    function _findPayloadByText(text) {
        const key = _textKey(text);
        if (State.msgCacheByText[key]) return State.msgCacheByText[key];
        // fuzzy: ابحث عن أي مفتاح يبدأ بنفس أول 20 حرفاً
        const short = key.substring(0, 20);
        if (!short) return null;
        const keys = Object.keys(State.msgCacheByText);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i].substring(0, 20) === short) return State.msgCacheByText[keys[i]];
        }
        return null;
    }

    function _replaceMsgWithCard(msgEl, payload) {
        if (!msgEl || !payload || !payload.guardianAlert) return;
        if (msgEl.dataset.ginReplaced === '1') return;
        msgEl.dataset.ginReplaced = '1';

        const alert = payload.guardianAlert;
        const time = _timeAgo(payload.time);

        // امسح المحتوى القديم وابنِ البطاقة
        msgEl.innerHTML = '';
        msgEl.classList.add('gin-msg-wrap');
        msgEl.style.background = 'transparent';
        msgEl.style.border = 'none';
        msgEl.style.padding = '0';
        msgEl.style.maxWidth = '100%';

        const card = document.createElement('div');
        card.className = 'gin-card';
        card.innerHTML = _buildCardHtml(alert, time);
        msgEl.appendChild(card);

        _attachProfileOpenHandler(card);
    }

    function _processDomMessages() {
        const container = document.getElementById('pc-messages');
        if (!container) return;

        const msgs = container.querySelectorAll('.pc-msg.received:not([data-gin-replaced="1"])');
        msgs.forEach(function (el) {
            const text = el.textContent || '';
            if (text.indexOf('رسالة خاصة مريبة') === -1) return;

            const found = _findPayloadByText(text);
            if (found) {
                _replaceMsgWithCard(el, found.payload);
            }
        });
    }

    function _installDomObserver() {
        const container = document.getElementById('pc-messages');
        if (!container) {
            setTimeout(_installDomObserver, 2000);
            return;
        }
        if (State.domObserver) {
            try { State.domObserver.disconnect(); } catch (e) {}
        }

        let pendingTimer = null;
        State.domObserver = new MutationObserver(function (muts) {
            clearTimeout(pendingTimer);
            pendingTimer = setTimeout(_processDomMessages, CONFIG.OBSERVER_DEBOUNCE_MS);
        });
        State.domObserver.observe(container, { childList: true, subtree: false });

        // عالج الموجود مسبقاً
        setTimeout(_processDomMessages, 300);
    }

    /* ══════════════════════════════════════════════ */
    /* PM messages listener (cache payloads)           */
    /* ══════════════════════════════════════════════ */
    function _onPmMessages(payload) {
        if (!payload || !payload.otherUid) return;
        if (payload.otherUid !== CONFIG.BOT_UID) return;

        const msgs = payload.messages || [];
        msgs.forEach(function (m) {
            if (!m || !m.isGuardianInbox || !m.guardianAlert) return;
            const key = _textKey(m.text);
            State.msgCacheByText[key] = {
                payload: m,
                alert: m.guardianAlert,
                msgId: m._id || null
            };
        });

        setTimeout(_processDomMessages, 150);
    }

    /* ══════════════════════════════════════════════ */
    /* Hook EventBus                                   */
    /* ══════════════════════════════════════════════ */
    function _installBusHooks() {
        if (!window.EventBus) return;

        window.EventBus.on('pm:messages', _onPmMessages);

        // عند فتح محادثة السجان → أعد المعالجة
        window.EventBus.on('pm:started', function (p) {
            if (p && p.otherUid === CONFIG.BOT_UID) {
                setTimeout(_processDomMessages, 200);
                setTimeout(_processDomMessages, 600);
            }
        });

        // تنظيف cache عند logout
        window.EventBus.on('auth:signout', function () {
            State.msgCacheByText = {};
            State.processedAlerts = new Set();
            _stopInboxListener();
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Boot                                            */
    /* ══════════════════════════════════════════════ */
    function _start() {
        if (State._initialized) return;

        const uid = _getCurrentUid();
        if (!uid) {
            // انتظر حتى يسجل الدخول
            setTimeout(_start, 2000);
            return;
        }

        if (!_isKing100()) {
            // ليس الملك — لا شيء
            State._initialized = true;
            Logger.debug('Not King — guardian-inbox disabled');
            return;
        }

        State.kingUid = uid;
        State._initialized = true;

        _ensureStyles();
        _startInboxListener();
        _installBusHooks();

        // observer على chat UI
        setTimeout(_installDomObserver, 1500);

        Logger.info('✅ [guardian-inbox] active for King');
        _emit('guardian-inbox:ready', { kingUid: uid });
    }

    /* ══════════════════════════════════════════════ */
    /* Manual trigger (for debug / King panel)         */
    /* ══════════════════════════════════════════════ */
    function processAllPending() {
        if (!State.kingUid) return Promise.resolve({ processed: 0 });
        return window.QamarFB.get(CONFIG.INBOX_ROOT + '/' + State.kingUid)
            .then(function (data) {
                if (!data) return { processed: 0 };
                const keys = Object.keys(data);
                let n = 0;
                let chain = Promise.resolve();
                keys.forEach(function (k) {
                    chain = chain.then(function () {
                        return _insertAsPm(k, data[k]).then(function (r) {
                            if (r && r.ok) { n++; _notifyKingNewAlert(data[k]); }
                        });
                    });
                });
                return chain.then(function () { return { processed: n }; });
            })
            .catch(function (e) {
                Logger.warn('processAllPending:', e.message);
                return { processed: 0, error: e.message };
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            kingUid: State.kingUid ? State.kingUid.substring(0, 8) : null,
            isKing100: _isKing100(),
            listening: !!State.inboxListener,
            observer: !!State.domObserver,
            cachedPayloads: Object.keys(State.msgCacheByText).length,
            processedAlerts: State.processedAlerts.size
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarGuardianInbox = {
        CONFIG: CONFIG,

        // Manual
        processAllPending: processAllPending,
        processDom: _processDomMessages,

        // Testing (King only)
        testInsert: function (alert) {
            if (!_isKing100()) return Promise.reject(new Error('King only'));
            const key = 'test_' + _now().toString(36);
            return _insertAsPm(key, alert);
        },

        // Status
        getStatus: getStatus,

        // Events
        onEvent: function (cb) {
            if (typeof cb !== 'function') return function () {};
            State.listeners.push(cb);
            return function off() {
                State.listeners = State.listeners.filter(function (h) { return h !== cb; });
            };
        }
    };

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_start, 2500);
        });
    } else {
        setTimeout(_start, 5000);
    }

    // عند تسجيل الدخول لاحقاً
    if (window.QamarAuth && window.QamarAuth.onAuthChange) {
        window.QamarAuth.onAuthChange(function (p) {
            if (p.isLoggedIn && _isKing100() && !State._initialized) {
                _start();
            }
        });
    }

    Logger.info('📦 [guardian-inbox.js] loaded');
})();
