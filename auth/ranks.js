// ==============================================
// auth/ranks.js
// Ranks + Permissions (King + 4× Rank-95)
// ==============================================
// يعتمد على: firebase.js + constants.js + state.js + auth.js
// يعطي: window.QamarRanks
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [ranks] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[RK]';
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
        MAX_HIGH_ROYALS: 4,             // 4 أشخاص برتبة 95
        KING_LEVEL: 100,
        HIGH_ROYAL_LEVEL: 95,           // الملكات/الملوك الثاني-الخامس
        BASE_PERMISSION_LEVEL: 90,      // صلاحيات الأساس لكل رتبة 95
        HIGH_ROYAL_ORDERS: [1, 2, 3, 4],
        CACHE_TTL_MS: 3 * 60 * 1000
    };

    // ═══ قائمة الصلاحيات المخصصة (~40) ═══
    const PERMISSION_KEYS = [
        // Moderation
        'can_kick', 'can_jail', 'can_ban_temp', 'can_ban_perm',
        'can_mute_global', 'can_mute_room', 'can_warn',
        'can_delete_msg', 'can_edit_room', 'can_force_move',

        // Royal
        'can_view_pm', 'can_read_archive', 'can_delete_pm',
        'can_view_invisible', 'can_use_voice_monitor',
        'can_see_suspects', 'can_add_suspect', 'can_send_alerts',
        'can_broadcast',

        // Content
        'can_manage_stories', 'can_manage_bots', 'can_train_bots',
        'can_use_studio', 'can_view_reports', 'can_archive_reports',
        'can_resolve_reports',

        // Users
        'can_promote', 'can_demote', 'can_transfer_users',
        'can_view_devices', 'can_ban_device', 'can_view_ip',
        'can_ban_ip', 'can_view_analytics',

        // System
        'can_edit_settings', 'can_clear_audit', 'can_edit_bots_memory',
        'can_send_system_msg', 'can_reset_room', 'can_manage_cleaners'
    ];

    // ═══ صلاحيات تلقائية لكل من rankLevel >= 90 ═══
    const AUTO_PERMISSIONS_90 = [
        'can_kick', 'can_jail', 'can_ban_temp', 'can_mute_global',
        'can_mute_room', 'can_warn', 'can_delete_msg', 'can_edit_room',
        'can_force_move', 'can_view_reports', 'can_resolve_reports',
        'can_see_suspects', 'can_send_alerts', 'can_promote',
        'can_view_devices', 'can_view_ip', 'can_transfer_users'
    ];

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        cache: {},              // { uid: { rank, rankLevel, queenOrder, customPermissions, at } }
        listeners: []
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onRankChange(cb) {
        if (typeof cb !== 'function') return function () {};
        State.listeners.push(cb);
        return function off() {
            State.listeners = State.listeners.filter(function (h) { return h !== cb; });
        };
    }

    function _emit(eventName, payload) {
        if (window.EventBus) {
            try { window.EventBus.emit(eventName, payload); } catch (e) {}
        }
        if (eventName === 'rank:changed' || eventName === 'rank:permissions') {
            State.listeners.slice().forEach(function (cb) {
                try { cb(payload); } catch (e) { Logger.warn('listener error:', e); }
            });
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _getCurrentUid() {
        if (window.QamarAuth && window.QamarAuth.getUid) return window.QamarAuth.getUid();
        return window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;
    }

    function _getCurrent() {
        if (window.AppState && window.AppState.user) return window.AppState.user;
        if (window.QamarSession && window.QamarSession.getData) return window.QamarSession.getData();
        return null;
    }

    function _currentRankLevel() {
        const u = _getCurrent();
        if (!u) return 0;
        if (u.rankLevel !== undefined && u.rankLevel !== null) return Number(u.rankLevel);
        return (window.QAMAR && window.QAMAR.getRankLevel) ? window.QAMAR.getRankLevel(u.rank) : 0;
    }

    function _currentIsKing() {
        const u = _getCurrent();
        return !!(u && u.rank === 'King');
    }

    /* ══════════════════════════════════════════════ */
    /* Cache                                           */
    /* ══════════════════════════════════════════════ */
    function _cacheGet(uid) {
        const c = State.cache[uid];
        if (!c) return null;
        if (Date.now() - c.at > CONFIG.CACHE_TTL_MS) {
            delete State.cache[uid];
            return null;
        }
        return c;
    }

    function _cacheSet(uid, data) {
        State.cache[uid] = Object.assign({ at: Date.now() }, data);
    }

    function clearCache(uid) {
        if (uid) delete State.cache[uid];
        else State.cache = {};
    }

    /* ══════════════════════════════════════════════ */
    /* Read user rank                                  */
    /* ══════════════════════════════════════════════ */
    function getUserRank(uid, forceRefresh) {
        uid = uid || _getCurrentUid();
        if (!uid) return Promise.resolve(null);

        if (!forceRefresh) {
            const c = _cacheGet(uid);
            if (c) {
                return Promise.resolve({
                    uid: uid,
                    rank: c.rank,
                    rankLevel: c.rankLevel,
                    queenOrder: c.queenOrder,
                    customPermissions: c.customPermissions || {}
                });
            }
        }

        return window.QamarFB.get('users/' + uid).then(function (data) {
            if (!data) return null;
            const info = {
                uid: uid,
                rank: data.rank || 'User',
                rankLevel: data.rankLevel !== undefined ? Number(data.rankLevel) : 50,
                queenOrder: data.queenOrder || null,
                customPermissions: data.customPermissions || {},
                name: data.name || null,
                avatar: data.avatar || null,
                code: data.code || null
            };
            _cacheSet(uid, info);
            return info;
        }).catch(function (e) {
            Logger.warn('getUserRank failed:', e.message);
            return null;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Rank info                                       */
    /* ══════════════════════════════════════════════ */
    function getRankInfo(rank) {
        const levels = (window.QAMAR && window.QAMAR.RANK_LEVELS) || {};
        const level = levels[rank] || 0;
        const icons = {
            'King': '👑', 'Queen': '👸', 'Master Owner': '🌟',
            'Room Owner': '🛡️', 'Grand Owner': '💎', 'Owner': '🏆',
            'Super Admin': '🎖️', 'Admin': '🛠️', 'Premium': '💠', 'User': '👤'
        };
        const colors = {
            'King': '#ffd700', 'Queen': '#ff69b4', 'Master Owner': '#ffa500',
            'Room Owner': '#3498db', 'Grand Owner': '#9b59b6', 'Owner': '#e67e22',
            'Super Admin': '#f1c40f', 'Admin': '#1abc9c', 'Premium': '#e84393',
            'User': '#ffffff'
        };
        return {
            rank: rank,
            level: level,
            icon: icons[rank] || '👤',
            color: colors[rank] || '#ffffff'
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Current user shortcuts                          */
    /* ══════════════════════════════════════════════ */
    function isKing() { return _currentIsKing(); }
    function isQueen() {
        const u = _getCurrent();
        return !!(u && u.rank === 'Queen');
    }
    function isHighRoyal() {
        return _currentRankLevel() >= CONFIG.HIGH_ROYAL_LEVEL;
    }
    function isRoyal() {
        return _currentRankLevel() >= 95;
    }
    function myLevel() {
        return _currentRankLevel();
    }

    /* ══════════════════════════════════════════════ */
    /* Comparisons                                     */
    /* ══════════════════════════════════════════════ */
    function getRankLevel(rank) {
        if (typeof rank === 'number') return rank;
        if (window.QAMAR && window.QAMAR.getRankLevel) return window.QAMAR.getRankLevel(rank);
        return 0;
    }

    function isHigher(a, b) { return getRankLevel(a) > getRankLevel(b); }
    function isHigherOrEqual(a, b) { return getRankLevel(a) >= getRankLevel(b); }

    // هل يمكن للمستخدم الحالي أن يتصرف ضد مستخدم آخر؟
    function canActOn(targetRankLevelOrRank) {
        const myLvl = _currentRankLevel();
        const targetLvl = typeof targetRankLevelOrRank === 'number'
            ? targetRankLevelOrRank
            : getRankLevel(targetRankLevelOrRank);
        if (_currentIsKing()) return true;
        return myLvl > targetLvl;
    }

    /* ══════════════════════════════════════════════ */
    /* Permission checks                               */
    /* ══════════════════════════════════════════════ */
    function hasPermission(permissionKey, uid) {
        if (PERMISSION_KEYS.indexOf(permissionKey) === -1) return false;

        // الملك يملك كل شيء
        if (!uid && _currentIsKing()) return true;

        const info = uid ? _cacheGet(uid) : null;
        const u = _getCurrent();

        // نقرأ من الكاش أو مباشرة
        const rank = info ? info.rank : (u ? u.rank : null);
        const level = info ? info.rankLevel : (u ? u.rankLevel : null);
        const custom = info ? (info.customPermissions || {}) : (u ? (u.customPermissions || {}) : {});

        if (rank === 'King') return true;

        // صلاحيات ممنوعة على الجميع عدا الملك
        const KING_ONLY = [
            'can_clear_audit', 'can_edit_settings', 'can_edit_bots_memory',
            'can_send_system_msg', 'can_reset_room', 'can_manage_cleaners',
            'can_ban_device', 'can_ban_ip'
        ];
        if (KING_ONLY.indexOf(permissionKey) !== -1) return false;

        // صلاحيات أساسية حسب المستوى
        const lvl = Number(level) || 0;
        if (lvl >= CONFIG.BASE_PERMISSION_LEVEL && AUTO_PERMISSIONS_90.indexOf(permissionKey) !== -1) {
            return true;
        }

        // صلاحيات مخصصة (يمنحها الملك)
        if (custom && custom[permissionKey] === true) return true;

        return false;
    }

    // فحوصات جاهزة
    function canModerate() { return _currentRankLevel() >= 65; }
    function canBan() {
        if (_currentIsKing()) return true;
        if (_currentRankLevel() >= 90 && hasPermission('can_ban_temp')) return true;
        return hasPermission('can_ban_temp');
    }
    function canBanPermanent() {
        if (_currentIsKing()) return true;
        return hasPermission('can_ban_perm');
    }
    function canPromote() {
        if (_currentIsKing()) return true;
        return _currentRankLevel() >= 75 && hasPermission('can_promote');
    }
    function canDemote() {
        if (_currentIsKing()) return true;
        return hasPermission('can_demote');
    }
    function canAccessKingRoom() {
        // الملك الحقيقي فقط (حسب الاتفاق)
        return _currentIsKing();
    }
    function canInvisible() {
        // الملك الحقيقي فقط
        return _currentIsKing();
    }
    function canUseStudio() {
        if (_currentIsKing()) return true;
        if (_currentRankLevel() >= 80) return true;
        return hasPermission('can_use_studio');
    }
    function canViewInvisible() {
        if (_currentIsKing()) return true;
        return hasPermission('can_view_invisible');
    }
    function canViewPM() {
        if (_currentIsKing()) return true;
        return hasPermission('can_view_pm');
    }
    function canViewSuspects() {
        if (_currentIsKing()) return true;
        return hasPermission('can_see_suspects');
    }
    function canViewReports() {
        if (_currentIsKing()) return true;
        if (_currentRankLevel() >= 90) return true;
        return hasPermission('can_view_reports');
    }

    /* ══════════════════════════════════════════════ */
    /* Custom permissions — read                       */
    /* ══════════════════════════════════════════════ */
    function getCustomPermissions(uid) {
        if (!uid) return Promise.resolve({});
        return window.QamarFB.get('users/' + uid + '/customPermissions')
            .then(function (v) { return v || {}; })
            .catch(function () { return {}; });
    }

    /* ══════════════════════════════════════════════ */
    /* Custom permissions — write (King only)          */
    /* ══════════════════════════════════════════════ */
    function grantPermission(uid, permissionKey) {
        if (!_currentIsKing()) {
            return Promise.reject(new Error('فقط الملك يمكنه منح الصلاحيات'));
        }
        if (PERMISSION_KEYS.indexOf(permissionKey) === -1) {
            return Promise.reject(new Error('صلاحية غير معروفة: ' + permissionKey));
        }
        if (!uid) return Promise.reject(new Error('uid مطلوب'));

        const path = 'users/' + uid + '/customPermissions/' + permissionKey;
        return window.QamarFB.set(path, true).then(function () {
            clearCache(uid);
            Logger.info('✅ Permission granted:', permissionKey, '→', uid.substring(0, 8));
            _emit('rank:permissions', { uid: uid, action: 'grant', key: permissionKey });
            return { ok: true, uid: uid, permission: permissionKey };
        });
    }

    function revokePermission(uid, permissionKey) {
        if (!_currentIsKing()) {
            return Promise.reject(new Error('فقط الملك يمكنه سحب الصلاحيات'));
        }
        if (!uid || !permissionKey) return Promise.reject(new Error('بيانات ناقصة'));

        const path = 'users/' + uid + '/customPermissions/' + permissionKey;
        return window.QamarFB.remove(path).then(function () {
            clearCache(uid);
            Logger.info('✅ Permission revoked:', permissionKey, '←', uid.substring(0, 8));
            _emit('rank:permissions', { uid: uid, action: 'revoke', key: permissionKey });
            return { ok: true, uid: uid, permission: permissionKey };
        });
    }

    function grantPermissions(uid, keysArray) {
        if (!_currentIsKing()) {
            return Promise.reject(new Error('فقط الملك يمكنه منح الصلاحيات'));
        }
        if (!Array.isArray(keysArray) || keysArray.length === 0) {
            return Promise.reject(new Error('قائمة فارغة'));
        }
        const updates = {};
        keysArray.forEach(function (k) {
            if (PERMISSION_KEYS.indexOf(k) !== -1) {
                updates['users/' + uid + '/customPermissions/' + k] = true;
            }
        });
        if (Object.keys(updates).length === 0) {
            return Promise.reject(new Error('لا صلاحيات صالحة'));
        }
        return window.QamarFB.multiUpdate(updates).then(function () {
            clearCache(uid);
            _emit('rank:permissions', { uid: uid, action: 'grant-many', keys: keysArray });
            return { ok: true, granted: Object.keys(updates).length };
        });
    }

    function revokeAllPermissions(uid) {
        if (!_currentIsKing()) {
            return Promise.reject(new Error('فقط الملك يمكنه سحب الصلاحيات'));
        }
        return window.QamarFB.remove('users/' + uid + '/customPermissions').then(function () {
            clearCache(uid);
            _emit('rank:permissions', { uid: uid, action: 'revoke-all' });
            return { ok: true };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Promotions (King only)                          */
    /* ══════════════════════════════════════════════ */
    function _writeAudit(type, payload) {
        if (!window.QamarFB) return Promise.resolve();
        const entry = Object.assign({
            type: type,
            byUid: _getCurrentUid(),
            byName: _getCurrent() ? _getCurrent().name : null,
            at: window.QamarFB.serverTime()
        }, payload || {});
        return window.QamarFB.push('audit_log/general', entry).catch(function () {
            return null;
        });
    }

    function promote(uid, newRank) {
        if (!_currentIsKing()) {
            return Promise.reject(new Error('فقط الملك يمكنه الترقية'));
        }
        if (!uid || !newRank) return Promise.reject(new Error('بيانات ناقصة'));

        const newLevel = getRankLevel(newRank);
        if (newLevel === 0) return Promise.reject(new Error('رتبة غير معروفة: ' + newRank));
        if (newLevel >= CONFIG.KING_LEVEL) {
            return Promise.reject(new Error('لا يمكن ترقية لرتبة الملك'));
        }
        if (uid === _getCurrentUid()) {
            return Promise.reject(new Error('لا يمكنك ترقية نفسك'));
        }

        const updates = {};
        updates['users/' + uid + '/rank'] = newRank;
        updates['users/' + uid + '/rankLevel'] = newLevel;
        updates['users/' + uid + '/identityUpdatedAt'] = window.QamarFB.serverTime();

        return window.QamarFB.multiUpdate(updates).then(function () {
            clearCache(uid);
            Logger.info('✅ Promoted:', uid.substring(0, 8), '→', newRank);
            _emit('rank:changed', { uid: uid, action: 'promote', rank: newRank, level: newLevel });
            return _writeAudit('promote', {
                targetUid: uid, newRank: newRank, newLevel: newLevel
            });
        }).then(function () {
            return { ok: true, uid: uid, rank: newRank, level: newLevel };
        });
    }

    function demote(uid, newRank) {
        if (!_currentIsKing()) {
            return Promise.reject(new Error('فقط الملك يمكنه التخفيض'));
        }
        if (!uid || !newRank) return Promise.reject(new Error('بيانات ناقصة'));

        const newLevel = getRankLevel(newRank);
        if (newLevel === 0) return Promise.reject(new Error('رتبة غير معروفة'));
        if (uid === _getCurrentUid()) {
            return Promise.reject(new Error('لا يمكنك تخفيض نفسك'));
        }

        const updates = {};
        updates['users/' + uid + '/rank'] = newRank;
        updates['users/' + uid + '/rankLevel'] = newLevel;
        updates['users/' + uid + '/identityUpdatedAt'] = window.QamarFB.serverTime();
        // إذا لم يعد رتبة 95 → احذف queenOrder والصلاحيات المخصصة
        if (newLevel < CONFIG.HIGH_ROYAL_LEVEL) {
            updates['users/' + uid + '/queenOrder'] = null;
            updates['users/' + uid + '/customPermissions'] = null;
        }

        return window.QamarFB.multiUpdate(updates).then(function () {
            clearCache(uid);
            Logger.info('✅ Demoted:', uid.substring(0, 8), '→', newRank);
            _emit('rank:changed', { uid: uid, action: 'demote', rank: newRank, level: newLevel });
            return _writeAudit('demote', {
                targetUid: uid, newRank: newRank, newLevel: newLevel
            });
        }).then(function () {
            return { ok: true, uid: uid, rank: newRank, level: newLevel };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Queen slot assignment (King only)               */
    /* ══════════════════════════════════════════════ */
    function _usedQueenOrders() {
        // يجلب الرتب 95 الذين يشغلون queenOrder 1-4
        return window.QamarFB.query('users', {
            orderByChild: 'rankLevel',
            equalTo: CONFIG.HIGH_ROYAL_LEVEL,
            returnArray: true
        }).then(function (arr) {
            const used = {};
            (arr || []).forEach(function (r) {
                const d = r.data || {};
                if (d.queenOrder && !d.permanentBan && !d.isBanned) {
                    used[d.queenOrder] = r.id;
                }
            });
            return used;
        }).catch(function () { return {}; });
    }

    function assignQueen(uid, order, options) {
        options = options || {};
        if (!_currentIsKing()) {
            return Promise.reject(new Error('فقط الملك يمكنه التعيين'));
        }
        if (!uid) return Promise.reject(new Error('uid مطلوب'));
        if (CONFIG.HIGH_ROYAL_ORDERS.indexOf(Number(order)) === -1) {
            return Promise.reject(new Error('رقم الرتبة يجب أن يكون 1-4'));
        }
        if (uid === _getCurrentUid()) {
            return Promise.reject(new Error('لا يمكنك تعيين نفسك'));
        }

        return _usedQueenOrders().then(function (used) {
            if (used[order] && used[order] !== uid) {
                if (!options.replace) {
                    throw new Error('الرتبة رقم ' + order + ' مشغولة');
                }
            }

            const updates = {};
            updates['users/' + uid + '/rank'] = 'Queen';
            updates['users/' + uid + '/rankLevel'] = CONFIG.HIGH_ROYAL_LEVEL;
            updates['users/' + uid + '/queenOrder'] = Number(order);
            updates['users/' + uid + '/identityUpdatedAt'] = window.QamarFB.serverTime();

            return window.QamarFB.multiUpdate(updates).then(function () {
                clearCache(uid);
                Logger.info('✅ Assigned rank-95 slot', order, 'to', uid.substring(0, 8));
                _emit('rank:changed', {
                    uid: uid, action: 'assignQueen', order: Number(order)
                });
                return _writeAudit('assignQueen', {
                    targetUid: uid, order: Number(order)
                });
            }).then(function () {
                return { ok: true, uid: uid, order: Number(order) };
            });
        });
    }

    function removeQueen(uid) {
        if (!_currentIsKing()) {
            return Promise.reject(new Error('فقط الملك يمكنه الإزالة'));
        }
        if (!uid) return Promise.reject(new Error('uid مطلوب'));

        const updates = {};
        updates['users/' + uid + '/rank'] = 'User';
        updates['users/' + uid + '/rankLevel'] = 50;
        updates['users/' + uid + '/queenOrder'] = null;
        updates['users/' + uid + '/customPermissions'] = null;
        updates['users/' + uid + '/identityUpdatedAt'] = window.QamarFB.serverTime();

        return window.QamarFB.multiUpdate(updates).then(function () {
            clearCache(uid);
            Logger.info('✅ Removed rank-95:', uid.substring(0, 8));
            _emit('rank:changed', { uid: uid, action: 'removeQueen' });
            return _writeAudit('removeQueen', { targetUid: uid });
        }).then(function () {
            return { ok: true, uid: uid };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* List high royals                                */
    /* ══════════════════════════════════════════════ */
    function listHighRoyals() {
        return window.QamarFB.query('users', {
            orderByChild: 'rankLevel',
            equalTo: CONFIG.HIGH_ROYAL_LEVEL,
            returnArray: true
        }).then(function (arr) {
            return (arr || []).map(function (r) {
                const d = r.data || {};
                return {
                    uid: r.id,
                    name: d.name || '—',
                    avatar: d.avatar || null,
                    queenOrder: d.queenOrder || null,
                    customPermissions: d.customPermissions || {}
                };
            }).sort(function (a, b) {
                return (a.queenOrder || 99) - (b.queenOrder || 99);
            });
        }).catch(function () { return []; });
    }

    function listAvailableSlots() {
        return _usedQueenOrders().then(function (used) {
            const out = [];
            CONFIG.HIGH_ROYAL_ORDERS.forEach(function (o) {
                out.push({
                    order: o,
                    taken: !!used[o],
                    takenBy: used[o] || null
                });
            });
            return out;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Debug                                           */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        const u = _getCurrent();
        return {
            uid: u ? u.uid : null,
            rank: u ? u.rank : null,
            rankLevel: _currentRankLevel(),
            isKing: _currentIsKing(),
            isHighRoyal: isHighRoyal(),
            customPermissions: u ? (u.customPermissions || {}) : {},
            permissionKeysCount: PERMISSION_KEYS.length,
            autoPermissionsCount: AUTO_PERMISSIONS_90.length,
            cacheSize: Object.keys(State.cache).length
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarRanks = {
        // Config
        CONFIG: CONFIG,
        PERMISSION_KEYS: PERMISSION_KEYS,
        AUTO_PERMISSIONS_90: AUTO_PERMISSIONS_90,

        // Read
        getUserRank: getUserRank,
        getRankInfo: getRankInfo,
        getRankLevel: getRankLevel,

        // Current user
        isKing: isKing,
        isQueen: isQueen,
        isHighRoyal: isHighRoyal,
        isRoyal: isRoyal,
        myLevel: myLevel,

        // Comparisons
        isHigher: isHigher,
        isHigherOrEqual: isHigherOrEqual,
        canActOn: canActOn,

        // Permissions
        hasPermission: hasPermission,
        canModerate: canModerate,
        canBan: canBan,
        canBanPermanent: canBanPermanent,
        canPromote: canPromote,
        canDemote: canDemote,
        canAccessKingRoom: canAccessKingRoom,
        canInvisible: canInvisible,
        canUseStudio: canUseStudio,
        canViewInvisible: canViewInvisible,
        canViewPM: canViewPM,
        canViewSuspects: canViewSuspects,
        canViewReports: canViewReports,

        // Custom permissions
        getCustomPermissions: getCustomPermissions,
        grantPermission: grantPermission,
        revokePermission: revokePermission,
        grantPermissions: grantPermissions,
        revokeAllPermissions: revokeAllPermissions,

        // Promotion
        promote: promote,
        demote: demote,
        assignQueen: assignQueen,
        removeQueen: removeQueen,

        // Lists
        listHighRoyals: listHighRoyals,
        listAvailableSlots: listAvailableSlots,

        // Cache
        clearCache: clearCache,

        // Events
        onRankChange: onRankChange,

        // Debug
        getStatus: getStatus
    };

    window.QamarRanks = QamarRanks;

    Logger.info('📦 [ranks.js] loaded | permissions:', PERMISSION_KEYS.length, '| auto-90:', AUTO_PERMISSIONS_90.length);
})();
