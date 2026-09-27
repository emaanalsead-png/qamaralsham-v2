// ==============================================
// chat/chat-ui.js
// Render messages + whisper + reactions + actions
// ==============================================
// يعتمد على: chat/chat.js + utils.js + constants.js
// يعطي: window.QamarChatUI
// ==============================================

(function () {
    'use strict';

    if (!window.QamarChat) {
        console.error('❌ [chat-ui] chat.js not loaded!');
        return;
    }

    const LOG_TAG = '[UI]';
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
        INITIAL_SHOW: 12,
        LOAD_MORE_STEP: 12,
        MAX_BUFFER: 100,
        MAX_DOM: 200,
        LONG_PRESS_MS: 500,
        REACTION_EMOJIS: ['❤️', '😂', '👍', '🔥', '😮', '😢', '🎉', '🙏'],
        AVATAR_FALLBACK_SVG: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%230a0a15" stroke="%23d4af37" stroke-width="2"/><text x="50" y="62" text-anchor="middle" font-size="42">🌙</text></svg>'
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        container: null,
        scroller: null,
        messages: [],           // [{_id, ...msg}]
        domMap: {},             // { msgId: element }
        displayLimit: CONFIG.INITIAL_SHOW,
        currentRoom: null,
        listeners: [],
        unboundFns: [],
        scrollToBottomBtn: null,
        isReady: false,
        userIndex: {},
        pressState: { timer: null, target: null },
        actionMenuEl: null,
        actionMenuCleanup: null,
        lastRenderedIds: []     // للحفاظ على الترتيب
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onUiEvent(cb) {
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

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    function _esc(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _formatTime(ts) {
        if (window.formatTimeShort) return window.formatTimeShort(ts);
        const d = new Date(ts || Date.now());
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function _formatFull(ts) {
        if (window.formatDateTime) return window.formatDateTime(ts);
        return new Date(ts || Date.now()).toLocaleString('ar');
    }

    function _rankIcon(rank) {
        const map = {
            'King': '👑', 'Queen': '👸', 'Master Owner': '🌟',
            'Room Owner': '🛡️', 'Grand Owner': '💎', 'Owner': '🏆',
            'Super Admin': '🎖️', 'Admin': '🛠️', 'Premium': '💠', 'User': '👤'
        };
        return map[rank] || '👤';
    }

    /* ══════════════════════════════════════════════ */
    /* Whisper detection                               */
    /* ══════════════════════════════════════════════ */
    // whisper: msg starts with @name AND has exactly 1 mention AND name matches
    function _detectWhisper(msg) {
        if (!msg || !msg.text) return null;
        if (!msg.mentions || !Array.isArray(msg.mentions) || msg.mentions.length !== 1) return null;

        const m = msg.mentions[0];
        if (!m || !m.name) return null;

        // تحقق: النص يبدأ بـ @اسم
        const trimmed = String(msg.text).trim();
        const expectedPrefix = '@' + m.name;
        if (trimmed.indexOf(expectedPrefix) !== 0) return null;

        // يجب أن يكون بعد الاسم مسافة (لتفادي @محمدX)
        const after = trimmed.charAt(expectedPrefix.length);
        if (after && after !== ' ' && after !== '\n') return null;

        // body = النص بدون @اسم (مع تنظيف المسافات الزائدة)
        let body = trimmed.substring(expectedPrefix.length).replace(/^\s+/, '');

        // إذا النص فيه @ أخرى → ليس همس (واحد فقط)
        if (/@[\u0600-\u06FFa-zA-Z0-9_]{2,20}/.test(body)) return null;

        return {
            recipientName: m.name,
            recipientUid: m.uid || null,
            body: body
        };
    }

    // من يرى النص الحقيقي؟
    function _canSeeWhisper(whisper, msg) {
        const uid = _getCurrentUid();
        if (!uid) return false;
        if (msg.senderUid === uid) return true;             // المرسل
        if (whisper.recipientUid && whisper.recipientUid === uid) return true; // المستقبل (بالـ uid)
        if (_isKing()) return true;                          // الملك
        return false;
    }

    /* ══════════════════════════════════════════════ */
    /* Build message DOM                               */
    /* ══════════════════════════════════════════════ */
    function _buildMessageElement(msg) {
        const uid = _getCurrentUid();
        const isMine = msg.senderUid === uid;
        const isKing = _isKing();
        const myLvl = _myLevel();

        const whisper = _detectWhisper(msg);
        const isWhisper = !!whisper;
        const seeWhisper = isWhisper && _canSeeWhisper(whisper, msg);

        // رسالة محذوفة؟
        if (msg.deleted) {
            return _buildDeletedMessage(msg, isKing);
        }

        // رسالة مخفية؟
        if (msg.hidden && myLvl < 65 && !isKing) {
            return null; // لا تعرضها إطلاقاً
        }

        const wrap = document.createElement('div');
        wrap.className = 'chat-message' + (isMine ? ' mine' : '');
        wrap.dataset.msgId = msg._id;
        wrap.dataset.uid = msg.senderUid || '';

        if (msg.hidden && myLvl >= 65) {
            wrap.classList.add('msg-hidden');
        }
        if (isWhisper) {
            wrap.classList.add('msg-whisper');
        }

        // ═══ Avatar ═══
        const avatarWrap = document.createElement('div');
        avatarWrap.className = 'msg-avatar-wrap';
        const avatar = document.createElement('img');
        avatar.className = 'msg-avatar';
        avatar.loading = 'lazy';
        avatar.src = msg.senderAvatar || CONFIG.AVATAR_FALLBACK_SVG;
        avatar.alt = msg.senderName || '—';
        avatar.style.cursor = 'pointer';
        avatar.onerror = function () { avatar.src = CONFIG.AVATAR_FALLBACK_SVG; };
        avatar.addEventListener('click', function (e) {
            e.stopPropagation();
            if (msg.senderUid) {
                try {
                    window.location.href = (window.buildProfileUrl
                        ? window.buildProfileUrl(msg.senderUid)
                        : 'profile.html?uid=' + encodeURIComponent(msg.senderUid));
                } catch (err) {}
            }
        });
        avatarWrap.appendChild(avatar);

        // الإطار (إن وُجد)
        if (msg.senderFrame) {
            const frame = document.createElement('div');
            frame.className = 'msg-frame';
            frame.dataset.frame = msg.senderFrame;
            avatarWrap.appendChild(frame);
            // effects/frames-engine.js (لاحقاً) سيطبّق الإطار
            if (window.QamarFramesEngine && typeof window.QamarFramesEngine.apply === 'function') {
                try { window.QamarFramesEngine.apply(frame, msg.senderFrame); } catch (e) {}
            }
        }
        wrap.appendChild(avatarWrap);

        // ═══ Content ═══
        const content = document.createElement('div');
        content.className = 'msg-content';

        // Header (name + rank + time + whisper badge)
        const header = document.createElement('div');
        header.className = 'msg-header';

        const nameEl = document.createElement('span');
        nameEl.className = 'msg-name';
        nameEl.textContent = msg.senderName || '—';
        nameEl.style.cursor = 'pointer';
        nameEl.title = 'اضغط للمنشن';
        nameEl.addEventListener('click', function (e) {
            e.stopPropagation();
            _mentionUser(msg.senderName);
        });
        _applyNameStyle(nameEl, msg);
        header.appendChild(nameEl);

        const rankEl = document.createElement('span');
        rankEl.className = 'msg-rank';
        rankEl.textContent = _rankIcon(msg.senderRank);
        header.appendChild(rankEl);

        if (isWhisper) {
            const wb = document.createElement('span');
            wb.className = 'msg-whisper-badge';
            wb.textContent = '👁️ همس';
            header.appendChild(wb);
        }

        const timeEl = document.createElement('span');
        timeEl.className = 'msg-time';
        timeEl.textContent = _formatTime(msg.time);
        timeEl.title = _formatFull(msg.time);
        header.appendChild(timeEl);

        content.appendChild(header);

        // Reply preview
        if (msg.replyTo && msg.replyTo.senderName) {
            const rep = document.createElement('div');
            rep.className = 'msg-reply';
            const rn = document.createElement('div');
            rn.className = 'msg-reply-name';
            rn.textContent = '↩️ ' + (msg.replyTo.senderName || '—');
            const rt = document.createElement('div');
            rt.className = 'msg-reply-text';
            rt.textContent = (msg.replyTo.text || '').substring(0, 100);
            rep.appendChild(rn);
            rep.appendChild(rt);
            content.appendChild(rep);
        }

        // Body
        const body = document.createElement('div');
        body.className = 'msg-body';

        if (isWhisper) {
            if (seeWhisper) {
                // يرى النص
                body.textContent = whisper.body || '';
                if (isKing && !isMine && msg.senderUid !== uid && whisper.recipientUid !== uid) {
                    // الملك يرى من أرسل لمن
                    const kingHint = document.createElement('div');
                    kingHint.className = 'msg-whisper-king-hint';
                    kingHint.style.cssText = 'font-size:10px;color:#9ca3af;margin-top:2px;font-style:italic;';
                    kingHint.textContent = 'من ' + (msg.senderName || '—') + ' إلى ' + whisper.recipientName;
                    body.appendChild(kingHint);
                }
            } else {
                // لا يرى النص
                body.textContent = (msg.senderName || '—') + ' همس لـ ' + whisper.recipientName;
                body.classList.add('msg-whisper-placeholder');
            }
        } else if (msg.hidden && myLvl >= 65) {
            body.textContent = '🚫 رسالة مخفية';
            body.classList.add('msg-hidden-body');
        } else {
            _renderTextWithMentions(body, msg.text, msg.mentions);
        }

        content.appendChild(body);

        // Attachment
        if (msg.attachment && !msg.deleted) {
            const att = _buildAttachment(msg.attachment);
            if (att) content.appendChild(att);
        }

        // Reactions
        if (msg.reactions && Object.keys(msg.reactions).length > 0) {
            content.appendChild(_buildReactions(msg));
        }

        // hidden note (65+)
        if (msg.hidden && myLvl >= 65 && msg.hiddenReason) {
            const note = document.createElement('div');
            note.className = 'msg-hidden-note';
            note.textContent = 'مخفية: ' + msg.hiddenReason;
            content.appendChild(note);
        }

        wrap.appendChild(content);

        // Actions button (⋯)
        const actionsBtn = document.createElement('button');
        actionsBtn.type = 'button';
        actionsBtn.className = 'msg-actions-btn';
        actionsBtn.textContent = '⋯';
        actionsBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            _openActionMenu(msg, wrap, e);
        });
        wrap.appendChild(actionsBtn);

        // Long-press (mobile) / contextmenu (desktop)
        _attachLongPress(wrap, msg);

        return wrap;
    }

    function _buildDeletedMessage(msg, isKing) {
        const wrap = document.createElement('div');
        wrap.className = 'chat-message deleted';
        wrap.dataset.msgId = msg._id;

        const box = document.createElement('div');
        box.className = 'msg-deleted-box';
        box.textContent = '🚫 تم حذف الرسالة';
        if (isKing && msg.originalText) {
            const orig = document.createElement('div');
            orig.className = 'msg-deleted-original';
            orig.textContent = '[الأصل: ' + msg.originalText + ']';
            box.appendChild(orig);
        }
        wrap.appendChild(box);

        // actions button — الملك فقط (لا شيء مفيد)
        if (isKing) {
            const actionsBtn = document.createElement('button');
            actionsBtn.type = 'button';
            actionsBtn.className = 'msg-actions-btn';
            actionsBtn.textContent = '⋯';
            actionsBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                _openActionMenu(msg, wrap, e);
            });
            wrap.appendChild(actionsBtn);
        }

        return wrap;
    }

    function _renderTextWithMentions(parent, text, mentions) {
        if (!text) { parent.textContent = ''; return; }

        // إذا لا mentions → نص عادي
        if (!mentions || mentions.length === 0) {
            parent.textContent = text;
            return;
        }

        // استخرج الأسماء من mentions
        const names = mentions.map(function (m) { return m.name; }).filter(Boolean);
        if (names.length === 0) { parent.textContent = text; return; }

        // ابحث عن كل اسم ككلمة كاملة
        let result = text;
        const positions = []; // [{name, start, end}]

        names.forEach(function (name) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // بدون @ — الاسم ككلمة كاملة
            const re = new RegExp('(^|[\\s\\n،,.!؟:;])(' + escaped + ')(?=[\\s\\n،,.!؟:;]|$)', 'gu');
            let m;
            while ((m = re.exec(text)) !== null) {
                const start = m.index + m[1].length;
                positions.push({ name: name, start: start, end: start + name.length });
                if (positions.length > 50) break;
            }
        });

        if (positions.length === 0) { parent.textContent = text; return; }

        // رتب حسب البداية
        positions.sort(function (a, b) { return a.start - b.start; });

        let cursor = 0;
        positions.forEach(function (p) {
            if (p.start < cursor) return;
            if (p.start > cursor) {
                parent.appendChild(document.createTextNode(text.substring(cursor, p.start)));
            }
            const span = document.createElement('span');
            span.className = 'mention';
            span.textContent = p.name;  // بدون @
            parent.appendChild(span);
            cursor = p.end;
        });
        if (cursor < text.length) {
            parent.appendChild(document.createTextNode(text.substring(cursor)));
        }
    }

    function _applyNameStyle(el, msg) {
        if (window.QamarNameEffects && typeof window.QamarNameEffects.apply === 'function') {
            try { window.QamarNameEffects.apply(el, msg); return; } catch (e) {}
        }
        // fallback بسيط
        if (msg.senderNameColor) el.style.color = msg.senderNameColor;
        if (Array.isArray(msg.senderNameGradient) && msg.senderNameGradient.length === 2) {
            el.style.background = 'linear-gradient(90deg,' +
                msg.senderNameGradient[0] + ',' + msg.senderNameGradient[1] + ')';
            el.style.webkitBackgroundClip = 'text';
            el.style.backgroundClip = 'text';
            el.style.webkitTextFillColor = 'transparent';
        }
        if (msg.senderNameBgColor) {
            el.style.background = msg.senderNameBgColor;
            el.style.padding = '1px 6px';
            el.style.borderRadius = '6px';
        } else if (Array.isArray(msg.senderNameBgGradient) && msg.senderNameBgGradient.length === 2) {
            el.style.background = 'linear-gradient(90deg,' +
                msg.senderNameBgGradient[0] + ',' + msg.senderNameBgGradient[1] + ')';
            el.style.padding = '1px 6px';
            el.style.borderRadius = '6px';
        }
    }

    function _buildAttachment(att) {
        if (!att || !att.type) return null;
        const wrap = document.createElement('div');
        wrap.className = 'msg-attachment';
        wrap.dataset.type = att.type;

        if (att.type === 'image' && att.url) {
            const img = document.createElement('img');
            img.src = att.url;
            img.loading = 'lazy';
            img.alt = att.name || 'صورة';
            img.className = 'msg-att-img';
            img.addEventListener('click', function () {
                if (window.QamarMediaPicker && typeof window.QamarMediaPicker.openViewer === 'function') {
                    try { window.QamarMediaPicker.openViewer(att.url); return; } catch (e) {}
                }
                window.open(att.url, '_blank');
            });
            wrap.appendChild(img);
        } else if (att.type === 'audio' && att.url) {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = att.url;
            audio.className = 'msg-att-audio';
            wrap.appendChild(audio);
        } else if (att.type === 'video' && att.url) {
            const video = document.createElement('video');
            video.controls = true;
            video.src = att.url;
            video.className = 'msg-att-video';
            wrap.appendChild(video);
        } else if (att.type === 'youtube' && att.videoId) {
            const iframe = document.createElement('iframe');
            iframe.src = 'https://www.youtube.com/embed/' + encodeURIComponent(att.videoId);
            iframe.className = 'msg-att-youtube';
            iframe.setAttribute('allowfullscreen', 'true');
            wrap.appendChild(iframe);
        } else if (att.url) {
            const a = document.createElement('a');
            a.href = att.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = att.name || att.url;
            wrap.appendChild(a);
        } else {
            return null;
        }
        return wrap;
    }

    function _buildReactions(msg) {
        const box = document.createElement('div');
        box.className = 'msg-reactions';

        const reactions = msg.reactions || {};
        Object.keys(reactions).forEach(function (emoji) {
            const uids = reactions[emoji] || {};
            const uidsList = Object.keys(uids);
            if (uidsList.length === 0) return;

            const myUid = _getCurrentUid();
            const iReacted = !!uids[myUid];

            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'reaction-chip' + (iReacted ? ' active' : '');
            chip.dataset.emoji = emoji;
            chip.textContent = emoji + ' ' + uidsList.length;
            chip.addEventListener('click', function (e) {
                e.stopPropagation();
                _toggleReaction(msg._id, emoji);
            });
            box.appendChild(chip);
        });
        return box;
    }

    /* ══════════════════════════════════════════════ */
    /* Long press / context menu                       */
    /* ══════════════════════════════════════════════ */
    function _attachLongPress(el, msg) {
        const start = function (ev) {
            State.pressState.target = msg;
            State.pressState.timer = setTimeout(function () {
                State.pressState.timer = null;
                _openActionMenu(msg, el, ev);
            }, CONFIG.LONG_PRESS_MS);
        };
        const cancel = function () {
            if (State.pressState.timer) {
                clearTimeout(State.pressState.timer);
                State.pressState.timer = null;
            }
            State.pressState.target = null;
        };

        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchend', cancel);
        el.addEventListener('touchmove', cancel);
        el.addEventListener('touchcancel', cancel);
        el.addEventListener('contextmenu', function (ev) {
            ev.preventDefault();
            _openActionMenu(msg, el, ev);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Action menu                                     */
    /* ══════════════════════════════════════════════ */
    function _openActionMenu(msg, msgEl, ev) {
        _closeActionMenu();

        const uid = _getCurrentUid();
        const isMine = msg.senderUid === uid;
        const isKing = _isKing();
        const myLvl = _myLevel();
        const whisper = _detectWhisper(msg);
        const seeWhisper = whisper ? _canSeeWhisper(whisper, msg) : false;

        const menu = document.createElement('div');
        menu.className = 'msg-action-menu';
        menu.style.cssText = 'position:fixed;z-index:12000;' +
            'background:rgba(15,15,20,0.98);border:1px solid rgba(212,175,55,0.4);' +
            'border-radius:14px;padding:8px;direction:rtl;font-family:inherit;' +
            'box-shadow:0 10px 32px rgba(0,0,0,0.7);min-width:220px;max-width:280px;';

        // ═══ Reactions row (فقط إذا يرى النص) ═══
        if (!whisper || seeWhisper) {
            const reactionsRow = document.createElement('div');
            reactionsRow.style.cssText = 'display:flex;gap:4px;justify-content:space-around;' +
                'padding:4px 0 8px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:6px;';

            CONFIG.REACTION_EMOJIS.forEach(function (emoji) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = emoji;
                btn.style.cssText = 'font-size:20px;background:transparent;border:none;' +
                    'cursor:pointer;padding:4px;border-radius:8px;line-height:1;';
                btn.onmouseenter = function () { btn.style.background = 'rgba(212,175,55,0.15)'; };
                btn.onmouseleave = function () { btn.style.background = 'transparent'; };
                btn.onclick = function (e) {
                    e.preventDefault();
                    _closeActionMenu();
                    _toggleReaction(msg._id, emoji);
                };
                reactionsRow.appendChild(btn);
            });
            menu.appendChild(reactionsRow);
        }

        // ═══ Actions ═══
        const actions = [];

        // للكل (إذا يرى النص)
        if (!whisper || seeWhisper) {
            actions.push({ icon: '↩️', label: 'رد', action: 'reply' });
            actions.push({ icon: '📋', label: 'نسخ', action: 'copy' });
        }

        // الأعضاء
        if (!isMine) {
            actions.push({ icon: '⚠️', label: 'إبلاغ', action: 'report' });
        }

        // حذف — المُرسل أو 90+
        if (isMine || myLvl >= 90 || isKing) {
            actions.push({ icon: '🗑️', label: 'حذف', action: 'delete', danger: true });
        }

        // إخفاء — 65+
        if ((myLvl >= 65 || isKing) && !msg.hidden) {
            actions.push({ icon: '👁️', label: 'إخفاء', action: 'hide' });
        }

        // تعديل — الملك
        if (isKing) {
            actions.push({ icon: '✏️', label: 'تعديل', action: 'edit' });
        }

        // تفاصيل — الملك
        if (isKing) {
            actions.push({ icon: 'ℹ️', label: 'تفاصيل', action: 'info' });
        }

        actions.forEach(function (a) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;' +
                'background:transparent;border:none;color:' +
                (a.danger ? '#ff8888' : '#f3f4f6') + ';padding:10px 12px;' +
                'font-family:inherit;font-size:13px;font-weight:700;' +
                'border-radius:8px;cursor:pointer;text-align:right;';
            btn.onmouseenter = function () { btn.style.background = 'rgba(212,175,55,0.1)'; };
            btn.onmouseleave = function () { btn.style.background = 'transparent'; };
            btn.innerHTML = '<span style="font-size:16px">' + a.icon + '</span>' +
                            '<span>' + _esc(a.label) + '</span>';
            btn.onclick = function (e) {
                e.preventDefault();
                _closeActionMenu();
                _handleAction(a.action, msg);
            };
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        State.actionMenuEl = menu;

        // تحديد الموضع
        let x, y;
        if (ev && typeof ev.clientX === 'number' && ev.clientX > 0) {
            x = ev.clientX;
            y = ev.clientY;
        } else if (msgEl && msgEl.getBoundingClientRect) {
            const r = msgEl.getBoundingClientRect();
            x = r.left + 20;
            y = r.top + 20;
        } else {
            x = window.innerWidth / 2;
            y = window.innerHeight / 2;
        }

        // تأكد أن القائمة داخل الشاشة
        const mRect = menu.getBoundingClientRect();
        const maxX = window.innerWidth - mRect.width - 8;
        const maxY = window.innerHeight - mRect.height - 8;
        if (x > maxX) x = Math.max(8, maxX);
        if (y > maxY) y = Math.max(8, maxY);

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        // إغلاق عند النقر خارجاً
        setTimeout(function () {
            const closer = function (e) {
                if (State.actionMenuEl && !State.actionMenuEl.contains(e.target)) {
                    _closeActionMenu();
                    document.removeEventListener('click', closer, true);
                }
            };
            document.addEventListener('click', closer, true);
            State.actionMenuCleanup = function () {
                document.removeEventListener('click', closer, true);
            };
        }, 50);
    }

    function _closeActionMenu() {
        if (State.actionMenuEl && State.actionMenuEl.parentNode) {
            State.actionMenuEl.parentNode.removeChild(State.actionMenuEl);
        }
        State.actionMenuEl = null;
        if (State.actionMenuCleanup) {
            try { State.actionMenuCleanup(); } catch (e) {}
            State.actionMenuCleanup = null;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Handle actions                                  */
    /* ══════════════════════════════════════════════ */
    function _handleAction(action, msg) {
        if (!action || !msg) return;

        if (action === 'reply') {
            if (window.QamarChatInput && typeof window.QamarChatInput.setReply === 'function') {
                try { window.QamarChatInput.setReply(msg); } catch (e) {}
            }
            if (window.EventBus) {
                try { window.EventBus.emit('chat:replyRequested', { message: msg }); } catch (e) {}
            }
            return;
        }

        if (action === 'copy') {
            const text = msg.text || '';
            if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () {
                    _toast('📋 تم النسخ');
                }).catch(function () {
                    _toast('تعذر النسخ');
                });
            } else {
                // fallback
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text; document.body.appendChild(ta);
                    ta.select(); document.execCommand('copy');
                    document.body.removeChild(ta);
                    _toast('📋 تم النسخ');
                } catch (e) { _toast('تعذر النسخ'); }
            }
            return;
        }

        if (action === 'report') {
            if (window.EventBus) {
                try { window.EventBus.emit('report:openDialog', { message: msg }); } catch (e) {}
            }
            if (window.QamarReports && typeof window.QamarReports.openDialog === 'function') {
                try { window.QamarReports.openDialog(msg); return; } catch (e) {}
            }
            // fallback — تقرير بسيط
            if (window.QamarReports) {
                window.QamarReports.submitReport(msg.senderUid, 'other', {
                    targetName: msg.senderName,
                    messageText: msg.text,
                    messageKey: msg._id,
                    roomId: State.currentRoom
                }).then(function () {
                    _toast('✅ تم إرسال التقرير');
                }).catch(function (e) { _toast(e.message || 'فشل التقرير'); });
            }
            return;
        }

        if (action === 'delete') {
            _confirm('حذف هذه الرسالة؟', function () {
                window.QamarChat.deleteMessage(msg._id, State.currentRoom)
                    .then(function () { _toast('🗑️ تم الحذف'); })
                    .catch(function (e) { _toast(e.message || 'فشل'); });
            });
            return;
        }

        if (action === 'hide') {
            _prompt('سبب الإخفاء:', '', function (reason) {
                window.QamarChat.hideMessage(msg._id, reason || '', State.currentRoom)
                    .then(function () { _toast('👁️ تم الإخفاء'); })
                    .catch(function (e) { _toast(e.message || 'فشل'); });
            });
            return;
        }

        if (action === 'edit') {
            _prompt('النص الجديد:', msg.text || '', function (newText) {
                if (!newText) return;
                window.QamarChat.editMessage(msg._id, newText, State.currentRoom)
                    .then(function () { _toast('✏️ تم التعديل'); })
                    .catch(function (e) { _toast(e.message || 'فشل'); });
            });
            return;
        }

        if (action === 'info') {
            _showInfo(msg);
            return;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Reactions                                       */
    /* ══════════════════════════════════════════════ */
    function _toggleReaction(msgId, emoji) {
        const uid = _getCurrentUid();
        if (!uid || !State.currentRoom || !msgId || !emoji) return;
        const path = 'room_messages/' + State.currentRoom + '/' + msgId + '/reactions/' + emoji + '/' + uid;
        window.QamarFB.exists(path).then(function (has) {
            if (has) return window.QamarFB.remove(path);
            return window.QamarFB.set(path, true);
        }).catch(function (e) {
            Logger.warn('reaction error:', e.message);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Mention user (من click على الاسم)               */
    /* ══════════════════════════════════════════════ */
    function _mentionUser(name) {
        if (!name || !window.QamarChatInput) return;
        const current = window.QamarChatInput.getText ? window.QamarChatInput.getText() : '';
        const prefix = current && current.length > 0 ? ' ' : '';
        window.QamarChatInput.setText(current + prefix + name + ' ');
        window.QamarChatInput.focus();
    }

    /* ══════════════════════════════════════════════ */
    /* Render engine                                   */
    /* ══════════════════════════════════════════════ */
    function _findContainer() {
        const ids = ['messages-container', 'chat-messages', 'messages-area'];
        for (let i = 0; i < ids.length; i++) {
            const el = document.getElementById(ids[i]);
            if (el) return el;
        }
        const cls = ['.messages-container', '.chat-messages', '.messages-area', '.messages-list'];
        for (let i = 0; i < cls.length; i++) {
            const el = document.querySelector(cls[i]);
            if (el) return el;
        }
        return null;
    }

    function _findScroller() {
        if (!State.container) return null;
        const c = State.container;
        // هل container نفسه scrollable؟
        try {
            const cs = getComputedStyle(c);
            if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && c.scrollHeight > c.clientHeight) {
                return c;
            }
        } catch (e) {}
        // ابحث عن أب scrollable
        let el = c.parentElement;
        for (let i = 0; i < 4 && el; i++) {
            try {
                const s = getComputedStyle(el);
                if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
                    return el;
                }
            } catch (e) {}
            el = el.parentElement;
        }
        return c;
    }

    function mount(containerId) {
        const el = (typeof containerId === 'string')
            ? (document.getElementById(containerId) || document.querySelector(containerId))
            : (containerId || _findContainer());

        if (!el) {
            Logger.warn('container not found');
            return false;
        }

        State.container = el;
        State.scroller = _findScroller();

        // أنشئ زر scroll-to-bottom
        _ensureScrollToBottomBtn();

        // استمع للتمرير
        if (State.scroller && !State.scroller.dataset.qamarScrollBound) {
            State.scroller.dataset.qamarScrollBound = '1';
            State.scroller.addEventListener('scroll', _onScroll, { passive: true });
        }

        _bindBus();
        State.isReady = true;
        Logger.info('📦 mounted on', el.id || el.className);
        return true;
    }

    function _onScroll() {
        const scroller = State.scroller;
        if (!scroller) return;

        // Lazy load older عند الاقتراب من الأعلى
        if (scroller.scrollTop < 100) {
            if (State.displayLimit < State.messages.length) {
                _loadMore();
            }
        }

        // scroll-to-bottom button visibility
        const atBottom = _isAtBottom();
        if (State.scrollToBottomBtn) {
            State.scrollToBottomBtn.style.display = atBottom ? 'none' : 'flex';
        }
    }

    function _isAtBottom() {
        const s = State.scroller;
        if (!s) return true;
        return (s.scrollHeight - s.scrollTop - s.clientHeight) < 60;
    }

    function _ensureScrollToBottomBtn() {
        if (State.scrollToBottomBtn) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'scroll-to-bottom-btn';
        btn.textContent = '⬇️';
        btn.style.cssText = 'position:fixed;bottom:120px;left:20px;width:38px;height:38px;' +
            'border-radius:50%;background:rgba(212,175,55,0.9);color:#0a0a15;' +
            'border:none;font-size:18px;font-weight:900;cursor:pointer;' +
            'display:none;align-items:center;justify-content:center;' +
            'z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,0.5);';
        btn.addEventListener('click', function () { scrollToBottom(true); });
        document.body.appendChild(btn);
        State.scrollToBottomBtn = btn;
    }

    function _loadMore() {
        const prevHeight = State.scroller ? State.scroller.scrollHeight : 0;
        const prevTop = State.scroller ? State.scroller.scrollTop : 0;

        State.displayLimit = Math.min(State.displayLimit + CONFIG.LOAD_MORE_STEP, State.messages.length);
        _renderVisible();

        // استعد موضع التمرير
        requestAnimationFrame(function () {
            if (!State.scroller) return;
            const newHeight = State.scroller.scrollHeight;
            State.scroller.scrollTop = prevTop + (newHeight - prevHeight);
        });
    }

    function _renderVisible() {
        if (!State.container) return;

        const total = State.messages.length;
        const startIdx = Math.max(0, total - State.displayLimit);
        const visible = State.messages.slice(startIdx);

        // امسح الكل ثم أعد البناء (الأبسط)
        State.container.innerHTML = '';
        State.domMap = {};
        State.lastRenderedIds = [];

        visible.forEach(function (msg) {
            const el = _buildMessageElement(msg);
            if (el) {
                State.container.appendChild(el);
                State.domMap[msg._id] = el;
                State.lastRenderedIds.push(msg._id);
            }
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Public render API                               */
    /* ══════════════════════════════════════════════ */
    function renderMessages(list) {
        if (!Array.isArray(list)) return;
        State.messages = list.slice(-CONFIG.MAX_BUFFER);
        _renderVisible();

        // إذا المستخدم كان في الأسفل → انزل
        if (_isAtBottom()) {
            setTimeout(function () { scrollToBottom(false); }, 30);
        }
    }

    function appendMessage(msg) {
        if (!msg || !msg._id) return;
        // تجنب التكرار
        const idx = State.messages.findIndex(function (m) { return m._id === msg._id; });
        if (idx === -1) {
            State.messages.push(msg);
            if (State.messages.length > CONFIG.MAX_BUFFER) {
                State.messages = State.messages.slice(-CONFIG.MAX_BUFFER);
            }
        } else {
            State.messages[idx] = msg;
        }

        const wasBottom = _isAtBottom();

        // إذا الرسالة ضمن الحد المرئي → أعد البناء
        if (State.displayLimit >= State.messages.length - 1) {
            _renderVisible();
        }

        if (wasBottom) {
            requestAnimationFrame(function () { scrollToBottom(false); });
        }
    }

    function updateMessage(msgId, updates) {
        if (!msgId) return;
        const idx = State.messages.findIndex(function (m) { return m._id === msgId; });
        if (idx === -1) return;
        State.messages[idx] = Object.assign({}, State.messages[idx], updates || {});
        // أعد بناء الرسالة فقط
        const oldEl = State.domMap[msgId];
        if (!oldEl) return;
        const newEl = _buildMessageElement(State.messages[idx]);
        if (!newEl) {
            if (oldEl.parentNode) oldEl.parentNode.removeChild(oldEl);
            delete State.domMap[msgId];
        } else {
            oldEl.parentNode.replaceChild(newEl, oldEl);
            State.domMap[msgId] = newEl;
        }
    }

    function removeMessage(msgId) {
        if (!msgId) return;
        State.messages = State.messages.filter(function (m) { return m._id !== msgId; });
        const el = State.domMap[msgId];
        if (el && el.parentNode) el.parentNode.removeChild(el);
        delete State.domMap[msgId];
    }

    function clear() {
        State.messages = [];
        State.domMap = {};
        State.lastRenderedIds = [];
        State.displayLimit = CONFIG.INITIAL_SHOW;
        if (State.container) State.container.innerHTML = '';
    }

    /* ══════════════════════════════════════════════ */
    /* Scroll APIs                                     */
    /* ══════════════════════════════════════════════ */
    function scrollToBottom(smooth) {
        const s = State.scroller;
        if (!s) return;
        try {
            s.scrollTo({ top: s.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
        } catch (e) {
            s.scrollTop = s.scrollHeight;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Bind EventBus                                   */
    /* ══════════════════════════════════════════════ */
    function _bindBus() {
        if (!window.EventBus) return;

        window.EventBus.on('chat:messages', function (payload) {
            if (!payload) return;
            if (payload.roomId && State.currentRoom && payload.roomId !== State.currentRoom) {
                State.currentRoom = payload.roomId;
                clear();
            } else if (payload.roomId && !State.currentRoom) {
                State.currentRoom = payload.roomId;
            }
            renderMessages(payload.messages || []);
        });

        window.EventBus.on('chat:cachedMessages', function (payload) {
            if (!payload || !payload.messages) return;
            // عرض سريع من IDB (قبل Firebase)
            if (State.messages.length === 0) {
                State.messages = payload.messages.slice(-CONFIG.MAX_BUFFER);
                _renderVisible();
                setTimeout(function () { scrollToBottom(false); }, 30);
            }
        });

        window.EventBus.on('chat:started', function (payload) {
            if (payload && payload.roomId) {
                State.currentRoom = payload.roomId;
            }
        });

        window.EventBus.on('chat:messageDeleted', function (payload) {
            if (!payload) return;
            updateMessage(payload.msgId, { deleted: true, text: '', originalText: '...' });
        });

        window.EventBus.on('chat:messageHidden', function (payload) {
            if (!payload) return;
            updateMessage(payload.msgId, { hidden: true });
        });

        window.EventBus.on('chat:messageEdited', function (payload) {
            if (!payload) return;
            // النص الجديد سيصل عبر listener لكن نُحدّث للسرعة
            updateMessage(payload.msgId, { edited: true });
        });

        window.EventBus.on('chat:sent', function () {
            // سيتولى onLatest التحديث تلقائياً
        });
    }

    /* ══════════════════════════════════════════════ */
    /* UI dialogs (simple)                             */
    /* ══════════════════════════════════════════════ */
    function _toast(msg) {
        if (window.showToast) {
            try { window.showToast('fa-info-circle', msg); return; } catch (e) {}
        }
        Logger.info('toast:', msg);
    }

    function _confirm(text, onYes) {
        if (!window.confirm) { onYes(); return; }
        if (window.confirm(text)) onYes();
    }

    function _prompt(text, def, onOk) {
        if (!window.prompt) { onOk(def); return; }
        const v = window.prompt(text, def || '');
        if (v !== null && v !== undefined) onOk(v);
    }

    function _showInfo(msg) {
        const info = [
            'ID: ' + (msg._id || '—'),
            'UID: ' + (msg.senderUid || '—'),
            'الاسم: ' + (msg.senderName || '—'),
            'الكود: ' + (msg.senderCode || '—'),
            'الرتبة: ' + (msg.senderRank || '—') + ' (' + (msg.senderRankLevel || '—') + ')',
            'الوقت: ' + _formatFull(msg.time),
            'الغرفة: ' + (State.currentRoom || '—'),
            'Deleted: ' + (!!msg.deleted),
            'Hidden: ' + (!!msg.hidden),
            'Edited: ' + (!!msg.edited),
            'Mentions: ' + (msg.mentions ? msg.mentions.length : 0)
        ].join('\n');
        if (window.alert) { window.alert(info); return; }
        Logger.info(info);
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _autoInit() {
        if (!State.isReady) {
            const ok = mount(null);
            if (!ok) setTimeout(_autoInit, 1500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(_autoInit, 1000);
        });
    } else {
        setTimeout(_autoInit, 1000);
    }

    /* ══════════════════════════════════════════════ */
    /* Status / Debug                                  */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            ready: State.isReady,
            hasContainer: !!State.container,
            hasScroller: !!State.scroller,
            currentRoom: State.currentRoom,
            messagesCount: State.messages.length,
            displayedCount: State.lastRenderedIds.length,
            displayLimit: State.displayLimit,
            isKing: _isKing(),
            myLevel: _myLevel()
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarChatUI = {
        CONFIG: CONFIG,
        mount: mount,
        renderMessages: renderMessages,
        appendMessage: appendMessage,
        updateMessage: updateMessage,
        removeMessage: removeMessage,
        clear: clear,
        scrollToBottom: scrollToBottom,
        isAtBottom: _isAtBottom,
        detectWhisper: _detectWhisper,
        canSeeWhisper: _canSeeWhisper,
        addReaction: function (msgId, emoji) { _toggleReaction(msgId, emoji); },
        onUiEvent: onUiEvent,
        getStatus: getStatus
    };

    Logger.info('📦 [chat-ui.js] loaded | initial:', CONFIG.INITIAL_SHOW, '| step:', CONFIG.LOAD_MORE_STEP);
})();
