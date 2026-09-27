// ==============================================
// chat/chat-input.js
// Message input + buttons + draft + mentions
// ==============================================
// يعتمد على: chat/chat.js + auth.js + constants.js
// يعطي: window.QamarChatInput
// ==============================================

(function () {
    'use strict';

    if (!window.QamarChat) {
        console.error('❌ [chat-input] chat.js not loaded!');
        return;
    }

    const LOG_TAG = '[IN]';
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
        MAX_LENGTH: 2000,
        COUNTER_THRESHOLD: 1600,        // يظهر العدّاد عند 1600+ حرف
        DRAFT_PREFIX: 'qamar_draft_',
        DRAFT_MAX_LENGTH: 500,
        DRAFT_DEBOUNCE_MS: 600,
        MENTIONS_MIN_CHARS: 2,
        MENTIONS_MAX_RESULTS: 5,
        RATE_TICK_MS: 200,
        AUTO_RESIZE_MAX_LINES: 5,
        AUTO_RESIZE_LINE_HEIGHT: 24,
        AUTO_RESIZE_MIN_HEIGHT: 40,
        MIC_MENU_TIMEOUT_MS: 3000
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        els: {
            wrapper: null,
            input: null,
            sendBtn: null,
            emojiBtn: null,
            plusBtn: null,
            micBtn: null,
            replyPreview: null,
            mentionsBox: null,
            counter: null,
            rateCountdown: null
        },
        isReady: false,
        isDisabled: false,
        currentRoom: null,
        replyTo: null,
        lastSendAttempt: 0,
        rateLimitEndsAt: 0,
        rateTimer: null,
        draftTimer: null,
        mentionsActive: false,
        mentionsResults: [],
        mentionsIndex: 0,
        mentionsQuery: '',
        userIndex: {},
        listeners: [],
        events: [],
        _origSendBtnHTML: null,
        _micMenuEl: null
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onInputEvent(cb) {
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

    function _isGuest() {
        if (window.QamarAuth && window.QamarAuth.isGuest) return window.QamarAuth.isGuest();
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    function _getRoom() {
        if (State.currentRoom) return State.currentRoom;
        if (window.QamarChat && window.QamarChat.getRoom) return window.QamarChat.getRoom();
        return 'general';
    }

    /* ══════════════════════════════════════════════ */
    /* DOM finders — idempotent                        */
    /* ══════════════════════════════════════════════ */
    function _findEls() {
        const els = State.els;

        els.wrapper = document.querySelector('.input-area') ||
                      document.querySelector('#input-area');

        // Input — textarea أو input
        els.input = document.querySelector('#message-input') ||
                    document.querySelector('.input-area textarea') ||
                    document.querySelector('.input-area input[type="text"]') ||
                    document.querySelector('.input-area input');

        // Buttons — multiple fallbacks
        els.sendBtn  = document.querySelector('#send-btn')  || document.querySelector('.send-btn');
        els.emojiBtn = document.querySelector('#emoji-btn') || document.querySelector('.emoji-btn');
        els.plusBtn  = document.querySelector('#plus-btn')  || document.querySelector('.plus-btn');
        els.micBtn   = document.querySelector('#mic-btn')   || document.querySelector('.mic-btn');

        // Reply preview
        els.replyPreview = document.querySelector('#reply-preview') ||
                           document.querySelector('.reply-preview');

        // Mentions dropdown
        els.mentionsBox = document.querySelector('#mentions-dropdown') ||
                          document.querySelector('.mentions-dropdown');

        // Counter
        els.counter = document.querySelector('#char-counter') ||
                      document.querySelector('.char-counter');

        // Rate limit — سيُبنى ديناميكياً
        els.rateCountdown = document.querySelector('#rate-countdown');
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function init() {
        if (State.isReady) return true;

        _findEls();

        if (!State.els.input) {
            Logger.warn('input element not found — will retry on boot');
            return false;
        }

        // ربط الأحداث
        _bindInput();
        _bindSendBtn();
        _bindEmojiBtn();
        _bindPlusBtn();
        _bindMicBtn();
        _bindReplyPreview();

        // draft + الإشعارات
        _bindDraftEvents();
        _bindGlobalEvents();

        // قياس أولي لـ textarea
        _autoResize();

        State.isReady = true;
        _updateSendBtnState();

        // استرجع المسودة للروم الحالي
        const roomId = _getRoom();
        if (roomId) loadDraft(roomId);

        Logger.info('📦 [chat-input.js] initialized');
        _emit('input:ready', {});
        return true;
    }

    function destroy() {
        if (!State.isReady) return;
        // إزالة المستمعات
        State.events.forEach(function (e) {
            try {
                e.el.removeEventListener(e.type, e.fn, e.opts);
            } catch (err) {}
        });
        State.events = [];
        State.listeners = [];
        _stopRateCountdown();
        _closeMentions();
        _closeMicMenu();
        State.isReady = false;
        Logger.info('destroyed');
    }

    function _on(el, type, fn, opts) {
        if (!el) return;
        el.addEventListener(type, fn, opts);
        State.events.push({ el: el, type: type, fn: fn, opts: opts });
    }

    /* ══════════════════════════════════════════════ */
    /* Input binding                                   */
    /* ══════════════════════════════════════════════ */
    function _bindInput() {
        const el = State.els.input;
        if (!el) return;

        _on(el, 'input', _onInput);
        _on(el, 'keydown', _onKeyDown);
        _on(el, 'paste', _onPaste);
        _on(el, 'blur', function () {
            // لا نغلق mentions فوراً — نعطي فرصة للنقر
            setTimeout(_closeMentions, 150);
        });
    }

    function _onInput() {
        const text = State.els.input.value || '';
        _updateSendBtnState();
        _updateCounter(text);
        _autoResize();
        _handleMentionsInput(text);
        _scheduleDraftSave();
    }

    function _onKeyDown(ev) {
        // Mentions dropdown نشط؟
        if (State.mentionsActive) {
            if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                State.mentionsIndex = Math.min(State.mentionsIndex + 1, State.mentionsResults.length - 1);
                _renderMentions();
                return;
            }
            if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                State.mentionsIndex = Math.max(State.mentionsIndex - 1, 0);
                _renderMentions();
                return;
            }
            if (ev.key === 'Enter' || ev.key === 'Tab') {
                if (State.mentionsResults.length > 0) {
                    ev.preventDefault();
                    _selectMention(State.mentionsIndex);
                    return;
                }
            }
            if (ev.key === 'Escape') {
                ev.preventDefault();
                _closeMentions();
                return;
            }
        }

        // Enter = سطر جديد (لا إرسال) — لأنه input قد لا يدعمها
        // نستخدم textarea متى أمكن، وإلا نُدرج \n يدوياً
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
            const tag = (ev.target.tagName || '').toUpperCase();
            if (tag === 'INPUT') {
                // لا ندعم multiline في input — لا نرسل، فقط نتجاهل
                ev.preventDefault();
                return;
            }
            // textarea: نسمح بالسلوك الافتراضي (سطر جديد)
            // لا preventDefault — نترك Enter يفعل newline
        }
    }

    function _onPaste(ev) {
        const items = (ev.clipboardData && ev.clipboardData.items) || [];
        if (items.length === 0) return;

        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.kind !== 'file') continue;

            const file = it.getAsFile && it.getAsFile();
            if (!file) continue;

            const isImage = file.type && file.type.indexOf('image/') === 0;
            const isVideo = file.type && file.type.indexOf('video/') === 0;

            if (isImage || isVideo) {
                ev.preventDefault();
                _handlePastedMedia(file);
                return;
            }
        }
        // إذا نص عادي → نتركه يُلصق بشكل عادي (chat.js يكتشف يوتيوب)
    }

    function _handlePastedMedia(file) {
        Logger.info('📎 Pasted media:', file.type, (file.size / 1024).toFixed(1) + 'KB');

        // أطلق حدث — media-picker.js (لاحقاً) سيستمع
        _emit('input:pasteMedia', { file: file, type: file.type });

        if (window.EventBus) {
            try {
                window.EventBus.emit('media:paste', { file: file });
            } catch (e) {}
        }

        // إذا كان هناك media-picker يُعالج — نتركه
        if (window.QamarMediaPicker && typeof window.QamarMediaPicker.handleFile === 'function') {
            try {
                window.QamarMediaPicker.handleFile(file);
                return;
            } catch (e) {
                Logger.warn('media-picker failed:', e.message);
            }
        }

        // لا media-picker → أرسل رسالة توضيحية للمستخدم
        if (window.showToast) {
            window.showToast('fa-info-circle', 'لا يمكن إرسال الصورة الآن — الميزة قادمة');
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Send button                                     */
    /* ══════════════════════════════════════════════ */
    function _bindSendBtn() {
        _on(State.els.sendBtn, 'click', function (ev) {
            ev.preventDefault();
            submit();
        });
    }

    function _updateSendBtnState() {
        const btn = State.els.sendBtn;
        if (!btn) return;
        const text = (State.els.input && State.els.input.value || '').trim();
        const hasText = text.length > 0;
        const rateLimited = _isRateLimited();

        if (rateLimited) {
            btn.disabled = true;
            btn.classList.add('disabled');
            return;
        }

        if (hasText && !State.isDisabled) {
            btn.disabled = false;
            btn.classList.remove('disabled');
            btn.classList.add('active');
        } else {
            btn.disabled = true;
            btn.classList.add('disabled');
            btn.classList.remove('active');
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Submit                                          */
    /* ══════════════════════════════════════════════ */
    function submit() {
        if (State.isDisabled) {
            _toast('الشات معطّل مؤقتاً');
            return;
        }
        if (_isRateLimited()) {
            _toast('انتظر انتهاء العدّاد');
            return;
        }

        const el = State.els.input;
        if (!el) return;

        const text = (el.value || '').trim();
        if (!text) return;

        if (text.length > CONFIG.MAX_LENGTH) {
            _toast('الرسالة طويلة جداً (2000 حرف)');
            return;
        }

        // امسح mentions مؤقتة
        _closeMentions();

        const options = {};
        if (State.replyTo) {
            options.replyTo = State.replyTo;
        }

        State.lastSendAttempt = Date.now();

        window.QamarChat.send(text, options)
            .then(function (result) {
                // نجح الإرسال
                el.value = '';
                _autoResize();
                _updateSendBtnState();
                _updateCounter('');
                clearReply();
                _clearDraft(_getRoom());

                _emit('input:sent', { msgId: result.msgId, roomId: result.roomId });
            })
            .catch(function (err) {
                const msg = err && err.message ? err.message : 'خطأ في الإرسال';
                Logger.warn('send failed:', msg);

                // rate limit؟ → فعّل العدّاد
                const m = /انتظر\s+(\d+)\s+ثانية/.exec(msg);
                if (m) {
                    const remaining = parseInt(m[1], 10);
                    _startRateCountdown(remaining);
                    _emit('input:rateLimited', { seconds: remaining });
                } else {
                    _toast(msg);
                }
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Rate limit UI                                   */
    /* ══════════════════════════════════════════════ */
    function _isRateLimited() {
        return State.rateLimitEndsAt > Date.now();
    }

    function _startRateCountdown(seconds) {
        if (!State.els.sendBtn) return;
        const btn = State.els.sendBtn;

        // احفظ HTML الأصلي مرة واحدة
        if (!State._origSendBtnHTML) {
            State._origSendBtnHTML = btn.innerHTML;
        }

        // أنشئ عنصر العدّاد مرة واحدة
        if (!State.els.rateCountdown) {
            const cd = document.createElement('div');
            cd.id = 'rate-countdown';
            cd.style.cssText = 'display:flex;align-items:center;justify-content:center;' +
                'min-width:34px;height:34px;border-radius:50%;' +
                'background:rgba(255,255,255,0.08);color:#ff9800;' +
                'font-weight:900;font-size:12px;font-family:inherit;';
            State.els.rateCountdown = cd;
        }

        State.rateLimitEndsAt = Date.now() + seconds * 1000;

        // أخفِ الزر وأظهر العدّاد في مكانه
        btn.style.display = 'none';
        if (btn.parentNode && !State.els.rateCountdown.parentNode) {
            btn.parentNode.insertBefore(State.els.rateCountdown, btn.nextSibling);
        } else if (btn.parentNode) {
            // إن كان موجوداً، تأكد أنه في المكان الصحيح
            btn.parentNode.insertBefore(State.els.rateCountdown, btn.nextSibling);
        }

        _stopRateCountdown();
        State.rateTimer = setInterval(_tickRateCountdown, CONFIG.RATE_TICK_MS);
        _tickRateCountdown();

        function _tickRateCountdown() {
            const remain = Math.max(0, Math.ceil((State.rateLimitEndsAt - Date.now()) / 1000));
            if (State.els.rateCountdown) {
                State.els.rateCountdown.textContent = String(remain);
            }
            if (remain <= 0) {
                _stopRateCountdown();
                _restoreSendBtn();
            }
        }
    }

    function _stopRateCountdown() {
        if (State.rateTimer) {
            clearInterval(State.rateTimer);
            State.rateTimer = null;
        }
    }

    function _restoreSendBtn() {
        const btn = State.els.sendBtn;
        if (!btn) return;

        // أخفِ العدّاد
        if (State.els.rateCountdown && State.els.rateCountdown.parentNode) {
            State.els.rateCountdown.parentNode.removeChild(State.els.rateCountdown);
        }

        // أظهر الزر
        btn.style.display = '';
        State.rateLimitEndsAt = 0;
        _updateSendBtnState();
    }

    /* ══════════════════════════════════════════════ */
    /* Reply                                           */
    /* ══════════════════════════════════════════════ */
    function _bindReplyPreview() {
        if (!State.els.replyPreview) return;
        // زر الإلغاء يُفترض أنه موجود داخل preview
        _on(State.els.replyPreview, 'click', function (ev) {
            const target = ev.target;
            if (target && (target.classList.contains('cancel') ||
                target.classList.contains('close') ||
                target.dataset.action === 'cancel')) {
                clearReply();
            }
        });
    }

    function setReply(message) {
        if (!message) { clearReply(); return; }
        State.replyTo = {
            msgId: message._id || message.msgId || null,
            senderUid: message.senderUid || null,
            senderName: message.senderName || '—',
            text: message.text || ''
        };
        _renderReplyPreview();
        _emit('input:replySet', { reply: State.replyTo });
    }

    function clearReply() {
        State.replyTo = null;
        _renderReplyPreview();
        _emit('input:replyCleared', {});
    }

    function _renderReplyPreview() {
        const box = State.els.replyPreview;
        if (!box) return;

        if (!State.replyTo) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        const r = State.replyTo;
        const name = (window.escapeHtml) ? window.escapeHtml(r.senderName) : r.senderName;
        const text = (window.escapeHtml) ? window.escapeHtml((r.text || '').substring(0, 80)) : (r.text || '').substring(0, 80);

        box.innerHTML =
            '<div class="reply-info">' +
                '<div class="reply-name">↩️ ' + name + '</div>' +
                '<div class="reply-text">' + text + '</div>' +
            '</div>' +
            '<button class="reply-cancel" data-action="cancel" type="button">✕</button>';
        box.style.display = 'flex';
    }

    /* ══════════════════════════════════════════════ */
    /* Emoji button                                    */
    /* ══════════════════════════════════════════════ */
    function _bindEmojiBtn() {
        _on(State.els.emojiBtn, 'click', function (ev) {
            ev.preventDefault();
            _emit('input:emojiRequested', {});
            if (window.EventBus) {
                try { window.EventBus.emit('emoji:open', {}); } catch (e) {}
            }
            // media-picker.js سيستمع لهذا الحدث
            if (window.QamarMediaPicker && typeof window.QamarMediaPicker.openEmoji === 'function') {
                try { window.QamarMediaPicker.openEmoji(); } catch (e) {}
            }
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Plus button — فتح الشريط العائم                 */
    /* ══════════════════════════════════════════════ */
    function _bindPlusBtn() {
        _on(State.els.plusBtn, 'click', function (ev) {
            ev.preventDefault();
            // لا يُفتح للزوار (media-picker يتحقق أيضاً)
            if (_isGuest()) {
                _toast('سجّل عضوية لاستخدام الأدوات');
                return;
            }
            _emit('input:plusRequested', {});
            if (window.EventBus) {
                try { window.EventBus.emit('floating-bar:open', {}); } catch (e) {}
            }
            if (window.QamarMediaPicker && typeof window.QamarMediaPicker.openFloatingBar === 'function') {
                try { window.QamarMediaPicker.openFloatingBar(); } catch (e) {}
            }
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Mic button                                      */
    /* ══════════════════════════════════════════════ */
    function _bindMicBtn() {
        _on(State.els.micBtn, 'click', function (ev) {
            ev.preventDefault();
            _openMicMenu();
        });
    }

    function _openMicMenu() {
        _closeMicMenu();

        const menu = document.createElement('div');
        menu.className = 'mic-menu';
        menu.style.cssText = 'position:fixed;bottom:120px;right:20px;' +
            'background:rgba(15,15,20,0.98);border:1px solid rgba(212,175,55,0.4);' +
            'border-radius:12px;padding:8px;z-index:10000;' +
            'box-shadow:0 8px 24px rgba(0,0,0,0.6);min-width:180px;' +
            'direction:rtl;font-family:inherit;';

        const opts = [];
        const level = _myLevel();

        if (level >= 80) {
            opts.push({ label: '🎙️ استوديو التسجيل', action: 'studio' });
        }
        opts.push({ label: '📞 مكالمة صوتية', action: 'call' });

        opts.forEach(function (o) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = o.label;
            btn.style.cssText = 'display:block;width:100%;text-align:right;' +
                'background:transparent;border:none;color:#f3f4f6;' +
                'padding:10px 12px;font-family:inherit;font-size:13px;' +
                'font-weight:700;border-radius:8px;cursor:pointer;';
            btn.onmouseenter = function () { btn.style.background = 'rgba(212,175,55,0.1)'; };
            btn.onmouseleave = function () { btn.style.background = 'transparent'; };
            btn.onclick = function (e) {
                e.preventDefault();
                _closeMicMenu();
                _handleMicAction(o.action);
            };
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        State._micMenuEl = menu;

        // إغلاق عند النقر خارجاً
        setTimeout(function () {
            const closer = function (e) {
                if (State._micMenuEl && !State._micMenuEl.contains(e.target) &&
                    e.target !== State.els.micBtn) {
                    _closeMicMenu();
                    document.removeEventListener('click', closer, true);
                }
            };
            document.addEventListener('click', closer, true);
        }, 50);
    }

    function _closeMicMenu() {
        if (State._micMenuEl && State._micMenuEl.parentNode) {
            State._micMenuEl.parentNode.removeChild(State._micMenuEl);
        }
        State._micMenuEl = null;
    }

    function _handleMicAction(action) {
        if (action === 'studio') {
            _emit('input:studioRequested', {});
            if (window.EventBus) {
                try { window.EventBus.emit('studio:open', {}); } catch (e) {}
            }
            if (window.QamarVoiceStudio && typeof window.QamarVoiceStudio.open === 'function') {
                try { window.QamarVoiceStudio.open(); } catch (e) {}
            }
        } else if (action === 'call') {
            _emit('input:callRequested', {});
            if (window.EventBus) {
                try { window.EventBus.emit('voice:call', {}); } catch (e) {}
            }
            if (window.QamarVoiceSystem && typeof window.QamarVoiceSystem.startMic === 'function') {
                try { window.QamarVoiceSystem.startMic(); } catch (e) {}
            }
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Mentions autocomplete                           */
    /* ══════════════════════════════════════════════ */
    function _refreshUserIndex() {
        if (!window.QamarFB) return;
        window.QamarFB.get('user_names').then(function (data) {
            State.userIndex = data || {};
        }).catch(function () {});
    }

    function _handleMentionsInput(text) {
        // استخرج "الكلمة الحالية" قبل المؤشر
        const el = State.els.input;
        const pos = el && el.selectionStart !== undefined ? el.selectionStart : (text || '').length;
        const before = (text || '').substring(0, pos);
        const tokens = before.split(/[\s\n]+/);
        const last = tokens[tokens.length - 1] || '';

        if (last.length < CONFIG.MENTIONS_MIN_CHARS) {
            _closeMentions();
            return;
        }

        const q = last.toLowerCase();
        const names = Object.keys(State.userIndex);
        const results = [];

        for (let i = 0; i < names.length && results.length < CONFIG.MENTIONS_MAX_RESULTS; i++) {
            const name = names[i];
            if (!name) continue;
            if (name.toLowerCase().indexOf(q) === 0) {
                results.push({ name: name, uid: State.userIndex[name] });
            }
        }

        if (results.length === 0) {
            _closeMentions();
            return;
        }

        State.mentionsActive = true;
        State.mentionsResults = results;
        State.mentionsIndex = 0;
        State.mentionsQuery = last;
        _renderMentions();
    }

    function _renderMentions() {
        let box = State.els.mentionsBox;
        if (!box) {
            box = document.createElement('div');
            box.id = 'mentions-dropdown';
            box.style.cssText = 'position:absolute;bottom:100%;' +
                'background:rgba(15,15,20,0.98);border:1px solid rgba(212,175,55,0.3);' +
                'border-radius:10px;padding:4px;z-index:9999;' +
                'min-width:180px;max-width:280px;direction:rtl;' +
                'font-family:inherit;box-shadow:0 8px 24px rgba(0,0,0,0.6);';
            // ضعه داخل wrapper إذا وُجد
            if (State.els.wrapper && State.els.wrapper.style) {
                State.els.wrapper.style.position = 'relative';
                State.els.wrapper.appendChild(box);
            } else {
                document.body.appendChild(box);
            }
            State.els.mentionsBox = box;
        }

        box.innerHTML = '';
        State.mentionsResults.forEach(function (r, i) {
            const item = document.createElement('div');
            const active = i === State.mentionsIndex;
            item.style.cssText = 'padding:8px 12px;border-radius:8px;cursor:pointer;' +
                'font-size:13px;color:#f3f4f6;font-family:inherit;' +
                (active ? 'background:rgba(212,175,55,0.18);' : '');
            item.textContent = r.name;
            item.addEventListener('mouseenter', function () {
                State.mentionsIndex = i;
                _renderMentions();
            });
            item.addEventListener('click', function (e) {
                e.preventDefault();
                _selectMention(i);
            });
            box.appendChild(item);
        });

        box.style.display = 'block';
    }

    function _closeMentions() {
        State.mentionsActive = false;
        State.mentionsResults = [];
        State.mentionsIndex = 0;
        State.mentionsQuery = '';
        if (State.els.mentionsBox) {
            State.els.mentionsBox.style.display = 'none';
        }
    }

    function _selectMention(idx) {
        const r = State.mentionsResults[idx];
        if (!r) return;

        const el = State.els.input;
        if (!el) return;

        const val = el.value || '';
        const pos = el.selectionStart !== undefined ? el.selectionStart : val.length;
        const before = val.substring(0, pos);
        const after = val.substring(pos);

        // احذف الجزء المكتوب (mentionsQuery)
        const qLen = State.mentionsQuery.length;
        const newBefore = before.substring(0, before.length - qLen) + r.name + ' ';

        el.value = newBefore + after;
        const newPos = newBefore.length;
        try { el.setSelectionRange(newPos, newPos); } catch (e) {}

        _closeMentions();
        _onInput();
        _updateSendBtnState();
    }

    /* ══════════════════════════════════════════════ */
    /* Counter                                         */
    /* ══════════════════════════════════════════════ */
    function _updateCounter(text) {
        if (!State.els.counter) return;
        const len = (text || '').length;
        if (len >= CONFIG.COUNTER_THRESHOLD) {
            const remain = CONFIG.MAX_LENGTH - len;
            State.els.counter.textContent = String(remain);
            State.els.counter.style.display = 'block';
            State.els.counter.style.color = remain < 100 ? '#ff4444' : '#ffd700';
        } else {
            State.els.counter.style.display = 'none';
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Auto-resize (textarea)                          */
    /* ══════════════════════════════════════════════ */
    function _autoResize() {
        const el = State.els.input;
        if (!el) return;
        const tag = (el.tagName || '').toUpperCase();
        if (tag !== 'TEXTAREA') return;

        el.style.height = 'auto';
        const maxH = CONFIG.AUTO_RESIZE_MAX_LINES * CONFIG.AUTO_RESIZE_LINE_HEIGHT;
        const newH = Math.min(el.scrollHeight, maxH);
        el.style.height = Math.max(CONFIG.AUTO_RESIZE_MIN_HEIGHT, newH) + 'px';
        el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
    }

    /* ══════════════════════════════════════════════ */
    /* Draft management                                */
    /* ══════════════════════════════════════════════ */
    function _draftKey(roomId) {
        return CONFIG.DRAFT_PREFIX + (roomId || 'general');
    }

    function _scheduleDraftSave() {
        if (State.draftTimer) clearTimeout(State.draftTimer);
        State.draftTimer = setTimeout(function () {
            _saveDraft(_getRoom());
        }, CONFIG.DRAFT_DEBOUNCE_MS);
    }

    function _saveDraft(roomId) {
        if (!roomId) return;
        try {
            const el = State.els.input;
            if (!el) return;
            const text = (el.value || '').substring(0, CONFIG.DRAFT_MAX_LENGTH);
            if (!text) {
                localStorage.removeItem(_draftKey(roomId));
            } else {
                localStorage.setItem(_draftKey(roomId), text);
            }
        } catch (e) {}
    }

    function _clearDraft(roomId) {
        if (!roomId) return;
        try { localStorage.removeItem(_draftKey(roomId)); } catch (e) {}
    }

    function loadDraft(roomId) {
        if (!roomId) return;
        try {
            const v = localStorage.getItem(_draftKey(roomId));
            if (v && State.els.input) {
                State.els.input.value = v;
                _onInput();
                _autoResize();
            }
        } catch (e) {}
    }

    function _bindDraftEvents() {
        if (window.EventBus) {
            window.EventBus.on('room:changed', function (roomId, prevRoomId) {
                if (prevRoomId) _saveDraft(prevRoomId);
                State.currentRoom = roomId;
                // امسح الحقل الحالي، ثم استرجع مسودة الروم الجديد
                if (State.els.input) State.els.input.value = '';
                _updateSendBtnState();
                _updateCounter('');
                _autoResize();
                if (roomId) loadDraft(roomId);
            });
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Global events                                   */
    /* ══════════════════════════════════════════════ */
    function _bindGlobalEvents() {
        // عند بدء الشات → حدّث المؤشر
        if (window.EventBus) {
            window.EventBus.on('chat:started', function (payload) {
                if (payload && payload.roomId) State.currentRoom = payload.roomId;
                _refreshUserIndex();
            });

            // تفعيل/تعطيل الشات
            window.EventBus.on('chat:disabled', function (payload) {
                State.isDisabled = true;
                _updateSendBtnState();
                if (payload && payload.reason) _toast(payload.reason);
            });

            window.EventBus.on('chat:enabled', function () {
                State.isDisabled = false;
                _updateSendBtnState();
            });

            // reply من chat-ui (عند الرد من الزر في الرسالة)
            window.EventBus.on('chat:replyRequested', function (payload) {
                if (payload && payload.message) setReply(payload.message);
            });
        }

        // حفظ المسودة عند إغلاق الصفحة
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', function () {
                _saveDraft(_getRoom());
            });
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Toast                                           */
    /* ══════════════════════════════════════════════ */
    function _toast(msg) {
        if (window.showToast) {
            try { window.showToast('fa-info-circle', msg); return; } catch (e) {}
        }
        Logger.info('toast:', msg);
    }

    /* ══════════════════════════════════════════════ */
    /* Public API                                      */
    /* ══════════════════════════════════════════════ */
    function getText() {
        return (State.els.input && State.els.input.value) || '';
    }

    function setText(text) {
        if (!State.els.input) return;
        State.els.input.value = String(text || '');
        _onInput();
        _autoResize();
    }

    function clear() {
        setText('');
        clearReply();
    }

    function focus() {
        if (State.els.input && State.els.input.focus) {
            try { State.els.input.focus(); } catch (e) {}
        }
    }

    function disable(reason) {
        State.isDisabled = true;
        _updateSendBtnState();
        if (reason) _toast(reason);
    }

    function enable() {
        State.isDisabled = false;
        _updateSendBtnState();
    }

    /* ══════════════════════════════════════════════ */
    /* Status / Debug                                  */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            ready: State.isReady,
            hasInput: !!State.els.input,
            hasSendBtn: !!State.els.sendBtn,
            hasEmojiBtn: !!State.els.emojiBtn,
            hasPlusBtn: !!State.els.plusBtn,
            hasMicBtn: !!State.els.micBtn,
            disabled: State.isDisabled,
            rateLimited: _isRateLimited(),
            currentRoom: State.currentRoom,
            hasReply: !!State.replyTo,
            userIndexSize: Object.keys(State.userIndex).length,
            draftKey: _draftKey(_getRoom())
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Auto init                                       */
    /* ══════════════════════════════════════════════ */
    function _autoInit() {
        if (!init()) {
            // أعد المحاولة بعد 1.5 ثانية
            setTimeout(_autoInit, 1500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(_autoInit, 800);
        });
    } else {
        setTimeout(_autoInit, 800);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarChatInput = {
        CONFIG: CONFIG,
        init: init,
        destroy: destroy,
        submit: submit,
        setText: setText,
        getText: getText,
        clear: clear,
        focus: focus,
        disable: disable,
        enable: enable,
        setReply: setReply,
        clearReply: clearReply,
        loadDraft: loadDraft,
        refreshUserIndex: _refreshUserIndex,
        onInputEvent: onInputEvent,
        getStatus: getStatus
    };

    Logger.info('📦 [chat-input.js] loaded');
})();
