/* ============================================================
   🌙 قمر الشام — misc/text-styler.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarTextStyler) return;

  var VERSION = '1.0';
  var MODAL_ID = 'qamar-styler-modal';
  var St = { inited: false };

  var STYLES = [
    { id: 'bold',       name: 'عريض',        wrap: ['**', '**'] },
    { id: 'italic',     name: 'مائل',        wrap: ['_', '_'] },
    { id: 'underline',  name: 'تحته خط',    wrap: ['__', '__'] },
    { id: 'strike',     name: 'يتوسطه خط',  wrap: ['~~', '~~'] },
    { id: 'code',       name: 'كود',         wrap: ['`', '`'] },
    { id: 'spoiler',    name: 'مخفي',       wrap: ['||', '||'] }
  ];

  function $id(id) { return document.getElementById(id); }

  function buildModal() {
    var old = $id(MODAL_ID);
    if (old) return old;

    var ov = document.createElement('div');
    ov.id = MODAL_ID;
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:17500;' +
      'display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit';

    var card = document.createElement('div');
    card.style.cssText =
      'width:100%;max-width:420px;background:#0a0616;' +
      'border:1px solid rgba(212,175,55,.35);border-radius:18px;padding:18px;' +
      'direction:rtl';

    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div style="color:#d4af37;font-size:16px;font-weight:900">✨ نمط النص</div>' +
        '<button id="qts-close" style="width:32px;height:32px;border-radius:50%;' +
          'background:transparent;border:1px solid rgba(255,255,255,.1);' +
          'color:#9ca3af;font-size:14px;cursor:pointer;font-family:inherit">✕</button>' +
      '</div>' +
      '<textarea id="qts-input" rows="3" placeholder="اكتب النص..." ' +
        'style="width:100%;padding:12px;border-radius:10px;' +
        'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);' +
        'color:#f3f4f6;font-size:14px;font-family:inherit;margin-bottom:10px;' +
        'box-sizing:border-box;resize:vertical"></textarea>' +
      '<div id="qts-preview" style="padding:12px;border-radius:10px;' +
        'background:rgba(0,0,0,.4);color:#f3f4f6;font-size:14px;' +
        'min-height:40px;margin-bottom:10px;word-break:break-word">' +
        '<span style="color:#6b7280">المعاينة ستظهر هنا...</span></div>' +
      '<div id="qts-styles" style="display:grid;grid-template-columns:repeat(3,1fr);' +
        'gap:6px;margin-bottom:14px"></div>' +
      '<button id="qts-send" style="width:100%;padding:12px;border-radius:10px;' +
        'background:linear-gradient(135deg,#d4af37,#b8860b);' +
        'color:#000;font-weight:900;font-size:13px;border:none;cursor:pointer;' +
        'font-family:inherit">إرسال</button>';

    ov.appendChild(card);
    document.body.appendChild(ov);

    var stylesDiv = card.querySelector('#qts-styles');
    STYLES.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.style.cssText =
        'padding:10px;border-radius:8px;background:rgba(255,255,255,.05);' +
        'border:1px solid rgba(255,255,255,.1);color:#f3f4f6;' +
        'font-size:12px;font-weight:700;cursor:pointer;font-family:inherit';
      b.textContent = s.name;
      b.addEventListener('click', function () { applyStyle(s); });
      stylesDiv.appendChild(b);
    });

    card.querySelector('#qts-input').addEventListener('input', updatePreview);
    card.querySelector('#qts-close').addEventListener('click', close);
    card.querySelector('#qts-send').addEventListener('click', doSend);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    return ov;
  }

  function applyStyle(style) {
    var input = $id('qts-input');
    if (!input) return;
    var val = input.value;
    var start = input.selectionStart || 0;
    var end = input.selectionEnd || 0;

    if (start === end) {
      input.value = val + style.wrap[0] + style.wrap[1];
    } else {
      var selected = val.substring(start, end);
      input.value = val.substring(0, start) + style.wrap[0] + selected + style.wrap[1] + val.substring(end);
    }
    updatePreview();
  }

  function updatePreview() {
    var input = $id('qts-input');
    var preview = $id('qts-preview');
    if (!input || !preview) return;
    var text = input.value || '';
    if (!text) {
      preview.innerHTML = '<span style="color:#6b7280">المعاينة ستظهر هنا...</span>';
      return;
    }
    var html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\_\_(.+?)\_\_/g, '<u>$1</u>')
      .replace(/_(.+?)_/g, '<i>$1</i>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(212,175,55,.2);padding:2px 6px;border-radius:4px">$1</code>')
      .replace(/\|\|(.+?)\|\|/g, '<span style="background:#333;color:#333">$1</span>');
    preview.innerHTML = html;
  }

  function doSend() {
    var input = $id('qts-input');
    if (!input || !input.value.trim()) return;
    var text = input.value;
    if (window.QamarChat && typeof window.QamarChat.send === 'function') {
      window.QamarChat.send(text);
    }
    close();
  }

  function open() {
    var ov = buildModal();
    ov.style.display = 'flex';
    setTimeout(function () {
      var inp = $id('qts-input');
      if (inp) inp.focus();
    }, 100);
  }

  function close() {
    var ov = $id(MODAL_ID);
    if (ov) ov.remove();
  }

  function init() {
    if (St.inited) return;
    St.inited = true;
    try {
      if (window.EventBus && typeof window.EventBus.on === 'function') {
        window.EventBus.on('text-styler:open', function () { open(); });
      }
    } catch (e) {}
    console.log('[text-styler] v' + VERSION + ' ready');
  }

  window.QamarTextStyler = { version: VERSION, open: open, close: close, styles: STYLES, init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
