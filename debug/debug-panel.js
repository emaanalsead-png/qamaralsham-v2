// ==============================================
// debug/debug-panel.js
// Mobile-friendly debug panel — no console needed
// ==============================================
// يعتمد على: (لا شيء — يعمل من أول لحظة)
// يعطي: window.QamarDebug
// ==============================================
// ⭐ التقاط شامل:
//   1. console.error / console.warn
//   2. window.onerror
//   3. unhandledrejection
//   4. حالة كل Qamar* module (loaded / missing)
//   5. حالة Firebase + Boot + Net
//   6. زر نسخ / مسح / إخفاء
//   7. فتح بـ: 5 نقرات على اللوجو، أو ?debug=1، أو QamarDebug.open()
// ==============================================

(function () {
    'use strict';

    if (window.QamarDebug) return;

    const LOG_TAG = '[DBG]';
    const MAX_ENTRIES = 60;

    /* ══════════════════════════════════════════════ */
    /* Config                                          */
    /* ══════════════════════════════════════════════ */
    const CONFIG = {
        VERSION: '1.0.0',
        // فتح تلقائي إذا URL فيه ?debug=1
        AUTO_OPEN_URL_PARAM: 'debug',
        // عدد النقرات المتتالية على 🐛 أو اللوجو لفتح البانل
        TAP_THRESHOLD: 5,
        TAP_WINDOW_MS: 3000,
        // نسخ تلقائي عند فتح مع أخطاء حرجة؟ لا.
        SHOW_BOOT_INFO: true,
        SHOW_MODULE_STATUS: true,
        SHOW_NET_STATUS: true
    };

    /* ══════════════════════════════════════════════ */
    /* قائمة كل الوحدات التي يجب أن تُحمَّل           */
    /* ══════════════════════════════════════════════ */
    const MODULE_LIST = [
        // Core
        'QamarFB', 'QamarResilience', 'QamarOpt', 'QamarCleaners',
        'QamarNet', 'QamarAdaptive',
        // Auth
        'QamarAuth', 'QamarSession', 'QamarIdentity', 'QamarRanks',
        // Security
        'QamarAudit', 'QamarDeviceGuard', 'QamarBans',
        'QamarReports', 'QamarSuspects',
        // Chat
        'QamarChat', 'QamarChatUI', 'QamarChatInput',
        'QamarChatEffects', 'QamarNameEffects',
        // Rooms
        'QamarRooms', 'QamarRoomVoice', 'QamarRoomSettings',
        // PM
        'QamarPM', 'QamarPMVoice', 'QamarPMMonitor',
        'QamarPMArchiver', 'QamarGuardianQueue',
        // Voice
        'QamarVoiceSystem', 'QamarVoiceStudio', 'QamarVoiceMonitor',
        // Bots
        'QamarBots', 'QamarBotCommands', 'QamarBotTraining', 'QamarGuardianInbox',
        // King
        'QamarKingActions', 'QamarKingQueens', 'QamarKingRoom',
        // Boot
        'QamarBoot'
    ];

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        entries: [],       // { type, at, text, detail }
        panelEl: null,
        bodyEl: null,
        fabEl: null,
        isOpen: false,
        tapCount: 0,
        tapTimer: null,
        startTime: Date.now(),
        _initialized: false,
        _errorsCount: 0,
        _warnsCount: 0
    };

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _ts() {
        const d = new Date();
        return String(d.getHours()).padStart(2, '0') + ':' +
               String(d.getMinutes()).padStart(2, '0') + ':' +
               String(d.getSeconds()).padStart(2, '0');
    }

    function _esc(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _timeAgo(ts) {
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 60) return s + 'ث';
        const m = Math.floor(s / 60);
        if (m < 60) return m + 'د';
        return Math.floor(m / 60) + 'س';
    }

    /* ══════════════════════════════════════════════ */
    /* Log capture                                     */
    /* ══════════════════════════════════════════════ */
    function _addEntry(type, text, detail) {
        const entry = {
            type: type,        // 'error' | 'warn' | 'info' | 'success'
            at: Date.now(),
            text: String(text || '').substring(0, 500),
            detail: detail ? String(detail).substring(0, 800) : ''
        };
        State.entries.push(entry);
        if (State.entries.length > MAX_ENTRIES) {
            State.entries.shift();
        }

        if (type === 'error') State._errorsCount++;
        if (type === 'warn') State._warnsCount++;

        _updateFab();
        if (State.isOpen) _renderBody();
    }

    function _stringify(args) {
        return Array.prototype.slice.call(args).map(function (a) {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.name + ': ' + a.message;
            if (typeof a === 'object') {
                try { return JSON.stringify(a); } catch (e) { return String(a); }
            }
            return String(a);
        }).join(' ');
    }

    function _installConsoleHooks() {
        if (window.__qamarConsoleHooked) return;
        window.__qamarConsoleHooked = true;

        const origError = console.error;
        const origWarn = console.warn;
        const origLog = console.log;

        console.error = function () {
            try {
                _addEntry('error', _stringify(arguments));
            } catch (e) {}
            return origError.apply(console, arguments);
        };

        console.warn = function () {
            try {
                _addEntry('warn', _stringify(arguments));
            } catch (e) {}
            return origWarn.apply(console, arguments);
        };

        console.log = function () {
            // فقط QAMAR_DEBUG=true نسجّل logs
            if (window.QAMAR_DEBUG) {
                try {
                    const s = _stringify(arguments);
                    if (s.indexOf('[DBG]') !== 0) {
                        _addEntry('info', s);
                    }
                } catch (e) {}
            }
            return origLog.apply(console, arguments);
        };
    }

    function _installGlobalHooks() {
        window.addEventListener('error', function (ev) {
            const msg = ev.message || 'Script error';
            const loc = ev.filename ? (' @ ' + ev.filename + ':' + (ev.lineno || '?')) : '';
            _addEntry('error', msg + loc, ev.error && ev.error.stack ? ev.error.stack : '');
        });

        window.addEventListener('unhandledrejection', function (ev) {
            const reason = ev.reason;
            let msg = 'Unhandled rejection';
            let detail = '';
            if (reason) {
                if (reason.message) msg = reason.message;
                else if (typeof reason === 'string') msg = reason;
                if (reason.stack) detail = reason.stack;
            }
            _addEntry('error', msg, detail);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Status collectors                               */
    /* ══════════════════════════════════════════════ */
    function _getModuleStatus() {
        const out = { loaded: [], missing: [] };
        MODULE_LIST.forEach(function (name) {
            if (typeof window[name] !== 'undefined' && window[name] !== null) {
                out.loaded.push(name);
            } else {
                out.missing.push(name);
            }
        });
        return out;
    }

    function _getBootStatus() {
        try {
            if (window.QamarBoot && typeof window.QamarBoot.status === 'function') {
                return window.QamarBoot.status();
            }
        } catch (e) {}
        return {
            status: window.__qamarBooted ? 'ready' : 'pending',
            elapsed: Date.now() - State.startTime,
            timings: window.__qamarBootTimings || {}
        };
    }

    function _getFBStatus() {
        try {
            const out = {
                hasAuth: !!window.auth,
                hasDB: !!window.db,
                user: window.auth && window.auth.currentUser
                    ? (window.auth.currentUser.isAnonymous ? 'guest' : 'member')
                    : 'none',
                uid: window.auth && window.auth.currentUser
                    ? window.auth.currentUser.uid.substring(0, 8)
                    : null
            };
            if (window.QamarFB && window.QamarFB.isReady) {
                out.ready = window.QamarFB.isReady();
            }
            if (window.QamarResilience && window.QamarResilience.getStats) {
                const rs = window.QamarResilience.getStats();
                out.connected = rs.connected;
                out.reconnects = rs.reconnectCount;
            }
            return out;
        } catch (e) {
            return { error: e.message };
        }
    }

    function _getNetStatus() {
        try {
            if (window.QamarNet && typeof window.QamarNet.getStatus === 'function') {
                const s = window.QamarNet.getStatus();
                return {
                    profile: s.current,
                    score: s.score,
                    rtt: s.metrics && s.metrics.rtt,
                    effectiveType: s.metrics && s.metrics.effectiveType,
                    online: s.metrics && s.metrics.online
                };
            }
        } catch (e) {}
        return { profile: '—', score: '—' };
    }

    /* ══════════════════════════════════════════════ */
    /* FAB (Floating Button)                           */
    /* ══════════════════════════════════════════════ */
    function _ensureFab() {
        if (State.fabEl && State.fabEl.parentNode) return State.fabEl;

        const fab = document.createElement('div');
        fab.id = 'qamar-debug-fab';
        fab.style.cssText =
            'position:fixed;bottom:80px;left:12px;z-index:9998;' +
            'width:34px;height:34px;border-radius:50%;' +
            'background:rgba(30,30,40,0.75);' +
            'border:1px solid rgba(212,175,55,0.4);' +
            'display:flex;align-items:center;justify-content:center;' +
            'font-size:15px;cursor:pointer;user-select:none;' +
            'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
            'box-shadow:0 4px 12px rgba(0,0,0,0.4);' +
            'transition:transform 0.15s;';
        fab.textContent = '🐛';

        fab.onclick = function (e) {
            e.stopPropagation();
            _handleTap();
        };

        document.body.appendChild(fab);
        State.fabEl = fab;
        _updateFab();
        return fab;
    }

    function _updateFab() {
        const fab = State.fabEl;
        if (!fab) return;
        const errs = State._errorsCount;
        if (errs > 0) {
            fab.style.background = 'rgba(180,20,20,0.9)';
            fab.style.borderColor = '#ff4444';
            fab.textContent = '🐛' + (errs > 9 ? '!' : errs);
        } else {
            fab.style.background = 'rgba(30,30,40,0.75)';
            fab.style.borderColor = 'rgba(212,175,55,0.4)';
            fab.textContent = '🐛';
        }
    }

    function _handleTap() {
        State.tapCount++;
        if (State.tapTimer) clearTimeout(State.tapTimer);

        if (State.tapCount >= CONFIG.TAP_THRESHOLD) {
            State.tapCount = 0;
            _open();
            return;
        }

        // فتح بنقرة واحدة على 🐛 (بما أنه صغير)
        // لكن نُبقي الـ5 نقرات خياراً للحالات الحساسة
        // نفتح فوراً:
        _open();
        State.tapCount = 0;
    }

    /* ══════════════════════════════════════════════ */
    /* Panel UI                                        */
    /* ══════════════════════════════════════════════ */
    function _buildPanel() {
        if (State.panelEl && State.panelEl.parentNode) return State.panelEl;

        const ov = document.createElement('div');
        ov.id = 'qamar-debug-panel';
        ov.style.cssText =
            'position:fixed;inset:0;z-index:9999;' +
            'background:rgba(0,0,0,0.94);' +
            'display:none;flex-direction:column;' +
            'direction:rtl;font-family:inherit;color:#f3f4f6;' +
            'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';

        // Head
        const head = document.createElement('div');
        head.style.cssText =
            'padding:12px 14px;' +
            'background:linear-gradient(135deg,rgba(168,85,247,0.2),rgba(0,0,0,0.4));' +
            'border-bottom:2px solid rgba(168,85,247,0.5);' +
            'display:flex;align-items:center;gap:8px;' +
            'padding-top:max(12px,env(safe-area-inset-top));';

        head.innerHTML =
            '<div style="font-size:20px;">🐛</div>' +
            '<div style="flex:1;">' +
                '<div style="font-size:14px;font-weight:900;color:#c084fc;">Debug Panel</div>' +
                '<div style="font-size:10px;color:#888;">v' + CONFIG.VERSION + ' · ' +
                    'نقر سريع على 🐛 للفتح' +
                '</div>' +
            '</div>' +
            '<button id="qd-copy" style="background:#3b82f6;color:#fff;border:none;' +
                'padding:8px 12px;border-radius:8px;font-family:inherit;' +
                'font-weight:900;font-size:11px;cursor:pointer;">📋 نسخ</button>' +
            '<button id="qd-clear" style="background:rgba(255,68,68,0.85);color:#fff;border:none;' +
                'padding:8px 12px;border-radius:8px;font-family:inherit;' +
                'font-weight:900;font-size:11px;cursor:pointer;">🗑️</button>' +
            '<button id="qd-close" style="background:rgba(255,255,255,0.1);color:#fff;border:none;' +
                'width:32px;height:32px;border-radius:50%;font-size:14px;' +
                'cursor:pointer;font-weight:900;">✕</button>';
        ov.appendChild(head);

        // Body
        const body = document.createElement('div');
        body.id = 'qd-body';
        body.style.cssText =
            'flex:1;overflow-y:auto;padding:10px;' +
            '-webkit-overflow-scrolling:touch;';
        ov.appendChild(body);
        State.bodyEl = body;

        // Actions bottom
        const actions = document.createElement('div');
        actions.style.cssText =
            'padding:10px;padding-bottom:max(10px,env(safe-area-inset-bottom));' +
            'border-top:1px solid rgba(168,85,247,0.3);' +
            'display:flex;gap:6px;flex-wrap:wrap;';

        actions.innerHTML =
            '<button id="qd-reload" style="flex:1;padding:10px;background:#84cc16;color:#fff;' +
                'border:none;border-radius:8px;font-family:inherit;font-weight:900;' +
                'font-size:12px;cursor:pointer;">🔄 إعادة تحميل</button>' +
            '<button id="qd-hard" style="flex:1;padding:10px;background:#ef4444;color:#fff;' +
                'border:none;border-radius:8px;font-family:inherit;font-weight:900;' +
                'font-size:12px;cursor:pointer;">💥 Hard Reset</button>';
        ov.appendChild(actions);

        document.body.appendChild(ov);
        State.panelEl = ov;

        // Events
        ov.querySelector('#qd-close').onclick = _close;
        ov.querySelector('#qd-copy').onclick = _copyAll;
        ov.querySelector('#qd-clear').onclick = _clearAll;
        ov.querySelector('#qd-reload').onclick = function () {
            try { window.location.reload(); } catch (e) {}
        };
        ov.querySelector('#qd-hard').onclick = function () {
            if (!confirm('Hard Reset: مسح localStorage + إعادة تحميل؟')) return;
            try { localStorage.clear(); } catch (e) {}
            try { sessionStorage.clear(); } catch (e) {}
            try { window.location.reload(true); } catch (e) {}
        };

        return ov;
    }

    /* ══════════════════════════════════════════════ */
    /* Render body                                     */
    /* ══════════════════════════════════════════════ */
    function _renderBody() {
        const body = State.bodyEl;
        if (!body) return;

        body.innerHTML = '';

        // 1) Header chips: Boot, FB, Net
        const statuses = document.createElement('div');
        statuses.style.cssText =
            'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));' +
            'gap:6px;margin-bottom:10px;';

        const boot = _getBootStatus();
        const fb = _getFBStatus();
        const net = _getNetStatus();

        statuses.appendChild(_chip(
            '⏱️ Boot',
            (boot.status || '—') + ' · ' + ((boot.elapsed || 0) / 1000).toFixed(1) + 'ث',
            boot.status === 'ready' ? '#84cc16' : '#f59e0b'
        ));
        statuses.appendChild(_chip(
            '🔥 Firebase',
            (fb.ready ? 'ready' : 'not-ready') +
                (fb.connected === true ? ' · connected' : (fb.connected === false ? ' · offline' : '')),
            fb.ready ? '#84cc16' : '#ff4444'
        ));
        statuses.appendChild(_chip(
            '👤 User',
            fb.user + (fb.uid ? ' (' + fb.uid + ')' : ''),
            fb.user === 'none' ? '#6b7280' : '#3b82f6'
        ));
        statuses.appendChild(_chip(
            '📶 Net',
            net.profile + ' · ' + net.score +
                (net.rtt ? ' · ' + net.rtt + 'ms' : ''),
            net.profile === 'fast' ? '#84cc16' :
                net.profile === 'medium' ? '#3b82f6' :
                net.profile === 'slow' ? '#f59e0b' : '#ef4444'
        ));
        statuses.appendChild(_chip(
            '❌ Errors',
            String(State._errorsCount),
            State._errorsCount > 0 ? '#ef4444' : '#6b7280'
        ));
        statuses.appendChild(_chip(
            '⚠️ Warnings',
            String(State._warnsCount),
            State._warnsCount > 0 ? '#f59e0b' : '#6b7280'
        ));

        body.appendChild(statuses);

        // 2) Modules status
        if (CONFIG.SHOW_MODULE_STATUS) {
            const mods = _getModuleStatus();
            const mWrap = document.createElement('div');
            mWrap.style.cssText =
                'background:rgba(255,255,255,0.03);' +
                'border:1px solid rgba(168,85,247,0.2);' +
                'border-radius:10px;padding:10px;margin-bottom:10px;';

            let html = '<div style="font-size:11px;font-weight:900;color:#c084fc;margin-bottom:6px;">' +
                '📦 Modules: ' + mods.loaded.length + '/' + MODULE_LIST.length + ' محمّل</div>';

            if (mods.missing.length > 0) {
                html += '<div style="font-size:10px;color:#ff8888;line-height:1.6;">' +
                    '❌ ناقص: ' + mods.missing.join(', ') +
                    '</div>';
            } else {
                html += '<div style="font-size:10px;color:#84cc16;">✅ كل الوحدات محمّلة</div>';
            }

            mWrap.innerHTML = html;
            body.appendChild(mWrap);
        }

        // 3) Errors list
        const errsWrap = document.createElement('div');
        errsWrap.style.cssText =
            'background:rgba(255,255,255,0.03);' +
            'border:1px solid rgba(239,68,68,0.3);' +
            'border-radius:10px;padding:10px;margin-bottom:10px;';

        let errsHtml = '<div style="font-size:11px;font-weight:900;color:#ff8888;margin-bottom:6px;">' +
            '📋 السجل (' + State.entries.length + ')</div>';

        if (State.entries.length === 0) {
            errsHtml += '<div style="text-align:center;color:#666;font-size:11px;padding:14px;">' +
                'لا أخطاء — كل شيء جيد ✅</div>';
        } else {
            // الأحدث أولاً
            State.entries.slice().reverse().forEach(function (e) {
                const color = e.type === 'error' ? '#ff8888' :
                              e.type === 'warn' ? '#fbbf24' :
                              e.type === 'success' ? '#84cc16' : '#9ca3af';
                const icon = e.type === 'error' ? '❌' :
                             e.type === 'warn' ? '⚠️' :
                             e.type === 'success' ? '✅' : 'ℹ️';

                errsHtml +=
                    '<div style="padding:6px 8px;background:rgba(0,0,0,0.3);' +
                        'border-radius:6px;margin-bottom:4px;' +
                        'border-right:3px solid ' + color + ';">' +
                        '<div style="font-size:10px;color:#888;font-weight:900;">' +
                            icon + ' ' + _ts() + ' (' + _timeAgo(e.at) + ')' +
                        '</div>' +
                        '<div style="font-size:11px;color:' + color + ';' +
                            'margin-top:3px;word-break:break-word;' +
                            'white-space:pre-wrap;line-height:1.5;">' +
                            _esc(e.text) +
                        '</div>' +
                        (e.detail ?
                            '<div style="font-size:9px;color:#555;' +
                                'margin-top:3px;max-height:60px;overflow:hidden;' +
                                'text-overflow:ellipsis;">' +
                                _esc(e.detail.substring(0, 200)) +
                            '</div>' : '') +
                    '</div>';
            });
        }

        errsWrap.innerHTML = errsHtml;
        body.appendChild(errsWrap);
    }

    function _chip(label, value, color) {
        const c = document.createElement('div');
        c.style.cssText =
            'background:rgba(0,0,0,0.4);border:1px solid ' + color + '40;' +
            'border-radius:8px;padding:6px 8px;' +
            'border-right:3px solid ' + color + ';';
        c.innerHTML =
            '<div style="font-size:9px;color:#888;font-weight:900;">' + _esc(label) + '</div>' +
            '<div style="font-size:11px;color:' + color + ';font-weight:900;' +
                'margin-top:2px;word-break:break-word;">' + _esc(value) + '</div>';
        return c;
    }

    /* ══════════════════════════════════════════════ */
    /* Actions                                         */
    /* ══════════════════════════════════════════════ */
    function _copyAll() {
        const boot = _getBootStatus();
        const fb = _getFBStatus();
        const net = _getNetStatus();
        const mods = _getModuleStatus();

        const lines = [
            '═══ Qamar Debug Report ═══',
            'Time: ' + new Date().toLocaleString('ar-EG'),
            'URL: ' + (window.location.href || ''),
            'UA: ' + (navigator.userAgent || ''),
            '',
            '── Boot ──',
            JSON.stringify(boot, null, 2),
            '',
            '── Firebase ──',
            JSON.stringify(fb, null, 2),
            '',
            '── Net ──',
            JSON.stringify(net, null, 2),
            '',
            '── Modules ──',
            'Loaded: ' + mods.loaded.length + '/' + MODULE_LIST.length,
            'Missing: ' + (mods.missing.join(', ') || 'none'),
            '',
            '── Logs (' + State.entries.length + ') ──'
        ];

        State.entries.forEach(function (e) {
            lines.push('[' + _ts() + '] ' + e.type.toUpperCase() + ': ' + e.text);
            if (e.detail) lines.push('   ' + e.detail.substring(0, 200));
        });

        const text = lines.join('\n');

        // Copy — نجرّب clipboard ثم fallback
        const done = function () {
            _toast('📋 تم النسخ — الصقه في المحادثة');
        };
        const fail = function () {
            // fallback — أنشئ textarea
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                done();
            } catch (e) {
                _toast('❌ فشل النسخ — جرّب تحديد النص يدوياً');
                // افتح textarea معروض
                const ta2 = document.createElement('textarea');
                ta2.value = text;
                ta2.style.cssText =
                    'position:fixed;inset:20px;z-index:10000;' +
                    'background:#000;color:#fff;border:1px solid #ffd700;' +
                    'border-radius:8px;padding:10px;font-family:monospace;' +
                    'font-size:10px;direction:ltr;';
                document.body.appendChild(ta2);
                ta2.focus();
                ta2.select();
            }
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(fail);
        } else {
            fail();
        }
    }

    function _clearAll() {
        State.entries = [];
        State._errorsCount = 0;
        State._warnsCount = 0;
        _updateFab();
        _renderBody();
        _toast('🗑️ تم مسح السجل');
    }

    function _toast(msg) {
        if (window.showToast) {
            try { window.showToast('fa-bug', msg); return; } catch (e) {}
        }
        // toast بسيط
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText =
            'position:fixed;top:20px;right:20px;z-index:10000;' +
            'background:rgba(15,15,20,0.95);color:#fff;' +
            'padding:10px 16px;border-radius:10px;' +
            'border:1px solid rgba(212,175,55,0.5);' +
            'font-family:inherit;font-size:12px;font-weight:900;' +
            'direction:rtl;';
        document.body.appendChild(t);
        setTimeout(function () {
            if (t.parentNode) t.parentNode.removeChild(t);
        }, 2500);
    }

    /* ══════════════════════════════════════════════ */
    /* Open / Close                                    */
    /* ══════════════════════════════════════════════ */
    function _open() {
        if (!State.panelEl) _buildPanel();
        State.panelEl.style.display = 'flex';
        State.isOpen = true;
        _renderBody();
    }

    function _close() {
        if (!State.panelEl) return;
        State.panelEl.style.display = 'none';
        State.isOpen = false;
    }

    function _shouldAutoOpen() {
        try {
            const url = new URL(window.location.href);
            return url.searchParams.get(CONFIG.AUTO_OPEN_URL_PARAM) === '1';
        } catch (e) {
            return window.location.search.indexOf('debug=1') !== -1;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Hooks into Boot / Auth                          */
    /* ══════════════════════════════════════════════ */
    function _installBusHooks() {
        if (!window.EventBus) return;

        window.EventBus.on('boot:ready', function () {
            _addEntry('success', '✅ Boot ready');
        });
        window.EventBus.on('boot:failed', function (p) {
            _addEntry('error', '❌ Boot failed: ' + (p && p.reason ? p.reason : 'unknown'));
        });
        window.EventBus.on('auth:state', function (p) {
            _addEntry('info', 'Auth state: ' + (p.isLoggedIn ? (p.isGuest ? 'guest' : 'member') : 'none'));
        });
        window.EventBus.on('auth:error', function (err) {
            _addEntry('error', 'Auth error: ' + (err && err.message ? err.message : err));
        });
        window.EventBus.on('net:changed', function (p) {
            _addEntry('info', 'Net: ' + p.from + ' → ' + p.to + ' (' + p.score + ')');
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;

        _installConsoleHooks();
        _installGlobalHooks();

        // FAB بعد تحميل DOM
        setTimeout(function () {
            _ensureFab();
            _installBusHooks();
        }, 500);

        // فتح تلقائي إذا ?debug=1
        if (_shouldAutoOpen()) {
            setTimeout(_open, 800);
        }

        // معلومات بداية
        setTimeout(function () {
            _addEntry('info', 'Debug ready · ' + (navigator.userAgent || '').substring(0, 60));
        }, 200);

        try { console.log(LOG_TAG + ' loaded'); } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarDebug = {
        VERSION: CONFIG.VERSION,
        open: _open,
        close: _close,
        isOpen: function () { return State.isOpen; },
        log: function (text) { _addEntry('info', text); },
        warn: function (text) { _addEntry('warn', text); },
        error: function (text) { _addEntry('error', text); },
        success: function (text) { _addEntry('success', text); },
        getEntries: function () { return State.entries.slice(); },
        clear: _clearAll,
        copyReport: _copyAll,
        getStatus: function () {
            return {
                isOpen: State.isOpen,
                entriesCount: State.entries.length,
                errorsCount: State._errorsCount,
                warnsCount: State._warnsCount,
                modules: _getModuleStatus()
            };
        }
    };

    try { console.log(LOG_TAG + ' 📦 [debug-panel.js] loaded'); } catch (e) {}
})();
