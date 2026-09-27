// ==============================================
// firebase/firebase.js
// Unified wrapper around Realtime DB + Storage
// ==============================================
// يعتمد على: core/config.js (يوفر db, storage)
// يعطي: window.QamarFB
// ==============================================

(function () {
    'use strict';

    /* ══════════════════════════════════════════════ */
    /* Config                                          */
    /* ══════════════════════════════════════════════ */
    const DEFAULT_TIMEOUT = 15000;   // 15s لعملية قراءة
    const WRITE_TIMEOUT   = 20000;   // 20s لعملية كتابة
    const LOG_TAG         = '[FB]';

    /* ══════════════════════════════════════════════ */
    /* Logger مختصر                                   */
    /* ══════════════════════════════════════════════ */
    const Logger = {
        debug: function () {
            if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments)));
        },
        info:  function () { console.log.apply(console,   [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console,  [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); }
    };

    /* ══════════════════════════════════════════════ */
    /* Sanitizers                                     */
    /* ══════════════════════════════════════════════ */

    // Firebase keys لا يمكن أن تحتوي على: . # $ [ ] /
    function escapeKey(key) {
        if (key === null || key === undefined) return '';
        return String(key)
            .replace(/\./g, '_DOT_')
            .replace(/#/g, '_HASH_')
            .replace(/\$/g, '_DOL_')
            .replace(/\[/g, '_LB_')
            .replace(/\]/g, '_RB_')
            .replace(/\//g, '_SL_');
    }

    // البريد الإلكتروني يحتاج ترميز إضافي لـ @
    function encodeEmail(email) {
        if (!email) return '';
        return String(email)
            .replace(/\./g, '_DOT_')
            .replace(/@/g, '_AT_')
            .replace(/#/g, '_HASH_')
            .replace(/\$/g, '_DOL_')
            .replace(/\[/g, '_LB_')
            .replace(/\]/g, '_RB_')
            .replace(/\//g, '_SL_');
    }

    // عكس encodeEmail (للقراءة)
    function decodeEmail(encoded) {
        if (!encoded) return '';
        return String(encoded)
            .replace(/_DOT_/g, '.')
            .replace(/_AT_/g, '@')
            .replace(/_HASH_/g, '#')
            .replace(/_DOL_/g, '$')
            .replace(/_LB_/g, '[')
            .replace(/_RB_/g, ']')
            .replace(/_SL_/g, '/');
    }

    // بناء مسار من عدة أجزاء — ينظف كل جزء
    function buildPath() {
        const parts = Array.prototype.slice.call(arguments);
        return parts
            .filter(function (p) { return p !== null && p !== undefined && p !== ''; })
            .map(function (p) { return String(p).replace(/^\/+|\/+$/g, ''); })
            .join('/');
    }

    /* ══════════════════════════════════════════════ */
    /* Path helpers                                    */
    /* ══════════════════════════════════════════════ */
    const Paths = {
        user: function (uid) {
            return buildPath('users', uid);
        },
        userField: function (uid, field) {
            return buildPath('users', uid, field);
        },
        userCode: function (code) {
            return buildPath('user_codes', code);
        },
        userName: function (name) {
            return buildPath('user_names', name);
        },
        userPresence: function (uid) {
            return buildPath('user_presence', uid);
        },
        roomMessages: function (roomId) {
            return buildPath('room_messages', roomId);
        },
        roomSettings: function (roomId) {
            return buildPath('room_settings', roomId);
        },
        roomAlert: function (roomId) {
            return buildPath('room_alerts', roomId, 'current');
        },
        pm: function (uidA, uidB, msgId) {
            const key = [uidA, uidB].sort().join('_');
            return buildPath('user_private_messages', key, msgId);
        },
        pmChat: function (uid, otherUid) {
            return buildPath('user_private_chats', uid, otherUid);
        },
        deviceRegistry: function (deviceId, uid) {
            return buildPath('device_registry', deviceId, uid);
        },
        ipRegistry: function (ipHash, uid) {
            return buildPath('ip_registry', ipHash, uid);
        },
        auditLog: function (rid) {
            return buildPath('audit_log', rid);
        },
        story: function (uid, sid) {
            return buildPath('stories', uid, sid);
        },
        botMemory: function (key) {
            return buildPath('bot_memory', key);
        }
    };

    /* ══════════════════════════════════════════════ */
    /* Core readiness                                  */
    /* ══════════════════════════════════════════════ */
    function _getDb() {
        if (!window.db) {
            throw new Error('Firebase DB not initialized. Wait for waitForFirebase()');
        }
        return window.db;
    }

    function _getStorage() {
        if (!window.storage) {
            throw new Error('Firebase Storage not initialized');
        }
        return window.storage;
    }

    function isReady() {
        return !!(window.db && window.auth);
    }

    function waitReady(timeoutMs) {
        timeoutMs = timeoutMs || DEFAULT_TIMEOUT;
        if (isReady()) return Promise.resolve(true);
        if (typeof window.waitForFirebase === 'function') {
            return window.waitForFirebase(timeoutMs).then(function () {
                return isReady();
            });
        }
        return Promise.reject(new Error('waitForFirebase not available'));
    }

    /* ══════════════════════════════════════════════ */
    /* Timeout helper                                  */
    /* ══════════════════════════════════════════════ */
    function _withTimeout(promise, ms, label) {
        let timer = null;
        const timeout = new Promise(function (_, reject) {
            timer = setTimeout(function () {
                reject(new Error('Timeout: ' + (label || 'operation') + ' (' + ms + 'ms)'));
            }, ms);
        });
        return Promise.race([promise, timeout]).then(
            function (v) { if (timer) clearTimeout(timer); return v; },
            function (e) { if (timer) clearTimeout(timer); throw e; }
        );
    }

    /* ══════════════════════════════════════════════ */
    /* Path validation                                 */
    /* ══════════════════════════════════════════════ */
    function _validatePath(path) {
        if (!path || typeof path !== 'string') {
            throw new Error('Invalid path: ' + path);
        }
        if (path.indexOf('//') !== -1) {
            throw new Error('Path has double slash: ' + path);
        }
        if (path.length > 700) {
            throw new Error('Path too long: ' + path.length);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Refs                                            */
    /* ══════════════════════════════════════════════ */
    function ref(path) {
        _validatePath(path);
        return _getDb().ref(path);
    }

    function storageRef(path) {
        return _getStorage().ref(path);
    }

    /* ══════════════════════════════════════════════ */
    /* READ operations                                 */
    /* ══════════════════════════════════════════════ */

    // get(path) → Promise<value|null>
    function get(path, timeoutMs) {
        return _withTimeout(
            ref(path).once('value').then(function (snap) {
                return snap.exists() ? snap.val() : null;
            }),
            timeoutMs || DEFAULT_TIMEOUT,
            'get ' + path
        );
    }

    // exists(path) → Promise<bool>
    function exists(path, timeoutMs) {
        return _withTimeout(
            ref(path).once('value').then(function (snap) {
                return snap.exists();
            }),
            timeoutMs || DEFAULT_TIMEOUT,
            'exists ' + path
        );
    }

    // children(path) → Promise<object> (مفاتيح → قيم)
    function children(path, timeoutMs) {
        return _withTimeout(
            ref(path).once('value').then(function (snap) {
                return snap.exists() ? snap.val() : {};
            }),
            timeoutMs || DEFAULT_TIMEOUT,
            'children ' + path
        );
    }

    // orderByChild + limitToLast — للرسائل
    function getLatest(path, limit, timeoutMs) {
        limit = limit || 50;
        return _withTimeout(
            ref(path).orderByChild('time').limitToLast(limit).once('value').then(function (snap) {
                const out = [];
                snap.forEach(function (child) {
                    out.push({ id: child.key, data: child.val() });
                });
                return out;
            }),
            timeoutMs || DEFAULT_TIMEOUT,
            'getLatest ' + path
        );
    }

    // query — مخصص
    function query(path, options, timeoutMs) {
        options = options || {};
        let q = ref(path);
        if (options.orderByChild) q = q.orderByChild(options.orderByChild);
        if (options.orderByKey)    q = q.orderByKey();
        if (options.orderByValue)  q = q.orderByValue();
        if (options.startAt !== undefined) q = q.startAt(options.startAt);
        if (options.endAt !== undefined)   q = q.endAt(options.endAt);
        if (options.equalTo !== undefined) q = q.equalTo(options.equalTo);
        if (options.limitToFirst)  q = q.limitToFirst(options.limitToFirst);
        if (options.limitToLast)   q = q.limitToLast(options.limitToLast);

        return _withTimeout(
            q.once('value').then(function (snap) {
                if (options.returnArray) {
                    const out = [];
                    snap.forEach(function (child) {
                        out.push({ id: child.key, data: child.val() });
                    });
                    return out;
                }
                return snap.exists() ? snap.val() : null;
            }),
            timeoutMs || DEFAULT_TIMEOUT,
            'query ' + path
        );
    }

    /* ══════════════════════════════════════════════ */
    /* WRITE operations                                */
    /* ══════════════════════════════════════════════ */

    // set(path, value) → Promise<void>
    function set(path, value, timeoutMs) {
        return _withTimeout(
            ref(path).set(value),
            timeoutMs || WRITE_TIMEOUT,
            'set ' + path
        );
    }

    // update(path, updates) — تحديث جزئي (لا يمس الحقول الأخرى)
    function update(path, updates, timeoutMs) {
        return _withTimeout(
            ref(path).update(updates),
            timeoutMs || WRITE_TIMEOUT,
            'update ' + path
        );
    }

    // push(path, value) → Promise<string> (المفتاح الجديد)
    function push(path, value, timeoutMs) {
        const newRef = ref(path).push();
        return _withTimeout(
            newRef.set(value).then(function () {
                return newRef.key;
            }),
            timeoutMs || WRITE_TIMEOUT,
            'push ' + path
        );
    }

    // remove(path)
    function remove(path, timeoutMs) {
        return _withTimeout(
            ref(path).remove(),
            timeoutMs || WRITE_TIMEOUT,
            'remove ' + path
        );
    }

    // multiUpdate({path1: val1, path2: val2}) — تحديث ذرّي
    function multiUpdate(updates, timeoutMs) {
        if (!updates || typeof updates !== 'object') {
            return Promise.reject(new Error('multiUpdate: invalid updates'));
        }
        const rootRef = _getDb().ref();
        return _withTimeout(
            rootRef.update(updates),
            timeoutMs || WRITE_TIMEOUT,
            'multiUpdate'
        );
    }

    // transaction(path, fn) — معاملة آمنة
    function transaction(path, fn, timeoutMs) {
        return _withTimeout(
            ref(path).transaction(fn).then(function (result) {
                return {
                    committed: result.committed,
                    snapshot: result.snapshot ? result.snapshot.val() : null
                };
            }),
            timeoutMs || WRITE_TIMEOUT,
            'transaction ' + path
        );
    }

    /* ══════════════════════════════════════════════ */
    /* LISTEN operations                               */
    /* كل دالة ترجع ref مع .off() لتنظيف الاستماع      */
    /* ══════════════════════════════════════════════ */

    // onValue(path, cb, errCb) → ref
    function onValue(path, cb, errCb) {
        const r = ref(path);
        const handler = r.on('value', function (snap) {
            try {
                cb(snap.exists() ? snap.val() : null, snap);
            } catch (e) {
                Logger.error('onValue callback error:', e);
            }
        }, errCb || function (e) { Logger.error('onValue error:', e); });
        return {
            ref: r,
            off: function () { r.off('value', handler); }
        };
    }

    // onChildAdded(path, cb, errCb) → ref
    function onChildAdded(path, cb, errCb) {
        const r = ref(path);
        const handler = r.on('child_added', function (snap) {
            try {
                cb(snap.val(), snap.key, snap);
            } catch (e) {
                Logger.error('onChildAdded callback error:', e);
            }
        }, errCb || function (e) { Logger.error('onChildAdded error:', e); });
        return {
            ref: r,
            off: function () { r.off('child_added', handler); }
        };
    }

    // onChildChanged(path, cb, errCb) → ref
    function onChildChanged(path, cb, errCb) {
        const r = ref(path);
        const handler = r.on('child_changed', function (snap) {
            try {
                cb(snap.val(), snap.key, snap);
            } catch (e) {
                Logger.error('onChildChanged callback error:', e);
            }
        }, errCb || function (e) { Logger.error('onChildChanged error:', e); });
        return {
            ref: r,
            off: function () { r.off('child_changed', handler); }
        };
    }

    // onChildRemoved(path, cb, errCb) → ref
    function onChildRemoved(path, cb, errCb) {
        const r = ref(path);
        const handler = r.on('child_removed', function (snap) {
            try {
                cb(snap.val(), snap.key, snap);
            } catch (e) {
                Logger.error('onChildRemoved callback error:', e);
            }
        }, errCb || function (e) { Logger.error('onChildRemoved error:', e); });
        return {
            ref: r,
            off: function () { r.off('child_removed', handler); }
        };
    }

    // onLimitToLast — للرسائل الأخيرة
    function onLatest(path, limit, cb, errCb) {
        limit = limit || 50;
        const r = ref(path).orderByChild('time').limitToLast(limit);
        const handler = r.on('value', function (snap) {
            const out = [];
            snap.forEach(function (child) {
                out.push({ id: child.key, data: child.val() });
            });
            try { cb(out, snap); }
            catch (e) { Logger.error('onLatest callback error:', e); }
        }, errCb || function (e) { Logger.error('onLatest error:', e); });
        return {
            ref: r,
            off: function () { r.off('value', handler); }
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Server time                                     */
    /* ══════════════════════════════════════════════ */
    function serverTime() {
        return firebase.database.ServerValue.TIMESTAMP;
    }

    function serverOffset(path) {
        // يقيس الفرق بين جهاز المستخدم والسيرفر
        path = path || '.info/serverTimeOffset';
        return new Promise(function (resolve) {
            const r = _getDb().ref(path);
            const handler = r.on('value', function (snap) {
                r.off('value', handler);
                resolve(snap.val() || 0);
            });
            // timeout احتياطي
            setTimeout(function () { resolve(0); }, 3000);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Connection monitor                              */
    /* ══════════════════════════════════════════════ */
    function onConnectionChange(cb) {
        const r = _getDb().ref('.info/connected');
        const handler = r.on('value', function (snap) {
            cb(snap.val() === true);
        });
        return {
            ref: r,
            off: function () { r.off('value', handler); }
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Batch helpers                                   */
    /* ══════════════════════════════════════════════ */

    // حذف عدة مسارات دفعة واحدة
    function removeMany(paths, timeoutMs) {
        const updates = {};
        (paths || []).forEach(function (p) { updates[p] = null; });
        return multiUpdate(updates, timeoutMs);
    }

    // setMany — كتابة عدة مسارات دفعة واحدة
    function setMany(map, timeoutMs) {
        return multiUpdate(map, timeoutMs);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarFB = {

        // Readiness
        isReady: isReady,
        waitReady: waitReady,

        // Refs
        ref: ref,
        storageRef: storageRef,

        // Read
        get: get,
        exists: exists,
        children: children,
        getLatest: getLatest,
        query: query,

        // Write
        set: set,
        update: update,
        push: push,
        remove: remove,
        multiUpdate: multiUpdate,
        transaction: transaction,

        // Listen
        onValue: onValue,
        onChildAdded: onChildAdded,
        onChildChanged: onChildChanged,
        onChildRemoved: onChildRemoved,
        onLatest: onLatest,
        onConnectionChange: onConnectionChange,

        // Utilities
        serverTime: serverTime,
        serverOffset: serverOffset,
        escapeKey: escapeKey,
        encodeEmail: encodeEmail,
        decodeEmail: decodeEmail,
        buildPath: buildPath,
        removeMany: removeMany,
        setMany: setMany,

        // Path helpers
        Paths: Paths,

        // Logger (للاستخدام الخارجي)
        Logger: Logger
    };

    window.QamarFB = QamarFB;

    Logger.info('📦 [firebase.js] loaded');
})();
