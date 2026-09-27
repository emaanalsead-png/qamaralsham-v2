// ==============================================
// core/state.js
// Global state + Event Bus
// ==============================================

(function () {
    'use strict';

    /* ══════════════════════════════════════════════ */
    /* Event Bus — simple pub/sub                      */
    /* ══════════════════════════════════════════════ */
    const _listeners = {};

    const EventBus = {
        on: function (event, handler) {
            if (!_listeners[event]) _listeners[event] = [];
            _listeners[event].push(handler);
            return function off() { EventBus.off(event, handler); };
        },
        once: function (event, handler) {
            const off = EventBus.on(event, function () {
                off();
                handler.apply(null, arguments);
            });
            return off;
        },
        off: function (event, handler) {
            if (!_listeners[event]) return;
            if (!handler) { delete _listeners[event]; return; }
            _listeners[event] = _listeners[event].filter(function (h) { return h !== handler; });
        },
        emit: function (event) {
            const args = Array.prototype.slice.call(arguments, 1);
            if (!_listeners[event]) return;
            _listeners[event].slice().forEach(function (h) {
                try { h.apply(null, args); }
                catch (e) { console.warn('[EventBus] handler error for', event, e); }
            });
        },
        clear: function (event) {
            if (event) delete _listeners[event];
            else Object.keys(_listeners).forEach(function (k) { delete _listeners[k]; });
        }
    };

    /* ══════════════════════════════════════════════ */
    /* App State                                       */
    /* ══════════════════════════════════════════════ */
    const AppState = {
        user: null,          // current user object
        isGuest: false,
        currentRoom: 'general',
        presence: null,
        invisible: false,

        // Firebase listeners registry
        listeners: {},

        // Rate limiting
        lastMessageTime: 0,
        lastPrivateMessageTime: 0,

        // Session timing
        bootAt: Date.now(),

        /* ═══ User Management ═══ */
        setUser: function (user, isGuest) {
            this.user = user;
            this.isGuest = !!isGuest;
            EventBus.emit('user:set', user, this.isGuest);
            EventBus.emit('user:changed', user);
        },
        clearUser: function () {
            this.user = null;
            this.isGuest = false;
            EventBus.emit('user:cleared');
            EventBus.emit('user:changed', null);
        },
        getUser: function () {
            if (this.user) return this.user;
            // fallback to localStorage
            try {
                const raw = localStorage.getItem('qamar_current_user') || localStorage.getItem('qamar_user');
                if (raw) {
                    this.user = JSON.parse(raw);
                    this.isGuest = this.user.isGuest === true;
                    return this.user;
                }
            } catch (e) {}
            return null;
        },
        isKing: function () {
            const u = this.getUser();
            return !!(u && u.rank === 'King');
        },
        isQueen: function () {
            const u = this.getUser();
            return !!(u && u.rank === 'Queen');
        },
        isRoyal: function () {
            return this.isKing() || this.isQueen();
        },

        /* ═══ Room Management ═══ */
        setRoom: function (roomId) {
            const prev = this.currentRoom;
            this.currentRoom = roomId;
            try { localStorage.setItem('qamar_last_room', roomId); } catch (e) {}
            if (prev !== roomId) EventBus.emit('room:changed', roomId, prev);
        },
        getRoom: function () {
            return this.currentRoom;
        },

        /* ═══ Listener Registry ═══ */
        registerListener: function (key, ref) {
            this.listeners[key] = ref;
        },
        unregisterListener: function (key) {
            const ref = this.listeners[key];
            if (ref && typeof ref.off === 'function') {
                try { ref.off(); } catch (e) {}
            }
            delete this.listeners[key];
        },
        cleanupListeners: function () {
            Object.keys(this.listeners).forEach(function (k) {
                const ref = this.listeners[k];
                if (ref && typeof ref.off === 'function') {
                    try { ref.off(); } catch (e) {}
                }
            });
            this.listeners = {};
            EventBus.emit('listeners:cleaned');
        },

        /* ═══ Reset (on logout) ═══ */
        reset: function () {
            this.cleanupListeners();
            this.clearUser();
            this.presence = null;
            this.invisible = false;
            EventBus.emit('state:reset');
        }
    };

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.EventBus = EventBus;
    window.AppState = AppState;

    // Compatibility aliases (many old modules use these)
    window.getCurrentUser = function () { return AppState.getUser(); };
    window.iAmKing = function () { return AppState.isKing(); };
    window.iAmQueen = function () { return AppState.isQueen(); };
    window.iAmRoyal = function () { return AppState.isRoyal(); };
    window.isGuest = function () { return AppState.isGuest; };

    console.log('📦 [state] loaded');
})();
