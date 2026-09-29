/* ============================================================
   🌙 قمر الشام — ui/sidebar.js
   Version: 1.0
   مدير عام للـ Sidebars — utility فقط
   
   API:
   - QamarSidebar.open(id)      → يفتح sidebar ويغلق غيره
   - QamarSidebar.close()       → يغلق الكل
   - QamarSidebar.toggle(id)
   - QamarSidebar.current()     → id الحالي أو null
   - QamarSidebar.exists(id)
   
   Hooks (آمنة — لا تتعارض مع notifications.js):
   - backdrop click → close all
   - .sidebar-close buttons (event delegation) → close all
   ============================================================ */
(function () {
  'use strict';

  if (window.QamarSidebar) return;

  var VERSION = '1.0';
  var St = { openId: null, inited: false };

  function $id(id) { return document.getElementById(id); }

  function allSidebars() {
    return Array.prototype.slice.call(document.querySelectorAll('.sidebar'));
  }

  function setVisible(el, visible) {
    if (!el) return;
    if (visible) {
      el.classList.add('active', 'open');
      el.style.visibility = 'visible';
      el.style.pointerEvents = 'auto';
      el.style.transform = '';
    } else {
      el.classList.remove('active', 'open');
      el.style.visibility = '';
      el.style.pointerEvents = '';
      el.style.transform = '';
    }
  }

  function open(id) {
    if (!id) return false;
    var target = $id(id);
    if (!target) return false;

    allSidebars().forEach(function (s) {
      if (s.id !== id) setVisible(s, false);
    });
    setVisible(target, true);

    var bd = $id('sidebar-backdrop');
    if (bd) {
      bd.classList.remove('hidden');
      bd.style.display = 'block';
      bd.style.opacity = '1';
      bd.style.pointerEvents = 'auto';
    }

    St.openId = id;
    emit('sidebar:open', { id: id });
    return true;
  }

  function close() {
    var prev = St.openId;
    allSidebars().forEach(function (s) { setVisible(s, false); });

    var bd = $id('sidebar-backdrop');
    if (bd) {
      bd.classList.add('hidden');
      bd.style.display = '';
      bd.style.opacity = '';
      bd.style.pointerEvents = '';
    }

    St.openId = null;
    if (prev) emit('sidebar:close', { id: prev });
  }

  function toggle(id) {
    if (St.openId === id) { close(); return false; }
    return open(id);
  }

  function emit(name, data) {
    try {
      if (window.EventBus && window.EventBus.emit) {
        window.EventBus.emit(name, data);
      }
    } catch (e) {}
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    var bd = $id('sidebar-backdrop');
    if (bd && !bd.dataset.qsbHooked) {
      bd.dataset.qsbHooked = '1';
      bd.addEventListener('click', function (e) {
        e.preventDefault();
        close();
      });
    }

    if (!document.body.dataset.qsbCloseHooked) {
      document.body.dataset.qsbCloseHooked = '1';
      document.body.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('.sidebar-close');
        if (btn) {
          e.preventDefault();
          close();
        }
      });
    }

    console.log('[sidebar] v' + VERSION + ' ready');
  }

  window.QamarSidebar = {
    version: VERSION,
    open: open,
    close: close,
    toggle: toggle,
    current: function () { return St.openId; },
    exists: function (id) { return !!$id(id); },
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 100);
  }
})();
