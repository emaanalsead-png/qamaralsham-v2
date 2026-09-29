// ==============================================
// king/king-room.js
// King panel — 10 permission-gated tabs
// ==============================================
// يعتمد على: king-actions.js + firebase.js + auth.js + ranks.js + bot-commands.js + bans.js + rooms.js + bot-training.js + reports.js + device-guard.js
// يعطي: window.QamarKingRoom
// ==============================================
// ⚡ تحسينات السرعة:
//   1. Lazy load — كل تبويب يُحمّل عند فتحه فقط
//   2. cache 30s لكل تبويب
//   3. لا listeners — فقط once('value')
//   4. limitToLast(300) للمستخدمين
//   5. بحث client-side (لا Firebase read)
//   6. زر "تحديث" في كل تبويب
//   7. تصفية الصلاحيات قبل بناء التبويبات
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [king-room] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[KR]';
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
        KING_LEVEL: 100,
        ROYAL_LEVEL: 90,
        USER_LIMIT: 300,
        REPORT_LIMIT: 100,
        MULTI_LIMIT: 100,
        BAN_LIMIT: 200,
        PAGE_SIZE: 15,
        CACHE_TTL_MS: 30 * 1000
    };

    /* ══════════════════════════════════════════════ */
    /* Tabs registry — الصلاحيات لكل تبويب            */
    /* ══════════════════════════════════════════════ */
    const TABS = {
        overview:      { label: '📊', title: 'نظرة عامة',    kingOnly: false, anyOf: ['canOpenKingRoom'] },
        users:         { label: '👥', title: 'المستخدمون',    kingOnly: false, anyOf: ['canOpenKingRoom'] },
        ranks:         { label: '🎖️', title: 'الإداريون',     kingOnly: false, anyOf: ['canPromote', 'canDemote'] },
        royals:        { label: '👑', title: 'الملوك',        kingOnly: false, anyOf: ['canOpenKingRoom'], special: 'royals' },
        punishments:   { label: '🚫', title: 'المعاقبون',     kingOnly: false, anyOf: ['canWarn', 'canJail', 'canBan'] },
        reports:       { label: '🚨', title: 'التقارير',      kingOnly: false, anyOf: ['canViewReports'] },
        multiAccount:  { label: '🚨', title: 'المكرّرة',      kingOnly: false, anyOf: ['canViewDevices'] },
        bans:          { label: '🛡️', title: 'إدارة البان',   kingOnly: false, anyOf: ['canBanDevice', 'canBanIP'] },
        rooms:         { label: '🚪', title: 'الغرف',         kingOnly: false, anyOf: ['canEditRooms'] },
        bots:          { label: '🤖', title: 'البوتات',       kingOnly: false, anyOf: ['canTrainBots', 'canOpenKingPanel'] },
        alerts:        { label: '📢', title: 'التنبيهات',     kingOnly: false, anyOf: ['canSendRoomAlert'] }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        open: false,
        activeTab: null,
        cache: {},           // { tabId: { data, at } }
        loading: {},         // { tabId: true }
        filters: {},         // { tabId: { search, page, filter } }
        modalEl: null,
        bodyEl: null,
        tabsEl: null,
        listeners: [],
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

    function _isKing100() { return _myLevel() >= CONFIG.KING_LEVEL; }

    function _canDo(permKey) {
        if (_isKing100()) return true;
        if (window.QamarRanks && typeof window.QamarRanks.hasPermission === 'function') {
            return window.QamarRanks.hasPermission(permKey);
        }
        return false;
    }

    function _canSeeTab(tabId) {
        const t = TABS[tabId];
        if (!t) return false;
        if (t.kingOnly) return _isKing100();
        if (!t.anyOf || !t.anyOf.length) return true;
        for (let i = 0; i < t.anyOf.length; i++) {
            if (_canDo(t.anyOf[i])) return true;
        }
        return false;
    }

    function _esc(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function _toast(msg, icon) {
        if (window.showToast) { try { window.showToast(icon || 'fa-info-circle', msg); return; } catch (e) {} }
        Logger.info(msg);
    }

    function _timeAgo(ts) {
        if (!ts) return '—';
        const d = Math.floor((Date.now() - ts) / 1000);
        if (d < 60) return 'الآن';
        const m = Math.floor(d / 60);
        if (m < 60) return 'قبل ' + m + ' د';
        const h = Math.floor(m / 60);
        if (h < 24) return 'قبل ' + h + ' س';
        const dd = Math.floor(h / 24);
        return 'قبل ' + dd + ' ي';
    }

    function _now() { return Date.now(); }

    function _emit(name, payload) {
        if (window.EventBus) {
            try { window.EventBus.emit(name, payload); } catch (e) {}
        }
        State.listeners.slice().forEach(function (cb) {
            try { cb({ type: name, data: payload }); } catch (e) {}
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Cache                                           */
    /* ══════════════════════════════════════════════ */
    function _cacheGet(tabId) {
        const c = State.cache[tabId];
        if (!c) return null;
        if (_now() - c.at > CONFIG.CACHE_TTL_MS) {
            delete State.cache[tabId];
            return null;
        }
        return c.data;
    }

    function _cacheSet(tabId, data) {
        State.cache[tabId] = { data: data, at: _now() };
    }

    function _cacheClear(tabId) {
        if (tabId) delete State.cache[tabId];
        else State.cache = {};
    }

    /* ══════════════════════════════════════════════ */
    /* Styles                                          */
    /* ══════════════════════════════════════════════ */
    function _ensureStyles() {
        if (document.getElementById('kr-styles')) return;
        const s = document.createElement('style');
        s.id = 'kr-styles';
        s.textContent = [
            '#kr-overlay{position:fixed;inset:0;z-index:14000;background:linear-gradient(180deg,#050508,#0a0a15);',
            'display:none;flex-direction:column;direction:rtl;font-family:inherit;color:#f3f4f6;}',
            '#kr-overlay.active{display:flex;}',

            '#kr-head{padding:12px 16px;background:linear-gradient(135deg,rgba(212,175,55,0.2),rgba(0,0,0,0.4));',
            'border-bottom:2px solid #d4af37;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;}',
            '#kr-head h3{color:#ffd700;margin:0;font-size:15px;font-weight:900;display:flex;align-items:center;gap:8px;}',
            '#kr-head-info{color:#888;font-size:11px;font-weight:700;}',
            '#kr-close{background:rgba(255,68,68,0.2);border:1px solid rgba(255,68,68,0.5);color:#ff7777;',
            'width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:14px;font-weight:900;padding:0;}',

            '#kr-tabs{display:flex;overflow-x:auto;background:rgba(0,0,0,0.3);',
            'border-bottom:1px solid rgba(212,175,55,0.25);flex-shrink:0;scrollbar-width:none;}',
            '#kr-tabs::-webkit-scrollbar{display:none;}',
            '.kr-tab{padding:10px 14px;background:transparent;border:none;border-bottom:3px solid transparent;',
            'color:#999;font-family:inherit;font-size:12px;font-weight:900;cursor:pointer;',
            'white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:5px;}',
            '.kr-tab.active{color:#ffd700;border-bottom-color:#ffd700;background:rgba(212,175,55,0.1);}',
            '.kr-tab:hover{color:#ffd700;}',

            '#kr-body{flex:1;overflow-y:auto;padding:12px;}',

            '.kr-toolbar{display:flex;gap:8px;padding:10px 12px;background:rgba(0,0,0,0.2);',
            'border-bottom:1px solid rgba(212,175,55,0.15);flex-wrap:wrap;align-items:center;flex-shrink:0;}',
            '.kr-search{flex:1;min-width:160px;padding:9px 14px;background:rgba(255,255,255,0.06);',
            'border:1px solid rgba(212,175,55,0.3);border-radius:10px;color:#fff;font-family:inherit;',
            'font-size:13px;outline:none;text-align:right;box-sizing:border-box;}',
            '.kr-search:focus{border-color:#ffd700;}',
            '.kr-btn{padding:9px 14px;border-radius:10px;border:none;font-family:inherit;',
            'font-weight:900;font-size:12px;cursor:pointer;white-space:nowrap;}',
            '.kr-btn.gold{background:#ffd700;color:#000;}',
            '.kr-btn.outline{background:rgba(255,255,255,0.05);color:#fff;border:1px solid rgba(212,175,55,0.3);}',
            '.kr-btn.danger{background:rgba(255,68,68,0.85);color:#fff;}',
            '.kr-btn.blue{background:#3b82f6;color:#fff;}',
            '.kr-btn.green{background:#84cc16;color:#fff;}',
            '.kr-btn:disabled{opacity:0.5;cursor:wait;}',

            '.kr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px;}',
            '.kr-stat{background:linear-gradient(135deg,rgba(255,215,0,0.08),rgba(0,0,0,0.3));',
            'border:1px solid rgba(212,175,55,0.3);border-radius:12px;padding:14px;text-align:center;}',
            '.kr-stat-val{font-size:24px;font-weight:900;color:#ffd700;line-height:1.1;}',
            '.kr-stat-lbl{color:#888;font-size:11px;margin-top:4px;font-weight:700;}',

            '.kr-card{background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.2);',
            'border-radius:12px;padding:12px;margin-bottom:10px;}',

            '.kr-row{display:flex;align-items:center;gap:10px;padding:10px;',
            'background:rgba(255,255,255,0.03);border:1px solid rgba(212,175,55,0.12);',
            'border-radius:10px;margin-bottom:8px;}',
            '.kr-row-av{width:42px;height:42px;border-radius:50%;border:2px solid #d4af37;',
            'object-fit:cover;flex-shrink:0;background:#111;cursor:pointer;}',
            '.kr-row-info{flex:1;min-width:0;}',
            '.kr-row-name{color:#fff;font-weight:900;font-size:13px;white-space:nowrap;',
            'overflow:hidden;text-overflow:ellipsis;cursor:pointer;}',
            '.kr-row-sub{color:#888;font-size:10px;margin-top:2px;white-space:nowrap;',
            'overflow:hidden;text-overflow:ellipsis;}',
            '.kr-row-badges{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;}',
            '.kr-badge{padding:2px 8px;border-radius:20px;font-size:9px;font-weight:900;}',
            '.kr-badge.king{background:rgba(255,215,0,0.25);color:#ffd700;}',
            '.kr-badge.queen{background:rgba(255,105,180,0.25);color:#ff9ecb;}',
            '.kr-badge.admin{background:rgba(59,130,246,0.25);color:#93c5fd;}',
            '.kr-badge.ban{background:rgba(239,68,68,0.25);color:#ff8888;}',
            '.kr-badge.jail{background:rgba(255,152,0,0.25);color:#ffbb66;}',
            '.kr-badge.warn{background:rgba(251,191,36,0.25);color:#fbbf24;}',
            '.kr-badge.guest{background:rgba(148,163,184,0.3);color:#cbd5e1;}',
            '.kr-row-actions{display:flex;gap:5px;flex-shrink:0;}',
            '.kr-icon-btn{width:32px;height:32px;border-radius:9px;background:rgba(0,0,0,0.3);',
            'border:1px solid rgba(212,175,55,0.25);color:#fff;font-size:13px;cursor:pointer;',
            'display:flex;align-items:center;justify-content:center;padding:0;}',
            '.kr-icon-btn:active{transform:scale(0.92);}',

            '.kr-empty{text-align:center;color:#666;padding:40px 20px;font-size:13px;}',
            '.kr-loading{text-align:center;color:#ffd700;padding:30px;font-size:13px;}',
            '.kr-warn-box{background:rgba(255,152,0,0.1);border:1px solid rgba(255,152,0,0.4);',
            'color:#fbbf24;font-size:12px;font-weight:700;padding:10px 14px;border-radius:10px;',
            'margin-bottom:10px;text-align:center;}'
        ].join('');
        document.head.appendChild(s);
    }

    /* ══════════════════════════════════════════════ */
    /* Modal structure                                 */
    /* ══════════════════════════════════════════════ */
    function _ensureModal() {
        if (State.modalEl && State.modalEl.parentNode) return State.modalEl;

        const ov = document.createElement('div');
        ov.id = 'kr-overlay';

        ov.innerHTML =
            '<div id="kr-head">' +
                '<h3>👑 غرفة الملك <span id="kr-head-info"></span></h3>' +
                '<button id="kr-close" type="button">✕</button>' +
            '</div>' +
            '<div id="kr-tabs"></div>' +
            '<div id="kr-body"></div>';

        document.body.appendChild(ov);

        State.modalEl = ov;
        State.tabsEl = ov.querySelector('#kr-tabs');
        State.bodyEl = ov.querySelector('#kr-body');

        ov.querySelector('#kr-close').onclick = close;

        return ov;
    }

    /* ══════════════════════════════════════════════ */
    /* Tabs render                                     */
    /* ══════════════════════════════════════════════ */
    function _renderTabs() {
        const el = State.tabsEl;
        if (!el) return;
        el.innerHTML = '';

        const allowed = Object.keys(TABS).filter(_canSeeTab);
        if (!allowed.length) {
            el.innerHTML = '<div style="padding:14px;color:#888;font-size:12px;">لا تبويبات متاحة</div>';
            return;
        }

        if (!State.activeTab || allowed.indexOf(State.activeTab) === -1) {
            State.activeTab = allowed[0];
        }

        allowed.forEach(function (tabId) {
            const t = TABS[tabId];
            const btn = document.createElement('button');
            btn.className = 'kr-tab' + (State.activeTab === tabId ? ' active' : '');
            btn.dataset.tab = tabId;
            btn.innerHTML = '<span>' + t.label + '</span><span>' + t.title + '</span>';
            btn.onclick = function () { switchTab(tabId); };
            el.appendChild(btn);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Switch tab                                      */
    /* ══════════════════════════════════════════════ */
    function switchTab(tabId, forceRefresh) {
        if (!TABS[tabId] || !_canSeeTab(tabId)) {
            _toast('لا صلاحية لهذا التبويب', 'fa-lock');
            return;
        }

        // حدّث الـ active
        if (State.tabsEl) {
            State.tabsEl.querySelectorAll('.kr-tab').forEach(function (b) {
                b.classList.toggle('active', b.dataset.tab === tabId);
            });
        }

        const isSameTab = (State.activeTab === tabId);
        State.activeTab = tabId;

        // init filter
        if (!State.filters[tabId]) {
            State.filters[tabId] = { search: '', page: 1, filter: null };
        }

        // cache
        if (!forceRefresh) {
            const cached = _cacheGet(tabId);
            if (cached) {
                _renderTab(tabId, cached);
                return;
            }
        }

        // لا نُعيد التحميل إذا كان نفس التبويب محمّلاً (إلا عند forceRefresh)
        if (isSameTab && !forceRefresh && State.loading[tabId] !== true) {
            const cached2 = _cacheGet(tabId);
            if (cached2) { _renderTab(tabId, cached2); return; }
        }

        // حمّل
        _loadTab(tabId, forceRefresh);
    }

    /* ══════════════════════════════════════════════ */
    /* Load dispatcher                                 */
    /* ══════════════════════════════════════════════ */
    function _loadTab(tabId, force) {
        if (State.loading[tabId]) return;
        State.loading[tabId] = true;

        if (State.bodyEl) {
            State.bodyEl.innerHTML = '<div class="kr-loading">⏳ جاري التحميل...</div>';
        }

        const loader = _loaders[tabId];
        if (!loader) {
            State.bodyEl.innerHTML = '<div class="kr-empty">غير متاح</div>';
            State.loading[tabId] = false;
            return;
        }

        loader().then(function (data) {
            State.loading[tabId] = false;
            _cacheSet(tabId, data);
            if (State.activeTab === tabId) {
                _renderTab(tabId, data);
            }
        }).catch(function (e) {
            State.loading[tabId] = false;
            Logger.warn('load ' + tabId + ' failed:', e.message);
            if (State.activeTab === tabId) {
                State.bodyEl.innerHTML = '<div class="kr-empty">⚠️ فشل التحميل — <button class="kr-btn gold" onclick="QamarKingRoom.reload()" style="margin-top:10px;">🔄 إعادة المحاولة</button></div>';
            }
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Loaders — lazy + محدودة                         */
    /* ══════════════════════════════════════════════ */
    const _loaders = {

        // ─── نظرة عامة ───
        overview: function () {
            return Promise.all([
                window.QamarFB.get('users').then(function (d) {
                    return d ? Object.keys(d).length : 0;
                }).catch(function () { return 0; }),
                window.QamarFB.get('user_presence').then(function (d) {
                    if (!d) return 0;
                    const now = _now();
                    let n = 0;
                    Object.keys(d).forEach(function (uid) {
                        const p = d[uid];
                        if (p && p.state === 'online' && (now - (p.lastChanged || 0)) < 120000) n++;
                    });
                    return n;
                }).catch(function () { return 0; }),
                window.QamarFB.get('users').then(function (d) {
                    if (!d) return { jailed: 0, banned: 0 };
                    const now = _now();
                    let jailed = 0, banned = 0;
                    Object.keys(d).forEach(function (uid) {
                        const u = d[uid];
                        if (!u) return;
                        if (u.isJailed && u.jailUntil && now < u.jailUntil) jailed++;
                        if (u.isBanned && u.bannedUntil && now < u.bannedUntil) banned++;
                    });
                    return { jailed: jailed, banned: banned };
                }).catch(function () { return { jailed: 0, banned: 0 }; }),
                window.QamarFB.get('multi_account_alerts').then(function (d) {
                    return d ? Object.keys(d).length : 0;
                }).catch(function () { return 0; })
            ]).then(function (r) {
                return {
                    total: r[0],
                    online: r[1],
                    jailed: r[2].jailed,
                    banned: r[2].banned,
                    multi: r[3]
                };
            });
        },

        // ─── المستخدمون ───
        users: function () {
            return window.QamarFB.query('users', {
                orderByChild: 'lastSeen',
                limitToLast: CONFIG.USER_LIMIT,
                returnArray: true
            }).then(function (arr) {
                return (arr || []).map(function (x) {
                    const u = x.data || {};
                    u.uid = x.id;
                    return u;
                });
            });
        },

        // ─── الإداريون (65+) ───
        ranks: function () {
            return window.QamarFB.query('users', {
                orderByChild: 'rankLevel',
                limitToLast: 100,
                returnArray: true
            }).then(function (arr) {
                return (arr || []).map(function (x) {
                    const u = x.data || {};
                    u.uid = x.id;
                    return u;
                }).filter(function (u) {
                    return (Number(u.rankLevel) || 0) >= 65;
                }).sort(function (a, b) {
                    return (Number(b.rankLevel) || 0) - (Number(a.rankLevel) || 0);
                });
            });
        },

        // ─── الملوك (90) ───
        royals: function () {
            return window.QamarFB.query('users', {
                orderByChild: 'rankLevel',
                equalTo: CONFIG.ROYAL_LEVEL,
                returnArray: true
            }).then(function (arr) {
                return (arr || []).map(function (x) {
                    const u = x.data || {};
                    u.uid = x.id;
                    return u;
                });
            }).catch(function () {
                // fallback: قراءة كامل
                return window.QamarFB.get('users').then(function (d) {
                    if (!d) return [];
                    return Object.keys(d).filter(function (uid) {
                        return Number(d[uid].rankLevel) === CONFIG.ROYAL_LEVEL;
                    }).map(function (uid) {
                        const u = d[uid];
                        u.uid = uid;
                        return u;
                    });
                });
            });
        },

        // ─── المعاقبون ───
        punishments: function () {
            return window.QamarFB.query('users', {
                orderByChild: 'lastSeen',
                limitToLast: CONFIG.USER_LIMIT,
                returnArray: true
            }).then(function (arr) {
                const now = _now();
                return (arr || []).map(function (x) {
                    const u = x.data || {};
                    u.uid = x.id;
                    return u;
                }).filter(function (u) {
                    if (u.isJailed && u.jailUntil && now < u.jailUntil) return true;
                    if (u.isBanned && u.bannedUntil && now < u.bannedUntil) return true;
                    if (u.permanentBan === true) return true;
                    return false;
                }).sort(function (a, b) {
                    return (b.lastJailAt || b.bannedAt || 0) - (a.lastJailAt || a.bannedAt || 0);
                });
            });
        },

        // ─── التقارير ───
        reports: function () {
            return Promise.all([
                window.QamarFB.query('reports', {
                    orderByChild: 'time',
                    limitToLast: CONFIG.REPORT_LIMIT,
                    returnArray: true
                }).catch(function () { return []; }),
                window.QamarFB.query('reports_archive', {
                    orderByChild: 'time',
                    limitToLast: 50,
                    returnArray: true
                }).catch(function () { return []; })
            ]).then(function (r) {
                const active = (r[0] || []).map(function (x) {
                    return Object.assign({ _id: x.id, _archived: false }, x.data);
                });
                const archived = (r[1] || []).map(function (x) {
                    return Object.assign({ _id: x.id, _archived: true }, x.data);
                });
                return { active: active, archived: archived };
            });
        },

        // ─── الحسابات المكررة ───
        multiAccount: function () {
            return window.QamarFB.query('multi_account_alerts', {
                orderByChild: 'at',
                limitToLast: CONFIG.MULTI_LIMIT,
                returnArray: true
            }).then(function (arr) {
                return (arr || []).map(function (x) {
                    return Object.assign({ _id: x.id }, x.data);
                }).sort(function (a, b) {
                    return (b.at || 0) - (a.at || 0);
                });
            });
        },

        // ─── إدارة البان ───
        bans: function () {
            return Promise.all([
                window.QamarFB.get('banned_devices').catch(function () { return null; }),
                window.QamarFB.get('banned_ips').catch(function () { return null; })
            ]).then(function (r) {
                return {
                    devices: r[0] || {},
                    ips: r[1] || {}
                };
            });
        },

        // ─── الغرف ───
        rooms: function () {
            return Promise.all([
                window.QamarFB.get('custom_rooms').catch(function () { return null; }),
                window.QamarFB.get('room_settings').catch(function () { return null; }),
                window.QamarFB.get('room_mutes').catch(function () { return null; })
            ]).then(function (r) {
                return {
                    custom: r[0] || {},
                    settings: r[1] || {},
                    mutes: r[2] || {}
                };
            });
        },

        // ─── البوتات ───
        bots: function () {
            return window.QamarFB.get('bot_memory/bots').catch(function () { return null; })
                .then(function (data) {
                    return { configs: data || {} };
                });
        },

        // ─── التنبيهات ───
        alerts: function () {
            const roomId = (window.AppState && window.AppState.currentRoom) || 'general';
            return window.QamarFB.get('room_alerts/' + roomId + '/current').catch(function () { return null; })
                .then(function (d) {
                    return { roomId: roomId, current: d };
                });
        }
    };

    /* ══════════════════════════════════════════════ */
    /* Render dispatcher                               */
    /* ══════════════════════════════════════════════ */
    function _renderTab(tabId, data) {
        const body = State.bodyEl;
        if (!body) return;

        const renderer = _renderers[tabId];
        if (!renderer) {
            body.innerHTML = '<div class="kr-empty">غير متاح</div>';
            return;
        }

        try {
            renderer(body, data);
        } catch (e) {
            Logger.error('render ' + tabId + ' error:', e);
            body.innerHTML = '<div class="kr-empty">⚠️ خطأ في العرض</div>';
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Renderers                                       */
    /* ══════════════════════════════════════════════ */
    const _renderers = {

        // ─── نظرة عامة ───
        overview: function (body, data) {
            body.innerHTML = '';

            const stats = document.createElement('div');
            stats.className = 'kr-stats';
            stats.innerHTML =
                '<div class="kr-stat"><div class="kr-stat-val">' + data.total + '</div><div class="kr-stat-lbl">👥 الإجمالي</div></div>' +
                '<div class="kr-stat"><div class="kr-stat-val" style="color:#84cc16;">' + data.online + '</div><div class="kr-stat-lbl">🟢 متصل</div></div>' +
                '<div class="kr-stat"><div class="kr-stat-val" style="color:#ff9800;">' + data.jailed + '</div><div class="kr-stat-lbl">⛓️ مسجون</div></div>' +
                '<div class="kr-stat"><div class="kr-stat-val" style="color:#ff4444;">' + data.banned + '</div><div class="kr-stat-lbl">🚫 محظور</div></div>' +
                '<div class="kr-stat"><div class="kr-stat-val" style="color:#a855f7;">' + data.multi + '</div><div class="kr-stat-lbl">🚨 مكرّرة</div></div>';
            body.appendChild(stats);

            const refresh = document.createElement('button');
            refresh.className = 'kr-btn outline';
            refresh.textContent = '🔄 تحديث';
            refresh.onclick = function () { _cacheClear('overview'); _loadTab('overview', true); };
            body.appendChild(refresh);
        },

        // ─── المستخدمون ───
        users: function (body, data) {
            _renderListWithSearch(body, 'users', data, {
                filterOptions: [
                    { id: 'all', label: 'الكل' },
                    { id: 'online', label: '🟢 متصل' },
                    { id: 'jailed', label: '⛓️ مسجون' },
                    { id: 'banned', label: '🚫 محظور' },
                    { id: 'admins', label: '🎖️ إداريون' },
                    { id: 'guests', label: '🕵️ زوار' }
                ],
                onRenderItem: _buildUserRow
            });
        },

        // ─── الإداريون ───
        ranks: function (body, data) {
            _renderListWithSearch(body, 'ranks', data, {
                noFilter: true,
                onRenderItem: _buildUserRow
            });
        },

        // ─── الملوك ───
        royals: function (body, data) {
            body.innerHTML = '';
            const info = document.createElement('div');
            info.className = 'kr-warn-box';
            info.textContent = '👑 4 رتب برتبة 90 — يظهرون موحدين للجميع. أنت فقط تعرف من هو ملك ومن هي ملكة.';
            body.appendChild(info);

            if (!data.length) {
                body.innerHTML += '<div class="kr-empty">لا يوجد ملوك بجانبك</div>';
                return;
            }

            data.forEach(function (u) {
                body.appendChild(_buildUserRow(u, { royalMode: true }));
            });
        },

        // ─── المعاقبون ───
        punishments: function (body, data) {
            _renderListWithSearch(body, 'punishments', data, {
                filterOptions: [
                    { id: 'all', label: 'الكل' },
                    { id: 'jailed', label: '⛓️ مسجون' },
                    { id: 'banned', label: '🚫 محظور' },
                    { id: 'perm', label: '🛑 دائم' }
                ],
                onRenderItem: function (u, ctx) {
                    return _buildUserRow(u, { punishmentMode: true, filter: ctx.filter });
                }
            });
        },

        // ─── التقارير ───
        reports: function (body, data) {
            body.innerHTML = '';

            const toolbar = document.createElement('div');
            toolbar.className = 'kr-toolbar';
            toolbar.innerHTML =
                '<button class="kr-btn ' + (State.filters.reports.filter !== 'archive' ? 'gold' : 'outline') + '" data-rf="active">🆕 جديدة (' + data.active.length + ')</button>' +
                '<button class="kr-btn ' + (State.filters.reports.filter === 'archive' ? 'gold' : 'outline') + '" data-rf="archive">📦 أرشيف (' + data.archived.length + ')</button>' +
                '<button class="kr-btn blue" id="kr-reports-refresh">🔄</button>';
            body.appendChild(toolbar);

            const list = State.filters.reports.filter === 'archive' ? data.archived : data.active;
            const listEl = document.createElement('div');
            body.appendChild(listEl);

            if (!list.length) {
                listEl.innerHTML = '<div class="kr-empty">لا تقارير</div>';
            } else {
                list.forEach(function (r) {
                    listEl.appendChild(_buildReportCard(r));
                });
            }

            toolbar.querySelectorAll('[data-rf]').forEach(function (b) {
                b.onclick = function () {
                    State.filters.reports.filter = (b.getAttribute('data-rf') === 'archive') ? 'archive' : null;
                    _renderTab('reports', data);
                };
            });
            toolbar.querySelector('#kr-reports-refresh').onclick = function () {
                _cacheClear('reports'); _loadTab('reports', true);
            };
        },

        // ─── الحسابات المكررة ───
        multiAccount: function (body, data) {
            body.innerHTML = '';
            if (!data.length) {
                body.innerHTML = '<div class="kr-empty">✅ لا حسابات مكرّرة</div>';
                return;
            }
            data.forEach(function (a) {
                body.appendChild(_buildMultiAccountCard(a));
            });
        },

        // ─── إدارة البان ───
        bans: function (body, data) {
            body.innerHTML = '';
            const deviceKeys = Object.keys(data.devices);
            const ipKeys = Object.keys(data.ips);

            const toolbar = document.createElement('div');
            toolbar.className = 'kr-toolbar';
            toolbar.innerHTML =
                '<button class="kr-btn ' + (State.filters.bans.filter !== 'ips' ? 'gold' : 'outline') + '" data-bt="devices">📱 أجهزة (' + deviceKeys.length + ')</button>' +
                '<button class="kr-btn ' + (State.filters.bans.filter === 'ips' ? 'gold' : 'outline') + '" data-bt="ips">🌐 شبكات (' + ipKeys.length + ')</button>';
            body.appendChild(toolbar);

            const isIps = State.filters.bans.filter === 'ips';
            const keys = isIps ? ipKeys : deviceKeys;
            const map = isIps ? data.ips : data.devices;
            const listEl = document.createElement('div');
            body.appendChild(listEl);

            if (!keys.length) {
                listEl.innerHTML = '<div class="kr-empty">لا يوجد</div>';
            } else {
                keys.forEach(function (key) {
                    listEl.appendChild(_buildBanCard(isIps, key, map[key]));
                });
            }

            toolbar.querySelectorAll('[data-bt]').forEach(function (b) {
                b.onclick = function () {
                    State.filters.bans.filter = (b.getAttribute('data-bt') === 'ips') ? 'ips' : null;
                    _renderTab('bans', data);
                };
            });
        },

        // ─── الغرف ───
        rooms: function (body, data) {
            body.innerHTML = '';
            const all = window.QAMAR && window.QAMAR.ROOMS ? window.QAMAR.ROOMS : {};
            const baseKeys = Object.keys(all);
            const customKeys = Object.keys(data.custom);

            const h1 = document.createElement('div');
            h1.style.cssText = 'color:#ffd700;font-size:12px;font-weight:900;margin:10px 0 8px;';
            h1.textContent = '🏛️ غرف أساسية (' + baseKeys.length + ')';
            body.appendChild(h1);

            baseKeys.forEach(function (rid) {
                body.appendChild(_buildRoomRow(rid, all[rid], data, false));
            });

            if (customKeys.length) {
                const h2 = document.createElement('div');
                h2.style.cssText = 'color:#84cc16;font-size:12px;font-weight:900;margin:14px 0 8px;';
                h2.textContent = '⭐ غرف مخصصة (' + customKeys.length + ')';
                body.appendChild(h2);

                customKeys.forEach(function (rid) {
                    body.appendChild(_buildRoomRow(rid, data.custom[rid], data, true));
                });
            }
        },

        // ─── البوتات ───
        bots: function (body, data) {
            body.innerHTML = '';

            const info = document.createElement('div');
            info.className = 'kr-warn-box';
            info.textContent = '🤖 6 بوتات نشطة — كل بوت له دور محدد.';
            body.appendChild(info);

            if (!window.QamarBots) {
                body.innerHTML += '<div class="kr-empty">bots.js غير محمّل</div>';
                return;
            }

            const bots = window.QamarBots.getAllBots();
            bots.forEach(function (b) {
                body.appendChild(_buildBotRow(b, data.configs[b.id]));
            });

            const btn = document.createElement('button');
            btn.className = 'kr-btn green';
            btn.style.cssText = 'width:100%;padding:12px;margin-top:10px;';
            btn.textContent = '📖 فتح لوحة التدريب';
            btn.onclick = function () {
                if (window.QamarBotTraining && typeof window.QamarBotTraining.open === 'function') {
                    window.QamarBotTraining.open();
                } else {
                    _toast('bot-training.js غير محمّل', 'fa-times');
                }
            };
            body.appendChild(btn);

            const refresh = document.createElement('button');
            refresh.className = 'kr-btn outline';
            refresh.style.cssText = 'width:100%;padding:10px;margin-top:8px;';
            refresh.textContent = '🔄 تحديث';
            refresh.onclick = function () { _cacheClear('bots'); _loadTab('bots', true); };
            body.appendChild(refresh);
        },

        // ─── التنبيهات ───
        alerts: function (body, data) {
            body.innerHTML = '';

            const info = document.createElement('div');
            info.className = 'kr-warn-box';
            info.textContent = '📢 تنبيه في الغرفة الحالية: ' + (data.roomId || '—');
            body.appendChild(info);

            if (data.current) {
                const c = document.createElement('div');
                c.className = 'kr-card';
                c.innerHTML =
                    '<div style="color:#ffd700;font-weight:900;margin-bottom:8px;">📢 التنبيه الحالي</div>' +
                    '<div style="color:#fff;font-size:13px;">' + _esc(data.current.text || '—') + '</div>' +
                    '<div style="color:#888;font-size:11px;margin-top:6px;">من: ' + _esc(data.current.senderName || '—') + '</div>';
                body.appendChild(c);
            } else {
                body.innerHTML += '<div class="kr-empty">لا تنبيه نشط</div>';
            }

            const btn = document.createElement('button');
            btn.className = 'kr-btn gold';
            btn.style.cssText = 'width:100%;padding:12px;margin-top:10px;';
            btn.textContent = '📢 إنشاء تنبيه';
            btn.onclick = function () {
                if (window.QamarRoomAlerts && typeof window.QamarRoomAlerts.open === 'function') {
                    window.QamarRoomAlerts.open();
                } else {
                    _toast('room-alerts.js غير محمّل', 'fa-times');
                }
            };
            body.appendChild(btn);
        }
    };

    /* ══════════════════════════════════════════════ */
    /* Shared list renderer (search + filter)          */
    /* ══════════════════════════════════════════════ */
    function _renderListWithSearch(body, tabId, data, opts) {
        body.innerHTML = '';
        const state = State.filters[tabId];
        if (!state) { State.filters[tabId] = { search: '', page: 1, filter: null }; }

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'kr-toolbar';

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'kr-search';
        search.placeholder = '🔍 بحث بالاسم أو الكود...';
        search.value = state.search || '';
        search.oninput = function () {
            State.filters[tabId].search = this.value.trim();
            State.filters[tabId].page = 1;
            _renderTab(tabId, data);
        };
        toolbar.appendChild(search);

        const refresh = document.createElement('button');
        refresh.className = 'kr-btn outline';
        refresh.textContent = '🔄';
        refresh.onclick = function () { _cacheClear(tabId); _loadTab(tabId, true); };
        toolbar.appendChild(refresh);

        body.appendChild(toolbar);

        // Filters
        if (opts.filterOptions) {
            const filtersBar = document.createElement('div');
            filtersBar.className = 'kr-toolbar';
            filtersBar.style.cssText += 'flex-wrap:wrap;';
            opts.filterOptions.forEach(function (f) {
                const b = document.createElement('button');
                const active = (state.filter === f.id) || (f.id === 'all' && !state.filter);
                b.className = 'kr-btn ' + (active ? 'gold' : 'outline');
                b.textContent = f.label;
                b.onclick = function () {
                    State.filters[tabId].filter = (f.id === 'all') ? null : f.id;
                    State.filters[tabId].page = 1;
                    _renderTab(tabId, data);
                };
                filtersBar.appendChild(b);
            });
            body.appendChild(filtersBar);
        }

        // Filter data
        let list = data.slice();

        if (state.search) {
            const q = state.search.toLowerCase();
            list = list.filter(function (u) {
                const name = String(u.name || '').toLowerCase();
                const code = String(u.code || '').toLowerCase();
                return name.indexOf(q) !== -1 || code.indexOf(q) !== -1;
            });
        }

        if (state.filter) {
            const now = _now();
            list = list.filter(function (u) {
                if (state.filter === 'online') {
                    return (now - (u.lastSeen || 0)) < 120000;
                }
                if (state.filter === 'jailed') return u.isJailed && u.jailUntil && now < u.jailUntil;
                if (state.filter === 'banned') return (u.isBanned && u.bannedUntil && now < u.bannedUntil) || u.permanentBan === true;
                if (state.filter === 'perm') return u.permanentBan === true;
                if (state.filter === 'admins') return (Number(u.rankLevel) || 0) >= 65;
                if (state.filter === 'guests') return u.isGuest === true;
                return true;
            });
        }

        const counter = document.createElement('div');
        counter.style.cssText = 'text-align:center;color:#ffd700;font-size:11px;font-weight:900;padding:6px 0 10px;';
        counter.textContent = '📊 ' + list.length + ' عنصر';
        body.appendChild(counter);

        if (!list.length) {
            body.innerHTML += '<div class="kr-empty">لا نتائج</div>';
            return;
        }

        // Pagination
        const page = state.page || 1;
        const start = (page - 1) * CONFIG.PAGE_SIZE;
        const pageItems = list.slice(start, start + CONFIG.PAGE_SIZE);

        pageItems.forEach(function (u) {
            body.appendChild(opts.onRenderItem(u, { filter: state.filter, tabId: tabId }));
        });

        // More button
        if (list.length > start + CONFIG.PAGE_SIZE) {
            const more = document.createElement('button');
            more.className = 'kr-btn outline';
            more.style.cssText = 'width:100%;padding:11px;margin-top:8px;';
            more.textContent = '📥 المزيد (' + (list.length - start - CONFIG.PAGE_SIZE) + ')';
            more.onclick = function () {
                State.filters[tabId].page = page + 1;
                _renderTab(tabId, data);
            };
            body.appendChild(more);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Builders                                        */
    /* ══════════════════════════════════════════════ */
    function _buildUserRow(u, opts) {
        opts = opts || {};
        const row = document.createElement('div');
        row.className = 'kr-row';

        const av = document.createElement('img');
        av.className = 'kr-row-av';
        av.src = u.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(u.name || 'U') + '&background=333&color=fff');
        av.onerror = function () { this.src = 'https://ui-avatars.com/api/?name=U&background=333&color=fff'; };
        av.onclick = function () { _openProfile(u.uid, u.name); };

        const info = document.createElement('div');
        info.className = 'kr-row-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'kr-row-name';
        nameEl.textContent = _rankIcon(u.rank) + ' ' + (u.name || '—');
        nameEl.onclick = function () { _openProfile(u.uid, u.name); };

        const sub = document.createElement('div');
        sub.className = 'kr-row-sub';
        sub.textContent = (u.code || '—') + ' · ' + _timeAgo(u.lastSeen);

        const badges = document.createElement('div');
        badges.className = 'kr-row-badges';
        _buildUserBadges(u, badges);

        info.appendChild(nameEl);
        info.appendChild(sub);
        if (badges.children.length) info.appendChild(badges);

        const actions = document.createElement('div');
        actions.className = 'kr-row-actions';

        // زر القائمة السياقية
        const menuBtn = document.createElement('button');
        menuBtn.className = 'kr-icon-btn';
        menuBtn.textContent = '⋮';
        menuBtn.onclick = function (e) {
            e.stopPropagation();
            _openUserMenu(u, menuBtn);
        };
        actions.appendChild(menuBtn);

        row.appendChild(av);
        row.appendChild(info);
        row.appendChild(actions);

        return row;
    }

    function _rankIcon(rank) {
        const m = {
            'King': '👑', 'Queen': '👸', 'Master Owner': '🌟',
            'Room Owner': '🛡️', 'Grand Owner': '💎', 'Owner': '🏆',
            'Super Admin': '🎖️', 'Admin': '🛠️', 'Premium': '💠',
            'User': '👤', 'Bot': '🤖'
        };
        return m[rank] || '👤';
    }

    function _buildUserBadges(u, container) {
        const now = _now();
        const lvl = Number(u.rankLevel) || 0;

        if (u.rank === 'King') container.innerHTML += '<span class="kr-badge king">👑 ملك</span>';
        else if (u.rank === 'Queen') container.innerHTML += '<span class="kr-badge queen">👸 ملكة</span>';
        else if (lvl >= 65) container.innerHTML += '<span class="kr-badge admin">🎖️ إداري</span>';

        if (u.isGuest === true) container.innerHTML += '<span class="kr-badge guest">🕵️ زائر</span>';
        if (u.isJailed && u.jailUntil && now < u.jailUntil) container.innerHTML += '<span class="kr-badge jail">⛓️ مسجون</span>';
        if (u.permanentBan === true) container.innerHTML += '<span class="kr-badge ban">🛑 دائم</span>';
        else if (u.isBanned && u.bannedUntil && now < u.bannedUntil) container.innerHTML += '<span class="kr-badge ban">🚫 محظور</span>';
        if ((Number(u.warnings) || 0) > 0) container.innerHTML += '<span class="kr-badge warn">⚠️ ' + u.warnings + '</span>';
    }

    function _buildReportCard(r) {
        const card = document.createElement('div');
        card.className = 'kr-card';
        const timeStr = _timeAgo(r.time);
        const reason = r.reason || r.reasonKey || '—';
        card.innerHTML =
            '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
                '<div style="color:#ffd700;font-weight:900;font-size:13px;">🚨 ' + _esc(reason) + '</div>' +
                '<div style="color:#888;font-size:10px;">' + timeStr + '</div>' +
            '</div>' +
            '<div style="color:#fff;font-size:12px;margin-bottom:4px;">المُبلِّغ: <b>' + _esc(r.reporterName || '—') + '</b></div>' +
            '<div style="color:#fff;font-size:12px;margin-bottom:6px;">المُبلَّغ عنه: <b>' + _esc(r.targetName || '—') + '</b></div>' +
            (r.messageText ? '<div style="background:rgba(0,0,0,0.4);color:#ffcccc;font-size:11px;padding:6px 8px;border-radius:6px;margin-bottom:8px;word-break:break-word;">' + _esc(r.messageText) + '</div>' : '');

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

        if (!r._archived) {
            const done = document.createElement('button');
            done.className = 'kr-btn green';
            done.textContent = '✅ معالجة';
            done.onclick = function () {
                if (!confirm('تمت المعالجة؟')) return;
                if (window.QamarReports && typeof window.QamarReports.archiveReport === 'function') {
                    window.QamarReports.archiveReport(r._id).then(function () {
                        _cacheClear('reports');
                        _loadTab('reports', true);
                        _toast('✅ تمت المعالجة', 'fa-check');
                    }).catch(function (e) { _toast(e.message, 'fa-times'); });
                }
            };
            actions.appendChild(done);
        }

        if (r.targetUid) {
            const viewBtn = document.createElement('button');
            viewBtn.className = 'kr-btn blue';
            viewBtn.textContent = '👤 عرض';
            viewBtn.onclick = function () { _openProfile(r.targetUid, r.targetName); };
            actions.appendChild(viewBtn);
        }

        card.appendChild(actions);
        return card;
    }

    function _buildMultiAccountCard(a) {
        const card = document.createElement('div');
        card.className = 'kr-card';
        const existing = Array.isArray(a.existingUids)
            ? a.existingUids
            : Object.keys(a.existingUids || {});
        card.innerHTML =
            '<div style="color:#ff6666;font-weight:900;font-size:13px;margin-bottom:8px;">🚨 محاولة من نفس الجهاز</div>' +
            '<div style="color:#fff;font-size:12px;margin-bottom:4px;">👤 ' + _esc(a.name || '—') + '</div>' +
            '<div style="color:#888;font-size:10px;margin-bottom:6px;">🌐 ' + _esc(a.ip || '—') + ' · ' + _timeAgo(a.at) + '</div>' +
            (existing.length ? '<div style="color:#ffbb66;font-size:11px;margin-bottom:8px;">👥 حسابات موجودة: ' + existing.length + '</div>' : '');

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

        const banDev = document.createElement('button');
        banDev.className = 'kr-btn danger';
        banDev.textContent = '🛡️ حظر الجهاز';
        banDev.onclick = function () {
            if (!confirm('حظر جهاز ' + (a.name || '—') + '؟')) return;
            if (window.QamarDeviceGuard && typeof window.QamarDeviceGuard.banDevice === 'function') {
                window.QamarDeviceGuard.banDevice(a.deviceId, a.uid, a.name, 'متعدد الحسابات')
                    .then(function () {
                        _cacheClear('multiAccount');
                        _loadTab('multiAccount', true);
                        _toast('✅ تم الحظر', 'fa-check');
                    }).catch(function (e) { _toast(e.message, 'fa-times'); });
            }
        };
        actions.appendChild(banDev);

        const del = document.createElement('button');
        del.className = 'kr-btn outline';
        del.textContent = '🗑️ حذف';
        del.onclick = function () {
            if (!confirm('حذف هذا التنبيه؟')) return;
            window.QamarFB.remove('multi_account_alerts/' + a._id).then(function () {
                _cacheClear('multiAccount');
                _loadTab('multiAccount', true);
            });
        };
        actions.appendChild(del);

        if (a.uid) {
            const view = document.createElement('button');
            view.className = 'kr-btn blue';
            view.textContent = '👤 عرض';
            view.onclick = function () { _openProfile(a.uid, a.name); };
            actions.appendChild(view);
        }

        card.appendChild(actions);
        return card;
    }

    function _buildBanCard(isIp, key, entry) {
        const card = document.createElement('div');
        card.className = 'kr-card';
        const shortKey = key.length > 20 ? (key.substring(0, 10) + '...' + key.substring(key.length - 6)) : key;
        card.innerHTML =
            '<div style="color:#c084fc;font-weight:900;font-size:12px;margin-bottom:4px;word-break:break-all;">' + (isIp ? '🌐 ' : '📱 ') + _esc(shortKey) + '</div>' +
            '<div style="color:#fff;font-size:12px;">👤 ' + _esc(entry.name || '—') + '</div>' +
            '<div style="color:#888;font-size:10px;margin-top:3px;">📝 ' + _esc(entry.reason || '—') + '</div>' +
            '<div style="color:#666;font-size:10px;margin-top:2px;">🕐 ' + _timeAgo(entry.at) + '</div>';

        const unbanBtn = document.createElement('button');
        unbanBtn.className = 'kr-btn green';
        unbanBtn.style.cssText = 'width:100%;padding:8px;margin-top:8px;font-size:11px;';
        unbanBtn.textContent = '🔓 فك الحظر';
        unbanBtn.onclick = function () {
            if (!confirm('فك الحظر؟')) return;
            const path = isIp ? ('banned_ips/' + key) : ('banned_devices/' + key);
            window.QamarFB.remove(path).then(function () {
                _cacheClear('bans');
                _loadTab('bans', true);
                _toast('🔓 تم الفك', 'fa-check');
            });
        };
        card.appendChild(unbanBtn);
        return card;
    }

    function _buildRoomRow(roomId, room, data, isCustom) {
        const row = document.createElement('div');
        row.className = 'kr-row';

        const icon = document.createElement('div');
        icon.style.cssText = 'width:42px;height:42px;border-radius:50%;background:rgba(212,175,55,0.15);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;';
        icon.textContent = room.icon || '🚪';

        const info = document.createElement('div');
        info.className = 'kr-row-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'kr-row-name';
        nameEl.textContent = room.name || roomId;

        const sub = document.createElement('div');
        sub.className = 'kr-row-sub';
        sub.textContent = roomId + ' · ' + (room.visibleTo || 'all') + (isCustom ? ' ⭐' : '');

        info.appendChild(nameEl);
        info.appendChild(sub);

        const actions = document.createElement('div');
        actions.className = 'kr-row-actions';

        if (data.mutes && data.mutes[roomId]) {
            const unmuteBtn = document.createElement('button');
            unmuteBtn.className = 'kr-icon-btn';
            unmuteBtn.textContent = '🔊';
            unmuteBtn.title = 'فك كتم الغرفة';
            unmuteBtn.onclick = function () {
                if (window.QamarRooms && typeof window.QamarRooms.unmuteRoom === 'function') {
                    window.QamarRooms.unmuteRoom(roomId).then(function () {
                        _cacheClear('rooms');
                        _loadTab('rooms', true);
                        _toast('🔊 تم فك الكتم', 'fa-check');
                    });
                }
            };
            actions.appendChild(unmuteBtn);
        } else {
            const muteBtn = document.createElement('button');
            muteBtn.className = 'kr-icon-btn';
            muteBtn.textContent = '🔇';
            muteBtn.title = 'كتم الغرفة';
            muteBtn.onclick = function () {
                if (!confirm('كتم الغرفة؟')) return;
                if (window.QamarRooms && typeof window.QamarRooms.muteRoom === 'function') {
                    window.QamarRooms.muteRoom(roomId, 'إجراء إداري').then(function () {
                        _cacheClear('rooms');
                        _loadTab('rooms', true);
                        _toast('🔇 تم الكتم', 'fa-check');
                    });
                }
            };
            actions.appendChild(muteBtn);
        }

        if (isCustom && _isKing100()) {
            const delBtn = document.createElement('button');
            delBtn.className = 'kr-icon-btn';
            delBtn.style.color = '#ff6666';
            delBtn.textContent = '🗑️';
            delBtn.title = 'حذف الغرفة';
            delBtn.onclick = function () {
                if (!confirm('حذف الغرفة نهائياً؟')) return;
                if (window.QamarRooms && typeof window.QamarRooms.deleteRoom === 'function') {
                    window.QamarRooms.deleteRoom(roomId).then(function () {
                        _cacheClear('rooms');
                        _loadTab('rooms', true);
                        _toast('🗑️ تم الحذف', 'fa-trash');
                    });
                }
            };
            actions.appendChild(delBtn);
        }

        row.appendChild(icon);
        row.appendChild(info);
        row.appendChild(actions);
        return row;
    }

    function _buildBotRow(bot, cfg) {
        const row = document.createElement('div');
        row.className = 'kr-row';

        const av = document.createElement('div');
        av.style.cssText = 'width:42px;height:42px;border-radius:50%;background:rgba(212,175,55,0.15);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;';
        av.textContent = bot.icon;

        const info = document.createElement('div');
        info.className = 'kr-row-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'kr-row-name';
        nameEl.textContent = bot.name;

        const sub = document.createElement('div');
        sub.className = 'kr-row-sub';
        const enabled = !cfg || cfg.enabled !== false;
        sub.textContent = (enabled ? '✅ نشط' : '❌ متوقف') + ' · ' + (bot.description || '');

        info.appendChild(nameEl);
        info.appendChild(sub);

        const actions = document.createElement('div');
        actions.className = 'kr-row-actions';

        const toggle = document.createElement('button');
        toggle.className = 'kr-icon-btn';
        toggle.textContent = enabled ? '⏹️' : '▶️';
        toggle.title = enabled ? 'إيقاف' : 'تشغيل';
        toggle.onclick = function () {
            if (!window.QamarBots) return;
            const fn = enabled ? window.QamarBots.disableBot : window.QamarBots.enableBot;
            fn(bot.id).then(function () {
                _cacheClear('bots');
                _loadTab('bots', true);
                _toast(enabled ? '⏹️ تم الإيقاف' : '▶️ تم التشغيل', 'fa-check');
            }).catch(function (e) { _toast(e.message, 'fa-times'); });
        };
        actions.appendChild(toggle);

        row.appendChild(av);
        row.appendChild(info);
        row.appendChild(actions);
        return row;
    }

    /* ══════════════════════════════════════════════ */
    /* User menu (⋮)                                   */
    /* ══════════════════════════════════════════════ */
    function _openUserMenu(u, anchorEl) {
        _closeAllMenus();

        if (!window.QamarKingActions) {
            _toast('king-actions.js غير محمّل', 'fa-times');
            return;
        }

        const menu = document.createElement('div');
        menu.id = 'kr-user-menu';
        menu.style.cssText =
            'position:fixed;z-index:17000;background:rgba(15,15,25,0.98);' +
            'border:1px solid rgba(212,175,55,0.5);border-radius:12px;padding:6px;' +
            'min-width:200px;max-width:280px;max-height:70vh;overflow-y:auto;' +
            'box-shadow:0 12px 40px rgba(0,0,0,0.95);direction:rtl;font-family:inherit;';

        const items = [
            { icon: '👤', label: 'عرض البروفايل', action: 'profile', always: true },
            { icon: '🎖️', label: 'ترقية', action: 'promote', perm: 'canPromote' },
            { icon: '📉', label: 'تخفيض', action: 'demote', perm: 'canDemote' },
            { icon: '⚠️', label: 'تحذير', action: 'warn', perm: 'canWarn' },
            { icon: '⛓️', label: 'سجن', action: 'jail', perm: 'canJail' },
            { icon: '🔓', label: 'إفراج', action: 'release', perm: 'canJail', onlyIfJailed: true },
            { icon: '🚫', label: 'حظر مؤقت', action: 'banTemp', perm: 'canBan' },
            { icon: '🛑', label: 'حظر دائم', action: 'banPerm', perm: 'canBan' },
            { icon: '🔓', label: 'إلغاء الحظر', action: 'unban', perm: 'canUnban', onlyIfBanned: true },
            { icon: '🚪', label: 'طرد من غرفة', action: 'kickFromRoom', perm: 'canKickFromRoom' },
            { icon: '🔇', label: 'كتم كامل', action: 'muteGlobal', perm: 'canMuteGlobal' },
            { icon: '🔇', label: 'كتم في غرفة', action: 'muteInRoom', perm: 'canMuteInRoom' },
            { icon: '🎤', label: 'فك الكتم', action: 'unmute', perm: 'canMuteGlobal' },
            { icon: '🔀', label: 'نقل لغرفة', action: 'transfer', perm: 'canTransferUsers' },
            { icon: '⭐', label: 'إهداء نقاط', action: 'givePoints', perm: 'canGivePoints' },
            { icon: '🗑️', label: 'حذف الحساب', action: 'deleteAccount', perm: null, kingOnly: true, danger: true }
        ];

        const now = _now();
        let count = 0;

        items.forEach(function (it) {
            if (it.perm && !window.QamarKingActions.canDo(it.perm)) return;
            if (it.kingOnly && !_isKing100()) return;
            if (it.onlyIfJailed && !(u.isJailed && u.jailUntil && now < u.jailUntil)) return;
            if (it.onlyIfBanned && !((u.isBanned && u.bannedUntil && now < u.bannedUntil) || u.permanentBan)) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText =
                'display:flex;align-items:center;gap:8px;width:100%;text-align:right;' +
                'background:transparent;border:none;color:' + (it.danger ? '#ff7777' : '#f3f4f6') + ';' +
                'padding:10px 12px;font-family:inherit;font-size:13px;font-weight:700;' +
                'border-radius:8px;cursor:pointer;';
            btn.innerHTML = '<span style="font-size:15px;">' + it.icon + '</span><span>' + it.label + '</span>';
            btn.onmouseenter = function () { btn.style.background = 'rgba(212,175,55,0.12)'; };
            btn.onmouseleave = function () { btn.style.background = 'transparent'; };
            btn.onclick = function (e) {
                e.preventDefault(); e.stopPropagation();
                _closeAllMenus();
                _handleMenuAction(it.action, u);
            };
            menu.appendChild(btn);
            count++;
        });

        if (!count) {
            menu.innerHTML = '<div style="padding:14px;color:#888;font-size:12px;text-align:center;">لا إجراءات متاحة</div>';
        }

        document.body.appendChild(menu);

        // position
        const r = anchorEl.getBoundingClientRect();
        const mRect = menu.getBoundingClientRect();
        let left = r.right - mRect.width;
        let top = r.bottom + 6;
        if (left < 8) left = 8;
        if (left + mRect.width > window.innerWidth - 8) left = window.innerWidth - mRect.width - 8;
        if (top + mRect.height > window.innerHeight - 8) top = r.top - mRect.height - 6;
        if (top < 8) top = 8;
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        setTimeout(function () {
            const closer = function (e) {
                if (!menu.contains(e.target)) {
                    _closeAllMenus();
                    document.removeEventListener('click', closer, true);
                }
            };
            document.addEventListener('click', closer, true);
        }, 50);
    }

    function _closeAllMenus() {
        const m = document.getElementById('kr-user-menu');
        if (m && m.parentNode) m.parentNode.removeChild(m);
    }

    /* ══════════════════════════════════════════════ */
    /* Menu action dispatch                            */
    /* ══════════════════════════════════════════════ */
    function _handleMenuAction(action, u) {
        const A = window.QamarKingActions;
        if (!A) return;

        if (action === 'profile') { _openProfile(u.uid, u.name); return; }

        // إجراءات تحتاج إدخال من المستخدم
        if (action === 'promote') return _dlgPromote(u);
        if (action === 'demote') return _dlgDemote(u);
        if (action === 'warn') return _dlgWarn(u);
        if (action === 'jail') return _dlgJail(u);
        if (action === 'release') return _simpleConfirm('إفراج عن ' + (u.name || '') + '؟', function () {
            A.release(u.uid).then(_afterAction).catch(function (e) { _toast(e.message, 'fa-times'); });
        });
        if (action === 'banTemp') return _dlgBanTemp(u);
        if (action === 'banPerm') return _dlgBanPerm(u);
        if (action === 'unban') return _simpleConfirm('إلغاء حظر ' + (u.name || '') + '؟', function () {
            A.unban(u.uid).then(_afterAction).catch(function (e) { _toast(e.message, 'fa-times'); });
        });
        if (action === 'kickFromRoom') return _dlgKickRoom(u);
        if (action === 'muteGlobal') return _dlgMute(u, 'global');
        if (action === 'muteInRoom') return _dlgMute(u, 'room');
        if (action === 'unmute') return _simpleConfirm('فك كتم ' + (u.name || '') + '؟', function () {
            A.unmute(u.uid).then(_afterAction).catch(function (e) { _toast(e.message, 'fa-times'); });
        });
        if (action === 'transfer') return _dlgTransfer(u);
        if (action === 'givePoints') return _dlgPoints(u);
        if (action === 'deleteAccount') return _dlgDeleteAccount(u);
    }

    function _afterAction(r) {
        if (r && r.ok) {
            _toast('✅ تم', 'fa-check');
            _cacheClear(State.activeTab);
            _loadTab(State.activeTab, true);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Dialogs                                         */
    /* ══════════════════════════════════════════════ */
    function _simpleConfirm(msg, onOk) {
        if (window.confirm(msg)) onOk();
    }

    function _promptDlg(title, fields, onSave) {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:17500;background:rgba(0,0,0,0.88);' +
            'display:flex;align-items:center;justify-content:center;padding:20px;direction:rtl;font-family:inherit;';

        const box = document.createElement('div');
        box.style.cssText = 'background:#0a0616;border:2px solid #a855f7;border-radius:16px;' +
            'padding:20px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;display:flex;flex-direction:column;gap:12px;';

        const h = document.createElement('h3');
        h.style.cssText = 'color:#c084fc;font-size:15px;font-weight:900;margin:0;text-align:center;padding-bottom:10px;border-bottom:1px solid rgba(168,85,247,0.3);';
        h.textContent = title;
        box.appendChild(h);

        const inputs = {};
        fields.forEach(function (f) {
            const wrap = document.createElement('div');
            if (f.label) {
                const lbl = document.createElement('label');
                lbl.style.cssText = 'display:block;color:#c084fc;font-size:12px;font-weight:900;margin-bottom:6px;';
                lbl.textContent = f.label;
                wrap.appendChild(lbl);
            }
            let inp;
            if (f.type === 'select') {
                inp = document.createElement('select');
                inp.style.cssText = 'width:100%;padding:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(168,85,247,0.4);border-radius:10px;color:#fff;font-family:inherit;font-size:13px;box-sizing:border-box;';
                (f.options || []).forEach(function (o) {
                    const opt = document.createElement('option');
                    opt.value = o.value;
                    opt.textContent = o.label;
                    inp.appendChild(opt);
                });
            } else {
                inp = document.createElement('input');
                inp.type = f.type || 'text';
                if (f.min !== undefined) inp.min = f.min;
                if (f.max !== undefined) inp.max = f.max;
                inp.style.cssText = 'width:100%;padding:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(168,85,247,0.4);border-radius:10px;color:#fff;font-family:inherit;font-size:13px;box-sizing:border-box;';
            }
            inp.value = f.value || '';
            inputs[f.id] = inp;
            wrap.appendChild(inp);
            box.appendChild(wrap);
        });

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;';

        const cancel = document.createElement('button');
        cancel.className = 'kr-btn outline';
        cancel.textContent = 'إلغاء';
        cancel.style.flex = '1';
        cancel.onclick = function () { document.body.removeChild(ov); };

        const save = document.createElement('button');
        save.className = 'kr-btn gold';
        save.textContent = 'تنفيذ';
        save.style.flex = '1';
        save.onclick = function () {
            const v = {};
            Object.keys(inputs).forEach(function (k) { v[k] = inputs[k].value; });
            try {
                const r = onSave(v);
                if (r && typeof r.then === 'function') {
                    r.then(function () { if (ov.parentNode) document.body.removeChild(ov); })
                     .catch(function (e) { _toast(e.message || 'فشل', 'fa-times'); });
                } else {
                    if (ov.parentNode) document.body.removeChild(ov);
                }
            } catch (e) { _toast(e.message || 'فشل', 'fa-times'); }
        };

        actions.appendChild(cancel);
        actions.appendChild(save);
        box.appendChild(actions);

        ov.appendChild(box);
        ov.onclick = function (e) { if (e.target === ov) document.body.removeChild(ov); };
        document.body.appendChild(ov);
        setTimeout(function () {
            const first = Object.keys(inputs)[0];
            if (first && inputs[first].focus) inputs[first].focus();
        }, 100);
    }

    function _dlgPromote(u) {
        const options = ['Premium', 'Admin', 'Super Admin', 'Owner', 'Grand Owner', 'Room Owner', 'Master Owner'];
        if (_isKing100()) options.push('Queen');
        _promptDlg('🎖️ ترقية ' + (u.name || ''), [
            { id: 'rank', label: 'الرتبة الجديدة', type: 'select', options: options.map(function (r) { return { value: r, label: r }; }) }
        ], function (v) {
            return window.QamarKingActions.promote(u.uid, v.rank).then(_afterAction);
        });
    }

    function _dlgDemote(u) {
        const options = ['User', 'Premium', 'Admin'];
        _promptDlg('📉 تخفيض ' + (u.name || ''), [
            { id: 'rank', label: 'الرتبة الجديدة', type: 'select', options: options.map(function (r) { return { value: r, label: r }; }) }
        ], function (v) {
            return window.QamarKingActions.demote(u.uid, v.rank).then(_afterAction);
        });
    }

    function _dlgWarn(u) {
        _promptDlg('⚠️ تحذير ' + (u.name || ''), [
            { id: 'reason', label: 'السبب', type: 'text', value: '', maxLength: 200 }
        ], function (v) {
            return window.QamarKingActions.warn(u.uid, v.reason).then(_afterAction);
        });
    }

    function _dlgJail(u) {
        _promptDlg('⛓️ سجن ' + (u.name || ''), [
            { id: 'minutes', label: 'المدة (1-120 دقيقة)', type: 'number', value: '5', min: 1, max: 120 },
            { id: 'reason', label: 'السبب', type: 'text' }
        ], function (v) {
            return window.QamarKingActions.jail(u.uid, parseInt(v.minutes, 10), v.reason).then(_afterAction);
        });
    }

    function _dlgBanTemp(u) {
        _promptDlg('🚫 حظر مؤقت ' + (u.name || ''), [
            { id: 'hours', label: 'المدة (1-168 ساعة)', type: 'number', value: '24', min: 1, max: 168 },
            { id: 'reason', label: 'السبب', type: 'text' }
        ], function (v) {
            return window.QamarKingActions.banTemp(u.uid, parseInt(v.hours, 10), v.reason).then(_afterAction);
        });
    }

    function _dlgBanPerm(u) {
        _promptDlg('🛑 حظر دائم ' + (u.name || ''), [
            { id: 'reason', label: 'السبب', type: 'text' }
        ], function (v) {
            return window.QamarKingActions.banPerm(u.uid, v.reason).then(_afterAction);
        });
    }

    function _dlgKickRoom(u) {
        const rooms = window.QAMAR && window.QAMAR.ROOMS ? window.QAMAR.ROOMS : {};
        const opts = Object.keys(rooms).map(function (id) {
            return { value: id, label: (rooms[id].icon || '🚪') + ' ' + rooms[id].name };
        });
        _promptDlg('🚪 طرد من غرفة ' + (u.name || ''), [
            { id: 'room', label: 'الغرفة', type: 'select', options: opts },
            { id: 'reason', label: 'السبب', type: 'text' }
        ], function (v) {
            return window.QamarKingActions.kickFromRoom(u.uid, v.room, v.reason).then(_afterAction);
        });
    }

    function _dlgMute(u, mode) {
        if (mode === 'global') {
            _promptDlg('🔇 كتم كامل ' + (u.name || ''), [
                { id: 'reason', label: 'السبب', type: 'text' }
            ], function (v) {
                return window.QamarKingActions.muteGlobal(u.uid, v.reason).then(_afterAction);
            });
        } else {
            const rooms = window.QAMAR && window.QAMAR.ROOMS ? window.QAMAR.ROOMS : {};
            const opts = Object.keys(rooms).map(function (id) {
                return { value: id, label: (rooms[id].icon || '🚪') + ' ' + rooms[id].name };
            });
            _promptDlg('🔇 كتم في غرفة ' + (u.name || ''), [
                { id: 'room', label: 'الغرفة', type: 'select', options: opts },
                { id: 'reason', label: 'السبب', type: 'text' }
            ], function (v) {
                return window.QamarKingActions.muteInRoom(u.uid, v.room, v.reason).then(_afterAction);
            });
        }
    }

    function _dlgTransfer(u) {
        const rooms = window.QAMAR && window.QAMAR.ROOMS ? window.QAMAR.ROOMS : {};
        const opts = Object.keys(rooms).map(function (id) {
            return { value: id, label: (rooms[id].icon || '🚪') + ' ' + rooms[id].name };
        });
        _promptDlg('🔀 نقل ' + (u.name || ''), [
            { id: 'room', label: 'إلى الغرفة', type: 'select', options: opts },
            { id: 'reason', label: 'السبب', type: 'text' }
        ], function (v) {
            return window.QamarKingActions.transfer(u.uid, v.room, v.reason).then(_afterAction);
        });
    }

    function _dlgPoints(u) {
        _promptDlg('⭐ إهداء نقاط لـ ' + (u.name || ''), [
            { id: 'amount', label: 'العدد (1-10000)', type: 'number', value: '100', min: 1, max: 10000 }
        ], function (v) {
            return window.QamarKingActions.givePoints(u.uid, parseInt(v.amount, 10)).then(_afterAction);
        });
    }

    function _dlgDeleteAccount(u) {
        if (!_isKing100()) { _toast('للملك فقط', 'fa-lock'); return; }
        _promptDlg('🗑️ حذف حساب ' + (u.name || ''), [
            { id: 'confirm', label: 'اكتب "حذف" للتأكيد', type: 'text' }
        ], function (v) {
            if ((v.confirm || '').trim() !== 'حذف') {
                throw new Error('الكتابة غير صحيحة');
            }
            return window.QamarKingActions.deleteAccount(u.uid).then(function () {
                _toast('🗑️ تم الحذف', 'fa-trash');
                _cacheClear(State.activeTab);
                _loadTab(State.activeTab, true);
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Open profile                                    */
    /* ══════════════════════════════════════════════ */
    function _openProfile(uid, name) {
        if (!uid) return;
        try {
            if (typeof window.openUserProfile === 'function') {
                window.openUserProfile(uid, name || '');
                return;
            }
        } catch (e) {}
        try {
            localStorage.setItem('profile_target_uid', uid);
            localStorage.setItem('profile_target_name', name || '');
            const f = document.getElementById('profile-frame-container');
            const i = document.getElementById('profile-iframe');
            if (i && f) {
                i.src = 'profile.html?uid=' + encodeURIComponent(uid) + '&t=' + Date.now();
                f.style.display = 'block';
            }
        } catch (e) {}
    }

    /* ══════════════════════════════════════════════ */
    /* Open / Close                                    */
    /* ══════════════════════════════════════════════ */
    function open(startTab) {
        if (!_canDo('canOpenKingRoom') && !_isKing100()) {
            _toast('لا تملك صلاحية دخول غرفة الملك', 'fa-lock');
            return Promise.resolve({ ok: false, reason: 'forbidden' });
        }

        _ensureStyles();
        const ov = _ensureModal();
        ov.classList.add('active');
        State.open = true;

        // header info
        const info = document.getElementById('kr-head-info');
        if (info) {
            const u = _getCurrentUser();
            info.textContent = '· ' + (u ? u.name : '—') + ' · ' + _myLevel();
        }

        _renderTabs();

        // افتح التبويب المطلوب أو أول واحد
        if (startTab && TABS[startTab] && _canSeeTab(startTab)) {
            switchTab(startTab);
        } else if (State.activeTab) {
            switchTab(State.activeTab);
        } else {
            switchTab('overview');
        }

        _emit('king-room:opened', { tab: State.activeTab });
        Logger.info('👑 King room opened');
        return Promise.resolve({ ok: true });
    }

    function close() {
        if (State.modalEl) State.modalEl.classList.remove('active');
        State.open = false;
        _closeAllMenus();
        _emit('king-room:closed', {});
        Logger.info('👑 King room closed');
        return { ok: true };
    }

    function isOpen() { return State.open; }

    function reload() {
        if (State.activeTab) {
            _cacheClear(State.activeTab);
            _loadTab(State.activeTab, true);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onKingEvent(cb) {
        if (typeof cb !== 'function') return function () {};
        State.listeners.push(cb);
        return function off() {
            State.listeners = State.listeners.filter(function (h) { return h !== cb; });
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        const allowed = Object.keys(TABS).filter(_canSeeTab);
        return {
            initialized: State._initialized,
            open: State.open,
            activeTab: State.activeTab,
            isKing100: _isKing100(),
            myLevel: _myLevel(),
            allowedTabs: allowed,
            cachedTabs: Object.keys(State.cache),
            loadingTabs: Object.keys(State.loading).filter(function (k) { return State.loading[k]; })
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarKingRoom = {
        CONFIG: CONFIG,
        TABS: TABS,

        open: open,
        close: close,
        isOpen: isOpen,
        reload: reload,
        switchTab: switchTab,
        canSeeTab: _canSeeTab,

        clearCache: _cacheClear,

        onKingEvent: onKingEvent,
        getStatus: getStatus
    };

    State._initialized = true;
    Logger.info('📦 [king-room.js] loaded |', Object.keys(TABS).length, 'tabs | cache', CONFIG.CACHE_TTL_MS + 'ms');
})();
