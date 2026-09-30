/* profile-core.js — v2 modules via parent */
(function () {
  'use strict';

  var S = {
    me: null, subject: null, uid: null,
    mode: 'owner', isAdmin: false,
    collapsed: false, presence: null,
    liveUnsubs: []
  };

  function P(name) {
    try { return window.parent && window.parent[name]; } catch (e) { return null; }
  }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rankLevel(r) {
    var R = P('QamarRanks');
    if (R && typeof R.getRankLevel === 'function') return R.getRankLevel(r);
    var map = { King: 100, Queen: 95, 'Master Owner': 90, 'Room Owner': 85, 'Grand Owner': 80, Owner: 75, 'Super Admin': 70, Admin: 65, Premium: 60, User: 50 };
    return typeof r === 'number' ? r : (map[r] || 0);
  }
  function rankIcon(r) {
    var m = { King: '👑', Queen: '👸', 'Master Owner': '🌟', 'Room Owner': '🛡️', 'Grand Owner': '💎', Owner: '🏆', 'Super Admin': '🎖️', Admin: '🛠️', Premium: '💠', User: '👤' };
    return m[r] || '👤';
  }
  function roomInfo(id) {
    if (!id) return null;
    var R = P('QamarRooms');
    if (R && typeof R.getById === 'function') {
      try { var r = R.getById(id); if (r) return r; } catch (e) {}
    }
    var map = {
      general: { icon: '🌍', name: 'الروم العام' },
      quiz: { icon: '🎯', name: 'روم المسابقات' },
      islamic: { icon: '🕌', name: 'روم الإسلاميات' },
      royal: { icon: '👑', name: 'السويت الملكي' },
      candy: { icon: '🍫', name: 'كانديز' },
      studio: { icon: '🎙️', name: 'استديو' },
      gaza: { icon: '🇵🇸', name: 'غزة العزة' },
      sham: { icon: '🌙', name: 'ليالي الشام' },
      jail: { icon: '🚔', name: 'السجن' }
    };
    return map[id] || { icon: '🚪', name: id };
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch (e) { return '—'; }
  }
  function timeAgo(ts) {
    if (!ts) return '—';
    var d = Date.now() - ts;
    if (d < 60000) return 'الآن';
    var m = Math.floor(d / 60000); if (m < 60) return 'قبل ' + m + ' د';
    var h = Math.floor(m / 60); if (h < 24) return 'قبل ' + h + ' س';
    var dd = Math.floor(h / 24); if (dd < 30) return 'قبل ' + dd + ' ي';
    return fmtDate(ts);
  }
  function toast(msg) {
    try {
      if (window.parent && window.parent.EventBus && window.parent.EventBus.emit) {
        window.parent.EventBus.emit('toast:show', { message: msg, kind: 'info' });
        return;
      }
    } catch (e) {}
    console.log('[toast]', msg);
  }
  function FB() { return P('QamarFB'); }

  function fetchUser(uid) {
    var fb = FB();
    if (!fb || typeof fb.get !== 'function') return Promise.resolve(null);
    try {
      return fb.get('users/' + uid).then(function (u) {
        if (u && typeof u === 'object') u.uid = uid;
        return u || null;
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function fetchPoints(uid) {
    var fb = FB();
    if (!fb || typeof fb.get !== 'function') return Promise.resolve(0);
    try {
      return fb.get('bot_data/quiz/scores/' + uid).then(function (v) {
        return (v && Number(v.points)) || Number(v) || 0;
      }).catch(function () { return 0; });
    } catch (e) { return Promise.resolve(0); }
  }

  function applyNameEffects(el, user) {
    if (!el) return;
    var NM = P('QamarNameEffects');
    el.style.color = '';
    el.style.background = '';
    el.style.backgroundImage = '';
    el.style.webkitTextFillColor = '';
    el.style.textShadow = '';
    el.classList.remove('shimmer');

    if (!NM || typeof NM.apply !== 'function') {
      el.style.color = user.color || user.nameColor || '#fff';
      return;
    }
    var cfg = null;
    if (user.nameEffects && user.nameEffects.mode) cfg = user.nameEffects;
    else if (Array.isArray(user.nameGradient) && user.nameGradient.length === 2) {
      cfg = { mode: 'gradient', c1: user.nameGradient[0], c2: user.nameGradient[1], c3: user.nameGradient[1] };
    }
    else if (user.nameColor) cfg = { mode: 'solid', value: user.nameColor };
    else { el.style.color = user.color || '#ffd700'; return; }
    try { NM.apply(el, cfg); }
    catch (e) { el.style.color = user.color || user.nameColor || '#fff'; }
  }

  function applyFrame(user) {
    var av = $id('profile-avatar-img');
    var FR = P('QamarFrames');
    if (!av || !FR) return;
    var frame = user.avatarFrame;
    if (!frame && typeof FR.defaultForRank === 'function') frame = FR.defaultForRank(rankLevel(user.rank));
    if (!frame) return;
    try { FR.apply(av, frame); } catch (e) {}
  }

  function applyGlow(user) {
    var c = $id('profile-container');
    if (!c) return;
    if (user.profileGlow) {
      c.style.setProperty('--glow', user.profileGlow);
      c.classList.add('glow-active');
    } else {
      c.classList.remove('glow-active');
      c.style.removeProperty('--glow');
    }
  }

  function renderCover(user) {
    var img = $id('profile-cover-img');
    if (!img) return;
    if (user.cover && user.coverType !== 'color' && user.coverType !== 'gradient') {
      img.src = user.cover;
      img.style.display = 'block';
    } else {
      img.style.display = 'none';
      img.removeAttribute('src');
    }
  }

  function applyBackground(user) {
    var layer = $id('profile-bg-layer');
    if (!layer) return;
    layer.innerHTML = '';
    layer.style.backgroundImage = '';
    layer.style.background = '';
    if (!user.profileBgType || !user.profileBgValue) return;
    if (user.profileBgType === 'color') layer.style.background = user.profileBgValue;
    else if (user.profileBgType === 'image') {
      layer.style.backgroundImage = 'url("' + user.profileBgValue + '")';
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
    }
  }

  function renderHeader(user) {
    var nameEl = $id('profile-username');
    if (nameEl) {
      nameEl.textContent = user.name || 'مستخدم';
      applyNameEffects(nameEl, user);
    }
    var bioEl = $id('profile-bio');
    if (bioEl) bioEl.textContent = user.bio || '❋ نجوم الشام ❋';
    var roleEl = $id('role-text');
    if (roleEl) roleEl.textContent = rankIcon(user.rank) + ' ' + (user.rank || 'User');
  }

  function renderAvatar(user) {
    var img = $id('profile-avatar-img');
    if (!img) return;
    img.src = user.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name || 'U') + '&background=1a1a2e&color=d4af37&size=200&bold=true');
  }

  function renderInfo(user) {
    var grid = $id('info-grid');
    if (!grid) return;
    var items = [];
    if (user.uid) items.push({ i: '🆔', l: 'UID', v: user.uid, copy: 'UID' });
    if (user.code) items.push({ i: '🔑', l: 'المعرّف', v: user.code, copy: 'الكود' });
    if (user.country) items.push({ i: '🌍', l: 'الدولة', v: user.country });
    if (user.family) items.push({ i: '👨‍👩‍👧', l: 'العائلة', v: user.family });
    if (user.age) items.push({ i: '🎂', l: 'العمر', v: user.age + ' سنة' });
    if (user.gender) items.push({ i: '👤', l: 'الجنس', v: user.gender === 'male' ? 'ذكر' : (user.gender === 'female' ? 'أنثى' : 'آخر') });
    if (user.createdAt) items.push({ i: '📅', l: 'الانضمام', v: fmtDate(user.createdAt) });

    var p = S.presence || {};
    var isOnline = p.state === 'online' && (Date.now() - (p.lastChanged || 0)) < 120000;
    var lastSeenText = isOnline ? '🟢 متصل الآن' : (user.lastSeen ? timeAgo(user.lastSeen) : '—');
    items.push({ i: '🕐', l: 'آخر تواجد', v: lastSeenText, key: 'lastSeen' });

    var roomId = p.room || user.currentRoom;
    if (roomId) {
      var ri = roomInfo(roomId);
      items.push({ i: '📍', l: 'مكان التواجد', v: ri.icon + ' ' + ri.name, key: 'room' });
    }

    if (!items.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#666;padding:12px;font-size:12px">لا معلومات</div>';
      return;
    }
    grid.innerHTML = '';
    items.forEach(function (it) {
      var div = document.createElement('div');
      div.className = 'info-item';
      if (it.key) div.dataset.info = it.key;
      div.innerHTML = '<div class="ii-label">' + it.i + ' ' + it.l + '</div>' +
        '<div class="ii-value">' + esc(it.v) + '</div>' +
        (it.copy ? '<button class="ii-copy" type="button">📋</button>' : '');
      if (it.copy) {
        div.querySelector('.ii-copy').onclick = function (e) {
          e.stopPropagation();
          copyText(it.v, it.copy);
        };
      }
      grid.appendChild(div);
    });
  }

  function renderStats(uid, points) {
    var fb = FB();
    if (fb && typeof fb.get === 'function') {
      fb.get('users/' + uid + '/likes').then(function (s) {
        var el = $id('stat-likes'); if (el) el.textContent = s ? Object.keys(s).length : 0;
      }).catch(function () {});
      fb.get('users/' + uid + '/friends').then(function (s) {
        var v = s || {};
        var n = Object.keys(v).filter(function (k) { return v[k] && v[k].status === 'accepted'; }).length;
        var el = $id('stat-friends'); if (el) el.textContent = n;
      }).catch(function () {});
    }
    var el = $id('stat-achievements'); if (el) el.textContent = Math.floor((points || 0) / 100);
    var eg = $id('stat-gifts'); if (eg) eg.textContent = '0';
  }

  function renderPoetry(user) {
    var sec = $id('poetry-section');
    if (!sec) return;
    if (!user.poetry && !user.poetryAttachment) { sec.classList.add('empty'); return; }
    sec.classList.remove('empty');
    var t = $id('poetry-display'); if (t) t.textContent = user.poetry || '';
    var a = $id('poetry-author'); if (a) a.textContent = user.poetry ? ('— ' + (user.name || '')) : '';
    var att = $id('poetry-attachment');
    if (att) {
      if (user.poetryAttachment) { att.src = user.poetryAttachment; att.style.display = 'block'; }
      else att.style.display = 'none';
    }
    if (user.poetryBg) {
      sec.style.backgroundImage = 'url("' + user.poetryBg + '")';
      sec.style.backgroundSize = 'cover';
      sec.style.backgroundPosition = 'center';
    } else {
      sec.style.background = 'rgba(168,85,247,.08)';
      sec.style.backgroundImage = '';
    }
  }

  function renderTabs() {
    var tabs = $id('tabsBar');
    if (!tabs) return;
    var isOwner = S.mode === 'owner';
    var h = '';
    h += '<button class="tab active" data-tab="home"><i class="fas fa-home"></i><span>الرئيسية</span></button>';
    h += '<button class="tab" data-tab="moments"><i class="fas fa-camera"></i><span>لحظات</span></button>';
    h += '<button class="tab" data-tab="friends"><i class="fas fa-users"></i><span>أصدقاء</span></button>';
    if (isOwner) h += '<button class="tab" data-tab="settings"><i class="fas fa-cog"></i><span>إعدادات</span></button>';
    else if (S.isAdmin) h += '<button class="tab" data-tab="admin"><i class="fas fa-crosshairs"></i><span>أوامر</span></button>';
    tabs.innerHTML = h;
    tabs.querySelectorAll('.tab').forEach(function (b) {
      b.onclick = function () { switchTab(b.dataset.tab); };
    });
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.toggle('active', c.dataset.content === name); });
    var s = $id('scroll-box'); if (s) s.scrollTop = 0;
    if (name === 'friends') renderFriends();
    if (name === 'moments') renderMoments();
  }
  window.switchTab = switchTab;

  function renderFriends() {
    var el = $id('friends-grid-container');
    if (!el || !S.subject) return;
    var fb = FB(); if (!fb) return;
    el.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;padding:20px;font-size:12px">⏳ تحميل...</div>';
    fb.get('users/' + S.subject.uid + '/friends').then(function (data) {
      var v = data || {};
      var list = Object.keys(v).filter(function (k) { return v[k] && (v[k].status === 'accepted' || !v[k].status); })
        .map(function (k) { return { uid: k, name: v[k].name || 'مجهول', avatar: v[k].avatar || '' }; });
      if (!list.length) {
        el.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;padding:20px;font-size:12px">لا يوجد أصدقاء</div>';
        return;
      }
      el.innerHTML = '';
      list.forEach(function (fr) {
        var card = document.createElement('div');
        card.className = 'friend-card';
        var initial = (fr.name || 'U')[0];
        card.innerHTML = '<div class="friend-avatar">' +
          (fr.avatar ? '<img src="' + esc(fr.avatar) + '">' : '<span>' + esc(initial) + '</span>') +
          '</div><div class="friend-name">' + esc(fr.name) + '</div>';
        card.onclick = function () { openUser(fr.uid, fr.name); };
        el.appendChild(card);
      });
    }).catch(function () {
      el.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#ff6666;padding:20px;font-size:12px">⚠️ فشل</div>';
    });
  }

  function renderMoments() {
    var el = $id('moments-grid');
    if (!el || !S.subject) return;
    var fb = FB(); if (!fb) return;
    el.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;padding:20px;font-size:12px">⏳ تحميل...</div>';
    fb.get('stories/' + S.subject.uid).then(function (data) {
      var v = data || {};
      var now = Date.now();
      var list = Object.keys(v).map(function (k) { var x = v[k]; x._id = k; return x; })
        .filter(function (x) { return (x.expiresAt || 0) > now; })
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      if (!list.length) {
        el.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;padding:20px;font-size:12px">لا توجد لحظات</div>';
        return;
      }
      el.innerHTML = '';
      list.forEach(function (st) {
        var ic = st.type === 'image' ? '🖼️' : (st.type === 'video' ? '🎥' : '📝');
        var prev = st.text ? st.text.substring(0, 20) : ic;
        var tile = document.createElement('div');
        tile.className = 'moment-tile';
        tile.innerHTML = '<div class="moment-tile-icon">' + ic + '</div><div class="moment-tile-name">' + esc(prev) + '</div>';
        el.appendChild(tile);
      });
    }).catch(function () {
      el.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;padding:20px;font-size:12px">لا توجد لحظات</div>';
    });
  }

  function renderVisitors() {
    if (S.mode !== 'owner') return;
    var sec = $id('visitors-section');
    var cont = $id('visitors-container');
    if (!sec || !cont) return;
    sec.style.display = '';
    var fb = FB(); if (!fb) return;
    fb.get('users/' + S.subject.uid + '/visitors').then(function (data) {
      var v = data || {};
      var list = Object.keys(v).map(function (k) { var x = v[k]; x.uid = k; return x; })
        .sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
      if (!list.length) {
        cont.innerHTML = '<div style="color:#666;font-size:11px;padding:8px">لا زوار</div>';
        return;
      }
      cont.innerHTML = '';
      list.slice(0, 12).forEach(function (vs) {
        var chip = document.createElement('div');
        chip.className = 'visitor-chip';
        chip.innerHTML = '<div class="visitor-avatar">' +
          (vs.avatar ? '<img src="' + esc(vs.avatar) + '">' : '<span>' + esc((vs.name || 'U')[0]) + '</span>') +
          '</div><span class="visitor-name">👁️ ' + esc(vs.name || 'زائر') + '</span>';
        chip.onclick = function () { openUser(vs.uid, vs.name); };
        cont.appendChild(chip);
      });
    }).catch(function () {});
  }

  function copyText(text, label) {
    if (!text) return;
    var done = function () { toast('✅ تم نسخ ' + (label || 'النص')); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); done();
      } catch (e) {}
    }
  }

  function openUser(uid, name) {
    if (!uid) return;
    try {
      if (window.parent && typeof window.parent.openUserProfile === 'function') {
        window.parent.openUserProfile(uid, name || ''); return;
      }
    } catch (e) {}
    location.href = location.pathname + '?uid=' + encodeURIComponent(uid);
  }

  function setupMusic(user) {
    var mini = $id('music-btn-mini');
    var audio = $id('music-player');
    if (!mini || !audio) return;
    if (!user.musicURL || S.mode === 'owner') { mini.style.display = 'none'; return; }
    mini.style.display = 'flex';
    if (audio.src !== user.musicURL) { audio.src = user.musicURL; audio.load(); }
    if (mini.__b) return;
    mini.__b = true;
    mini.onclick = function () {
      if (audio.paused) {
        audio.play().then(function () {
          mini.classList.add('playing');
          mini.innerHTML = '<i class="fas fa-pause"></i>';
        }).catch(function () { toast('⚠️ تعذر التشغيل'); });
      } else {
        audio.pause();
        mini.classList.remove('playing');
        mini.innerHTML = '<i class="fas fa-play"></i>';
      }
    };
    audio.onended = function () {
      mini.classList.remove('playing');
      mini.innerHTML = '<i class="fas fa-play"></i>';
    };
  }

  function apply(user) {
    if (!user) return;
    renderCover(user);
    renderAvatar(user);
    applyFrame(user);
    renderHeader(user);
    applyGlow(user);
    applyBackground(user);
    renderInfo(user);
    renderPoetry(user);
    setupMusic(user);
  }

  function startLive(uid) {
    var fb = FB();
    if (!fb || typeof fb.onValue !== 'function') return;
    stopLive();
    try {
      var h = fb.onValue('users/' + uid, function (v) {
        if (!v || typeof v !== 'object') return;
        v.uid = uid;
        S.subject = Object.assign({}, S.subject, v);
        apply(S.subject);
      }, function () {});
      S.liveUnsubs.push(function () { try { h.off(); } catch (e) {} });
    } catch (e) {}
    try {
      var hp = fb.onValue('user_presence/' + uid, function (p) {
        S.presence = p || {};
        var dot = $id('status-dot');
        if (dot) {
          if (S.presence.state === 'online' && (Date.now() - (S.presence.lastChanged || 0)) < 120000) dot.classList.add('online');
          else dot.classList.remove('online');
        }
        renderInfo(S.subject);
      }, function () {});
      S.liveUnsubs.push(function () { try { hp.off(); } catch (e) {} });
    } catch (e) {}
  }
  function stopLive() {
    S.liveUnsubs.forEach(function (fn) { try { fn(); } catch (e) {} });
    S.liveUnsubs = [];
  }

  function getMe() {
    var Auth = P('QamarAuth');
    if (Auth && typeof Auth.getUid === 'function') {
      try {
        var uid = Auth.getUid();
        if (uid) {
          var me = { uid: uid };
          var Sess = P('QamarSession');
          if (Sess && typeof Sess.getData === 'function') {
            try {
              var d = Sess.getData();
              if (d && d.uid === uid) Object.assign(me, d);
            } catch (e) {}
          }
          if (!me.name && typeof Auth.getDisplayName === 'function') {
            try { me.name = Auth.getDisplayName(); } catch (e) {}
          }
          return me;
        }
      } catch (e) {}
    }
    var Sess2 = P('QamarSession');
    if (Sess2 && typeof Sess2.getData === 'function') {
      try { var d2 = Sess2.getData(); if (d2 && d2.uid) return d2; } catch (e) {}
    }
    try {
      var raw = localStorage.getItem('qamar_current_user') || localStorage.getItem('qamar_user');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  async function boot() {
    var urlUid = /[?&]uid=([^&]+)/.test(location.search) ? decodeURIComponent(location.search.match(/[?&]uid=([^&]+)/)[1]) : null;
    var ownerParam = /[?&]owner=1/.test(location.search);
    var previewParam = /[?&]preview=1/.test(location.search);

    S.me = getMe();
    var isMe = (S.me && S.me.uid && urlUid === S.me.uid);

    if (previewParam && S.me) {
      S.mode = 'visitor';
      S.uid = S.me.uid;
      S.subject = Object.assign({}, S.me);
      S.isAdmin = rankLevel(S.me.rank) >= 65;
    } else if ((!urlUid && S.me) || ownerParam || isMe) {
      if (!S.me || !S.me.uid) {
        document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#fff;font-family:Cairo">⚠️ لا يوجد مستخدم</div>';
        return;
      }
      S.mode = 'owner';
      S.uid = S.me.uid;
      S.subject = S.me;
    } else if (urlUid) {
      S.mode = 'visitor';
      S.uid = urlUid;
      S.subject = { uid: urlUid, name: '...' };
      if (S.me) S.isAdmin = rankLevel(S.me.rank) >= 65;
    } else {
      document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#fff;font-family:Cairo">⚠️ لا يوجد مستخدم</div>';
      return;
    }

    document.body.className = (S.mode === 'owner') ? 'owner-mode' : 'visitor-mode';

    var fresh = await fetchUser(S.uid);
    if (fresh) S.subject = Object.assign({}, S.mode === 'owner' ? S.me : {}, fresh);
    if (!S.subject.name) S.subject.name = 'مستخدم';
    if (!S.subject.uid) S.subject.uid = S.uid;

    if (S.mode === 'visitor' && !previewParam && S.me && S.me.uid !== S.uid) {
      var fb = FB();
      if (fb && typeof fb.set === 'function') {
        try {
          fb.set('users/' + S.uid + '/visitors/' + S.me.uid, {
            time: Date.now(), name: S.me.name || 'زائر', avatar: S.me.avatar || ''
          }).catch(function () {});
        } catch (e) {}
      }
    }

    if (S.mode === 'owner') {
      var vs = $id('visitors-section'); if (vs) vs.style.display = '';
    }
    if (S.isAdmin && S.mode === 'visitor' && !previewParam) {
      var ab = $id('btn-admin-actions'); if (ab) ab.style.display = 'flex';
    }

    renderTabs();
    apply(S.subject);

    fetchPoints(S.uid).then(function (p) { renderStats(S.uid, p); });
    if (S.mode === 'owner') renderVisitors();
    startLive(S.uid);

    var A = window.QamarProfileActions || (window.parent && window.parent.QamarProfileActions);
    if (A && typeof A.bind === 'function') {
      try { A.bind(S); console.log('[profile-core] actions bound'); }
      catch (e) { console.warn('actions bind failed:', e); }
    } else {
      console.warn('[profile-core] QamarProfileActions not found!');
    }

    var c = $id('profile-container');
    if (c) c.style.opacity = '1';

    console.log('[profile-core] mode=' + S.mode + ' uid=' + S.uid + ' preview=' + previewParam);
  }

  window.QamarProfileCore = {
    S: S, P: P, $id: $id, esc: esc,
    rankLevel: rankLevel, rankIcon: rankIcon,
    toast: toast, copyText: copyText, openUser: openUser,
    apply: apply, renderInfo: renderInfo, switchTab: switchTab,
    FB: FB, fetchUser: fetchUser, getMe: getMe
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 50);

  console.log('[profile-core] ready');
})();
