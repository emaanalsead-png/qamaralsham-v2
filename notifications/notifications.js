/* ============================================================
   🌙 قمر الشام — notifications/notifications.js
   Version: 3.0
   نظام الإشعارات اللحظية — متوافق مع:
     • firebase.database() [compat]
     • QamarAuth.getCurrentUser() / onAuthChange()
     • EventBus (اختياري)
     • HTML: #notif-slot, #notif-badge, #sidebar-notifications,
             #notifications-list, #sidebar-backdrop
   ============================================================ */
(function () {
  'use strict';

  if (window.QamarNotifications) {
    console.warn('[notifications] already loaded');
    return;
  }

  var VERSION = '3.0';
  var MAX_KEEP = 100;
  var SIDEBAR_ID = 'sidebar-notifications';
  var LIST_ID = 'notifications-list';
  var BELL_ID = 'notif-slot';
  var BADGE_ID = 'notif-badge';
  var BACKDROP_ID = 'sidebar-backdrop';

  var TYPES = {
    ban:             { icon: '🚫', color: '#ef4444', label: 'حظر' },
    unban:           { icon: '✅', color: '#84cc16', label: 'فك حظر' },
    jail:            { icon: '⛓️', color: '#ef4444', label: 'سجن' },
    release:         { icon: '🔓', color: '#84cc16', label: 'إفراج' },
    warn:            { icon: '⚠️', color: '#f59e0b', label: 'تحذير' },
    mute:            { icon: '🔇', color: '#f59e0b', label: 'كتم' },
    unmute:          { icon: '🔊', color: '#84cc16', label: 'فك كتم' },
    promote:         { icon: '🎖️', color: '#d4af37', label: 'ترقية' },
    demote:          { icon: '📉', color: '#f59e0b', label: 'تخفيض' },
    gift:            { icon: '🎁', color: '#a855f7', label: 'هدية نقاط' },
    mic_kick:        { icon: '🎤', color: '#ef4444', label: 'طرد من المايك' },
    room_kick:       { icon: '🚪', color: '#ef4444', label: 'طرد من الغرفة' },
    transfer:        { icon: '🔀', color: '#3b82f6', label: 'نقل لغرفة' },
    report_sent:     { icon: '🚨', color: '#f59e0b', label: 'إبلاغ مُرسل' },
    report_resolved: { icon: '✅', color: '#84cc16', label: 'تم حل الإبلاغ' },
    guardian_inbox:  { icon: '🚨', color: '#ef4444', label: 'تنبيه سجان' },
    guardian_alert:  { icon: '⚠️', color: '#ef4444', label: 'إنذار أمني' },
    multi_account:   { icon: '👥', color: '#a855f7', label: 'حساب مكرر' },
    story_reply:     { icon: '💬', color: '#06b6d4', label: 'رد على حالتك' },
    story_reaction:  { icon: '❤️', color: '#ff69b4', label: 'تفاعل' },
    pm:              { icon: '✉️', color: '#3b82f6', label: 'رسالة خاصة' },
    like:            { icon: '❤️', color: '#ff69b4', label: 'إعجاب' },
    visitor:         { icon: '👁️', color: '#6b7280', label: 'زيارة' },
    friend_request:  { icon: '👥', color: '#84cc16', label: 'طلب صداقة' },
    system:          { icon: '📢', color: '#d4af37', label: 'نظام' },
    info:            { icon: 'ℹ️', color: '#3b82f6', label: 'معلومة' },
    success:         { icon: '✅', color: '#84cc16', label: 'نجاح' },
    error:           { icon: '❌', color: '#ef4444', label: 'خطأ' }
  };

  var St = {
    uid: null,
    items: [],
    unread: 0,
    firstLoad: true,
    lastUnread: 0,
    lastSoundAt: 0,
    sidebarOpen: false,
    unsubRef: null,
    inited: false
  };

  /* ==================== Helpers ==================== */

  function $id(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 30) return 'الآن';
    if (s < 60) return 'قبل ' + s + 'ث';
    var m = Math.floor(s / 60);
    if (m < 60) return 'قبل ' + m + 'د';
    var h = Math.floor(m / 60);
    if (h < 24) return 'قبل ' + h + 'س';
    var d = Math.floor(h / 24);
    if (d < 7) return 'قبل ' + d + 'ي';
    try { return new Date(ts).toLocaleDateString('ar-EG'); } catch (e) { return ''; }
  }

  function typeInfo(t) {
    return TYPES[t] || { icon: '🔔', color: '#d4af37', label: 'إشعار' };
  }

  /* ==================== Firebase ==================== */

  function getDb() {
    try {
      if (window.firebase && window.firebase.apps &&
          window.firebase.apps.length > 0 &&
          typeof window.firebase.database === 'function') {
        return window.firebase.database();
      }
    } catch (e) {}
    return null;
  }

  function refPath(path) {
    var db = getDb();
    return db ? db.ref(path) : null;
  }

  /* ==================== Auth ==================== */

  function getUid() {
    try {
      var A = window.QamarAuth;
      if (!A) return null;
      if (typeof A.getCurrentUser === 'function') {
        var u = A.getCurrentUser();
        if (u && u.uid) return u.uid;
      }
      if (A.currentUser && A.currentUser.uid) return A.currentUser.uid;
    } catch (e) {}
    return null;
  }

  function watchAuth(cb) {
    try {
      var A = window.QamarAuth;
      if (A && typeof A.onAuthChange === 'function') {
        A.onAuthChange(function (user) {
          cb(user && user.uid ? { uid: user.uid } : null);
        });
        return;
      }
    } catch (e) {}
    var last = '__init__';
    setInterval(function () {
      var u = getUid();
      if (u !== last) { last = u; cb(u ? { uid: u } : null); }
    }, 1200);
  }

  /* ==================== Sound & Toast ==================== */

  function playSound() {
    var now = Date.now();
    if (now - St.lastSoundAt < 2500) return;
    St.lastSoundAt = now;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.32);
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 600);
    } catch (e) {}
  }

  function toast(msg, kind) {
    try {
      if (window.EventBus && typeof window.EventBus.emit === 'function') {
        window.EventBus.emit('toast:show', { message: msg, kind: kind || 'info' });
        return;
      }
    } catch (e) {}
    // minimal fallback
    try {
      var el = document.createElement('div');
      el.textContent = msg;
      el.style.cssText =
        'position:fixed;top:20px;right:20px;background:#0a0616;color:#f3f4f6;' +
        'padding:12px 18px;border-radius:12px;border:1px solid rgba(212,175,55,.4);' +
        'z-index:99999;font-size:13px;font-family:inherit;box-shadow:0 8px 24px rgba(0,0,0,.6);' +
        'max-width:80vw';
      document.body.appendChild(el);
      setTimeout(function () { try { el.remove(); } catch (e) {} }, 3200);
    } catch (e) {}
  }

  /* ==================== Badge ==================== */

  function updateBadge() {
    var badge = $id(BADGE_ID);
    if (!badge) return;
    if (St.unread > 0) {
      badge.textContent = St.unread > 99 ? '99+' : String(St.unread);
      badge.classList.remove('hidden');
      badge.style.display = '';
    } else {
      badge.classList.add('hidden');
      badge.style.display = '';
    }
  }

  /* ==================== Sidebar ==================== */

  function ensureActions() {
    var sb = $id(SIDEBAR_ID);
    if (!sb) return;
    if (sb.querySelector('.qns-actions')) return;
    var header = sb.querySelector('.sidebar-header');
    if (!header) return;

    var actions = document.createElement('div');
    actions.className = 'qns-actions';
    actions.style.cssText =
      'display:flex;gap:6px;padding:8px 10px;' +
      'border-bottom:1px solid rgba(255,255,255,.06)';
    actions.innerHTML =
      '<button type="button" class="qns-mark-all" style="flex:1;padding:8px 10px;' +
        'border-radius:8px;border:1px solid rgba(255,255,255,.1);' +
        'background:transparent;color:#9ca3af;font-size:11px;font-weight:700;' +
        'cursor:pointer;font-family:inherit">✓ تحديد الكل</button>' +
      '<button type="button" class="qns-clear-all" style="flex:1;padding:8px 10px;' +
        'border-radius:8px;border:1px solid rgba(239,68,68,.3);' +
        'background:transparent;color:#ef4444;font-size:11px;font-weight:700;' +
        'cursor:pointer;font-family:inherit">🗑️ مسح الكل</button>';

    header.parentNode.insertBefore(actions, header.nextSibling);

    actions.querySelector('.qns-mark-all').addEventListener('click', markAllRead);
    actions.querySelector('.qns-clear-all').addEventListener('click', clearAll);
  }

  function renderList() {
    var list = $id(LIST_ID);
    if (!list) return;

    if (!St.items.length) {
      list.innerHTML =
        '<div style="text-align:center;padding:48px 20px;color:#6b7280">' +
          '<div style="font-size:48px;margin-bottom:12px">🔕</div>' +
          '<div style="font-size:13px">لا توجد إشعارات</div>' +
        '</div>';
      return;
    }

    var html = St.items.map(function (n) {
      var t = typeInfo(n.type);
      var unread = !n.read;
      return '<div class="notif-item" data-id="' + esc(n.id) + '" ' +
        'style="padding:10px 12px;border-radius:12px;' +
          'background:' + (unread ? 'rgba(212,175,55,.08)' : 'transparent') + ';' +
          'border-inline-end:3px solid ' + (unread ? '#d4af37' : 'transparent') + ';' +
          'margin-bottom:6px;cursor:pointer;display:flex;gap:10px;align-items:flex-start">' +
        '<div style="font-size:22px;line-height:1;flex-shrink:0">' + t.icon + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:12px;font-weight:900;color:' + t.color + ';margin-bottom:2px">' +
            esc(n.title || t.label) + '</div>' +
          '<div style="font-size:12px;color:#f3f4f6;line-height:1.5;word-break:break-word">' +
            esc(n.body || '') + '</div>' +
          '<div style="font-size:10px;color:#6b7280;margin-top:4px">' +
            esc(timeAgo(n.createdAt)) + '</div>' +
        '</div>' +
        (unread ? '<div style="width:8px;height:8px;border-radius:50%;' +
          'background:#ef4444;flex-shrink:0;margin-top:4px"></div>' : '') +
      '</div>';
    }).join('');

    list.innerHTML = html;
  }

  function openSidebar() {
    var sb = $id(SIDEBAR_ID);
    var bd = $id(BACKDROP_ID);
    if (!sb) return;
    sb.classList.add('active', 'open');
    sb.style.transform = 'translateX(0)';
    sb.style.right = '0';
    sb.style.visibility = 'visible';
    sb.style.pointerEvents = 'auto';
    if (bd) {
      bd.classList.remove('hidden');
      bd.style.display = 'block';
      bd.style.opacity = '1';
      bd.style.pointerEvents = 'auto';
    }
    St.sidebarOpen = true;
    renderList();
  }

  function closeSidebar() {
    var sb = $id(SIDEBAR_ID);
    var bd = $id(BACKDROP_ID);
    if (sb) {
      sb.classList.remove('active', 'open');
      sb.style.transform = '';
      sb.style.right = '';
      sb.style.visibility = '';
      sb.style.pointerEvents = '';
    }
    if (bd) {
      bd.classList.add('hidden');
      bd.style.display = '';
      bd.style.opacity = '';
      bd.style.pointerEvents = '';
    }
    St.sidebarOpen = false;
  }

  function toggleSidebar() {
    if (St.sidebarOpen) closeSidebar(); else openSidebar();
  }

  /* ==================== Actions ==================== */

  function markRead(id) {
    var n = null;
    for (var i = 0; i < St.items.length; i++) {
      if (St.items[i].id === id) { n = St.items[i]; break; }
    }
    if (!n || n.read) return;
    n.read = true;
    St.unread = St.items.filter(function (x) { return !x.read; }).length;
    St.lastUnread = St.unread;
    updateBadge();
    renderList();
    var r = refPath('notifications/' + St.uid + '/' + id);
    if (r) {
      try { r.update({ read: true, readAt: Date.now() }); } catch (e) {}
    }
  }

  function markAllRead() {
    if (!St.items.length) return;
    St.items.forEach(function (n) { n.read = true; });
    St.unread = 0;
    St.lastUnread = 0;
    updateBadge();
    renderList();
    var patch = {};
    St.items.forEach(function (n) {
      patch['notifications/' + St.uid + '/' + n.id + '/read'] = true;
    });
    var r = refPath('');
    if (r) {
      try { r.update(patch); } catch (e) {}
    }
  }

  function clearAll() {
    if (!St.items.length) return;
    if (window.confirm && !window.confirm('مسح كل الإشعارات؟')) return;
    var ids = St.items.map(function (n) { return n.id; });
    St.items = [];
    St.unread = 0;
    St.lastUnread = 0;
    updateBadge();
    renderList();
    ids.forEach(function (id) {
      var r = refPath('notifications/' + St.uid + '/' + id);
      if (r) { try { r.remove(); } catch (e) {} }
    });
  }

  function handleItemClick(id) {
    var n = null;
    for (var i = 0; i < St.items.length; i++) {
      if (St.items[i].id === id) { n = St.items[i]; break; }
    }
    if (!n) return;
    if (!n.read) markRead(id);
    try {
      if (window.EventBus && window.EventBus.emit) {
        window.EventBus.emit('notification:clicked', n);
      }
    } catch (e) {}
    var link = n.link || (n.data && n.data.link);
    if (link) {
      try { window.location.href = link; } catch (e) {}
    }
  }

  /* ==================== Firebase listener ==================== */

  function normalize(raw, id) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: id,
      type: raw.type || 'info',
      title: raw.title || '',
      body: raw.body || raw.message || raw.text || '',
      createdAt: raw.createdAt || raw.at || raw.ts || raw.time || 0,
      read: !!raw.read,
      from: raw.from || raw.by || null,
      fromName: raw.fromName || raw.byName || '',
      link: raw.link || null,
      data: raw.data || null
    };
  }

  function applyItems(map) {
    var arr = [];
    Object.keys(map || {}).forEach(function (k) {
      var n = normalize(map[k], k);
      if (n) arr.push(n);
    });
    arr.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    if (arr.length > MAX_KEEP) arr.length = MAX_KEEP;

    St.items = arr;
    St.unread = arr.filter(function (x) { return !x.read; }).length;

    var increased = !St.firstLoad && St.unread > St.lastUnread;
    St.lastUnread = St.unread;
    St.firstLoad = false;

    updateBadge();
    renderList();

    if (increased) {
      var latest = arr[0];
      if (latest) {
        playSound();
        var t = typeInfo(latest.type);
        toast(t.icon + ' ' + (latest.title || latest.body || t.label), 'info');
      }
    }
  }

  function attachListeners(uid) {
    var r = refPath('notifications/' + uid);
    if (!r) {
      setTimeout(function () { attachListeners(uid); }, 500);
      return;
    }
    var cb = function (snap) {
      var val = snap && snap.val ? snap.val() : {};
      applyItems(val || {});
    };
    var errCb = function (err) { console.warn('[notifications] read error', err); };
    try {
      r.on('value', cb, errCb);
      St.unsubRef = function () {
        try { r.off('value', cb); } catch (e) {}
      };
    } catch (e) {
      console.warn('[notifications] attach failed', e);
      setTimeout(function () { attachListeners(uid); }, 800);
    }
  }

  function detachListeners() {
    if (St.unsubRef) { try { St.unsubRef(); } catch (e) {} }
    St.unsubRef = null;
    St.items = [];
    St.unread = 0;
    St.lastUnread = 0;
    St.firstLoad = true;
    updateBadge();
    renderList();
  }

  /* ==================== Public API ==================== */

  function pushLocal(n) {
    if (!n || !n.type) return null;
    var id = 'local_' + Date.now().toString(36) + '_' +
             Math.random().toString(36).slice(2, 6);
    var item = normalize(Object.assign({ createdAt: Date.now() }, n), id);
    if (!item) return null;
    St.items.unshift(item);
    if (St.items.length > MAX_KEEP) St.items.length = MAX_KEEP;
    St.unread = St.items.filter(function (x) { return !x.read; }).length;
    St.lastUnread = St.unread;
    updateBadge();
    renderList();
    if (!item.read) {
      playSound();
      var t = typeInfo(item.type);
      toast(t.icon + ' ' + (item.title || item.body || t.label), 'info');
    }
    return item;
  }

  /* ==================== Init ==================== */

  function init() {
    if (St.inited) return;
    St.inited = true;

    ensureActions();

    // Bell button
    var bell = $id(BELL_ID);
    if (bell) {
      bell.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar();
      });
    }

    // Bottom nav notifications
    var navBtns = document.querySelectorAll('[data-nav="notifications"]');
    for (var i = 0; i < navBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          setTimeout(openSidebar, 60);
        });
      })(navBtns[i]);
    }

    // Close button inside our sidebar
    var sb = $id(SIDEBAR_ID);
    if (sb) {
      var closeBtn = sb.querySelector('.sidebar-close');
      if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

      // Item delegation
      var list = $id(LIST_ID);
      if (list && !list.dataset.qnsHooked) {
        list.dataset.qnsHooked = '1';
        list.addEventListener('click', function (e) {
          var item = e.target && e.target.closest && e.target.closest('.notif-item');
          if (!item) return;
          handleItemClick(item.getAttribute('data-id'));
        });
      }
    }

    // Backdrop
    var bd = $id(BACKDROP_ID);
    if (bd && !bd.dataset.qnsHooked) {
      bd.dataset.qnsHooked = '1';
      bd.addEventListener('click', closeSidebar);
    }

    // EventBus push
    try {
      if (window.EventBus && typeof window.EventBus.on === 'function') {
        window.EventBus.on('notification:push', pushLocal);
      }
    } catch (e) {}

    // Auth watch
    watchAuth(function (user) {
      if (user && user.uid) {
        if (St.uid === user.uid) return;
        detachListeners();
        St.uid = user.uid;
        attachListeners(user.uid);
      } else {
        detachListeners();
        St.uid = null;
      }
    });

    // Immediate check (in case auth already done)
    var uid = getUid();
    if (uid && uid !== St.uid) {
      St.uid = uid;
      attachListeners(uid);
    }

    updateBadge();
    renderList();

    console.log('[notifications] v' + VERSION + ' ready');
  }

  window.QamarNotifications = {
    version: VERSION,
    init: init,
    open: openSidebar,
    close: closeSidebar,
    toggle: toggleSidebar,
    list: function () { return St.items.slice(); },
    unread: function () { return St.unread; },
    markRead: markRead,
    markAllRead: markAllRead,
    clearAll: clearAll,
    push: pushLocal,
    types: TYPES
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 100);
  }
})();
