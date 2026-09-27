// ==============================================
// firebase/optimizers.js
// Performance optimization for weak internet
// ==============================================
// يعتمد على: firebase/firebase.js
// يعطي: window.QamarOpt
// ==============================================

(function () {
    'use strict';

    if (!window.QamarFB) {
        console.error('❌ [optimizers] firebase.js not loaded!');
        return;
    }

    const LOG_TAG = '[OPT]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); }
    };

    /* ══════════════════════════════════════════════ */
    /* 1. IndexedDB Cache — للرسائل والبروفايلات      */
    /* ══════════════════════════════════════════════ */
    const DB_NAME = 'qamar_cache_v2';
    const DB_VERSION = 1;
    const STORES = {
        messages: 'messages',
        profiles: 'profiles',
        meta: 'meta'
    };

    let _idb = null;
    let _idbReady = null;

    function _openIDB() {
        if (_idbReady) return _idbReady;
        _idbReady = new Promise(function (resolve, reject) {
            if (!window.indexedDB) {
                Logger.warn('IndexedDB not available');
                return resolve(null);
            }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORES.messages)) {
                    const s = db.createObjectStore(STORES.messages, { keyPath: 'key' });
                    s.createIndex('room', 'room', { unique: false });
                    s.createIndex('time', 'time', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORES.profiles)) {
                    db.createObjectStore(STORES.profiles, { keyPath: 'uid' });
                }
                if (!db.objectStoreNames.contains(STORES.meta)) {
                    db.createObjectStore(STORES.meta, { keyPath: 'key' });
                }
            };
            req.onsuccess = function () { _idb = req.result; resolve(_idb); };
            req.onerror = function () { Logger.warn('IDB open error'); resolve(null); };
        });
        return _idbReady;
    }

    // كتابة إلى store
    function _idbPut(store, value) {
        return _openIDB().then(function (db) {
            if (!db) return false;
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(store, 'readwrite');
                    tx.objectStore(store).put(value);
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { resolve(false); };
                } catch (e) { resolve(false); }
            });
        });
    }

    // قراءة متعددة من store
    function _idbGetAll(store, indexName, query, limit) {
        return _openIDB().then(function (db) {
            if (!db) return [];
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(store, 'readonly');
                    const os = tx.objectStore(store);
                    const source = indexName ? os.index(indexName) : os;
                    const req = indexName ? source.getAll(query) : source.getAll();
                    req.onsuccess = function () {
                        let arr = req.result || [];
                        if (limit) arr = arr.slice(-limit);
                        resolve(arr);
                    };
                    req.onerror = function () { resolve([]); };
                } catch (e) { resolve([]); }
            });
        });
    }

    function _idbGet(store, key) {
        return _openIDB().then(function (db) {
            if (!db) return null;
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(store, 'readonly');
                    const req = tx.objectStore(store).get(key);
                    req.onsuccess = function () { resolve(req.result || null); };
                    req.onerror = function () { resolve(null); };
                } catch (e) { resolve(null); }
            });
        });
    }

    function _idbDelete(store, key) {
        return _openIDB().then(function (db) {
            if (!db) return false;
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(store, 'readwrite');
                    tx.objectStore(store).delete(key);
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { resolve(false); };
                } catch (e) { resolve(false); }
            });
        });
    }

    function _idbClear(store) {
        return _openIDB().then(function (db) {
            if (!db) return false;
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(store, 'readwrite');
                    tx.objectStore(store).clear();
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { resolve(false); };
                } catch (e) { resolve(false); }
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 2. In-Memory LRU Cache                          */
    /* ══════════════════════════════════════════════ */
    function LRU(maxSize) {
        this.max = maxSize || 100;
        this.map = new Map();
    }
    LRU.prototype.get = function (key) {
        if (!this.map.has(key)) return undefined;
        const v = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, v); // refresh
        return v;
    };
    LRU.prototype.set = function (key, value) {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size > this.max) {
            const first = this.map.keys().next().value;
            this.map.delete(first);
        }
    };
    LRU.prototype.has = function (key) { return this.map.has(key); };
    LRU.prototype.delete = function (key) { this.map.delete(key); };
    LRU.prototype.clear = function () { this.map.clear(); };
    LRU.prototype.size = function () { return this.map.size; };

    const profileCache = new LRU(300);  // 300 بروفايل
    const messageDedup = new LRU(500);  // آخر 500 رسالة

    /* ══════════════════════════════════════════════ */
    /* 3. Message Cache (IndexedDB layer)              */
    /* ══════════════════════════════════════════════ */

    // حفظ رسالة في IDB
    function cacheMessage(roomId, msgId, data) {
        if (!roomId || !msgId || !data) return Promise.resolve(false);
        const key = roomId + '::' + msgId;
        return _idbPut(STORES.messages, {
            key: key,
            room: roomId,
            msgId: msgId,
            time: data.time || Date.now(),
            data: data,
            cachedAt: Date.now()
        });
    }

    // حفظ دفعة رسائل
    function cacheMessages(roomId, messages) {
        if (!roomId || !Array.isArray(messages)) return Promise.resolve(0);
        return _openIDB().then(function (db) {
            if (!db) return 0;
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(STORES.messages, 'readwrite');
                    const os = tx.objectStore(STORES.messages);
                    messages.forEach(function (m) {
                        if (!m || !m.id) return;
                        os.put({
                            key: roomId + '::' + m.id,
                            room: roomId,
                            msgId: m.id,
                            time: (m.data && m.data.time) || Date.now(),
                            data: m.data,
                            cachedAt: Date.now()
                        });
                    });
                    tx.oncomplete = function () { resolve(messages.length); };
                    tx.onerror = function () { resolve(0); };
                } catch (e) { resolve(0); }
            });
        });
    }

    // قراءة رسائل روم من IDB
    function getCachedMessages(roomId, limit) {
        limit = limit || 50;
        return _openIDB().then(function (db) {
            if (!db) return [];
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(STORES.messages, 'readonly');
                    const idx = tx.objectStore(STORES.messages).index('room');
                    const req = idx.getAll(roomId);
                    req.onsuccess = function () {
                        let arr = req.result || [];
                        arr.sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
                        if (arr.length > limit) arr = arr.slice(-limit);
                        resolve(arr.map(function (r) {
                            return { id: r.msgId, data: r.data };
                        }));
                    };
                    req.onerror = function () { resolve([]); };
                } catch (e) { resolve([]); }
            });
        });
    }

    // حذف رسائل روم من IDB
    function clearCachedMessages(roomId) {
        return _openIDB().then(function (db) {
            if (!db) return 0;
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(STORES.messages, 'readwrite');
                    const idx = tx.objectStore(STORES.messages).index('room');
                    const req = idx.openCursor(IDBKeyRange.only(roomId));
                    let count = 0;
                    req.onsuccess = function (e) {
                        const cur = e.target.result;
                        if (cur) { cur.delete(); count++; cur.continue(); }
                    };
                    tx.oncomplete = function () { resolve(count); };
                    tx.onerror = function () { resolve(0); };
                } catch (e) { resolve(0); }
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 4. Profile Cache                                */
    /* ══════════════════════════════════════════════ */
    const PROFILE_TTL_MS = 10 * 60 * 1000; // 10 دقائق

    function cacheProfile(uid, data) {
        if (!uid || !data) return Promise.resolve(false);
        profileCache.set(uid, { data: data, at: Date.now() });
        return _idbPut(STORES.profiles, {
            uid: uid,
            data: data,
            cachedAt: Date.now()
        });
    }

    function getCachedProfile(uid) {
        // 1) من الذاكرة
        const mem = profileCache.get(uid);
        if (mem && (Date.now() - mem.at) < PROFILE_TTL_MS) {
            return Promise.resolve(mem.data);
        }
        // 2) من IDB
        return _idbGet(STORES.profiles, uid).then(function (r) {
            if (r && (Date.now() - r.cachedAt) < PROFILE_TTL_MS) {
                profileCache.set(uid, { data: r.data, at: r.cachedAt });
                return r.data;
            }
            return null;
        });
    }

    function clearProfileCache(uid) {
        if (uid) {
            profileCache.delete(uid);
            return _idbDelete(STORES.profiles, uid);
        }
        profileCache.clear();
        return _idbClear(STORES.profiles);
    }

    /* ══════════════════════════════════════════════ */
    /* 5. Batched Writes                               */
    /* ══════════════════════════════════════════════ */
    const _batches = {};  // { batchKey: { updates: {}, timer, resolver } }
    const BATCH_WINDOW_MS = 300;

    function batchUpdate(path, value, batchKey) {
        batchKey = batchKey || 'default';
        if (!_batches[batchKey]) {
            _batches[batchKey] = { updates: {}, timer: null, resolvers: [] };
        }
        const b = _batches[batchKey];
        b.updates[path] = value;

        return new Promise(function (resolve, reject) {
            b.resolvers.push({ resolve: resolve, reject: reject });
            if (b.timer) clearTimeout(b.timer);
            b.timer = setTimeout(function () { _flushBatch(batchKey); }, BATCH_WINDOW_MS);
        });
    }

    function _flushBatch(batchKey) {
        const b = _batches[batchKey];
        if (!b) return;
        const updates = b.updates;
        const resolvers = b.resolvers;
        delete _batches[batchKey];

        if (Object.keys(updates).length === 0) {
            resolvers.forEach(function (r) { r.resolve(true); });
            return;
        }

        window.QamarFB.multiUpdate(updates)
            .then(function () {
                resolvers.forEach(function (r) { r.resolve(true); });
                Logger.debug('Batch flushed:', batchKey, Object.keys(updates).length);
            })
            .catch(function (e) {
                resolvers.forEach(function (r) { r.reject(e); });
                Logger.warn('Batch failed:', batchKey, e.message);
            });
    }

    function flushBatch(batchKey) {
        if (batchKey) _flushBatch(batchKey);
        else Object.keys(_batches).forEach(_flushBatch);
    }

    /* ══════════════════════════════════════════════ */
    /* 6. Deduplication                                */
    /* ══════════════════════════════════════════════ */

    // fingerprint بسيط
    function _fingerprint(obj) {
        try {
            const s = JSON.stringify(obj);
            let h = 5381;
            for (let i = 0; i < s.length; i++) {
                h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
            }
            return h.toString(36);
        } catch (e) { return String(Date.now()); }
    }

    function isDuplicate(scope, obj) {
        const fp = scope + '::' + _fingerprint(obj);
        if (messageDedup.has(fp)) return true;
        messageDedup.set(fp, Date.now());
        return false;
    }

    /* ══════════════════════════════════════════════ */
    /* 7. Debounced Update                             */
    /* ══════════════════════════════════════════════ */
    const _debounceMap = {};

    function debouncedUpdate(key, path, valueFn, delayMs) {
        delayMs = delayMs || 2000;
        if (_debounceMap[key]) clearTimeout(_debounceMap[key].timer);
        _debounceMap[key] = {
            timer: setTimeout(function () {
                const val = typeof valueFn === 'function' ? valueFn() : valueFn;
                window.QamarFB.update(path, val).catch(function (e) {
                    Logger.warn('debouncedUpdate failed:', key, e.message);
                });
                delete _debounceMap[key];
            }, delayMs)
        };
    }

    function cancelDebounced(key) {
        if (_debounceMap[key]) {
            clearTimeout(_debounceMap[key].timer);
            delete _debounceMap[key];
        }
    }

    /* ══════════════════════════════════════════════ */
    /* 8. Offline Queue                                */
    /* ══════════════════════════════════════════════ */
    const offlineQueue = [];
    const MAX_QUEUE = 200;
    let _online = true;

    function _isOnline() { return navigator.onLine !== false; }

    function enqueue(op) {
        // op = { type: 'set'|'update'|'push'|'remove', path, value }
        if (offlineQueue.length >= MAX_QUEUE) {
            offlineQueue.shift(); // احذف الأقدم
        }
        offlineQueue.push({ op: op, at: Date.now() });
        Logger.debug('Enqueued offline op:', op.type, op.path);
    }

    function flushOfflineQueue() {
        if (!_isOnline() || offlineQueue.length === 0) return Promise.resolve(0);
        const ops = offlineQueue.splice(0, offlineQueue.length);
        Logger.info('Flushing offline queue:', ops.length);
        let chain = Promise.resolve();
        ops.forEach(function (item) {
            chain = chain.then(function () {
                const o = item.op;
                switch (o.type) {
                    case 'set':    return window.QamarFB.set(o.path, o.value);
                    case 'update': return window.QamarFB.update(o.path, o.value);
                    case 'push':   return window.QamarFB.push(o.path, o.value);
                    case 'remove': return window.QamarFB.remove(o.path);
                }
            }).catch(function (e) {
                Logger.warn('Offline op failed:', e.message);
            });
        });
        return chain.then(function () { return ops.length; });
    }

    // مراقبة الاتصال
    if (typeof window !== 'undefined') {
        window.addEventListener('online', function () {
            _online = true;
            flushOfflineQueue();
        });
        window.addEventListener('offline', function () {
            _online = false;
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 9. Smart Write (set/update معاً)                */
    /* ══════════════════════════════════════════════ */
    function smartWrite(path, value, options) {
        options = options || {};
        // إذا offline → ضع في الطابور
        if (!_isOnline()) {
            enqueue({ type: options.merge ? 'update' : 'set', path: path, value: value });
            return Promise.resolve({ queued: true });
        }
        const fn = options.merge ? window.QamarFB.update : window.QamarFB.set;
        return fn(path, value).catch(function (e) {
            // إذا PERMISSION_DENIED → لا داعي للإعادة
            if (e && e.code === 'PERMISSION_DENIED') throw e;
            // إذا شبكة → ضع في الطابور
            enqueue({ type: options.merge ? 'update' : 'set', path: path, value: value });
            return { queued: true, error: e.message };
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 10. Cleanup القديم                              */
    /* ══════════════════════════════════════════════ */

    // حذف رسائل أقدم من N أيام من IDB
    function cleanupOldMessages(daysOld) {
        daysOld = daysOld || 7;
        const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
        return _openIDB().then(function (db) {
            if (!db) return 0;
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(STORES.messages, 'readwrite');
                    const idx = tx.objectStore(STORES.messages).index('time');
                    const req = idx.openCursor(IDBKeyRange.upperBound(cutoff));
                    let count = 0;
                    req.onsuccess = function (e) {
                        const cur = e.target.result;
                        if (cur) { cur.delete(); count++; cur.continue(); }
                    };
                    tx.oncomplete = function () { resolve(count); };
                    tx.onerror = function () { resolve(0); };
                } catch (e) { resolve(0); }
            });
        });
    }

    // مسح كل شيء
    function clearAllCaches() {
        profileCache.clear();
        messageDedup.clear();
        offlineQueue.length = 0;
        return Promise.all([
            _idbClear(STORES.messages),
            _idbClear(STORES.profiles)
        ]).then(function () { return true; });
    }

    // إحصاءات للـ debug
    function getStats() {
        return {
            profileCacheSize: profileCache.size(),
            dedupCacheSize: messageDedup.size(),
            offlineQueueSize: offlineQueue.length,
            pendingBatches: Object.keys(_batches).length,
            isOnline: _isOnline()
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarOpt = {
        // Messages
        cacheMessage: cacheMessage,
        cacheMessages: cacheMessages,
        getCachedMessages: getCachedMessages,
        clearCachedMessages: clearCachedMessages,

        // Profiles
        cacheProfile: cacheProfile,
        getCachedProfile: getCachedProfile,
        clearProfileCache: clearProfileCache,

        // Batched writes
        batchUpdate: batchUpdate,
        flushBatch: flushBatch,

        // Dedup
        isDuplicate: isDuplicate,

        // Debounced
        debouncedUpdate: debouncedUpdate,
        cancelDebounced: cancelDebounced,

        // Offline
        enqueue: enqueue,
        flushOfflineQueue: flushOfflineQueue,
        smartWrite: smartWrite,

        // Cleanup
        cleanupOldMessages: cleanupOldMessages,
        clearAllCaches: clearAllCaches,

        // Debug
        getStats: getStats
    };

    window.QamarOpt = QamarOpt;

    // افتح IDB مبكراً
    _openIDB();

    Logger.info('📦 [optimizers.js] loaded');
})();
