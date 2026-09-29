/* ============================================================
   🌙 قمر الشام — media/media-picker.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarMediaPicker) return;

  var VERSION = '1.0';
  var St = { inited: false, activeInput: null };

  function $id(id) { return document.getElementById(id); }

  function isGuest() {
    try {
      var A = window.QamarAuth;
      if (A && typeof A.isGuest === 'function') return A.isGuest();
      if (A && A.currentUser) return !!A.currentUser.isAnonymous;
    } catch (e) {}
    return false;
  }

  function isMember() {
    try {
      var A = window.QamarAuth;
      if (A && typeof A.isMember === 'function') return A.isMember();
    } catch (e) {}
    return !isGuest();
  }

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
        var file = inp.files && inp.files[0];
        cleanup();
        resolve(file || null);
      });
      inp.addEventListener('cancel', function () { cleanup(); resolve(null); });

      inp.click();
    });
  }

  function pickImage() {
    return pickFile('image/*');
  }

  function pickAudio() {
    return pickFile('audio/*');
  }

  function pickVideo() {
    return pickFile('video/*');
  }

  function pickAny() {
    return pickFile('image/*,audio/*,video/*');
  }

  function showActionSheet() {
    if (isGuest()) {
      toast('الرفع للأعضاء فقط — رقّي حسابك', 'warn');
      try {
        if (window.EventBus && window.EventBus.emit) {
          window.EventBus.emit('guest:blocked', { feature: 'upload' });
        }
      } catch (e) {}
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
      '<div style="width:40px;height:4px;background:#4b5563;border-radius:2px;' +
        'margin:0 auto 14px"></div>' +
      '<div style="font-size:14px;font-weight:900;color:#d4af37;' +
        'margin-bottom:14px;text-align:center">📎 إرفاق ملف</div>' +
      '<button class="mp-btn" data-kind="image" style="width:100%;padding:14px;' +
        'border-radius:12px;background:rgba(212,175,55,.1);' +
        'border:1px solid rgba(212,175,55,.3);color:#f3f4f6;font-size:14px;' +
        'font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px;' +
        'display:flex;align-items:center;gap:12px">' +
        '<span style="font-size:22px">🖼️</span>' +
        '<span style="flex:1;text-align:right">صورة / GIF</span>' +
        '<span style="font-size:11px;color:#9ca3af">5MB</span>' +
      '</button>' +
      '<button class="mp-btn" data-kind="audio" style="width:100%;padding:14px;' +
        'border-radius:12px;background:rgba(168,85,247,.1);' +
        'border:1px solid rgba(168,85,247,.3);color:#f3f4f6;font-size:14px;' +
        'font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px;' +
        'display:flex;align-items:center;gap:12px">' +
        '<span style="font-size:22px">🎵</span>' +
        '<span style="flex:1;text-align:right">صوتي</span>' +
        '<span style="font-size:11px;color:#9ca3af">10MB</span>' +
      '</button>' +
      '<button class="mp-btn" data-kind="video" style="width:100%;padding:14px;' +
        'border-radius:12px;background:rgba(59,130,246,.1);' +
        'border:1px solid rgba(59,130,246,.3);color:#f3f4f6;font-size:14px;' +
        'font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px;' +
        'display:flex;align-items:center;gap:12px">' +
        '<span style="font-size:22px">🎬</span>' +
        '<span style="flex:1;text-align:right">فيديو</span>' +
        '<span style="font-size:11px;color:#9ca3af">20MB</span>' +
      '</button>' +
      '<button id="mp-cancel" style="width:100%;padding:12px;' +
        'border-radius:12px;background:transparent;' +
        'border:1px solid rgba(255,255,255,.1);color:#9ca3af;font-size:13px;' +
        'font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px">' +
        'إلغاء</button>';

    sheet.appendChild(card);
    document.body.appendChild(sheet);

    requestAnimationFrame(function () {
      card.style.transform = 'translateY(0)';
    });

    function closeSheet() {
      card.style.transform = 'translateY(100%)';
      setTimeout(function () { try { sheet.remove(); } catch (e) {} }, 250);
    }

    sheet.addEventListener('click', function (e) {
      if (e.target === sheet) closeSheet();
    });

    card.querySelector('#mp-cancel').addEventListener('click', closeSheet);

    card.querySelectorAll('.mp-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-kind');
        closeSheet();
        setTimeout(function () { pickAndUpload(kind); }, 200);
      });
    });
  }

  function pickAndUpload(kind) {
    var pick = kind === 'image' ? pickImage :
               kind === 'audio' ? pickAudio :
               kind === 'video' ? pickVideo : pickAny;

    pick().then(function (file) {
      if (!file) return;
      uploadAndSend(file);
    });
  }

  function uploadAndSend(file) {
    if (!window.QamarUploader) {
      toast('نظام الرفع غير متاح', 'error');
      return;
    }

    var v = window.QamarUploader.validate(file);
    if (!v.ok) { toast(v.error, 'error'); return; }

    var overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:19000;' +
      'display:flex;align-items:center;justify-content:center;' +
      'flex-direction:column;gap:14px;font-family:inherit';

    overlay.innerHTML =
      '<div style="width:64px;height:64px;border:4px solid rgba(212,175,55,.2);' +
        'border-top-color:#d4af37;border-radius:50%;animation:mpSpin 1s linear infinite">' +
      '</div>' +
      '<div id="mp-status" style="color:#f3f4f6;font-size:13px">جارٍ الرفع...</div>' +
      '<div style="width:200px;height:6px;background:rgba(255,255,255,.1);' +
        'border-radius:3px;overflow:hidden">' +
        '<div id="mp-bar" style="height:100%;width:0%;background:#d4af37;' +
          'transition:width .2s ease"></div>' +
      '</div>';

    if (!document.getElementById('mp-spin-style')) {
      var st = document.createElement('style');
      st.id = 'mp-spin-style';
      st.textContent = '@keyframes mpSpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(st);
    }

    document.body.appendChild(overlay);

    var setProgress = function (pct, msg) {
      var bar = overlay.querySelector('#mp-bar');
      var status = overlay.querySelector('#mp-status');
      if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
      if (status && msg) status.textContent = msg;
    };

    window.QamarUploader.upload(file, { onProgress: setProgress }).then(function (res) {
      try { overlay.remove(); } catch (e) {}

      var msg = {
        kind: res.kind,
        url: res.url,
        name: res.name,
        size: res.size
      };

      try {
        if (window.EventBus && window.EventBus.emit) {
          window.EventBus.emit('media:uploaded', msg);
        }
      } catch (e) {}

      if (window.QamarChat && typeof window.QamarChat.sendAttachment === 'function') {
        window.QamarChat.sendAttachment(msg);
      } else {
        try {
          if (window.EventBus && window.EventBus.emit) {
            window.EventBus.emit('chat:send-attachment', msg);
          }
        } catch (e) {}
      }
    }).catch(function (err) {
      try { overlay.remove(); } catch (e) {}
      toast('فشل الرفع: ' + (err && err.message ? err.message : 'خطأ'), 'error');
    });
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    var plusBtn = $id('plus-btn');
    if (plusBtn && !plusBtn.dataset.qmpHooked) {
      plusBtn.dataset.qmpHooked = '1';
      plusBtn.addEventListener('click', function (e) {
        e.preventDefault();
        showActionSheet();
      });
    }

    try {
      if (window.EventBus && window.EventBus.on) {
        window.EventBus.on('media:pick', function (data) {
          if (data && data.kind) pickAndUpload(data.kind);
          else showActionSheet();
        });
      }
    } catch (e) {}

    console.log('[media-picker] v' + VERSION + ' ready');
  }

  window.QamarMediaPicker = {
    version: VERSION,
    open: showActionSheet,
    pickImage: pickImage,
    pickAudio: pickAudio,
    pickVideo: pickVideo,
    pickAny: pickAny,
    uploadAndSend: uploadAndSend,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
