/* ============================================================
   🌙 قمر الشام — ui/modal.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarModal) return;

  var VERSION = '1.0';
  var St = { stack: [], inited: false };

  function $id(id) { return document.getElementById(id); }

  function emit(name, data) {
    try { if (window.EventBus && window.EventBus.emit) window.EventBus.emit(name, data); } catch (e) {}
  }

  function build(opts) {
    var id = opts.id || ('qm_' + Date.now().toString(36));
    if ($id(id)) return $id(id);

    var overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'modal qamar-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var card = document.createElement('div');
    card.className = 'modal-card' + (opts.cardClass ? ' ' + opts.cardClass : '');
    if (opts.maxWidth) card.style.maxWidth = opts.maxWidth;

    var close = document.createElement('button');
    close.className = 'modal-close';
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'إغلاق');
    card.appendChild(close);

    var body = document.createElement('div');
    body.className = 'qamar-modal-body';
    if (typeof opts.content === 'string') body.innerHTML = opts.content;
    else if (opts.content instanceof Node) body.appendChild(opts.content);
    card.appendChild(body);

    overlay.appendChild(card);
    return overlay;
  }

  function open(opts) {
    if (!opts) return null;
    var id = opts.id || ('qm_' + Date.now().toString(36));
    var existing = $id(id);
    if (existing) {
      existing.classList.remove('hidden');
      return existing;
    }

    var el = build(opts);
    el.classList.add('hidden');
    document.body.appendChild(el);

    requestAnimationFrame(function () {
      el.classList.remove('hidden');
      el.classList.add('active');
    });

    var closeFn = function (e) {
      if (e) e.preventDefault();
      close(id);
    };

    var closeBtn = el.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeFn);

    if (opts.backdropClose !== false) {
      el.addEventListener('click', function (e) {
        if (e.target === el) closeFn(e);
      });
    }

    St.stack.push({ id: id, opts: opts, el: el });
    emit('modal:open', { id: id });

    if (opts.onOpen && typeof opts.onOpen === 'function') {
      try { opts.onOpen(el, opts); } catch (err) { console.warn('[modal] onOpen err', err); }
    }

    return el;
  }

  function close(id) {
    if (!id) {
      if (!St.stack.length) return;
      id = St.stack[St.stack.length - 1].id;
    }
    var entry = null;
    for (var i = 0; i < St.stack.length; i++) {
      if (St.stack[i].id === id) { entry = St.stack[i]; St.stack.splice(i, 1); break; }
    }
    if (!entry) {
      var orphan = $id(id);
      if (orphan) orphan.remove();
      return;
    }

    var el = entry.el;
    el.classList.remove('active');
    el.classList.add('closing');

    setTimeout(function () {
      if (entry.opts && entry.opts.destroy !== false) {
        try { el.remove(); } catch (e) {}
      } else {
        el.classList.add('hidden');
        el.classList.remove('closing');
      }
    }, 250);

    emit('modal:close', { id: id });
    if (entry.opts && typeof entry.opts.onClose === 'function') {
      try { entry.opts.onClose(el, entry.opts); } catch (err) {}
    }
  }

  function closeTop() {
    if (!St.stack.length) return;
    close(St.stack[St.stack.length - 1].id);
  }

  function closeAll() {
    while (St.stack.length) {
      var top = St.stack.pop();
      try { top.el.remove(); } catch (e) {}
    }
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && St.stack.length) closeTop();
    });

    console.log('[modal] v' + VERSION + ' ready');
  }

  window.QamarModal = {
    version: VERSION,
    open: open,
    close: close,
    closeTop: closeTop,
    closeAll: closeAll,
    isOpen: function () { return St.stack.length > 0; },
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 100);
  }
})();
