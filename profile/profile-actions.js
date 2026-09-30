/* profile-actions.js */
(function () {
  'use strict';

  var Core = window.QamarProfileCore;
  if (!Core) { console.warn('[profile-actions] core not ready'); return; }
  var $id = Core.$id, esc = Core.esc, toast = Core.toast;
  var S = Core.S;
  function P(name) { return Core.P(name); }

  function upload(file) {
    var U = P('QamarUploader');
    if (!U || typeof U.upload !== 'function') return Promise.reject(new Error('uploader unavailable'));
    return U.upload(file, {}).then(function (r) { return r && r.url ? r.url : r; });
  }

  function save(updates) {
    var ID = P('QamarIdentity');
    if (ID && typeof ID.updateFields === 'function') return ID.updateFields(updates);
    var fb = Core.FB();
    if (!fb || typeof fb.update !== 'function') return Promise.reject(new Error('no-save-method'));
    var patch = {};
    Object.keys(updates).forEach(function (k) { patch['users/' + S.uid + '/' + k] = updates[k]; });
    patch['users/' + S.uid + '/identityUpdatedAt'] = Date.now();
    return fb.update('', patch).then(function () { return { ok: true }; });
  }

  function saveAndRefresh(updates) {
    return save(updates).then(function () {
      Object.keys(updates).forEach(function (k) { S.subject[k] = updates[k]; });
      Core.apply(S.subject);
      toast('✅ تم الحفظ');
    }).catch(function (e) {
      toast('⚠️ فشل: ' + (e.message || 'خطأ'));
      throw e;
    });
  }

  function pickFile(inputId, onFile, maxMb) {
    var inp = $id(inputId);
    if (!inp) return;
    inp.value = '';
    inp.onchange = function () {
      var f = this.files[0];
      if (!f) return;
      if (maxMb && f.size / 1024 / 1024 > maxMb) { toast('⚠️ الحد ' + maxMb + 'MB'); return; }
      onFile(f);
    };
    inp.click();
  }

  function uploadField(inputId, field, maxMb, extra) {
    pickFile(inputId, function (file) {
      toast('⏳ جاري الرفع...');
      upload(file).then(function (url) {
        var upd = {}; upd[field] = url;
        if (extra) Object.keys(extra).forEach(function (k) { upd[k] = extra[k]; });
        return saveAndRefresh(upd);
      }).catch(function (e) { toast('⚠️ فشل: ' + (e.message || '')); });
    }, maxMb);
  }

  function openModal(opts) {
    opts = opts || {};
    var m = $id('app-modal');
    if (!m) return;
    var t = $id('modal-title'), txt = $id('modal-text'), dyn = $id('modal-dyn');
    var ok = $id('modal-ok'), cancel = $id('modal-cancel');
    t.textContent = opts.title || '';
    txt.textContent = opts.text || '';
    txt.style.display = opts.text ? 'block' : 'none';
    dyn.innerHTML = '';
    if (opts.html) dyn.innerHTML = opts.html;
    else if (opts.type === 'input' || opts.type === 'textarea') {
      var el = document.createElement(opts.type === 'textarea' ? 'textarea' : 'input');
      el.id = 'pm-input';
      el.value = opts.value || '';
      if (opts.maxLength) el.maxLength = opts.maxLength;
      el.style.cssText = 'width:100%;padding:12px;background:rgba(255,255,255,.08);border:1px solid #d4af37;border-radius:10px;color:#fff;font-family:inherit;font-size:14px;box-sizing:border-box;text-align:center';
      if (opts.type === 'textarea') el.rows = 4;
      dyn.appendChild(el);
    }
    m.classList.add('active');
    ok.textContent = opts.okLabel || 'موافق';
    cancel.textContent = opts.cancelLabel || 'إلغاء';
    ok.onclick = function () {
      var inp = dyn.querySelector('#pm-input');
      var v = inp ? inp.value : '';
      m.classList.remove('active');
      if (typeof opts.onSave === 'function') opts.onSave(v);
    };
    cancel.onclick = function () { m.classList.remove('active'); };
    m.onclick = function (e) { if (e.target === m) m.classList.remove('active'); };
  }

  /* ═══ Settings navigation ═══ */
  var stack = ['main'];
  function showPage(p) {
    document.querySelectorAll('.settings-page').forEach(function (el) { el.classList.remove('active'); });
    var t = document.querySelector('.settings-page[data-page="' + p + '"]');
    if (t) t.classList.add('active');
    if (stack[stack.length - 1] !== p) stack.push(p);
    renderPage(p);
    var s = $id('scroll-box'); if (s) s.scrollTop = 0;
  }
  function back() {
    stack.pop();
    var p = stack[stack.length - 1] || 'main';
    document.querySelectorAll('.settings-page').forEach(function (el) { el.classList.remove('active'); });
    var t = document.querySelector('.settings-page[data-page="' + p + '"]');
    if (t) t.classList.add('active');
    renderPage(p);
  }

  function renderPage(p) {
    if (p === 'name-color') renderColors('name-color-grid', 'name-preview-color', 'nameColor');
    if (p === 'name-gradient') renderGradients('name-gradient-grid', 'name-preview-gradient', 'nameGradient');
    if (p === 'name-bg-color') renderBgColors();
    if (p === 'name-bg-gradient') renderBgGradients();
    if (p === 'avatar-page') {
      var ap = $id('avatar-preview-img');
      if (ap) ap.src = S.subject.avatar || 'https://ui-avatars.com/api/?name=U&background=333&color=fff';
    }
    if (p === 'cover-page') {
      var cp = $id('cover-preview-img');
      if (cp) { if (S.subject.cover) { cp.src = S.subject.cover; cp.style.display = 'block'; } else cp.style.display = 'none'; }
    }
    if (p === 'frame-page') renderFrames();
    if (p === 'glow-page') renderGlows();
    if (p === 'music') {
      var st = $id('music-status'); if (st) st.textContent = S.subject.musicURL ? 'يوجد ✅' : 'لا يوجد';
    }
    if (p === 'poetry') {
      var pi = $id('poetry-input'); if (pi) pi.value = S.subject.poetry || '';
      var cc = $id('poetry-char-count'); if (cc) cc.textContent = (S.subject.poetry || '').length;
      renderPoetryPreviews();
    }
    if (p === 'privacy') renderPrivacy();
  }

  var COLORS = ['#d4af37','#ffd700','#ff69b4','#ff4500','#ff8c00','#39ff14','#00f3ff','#00bfff','#3b82f6','#a855f7','#8b00ff','#ff006e','#dc143c','#e0ffff','#ffffff','#ff0000','#00ff88','#ffff00','#0000ff','#8338ec'];
  var GRADIENTS = [
    ['#d4af37','#ffec8b'],['#b8860b','#ffd700'],['#ffd700','#ff8c00'],['#f4c430','#fff8dc'],
    ['#ff69b4','#ff1493'],['#e84393','#fd79a8'],['#a855f7','#7c3aed'],['#8b00ff','#ff006e'],
    ['#00f3ff','#0066ff'],['#00bfff','#1e90ff'],['#0ea5e9','#06b6d4'],['#3b82f6','#8b5cf6'],
    ['#39ff14','#00cc00'],['#00b894','#0984e3'],['#55efc4','#00b894'],['#10b981','#059669'],
    ['#ff0000','#ff4500'],['#ff4500','#ff8c00'],['#dc143c','#ff0066'],['#b91c1c','#ef4444'],
    ['#ff0000','#ffd700'],['#ff0000','#00ff00'],['#00ff00','#0000ff'],['#ff00ff','#00ffff'],
    ['#ff006e','#8338ec'],['#3a86ff','#ff006e'],['#ffffff','#cccccc'],['#1a1a2e','#16213e'],
    ['#ffd700','#ff006e'],['#00ff88','#0066ff']
  ];

  function renderColors(gridId, prevId, field) {
    var grid = $id(gridId), prev = $id(prevId);
    if (!grid) return;
    var name = S.subject.name || 'اسمك';
    if (prev) { prev.textContent = name; prev.style.color = S.subject[field] || '#fff'; }
    grid.innerHTML = '';
    var cur = S.subject[field];
    COLORS.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'name-grid-item' + (cur === c ? ' selected' : '');
      el.style.color = c;
      el.textContent = name;
      el.onclick = function () { var u = {}; u[field] = c; saveAndRefresh(u).then(function () { renderColors(gridId, prevId, field); }); };
      grid.appendChild(el);
    });
  }

  function renderGradients(gridId, prevId, field) {
    var grid = $id(gridId), prev = $id(prevId);
    if (!grid) return;
    var name = S.subject.name || 'اسمك';
    if (prev) {
      prev.textContent = name;
      var cur = S.subject[field];
      if (Array.isArray(cur) && cur.length === 2) {
        prev.style.backgroundImage = 'linear-gradient(90deg,' + cur[0] + ',' + cur[1] + ',' + cur[0] + ')';
        prev.style.backgroundSize = '200% 100%';
        prev.style.webkitBackgroundClip = 'text';
        prev.style.backgroundClip = 'text';
        prev.style.webkitTextFillColor = 'transparent';
      }
    }
    grid.innerHTML = '';
    var cur2 = S.subject[field];
    GRADIENTS.forEach(function (g) {
      var isSel = cur2 && cur2[0] === g[0] && cur2[1] === g[1];
      var el = document.createElement('div');
      el.className = 'name-grid-item' + (isSel ? ' selected' : '');
      el.style.backgroundImage = 'linear-gradient(90deg,' + g[0] + ',' + g[1] + ',' + g[0] + ')';
      el.style.backgroundSize = '200% 100%';
      el.style.webkitBackgroundClip = 'text';
      el.style.backgroundClip = 'text';
      el.style.webkitTextFillColor = 'transparent';
      el.style.color = 'transparent';
      el.textContent = name;
      el.onclick = function () { var u = {}; u[field] = g; saveAndRefresh(u).then(function () { renderGradients(gridId, prevId, field); }); };
      grid.appendChild(el);
    });
  }

  function renderBgColors() {
    var grid = $id('name-bg-color-grid'), prev = $id('name-preview-bg-color');
    if (!grid) return;
    var name = S.subject.name || 'اسمك';
    if (prev) { prev.textContent = name; prev.style.color = '#fff'; }
    grid.innerHTML = '';
    var cur = S.subject.nameBgColor;
    COLORS.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'name-grid-item' + (cur === c ? ' selected' : '');
      el.style.background = c;
      el.style.color = '#fff';
      el.textContent = name;
      el.onclick = function () { saveAndRefresh({ nameBgColor: c }).then(renderBgColors); };
      grid.appendChild(el);
    });
  }

  function renderBgGradients() {
    var grid = $id('name-bg-gradient-grid'), prev = $id('name-preview-bg-gradient');
    if (!grid) return;
    var name = S.subject.name || 'اسمك';
    if (prev) { prev.textContent = name; prev.style.color = '#fff'; }
    grid.innerHTML = '';
    var cur = S.subject.nameBgGradient;
    GRADIENTS.forEach(function (g) {
      var isSel = cur && cur[0] === g[0] && cur[1] === g[1];
      var el = document.createElement('div');
      el.className = 'name-grid-item' + (isSel ? ' selected' : '');
      el.style.background = 'linear-gradient(135deg,' + g[0] + ',' + g[1] + ')';
      el.style.color = '#fff';
      el.textContent = name;
      el.onclick = function () { saveAndRefresh({ nameBgGradient: g }).then(renderBgGradients); };
      grid.appendChild(el);
    });
  }

  function renderFrames() {
    var grid = $id('frames-grid-container');
    if (!grid) return;
    var FR = P('QamarFrames');
    if (!FR) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;padding:20px;font-size:12px">غير متاح</div>';
      return;
    }
    grid.innerHTML = '';
    var avatarSrc = S.subject.avatar || 'https://ui-avatars.com/api/?name=U&background=333&color=fff';
    var cur = S.subject.avatarFrame;

    var none = document.createElement('div');
    none.className = 'frame-tile' + (!cur ? ' selected' : '');
    none.innerHTML = '<div class="frame-avatar"><img src="' + esc(avatarSrc) + '">' +
      '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);color:#888;font-size:22px;border-radius:50%">✕</div></div>';
    none.onclick = function () { saveAndRefresh({ avatarFrame: null }).then(renderFrames); };
    grid.appendChild(none);

    var list = typeof FR.list === 'function' ? FR.list() : [];
    list.forEach(function (f) {
      var colors = f.colors || ['#d4af37'];
      var tile = document.createElement('div');
      tile.className = 'frame-tile' + (cur === f.id ? ' selected' : '');
      tile.innerHTML = '<div class="frame-avatar"><img src="' + esc(avatarSrc) + '">' +
        '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:145%;height:145%;border-radius:50%;padding:4px;' +
        'background:conic-gradient(from 0deg,' + colors.join(',') + ',' + colors[0] + ');' +
        '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
        '-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;z-index:2"></div></div>';
      tile.onclick = function () { saveAndRefresh({ avatarFrame: f.id }).then(renderFrames); };
      grid.appendChild(tile);
    });
  }

  var GLOWS = ['#ffd700','#ff69b4','#00f3ff','#39ff14','#a855f7','#ff0066','#ffffff','#ff4444','#ff8c00','#00ff88','#8b00ff','#feca57'];
  function renderGlows() {
    var grid = $id('glow-grid-container');
    if (!grid) return;
    grid.innerHTML = '';
    var cur = S.subject.profileGlow;
    GLOWS.forEach(function (c) {
      var t = document.createElement('div');
      t.className = 'glow-tile' + (cur === c ? ' selected' : '');
      t.innerHTML = '<div class="glow-circle" style="box-shadow:0 0 20px 5px ' + c + ',0 0 40px 10px ' + c + ';background:' + c + ';opacity:.6"></div>';
      t.onclick = function () { saveAndRefresh({ profileGlow: c }).then(renderGlows); };
      grid.appendChild(t);
    });
  }

  function renderPoetryPreviews() {
    var bg = $id('poetry-bg-preview');
    if (bg) {
      bg.innerHTML = '';
      if (S.subject.poetryBg) { var img = document.createElement('img'); img.src = S.subject.poetryBg; bg.appendChild(img); }
      else bg.innerHTML = '<div style="color:#555;font-size:12px">لا يوجد</div>';
    }
    var att = $id('poetry-attach-preview');
    if (att) {
      att.innerHTML = '';
      if (S.subject.poetryAttachment) { var i2 = document.createElement('img'); i2.src = S.subject.poetryAttachment; att.appendChild(i2); }
      else att.innerHTML = '<div style="color:#555;font-size:12px">لا يوجد</div>';
    }
  }

  var PRIVACY_FIELDS = [
    { k: 'country', l: 'الدولة' }, { k: 'age', l: 'العمر' }, { k: 'family', l: 'العائلة' },
    { k: 'gender', l: 'الجنس' }, { k: 'joinedAt', l: 'تاريخ الانضمام' },
    { k: 'lastSeen', l: 'آخر تواجد' }, { k: 'points', l: 'نقاط التفاعل' }, { k: 'friends', l: 'قائمة الأصدقاء' }
  ];
  function renderPrivacy() {
    var cont = $id('privacy-container');
    if (!cont) return;
    var priv = S.subject.privacy || {};
    cont.innerHTML = '';
    PRIVACY_FIELDS.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'settings-row';
      row.innerHTML = '<span class="sr-label">' + esc(f.l) + '</span>';
      var sel = document.createElement('select');
      sel.className = 'setting-select';
      [['public','🌍 الجميع'],['friends','👥 الأصدقاء'],['private','🔒 أنا فقط']].forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        if ((priv[f.k] || 'public') === o[0]) op.selected = true;
        sel.appendChild(op);
      });
      sel.onchange = function () {
        var np = Object.assign({}, S.subject.privacy || {});
        np[f.k] = sel.value;
        saveAndRefresh({ privacy: np });
      };
      row.appendChild(sel);
      cont.appendChild(row);
    });
  }

  /* ═══ Visitor ═══ */
  function bindVisitor() {
    var heart = $id('btn-heart');
    if (heart && !heart.__b) {
      heart.__b = true;
      heart.onclick = function () {
        if (!S.me || !S.uid) return;
        var fb = Core.FB(); if (!fb) return;
        fb.get('users/' + S.uid + '/likes/' + S.me.uid).then(function (s) {
          if (s) return fb.remove('users/' + S.uid + '/likes/' + S.me.uid).then(function () {
            heart.textContent = '❤️'; heart.classList.remove('active'); toast('💔 ألغي');
          });
          return fb.set('users/' + S.uid + '/likes/' + S.me.uid, {
            time: Date.now(), name: S.me.name || 'زائر', avatar: S.me.avatar || ''
          }).then(function () {
            heart.textContent = '💔'; heart.classList.add('active'); toast('❤️ تم');
            fb.push('user_notifications/' + S.uid, {
              fromUid: S.me.uid, fromName: S.me.name || 'زائر', fromAvatar: S.me.avatar || '',
              type: 'like', preview: 'أعجب بك', time: Date.now(), read: false
            }).catch(function () {});
          });
        });
      };
    }

    var mail = $id('btn-mail');
    if (mail && !mail.__b) {
      mail.__b = true;
      mail.onclick = function () {
        try {
          if (window.parent && typeof window.parent.openPrivateChatWith === 'function') {
            window.parent.openPrivateChatWith(S.uid, S.subject.name, S.subject.avatar);
            window.parent.postMessage({ action: 'closeProfile' }, '*');
          }
        } catch (e) {}
      };
    }

    var friend = $id('btn-friend');
    if (friend && !friend.__b) {
      friend.__b = true;
      friend.onclick = function () {
        if (!S.me || !S.uid) return;
        var fb = Core.FB(); if (!fb) return;
        fb.get('users/' + S.me.uid + '/friend_requests/' + S.uid).then(function (r1) {
          fb.get('users/' + S.uid + '/friend_requests/' + S.me.uid).then(function (r2) {
            fb.get('users/' + S.me.uid + '/friends/' + S.uid).then(function (f) {
              if (f.val() && f.val().status === 'accepted') {
                if (!confirm('إزالة الصداقة؟')) return;
                Promise.all([
                  fb.remove('users/' + S.me.uid + '/friends/' + S.uid),
                  fb.remove('users/' + S.uid + '/friends/' + S.me.uid)
                ]).then(function () { friend.textContent = '➕'; toast('✅ تمت الإزالة'); });
              } else if (r1.exists()) {
                fb.remove('users/' + S.me.uid + '/friend_requests/' + S.uid).then(function () {
                  friend.textContent = '➕'; toast('أُلغي الطلب');
                });
              } else if (r2.exists()) {
                Promise.all([
                  fb.set('users/' + S.uid + '/friends/' + S.me.uid, { status: 'accepted', time: Date.now() }),
                  fb.set('users/' + S.me.uid + '/friends/' + S.uid, { status: 'accepted', time: Date.now() }),
                  fb.remove('users/' + S.uid + '/friend_requests/' + S.me.uid)
                ]).then(function () { friend.textContent = '✅'; toast('✅ تمت الصداقة'); });
              } else {
                fb.set('users/' + S.me.uid + '/friend_requests/' + S.uid, {
                  time: Date.now(), name: S.me.name || 'زائر', avatar: S.me.avatar || ''
                }).then(function () {
                  fb.push('user_notifications/' + S.uid, {
                    fromUid: S.me.uid, fromName: S.me.name || 'زائر', fromAvatar: S.me.avatar || '',
                    type: 'friend_request', preview: 'طلب صداقة', time: Date.now(), read: false
                  }).catch(function () {});
                  friend.textContent = '⏳'; toast('➕ تم');
                });
              }
            });
          });
        });
      };
    }

    var block = $id('btn-block');
    if (block && !block.__b) {
      block.__b = true;
      block.onclick = function () {
        if (!S.me || !S.uid) return;
        var fb = Core.FB(); if (!fb) return;
        fb.get('users/' + S.me.uid + '/blocked/' + S.uid).then(function (b) {
          if (b.exists()) {
            if (!confirm('إلغاء الحظر؟')) return;
            fb.remove('users/' + S.me.uid + '/blocked/' + S.uid).then(function () {
              block.textContent = '🚫'; toast('✅ أُلغي');
            });
          } else {
            if (!confirm('حظر ' + (S.subject.name || '') + '؟')) return;
            fb.set('users/' + S.me.uid + '/blocked/' + S.uid, {
              time: Date.now(), name: S.subject.name, avatar: S.subject.avatar
            }).then(function () { block.textContent = '🔓'; toast('🚫 تم'); });
          }
        });
      };
    }

    var admin = $id('btn-admin-actions');
    if (admin && !admin.__b) {
      admin.__b = true;
      admin.onclick = function () { Core.switchTab('admin'); };
    }

    updateVisitorButtons();
  }

  function updateVisitorButtons() {
    if (S.mode !== 'visitor' || !S.me || !S.uid) return;
    var fb = Core.FB(); if (!fb) return;

    fb.get('users/' + S.uid + '/likes/' + S.me.uid).then(function (s) {
      var h = $id('btn-heart');
      if (h) { h.textContent = s ? '💔' : '❤️'; h.classList.toggle('active', !!s); }
    }).catch(function () {});

    fb.get('users/' + S.me.uid + '/friends/' + S.uid).then(function (f) {
      var btn = $id('btn-friend'); if (!btn) return;
      if (f.val() && f.val().status === 'accepted') { btn.textContent = '✅'; return; }
      fb.get('users/' + S.me.uid + '/friend_requests/' + S.uid).then(function (r1) {
        fb.get('users/' + S.uid + '/friend_requests/' + S.me.uid).then(function (r2) {
          if (r1.exists()) btn.textContent = '⏳';
          else if (r2.exists()) btn.textContent = '📩';
          else btn.textContent = '➕';
        });
      });
    }).catch(function () {});

    fb.get('users/' + S.me.uid + '/blocked/' + S.uid).then(function (b) {
      var btn = $id('btn-block');
      if (btn) btn.textContent = b.exists() ? '🔓' : '🚫';
    }).catch(function () {});
  }

  /* ═══ Owner ═══ */
  function bindDanger() {
    var lo = $id('btn-logout');
    if (lo && !lo.__b) {
      lo.__b = true;
      lo.onclick = function () {
        if (!confirm('تسجيل الخروج؟')) return;
        try {
          if (window.parent && window.parent.QamarAuth && window.parent.QamarAuth.signOut) {
            window.parent.QamarAuth.signOut().then(function () {
              try { window.parent.postMessage({ action: 'logout' }, '*'); } catch (e) {}
            });
          }
        } catch (e) {}
      };
    }
    var del = $id('btn-delete-account');
    if (del && !del.__b) {
      del.__b = true;
      del.onclick = function () {
        openModal({
          title: '🗑️ حذف الحساب',
          html: '<div style="color:#ff8888;font-size:13px;text-align:center;line-height:1.6;padding:8px;background:rgba(255,68,68,.15);border-radius:8px;margin-bottom:10px">⚠️ سيُحذف حسابك نهائياً.<br>اكتب <b>حذف</b> للتأكيد:</div><input id="pm-input" type="text" placeholder="حذف" style="width:100%;padding:12px;background:rgba(255,255,255,.08);border:1px solid #ff4444;border-radius:10px;color:#fff;font-family:inherit;text-align:center;box-sizing:border-box">',
          okLabel: 'حذف',
          onSave: function (v) {
            if ((v || '').trim() !== 'حذف') { toast('⚠️ غير صحيح'); return; }
            try {
              if (window.parent && window.parent.QamarAuth && window.parent.QamarAuth.deleteAccount) {
                window.parent.QamarAuth.deleteAccount().then(function () {
                  toast('✅ تم'); setTimeout(function () { location.reload(); }, 1000);
                });
              }
            } catch (e) {}
          }
        });
      };
    }
  }

  function bindEdit() {
    var ne = $id('btn-edit-username');
    if (ne && !ne.__b) {
      ne.__b = true;
      ne.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        openModal({
          title: '✏️ تعديل الاسم', type: 'input',
          value: S.subject.name || '', maxLength: 35,
          onSave: function (v) {
            v = (v || '').trim();
            if (!v || v.length < 2) { toast('⚠️ اسم قصير'); return; }
            saveAndRefresh({ name: v });
          }
        });
      };
    }
    var be = $id('btn-edit-bio');
    if (be && !be.__b) {
      be.__b = true;
      be.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        openModal({
          title: '✏️ تعديل البايو', type: 'input',
          value: S.subject.bio || '', maxLength: 120,
          onSave: function (v) { saveAndRefresh({ bio: (v || '').trim() }); }
        });
      };
    }
  }

  function bindUploads() {
    var b;
    if ((b = $id('btn-upload-avatar'))) b.onclick = function () { uploadField('avatar-file-input', 'avatar', 5); };
    if ((b = $id('btn-upload-cover'))) b.onclick = function () { uploadField('cover-file-input', 'cover', 32, { coverType: 'image' }); };
    if ((b = $id('btn-upload-music'))) b.onclick = function () { uploadField('music-file-input', 'musicURL', 10); };
    if ((b = $id('btn-upload-poetry-bg'))) b.onclick = function () { uploadField('poetry-bg-input', 'poetryBg', 5); };
    if ((b = $id('btn-upload-poetry-attach'))) b.onclick = function () { uploadField('poetry-attach-input', 'poetryAttachment', 5); };
    if ((b = $id('btn-remove-avatar'))) b.onclick = function () { if (!confirm('إزالة؟')) return; saveAndRefresh({ avatar: null }).then(function () { renderPage('avatar-page'); }); };
    if ((b = $id('btn-remove-cover'))) b.onclick = function () { if (!confirm('إزالة؟')) return; saveAndRefresh({ cover: null, coverType: null }).then(function () { renderPage('cover-page'); }); };
    if ((b = $id('btn-remove-music'))) b.onclick = function () { if (!confirm('إزالة؟')) return; saveAndRefresh({ musicURL: null }).then(function () { renderPage('music'); }); };
    if ((b = $id('btn-remove-frame'))) b.onclick = function () { saveAndRefresh({ avatarFrame: null }).then(renderFrames); };
    if ((b = $id('btn-remove-glow'))) b.onclick = function () { saveAndRefresh({ profileGlow: null }).then(renderGlows); };
    if ((b = $id('btn-remove-poetry-bg'))) b.onclick = function () { saveAndRefresh({ poetryBg: null }).then(renderPoetryPreviews); };
    if ((b = $id('btn-remove-poetry-attach'))) b.onclick = function () { saveAndRefresh({ poetryAttachment: null }).then(renderPoetryPreviews); };
    if ((b = $id('btn-remove-poetry'))) b.onclick = function () { if (!confirm('حذف الكل؟')) return; saveAndRefresh({ poetry: '', poetryBg: null, poetryAttachment: null }); };
    if ((b = $id('btn-save-poetry'))) b.onclick = function () {
      var inp = $id('poetry-input');
      saveAndRefresh({ poetry: (inp ? inp.value : '') || '' });
    };
    if ((b = $id('remove-name-color'))) b.onclick = function () { saveAndRefresh({ nameColor: null }); };
    if ((b = $id('remove-name-gradient'))) b.onclick = function () { saveAndRefresh({ nameGradient: null }); };
    if ((b = $id('remove-name-bg-color'))) b.onclick = function () { saveAndRefresh({ nameBgColor: null }); };
    if ((b = $id('remove-name-bg-gradient'))) b.onclick = function () { saveAndRefresh({ nameBgGradient: null }); };
    var pi = $id('poetry-input');
    if (pi && !pi.__b) {
      pi.__b = true;
      pi.oninput = function () { var cc = $id('poetry-char-count'); if (cc) cc.textContent = pi.value.length; };
    }
  }

  function bindSettingsNav() {
    document.querySelectorAll('[data-open-page]').forEach(function (b) {
      if (b.__navb) return;
      b.__navb = true;
      b.onclick = function (e) {
        e.preventDefault();
        showPage(b.getAttribute('data-open-page'));
      };
    });
    document.querySelectorAll('[data-back]').forEach(function (b) {
      if (b.__backb) return;
      b.__backb = true;
      b.onclick = function (e) {
        e.preventDefault();
        back();
      };
    });
  }

  function bindChrome() {
    var c = $id('btn-close');
    if (c && !c.__b) {
      c.__b = true;
      c.onclick = function (e) {
        e.preventDefault();
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ action: 'closeProfile' }, '*');
          }
        } catch (err) {}
      };
    }

    // ⭐ زر المعاينة — يحوّل من owner إلى visitor view
    var col = $id('btn-collapse-info');
    if (col && !col.__b) {
      col.__b = true;
      col.onclick = function (e) {
        e.preventDefault();
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({
              action: 'openProfileAsVisitor',
              uid: S.uid
            }, '*');
          }
        } catch (err) {}
      };
    }

    var u = $id('profile-username');
    if (u && !u.__b) {
      u.__b = true;
      u.onclick = function () {
        if (S.mode === 'owner') {
          var be = $id('btn-edit-username');
          if (be) be.click();
        }
      };
    }
  }

  function bind(state) {
    var isOwner = (state && state.mode === 'owner');
    var isPreview = /[?&]preview=1/.test(location.search);

    bindChrome();
    bindSettingsNav();

    if (isOwner && !isPreview) {
      bindUploads();
      bindEdit();
      bindDanger();
    } else {
      bindVisitor();
    }

    console.log('[profile-actions] bound | mode=' + (isOwner ? 'owner' : 'visitor') + ' | preview=' + isPreview);
  }

  window.QamarProfileActions = {
    bind: bind, showPage: showPage, openModal: openModal, saveAndRefresh: saveAndRefresh
  };
  console.log('[profile-actions] ready');
})();
