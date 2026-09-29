/* ============================================================
   🌙 قمر الشام — room-picker.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarRoomPicker) return;

  var VERSION = '1.0';
  var St = { inited: false, currentRooms: [] };

  function $id(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getUid() {
    try {
      var A = window.QamarAuth;
      if (!A) return null;
      if (typeof A.getCurrentUser === 'function') {
        var u = A.getCurrentUser();
        if (u && u.uid) return u.uid;
      }
      if (A.currentUser) return A.currentUser.uid;
    } catch (e) {}
    return null;
  }

  function getRankLevel() {
    try {
      var I = window.QamarIdentity;
      if (I && typeof I.getRankLevel === 'function') return I.getRankLevel();
      if (I && typeof I.getUserRank === 'function') {
        var r = I.getUserRank();
        if (r && typeof r.level === 'number') return r.level;
      }
    } catch (e) {}
    return 50;
  }

  var DEFAULT_ROOMS = [
    { id: 'general', name: 'الروم العام', icon: '🌍', type: 'public', vision: 'all' },
    { id: 'quiz', name: 'روم المسابقات', icon: '🎯', type: 'public', vision: 'all' },
    { id: 'islamic', name: 'روم الإسلاميات', icon: '🕌', type: 'public', vision: 'all' },
    { id: 'royal', name: 'السويت الملكي', icon: '👑', type: 'private', vision: 'royal', maxUsers: 2 },
    { id: 'candy', name: 'كانديز', icon: '🍫', type: 'public', vision: 'all' },
    { id: 'studio', name: 'استديو التسجيل', icon: '🎙️', type: 'private', vision: 'owner+', maxUsers: 1 },
    { id: 'gaza', name: 'غزة العزة', icon: '🇵🇸', type: 'public', vision: 'all' },
    { id: 'sham', name: 'ليالي الشام', icon: '🌙', type: 'public', vision: 'all' }
  ];

  function canSee(room, user) {
    if (!room) return false;
    var lvl = user && typeof user.rankLevel === 'number' ? user.rankLevel : getRankLevel();
    var isJailed = user && user.isJailed;
    var v = room.vision || 'all';
    if (v === 'all') return true;
    if (v === 'king') return lvl >= 100;
    if (v === 'royal') return lvl >= 95;
    if (v === 'owner+') return lvl >= 75;
    if (v === 'grandowner+') return lvl >= 80;
    if (v === 'jailed') return !!isJailed;
    return true;
  }

  function buildList(rooms, user) {
    return rooms.filter(function (r) {
      if (r.invisible) return false;
      return canSee(r, user);
    }).map(function (r) {
      return {
        id: r.id,
        name: r.name,
        icon: r.icon || '💬',
        type: r.type || 'public',
        subtitle: r.type === 'private' ? 'غرفة خاصة' :
                 (r.type === 'hidden' ? 'مخفية' : 'غرفة عامة'),
        online: 0,
        maxUsers: r.maxUsers || null,
        raw: r
      };
    });
  }

  function fetchRooms() {
    return new Promise(function (resolve) {
      var rooms = DEFAULT_ROOMS.slice();
      try {
        var db = window.firebase && window.firebase.apps && window.firebase.apps.length ?
                 window.firebase.database() : null;
        if (!db) { resolve(rooms); return; }

        db.ref('custom_rooms').once('value').then(function (snap) {
          var val = snap && snap.val ? snap.val() : null;
          if (val && typeof val === 'object') {
            Object.keys(val).forEach(function (k) {
              var r = val[k];
              if (!r || typeof r !== 'object') return;
              rooms.push({
                id: k,
                name: r.name || 'غرفة',
                icon: r.icon || '💬',
                type: r.type || 'public',
                vision: r.vision || 'all',
                maxUsers: r.maxUsers || null,
                invisible: !!r.invisible
              });
            });
          }
          resolve(rooms);
        }, function () { resolve(rooms); });
      } catch (e) { resolve(rooms); }
    });
  }

  function fetchOnlineCounts(roomIds) {
    return new Promise(function (resolve) {
      var counts = {};
      try {
        var db = window.firebase && window.firebase.apps && window.firebase.apps.length ?
                 window.firebase.database() : null;
        if (!db) { resolve(counts); return; }

        var pending = roomIds.length;
        if (!pending) { resolve(counts); return; }

        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          resolve(counts);
        }, 2500);

        roomIds.forEach(function (id) {
          db.ref('room_members/' + id).once('value').then(function (snap) {
            var val = snap && snap.val ? snap.val() : {};
            counts[id] = val ? Object.keys(val).length : 0;
            pending--;
            if (pending === 0 && !done) {
              done = true;
              clearTimeout(timer);
              resolve(counts);
            }
          }, function () {
            pending--;
            if (pending === 0 && !done) {
              done = true;
              clearTimeout(timer);
              resolve(counts);
            }
          });
        });
      } catch (e) { resolve(counts); }
    });
  }

  function getCurrentRoom() {
    try {
      var R = window.QamarRooms;
      if (R) {
        if (typeof R.getCurrentRoom === 'function') return R.getCurrentRoom();
        if (R.current && R.current.id) return R.current;
      }
      if (window.QamarState && window.QamarState.room) return window.QamarState.room;
    } catch (e) {}
    return null;
  }

  function switchRoom(roomId) {
    try {
      var R = window.QamarRooms;
      if (R && typeof R.switchRoom === 'function') {
        return R.switchRoom(roomId);
      }
      if (R && typeof R.join === 'function') {
        return R.join(roomId);
      }
    } catch (e) {}
    try {
      if (window.EventBus && window.EventBus.emit) {
        window.EventBus.emit('room:switch-request', { roomId: roomId });
        return true;
      }
    } catch (e) {}
    return false;
  }

  function render(rooms, counts) {
    var list = $id('rooms-list');
    if (!list) return;

    if (!rooms.length) {
      list.innerHTML =
        '<div style="text-align:center;padding:40px 20px;color:#6b7280">' +
          '<div style="font-size:44px;margin-bottom:12px">🚪</div>' +
          '<div style="font-size:13px">لا توجد غرف متاحة</div>' +
        '</div>';
      return;
    }

    var current = getCurrentRoom();
    var currentId = current && current.id;

    var html = rooms.map(function (r) {
      var isCurrent = r.id === currentId;
      var online = counts[r.id] || 0;
      var onlineText = online + ' متصل';
      if (r.maxUsers) onlineText = online + '/' + r.maxUsers;

      var border = isCurrent ? 'rgba(212,175,55,.6)' : 'rgba(255,255,255,.06)';
      var bg = isCurrent ? 'rgba(212,175,55,.1)' : 'transparent';

      return '<div class="room-item" data-room-id="' + esc(r.id) + '" ' +
        'style="display:flex;align-items:center;gap:12px;padding:12px;' +
        'border-radius:12px;border:1px solid ' + border + ';' +
        'background:' + bg + ';margin-bottom:8px;cursor:pointer;' +
        'transition:transform .15s ease">' +
        '<div style="font-size:28px;width:40px;height:40px;' +
          'display:flex;align-items:center;justify-content:center;' +
          'background:rgba(255,255,255,.05);border-radius:50%">' +
          esc(r.icon) +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14px;font-weight:900;color:#f3f4f6;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
            esc(r.name) + (isCurrent ? ' • الحالية' : '') +
          '</div>' +
          '<div style="font-size:11px;color:#9ca3af;margin-top:2px">' +
            esc(r.subtitle) + ' • ' + onlineText +
          '</div>' +
        '</div>' +
        (isCurrent
          ? '<div style="font-size:11px;color:#d4af37;font-weight:900">داخل</div>'
          : '<i class="fas fa-chevron-left" style="color:#6b7280;font-size:12px"></i>') +
      '</div>';
    }).join('');

    list.innerHTML = html;

    list.querySelectorAll('.room-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-room-id');
        if (!id) return;
        var cur = getCurrentRoom();
        if (cur && cur.id === id) {
          try { if (window.QamarSidebar && window.QamarSidebar.close) window.QamarSidebar.close(); } catch (e) {}
          return;
        }
        var ok = switchRoom(id);
        if (ok !== false) {
          try { if (window.QamarSidebar && window.QamarSidebar.close) window.QamarSidebar.close(); } catch (e) {}
        }
      });
    });
  }

  function refresh() {
    var uid = getUid();
    fetchRooms().then(function (rooms) {
      var filtered = buildList(rooms, null);
      St.currentRooms = filtered;
      var ids = filtered.map(function (r) { return r.id; });
      fetchOnlineCounts(ids).then(function (counts) {
        render(filtered, counts);
      });
    });
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    document.addEventListener('click', function (e) {
      var nav = e.target.closest && e.target.closest('[data-nav="rooms"]');
      if (nav) {
        setTimeout(refresh, 80);
        return;
      }
    });

    var list = $id('rooms-list');
    if (list) {
      var sb = list.closest('.sidebar');
      if (sb) {
        var closeBtn = sb.querySelector('.sidebar-close');
        // already handled by sidebar.js
      }
    }

    try {
      if (window.EventBus && window.EventBus.on) {
        window.EventBus.on('room:changed', function () {
          if (window.QamarSidebar && window.QamarSidebar.current &&
              window.QamarSidebar.current() === 'sidebar-rooms') {
            refresh();
          }
        });
      }
    } catch (e) {}

    console.log('[room-picker] v' + VERSION + ' ready');
  }

  window.QamarRoomPicker = {
    version: VERSION,
    refresh: refresh,
    open: function () {
      if (window.QamarSidebar && window.QamarSidebar.open) {
        window.QamarSidebar.open('sidebar-rooms');
      }
      setTimeout(refresh, 60);
    },
    getRooms: function () { return St.currentRooms.slice(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 150);
  }
})();
