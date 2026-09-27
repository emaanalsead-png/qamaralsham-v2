// ==============================================
// core/config.js
// Firebase initialization + exports
// ==============================================
// ⚠️ مهم: عدّل FIREBASE_CONFIG إذا مشروعك مختلف
// ==============================================

(function () {
    'use strict';

    /* ══════════════════════════════════════════════ */
    /* Firebase Configuration                          */
    /* ══════════════════════════════════════════════ */
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyCWh4rv__7DKqXUHXaPbNv4xGqJdoMbsCg",
        authDomain: "qamaralshamtest.firebaseapp.com",
        databaseURL: "https://qamaralshamtest-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "qamaralshamtest",
        storageBucket: "qamaralshamtest.firebasestorage.app",
        messagingSenderId: "204010808393",
        appId: "1:204010808393:web:6a83f5b179dcff44120b98"
    };

    /* ══════════════════════════════════════════════ */
    /* Initialize                                      */
    /* ══════════════════════════════════════════════ */
    let _auth = null;
    let _db = null;
    let _storage = null;
    let _ready = false;
    let _readyPromise = null;

    function _init() {
        if (typeof firebase === 'undefined') {
            console.error('[config] Firebase SDK not loaded');
            return false;
        }
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            _auth = firebase.auth();
            _db = firebase.database();
            _storage = firebase.storage();
            _ready = true;
            console.log('🔥 [config] Firebase initialized:', FIREBASE_CONFIG.projectId);
            return true;
        } catch (e) {
            console.error('[config] Firebase init failed:', e);
            return false;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Wait for ready (retries)                        */
    /* ══════════════════════════════════════════════ */
    function _waitReady(timeoutMs = 10000) {
        if (_readyPromise) return _readyPromise;
        _readyPromise = new Promise(function (resolve, reject) {
            if (_init()) { resolve(true); return; }
            const start = Date.now();
            const t = setInterval(function () {
                if (_init()) { clearInterval(t); resolve(true); return; }
                if (Date.now() - start > timeoutMs) {
                    clearInterval(t);
                    reject(new Error('Firebase timeout'));
                }
            }, 100);
        });
        return _readyPromise;
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.FIREBASE_CONFIG = FIREBASE_CONFIG;
    window.waitForFirebase = _waitReady;

    // Compatibility aliases (many modules expect `auth`, `db`, `storage`)
    Object.defineProperty(window, 'auth', {
        get: function () { return _auth; },
        configurable: true
    });
    Object.defineProperty(window, 'db', {
        get: function () { return _db; },
        configurable: true
    });
    Object.defineProperty(window, 'storage', {
        get: function () { return _storage; },
        configurable: true
    });

    // Immediate init attempt
    _init();

    console.log('📦 [config] loaded');
})();