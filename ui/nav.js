// ==============================================
// ui/nav.js
// Bottom Nav + Sidebars + Header buttons
// ==============================================
// يعتمد على: rooms.js + pm.js + auth.js + session.js + EventBus
// يعطي: window.QamarNav
// ==============================================
// ⭐ يغطي:
//   1. Bottom nav (5 أزرار) → يفتح sidebars
//   2. Sidebars (rooms, notifications, pm, settings)
//   3. Header buttons (menu, pm-slot, notif-slot, king-room-btn)
//   4. Backdrop + إغلاق بـ Escape
//   5. أزرار الإعدادات (logout، إلخ)
// ==============================================

(function () {
    'use strict';

    if (window.QamarNav) return;

    const LOG_TAG = '[NAV]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        els: {},
        currentSidebar: null,
        ready: false,
        listeners: [],
        _initialized: false
    };

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _q(sel) { return document.querySelector(sel); }
    function _qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
    function _byId(id) { return document.getElementById(id); }

    function _esc(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function _toast(msg) {
        if (window.showToast) { try { window.showToast('fa-info-circle', msg); return; } catch (e) {} }
        Logger.info('toast:', msg);
    }

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

    function _isGuest() {
        if (window.QamarAuth && window.QamarAuth.isGuest) return window.QamarAuth.isGuest();
        return false;
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
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
    /* Find elements                                   */
    /* ══════════════════════════════════════════════ */
    function _findEls() {
        State.els = {
            // Bottom nav
            bottomNav: _byId('bottom-nav'),
            navBtns: _qa('.nav-btn'),

            // Header
            menuBtn: _byId('menu-btn'),
            pmSlot: _byId('pm-slot'),
            notifSlot: _byId('notif-slot'),
            kingRoomBtn: _byId('king-room-btn'),

            // Sidebars
            sidebarBackdrop: _byId('sidebar-backdrop'),
            sidebarRooms: _byId('sidebar-rooms'),
            sidebarNotif: _byId('sidebar-notifications'),
            sidebarPM: _byId('sidebar-pm'),
            sidebarSettings: _byId('sidebar-settings'),

            // Sidebar bodies
            roomsList: _byId('rooms-list'),
            notifList: _byId('notifications-list'),
            pmChatsList: _byId('pm-chats-list'),
            settingsList: _byId('settings-list'),

            // PM Modal
            pmModal: _byId('pm-modal'),
            pmBack: _byId('pm-back'),
            pmPeerAvatar: _byId('pm-peer-avatar'),
            pmPeerName: _byId('pm-peer-name'),
            pmPeerStatus: _byId('pm-peer-status'),
            pmMenu: _byId('pm-menu'),
            pcMessages: _byId('pc-messages'),
            pcInput: _byId('pc-input'),
            pcSend: _byId('pc-send')
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Sidebar open/close                              */
    /* ══════════════════════════════════════════════ */
    function openSidebar(name) {
        if (!name) return;
        closeSidebar(); // أغلق المفتوح

        const sb = _sidebarEl(name);
        if (!sb) {
            Logger.warn('sidebar not found:', name);
            return;
        }

        sb.classList.add('open');
        State.currentSidebar = name;

        // Backdrop
        if (State.els.sidebarBackdrop) {
            State.els.sidebarBackdrop.classList.remove('hidden');
        }

        // حدّث bottom nav active
        _updateNavActive(name);

        // fill content
        _fillSidebar(name);

        _emit('nav:sidebarOpened', { name: name });
        Logger.info('📂 Sidebar opened:', name);
    }

    function closeSidebar() {
        if (State.currentSidebar) {
            const sb = _sidebarEl(State.currentSidebar);
            if (sb) sb.classList.remove('open');
            _emit('nav:sidebarClosed', { name: State.currentSidebar });
        }
        State.currentSidebar = null;

        if (State.els.sidebarBackdrop) {
            State.els.sidebarBackdrop.classList.add('hidden');
        }

        // أعد الـ bottom nav للشات
        _updateNavActive(null);
    }

    function _sidebarEl(name) {
        switch (name) {
            case 'rooms':         return State.els.sidebarRooms;
            case 'notifications': return State.els.sidebarNotif;
            case 'pm':            return State.els.sidebarPM;
            case 'settings':      return State.els.sidebarSettings;
        }
        return null;
    }

    function _updateNavActive(name) {
        State.els.navBtns.forEach(function (b) {
            b.classList.toggle('active', b.dataset.nav === name || (!name && b.dataset.nav === 'chat'));
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Fill sidebar content                            */
    /* ══════════════════════════════════════════════ */
    function _fillSidebar(name) {
        if (name === 'rooms')         _fillRooms();
        else if (name === 'notifications') _fillNotifications();
        else if (name === 'pm')       _fillPMChats();
        else if (name === 'settings') _fillSettings();
    }

    function _fillRooms() {
        const el = State.els.roomsList;
        if (!el) return;
        el.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';

        // استخدم QamarRooms إذا متاح
        if (!window.QamarRooms) {
            el.innerHTML = '<div class="empty-state">🚪 نظام الغرف غير جاهز</div>';
            return;
        }

        let rooms = [];
        try {
            rooms = window.QamarRooms.listVisible() || [];
        } catch (e) {
            Logger.warn('listVisible failed:', e.message);
        }

        if (!rooms.length) {
            el.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🚪</span>لا توجد غرف</div>';
            return;
        }

        el.innerHTML = '';
        const currentRoom = (window.AppState && window.AppState.currentRoom) || 'general';

        rooms.forEach(function (room) {
            const item = document.createElement('div');
            item.className = 'sidebar-item' + (room.id === currentRoom ? ' active' : '');
            item.dataset.roomId = room.id;
            item.innerHTML =
                '<span style="font-size:22px;flex-shrink:0;">' + _esc(room.icon || '🚪') + '</span>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="color:#fff;font-weight:900;font-size:13px;">' + _esc(room.name || room.id) + '</div>' +
                    '<div style="color:#888;font-size:10px;margin-top:2px;">' +
                        (room.memberCount || 0) + ' متصل' +
                        (room.muted ? ' · 🔇' : '') +
                    '</div>' +
                '</div>';
            item.onclick = function () { _switchRoom(room.id); };
            el.appendChild(item);
        });

        _emit('nav:roomsFilled', { count: rooms.length });
    }

    function _fillNotifications() {
        const el = State.els.notifList;
        if (!el) return;
        const uid = _getCurrentUid();

        if (!uid) {
            el.innerHTML = '<div class="empty-state">سجّل دخولك لعرض التنبيهات</div>';
            return;
        }

        el.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';

        if (!window.QamarFB) {
            el.innerHTML = '<div class="empty-state">⚠️ Firebase غير متاح</div>';
            return;
        }

        window.QamarFB.query('user_notifications/' + uid, {
            orderByChild: 'time',
            limitToLast: 50,
            returnArray: true
        }).then(function (arr) {
            const list = (arr || []).map(function (r) {
                return Object.assign({ _id: r.id }, r.data);
            }).sort(function (a, b) { return (b.time || 0) - (a.time || 0); });

            _renderNotifications(el, list);
        }).catch(function (e) {
            Logger.warn('notifications load failed:', e.message);
            el.innerHTML = '<div class="empty-state">لا توجد تنبيهات</div>';
        });
    }

    function _renderNotifications(el, list) {
        if (!list.length) {
            el.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🔔</span>لا توجد تنبيهات</div>';
            return;
        }

        el.innerHTML = '';
        list.forEach(function (n) {
            const item = document.createElement('div');
            item.className = 'sidebar-item' + (!n.read ? ' active' : '');

            let icon = '🔔';
            let text = '—';
            if (n.type === 'ban')              { icon = '🚫'; text = 'تم حظرك: ' + (n.reason || ''); }
            else if (n.type === 'jail')        { icon = '⛓️'; text = 'تم سجنك: ' + (n.reason || ''); }
            else if (n.type === 'mic_kick')    { icon = '🎤'; text = 'تم طردك من المايك'; }
            else if (n.type === 'report_sent') { icon = '🚨'; text = 'تم إرسال تقريرك'; }
            else if (n.type === 'guardian_inbox') { icon = '🚨'; text = n.preview || 'تنبيه من السجان'; }
            else text = n.preview || n.type || 'تنبيه';

            item.innerHTML =
                '<span style="font-size:22px;flex-shrink:0;">' + icon + '</span>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="color:#fff;font-size:12px;line-height:1.5;">' + _esc(text) + '</div>' +
                    '<div style="color:#666;font-size:10px;margin-top:3px;">' + _timeAgo(n.time || n.at) + '</div>' +
                '</div>';
            item.onclick = function () {
                if (window.QamarFB) {
                    window.QamarFB.update('user_notifications/' + _getCurrentUid() + '/' + n._id, { read: true })
                        .catch(function () {});
                }
                item.classList.remove('active');
            };
            el.appendChild(item);
        });
    }

    function _fillPMChats() {
        const el = State.els.pmChatsList;
        if (!el) return;
        const uid = _getCurrentUid();

        if (!uid) {
            el.innerHTML = '<div class="empty-state">سجّل دخولك لعرض المحادثات</div>';
            return;
        }
        if (_isGuest()) {
            el.innerHTML = '<div class="empty-state"><span class="empty-state-icon">💬</span>الزوار لا يمكنهم استخدام الخاص</div>';
            return;
        }

        el.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';

        if (!window.QamarPM) {
            el.innerHTML = '<div class="empty-state">⚠️ نظام الخاص غير جاهز</div>';
            return;
        }

        window.QamarPM.listChats().then(function (list) {
            if (!list || !list.length) {
                el.innerHTML = '<div class="empty-state"><span class="empty-state-icon">💬</span>لا توجد محادثات</div>';
                return;
            }
            el.innerHTML = '';
            list.forEach(function (c) {
                const item = document.createElement('div');
                item.className = 'sidebar-item';
                item.innerHTML =
                    '<img src="' + _esc(c.otherAvatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(c.otherName || 'U') + '&background=333&color=fff')) + '" ' +
                        'style="width:42px;height:42px;border-radius:50%;border:2px solid rgba(212,175,55,0.4);object-fit:cover;flex-shrink:0;" ' +
                        'onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=333&color=fff\'">' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">' +
                            '<div style="color:#fff;font-weight:900;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                                _esc(c.otherName || '—') +
                            '</div>' +
                            (c.unread > 0 ?
                                '<span class="badge" style="position:static;min-width:20px;height:20px;padding:0 6px;">' + c.unread + '</span>'
                            : '') +
                        '</div>' +
                        '<div style="color:#888;font-size:11px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                            _esc(c.lastMessage || '—') +
                        '</div>' +
                        '<div style="color:#666;font-size:9px;margin-top:2px;">' + _timeAgo(c.lastTime) + '</div>' +
                    '</div>';
                item.onclick = function () { _openPM(c.otherUid); };
                el.appendChild(item);
            });
        }).catch(function (e) {
            Logger.warn('listChats failed:', e.message);
            el.innerHTML = '<div class="empty-state">لا توجد محادثات</div>';
        });
    }

    function _fillSettings() {
        const el = State.els.settingsList;
        if (!el) return;
        const user = _getCurrentUser() || {};
        const isGuest = _isGuest();

        el.innerHTML = '';

        // بطاقة الحساب
        const card = document.createElement('div');
        card.style.cssText =
            'background:linear-gradient(135deg,rgba(212,175,55,0.12),rgba(168,85,247,0.1));' +
            'border:1px solid rgba(212,175,55,0.3);border-radius:12px;padding:14px;' +
            'margin-bottom:12px;display:flex;align-items:center;gap:12px;';
        card.innerHTML =
            '<img src="' + _esc(user.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name || 'U') + '&background=333&color=fff')) + '" ' +
                'style="width:50px;height:50px;border-radius:50%;border:2px solid #d4af37;object-fit:cover;">' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="color:#fff;font-size:14px;font-weight:900;">' + _esc(user.name || '—') + '</div>' +
                '<div style="color:#888;font-size:11px;margin-top:2px;">' +
                    (isGuest ? '🎭 زائر' : '👤 ' + (user.rank || 'User')) +
                    (user.code ? ' · ' + _esc(user.code) : '') +
                '</div>' +
            '</div>';
        el.appendChild(card);

        // قائمة الإعدادات
        const items = [
            { icon: '👤', label: 'بروفايلي', action: 'profile' }
        ];

        if (isGuest) {
            items.push({ icon: '✨', label: 'ترقية الحساب', action: 'upgrade', gold: true });
        } else {
            items.push({ icon: '🚪', label: 'تسجيل الخروج', action: 'logout', danger: true });
        }

        items.forEach(function (it) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText =
                'display:flex;align-items:center;gap:10px;width:100%;' +
                'background:rgba(255,255,255,0.04);border:1px solid rgba(212,175,55,0.15);' +
                'color:' + (it.danger ? '#ff8888' : (it.gold ? '#ffd700' : '#f3f4f6')) + ';' +
                'padding:13px 14px;border-radius:10px;margin-bottom:8px;' +
                'font-family:inherit;font-size:13px;font-weight:900;' +
                'cursor:pointer;text-align:right;';
            btn.innerHTML =
                '<span style="font-size:18px;">' + it.icon + '</span>' +
                '<span style="flex:1;">' + it.label + '</span>' +
                '<span style="color:#666;font-size:14px;">‹</span>';
            btn.onclick = function (e) {
                e.preventDefault();
                _execSettingAction(it.action);
            };
            el.appendChild(btn);
        });

        // معلومات إضافية
        const info = document.createElement('div');
        info.style.cssText =
            'text-align:center;color:#666;font-size:11px;padding:14px;line-height:1.7;';
        info.innerHTML =
            '<div>🌙 قمر الشام</div>' +
            '<div>v2.0.0</div>';
        el.appendChild(info);
    }

    function _execSettingAction(action) {
        if (action === 'logout') {
            if (!confirm('تسجيل الخروج؟')) return;
            if (window.QamarAuth && window.QamarAuth.signOut) {
                window.QamarAuth.signOut().then(function () {
                    _toast('✅ تم تسجيل الخروج');
                    closeSidebar();
                }).catch(function (e) {
                    _toast('فشل: ' + e.message);
                });
            }
        } else if (action === 'upgrade') {
            const m = _byId('upgrade-modal');
            if (m) {
                m.classList.remove('hidden');
                const closeBtn = m.querySelector('.modal-close');
                if (closeBtn) closeBtn.onclick = function () { m.classList.add('hidden'); };
            } else {
                _toast('الترقية متاحة من قائمة الحساب');
            }
        } else if (action === 'profile') {
            const uid = _getCurrentUid();
            if (uid && window.QamarNav && window.QamarNav.openProfile) {
                window.QamarNav.openProfile(uid, _getCurrentUser().name || '');
            } else {
                _toast('البروفايل غير متاح بعد');
            }
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Switch room                                     */
    /* ══════════════════════════════════════════════ */
    function _switchRoom(roomId) {
        if (!roomId) return;

        // حدّث الـ active في القائمة
        _qa('.sidebar-item[data-room-id]').forEach(function (el) {
            el.classList.toggle('active', el.dataset.roomId === roomId);
        });

        // تحديث AppState + localStorage
        if (window.AppState) {
            try { window.AppState.setRoom(roomId); } catch (e) {}
        }
        try { localStorage.setItem('qamar_last_room', roomId); } catch (e) {}

        // ابدأ الشات
        if (window.QamarChat && typeof window.QamarChat.start === 'function') {
            try { window.QamarChat.start(roomId); } catch (e) {}
        }

        // أطلق room:changed
        if (window.EventBus) {
            try {
                window.EventBus.emit('room:changed', roomId, { roomId: roomId });
            } catch (e) {}
        }

        // حدّث الهيدر
        _updateHeaderRoom(roomId);

        // أغلق السايدبار
        closeSidebar();

        _toast('🚪 دخلت: ' + roomId);
        _emit('nav:roomSwitched', { roomId: roomId });
    }

    function _updateHeaderRoom(roomId) {
        try {
            const rooms = (window.QAMAR && window.QAMAR.ROOMS) ? window.QAMAR.ROOMS : {};
            const room = rooms[roomId];
            if (!room) return;
            const iconEl = _byId('room-icon');
            const titleEl = _byId('room-title');
            if (iconEl) iconEl.textContent = room.icon || '🌍';
            if (titleEl) titleEl.textContent = room.name || roomId;
        } catch (e) {}
    }

    function _timeAgo(ts) {
        if (!ts) return '—';
        if (window.timeAgo) return window.timeAgo(ts);
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 60) return 'الآن';
        const m = Math.floor(s / 60);
        if (m < 60) return 'قبل ' + m + ' د';
        const h = Math.floor(m / 60);
        if (h < 24) return 'قبل ' + h + ' س';
        return 'قبل ' + Math.floor(h / 24) + ' ي';
    }

    /* ══════════════════════════════════════════════ */
    /* PM Modal                                        */
    /* ══════════════════════════════════════════════ */
    function _openPM(otherUid) {
        if (!otherUid) return;
        if (!window.QamarPM) {
            _toast('نظام الخاص غير جاهز');
            return;
        }

        closeSidebar();

        const modal = State.els.pmModal;
        if (!modal) return;
        modal.classList.remove('hidden');

        // املأ الهيدر
        window.QamarFB.get('users/' + otherUid).then(function (u) {
            if (State.els.pmPeerName) State.els.pmPeerName.textContent = (u && u.name) || '—';
            if (State.els.pmPeerAvatar) {
                State.els.pmPeerAvatar.src = (u && u.avatar) ||
                    ('https://ui-avatars.com/api/?name=' + encodeURIComponent((u && u.name) || 'U') + '&background=333&color=fff');
            }
            if (State.els.pmPeerStatus) {
                State.els.pmPeerStatus.textContent = (u && u.lastSeen) ? 'آخر ظهور: ' + _timeAgo(u.lastSeen) : '—';
            }
        }).catch(function () {});

        // ابدأ الشات
        try { window.QamarPM.start(otherUid); } catch (e) {}
        try { window.QamarPM.markAsRead(otherUid); } catch (e) {}

        _emit('nav:pmOpened', { otherUid: otherUid });
    }

    function _closePM() {
        if (State.els.pmModal) State.els.pmModal.classList.add('hidden');
        if (window.QamarPM && window.QamarPM.stop) {
            try { window.QamarPM.stop(); } catch (e) {}
        }
        _emit('nav:pmClosed', {});
    }

    /* ══════════════════════════════════════════════ */
    /* Bind events                                     */
    /* ══════════════════════════════════════════════ */
    function _bindBottomNav() {
        State.els.navBtns.forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const nav = btn.dataset.nav;
                if (!nav) return;

                if (nav === 'chat') {
                    closeSidebar();
                } else if (nav === 'rooms') {
                    openSidebar('rooms');
                } else if (nav === 'notifications') {
                    openSidebar('notifications');
                } else if (nav === 'pm') {
                    openSidebar('pm');
                } else if (nav === 'profile') {
                    openSidebar('settings');
                }
            });
        });
    }

    function _bindHeader() {
        // Menu button
        if (State.els.menuBtn) {
            State.els.menuBtn.addEventListener('click', function (e) {
                e.preventDefault();
                openSidebar('settings');
            });
        }

        // PM slot
        if (State.els.pmSlot) {
            State.els.pmSlot.addEventListener('click', function (e) {
                e.preventDefault();
                openSidebar('pm');
            });
        }

        // Notif slot
        if (State.els.notifSlot) {
            State.els.notifSlot.addEventListener('click', function (e) {
                e.preventDefault();
                openSidebar('notifications');
            });
        }

        // King room
        if (State.els.kingRoomBtn) {
            State.els.kingRoomBtn.addEventListener('click', function (e) {
                e.preventDefault();
                if (window.QamarKingRoom && typeof window.QamarKingRoom.open === 'function') {
                    try { window.QamarKingRoom.open(); } catch (e) {
                        _toast('غرفة الملك غير متاحة');
                    }
                } else {
                    _toast('👑 غير متاح بعد');
                }
            });

            // أظهره فقط للملك
            if (_isKing()) {
                State.els.kingRoomBtn.classList.remove('hidden');
            } else {
                State.els.kingRoomBtn.classList.add('hidden');
            }
        }
    }

    function _bindSidebarClose() {
        // Backdrop
        if (State.els.sidebarBackdrop) {
            State.els.sidebarBackdrop.addEventListener('click', function () {
                closeSidebar();
            });
        }

        // Close buttons
        _qa('.sidebar-close').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                closeSidebar();
            });
        });

        // Escape
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (State.currentSidebar) closeSidebar();
                else if (State.els.pmModal && !State.els.pmModal.classList.contains('hidden')) _closePM();
            }
        });
    }

    function _bindPMModal() {
        // Back
        if (State.els.pmBack) {
            State.els.pmBack.addEventListener('click', function (e) {
                e.preventDefault();
                _closePM();
            });
        }

        // PM menu (سنتجاهلها الآن)
        if (State.els.pmMenu) {
            State.els.pmMenu.addEventListener('click', function (e) {
                e.preventDefault();
                _toast('القائمة قادمة');
            });
        }

        // Send
        if (State.els.pcSend && State.els.pcInput) {
            const send = function () {
                const text = State.els.pcInput.value.trim();
                if (!text) return;
                if (!window.QamarPM || !State.els.pmPeerName) return;

                // نحتاج otherUid — من الهيدر
                const otherUid = State.els.pmModal && State.els.pmModal.dataset.otherUid;
                if (!otherUid) return;

                window.QamarPM.send(otherUid, text).then(function () {
                    State.els.pcInput.value = '';
                    State.els.pcSend.classList.add('disabled');
                }).catch(function (e) {
                    _toast(e.message || 'فشل الإرسال');
                });
            };

            State.els.pcSend.addEventListener('click', send);
            State.els.pcInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                }
            });
            State.els.pcInput.addEventListener('input', function () {
                State.els.pcSend.classList.toggle('disabled', !State.els.pcInput.value.trim());
            });
        }
    }

    /* ══════════════════════════════════════════════ */
    /* EventBus hooks                                  */
    /* ══════════════════════════════════════════════ */
    function _watchEvents() {
        if (!window.EventBus) return;

        // عند تغير الرتب → أظهر/أخفِ زر الملك
        window.EventBus.on('rank:changed', function () {
            if (State.els.kingRoomBtn) {
                State.els.kingRoomBtn.classList.toggle('hidden', !_isKing());
            }
        });

        // عند تحديث الروم
        window.EventBus.on('room:changed', function (p) {
            const roomId = (typeof p === 'string') ? p : (p && p.roomId);
            if (roomId) _updateHeaderRoom(roomId);
        });

        // عند فتح PM من مكان آخر
        window.EventBus.on('pm:open', function (p) {
            if (p && p.otherUid) _openPM(p.otherUid);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Watch unread counts                             */
    /* ══════════════════════════════════════════════ */
    function _updateBadges() {
        const uid = _getCurrentUid();
        if (!uid) return;

        // PM unread
        if (window.QamarPM && window.QamarPM.getUnreadCount) {
            window.QamarPM.getUnreadCount().then(function (n) {
                const badge = _byId('pm-badge');
                if (!badge) return;
                if (n > 0) {
                    badge.textContent = n > 99 ? '99+' : String(n);
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }).catch(function () {});
        }

        // Notifications unread
        if (window.QamarFB) {
            window.QamarFB.get('user_notifications/' + uid).then(function (data) {
                if (!data) return;
                let n = 0;
                Object.keys(data).forEach(function (k) {
                    if (data[k] && !data[k].read) n++;
                });
                const badge = _byId('notif-badge');
                if (!badge) return;
                if (n > 0) {
                    badge.textContent = n > 99 ? '99+' : String(n);
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }).catch(function () {});
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function init() {
        if (State._initialized) return true;
        _findEls();

        if (!State.els.bottomNav) {
            Logger.warn('bottom-nav not found — will retry');
            return false;
        }

        _bindBottomNav();
        _bindHeader();
        _bindSidebarClose();
        _bindPMModal();
        _watchEvents();

        // راقب unread badges
        setTimeout(_updateBadges, 3000);
        setInterval(_updateBadges, 30000);

        // عند الدخول لأول مرة
        if (window.EventBus) {
            window.EventBus.on('login-flow:success', function () {
                setTimeout(_updateBadges, 1500);
            });
        }

        State._initialized = true;
        Logger.info('📦 [nav.js] initialized');
        return true;
    }

    function _autoInit() {
        if (!init()) setTimeout(_autoInit, 800);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(_autoInit, 700);
        });
    } else {
        setTimeout(_autoInit, 700);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarNav = {
        init: init,
        openSidebar: openSidebar,
        closeSidebar: closeSidebar,
        switchRoom: _switchRoom,
        openPM: _openPM,
        closePM: _closePM,
        updateBadges: _updateBadges,
        openProfile: function (uid, name) {
            try {
                localStorage.setItem('profile_target_uid', uid);
                localStorage.setItem('profile_target_name', name || '');
                const f = _byId('profile-frame-container');
                const i = _byId('profile-iframe');
                if (i && f) {
                    i.src = 'profile.html?uid=' + encodeURIComponent(uid) + '&t=' + Date.now();
                    f.classList.remove('hidden');
                    const close = _byId('pfc-close');
                    if (close) close.onclick = function () { f.classList.add('hidden'); };
                }
            } catch (e) {}
        },
        getStatus: function () {
            return {
                initialized: State._initialized,
                currentSidebar: State.currentSidebar,
                hasBottomNav: !!State.els.bottomNav,
                hasSidebars: !!(State.els.sidebarRooms && State.els.sidebarNotif && State.els.sidebarPM && State.els.sidebarSettings),
                hasPMModal: !!State.els.pmModal,
                isKing: _isKing(),
                isGuest: _isGuest()
            };
        }
    };

    Logger.info('📦 [nav.js] loaded');
})();
