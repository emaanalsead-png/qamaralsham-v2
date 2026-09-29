/* ============================================================
   🌙 قمر الشام — misc/youtube.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarYoutube) return;

  var VERSION = '1.0';
  var MODAL_ID = 'qamar-youtube-modal';
  var St = { inited: false, current: null };

  function $id(id) { return document.getElementById(id); }

  function emit(name, data) {
    try { if (window.EventBus && window.EventBus.emit) window.EventBus.emit(name, data); } catch (e) {}
  }

  function extractId(url) {
    if (!url) return null;
    url = String(url).trim();
    // Already an ID (11 chars)
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

    var patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
      /[?&]v=([a-zA-Z0-9_-]{11})/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = url.match(patterns[i]);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  function buildModal() {
    var old = $id(MODAL_ID);
    if (old) return old;

    var ov = document.createElement('div');
    ov.id = MODAL_ID;
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:17000;' +
      'display:flex;align-items:center;justify-content:center;padding:16px;' +
      'font-family:inherit';

    var card = document.createElement('div');
    card.style.cssText =
      'width:100%;max-width:460px;background:#0a0616;' +
      'border:1px solid rgba(212,175,55,.35);border-radius:18px;padding:18px;' +
      'direction:rtl;max-height:90vh;overflow-y:auto';

    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div style="color:#d4af37;font-size:16px;font-weight:900">▶️ يوتيوب</div>' +
        '<button id="qy-close" style="width:32px;height:32px;border-radius:50%;' +
          'background:transparent;border:1px solid rgba(255,255,255,.1);' +
          'color:#9ca3af;font-size:14px;cursor:pointer;font-family:inherit">✕</button>' +
      '</div>' +
      '<input id="qy-url" type="url" placeholder="الصق رابط يوتيوب أو معرّف الفيديو..." ' +
        'style="width:100%;padding:12px 14px;border-radius:10px;' +
        'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);' +
        'color:#f3f4f6;font-size:13px;font-family:inherit;margin-bottom:10px;' +
        'box-sizing:border-box;direction:ltr;text-align:left">' +
      '<button id="qy-load" style="width:100%;padding:12px;border-radius:10px;' +
        'background:linear-gradient(135deg,#ff0000,#cc0000);color:#fff;' +
        'font-weight:900;font-size:13px;border:none;cursor:pointer;' +
        'font-family:inherit;margin-bottom:14px">تحميل</button>' +
      '<div id="qy-preview" style="display:none;margin-bottom:14px"></div>' +
      '<div id="qy-error" style="display:none;color:#ef4444;font-size:12px;' +
        'text-align:center;padding:10px"></div>' +
      '<button id="qy-send" style="display:none;width:100%;padding:12px;' +
        'border-radius:10px;background:linear-gradient(135deg,#d4af37,#b8860b);' +
        'color:#000;font-weight:900;font-size:13px;border:none;cursor:pointer;' +
        'font-family:inherit">إرسال إلى الشات</button>';

    ov.appendChild(card);
    document.body.appendChild(ov);

    card.querySelector('#qy-close').addEventListener('click', close);
    card.querySelector('#qy-load').addEventListener('click', doLoad);
    card.querySelector('#qy-send').addEventListener('click', doSend);

    card.querySelector('#qy-url').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doLoad();
    });

    ov.addEventListener('click', function (e) {
      if (e.target === ov) close();
    });

    return ov;
  }

  function doLoad() {
    var url = $id('qy-url') && $id('qy-url').value;
    var id = extractId(url);
    var errEl = $id('qy-error');
    var prev = $id('qy-preview');
    var sendBtn = $id('qy-send');

    if (!id) {
      if (errEl) { errEl.textContent = '⚠️ رابط غير صحيح'; errEl.style.display = 'block'; }
      if (prev) prev.style.display = 'none';
      if (sendBtn) sendBtn.style.display = 'none';
      St.current = null;
      return;
    }

    St.current = { id: id, url: 'https://youtu.be/' + id };

    if (errEl) errEl.style.display = 'none';
    if (prev) {
      prev.innerHTML =
        '<div style="border-radius:12px;overflow:hidden;background:#000;' +
          'aspect-ratio:16/9">' +
          '<iframe width="100%" height="100%" ' +
            'src="https://www.youtube.com/embed/' + id + '" ' +
            'frameborder="0" allowfullscreen ' +
            'style="display:block"></iframe>' +
        '</div>';
      prev.style.display = 'block';
    }
    if (sendBtn) sendBtn.style.display = 'block';
  }

  function doSend() {
    if (!St.current) return;
    var token = '[yt:' + St.current.id + ']';
    var text = '▶️ يوتيوب: ' + St.current.url + ' ' + token;

    if (window.QamarChat && typeof window.QamarChat.send === 'function') {
      try { window.QamarChat.send(text); } catch (e) {}
    } else {
      emit('chat:send-attachment', { kind: 'youtube', url: St.current.url, videoId: St.current.id });
    }

    emit('youtube:shared', { videoId: St.current.id });
    close();
  }

  function open() {
    var ov = buildModal();
    ov.style.display = 'flex';
    setTimeout(function () {
      var inp = $id('qy-url');
      if (inp) { try { inp.focus(); } catch (e) {} }
    }, 100);
  }

  function close() {
    var ov = $id(MODAL_ID);
    if (ov) ov.style.display = 'none';
    St.current = null;
    var inp = $id('qy-url');
    if (inp) inp.value = '';
    var prev = $id('qy-preview');
    if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; }
    var sb = $id('qy-send');
    if (sb) sb.style.display = 'none';
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    try {
      if (window.EventBus && typeof window.EventBus.on === 'function') {
        window.EventBus.on('youtube:open', function () { open(); });
      }
    } catch (e) {}

    console.log('[youtube] v' + VERSION + ' ready');
  }

  window.QamarYoutube = {
    version: VERSION,
    open: open,
    close: close,
    extractId: extractId,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
