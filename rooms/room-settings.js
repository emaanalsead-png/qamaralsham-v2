// ==============================================
// rooms/room-settings.js
// Room settings (name, icon, bg, colors, welcome)
// ==============================================
// يعتمد على: firebase.js + constants.js + rooms.js + auth.js + ranks.js + audit.js
// يعطي: window.QamarRoomSettings
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [room-settings] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[RS]';
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
        ROOT: 'room_settings',
        SAVE_DEBOUNCE_MS: 800,
        CACHE_TTL_MS: 5 * 60 * 1000,
        MIN_ROOM_LEVEL: 90,
        LIMITS: {
            name: { min: 2, max: 30 },
            icon: { max: 4 },
            fontSize: { min: 10, max: 30 },
            welcomeText: { min: 0, max: 200 },
            maxUsers: { min: 1, max: 50 },
            micCount: { min: 0, max: 8 },
            urlMax: 500
        },
        BG_TYPES: ['color', 'gradient', 'image', 'none'],
        ROOM_TYPES: ['public', 'private'],
        VISIBLE_TO: ['all', 'royal', 'owner+', 'grandowner+', 'jailed', 'king']
    };

    // حقول الملك فقط
    const KING_ONLY_FIELDS = ['maxUsers', 'micCount', 'type', 'visibleTo'];

    // كل الحقول القابلة للتعديل
    const EDITABLE_FIELDS = [
        'name', 'icon', 'iconImage',
        'bgType', 'bgValue', 'bgImage',
        'nameColor', 'fontColor', 'fontSize',
        'welcome', // {text, enabled}
        'maxUsers', 'micCount', 'type', 'visibleTo'
    ];

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        cache: {},              // { roomId: { data, at } }
        listeners: [],
        saveQueue: {},          // { roomId: { updates, timer, resolvers } }
        watchers: {},           // { roomId: { handle } }
        _initialized: false
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onSettingsChange(cb) {
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

    function _getCurrentName() {
        try {
            if (window.AppState && window.AppState.user && window.AppState.user.name) {
                return window.AppState.user.name;
            }
            if (window.QamarSession && window.QamarSession.getData) {
                const s = window.QamarSession.getData();
                if (s && s.name) return s.name;
            }
        } catch (e) {}
        return '—';
    }

    function _isKing() {
        if (window.QamarRanks && window.QamarRanks.isKing) return window.QamarRanks.isKing();
        return false;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    function _canEdit() {
        if (_isKing()) return true;
        return _myLevel() >= CONFIG.MIN_ROOM_LEVEL;
    }

    function _isValidHex(v) {
        return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
    }

    function _isValidUrl(v) {
        if (!v) return true;
        if (typeof v !== 'string') return false;
        if (v.length > CONFIG.LIMITS.urlMax) return false;
        return /^(https?:\/\/|data:image\/)/i.test(v);
    }

    function _sanitizeStr(v, max) {
        if (v === null || v === undefined) return null;
        const s = String(v);
        if (s.length <= max) return s;
        return s.substring(0, max);
    }

    /* ══════════════════════════════════════════════ */
    /* Defaults — من constants.ROOMS                   */
    /* ══════════════════════════════════════════════ */
    function getDefaults(roomId) {
        const base = (window.QAMAR && window.QAMAR.ROOMS) ? window.QAMAR.ROOMS[roomId] : null;
        if (!base) {
            // غرفة مخصصة بلا defaults
            return {
                name: '',
                icon: '🌙',
                iconImage: null,
                bgType: 'none',
                bgValue: null,
                bgImage: null,
                nameColor: null,
                fontColor: null,
                fontSize: null,
                welcome: { text: '', enabled: false },
                maxUsers: null,
                micCount: 4,
                type: 'public',
                visibleTo: 'all'
            };
        }
        return {
            name: base.name || '',
            icon: base.icon || '🌙',
            iconImage: null,
            bgType: 'none',
            bgValue: null,
            bgImage: null,
            nameColor: null,
            fontColor: null,
            fontSize: null,
            welcome: { text: '', enabled: false },
            maxUsers: base.maxUsers !== undefined ? base.maxUsers : null,
            micCount: base.micCount || 4,
            type: base.type || 'public',
            visibleTo: base.visibleTo || 'all'
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Cache                                           */
    /* ══════════════════════════════════════════════ */
    function _cacheGet(roomId) {
        const c = State.cache[roomId];
        if (!c) return null;
        if (Date.now() - c.at > CONFIG.CACHE_TTL_MS) {
            delete State.cache[roomId];
            return null;
        }
        return c.data;
    }

    function _cacheSet(roomId, data) {
        State.cache[roomId] = { data: data, at: Date.now() };
    }

    function clearCache(roomId) {
        if (roomId) delete State.cache[roomId];
        else State.cache = {};
    }

    /* ══════════════════════════════════════════════ */
    /* Validation                                      */
    /* ══════════════════════════════════════════════ */
    function _validateField(field, value, isKing) {
        const L = CONFIG.LIMITS;

        // الملكية فقط؟
        if (KING_ONLY_FIELDS.indexOf(field) !== -1 && !isKing) {
            return { ok: false, error: 'فقط الملك يمكنه تعديل ' + field };
        }

        switch (field) {
            case 'name': {
                if (value === null || value === '') return { ok: true, value: null };
                const s = String(value).trim();
                if (s.length < L.name.min) return { ok: false, error: 'الاسم قصير جداً' };
                if (s.length > L.name.max) return { ok: false, error: 'الاسم طويل جداً' };
                return { ok: true, value: s };
            }
            case 'icon': {
                if (value === null || value === '') return { ok: true, value: '🌙' };
                const s = String(value).trim();
                if (s.length > L.icon.max) return { ok: false, error: 'الأيقونة طويلة جداً' };
                return { ok: true, value: s };
            }
            case 'iconImage': {
                if (!value) return { ok: true, value: null };
                if (!_isValidUrl(value)) return { ok: false, error: 'رابط الصورة غير صحيح' };
                return { ok: true, value: String(value) };
            }
            case 'bgType': {
                if (!value) return { ok: true, value: 'none' };
                if (CONFIG.BG_TYPES.indexOf(value) === -1) {
                    return { ok: false, error: 'نوع الخلفية غير صحيح' };
                }
                return { ok: true, value: value };
            }
            case 'bgValue': {
                if (!value) return { ok: true, value: null };
                if (typeof value !== 'string') return { ok: false, error: 'قيمة غير صحيحة' };
                if (value.length > 300) return { ok: false, error: 'القيمة طويلة جداً' };
                return { ok: true, value: value };
            }
            case 'bgImage': {
                if (!value) return { ok: true, value: null };
                if (!_isValidUrl(value)) return { ok: false, error: 'رابط الخلفية غير صحيح' };
                return { ok: true, value: String(value) };
            }
            case 'nameColor':
            case 'fontColor': {
                if (!value) return { ok: true, value: null };
                if (!_isValidHex(value)) return { ok: false, error: 'صيغة اللون غير صحيحة' };
                return { ok: true, value: value };
            }
            case 'fontSize': {
                if (value === null || value === undefined || value === '') return { ok: true, value: null };
                const n = Number(value);
                if (isNaN(n)) return { ok: false, error: 'حجم الخط غير صحيح' };
                if (n < L.fontSize.min || n > L.fontSize.max) {
                    return { ok: false, error: 'حجم الخط بين ' + L.fontSize.min + ' و ' + L.fontSize.max };
                }
                return { ok: true, value: Math.floor(n) };
            }
            case 'welcome': {
                if (!value || typeof value !== 'object') {
                    return { ok: true, value: { text: '', enabled: false } };
                }
                const text = _sanitizeStr(value.text, L.welcomeText.max) || '';
                const enabled = !!value.enabled;
                return { ok: true, value: { text: text, enabled: enabled } };
            }
            case 'maxUsers': {
                if (value === null || value === undefined || value === '') return { ok: true, value: null };
                const n = Number(value);
                if (isNaN(n)) return { ok: false, error: 'الحد الأقصى غير صحيح' };
                if (n < L.maxUsers.min || n > L.maxUsers.max) {
                    return { ok: false, error: 'الحد الأقصى بين ' + L.maxUsers.min + ' و ' + L.maxUsers.max };
                }
                return { ok: true, value: Math.floor(n) };
            }
            case 'micCount': {
                const n = Number(value);
                if (isNaN(n)) return { ok: false, error: 'عدد المايكات غير صحيح' };
                if (n < L.micCount.min || n > L.micCount.max) {
                    return { ok: false, error: 'عدد المايكات بين ' + L.micCount.min + ' و ' + L.micCount.max };
                }
                return { ok: true, value: Math.floor(n) };
            }
            case 'type': {
                if (CONFIG.ROOM_TYPES.indexOf(value) === -1) {
                    return { ok: false, error: 'نوع الغرفة غير صحيح' };
                }
                return { ok: true, value: value };
            }
            case 'visibleTo': {
                if (CONFIG.VISIBLE_TO.indexOf(value) === -1) {
                    return { ok: false, error: 'نطاق الرؤية غير صحيح' };
                }
                return { ok: true, value: value };
            }
            default:
                return { ok: false, error: 'حقل غير معروف: ' + field };
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Load                                            */
    /* ══════════════════════════════════════════════ */
    function _loadFromFB(roomId) {
        return window.QamarFB.get(CONFIG.ROOT + '/' + roomId)
            .then(function (data) {
                return data || {};
            })
            .catch(function (e) {
                Logger.warn('load failed:', roomId, e.message);
                return {};
            });
    }

    // دمج إعدادات Firebase مع الافتراضية
    function _mergeWithDefaults(roomId, fbData) {
        const defaults = getDefaults(roomId);
        const merged = Object.assign({}, defaults);
        if (fbData && typeof fbData === 'object') {
            Object.keys(fbData).forEach(function (k) {
                if (fbData[k] !== undefined && fbData[k] !== null) {
                    merged[k] = fbData[k];
                }
            });
        }
        return merged;
    }

    function get(roomId, forceRefresh) {
        if (!roomId) return Promise.resolve(null);

        if (!forceRefresh) {
            const cached = _cacheGet(roomId);
            if (cached) return Promise.resolve(cached);
        }

        return _loadFromFB(roomId).then(function (fbData) {
            const merged = _mergeWithDefaults(roomId, fbData);
            _cacheSet(roomId, merged);
            return merged;
        });
    }

    // getters سريعة
    function getName(roomId) {
        const c = _cacheGet(roomId);
        if (c && c.name) return c.name;
        const def = getDefaults(roomId);
        return def.name;
    }

    function getIcon(roomId) {
        const c = _cacheGet(roomId);
        if (c && c.icon) return c.icon;
        const def = getDefaults(roomId);
        return def.icon;
    }

    function getWelcome(roomId) {
        const c = _cacheGet(roomId);
        if (c && c.welcome) return c.welcome;
        return { text: '', enabled: false };
    }

    function getLimits(roomId) {
        const c = _cacheGet(roomId);
        const def = getDefaults(roomId);
        return {
            maxUsers: c ? c.maxUsers : def.maxUsers,
            micCount: c ? c.micCount : def.micCount
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Update — debounced save                         */
    /* ══════════════════════════════════════════════ */
    function update(roomId, updates) {
        return Promise.resolve().then(function () {
            if (!_canEdit()) {
                throw new Error('غير مصرّح — تحتاج مستوى 90 أو الملك');
            }
            if (!roomId) throw new Error('roomId مطلوب');
            if (!updates || typeof updates !== 'object') {
                throw new Error('لا توجد تحديثات');
            }

            const isKing = _isKing();
            const validated = {};
            const errors = [];

            Object.keys(updates).forEach(function (field) {
                if (EDITABLE_FIELDS.indexOf(field) === -1) {
                    errors.push('حقل غير معروف: ' + field);
                    return;
                }
                const r = _validateField(field, updates[field], isKing);
                if (r.ok) {
                    validated[field] = r.value;
                } else {
                    errors.push(field + ': ' + r.error);
                }
            });

            if (Object.keys(validated).length === 0) {
                return Promise.reject(new Error(errors.join('، ') || 'لا حقول صالحة'));
            }

            // ═══ تطبيق فوري في الكاش ═══
            const cached = _cacheGet(roomId) || getDefaults(roomId);
            const newData = Object.assign({}, cached, validated);
            _cacheSet(roomId, newData);

            // ═══ أطلق حدث فوري للواجهة ═══
            _emit('room:settingsUpdated', {
                roomId: roomId,
                updates: validated,
                settings: newData,
                pending: true
            });

            // ═══ ضع في debounced queue ═══
            return _enqueueSave(roomId, validated, errors);
        });
    }

    function _enqueueSave(roomId, updates, errors) {
        return new Promise(function (resolve, reject) {
            if (!State.saveQueue[roomId]) {
                State.saveQueue[roomId] = { updates: {}, timer: null, resolvers: [] };
            }
            const q = State.saveQueue[roomId];
            Object.assign(q.updates, updates);
            q.resolvers.push({ resolve: resolve, reject: reject, errors: errors });

            if (q.timer) clearTimeout(q.timer);
            q.timer = setTimeout(function () { _flushSave(roomId); }, CONFIG.SAVE_DEBOUNCE_MS);
        });
    }

    function _flushSave(roomId) {
        const q = State.saveQueue[roomId];
        if (!q) return;
        delete State.saveQueue[roomId];

        const updates = q.updates;
        const resolvers = q.resolvers;

        if (Object.keys(updates).length === 0) {
            resolvers.forEach(function (r) { r.resolve({ ok: true, empty: true }); });
            return;
        }

        const path = CONFIG.ROOT + '/' + roomId;
        // استخدم update (لا set) لتفادي فقدان الحقول الأخرى
        window.QamarFB.update(path, updates)
            .then(function () {
                // audit log — اجمع الحقول المُعدّلة
                if (window.QamarAudit) {
                    const fields = Object.keys(updates);
                    window.QamarAudit.log('editRoom', {
                        roomId: roomId,
                        details: { fields: fields, values: updates }
                    });
                }

                // أطلق حدث "تم الحفظ"
                _emit('room:settingsSaved', {
                    roomId: roomId,
                    updates: updates,
                    pending: false
                });

                Logger.info('💾 Room settings saved:', roomId, Object.keys(updates).join(', '));

                resolvers.forEach(function (r) {
                    r.resolve({ ok: true, saved: updates, warnings: r.errors });
                });
            })
            .catch(function (e) {
                Logger.error('save failed:', roomId, e.message);
                // أعد الكاش للحالة السابقة
                _loadFromFB(roomId).then(function (fbData) {
                    const merged = _mergeWithDefaults(roomId, fbData);
                    _cacheSet(roomId, merged);
                    _emit('room:settingsRollback', { roomId: roomId });
                });
                resolvers.forEach(function (r) { r.reject(e); });
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Setters مختصرة                                  */
    /* ══════════════════════════════════════════════ */
    function setName(roomId, name)        { return update(roomId, { name: name }); }
    function setIcon(roomId, icon)        { return update(roomId, { icon: icon }); }
    function setIconImage(roomId, url)    { return update(roomId, { iconImage: url }); }
    function setBackground(roomId, type, value) {
        return update(roomId, { bgType: type, bgValue: value });
    }
    function setBgImage(roomId, url)      { return update(roomId, { bgImage: url }); }
    function setColors(roomId, colors)    { return update(roomId, colors || {}); }
    function setWelcome(roomId, welcome)  { return update(roomId, { welcome: welcome }); }
    function setLimits(roomId, limits)    { return update(roomId, limits || {}); }

    /* ══════════════════════════════════════════════ */
    /* Auto-fill defaults after custom room creation   */
    /* ══════════════════════════════════════════════ */
    function initFromRoomPayload(roomId, payload) {
        if (!roomId || !payload) return Promise.resolve(false);
        // إذا الإعدادات موجودة → لا تفعل شيئاً
        return window.QamarFB.exists(CONFIG.ROOT + '/' + roomId)
            .then(function (exists) {
                if (exists) return false;
                const initial = {
                    name: payload.name || '',
                    icon: payload.icon || '🌙',
                    iconImage: payload.iconImage || null,
                    bgType: 'none',
                    bgValue: null,
                    bgImage: null,
                    nameColor: null,
                    fontColor: null,
                    fontSize: null,
                    welcome: { text: '', enabled: false },
                    maxUsers: payload.maxUsers !== undefined ? payload.maxUsers : null,
                    micCount: payload.micCount || 4,
                    type: payload.type || 'public',
                    visibleTo: payload.visibleTo || 'all'
                };
                return window.QamarFB.set(CONFIG.ROOT + '/' + roomId, initial)
                    .then(function () {
                        _cacheSet(roomId, initial);
                        return true;
                    });
            })
            .catch(function () { return false; });
    }

    /* ══════════════════════════════════════════════ */
    /* Reset — إعادة للافتراضي                         */
    /* ══════════════════════════════════════════════ */
    function reset(roomId) {
        return Promise.resolve().then(function () {
            if (!_isKing() && _myLevel() < CONFIG.MIN_ROOM_LEVEL) {
                throw new Error('غير مصرّح');
            }
            if (!roomId) throw new Error('roomId مطلوب');

            return window.QamarFB.remove(CONFIG.ROOT + '/' + roomId)
                .then(function () {
                    clearCache(roomId);

                    if (window.QamarAudit) {
                        window.QamarAudit.log('editRoom', {
                            roomId: roomId,
                            reason: 'reset to defaults'
                        });
                    }

                    _emit('room:settingsReset', { roomId: roomId });
                    Logger.info('↩️ Room settings reset:', roomId);
                    return { ok: true };
                });
        });
    }

    function resetField(roomId, field) {
        if (EDITABLE_FIELDS.indexOf(field) === -1) {
            return Promise.reject(new Error('حقل غير معروف'));
        }
        const def = getDefaults(roomId);
        const v = {};
        v[field] = def[field];
        return update(roomId, v);
    }

    /* ══════════════════════════════════════════════ */
    /* Apply to DOM — للاستخدام في UI لاحقاً            */
    /* ══════════════════════════════════════════════ */
    function applyToDOM(roomId, rootEl) {
        const settings = _cacheGet(roomId) || getDefaults(roomId);
        if (!settings) return;

        const root = rootEl || document.documentElement;

        // CSS variables
        if (settings.nameColor) {
            root.style.setProperty('--room-name-color', settings.nameColor);
        } else {
            root.style.removeProperty('--room-name-color');
        }
        if (settings.fontColor) {
            root.style.setProperty('--room-font-color', settings.fontColor);
        } else {
            root.style.removeProperty('--room-font-color');
        }
        if (settings.fontSize) {
            root.style.setProperty('--room-font-size', settings.fontSize + 'px');
        } else {
            root.style.removeProperty('--room-font-size');
        }

        // خلفية الغرفة
        const chat = document.getElementById('chat-area') ||
                     document.querySelector('.chat-area') ||
                     document.querySelector('.chat-container') ||
                     root;
        if (chat && chat.style) {
            if (settings.bgType === 'image' && settings.bgImage) {
                chat.style.backgroundImage = 'url(' + settings.bgImage + ')';
                chat.style.backgroundSize = 'cover';
                chat.style.backgroundPosition = 'center';
            } else if (settings.bgType === 'color' && settings.bgValue) {
                chat.style.backgroundImage = 'none';
                chat.style.background = settings.bgValue;
            } else if (settings.bgType === 'gradient' && settings.bgValue) {
                chat.style.backgroundImage = 'none';
                chat.style.background = settings.bgValue;
            } else {
                chat.style.backgroundImage = 'none';
                chat.style.background = '';
            }
        }

        // اسم الغرفة في الهيدر
        const titleEl = document.getElementById('room-title') ||
                        document.querySelector('.room-title');
        if (titleEl) {
            const nm = settings.name || getDefaults(roomId).name;
            const ic = settings.icon || getDefaults(roomId).icon;
            titleEl.textContent = ic + ' ' + nm;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Watch live changes                              */
    /* ══════════════════════════════════════════════ */
    function watch(roomId) {
        if (!roomId || State.watchers[roomId]) return null;
        try {
            const handle = window.QamarFB.onValue(CONFIG.ROOT + '/' + roomId, function (data) {
                const merged = _mergeWithDefaults(roomId, data || {});
                _cacheSet(roomId, merged);
                _emit('room:settingsChanged', { roomId: roomId, settings: merged });
            }, function () {});
            State.watchers[roomId] = handle;
            return handle;
        } catch (e) {
            return null;
        }
    }

    function unwatch(roomId) {
        const h = State.watchers[roomId];
        if (h && h.off) {
            try { h.off(); } catch (e) {}
        }
        delete State.watchers[roomId];
    }

    /* ══════════════════════════════════════════════ */
    /* Init                                            */
    /* ══════════════════════════════════════════════ */
    function _init() {
        if (State._initialized) return;
        State._initialized = true;

        // عند تغيير الغرفة → watch الجديد + apply
        if (window.EventBus) {
            window.EventBus.on('room:changed', function (payload) {
                const roomId = (payload && payload.roomId) || payload;
                if (!roomId) return;
                get(roomId).then(function () {
                    applyToDOM(roomId);
                    watch(roomId);
                });
            });

            // عند إنشاء غرفة مخصصة → املأ الإعدادات
            window.EventBus.on('room:created', function (payload) {
                if (payload && payload.roomId) {
                    initFromRoomPayload(payload.roomId, payload.room || {});
                }
            });
        }

        // راقب تسجيل الدخول
        if (window.QamarAuth && window.QamarAuth.onAuthChange) {
            window.QamarAuth.onAuthChange(function (p) {
                if (!p.isLoggedIn) {
                    clearCache();
                    Object.keys(State.watchers).forEach(unwatch);
                }
            });
        }

        Logger.info('📦 [room-settings.js] initialized');
    }

    if (window.EventBus) {
        window.EventBus.once('boot:ready', function () {
            setTimeout(_init, 1500);
        });
    } else {
        setTimeout(_init, 5500);
    }

    /* ══════════════════════════════════════════════ */
    /* Status / Debug                                  */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            initialized: State._initialized,
            canEdit: _canEdit(),
            isKing: _isKing(),
            myLevel: _myLevel(),
            cachedRooms: Object.keys(State.cache),
            pendingSaves: Object.keys(State.saveQueue),
            watchedRooms: Object.keys(State.watchers),
            editableFields: EDITABLE_FIELDS.length,
            kingOnlyFields: KING_ONLY_FIELDS.slice()
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarRoomSettings = {
        CONFIG: CONFIG,
        EDITABLE_FIELDS: EDITABLE_FIELDS,
        KING_ONLY_FIELDS: KING_ONLY_FIELDS,

        // Read
        get: get,
        getName: getName,
        getIcon: getIcon,
        getWelcome: getWelcome,
        getLimits: getLimits,
        getDefaults: getDefaults,

        // Write
        update: update,
        setName: setName,
        setIcon: setIcon,
        setIconImage: setIconImage,
        setBackground: setBackground,
        setBgImage: setBgImage,
        setColors: setColors,
        setWelcome: setWelcome,
        setLimits: setLimits,

        // Reset
        reset: reset,
        resetField: resetField,

        // Auto-fill
        initFromRoomPayload: initFromRoomPayload,

        // UI
        applyToDOM: applyToDOM,

        // Live
        watch: watch,
        unwatch: unwatch,

        // Cache
        clearCache: clearCache,

        // Validation
        validateField: _validateField,

        // Events
        onSettingsChange: onSettingsChange,

        // Debug
        getStatus: getStatus
    };

    window.QamarRoomSettings = QamarRoomSettings;

    Logger.info('📦 [room-settings.js] loaded | editable:', EDITABLE_FIELDS.length, '| king-only:', KING_ONLY_FIELDS.length);
})();
