// ==============================================
// king/king-queens.js
// Manage 4 royals (rankLevel 90) + custom permissions
// ==============================================
// يعتمد على: firebase.js + auth.js + ranks.js + audit.js + king-actions.js
// يعطي: window.QamarKingQueens
// ==============================================
// ⚡ تحسينات السرعة:
//   1. cache 30s
//   2. لا listeners — once فقط
//   3. قراءة حقول محددة
//   4. حفظ batch (multiUpdate)
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [king-queens] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[KQ]';
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
        CACHE_TTL_MS: 30 * 1000,
        MAX_ROYALS: 4
    };

    /* ══════════════════════════════════════════════ */
    /* Permissions — 40 صلاحية في 8 مجموعات             */
    /* (key + alias snake_case للتوافق مع ranks.js)    */
    /* ══════════════════════════════════════════════ */
    const PERMISSION_GROUPS = [
        {
            id: 'rank',
            label: '🎖️ إدارة الرتب',
            items: [
                { key: 'canPromote', alias: 'can_promote', label: 'ترقية الأعضاء' },
                { key: 'canDemote',  alias: 'can_demote',  label: 'تخفيض الأعضاء' }
            ]
        },
        {
            id: 'punish',
            label: '⚔️ العقوبات',
            items: [
                { key: 'canWarn',         alias: 'can_warn',          label: 'تحذير' },
                { key: 'canJail',         alias: 'can_jail',          label: 'سجن' },
                { key: 'canBan',          alias: 'can_ban_temp',      label: 'حظر' },
                { key: 'canBanAdmins',    alias: 'can_ban_admins',    label: 'حظر الإداريين' },
                { key: 'canBanQueens',    alias: 'can_ban_queens',    label: 'حظر الملوك' },
                { key: 'canUnban',        alias: 'can_unban',         label: 'فك الحظر' },
                { key: 'canKickFromRoom', alias: 'can_kick_from_room',label: 'طرد من الغرفة' },
                { key: 'canKickFromMic',  alias: 'can_kick_from_mic', label: 'طرد من المايك' },
                { key: 'canMuteGlobal',   alias: 'can_mute_global',   label: 'كتم كامل' },
                { key: 'canMuteInRoom',   alias: 'can_mute_in_room',  label: 'كتم في غرفة' },
                { key: 'canTransferUsers',alias: 'can_transfer_users',label: 'نقل الأعضاء' }
            ]
        },
        {
            id: 'rooms',
            label: '🚪 إدارة الغرف',
            items: [
                { key: 'canCreateRooms', alias: 'can_create_rooms', label: 'إنشاء غرف' },
                { key: 'canDeleteRooms', alias: 'can_delete_rooms', label: 'حذف غرف' },
                { key: 'canEditRooms',   alias: 'can_edit_rooms',   label: 'تعديل غرف' },
                { key: 'canMuteRoom',    alias: 'can_mute_room',    label: 'كتم غرفة' }
            ]
        },
        {
            id: 'bots',
            label: '🤖 البوتات',
            items: [
                { key: 'canOpenKingPanel',   alias: 'can_open_king_panel',   label: 'فتح لوحة الملك' },
                { key: 'canEditHakawati',    alias: 'can_edit_hakawati',     label: 'تعديل حكاواتي' },
                { key: 'canEditQuiz',        alias: 'can_edit_quiz',         label: 'تعديل المسابقات' },
                { key: 'canEditIslamic',     alias: 'can_edit_islamic',      label: 'تعديل الإسلاميات' },
                { key: 'canEditBadWords',    alias: 'can_edit_bad_words',    label: 'تعديل كلمات السجن' },
                { key: 'canEditKickWords',   alias: 'can_edit_kick_words',   label: 'تعديل كلمات الطرد' },
                { key: 'canTrainBots',       alias: 'can_train_bots',        label: 'تدريب البوتات' },
                { key: 'canDeleteBotMemory', alias: 'can_delete_bot_memory', label: 'مسح ذاكرة البوتات' }
            ]
        },
        {
            id: 'messages',
            label: '💬 الرسائل',
            items: [
                { key: 'canDeleteAnyMessage',    alias: 'can_delete_any_message',     label: 'حذف أي رسالة' },
                { key: 'canSeePrivateMessages',  alias: 'can_see_private_messages',   label: 'مراقبة الخاص' },
                { key: 'canSeeDeletedMessages',  alias: 'can_see_deleted_messages',   label: 'رؤية المحذوفات' },
                { key: 'canEditOthersMessages',  alias: 'can_edit_others_messages',   label: 'تعديل رسائل الآخرين' }
            ]
        },
        {
            id: 'points',
            label: '⭐ النقاط',
            items: [
                { key: 'canGivePoints',      alias: 'can_give_points',       label: 'إهداء نقاط' },
                { key: 'canGiveSelfPoints',  alias: 'can_give_self_points',  label: 'إهداء نقاط لنفسه' },
                { key: 'canClearUserPoints', alias: 'can_clear_user_points', label: 'مسح نقاط عضو' },
                { key: 'canResetAllPoints',  alias: 'can_reset_all_points',  label: 'تصفير كل النقاط' }
            ]
        },
        {
            id: 'alerts',
            label: '📢 الإعلانات',
            items: [
                { key: 'canAnnounceRoom',    alias: 'can_announce_room',     label: 'إعلان في الغرفة' },
                { key: 'canAnnounceAll',     alias: 'can_announce_all',      label: 'إعلان عام' },
                { key: 'canPushAnnounce',    alias: 'can_push_announce',     label: 'إشعار منبثق' },
                { key: 'canSendRoomAlert',   alias: 'can_send_room_alert',   label: 'تنبيه غرفة' },
                { key: 'canSendGlobalAlert', alias: 'can_send_global_alert', label: 'تنبيه عام' }
            ]
        },
        {
            id: 'system',
            label: '🔒 النظام',
            items: [
                { key: 'canInvisible',        alias: 'can_invisible',          label: 'الوضع المخفي' },
                { key: 'canViewAuditLog',     alias: 'can_view_audit_log',     label: 'قراءة سجل النشاط' },
                { key: 'canEditAllProfiles',  alias: 'can_edit_all_profiles',  label: 'تعديل بروفايلات الأعضاء' },
                { key: 'canUseMic',           alias: 'can_use_mic',            label: 'استخدام المايك' },
                { key: 'canResetPasswords',   alias: 'can_reset_passwords',    label: 'إعادة كلمات السر' },
                { key: 'canViewDevices',      alias: 'can_view_devices',       label: 'عرض بيانات الأجهزة' },
                { key: 'canOpenKingRoom',     alias: 'can_open_king_room',     label: 'دخول غرفة الملك' },
                { key: 'canViewReports',      alias: 'can_view_reports',       label: 'رؤية التقارير' },
                { key: 'canBanDevice',        alias: 'can_ban_device',         label: 'حظر الأجهزة' },
                { key: 'canBanIP',            alias: 'can_ban_ip',             label: 'حظر الشبكات' }
            ]
        }
    ];

    // فهرس مسطح للبحث
    const PERMISSION_MAP = {};
    PERMISSION_GROUPS.forEach(function (g) {
        g.items.forEach(function (it) {
            PERMISSION_MAP[it.key] = it;
        });
    });

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        cache: null,          // { royals, at }
        listener: null,
        editorOpen: false,
        currentEditUid: null,
        listeners: []
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

    function _now() { return Date.now(); }

    function _emit(name, payload) {
        if (window.EventBus) {
            try { window.EventBus.emit(name, payload); } catch (e) {}
        }
        State.listeners.slice().forEach(function (cb) {
            try { cb({ type: name, data: payload }); } catch (e) {}
        });
    }

    function _cacheGet() {
        const c = State.cache;
        if (!c) return null;
        if (_now() - c.at > CONFIG.CACHE_TTL_MS) {
            State.cache = null;
            return null;
        }
        return c.royals;
    }

    function _cacheSet(royals) {
        State.cache = { royals: royals, at: _now() };
    }

    function _cacheClear() {
        State.cache = null;
    }

    /* ══════════════════════════════════════════════ */
    /* Permission helpers                              */
    /* ══════════════════════════════════════════════ */
    function _hasPermission(customPerms, key) {
        if (!customPerms) return false;
        const it = PERMISSION_MAP[key];
        if (!it) return customPerms[key] === true;
        return customPerms[it.key] === true || customPerms[it.alias] === true;
    }

    function _countPermissions(customPerms) {
        let n = 0;
        Object.keys(PERMISSION_MAP).forEach(function (key) {
            if (_hasPermission(customPerms, key)) n++;
        });
        return n;
    }

    /* ══════════════════════════════════════════════ */
    /* Load royals                                     */
    /* ══════════════════════════════════════════════ */
    function listRoyals(force) {
        if (!force) {
            const cached = _cacheGet();
            if (cached) return Promise.resolve(cached);
        }

        return window.QamarFB.query('users', {
            orderByChild: 'rankLevel',
            equalTo: CONFIG.ROYAL_LEVEL,
            returnArray: true
        }).then(function (arr) {
            return (arr || []).map(function (x) {
                const d = x.data || {};
                return {
                    uid: x.id,
                    name: d.name || '—',
                    avatar: d.avatar || null,
                    code: d.code || null,
                    rank: d.rank || 'User',
                    rankLevel: Number(d.rankLevel) || CONFIG.ROYAL_LEVEL,
                    customPermissions: d.customPermissions || {},
                    isGuest: d.isGuest === true,
                    lastSeen: d.lastSeen || 0
                };
            }).sort(function (a, b) {
                // ملك قبل ملكة، ثم حسب الاسم
                if (a.rank !== b.rank) {
                    if (a.rank === 'King') return -1;
                    if (b.rank === 'King') return 1;
                }
                return String(a.name).localeCompare(String(b.name), 'ar');
            });
        }).catch(function (e) {
            Logger.warn('listRoyals failed:', e.message);
            // fallback — قراءة كامل users
            return window.QamarFB.get('users').then(function (d) {
                if (!d) return [];
                return Object.keys(d).filter(function (uid) {
                    return Number(d[uid].rankLevel) === CONFIG.ROYAL_LEVEL;
                }).map(function (uid) {
                    const u = d[uid];
                    return {
                        uid: uid,
                        name: u.name || '—',
                        avatar: u.avatar || null,
                        code: u.code || null,
                        rank: u.rank || 'User',
                        rankLevel: CONFIG.ROYAL_LEVEL,
                        customPermissions: u.customPermissions || {},
                        isGuest: u.isGuest === true,
                        lastSeen: u.lastSeen || 0
                    };
                });
            });
        }).then(function (list) {
            _cacheSet(list);
            return list;
        });
    }

    function getRoyal(uid) {
        if (!uid) return Promise.resolve(null);
        return window.QamarFB.get('users/' + uid).then(function (d) {
            if (!d) return null;
            if (Number(d.rankLevel) !== CONFIG.ROYAL_LEVEL) return null;
            return {
                uid: uid,
                name: d.name || '—',
                avatar: d.avatar || null,
                rank: d.rank || 'User',
                customPermissions: d.customPermissions || {}
            };
        });
    }

    function getMyPermissions() {
        const uid = _getCurrentUid();
        if (!uid) return Promise.resolve({});
        return window.QamarFB.get('users/' + uid + '/customPermissions')
            .then(function (d) { return d || {}; })
            .catch(function () { return {}; });
    }

    /* ══════════════════════════════════════════════ */
    /* Permission — grant / revoke                     */
    /* ══════════════════════════════════════════════ */
    function grantPermission(uid, key) {
        return _setPermission(uid, key, true);
    }

    function revokePermission(uid, key) {
        return _setPermission(uid, key, false);
    }

    function _setPermission(uid, key, value) {
        return Promise.resolve().then(function () {
            if (!_isKing100()) throw new Error('فقط الملك 100');
            if (!uid || !key) throw new Error('بيانات ناقصة');

            const it = PERMISSION_MAP[key];
            if (!it) throw new Error('صلاحية غير معروفة: ' + key);

            return getRoyal(uid).then(function (r) {
                if (!r) throw new Error('هذا المستخدم ليس برتبة 90');

                const updates = {};
                const base = 'users/' + uid + '/customPermissions/';

                if (value) {
                    updates[base + it.key] = true;
                    updates[base + it.alias] = true;
                } else {
                    updates[base + it.key] = null;
                    updates[base + it.alias] = null;
                }

                return window.QamarFB.multiUpdate(updates).then(function () {
                    _cacheClear();
                    if (window.QamarAudit) {
                        window.QamarAudit.log(value ? 'grantPerm' : 'revokePerm', {
                            targetUid: uid,
                            targetName: r.name,
                            reason: it.label
                        });
                    }
                    _emit('queens:permissionChanged', {
                        uid: uid, key: key, value: value
                    });
                    return { ok: true, uid: uid, key: key, value: value };
                });
            });
        });
    }

    function grantPermissions(uid, keysArray) {
        return Promise.resolve().then(function () {
            if (!_isKing100()) throw new Error('فقط الملك 100');
            if (!uid || !Array.isArray(keysArray) || !keysArray.length) {
                throw new Error('لا صلاحيات');
            }

            return getRoyal(uid).then(function (r) {
                if (!r) throw new Error('ليس برتبة 90');

                const updates = {};
                const base = 'users/' + uid + '/customPermissions/';
                let count = 0;

                keysArray.forEach(function (key) {
                    const it = PERMISSION_MAP[key];
                    if (!it) return;
                    updates[base + it.key] = true;
                    updates[base + it.alias] = true;
                    count++;
                });

                if (!count) throw new Error('لا صلاحيات صالحة');

                return window.QamarFB.multiUpdate(updates).then(function () {
                    _cacheClear();
                    if (window.QamarAudit) {
                        window.QamarAudit.log('grantPermBatch', {
                            targetUid: uid,
                            targetName: r.name,
                            amount: count
                        });
                    }
                    _emit('queens:permissionsGranted', {
                        uid: uid, count: count
                    });
                    return { ok: true, uid: uid, count: count };
                });
            });
        });
    }

    function revokeAllPermissions(uid) {
        return Promise.resolve().then(function () {
            if (!_isKing100()) throw new Error('فقط الملك 100');
            if (!uid) throw new Error('uid مطلوب');

            return getRoyal(uid).then(function (r) {
                if (!r) throw new Error('ليس برتبة 90');

                return window.QamarFB.remove('users/' + uid + '/customPermissions')
                    .then(function () {
                        _cacheClear();
                        if (window.QamarAudit) {
                            window.QamarAudit.log('revokeAllPerms', {
                                targetUid: uid, targetName: r.name
                            });
                        }
                        _emit('queens:permissionsRevoked', { uid: uid });
                        return { ok: true, uid: uid };
                    });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Assign / Remove royal                           */
    /* ══════════════════════════════════════════════ */
    function assignRoyal(uid, label, options) {
        options = options || {};
        return Promise.resolve().then(function () {
            if (!_isKing100()) throw new Error('فقط الملك 100');
            if (!uid) throw new Error('uid مطلوب');
            if (uid === _getCurrentUid()) throw new Error('لا يمكنك تعديل نفسك');
            if (['King', 'Queen'].indexOf(label) === -1) {
                throw new Error('label يجب أن يكون King أو Queen');
            }

            // فحص العدد
            return listRoyals(true).then(function (list) {
                const current = list.length;
                if (current >= CONFIG.MAX_ROYALS && !options.replace) {
                    throw new Error('الحد الأقصى ' + CONFIG.MAX_ROYALS + ' — أزل أحدهم أولاً');
                }

                return window.QamarFB.get('users/' + uid).then(function (u) {
                    if (!u) throw new Error('المستخدم غير موجود');
                    if (Number(u.rankLevel) >= CONFIG.KING_LEVEL) {
                        throw new Error('لا يمكن تعديل الملك');
                    }

                    const updates = {};
                    updates['users/' + uid + '/rank'] = label;
                    updates['users/' + uid + '/rankLevel'] = CONFIG.ROYAL_LEVEL;
                    updates['users/' + uid + '/identityUpdatedAt'] = window.QamarFB.serverTime();

                    return window.QamarFB.multiUpdate(updates).then(function () {
                        _cacheClear();
                        if (window.QamarAudit) {
                            window.QamarAudit.log('assignQueen', {
                                targetUid: uid,
                                targetName: u.name || '—',
                                reason: label
                            });
                        }
                        _emit('queens:assigned', { uid: uid, label: label });
                        Logger.info('👑 Assigned royal:', uid.substring(0, 8), 'as', label);
                        return { ok: true, uid: uid, label: label };
                    });
                });
            });
        });
    }

    function removeRoyal(uid) {
        return Promise.resolve().then(function () {
            if (!_isKing100()) throw new Error('فقط الملك 100');
            if (!uid) throw new Error('uid مطلوب');
            if (uid === _getCurrentUid()) throw new Error('لا يمكنك تعديل نفسك');

            return getRoyal(uid).then(function (r) {
                if (!r) throw new Error('ليس برتبة 90');

                const updates = {};
                updates['users/' + uid + '/rank'] = 'User';
                updates['users/' + uid + '/rankLevel'] = 50;
                updates['users/' + uid + '/queenOrder'] = null;
                updates['users/' + uid + '/customPermissions'] = null;
                updates['users/' + uid + '/identityUpdatedAt'] = window.QamarFB.serverTime();

                return window.QamarFB.multiUpdate(updates).then(function () {
                    _cacheClear();
                    if (window.QamarAudit) {
                        window.QamarAudit.log('removeQueen', {
                            targetUid: uid, targetName: r.name
                        });
                    }
                    _emit('queens:removed', { uid: uid });
                    Logger.info('✅ Removed royal:', uid.substring(0, 8));
                    return { ok: true, uid: uid };
                });
            });
        });
    }

    function setLabel(uid, label) {
        return Promise.resolve().then(function () {
            if (!_isKing100()) throw new Error('فقط الملك 100');
            if (!uid) throw new Error('uid مطلوب');
            if (['King', 'Queen'].indexOf(label) === -1) {
                throw new Error('label يجب أن يكون King أو Queen');
            }

            return getRoyal(uid).then(function (r) {
                if (!r) throw new Error('ليس برتبة 90');

                return window.QamarFB.set('users/' + uid + '/rank', label).then(function () {
                    _cacheClear();
                    _emit('queens:labelChanged', { uid: uid, label: label });
                    return { ok: true, uid: uid, label: label };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* UI — Permission Editor Modal                    */
    /* ══════════════════════════════════════════════ */
    function _ensureStyles() {
        if (document.getElementById('kq-styles')) return;
        const s = document.createElement('style');
        s.id = 'kq-styles';
        s.textContent = [
            '#kq-overlay{position:fixed;inset:0;z-index:18000;background:rgba(0,0,0,0.9);',
            'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);',
            'display:none;align-items:center;justify-content:center;padding:16px;',
            'direction:rtl;font-family:inherit;}',
            '#kq-overlay.active{display:flex;}',

            '#kq-box{background:#0a0616;border:2px solid #a855f7;border-radius:18px;',
            'width:100%;max-width:560px;max-height:92vh;display:flex;flex-direction:column;',
            'overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.9),0 0 40px rgba(168,85,247,0.4);}',

            '#kq-head{padding:14px 16px;background:linear-gradient(135deg,rgba(168,85,247,0.2),rgba(0,0,0,0.4));',
            'border-bottom:1px solid rgba(168,85,247,0.3);display:flex;justify-content:space-between;',
            'align-items:center;flex-shrink:0;}',
            '#kq-head h3{color:#c084fc;margin:0;font-size:15px;font-weight:900;display:flex;align-items:center;gap:8px;}',
            '#kq-head img{width:32px;height:32px;border-radius:50%;border:2px solid #a855f7;}',
            '#kq-close{background:rgba(255,68,68,0.2);border:1px solid rgba(255,68,68,0.5);',
            'color:#ff7777;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:13px;font-weight:900;padding:0;}',

            '#kq-tools{padding:10px 14px;border-bottom:1px solid rgba(168,85,247,0.2);',
            'display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;}',
            '.kq-btn{padding:7px 12px;border-radius:8px;border:none;font-family:inherit;',
            'font-weight:900;font-size:11px;cursor:pointer;}',
            '.kq-btn.all{background:#84cc16;color:#fff;}',
            '.kq-btn.none{background:rgba(255,68,68,0.85);color:#fff;}',
            '.kq-btn.save{background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;}',
            '.kq-counter{margin-right:auto;color:#c084fc;font-size:11px;font-weight:900;padding:7px 10px;}',

            '#kq-body{flex:1;overflow-y:auto;padding:12px;}',

            '.kq-group{margin-bottom:14px;}',
            '.kq-group-title{color:#ffd700;font-size:12px;font-weight:900;padding:8px 10px;',
            'background:rgba(255,215,0,0.08);border-radius:8px;margin-bottom:8px;}',
            '.kq-perm{display:flex;align-items:center;gap:10px;padding:8px 10px;',
            'background:rgba(255,255,255,0.03);border:1px solid rgba(168,85,247,0.15);',
            'border-radius:8px;margin-bottom:4px;cursor:pointer;}',
            '.kq-perm:hover{background:rgba(168,85,247,0.1);}',
            '.kq-perm input{width:18px;height:18px;accent-color:#84cc16;cursor:pointer;flex-shrink:0;}',
            '.kq-perm label{flex:1;color:#ddd;font-size:12.5px;cursor:pointer;font-weight:700;}',
            '.kq-perm.checked{background:rgba(132,204,22,0.1);border-color:rgba(132,204,22,0.4);}',
            '.kq-perm.checked label{color:#a3e635;font-weight:900;}',

            '#kq-actions{padding:12px 14px;border-top:1px solid rgba(168,85,247,0.2);',
            'display:flex;gap:8px;flex-shrink:0;background:rgba(0,0,0,0.3);}',

            '.kq-row-badge{padding:2px 8px;border-radius:20px;font-size:9px;font-weight:900;}',
            '.kq-row-badge.king{background:rgba(255,215,0,0.25);color:#ffd700;}',
            '.kq-row-badge.queen{background:rgba(255,105,180,0.25);color:#ff9ecb;}'
        ].join('');
        document.head.appendChild(s);
    }

    function openPermissionsEditor(uid, forceRefresh) {
        return Promise.resolve().then(function () {
            if (!_isKing100()) throw new Error('فقط الملك 100');

            _ensureStyles();

            // cache edit
            if (!forceRefresh && State.editorOpen && State.currentEditUid === uid) {
                const ov = document.getElementById('kq-overlay');
                if (ov) { ov.classList.add('active'); return { ok: true, cached: true }; }
            }

            return getRoyal(uid).then(function (r) {
                if (!r) throw new Error('هذا المستخدم ليس برتبة 90');
                State.currentEditUid = uid;
                State.editorOpen = true;
                _renderEditor(r);
                return { ok: true, uid: uid };
            });
        });
    }

    function _renderEditor(royal) {
        let ov = document.getElementById('kq-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);

        ov = document.createElement('div');
        ov.id = 'kq-overlay';

        const box = document.createElement('div');
        box.id = 'kq-box';

        // Head
        const head = document.createElement('div');
        head.id = 'kq-head';

        const avatar = royal.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(royal.name || 'U') + '&background=333&color=fff');
        const rankIcon = royal.rank === 'King' ? '👑' : (royal.rank === 'Queen' ? '👸' : '👤');
        const rankLabel = royal.rank === 'King' ? 'ملك' : (royal.rank === 'Queen' ? 'ملكة' : 'رتبة 90');

        head.innerHTML =
            '<h3>' +
                '<img src="' + _esc(avatar) + '" alt="">' +
                '<span>' + _esc(royal.name || '—') + '</span>' +
                '<span style="color:#888;font-size:11px;">' + rankIcon + ' ' + rankLabel + '</span>' +
            '</h3>' +
            '<button id="kq-close" type="button">✕</button>';
        box.appendChild(head);

        // Tools
        const tools = document.createElement('div');
        tools.id = 'kq-tools';
        tools.innerHTML =
            '<button class="kq-btn all" type="button" id="kq-select-all">✅ الكل</button>' +
            '<button class="kq-btn none" type="button" id="kq-select-none">❌ لا شيء</button>' +
            '<span class="kq-counter" id="kq-counter">— صلاحية</span>';
        box.appendChild(tools);

        // Body
        const body = document.createElement('div');
        body.id = 'kq-body';

        PERMISSION_GROUPS.forEach(function (g) {
            const groupEl = document.createElement('div');
            groupEl.className = 'kq-group';

            const title = document.createElement('div');
            title.className = 'kq-group-title';
            title.textContent = g.label;
            groupEl.appendChild(title);

            g.items.forEach(function (it) {
                const checked = _hasPermission(royal.customPermissions, it.key);
                const permEl = document.createElement('label');
                permEl.className = 'kq-perm' + (checked ? ' checked' : '');

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = checked;
                cb.dataset.key = it.key;

                const lbl = document.createElement('span');
                lbl.textContent = it.label;

                permEl.appendChild(cb);
                permEl.appendChild(lbl);

                cb.addEventListener('change', function () {
                    permEl.classList.toggle('checked', cb.checked);
                    _updateCounter(body);
                });

                // منع propagation عند النقر على label
                permEl.addEventListener('click', function (e) {
                    if (e.target === cb) return;
                });

                groupEl.appendChild(permEl);
            });

            body.appendChild(groupEl);
        });

        box.appendChild(body);

        // Actions
        const actions = document.createElement('div');
        actions.id = 'kq-actions';
        actions.innerHTML =
            '<button class="kq-btn none" id="kq-revoke-all" type="button" style="flex:1;">🗑️ سحب كل الصلاحيات</button>' +
            '<button class="kq-btn save" id="kq-save" type="button" style="flex:2;">💾 حفظ التعديلات</button>';
        box.appendChild(actions);

        ov.appendChild(box);
        document.body.appendChild(ov);
        ov.classList.add('active');

        // إغلاق
        head.querySelector('#kq-close').onclick = function () {
            ov.classList.remove('active');
            ov.parentNode && ov.parentNode.removeChild(ov);
            State.editorOpen = false;
            State.currentEditUid = null;
        };
        ov.onclick = function (e) {
            if (e.target === ov) {
                ov.classList.remove('active');
                ov.parentNode && ov.parentNode.removeChild(ov);
                State.editorOpen = false;
                State.currentEditUid = null;
            }
        };

        // Select all/none
        tools.querySelector('#kq-select-all').onclick = function () {
            body.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
                cb.checked = true;
                cb.closest('.kq-perm').classList.add('checked');
            });
            _updateCounter(body);
        };
        tools.querySelector('#kq-select-none').onclick = function () {
            body.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
                cb.checked = false;
                cb.closest('.kq-perm').classList.remove('checked');
            });
            _updateCounter(body);
        };

        // Save
        actions.querySelector('#kq-save').onclick = function () {
            const btn = this;
            btn.disabled = true;
            btn.textContent = '⏳...';

            const keys = [];
            body.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
                if (cb.checked) keys.push(cb.dataset.key);
            });

            _savePermissions(royal.uid, keys).then(function () {
                _toast('✅ تم حفظ ' + keys.length + ' صلاحية', 'fa-check');
                ov.classList.remove('active');
                ov.parentNode && ov.parentNode.removeChild(ov);
                State.editorOpen = false;
                State.currentEditUid = null;
                _emit('queens:editorSaved', { uid: royal.uid, count: keys.length });
            }).catch(function (e) {
                _toast(e.message || 'فشل', 'fa-times');
                btn.disabled = false;
                btn.textContent = '💾 حفظ التعديلات';
            });
        };

        // Revoke all
        actions.querySelector('#kq-revoke-all').onclick = function () {
            if (!confirm('سحب كل الصلاحيات من ' + royal.name + '؟')) return;
            revokeAllPermissions(royal.uid).then(function () {
                _toast('🗑️ تم سحب كل الصلاحيات', 'fa-trash');
                ov.classList.remove('active');
                ov.parentNode && ov.parentNode.removeChild(ov);
                State.editorOpen = false;
                State.currentEditUid = null;
            }).catch(function (e) { _toast(e.message, 'fa-times'); });
        };

        _updateCounter(body);
    }

    function _updateCounter(body) {
        const el = document.getElementById('kq-counter');
        if (!el) return;
        const n = body.querySelectorAll('input[type="checkbox"]:checked').length;
        el.textContent = n + ' / ' + Object.keys(PERMISSION_MAP).length;
    }

    function _savePermissions(uid, keysArray) {
        // استخدم grantPermissions للكل، ثم revoke الباقي
        return Promise.resolve().then(function () {
            if (!_isKing100()) throw new Error('فقط الملك 100');

            // اقرأ الحالي
            return getRoyal(uid).then(function (r) {
                if (!r) throw new Error('ليس برتبة 90');

                const current = r.customPermissions || {};
                const updates = {};
                const base = 'users/' + uid + '/customPermissions/';

                // مفاتيح جديدة
                const newSet = {};
                keysArray.forEach(function (key) {
                    const it = PERMISSION_MAP[key];
                    if (!it) return;
                    newSet[it.key] = true;
                    newSet[it.alias] = true;
                });

                // كامل: امسح ثم اكتب
                // لكن نكتب فقط diff للأداء
                Object.keys(PERMISSION_MAP).forEach(function (key) {
                    const it = PERMISSION_MAP[key];
                    const was = _hasPermission(current, key);
                    const willBe = !!newSet[it.key];

                    if (willBe && !was) {
                        updates[base + it.key] = true;
                        updates[base + it.alias] = true;
                    } else if (!willBe && was) {
                        updates[base + it.key] = null;
                        updates[base + it.alias] = null;
                    }
                });

                if (!Object.keys(updates).length) {
                    return { ok: true, noChange: true };
                }

                return window.QamarFB.multiUpdate(updates).then(function () {
                    _cacheClear();
                    if (window.QamarAudit) {
                        window.QamarAudit.log('grantPermBatch', {
                            targetUid: uid,
                            targetName: r.name,
                            amount: keysArray.length,
                            reason: 'تحديث كامل للصلاحيات'
                        });
                    }
                    return { ok: true, count: keysArray.length };
                });
            });
        });
    }

    function closeEditor() {
        const ov = document.getElementById('kq-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        State.editorOpen = false;
        State.currentEditUid = null;
    }

    function isEditorOpen() { return State.editorOpen; }

    /* ══════════════════════════════════════════════ */
    /* UI — Assign royal modal                         */
    /* ══════════════════════════════════════════════ */
    function openAssignModal(targetUid, targetName, targetAvatar) {
        return Promise.resolve().then(function () {
            if (!_isKing100()) throw new Error('فقط الملك 100');

            _ensureStyles();

            const ov = document.createElement('div');
            ov.id = 'kq-overlay';

            const box = document.createElement('div');
            box.id = 'kq-box';

            const head = document.createElement('div');
            head.id = 'kq-head';
            head.innerHTML =
                '<h3><span>👑</span><span>ترقية إلى رتبة 90</span></h3>' +
                '<button id="kq-close" type="button">✕</button>';
            box.appendChild(head);

            const body = document.createElement('div');
            body.id = 'kq-body';

            const avatar = targetAvatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(targetName || 'U') + '&background=333&color=fff');

            body.innerHTML =
                '<div style="text-align:center;padding:14px 0;">' +
                    '<img src="' + _esc(avatar) + '" style="width:80px;height:80px;border-radius:50%;border:3px solid #ffd700;object-fit:cover;">' +
                    '<div style="color:#fff;font-size:16px;font-weight:900;margin-top:10px;">' + _esc(targetName || '—') + '</div>' +
                '</div>' +
                '<div style="background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.3);border-radius:10px;padding:12px;margin-bottom:12px;">' +
                    '<div style="color:#c084fc;font-size:12px;font-weight:900;margin-bottom:8px;">اختر اللقب البصري:</div>' +
                    '<label style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.04);border-radius:8px;cursor:pointer;margin-bottom:6px;">' +
                        '<input type="radio" name="kq-label" value="King" checked style="width:18px;height:18px;accent-color:#ffd700;">' +
                        '<span style="color:#ffd700;font-weight:900;">👑 ملك</span>' +
                    '</label>' +
                    '<label style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.04);border-radius:8px;cursor:pointer;">' +
                        '<input type="radio" name="kq-label" value="Queen" style="width:18px;height:18px;accent-color:#ff69b4;">' +
                        '<span style="color:#ff69b4;font-weight:900;">👸 ملكة</span>' +
                    '</label>' +
                '</div>' +
                '<div style="color:#888;font-size:11px;text-align:center;line-height:1.6;">' +
                    'سيحصل على رتبة 90 مع صلاحيات أساس.<br>يمكنك تخصيص صلاحياته لاحقاً.' +
                '</div>';
            box.appendChild(body);

            const actions = document.createElement('div');
            actions.id = 'kq-actions';
            actions.innerHTML =
                '<button class="kq-btn none" id="kq-cancel" type="button" style="flex:1;">إلغاء</button>' +
                '<button class="kq-btn save" id="kq-assign" type="button" style="flex:2;">👑 ترقية</button>';
            box.appendChild(actions);

            ov.appendChild(box);
            document.body.appendChild(ov);
            ov.classList.add('active');

            const close = function () {
                ov.classList.remove('active');
                ov.parentNode && ov.parentNode.removeChild(ov);
            };

            head.querySelector('#kq-close').onclick = close;
            actions.querySelector('#kq-cancel').onclick = close;
            ov.onclick = function (e) { if (e.target === ov) close(); };

            actions.querySelector('#kq-assign').onclick = function () {
                const labelEl = body.querySelector('input[name="kq-label"]:checked');
                if (!labelEl) { _toast('اختر اللقب', 'fa-times'); return; }
                const label = labelEl.value;

                const btn = this;
                btn.disabled = true;
                btn.textContent = '⏳...';

                assignRoyal(targetUid, label).then(function () {
                    _toast('👑 تم التعيين', 'fa-check');
                    close();
                    _emit('queens:assignedByModal', { uid: targetUid, label: label });
                }).catch(function (e) {
                    _toast(e.message || 'فشل', 'fa-times');
                    btn.disabled = false;
                    btn.textContent = '👑 ترقية';
                });
            };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            isKing100: _isKing100(),
            myLevel: _myLevel(),
            cached: !!State.cache,
            cacheAge: State.cache ? (_now() - State.cache.at) : null,
            editorOpen: State.editorOpen,
            currentEditUid: State.currentEditUid ? State.currentEditUid.substring(0, 8) : null,
            permissionGroups: PERMISSION_GROUPS.length,
            permissionTotal: Object.keys(PERMISSION_MAP).length,
            maxRoyals: CONFIG.MAX_ROYALS
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onQueensEvent(cb) {
        if (typeof cb !== 'function') return function () {};
        State.listeners.push(cb);
        return function off() {
            State.listeners = State.listeners.filter(function (h) { return h !== cb; });
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarKingQueens = {
        CONFIG: CONFIG,
        PERMISSION_GROUPS: PERMISSION_GROUPS,
        PERMISSION_MAP: PERMISSION_MAP,

        // Read
        listRoyals: listRoyals,
        getRoyal: getRoyal,
        getMyPermissions: getMyPermissions,

        // Permissions
        grantPermission: grantPermission,
        revokePermission: revokePermission,
        grantPermissions: grantPermissions,
        revokeAllPermissions: revokeAllPermissions,
        hasPermission: _hasPermission,
        countPermissions: _countPermissions,

        // Assign
        assignRoyal: assignRoyal,
        removeRoyal: removeRoyal,
        setLabel: setLabel,

        // UI
        openPermissionsEditor: openPermissionsEditor,
        openAssignModal: openAssignModal,
        closeEditor: closeEditor,
        isEditorOpen: isEditorOpen,

        // Cache
        clearCache: _cacheClear,

        // Events
        onQueensEvent: onQueensEvent,

        // Status
        getStatus: getStatus
    };

    Logger.info('📦 [king-queens.js] loaded | groups:', PERMISSION_GROUPS.length, '| perms:', Object.keys(PERMISSION_MAP).length);
})();
