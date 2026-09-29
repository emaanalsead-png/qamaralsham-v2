/* ============================================================
   🌙 قمر الشام — ui/context-menu.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarContextMenu) return;

  var VERSION = '1.0';
  var MENU_ID = 'qamar-context-menu';
  var St = { inited: false, currentTarget: null, openedAt: 0 };

  function $id(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureMenu() {
    var m = $id(MENU_ID);
    if (m) return m;

    m = document.createElement('div');
    m.id = MENU_ID;
    m.className = 'qamar-ctx-menu';
    m.setAttribute('role', 'menu');
    m.style.cssText =
      'position:fixed;z-index:16000;background:#0a0616;' +
      'border:1px solid rgba(212,175,55,.4);border-radius:12px;' +
      'padding:6px;min-width:180px;max-width:280px;' +
      'box-shadow:0 10px 32px rgba(0,0,0,.8);' +
      'display:none;font-family:inherit;direction:rtl';

    document.body.appendChild(m);

    m.addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('.ctx-item');
      if (!item) return;
      var idx = parseInt(item.getAttribute('data-idx'), 10);
      var items = St.currentItems || [];
      var it = items[idx];
      if (!it) return;
      close();
      if (typeof it.onClick === 'function') {
        try { it.onClick(St.currentTarget, it); } catch (err) {}
      } else if (typeof it.action === 'function') {
        try { it.action(St.currentTarget, it); } catch (err) {}
      }
    });

    document.addEventListener('click', function (e) {
      if (Date.now() - St.openedAt < 100) return;
      var m2 = $id(MENU_ID);
      if (!m2 || m2.style.display === 'none') return;
      if (!m2.contains(e.target)) close();
    }, true);

    document.addEventListener('scroll', function () {
      if (St.currentItems) close();
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    return m;
  }

  function normalize(items) {
    if (!Array.isArray(items)) return [];
    return items.map(function (it) {
      if (!it) return null;
      if (typeof it === 'string') return { label: it };
      return {
        label: it.label || it.text || it.title || '—',
        icon: it.icon || '',
        danger: !!it.danger,
        disabled: !!it.disabled,
        divider: !!it.divider,
        onClick: it.onClick || it.action || null,
        key: it.key || null,
        _raw: it
      };
    }).filter(Boolean);
  }

  function open(x, y, items, target) {
    var list = normalize(items);
    if (!list.length) return;

    var m = ensureMenu();
    St.currentItems = list;
    St.currentTarget = target || null;

    var html = list.map(function (it, i) {
      if (it.divider) {
        return '<div class="ctx-divider" style="height:1px;background:rgba(255,255,255,.08);margin:4px 6px"></div>';
      }
      var color = it.danger ? '#ef4444' : (it.disabled ? '#4b5563' : '#f3f4f6');
      var bgHover = it.danger ? 'rgba(239,68,68,.12)' : 'rgba(212,175,55,.12)';
      var cursor = it.disabled ? 'not-allowed' : 'pointer';
      var opacity = it.disabled ? '0.5' : '1';
      return '<div class="ctx-item" data-idx="' + i + '" ' +
        'style="display:flex;align-items:center;gap:10px;padding:10px 12px;' +
        'border-radius:8px;cursor:' + cursor + ';font-size:13px;' +
        'color:' + color + ';opacity:' + opacity + ';transition:background .12s ease" ' +
        'onmouseover="this.style.background=\'' + bgHover + '\'" ' +
        'onmouseout="this.style.background=\'transparent\'">' +
        (it.icon ? '<span style="font-size:16px;width:20px;text-align:center">' + esc(it.icon) + '</span>' : '') +
        '<span style="flex:1">' + esc(it.label) + '</span>' +
      '</div>';
    }).join('');

    m.innerHTML = html;
    m.style.display = 'block';
    m.style.top = '0px';
    m.style.left = '0px';
    m.style.right = 'auto';
    m.style.bottom = 'auto';

    var rect = m.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var padding = 8;

    var left = x;
    var top = y;
    if (left + rect.width > vw - padding) left = vw - rect.width - padding;
    if (left < padding) left = padding;
    if (top + rect.height > vh - padding) top = vh - rect.height - padding;
    if (top < padding) top = padding;

    m.style.left = left + 'px';
    m.style.top = top + 'px';

    St.openedAt = Date.now();
    try {
      if (window.EventBus && window.EventBus.emit) {
        window.EventBus.emit('context-menu:open', { target: target });
      }
    } catch (e) {}
  }

  function close() {
    var m = $id(MENU_ID);
    if (m) m.style.display = 'none';
    St.currentItems = null;
    St.currentTarget = null;
  }

  function attachLongPress(el, itemsProvider) {
    if (!el || el.dataset.qcmHooked) return;
    el.dataset.qcmHooked = '1';

    var timer = null;
    var startX = 0, startY = 0;
    var triggered = false;

    function cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    el.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      triggered = false;
      cancel();
      timer = setTimeout(function () {
        triggered = true;
        var items = typeof itemsProvider === 'function' ? itemsProvider(el) : itemsProvider;
        if (items && items.length) {
          try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) {}
          open(startX, startY, items, el);
        }
      }, 500);
    }, { passive: true });

    el.addEventListener('touchmove', function (e) {
      if (!e.touches || !e.touches[0]) return;
      var dx = Math.abs(e.touches[0].clientX - startX);
      var dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > 10 || dy > 10) cancel();
    }, { passive: true });

    el.addEventListener('touchend', function (e) {
      cancel();
      if (triggered) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    el.addEventListener('touchcancel', cancel);

    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var items = typeof itemsProvider === 'function' ? itemsProvider(el) : itemsProvider;
      if (items && items.length) open(e.clientX, e.clientY, items, el);
    });
  }

  function init() {
    if (St.inited) return;
    St.inited = true;
    ensureMenu();
    console.log('[context-menu] v' + VERSION + ' ready');
  }

  window.QamarContextMenu = {
    version: VERSION,
    open: open,
    close: close,
    attachLongPress: attachLongPress,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 100);
  }
})();
