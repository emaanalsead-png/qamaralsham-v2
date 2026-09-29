/* ============================================================
   🌙 قمر الشام — media/viewer.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarViewer) return;

  var VERSION = '1.0';
  var VIEWER_ID = 'qamar-viewer';
  var St = { inited: false, items: [], index: 0, onClose: null };

  function $id(id) { return document.getElementById(id); }

  function ensure() {
    var v = $id(VIEWER_ID);
    if (v) return v;

    v = document.createElement('div');
    v.id = VIEWER_ID;
    v.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.96);z-index:17000;' +
      'display:none;flex-direction:column;direction:ltr;touch-action:none';

    v.innerHTML =
      '<div id="qv-top" style="position:absolute;top:0;left:0;right:0;' +
        'padding:12px;padding-top:max(12px,env(safe-area-inset-top));' +
        'display:flex;gap:8px;z-index:2;' +
        'background:linear-gradient(180deg,rgba(0,0,0,.7),transparent)">' +
        '<button id="qv-close" style="width:40px;height:40px;border-radius:50%;' +
          'background:rgba(255,255,255,.1);color:#fff;border:none;font-size:18px;' +
          'cursor:pointer;backdrop-filter:blur(10px)">✕</button>' +
        '<div style="flex:1;color:#fff;font-size:13px;display:flex;' +
          'align-items:center;padding:0 12px" id="qv-title"></div>' +
        '<button id="qv-download" style="width:40px;height:40px;border-radius:50%;' +
          'background:rgba(255,255,255,.1);color:#fff;border:none;font-size:16px;' +
          'cursor:pointer;backdrop-filter:blur(10px)">⬇</button>' +
      '</div>' +
      '<div id="qv-stage" style="flex:1;display:flex;align-items:center;' +
        'justify-content:center;padding:60px 10px;position:relative"></div>' +
      '<div id="qv-counter" style="position:absolute;bottom:20px;' +
        'left:50%;transform:translateX(-50%);color:#fff;font-size:12px;' +
        'background:rgba(0,0,0,.6);padding:6px 12px;border-radius:12px;' +
        'backdrop-filter:blur(10px)"></div>' +
      '<button id="qv-prev" style="position:absolute;top:50%;right:10px;' +
        'transform:translateY(-50%);width:44px;height:44px;border-radius:50%;' +
        'background:rgba(255,255,255,.1);color:#fff;border:none;font-size:18px;' +
        'cursor:pointer;backdrop-filter:blur(10px)">‹</button>' +
      '<button id="qv-next" style="position:absolute;top:50%;left:10px;' +
        'transform:translateY(-50%);width:44px;height:44px;border-radius:50%;' +
        'background:rgba(255,255,255,.1);color:#fff;border:none;font-size:18px;' +
        'cursor:pointer;backdrop-filter:blur(10px)">›</button>';

    document.body.appendChild(v);

    v.querySelector('#qv-close').addEventListener('click', close);
    v.querySelector('#qv-prev').addEventListener('click', function () { go(-1); });
    v.querySelector('#qv-next').addEventListener('click', function () { go(1); });

    v.querySelector('#qv-download').addEventListener('click', function () {
      var item = St.items[St.index];
      if (!item || !item.src) return;
      var a = document.createElement('a');
      a.href = item.src;
      a.download = item.name || ('qamar_' + Date.now());
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    document.addEventListener('keydown', function (e) {
      if (v.style.display !== 'flex') return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(1);
      else if (e.key === 'ArrowRight') go(-1);
    });

    var startX = 0, startY = 0, startT = 0;
    v.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = Date.now();
    }, { passive: true });

    v.addEventListener('touchend', function (e) {
      if (!e.changedTouches || !e.changedTouches[0]) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      var dt = Date.now() - startT;
      if (dt > 500) return;
      if (Math.abs(dx) < 50 && Math.abs(dy) < 80) {
        if (dy > 100) close();
        return;
      }
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
        go(dx > 0 ? -1 : 1);
      }
    }, { passive: true });

    return v;
  }

  function render() {
    var v = $id(VIEWER_ID);
    if (!v) return;
    var stage = v.querySelector('#qv-stage');
    var title = v.querySelector('#qv-title');
    var counter = v.querySelector('#qv-counter');
    var item = St.items[St.index];

    if (!item) { close(); return; }

    if (item.type === 'video') {
      stage.innerHTML =
        '<video src="' + item.src + '" controls autoplay playsinline ' +
        'style="max-width:100%;max-height:100%;border-radius:8px"></video>';
    } else if (item.type === 'audio') {
      stage.innerHTML =
        '<div style="text-align:center;color:#fff">' +
          '<div style="font-size:80px;margin-bottom:20px">🎵</div>' +
          '<audio src="' + item.src + '" controls autoplay ' +
            'style="width:min(80vw,400px)"></audio>' +
        '</div>';
    } else {
      stage.innerHTML =
        '<img src="' + item.src + '" alt="" ' +
        'style="max-width:100%;max-height:100%;border-radius:8px;' +
        'object-fit:contain" ' +
        'onerror="this.style.display=\'none\';this.parentElement.innerHTML=' +
        '\'<div style=&quot;color:#fff;text-align:center&quot;>⚠️ فشل التحميل</div>\'">';
    }

    if (title) title.textContent = item.name || '';
    if (counter) {
      if (St.items.length > 1) {
        counter.textContent = (St.index + 1) + ' / ' + St.items.length;
        counter.style.display = 'block';
      } else {
        counter.style.display = 'none';
      }
    }

    v.querySelector('#qv-prev').style.display = St.items.length > 1 ? 'block' : 'none';
    v.querySelector('#qv-next').style.display = St.items.length > 1 ? 'block' : 'none';
  }

  function open(items, index, opts) {
    if (!Array.isArray(items)) items = [items];
    if (!items.length) return;

    St.items = items.map(function (it) {
      if (typeof it === 'string') return { src: it, type: 'image' };
      return {
        src: it.src || it.url || it.href,
        type: it.type || guessType(it.src || it.url || ''),
        name: it.name || it.title || ''
      };
    }).filter(function (it) { return it.src; });

    St.index = Math.max(0, Math.min(index || 0, St.items.length - 1));
    St.onClose = opts && opts.onClose;

    var v = ensure();
    v.style.display = 'flex';
    render();
  }

  function guessType(src) {
    var s = String(src).toLowerCase();
    if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(s)) return 'video';
    if (/\.(mp3|ogg|wav|m4a|aac|opus|webm)(\?|$)/.test(s)) return 'audio';
    return 'image';
  }

  function go(dir) {
    if (St.items.length < 2) return;
    St.index = (St.index + dir + St.items.length) % St.items.length;
    render();
  }

  function close() {
    var v = $id(VIEWER_ID);
    if (!v) return;
    v.style.display = 'none';
    var stage = v.querySelector('#qv-stage');
    if (stage) stage.innerHTML = '';
    if (typeof St.onClose === 'function') {
      try { St.onClose(); } catch (e) {}
    }
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-viewer-src], .msg-att-img, .msg-att-video');
      if (!el) return;
      var src = el.getAttribute('data-viewer-src') ||
                el.getAttribute('src') ||
                (el.querySelector && el.querySelector('img,video') &&
                 (el.querySelector('img,video').src));
      if (!src) return;
      var type = el.tagName === 'VIDEO' ? 'video' : 'image';
      e.preventDefault();
      open([{ src: src, type: type }], 0);
    });

    console.log('[viewer] v' + VERSION + ' ready');
  }

  window.QamarViewer = {
    version: VERSION,
    open: open,
    close: close,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
