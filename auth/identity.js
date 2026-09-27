// ==============================================
// auth/identity.js
// Profile fields management (22 fields)
// ==============================================
// يعتمد على: firebase.js + session.js + utils.js + constants.js
// يعطي: window.QamarIdentity
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [identity] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[ID]';
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
        NAME_MIN: 2,
        NAME_MAX: 40,
        BIO_MAX: 50,
        AGE_MIN: 13,
        AGE_MAX: 100,
        COUNTRY_MIN: 2,
        COUNTRY_MAX: 20,
        FAMILY_MIN: 2,
        FAMILY_MAX: 30,
        URL_MAX: 500,
        RATE_WINDOW_MS: 60 * 1000,
        RATE_MAX_UPDATES: 10,
        CACHE_TTL_MS: 5 * 60 * 1000,
        UPDATE_DEBOUNCE_MS: 400,
        GENDERS: ['male', 'female', 'other'],
        COVER_TYPES: ['image', 'video', 'color', 'gradient', 'none'],
        PROFILE_BG_TYPES: ['color', 'gradient', 'image', 'none']
    };

    // حقول الهوية (22 حقل) — من الوثيقة
    const FIELDS = [
        'avatar', 'cover', 'coverType', 'name', 'bio',
        'nameColor', 'nameGradient', 'nameBgColor', 'nameBgGradient',
        'cinemaTextStyle', 'cinemaBgStyle',
        'avatarFrame', 'profileGlow', 'profileBgType', 'profileBgValue',
        'musicURL', 'poetry', 'poetryBg', 'poetryAttachment',
        'country', 'family', 'gender', 'age'
    ];

    // حقول محظورة (لا يمكن تعديلها عبر identity)
    const FORBIDDEN_FIELDS = [
        'rank', 'rankLevel', 'king_uid', 'queenOrder',
        'isBanned', 'bannedUntil', 'permanentBan', 'banReason',
        'isJailed', 'jailUntil', 'jailCount', 'jailReason',
        'customPermissions', 'devices', 'ipHashes',
        'warnings', 'kickCount', 'lastKickAt',
        'code', 'email', 'uid', 'createdAt',
        'currentRoom', 'invisible', 'privacy',
        'lastSeen', 'isGuest', 'identityUpdatedAt'
    ];

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        cache: {},              // { uid: { data, at } }
        rateMap: {},            // { uid: [timestamps] }
        debounceMap: {},        // { uid: { updates, timer, resolvers } }
        listeners: []
    };

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onIdentityChange(cb) {
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
        if (eventName === 'identity:updated' || eventName === 'identity:reset') {
            State.listeners.slice().forEach(function (cb) {
                try { cb(payload); } catch (e) { Logger.warn('listener error:', e); }
            });
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _getCurrentUid() {
        if (window.QamarAuth && window.QamarAuth.getUid) {
            return window.QamarAuth.getUid();
        }
        return window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;
    }

    function _isGuest() {
        if (window.QamarAuth && window.QamarAuth.isGuest) {
            return window.QamarAuth.isGuest();
        }
        return !!(window.auth && window.auth.currentUser && window.auth.currentUser.isAnonymous);
    }

    function _isValidUrl(url) {
        if (!url) return true;  // فارغ مسموح
        if (typeof url !== 'string') return false;
        if (url.length > CONFIG.URL_MAX) return false;
        return /^(https?:\/\/|data:image\/|data:video\/|blob:)/i.test(url);
    }

    /* ══════════════════════════════════════════════ */
    /* Validation per field                            */
    /* ══════════════════════════════════════════════ */
    function validateField(field, value) {
        if (FORBIDDEN_FIELDS.indexOf(field) !== -1) {
            return { ok: false, error: 'حقل محظور: ' + field };
        }
        if (FIELDS.indexOf(field) === -1) {
            return { ok: false, error: 'حقل غير معروف: ' + field };
        }

        // السماح بـ null/'' للحذف (reset)
        const isEmpty = value === null || value === undefined || value === '';

        switch (field) {
            case 'name': {
                if (isEmpty) return { ok: true, value: null };
                if (typeof value !== 'string') return { ok: false, error: 'الاسم يجب أن يكون نصاً' };
                const v = value.trim();
                if (v.length < CONFIG.NAME_MIN) return { ok: false, error: 'الاسم قصير جداً (2 أحرف على الأقل)' };
                if (v.length > CONFIG.NAME_MAX) return { ok: false, error: 'الاسم طويل جداً (40 حرف كحد أقصى)' };
                return { ok: true, value: v };
            }
            case 'bio': {
                if (isEmpty) return { ok: true, value: '' };
                if (typeof value !== 'string') return { ok: false, error: 'البايو يجب أن يكون نصاً' };
                const v = value.trim();
                if (v.length > CONFIG.BIO_MAX) return { ok: false, error: 'البايو طويل جداً (50 حرف كحد أقصى)' };
                return { ok: true, value: v };
            }
            case 'age': {
                if (isEmpty) return { ok: true, value: null };
                const n = Number(value);
                if (isNaN(n)) return { ok: false, error: 'العمر يجب أن يكون رقماً' };
                if (n < CONFIG.AGE_MIN || n > CONFIG.AGE_MAX) {
                    return { ok: false, error: 'العمر يجب أن يكون بين 13 و 100' };
                }
                return { ok: true, value: Math.floor(n) };
            }
            case 'gender': {
                if (isEmpty) return { ok: true, value: null };
                if (CONFIG.GENDERS.indexOf(value) === -1) {
                    return { ok: false, error: 'الجنس غير صحيح' };
                }
                return { ok: true, value: value };
            }
            case 'country': {
                if (isEmpty) return { ok: true, value: '' };
                if (typeof value !== 'string') return { ok: false, error: 'البلد يجب أن يكون نصاً' };
                const v = value.trim();
                if (v.length < CONFIG.COUNTRY_MIN) return { ok: false, error: 'البلد قصير جداً' };
                if (v.length > CONFIG.COUNTRY_MAX) return { ok: false, error: 'البلد طويل جداً (20 حرف كحد أقصى)' };
                return { ok: true, value: v };
            }
            case 'family': {
                if (isEmpty) return { ok: true, value: '' };
                if (typeof value !== 'string') return { ok: false, error: 'العائلة يجب أن تكون نصاً' };
                const v = value.trim();
                if (v.length < CONFIG.FAMILY_MIN) return { ok: false, error: 'اسم العائلة قصير جداً' };
                if (v.length > CONFIG.FAMILY_MAX) return { ok: false, error: 'اسم العائلة طويل جداً (30 حرف كحد أقصى)' };
                return { ok: true, value: v };
            }
            case 'avatar':
            case 'cover':
            case 'poetryBg':
            case 'poetryAttachment':
            case 'musicURL': {
                if (isEmpty) return { ok: true, value: null };
                if (!_isValidUrl(value)) return { ok: false, error: 'الرابط غير صحيح' };
                return { ok: true, value: String(value) };
            }
            case 'coverType': {
                if (isEmpty) return { ok: true, value: 'none' };
                if (CONFIG.COVER_TYPES.indexOf(value) === -1) {
                    return { ok: false, error: 'نوع الغلاف غير صحيح' };
                }
                return { ok: true, value: value };
            }
            case 'profileBgType': {
                if (isEmpty) return { ok: true, value: 'none' };
                if (CONFIG.PROFILE_BG_TYPES.indexOf(value) === -1) {
                    return { ok: false, error: 'نوع الخلفية غير صحيح' };
                }
                return { ok: true, value: value };
            }
            case 'nameColor':
            case 'nameBgColor':
            case 'profileGlow': {
                if (isEmpty) return { ok: true, value: null };
                if (typeof value !== 'string') return { ok: false, error: 'اللون يجب أن يكون نصاً' };
                if (!/^#[0-9a-fA-F]{3,8}$/.test(value)) {
                    return { ok: false, error: 'صيغة اللون غير صحيحة' };
                }
                return { ok: true, value: value };
            }
            case 'nameGradient':
            case 'nameBgGradient': {
                if (isEmpty) return { ok: true, value: null };
                if (!Array.isArray(value)) return { ok: false, error: 'التدرج يجب أن يكون مصفوفة' };
                if (value.length !== 2) return { ok: false, error: 'التدرج يحتاج لونين' };
                for (let i = 0; i < 2; i++) {
                    if (typeof value[i] !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(value[i])) {
                        return { ok: false, error: 'ألوان التدرج غير صحيحة' };
                    }
                }
                return { ok: true, value: [value[0], value[1]] };
            }
            case 'avatarFrame': {
                if (isEmpty) return { ok: true, value: null };
                if (typeof value !== 'string') return { ok: false, error: 'الإطار يجب أن يكون نصاً' };
                if (value.length > 60) return { ok: false, error: 'اسم الإطار طويل جداً' };
                return { ok: true, value: value };
            }
            case 'cinemaTextStyle':
            case 'cinemaBgStyle': {
                if (isEmpty) return { ok: true, value: null };
                if (typeof value !== 'string') return { ok: false, error: 'النمط يجب أن يكون نصاً' };
                if (value.length > 40) return { ok: false, error: 'اسم النمط طويل جداً' };
                return { ok: true, value: value };
            }
            case 'profileBgValue': {
                if (isEmpty) return { ok: true, value: null };
                // يمكن أن يكون لوناً أو رابطاً أو تدرجاً
                if (typeof value === 'string' && value.length > 500) {
                    return { ok: false, error: 'قيمة الخلفية طويلة جداً' };
                }
                return { ok: true, value: value };
            }
            case 'poetry': {
                if (isEmpty) return { ok: true, value: '' };
                if (typeof value !== 'string') return { ok: false, error: 'الشعر يجب أن يكون نصاً' };
                if (value.length > 500) return { ok: false, error: 'الشعر طويل جداً (500 حرف كحد أقصى)' };
                return { ok: true, value: value.trim() };
            }
            default:
                // باقي الحقول — نص فقط
                if (isEmpty) return { ok: true, value: null };
                if (typeof value !== 'string') return { ok: false, error: 'يجب أن يكون نصاً' };
                if (value.length > 200) return { ok: false, error: 'القيمة طويلة جداً' };
                return { ok: true, value: value };
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Rate limit                                      */
    /* ══════════════════════════════════════════════ */
    function _checkRateLimit(uid) {
        const now = Date.now();
        if (!State.rateMap[uid]) State.rateMap[uid] = [];
        State.rateMap[uid] = State.rateMap[uid].filter(function (t) {
            return now - t < CONFIG.RATE_WINDOW_MS;
        });
        if (State.rateMap[uid].length >= CONFIG.RATE_MAX_UPDATES) {
            return false;
        }
        State.rateMap[uid].push(now);
        return true;
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
        return c.data;
    }

    function _cacheSet(uid, data) {
        State.cache[uid] = { data: data, at: Date.now() };
    }

    function _cacheClear(uid) {
        if (uid) delete State.cache[uid];
        else State.cache = {};
    }

    /* ══════════════════════════════════════════════ */
    /* Read                                            */
    /* ══════════════════════════════════════════════ */
    function getIdentity(uid, forceRefresh) {
        uid = uid || _getCurrentUid();
        if (!uid) return Promise.resolve(null);

        if (!forceRefresh) {
            const cached = _cacheGet(uid);
            if (cached) return Promise.resolve(cached);
        }

        return window.QamarFB.get('users/' + uid).then(function (data) {
            if (!data) return null;
            // استخرج حقول الهوية فقط
            const identity = {};
            FIELDS.forEach(function (f) {
                if (data[f] !== undefined) identity[f] = data[f];
            });
            identity.uid = uid;
            identity.rank = data.rank || 'User';
            identity.rankLevel = data.rankLevel || 50;
            identity.code = data.code || null;
            _cacheSet(uid, identity);
            return identity;
        }).catch(function (e) {
            Logger.warn('getIdentity failed:', e.message);
            return null;
        });
    }

    function getCached(uid) {
        uid = uid || _getCurrentUid();
        if (!uid) return null;
        return _cacheGet(uid);
    }

    function getField(uid, field) {
        if (FIELDS.indexOf(field) === -1) {
            return Promise.reject(new Error('حقل غير معروف: ' + field));
        }
        uid = uid || _getCurrentUid();
        if (!uid) return Promise.resolve(null);
        return window.QamarFB.get('users/' + uid + '/' + field).catch(function () {
            return null;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Write — immediate                               */
    /* ══════════════════════════════════════════════ */
    function _saveField(uid, field, value) {
        const path = 'users/' + uid + '/' + field;
        const updates = {};
        updates[path] = value;
        updates['users/' + uid + '/identityUpdatedAt'] = window.QamarFB.serverTime();
        return window.QamarFB.multiUpdate(updates);
    }

    function _updateLocalCache(uid, updates) {
        const cached = _cacheGet(uid);
        if (cached) {
            Object.keys(updates).forEach(function (f) {
                cached[f] = updates[f];
            });
        }
        // zامن الجلسة
        if (window.QamarSession && window.QamarSession.updateSession) {
            try { window.QamarSession.updateSession(updates); } catch (e) {}
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Public — update single field                    */
    /* ══════════════════════════════════════════════ */
    function updateField(field, value) {
        return updateFields({ [field]: value });
    }

    /* ══════════════════════════════════════════════ */
    /* Public — update multiple (write واحد)           */
    /* ══════════════════════════════════════════════ */
    function updateFields(updates) {
        const uid = _getCurrentUid();
        if (!uid) return Promise.reject(new Error('غير مسجل'));
        if (_isGuest()) return Promise.reject(new Error('الزوار لا يمكنهم تعديل البروفايل'));
        if (!updates || typeof updates !== 'object') {
            return Promise.reject(new Error('لا توجد تحديثات'));
        }

        if (!_checkRateLimit(uid)) {
            return Promise.reject(new Error('محاولات كثيرة — حاول لاحقاً'));
        }

        // تحقق من كل حقل
        const validated = {};
        const errors = [];
        Object.keys(updates).forEach(function (field) {
            const r = validateField(field, updates[field]);
            if (r.ok) {
                validated[field] = r.value;
            } else {
                errors.push(field + ': ' + r.error);
            }
        });

        if (Object.keys(validated).length === 0) {
            return Promise.reject(new Error(errors.join('، ') || 'لا حقول صالحة'));
        }

        // احفظ كل الحقول بحيث يشملها write واحد (multiUpdate)
        const multi = {};
        Object.keys(validated).forEach(function (f) {
            multi['users/' + uid + '/' + f] = validated[f];
        });
        multi['users/' + uid + '/identityUpdatedAt'] = window.QamarFB.serverTime();

        return window.QamarFB.multiUpdate(multi)
            .then(function () {
                _updateLocalCache(uid, validated);
                Logger.info('✅ Identity updated:', Object.keys(validated).join(', '));
                _emit('identity:updated', { uid: uid, fields: validated });
                if (errors.length > 0) {
                    Logger.warn('بعض الحقول مرفوضة:', errors.join('، '));
                }
                return { ok: true, updated: validated, errors: errors };
            })
            .catch(function (e) {
                Logger.error('updateFields failed:', e.message);
                throw e;
            });
    }

    /* ══════════════════════════════════════════════ */
    /* Convenience setters                             */
    /* ══════════════════════════════════════════════ */
    function setName(name)                { return updateField('name', name); }
    function setBio(bio)                  { return updateField('bio', bio); }
    function setAvatar(url)               { return updateField('avatar', url); }
    function setCover(url)                { return updateField('cover', url); }
    function setCoverType(type)           { return updateField('coverType', type); }
    function setFrame(frameId)            { return updateField('avatarFrame', frameId); }
    function setProfileGlow(color)        { return updateField('profileGlow', color); }
    function setNameColor(color)          { return updateField('nameColor', color); }
    function setNameGradient(g1, g2)      { return updateField('nameGradient', [g1, g2]); }
    function setNameBgColor(color)        { return updateField('nameBgColor', color); }
    function setNameBgGradient(g1, g2)    { return updateField('nameBgGradient', [g1, g2]); }
    function setCinemaTextStyle(style)    { return updateField('cinemaTextStyle', style); }
    function setCinemaBgStyle(style)      { return updateField('cinemaBgStyle', style); }
    function setProfileBgType(type)       { return updateField('profileBgType', type); }
    function setProfileBgValue(value)     { return updateField('profileBgValue', value); }
    function setMusicURL(url)             { return updateField('musicURL', url); }
    function setPoetry(text)              { return updateField('poetry', text); }
    function setPoetryBg(url)             { return updateField('poetryBg', url); }
    function setCountry(country)          { return updateField('country', country); }
    function setFamily(family)            { return updateField('family', family); }
    function setGender(gender)            { return updateField('gender', gender); }
    function setAge(age)                  { return updateField('age', age); }

    /* ══════════════════════════════════════════════ */
    /* Reset                                           */
    /* ══════════════════════════════════════════════ */
    function resetField(field) {
        const uid = _getCurrentUid();
        if (!uid) return Promise.reject(new Error('غير مسجل'));

        let defaultValue = null;
        switch (field) {
            case 'avatar':
                // صورة القمر الذهبي الافتراضية — تُملأ من UI لاحقاً
                defaultValue = null;  // يقرأه العرض كـ "افتراضي"
                break;
            case 'cover': defaultValue = null; break;
            case 'bio':   defaultValue = ''; break;
            case 'avatarFrame':
                // حسب الرتبة — من constants
                defaultValue = null;
                break;
            case 'nameGradient':
            case 'nameBgGradient':
                defaultValue = null;
                break;
            case 'nameBgColor':
            case 'nameColor':
            case 'profileGlow':
                defaultValue = null;
                break;
            default:
                defaultValue = null;
        }

        return updateField(field, defaultValue).then(function () {
            _emit('identity:reset', { uid: uid, field: field });
            return { ok: true, field: field };
        });
    }

    function resetAll() {
        const updates = {};
        FIELDS.forEach(function (f) {
            updates[f] = null;
        });
        return updateFields(updates).then(function () {
            _emit('identity:reset', { uid: _getCurrentUid(), all: true });
            return { ok: true };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Debug                                           */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        const uid = _getCurrentUid();
        return {
            uid: uid,
            isGuest: _isGuest(),
            cachedUids: Object.keys(State.cache),
            currentCached: uid ? !!State.cache[uid] : false,
            rateLimitCount: uid && State.rateMap[uid] ? State.rateMap[uid].length : 0,
            fieldsCount: FIELDS.length
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarIdentity = {
        // Constants
        FIELDS: FIELDS,
        FORBIDDEN_FIELDS: FORBIDDEN_FIELDS,
        CONFIG: CONFIG,

        // Read
        getIdentity: getIdentity,
        getField: getField,
        getCached: getCached,

        // Write
        updateField: updateField,
        updateFields: updateFields,

        // Setters
        setName: setName,
        setBio: setBio,
        setAvatar: setAvatar,
        setCover: setCover,
        setCoverType: setCoverType,
        setFrame: setFrame,
        setProfileGlow: setProfileGlow,
        setNameColor: setNameColor,
        setNameGradient: setNameGradient,
        setNameBgColor: setNameBgColor,
        setNameBgGradient: setNameBgGradient,
        setCinemaTextStyle: setCinemaTextStyle,
        setCinemaBgStyle: setCinemaBgStyle,
        setProfileBgType: setProfileBgType,
        setProfileBgValue: setProfileBgValue,
        setMusicURL: setMusicURL,
        setPoetry: setPoetry,
        setPoetryBg: setPoetryBg,
        setCountry: setCountry,
        setFamily: setFamily,
        setGender: setGender,
        setAge: setAge,

        // Reset
        resetField: resetField,
        resetAll: resetAll,

        // Validation
        validateField: validateField,

        // Cache
        clearCache: _cacheClear,

        // Events
        onIdentityChange: onIdentityChange,

        // Debug
        getStatus: getStatus
    };

    window.QamarIdentity = QamarIdentity;

    Logger.info('📦 [identity.js] loaded | fields:', FIELDS.length, '| forbidden:', FORBIDDEN_FIELDS.length);
})();
