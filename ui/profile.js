/* ============================================================
   🌙 قمر الشام — ui/profile.js
   Version: 1.0
   الشكل الأصلي لبروفايل v1، لكن كـ modal داخل الصفحة
   
   يعتمد على: QamarFB, QamarIdentity, QamarFrames, QamarNameEffects,
              QamarAuth, QamarSession, QamarRanks, QamarPM, EventBus
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarProfile) return;

  var VERSION = '1.0';
  var MODAL_ID = 'qamar-profile-modal';
  var St = {
    inited: false,
    open: false,
    currentUid: null,
    isSelf: false,
    musicAudio: null
  };

  function $id(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function emit(name, data) {
    try { if (window.EventBus && window.EventBus.emit) window.EventBus.emit(name, data); } catch (e) {}
  }

  function getCurrentUid() {
    try {
      if (window.QamarAuth && typeof window.QamarAuth.getUid === 'function') {
        return window.QamarAuth.getUid();
      }
      if (window.auth && window.auth.currentUser) return window.auth.currentUser.uid;
    } catch (e) {}
    return null;
  }

  function isKing() {
    try {
      if (window.QamarRanks && typeof window.QamarRanks.isKing === 'function') {
        return window.QamarRanks.isKing();
      }
    } catch (e) {}
    return false;
  }

  function myLevel() {
    try {
      if (window.QamarRanks && typeof window.QamarRanks.myLevel === 'function') {
        return window.QamarRanks.myLevel();
      }
    } catch (e) {}
    return 0;
  }

  function timeAgo(ts) {
    if (!ts) return '—';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'الآن';
    var m = Math.floor(s / 60);
    if (m < 60) return 'قبل ' + m + ' د';
    var h = Math.floor(m / 60);
    if (h < 24) return 'قبل ' + h + ' س';
    var d = Math.floor(h / 24);
    if (d < 30) return 'قبل ' + d + ' ي';
    try { return new Date(ts).toLocaleDateString('ar-EG'); } catch (e) { return ''; }
  }

  function toast(msg, kind) {
    try {
      if (window.EventBus && window.EventBus.emit) {
        window.EventBus.emit('toast:show', { message: msg, kind: kind || 'info' });
      }
    } catch (e) {}
  }

  /* ==================== Fetch ==================== */

  function fetchUser(uid) {
    return new Promise(function (resolve) {
      if (!window.QamarFB || typeof window.QamarFB.get !== 'function') {
        resolve(null); return;
      }
      try {
        window.QamarFB.get('users/' + uid).then(function (data) {
          resolve(data || null);
        }).catch(function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  function fetchPoints(uid) {
    return new Promise(function (resolve) {
      if (!window.QamarFB || typeof window.QamarFB.get !== 'function') {
        resolve(0); return;
      }
      try {
        window.QamarFB.get('bot_data/quiz/scores/' + uid).then(function (v) {
          resolve((v && Number(v.points)) || Number(v) || 0);
        }).catch(function () { resolve(0); });
      } catch (e) { resolve(0); }
    });
  }

  /* ==================== Render ==================== */

  function renderCover(user) {
    var type = user.coverType || 'color';
    var val = user.cover || '';
    var style = 'width:100%;height:200px;position:relative;overflow:hidden;';

    if (type === 'video' && val) {
      return '<div style="' + style + 'background:#000">' +
        '<video src="' + esc(val) + '" autoplay muted loop playsinline ' +
          'style="width:100%;height:100%;object-fit:cover;opacity:0.85"></video>' +
        '<div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 40%,rgba(5,5,8,0.95))"></div>' +
      '</div>';
    }
    if (type === 'image' && val) {
      return '<div style="' + style + 'background:#000">' +
        '<img src="' + esc(val) + '" style="width:100%;height:100%;object-fit:cover;opacity:0.85" ' +
          'onerror="this.style.display=\'none\'">' +
        '<div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent 40%,rgba(5,5,8,0.95))"></div>' +
      '</div>';
    }
    if (type === 'gradient' && val) {
      var grad = val;
      if (Array.isArray(val) && val.length >= 2) {
        grad = 'linear-gradient(135deg,' + val[0] + ',' + val[1] + ')';
      }
      return '<div style="' + style + 'background:' + esc(grad) + '"></div>' +
             '<div style="position:absolute;top:0;left:0;right:0;height:200px;background:linear-gradient(180deg,transparent 40%,rgba(5,5,8,0.95));pointer-events:none"></div>';
    }
    if (type === 'color' && val) {
      return '<div style="' + style + 'background:' + esc(val) + '"></div>' +
             '<div style="position:absolute;top:0;left:0;right:0;height:200px;background:linear-gradient(180deg,transparent 40%,rgba(5,5,8,0.95));pointer-events:none"></div>';
    }
    // default: gradient أسود خفيف
    return '<div style="' + style +
      'background:linear-gradient(135deg,#0a0616,#1a1a2e,#0a0616)"></div>' +
      '<div style="position:absolute;top:0;left:0;right:0;height:200px;' +
      'background:linear-gradient(180deg,transparent 40%,rgba(5,5,8,0.95));pointer-events:none"></div>';
  }

  function renderAvatar(user) {
    var src = user.avatar || ('https://ui-avatars.com/api/?name=' +
      encodeURIComponent(user.name || 'U') + '&background=1a1a2e&color=d4af37&size=200&bold=true');
    return '<div class="qp-avatar-wrap" style="position:relative;margin-top:-64px;' +
      'display:flex;justify-content:center;z-index:3">' +
      '<div class="qp-avatar-ring" style="position:relative;padding:4px;' +
        'border-radius:50%;background:linear-gradient(135deg,#d4af37,#b8860b);' +
        'box-shadow:0 0 24px rgba(212,175,55,0.5)">' +
        '<img id="qp-avatar" src="' + esc(src) + '" ' +
          'style="width:120px;height:120px;border-radius:50%;object-fit:cover;' +
          'background:#050508;display:block" ' +
          'onerror="this.src=\'https://ui-avatars.com/api/?name=U&background=1a1a2e&color=d4af37\'">' +
      '</div>' +
    '</div>';
  }

  function renderName(user) {
    var name = user.name || '—';
    var code = user.code || '';
    var html = '<div style="text-align:center;padding:12px 16px 4px">' +
      '<div id="qp-name" style="font-size:24px;font-weight:900;color:#f3f4f6;' +
        'line-height:1.3;word-break:break-word">' + esc(name) + '</div>';
    if (code) {
      html += '<div style="font-size:13px;color:#d4af37;font-weight:900;' +
        'margin-top:6px;letter-spacing:1px">' + esc(code) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderBio(user) {
    if (!user.bio) return '';
    return '<div style="text-align:center;padding:8px 24px 12px;color:#9ca3af;' +
      'font-size:13px;line-height:1.7;word-break:break-word">' +
      esc(user.bio) + '</div>';
  }

  function renderStats(user, points) {
    var rank = user.rank || 'User';
    var rankLevel = Number(user.rankLevel) || 50;
    var rankIcon = '👤';
    if (rank === 'King') rankIcon = '👑';
    else if (rank === 'Queen') rankIcon = '👸';
    else if (rankLevel >= 90) rankIcon = '🌟';
    else if (rankLevel >= 80) rankIcon = '💎';
    else if (rankLevel >= 75) rankIcon = '🏆';
    else if (rankLevel >= 70) rankIcon = '🎖️';
    else if (rankLevel >= 65) rankIcon = '🛠️';
    else if (rankLevel >= 60) rankIcon = '💠';

    return '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;' +
      'padding:10px 16px 14px">' +
      statBox(rankIcon, rank, 'الرتبة') +
      statBox('⭐', points || 0, 'النقاط') +
      statBox('⏱️', timeAgo(user.lastSeen), 'آخر ظهور') +
    '</div>';
  }

  function statBox(icon, value, label) {
    return '<div style="text-align:center;padding:10px 6px;border-radius:12px;' +
      'background:rgba(255,255,255,0.03);border:1px solid rgba(212,175,55,0.15)">' +
      '<div style="font-size:20px;margin-bottom:4px">' + icon + '</div>' +
      '<div style="font-size:13px;font-weight:900;color:#f3f4f6;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
        esc(String(value)).substring(0, 15) + '</div>' +
      '<div style="font-size:10px;color:#6b7280;margin-top:2px">' + esc(label) + '</div>' +
    '</div>';
  }

  function renderInfo(user) {
    var parts = [];
    if (user.country) parts.push('🌍 ' + esc(user.country));
    if (user.family) parts.push('👨‍👩‍👧 ' + esc(user.family));
    if (user.gender) {
      var g = user.gender === 'male' ? '♂️ ذكر' : (user.gender === 'female' ? '♀️ أنثى' : '⚧ آخر');
      parts.push(g);
    }
    if (user.age) parts.push('🎂 ' + user.age + ' سنة');
    if (!parts.length) return '';
    return '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;' +
      'padding:4px 16px 12px">' +
      parts.map(function (p) {
        return '<span style="padding:6px 12px;border-radius:9999px;' +
          'background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.25);' +
          'font-size:12px;color:#f3f4f6">' + p + '</span>';
      }).join('') +
    '</div>';
  }

  function renderPoetry(user) {
    if (!user.poetry) return '';
    var bg = user.poetryBg
      ? 'background-image:url(' + esc(user.poetryBg) + ');background-size:cover;' +
        'background-position:center;'
      : 'background:rgba(168,85,247,0.08);';
    return '<div style="margin:6px 16px 14px;padding:14px;border-radius:14px;' +
      'border:1px solid rgba(168,85,247,0.3);position:relative;overflow:hidden;' +
      bg + '">' +
      '<div style="position:absolute;top:6px;right:12px;font-size:20px;opacity:0.6">📜</div>' +
      '<div style="position:relative;color:#f3f4f6;font-size:14px;line-height:1.9;' +
        'font-style:italic;text-align:center;white-space:pre-wrap;' +
        'text-shadow:0 1px 4px rgba(0,0,0,0.8)">' +
        esc(user.poetry) +
      '</div>' +
    '</div>';
  }

  function renderActions(user, isSelf) {
    var buttons = [];

    if (isSelf) {
      buttons.push({ id: 'frames', icon: '🎨', label: 'الإطارات', color: '#d4af37' });
      buttons.push({ id: 'name-effect', icon: '✨', label: 'نمط الاسم', color: '#a855f7' });
      buttons.push({ id: 'edit', icon: '⚙️', label: 'تعديل', color: '#84cc16' });
    } else {
      buttons.push({ id: 'pm', icon: '💬', label: 'رسالة', color: '#3b82f6' });
      buttons.push({ id: 'add-friend', icon: '➕', label: 'صديق', color: '#84cc16' });
      buttons.push({ id: 'block', icon: '🚫', label: 'حظر', color: '#ef4444' });
      buttons.push({ id: 'report', icon: '🚨', label: 'إبلاغ', color: '#f59e0b' });

      if (isKing()) {
        buttons.push({ id: 'jail', icon: '⛓️', label: 'سجن', color: '#ef4444' });
        buttons.push({ id: 'promote', icon: '🎖️', label: 'ترقية', color: '#d4af37' });
        buttons.push({ id: 'gift', icon: '⭐', label: 'نقاط', color: '#ffd700' });
      }
    }

    return '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;' +
      'padding:6px 16px 18px">' +
      buttons.map(function (b) {
        return '<button class="qp-action" data-action="' + b.id + '" type="button" ' +
          'style="display:flex;flex-direction:column;align-items:center;gap:4px;' +
          'min-width:64px;padding:10px 8px;border-radius:12px;' +
          'background:rgba(255,255,255,0.04);border:1px solid ' + b.color + '40;' +
          'color:' + b.color + ';cursor:pointer;font-family:inherit">' +
          '<span style="font-size:20px">' + b.icon + '</span>' +
          '<span style="font-size:10px;font-weight:900">' + b.label + '</span>' +
        '</button>';
      }).join('') +
    '</div>';
  }

  function renderMusic(user) {
    if (!user.musicURL) return '';
    return '<div style="margin:0 16px 16px;padding:10px 14px;border-radius:12px;' +
      'background:linear-gradient(135deg,rgba(212,175,55,0.12),rgba(168,85,247,0.08));' +
      'border:1px solid rgba(212,175,55,0.3);display:flex;align-items:center;gap:10px">' +
      '<button id="qp-music-btn" type="button" ' +
        'style="width:40px;height:40px;border-radius:50%;' +
        'background:linear-gradient(135deg,#d4af37,#b8860b);' +
        'color:#000;font-size:16px;border:none;cursor:pointer;font-family:inherit">▶</button>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;font-weight:900;color:#f3f4f6">🎵 الموسيقى</div>' +
        '<div style="font-size:10px;color:#9ca3af">اضغط للتشغيل</div>' +
      '</div>' +
      '<audio id="qp-music" src="' + esc(user.musicURL) + '" preload="none" ' +
        'style="display:none"></audio>' +
    '</div>';
  }

  /* ==================== Build modal ==================== */

  function build(user, points) {
    var old = $id(MODAL_ID);
    if (old) old.remove();

    var isSelf = St.isSelf;

    var ov = document.createElement('div');
    ov.id = MODAL_ID;
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:16500;' +
      'display:flex;align-items:flex-end;justify-content:center;' +
      'font-family:inherit;direction:rtl';

    var card = document.createElement('div');
    card.style.cssText =
      'width:100%;max-width:520px;max-height:94vh;overflow-y:auto;' +
      'background:#050508;border-top-left-radius:22px;border-top-right-radius:22px;' +
      'border:1px solid rgba(212,175,55,0.3);border-bottom:none;' +
      'position:relative;transform:translateY(100%);transition:transform .3s ease;' +
      '-webkit-overflow-scrolling:touch';

    card.innerHTML =
      // Close button (top-right)
      '<button id="qp-close" type="button" ' +
        'style="position:absolute;top:10px;right:10px;z-index:5;' +
        'width:36px;height:36px;border-radius:50%;' +
        'background:rgba(0,0,0,0.6);backdrop-filter:blur(10px);' +
        'border:1px solid rgba(255,255,255,0.15);color:#f3f4f6;' +
        'font-size:16px;cursor:pointer;font-family:inherit">✕</button>' +
      // Cover + avatar + name + bio
      '<div style="position:relative">' +
        renderCover(user) +
        renderAvatar(user) +
      '</div>' +
      renderName(user) +
      renderBio(user) +
      renderStats(user, points) +
      renderInfo(user) +
      renderActions(user, isSelf) +
      renderPoetry(user) +
      renderMusic(user) +
      // Bottom padding
      '<div style="height:20px"></div>';

    ov.appendChild(card);
    document.body.appendChild(ov);

    requestAnimationFrame(function () {
      card.style.transform = 'translateY(0)';
    });

    // Close handlers
    card.querySelector('#qp-close').addEventListener('click', close);
    ov.addEventListener('click', function (e) {
      if (e.target === ov) close();
    });

    // Action buttons
    card.querySelectorAll('.qp-action').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-action');
        handleAction(action, user);
      });
    });

    // Music
    var musicBtn = card.querySelector('#qp-music-btn');
    var musicEl = card.querySelector('#qp-music');
    if (musicBtn && musicEl) {
      musicBtn.addEventListener('click', function () {
        if (musicEl.paused) {
          musicEl.play().then(function () {
            musicBtn.textContent = '⏸';
          }).catch(function () { toast('تعذر التشغيل', 'error'); });
        } else {
          musicEl.pause();
          musicBtn.textContent = '▶';
        }
      });
      musicEl.addEventListener('ended', function () { musicBtn.textContent = '▶'; });
    }

    // Apply frame on avatar
    setTimeout(function () {
      try {
        if (window.QamarFrames && typeof window.QamarFrames.apply === 'function') {
          var av = card.querySelector('#qp-avatar');
          var frame = user.avatarFrame;
          if (!frame) {
            frame = window.QamarFrames.defaultForRank
              ? window.QamarFrames.defaultForRank(Number(user.rankLevel) || 50)
              : 'gold';
          }
          if (av && frame) window.QamarFrames.apply(av, frame);
        }
      } catch (e) {}
    }, 60);

    // Apply name effects
    setTimeout(function () {
      try {
        if (window.QamarNameEffects && typeof window.QamarNameEffects.apply === 'function') {
          var nameEl = card.querySelector('#qp-name');
          var cfg = user.nameEffects;
          if (!cfg) {
            if (user.nameGradient && user.nameGradient.length === 2) {
              cfg = { mode: 'gradient', c1: user.nameGradient[0], c2: user.nameGradient[1], c3: user.nameGradient[1] };
            } else if (user.nameColor) {
              cfg = { mode: 'solid', value: user.nameColor };
            }
          }
          if (nameEl && cfg) window.QamarNameEffects.apply(nameEl, cfg);
        }
      } catch (e) {}
    }, 80);

    // Escape
    document.addEventListener('keydown', escHandler);

    St.open = true;
    return ov;
  }

  function escHandler(e) {
    if (e.key === 'Escape' && St.open) close();
  }

  /* ==================== Actions ==================== */

  function handleAction(action, user) {
    var uid = St.currentUid;
    if (!uid) return;

    if (action === 'pm') {
      close();
      try {
        if (window.QamarNav && typeof window.QamarNav.openPM === 'function') {
          window.QamarNav.openPM(uid);
        } else {
          emit('pm:open', { otherUid: uid });
        }
      } catch (e) {}
      return;
    }

    if (action === 'frames') {
      if (!window.QamarFrames) { toast('محرر الإطارات غير متاح', 'error'); return; }
      showFramesSelector(uid, user.avatarFrame);
      return;
    }

    if (action === 'name-effect') {
      if (!window.QamarNameEffects) { toast('محرر النمط غير متاح', 'error'); return; }
      try {
        window.QamarNameEffects.open(uid);
      } catch (e) { toast('فشل فتح المحرر', 'error'); }
      return;
    }

    if (action === 'edit') {
      toast('محرر التعديل قادم قريباً', 'info');
      return;
    }

    if (action === 'add-friend') {
      toast('قريباً', 'info');
      return;
    }

    if (action === 'block') {
      if (!window.QamarPM || typeof window.QamarPM.blockUser !== 'function') {
        toast('غير متاح'); return;
      }
      if (!confirm('حظر ' + (user.name || '?') + '؟')) return;
      window.QamarPM.blockUser(uid).then(function () {
        toast('✅ تم الحظر', 'success');
        close();
      }).catch(function (e) { toast(e.message || 'فشل', 'error'); });
      return;
    }

    if (action === 'report') {
      toast('الإبلاغ قادم قريباً', 'info');
      return;
    }

    if (action === 'jail') {
      toast('استخدم غرفة الملك للسجن', 'info');
      return;
    }

    if (action === 'promote') {
      toast('استخدم غرفة الملك للترقية', 'info');
      return;
    }

    if (action === 'gift') {
      toast('استخدم غرفة الملك لإهداء النقاط', 'info');
      return;
    }
  }

  function showFramesSelector(uid, currentFrame) {
    var frames = (window.QamarFrames && window.QamarFrames.list)
      ? window.QamarFrames.list() : [];
    if (!frames.length) { toast('لا توجد إطارات', 'error'); return; }

    var ov = document.createElement('div');
    ov.id = 'qp-frames-ov';
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:17000;' +
      'display:flex;align-items:center;justify-content:center;padding:20px;' +
      'direction:rtl;font-family:inherit';

    var card = document.createElement('div');
    card.style.cssText =
      'width:100%;max-width:400px;background:#0a0616;' +
      'border:1px solid rgba(212,175,55,0.35);border-radius:18px;padding:16px;' +
      'max-height:80vh;overflow-y:auto';

    var grid = frames.map(function (f) {
      var active = currentFrame === f.id;
      return '<button class="qpf-tile" data-frame="' + esc(f.id) + '" type="button" ' +
        'style="padding:14px 8px;border-radius:12px;background:rgba(255,255,255,0.04);' +
        'border:2px solid ' + (active ? '#d4af37' : 'rgba(255,255,255,0.08)') + ';' +
        'color:#f3f4f6;font-family:inherit;font-size:11px;font-weight:900;' +
        'cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px">' +
        '<span style="width:40px;height:40px;border-radius:50%;' +
          'background:linear-gradient(135deg,' + f.colors.join(',') + ');' +
          'display:block"></span>' +
        '<span>' + esc(f.name) + '</span>' +
      '</button>';
    }).join('');

    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div style="color:#d4af37;font-size:15px;font-weight:900">🎨 الإطارات</div>' +
        '<button id="qpf-close" type="button" ' +
          'style="width:30px;height:30px;border-radius:50%;background:transparent;' +
          'border:1px solid rgba(255,255,255,0.1);color:#9ca3af;cursor:pointer;' +
          'font-family:inherit">✕</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' + grid + '</div>';

    ov.appendChild(card);
    document.body.appendChild(ov);

    card.querySelector('#qpf-close').addEventListener('click', function () { ov.remove(); });
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });

    card.querySelectorAll('.qpf-tile').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var frameId = btn.getAttribute('data-frame');
        // Apply to avatar
        var av = $id('qp-avatar');
        if (av && window.QamarFrames && typeof window.QamarFrames.apply === 'function') {
          window.QamarFrames.apply(av, frameId);
        }
        // Save
        if (window.QamarIdentity && typeof window.QamarIdentity.setFrame === 'function') {
          window.QamarIdentity.setFrame(frameId).then(function () {
            toast('✅ تم حفظ الإطار', 'success');
          }).catch(function () { toast('فشل الحفظ', 'error'); });
        }
        ov.remove();
      });
    });
  }

  /* ==================== Public API ==================== */

  function open(uid, opts) {
    opts = opts || {};
    if (!uid) {
      uid = getCurrentUid();
    }
    if (!uid) { toast('غير مسجل', 'error'); return; }

    St.currentUid = uid;
    St.isSelf = (uid === getCurrentUid());

    Promise.all([fetchUser(uid), fetchPoints(uid)]).then(function (results) {
      var user = results[0];
      var points = results[1];

      if (!user) {
        user = { name: '—', uid: uid };
      }

      build(user, points);
      emit('profile:opened', { uid: uid, isSelf: St.isSelf });
    });
  }

  function openSelf() {
    var uid = getCurrentUid();
    if (uid) open(uid);
  }

  function close() {
    var ov = $id(MODAL_ID);
    if (ov) {
      var card = ov.querySelector('div');
      if (card) card.style.transform = 'translateY(100%)';
      setTimeout(function () { try { ov.remove(); } catch (e) {} }, 280);
    }
    if (St.musicAudio) { try { St.musicAudio.pause(); } catch (e) {} }
    St.open = false;
    St.currentUid = null;
    St.isSelf = false;
    document.removeEventListener('keydown', escHandler);
    emit('profile:closed', {});
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    try {
      if (window.EventBus && typeof window.EventBus.on === 'function') {
        window.EventBus.on('profile:open', function (d) {
          if (d && d.uid) open(d.uid);
        });
        window.EventBus.on('profile:open-self', function () {
          openSelf();
        });
      }
    } catch (e) {}

    console.log('[profile] v' + VERSION + ' ready');
  }

  window.QamarProfile = {
    version: VERSION,
    open: open,
    openSelf: openSelf,
    close: close,
    isOpen: function () { return St.open; },
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
