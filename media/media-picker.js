/* ============================================================
   🌙 قمر الشام — media/media-picker.js
   Version: 2.0 — corrected for chat-input.js compatibility
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarMediaPicker) return;

  var VERSION = '2.0';
  var St = { inited: false, sheet: null, bar: null };

  function $id(id) { return document.getElementById(id); }

  function emit(name, data) {
    try { if (window.EventBus && window.EventBus.emit) window.EventBus.emit(name, data); } catch (e) {}
  }

  function toast(msg, kind) {
    try {
      if (window.EventBus && window.EventBus.emit) {
        window.EventBus.emit('toast:show', { message: msg, kind: kind || 'info' });
      }
    } catch (e) {}
  }

  /* ==================== file pickers ==================== */

  function pickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept || '*/*';
      inp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(inp);

      var cleanup = function () {
        setTimeout(function () { try { inp.remove(); } catch (e) {} }, 500);
      };
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        cleanup(); resolve(f || null);
      });
      inp.addEventListener('cancel', function () { cleanup(); resolve(null); });
      inp.click();
    });
  }

  function pickImage() { return pickFile('image/*'); }
  function pickAudio() { return pickFile('audio/*'); }
  function pickVideo() { return pickFile('video/*'); }
  function pickAny()   { return pickFile('image/*,audio/*,video/*'); }

  /* ==================== upload + send ==================== */

  function handleFile(file) {
    if (!file) return;
    if (!window.QamarUploader) {
      toast('نظام الرفع غير متاح', 'error');
      return;
    }
    var v = window.QamarUploader.validate(file);
    if (!v.ok) { toast(v.error, 'error'); return; }
    runUpload(file);
  }

  function runUpload(file) {
    var overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:19000;' +
      'display:flex;align-items:center;justify-content:center;' +
      'flex-direction:column;gap:14px;font-family:inherit';
    overlay.innerHTML =
      '<div style="width:64px;height:64px;border:4px solid rgba(212,175,55,.2);' +
        'border-top-color:#d4af37;border-radius:50%;animation:mpSpin 1s linear infinite"></div>' +
      '<div id="mp-status" style="color:#f3f4f6;font-size:13px">جارٍ الرفع...</div>' +
      '<div style="width:200px;height:6px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden">' +
        '<div id="mp-bar" style="height:100%;width:0%;background:#d4af37;transition:width .2s ease"></div>' +
      '</div>';
    if (!document.getElementById('mp-spin-style')) {
      var st = document.createElement('style');
      st.id = 'mp-spin-style';
      st.textContent = '@keyframes mpSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(st);
    }
    document.body.appendChild(overlay);

    var setP = function (pct, msg) {
      var b = overlay.querySelector('#mp-bar');
      var s = overlay.querySelector('#mp-status');
      if (b) b.style.width = Math.max(0, Math.min(100, pct)) + '%';
      if (s && msg) s.textContent = msg;
    };

    window.QamarUploader.upload(file, { onProgress: setP }).then(function (res) {
      try { overlay.remove(); } catch (e) {}
      emit('media:uploaded', res);
      if (window.QamarChat && typeof window.QamarChat.sendAttachment === 'function') {
        window.QamarChat.sendAttachment({
          kind: res.kind, url: res.url, name: res.name, size: res.size
        });
      } else {
        emit('chat:send-attachment', {
          kind: res.kind, url: res.url, name: res.name, size: res.size
        });
      }
    }).catch(function (err) {
      try { overlay.remove(); } catch (e) {}
      toast('فشل الرفع: ' + (err && err.message ? err.message : 'خطأ'), 'error');
    });
  }

  /* ==================== Action sheet ==================== */

  function openSheet() {
    if (St.sheet) return;

    var isGuest = false;
    try {
      if (window.QamarAuth && typeof window.QamarAuth.isGuest === 'function') {
        isGuest = window.QamarAuth.isGuest();
      }
    } catch (e) {}

    if (isGuest) {
      emit('guest:blocked', { feature: 'upload' });
      return;
    }

    var sheet = document.createElement('div');
    sheet.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:18000;' +
      'display:flex;align-items:flex-end;justify-content:center;' +
      'padding-bottom:env(safe-area-inset-bottom);font-family:inherit';

    var card = document.createElement('div');
    card.style.cssText =
      'width:100%;max-width:480px;background:#0a0616;' +
      'border-top-left-radius:20px;border-top-right-radius:20px;' +
      'border:1px solid rgba(212,175,55,.3);border-bottom:none;' +
      'padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));' +
      'transform:translateY(100%);transition:transform .25s ease';

    card.innerHTML =
      '<div style="width:40px;height:4px;background:#4b5563;border-radius:2px;margin:0 auto 14px"></div>' +
      '<div style="font-size:14px;font-weight:900;color:#d4af37;margin-bottom:14px;text-align:center">📎 إرفاق ملف</div>' +
      '<button class="mp-btn" data-kind="image" style="width:100%;padding:14px;border-radius:12px;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.3);color:#f3f4f6;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px;display:flex;align-items:center;gap:12px"><span style="font-size:22px">🖼️</span><span style="flex:1;text-align:right">صورة / GIF</span><span style="font-size:11px;color:#9ca3af">5MB</span></button>' +
      '<button class="mp-btn" data-kind="audio" style="width:100%;padding:14px;border-radius:12px;background:rgba(168,85,247,.1);border:1px solid rgba(168,85,247,.3);color:#f3f4f6;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px;display:flex;align-items:center;gap:12px"><span style="font-size:22px">🎵</span><span style="flex:1;text-align:right">صوتي</span><span style="font-size:11px;color:#9ca3af">10MB</span></button>' +
      '<button class="mp-btn" data-kind="video" style="width:100%;padding:14px;border-radius:12px;background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);color:#f3f4f6;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px;display:flex;align-items:center;gap:12px"><span style="font-size:22px">🎬</span><span style="flex:1;text-align:right">فيديو</span><span style="font-size:11px;color:#9ca3af">20MB</span></button>' +
      '<button id="mp-cancel" style="width:100%;padding:12px;border-radius:12px;background:transparent;border:1px solid rgba(255,255,255,.1);color:#9ca3af;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px">إلغاء</button>';

    sheet.appendChild(card);
    document.body.appendChild(sheet);
    St.sheet = sheet;

    requestAnimationFrame(function () { card.style.transform = 'translateY(0)'; });

    function closeSheet() {
      card.style.transform = 'translateY(100%)';
      setTimeout(function () { try { sheet.remove(); } catch (e) {} St.sheet = null; }, 250);
    }

    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
    card.querySelector('#mp-cancel').addEventListener('click', closeSheet);

    card.querySelectorAll('.mp-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-kind');
        closeSheet();
        setTimeout(function () {
          var pick = kind === 'image' ? pickImage :
                     kind === 'audio' ? pickAudio :
                     kind === 'video' ? pickVideo : pickAny;
          pick().then(function (f) { if (f) handleFile(f); });
        }, 220);
      });
    });
  }

  /* ==================== Floating bar (7 tools) ==================== */

  function openFloatingBar() {
    if (St.bar) { closeFloatingBar(); return; }

    var isGuest = false;
    try {
      if (window.QamarAuth && typeof window.QamarAuth.isGuest === 'function') {
        isGuest = window.QamarAuth.isGuest();
      }
    } catch (e) {}
    if (isGuest) {
      emit('guest:blocked', { feature: 'upload' });
      return;
    }

    var bar = document.createElement('div');
    bar.id = 'qmp-floating-bar';
    bar.style.cssText =
      'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);' +
      'background:#0a0616;border:1px solid rgba(212,175,55,.35);' +
      'border-radius:16px;padding:8px;display:flex;gap:6px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,.7);z-index:9500;' +
      'font-family:inherit;max-width:92vw;overflow-x:auto';

    var tools = [
      { id: 'upload',  icon: '📎', label: 'ملف' },
      { id: 'emoji',   icon: '😀', label: 'إيموجي' },
      { id: 'dice',    icon: '🎲', label: 'نرد' },
      { id: 'youtube', icon: '▶️', label: 'يوتيوب' },
      { id: 'painter', icon: '🎨', label: 'رسم' },
      { id: 'styler',  icon: '✨', label: 'نص' }
    ];

    tools.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-tool', t.id);
      b.style.cssText =
        'min-width:56px;padding:8px 6px;border-radius:10px;' +
        'background:transparent;border:none;color:#f3f4f6;' +
        'font-family:inherit;font-size:10px;font-weight:700;' +
        'display:flex;flex-direction:column;align-items:center;gap:4px;' +
        'cursor:pointer';
      b.innerHTML = '<span style="font-size:22px">' + t.icon + '</span><span>' + t.label + '</span>';
      b.addEventListener('click', function (e) {
        e.preventDefault();
        handleTool(t.id);
      });
      bar.appendChild(b);
    });

    document.body.appendChild(bar);
    St.bar = bar;

    setTimeout(function () {
      var closer = function (e) {
        if (bar && !bar.contains(e.target) &&
            !(e.target.closest && e.target.closest('#plus-btn'))) {
          closeFloatingBar();
          document.removeEventListener('click', closer, true);
        }
      };
      document.addEventListener('click', closer, true);
    }, 80);
  }

  function closeFloatingBar() {
    if (St.bar && St.bar.parentNode) {
      St.bar.parentNode.removeChild(St.bar);
    }
    St.bar = null;
  }

  function handleTool(id) {
    if (id === 'upload') {
      closeFloatingBar();
      setTimeout(openSheet, 150);
    } else if (id === 'emoji') {
      closeFloatingBar();
      emit('emoji:open', {});
    } else if (id === 'dice') {
      closeFloatingBar();
      emit('dice:open', {});
      if (window.QamarDice && window.QamarDice.open) {
        try { window.QamarDice.open(); } catch (e) {}
      }
    } else if (id === 'youtube') {
      closeFloatingBar();
      emit('youtube:open', {});
      if (window.QamarYoutube && window.QamarYoutube.open) {
        try { window.QamarYoutube.open(); } catch (e) {}
      }
    } else if (id === 'painter') {
      closeFloatingBar();
      emit('painter:open', {});
      if (window.QamarPainter && window.QamarPainter.open) {
        try { window.QamarPainter.open(); } catch (e) {}
      }
    } else if (id === 'styler') {
      closeFloatingBar();
      emit('text-styler:open', {});
      if (window.QamarTextStyler && window.QamarTextStyler.open) {
        try { window.QamarTextStyler.open(); } catch (e) {}
      }
    }
  }

  /* ==================== Event hooks ==================== */

  function init() {
    if (St.inited) return;
    St.inited = true;

    try {
      if (window.EventBus && typeof window.EventBus.on === 'function') {
        // chat-input emits these
        window.EventBus.on('floating-bar:open', function () { openFloatingBar(); });
        window.EventBus.on('floating-bar:close', function () { closeFloatingBar(); });

        // paste from chat-input
        window.EventBus.on('media:paste', function (d) {
          if (d && d.file) handleFile(d.file);
        });
        window.EventBus.on('media:pick', function (d) {
          if (d && d.kind) {
            var pick = d.kind === 'image' ? pickImage :
                       d.kind === 'audio' ? pickAudio :
                       d.kind === 'video' ? pickVideo : pickAny;
            pick().then(function (f) { if (f) handleFile(f); });
          } else {
            openSheet();
          }
        });
      }
    } catch (e) {}

    console.log('[media-picker] v' + VERSION + ' ready');
  }

  window.QamarMediaPicker = {
    version: VERSION,
    open: openSheet,
    openFloatingBar: openFloatingBar,
    closeFloatingBar: closeFloatingBar,
    openEmoji: function () { emit('emoji:open', {}); },
    handleFile: handleFile,
    pickImage: pickImage,
    pickAudio: pickAudio,
    pickVideo: pickVideo,
    pickAny: pickAny,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
