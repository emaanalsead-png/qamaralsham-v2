/* ============================================================
   🌙 قمر الشام — misc/painter.js
   Version: 1.0 — Fabric.js-like drawing canvas (vanilla)
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarPainter) return;

  var VERSION = '1.0';
  var MODAL_ID = 'qamar-painter-modal';
  var St = {
    inited: false,
    canvas: null,
    ctx: null,
    drawing: false,
    tool: 'brush',
    color: '#d4af37',
    size: 5,
    history: [],
    historyIndex: -1
  };

  function $id(id) { return document.getElementById(id); }

  function emit(name, data) {
    try { if (window.EventBus && window.EventBus.emit) window.EventBus.emit(name, data); } catch (e) {}
  }

  function buildModal() {
    var old = $id(MODAL_ID);
    if (old) return old;

    var ov = document.createElement('div');
    ov.id = MODAL_ID;
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:17500;' +
      'display:flex;flex-direction:column;font-family:inherit;direction:rtl';

    ov.innerHTML =
      '<div style="padding:10px;padding-top:max(10px,env(safe-area-inset-top));' +
        'display:flex;gap:6px;align-items:center;' +
        'border-bottom:1px solid rgba(212,175,55,.3);background:#0a0616">' +
        '<button id="qp-close" style="width:36px;height:36px;border-radius:50%;' +
          'background:transparent;border:1px solid rgba(255,255,255,.15);' +
          'color:#f3f4f6;font-size:14px;cursor:pointer;font-family:inherit">✕</button>' +
        '<div style="flex:1;text-align:center;color:#d4af37;font-size:14px;font-weight:900">' +
          '🎨 الرسام</div>' +
        '<button id="qp-send" style="padding:8px 14px;border-radius:10px;' +
          'background:linear-gradient(135deg,#d4af37,#b8860b);' +
          'color:#000;font-weight:900;font-size:12px;border:none;cursor:pointer;' +
          'font-family:inherit">إرسال</button>' +
      '</div>' +
      '<div id="qp-stage" style="flex:1;position:relative;overflow:hidden;' +
        'background:#000">' +
        '<canvas id="qp-canvas" style="display:block;touch-action:none"></canvas>' +
      '</div>' +
      '<div id="qp-toolbar" style="padding:8px;padding-bottom:max(8px,env(safe-area-inset-bottom));' +
        'background:#0a0616;border-top:1px solid rgba(212,175,55,.3);' +
        'display:flex;gap:6px;overflow-x:auto;align-items:center"></div>';

    document.body.appendChild(ov);

    var canvas = ov.querySelector('#qp-canvas');
    var stage = ov.querySelector('#qp-stage');
    var toolbar = ov.querySelector('#qp-toolbar');

    function resize() {
      var rect = stage.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      St.ctx = canvas.getContext('2d');
      St.ctx.fillStyle = '#000';
      St.ctx.fillRect(0, 0, canvas.width, canvas.height);
      St.ctx.lineCap = 'round';
      St.ctx.lineJoin = 'round';
    }
    setTimeout(resize, 80);

    var tools = [
      { id: 'brush',    icon: '🖌️' },
      { id: 'eraser',   icon: '🧽' },
      { id: 'line',     icon: '📏' },
      { id: 'rect',     icon: '⬛' },
      { id: 'circle',   icon: '⭕' },
      { id: 'undo',     icon: '↶' },
      { id: 'redo',     icon: '↷' },
      { id: 'clear',    icon: '🗑️' }
    ];

    tools.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.tool = t.id;
      b.style.cssText =
        'min-width:40px;height:40px;padding:0 10px;border-radius:10px;' +
        'background:' + (t.id === 'brush' ? 'rgba(212,175,55,.2)' : 'rgba(255,255,255,.04)') + ';' +
        'border:1px solid rgba(255,255,255,.1);color:#f3f4f6;font-size:16px;' +
        'cursor:pointer;font-family:inherit;flex-shrink:0';
      b.textContent = t.icon;
      b.addEventListener('click', function () { handleTool(t.id); });
      toolbar.appendChild(b);
    });

    var colorsDiv = document.createElement('div');
    colorsDiv.style.cssText = 'display:flex;gap:4px;flex-shrink:0';
    ['#d4af37','#ff4444','#84cc16','#3b82f6','#a855f7','#ff69b4','#ffffff','#000000'].forEach(function (c) {
      var cb = document.createElement('button');
      cb.type = 'button';
      cb.style.cssText =
        'width:28px;height:28px;border-radius:50%;background:' + c + ';' +
        'border:2px solid ' + (c === St.color ? '#d4af37' : 'rgba(255,255,255,.2)') + ';' +
        'cursor:pointer;flex-shrink:0';
      cb.dataset.color = c;
      cb.addEventListener('click', function () {
        St.color = c;
        toolbar.querySelectorAll('button[data-color]').forEach(function (el) {
          el.style.border = '2px solid ' + (el.dataset.color === c ? '#d4af37' : 'rgba(255,255,255,.2)');
        });
      });
      colorsDiv.appendChild(cb);
    });
    toolbar.appendChild(colorsDiv);

    var sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.min = '1';
    sizeSlider.max = '40';
    sizeSlider.value = '5';
    sizeSlider.style.cssText = 'width:80px;flex-shrink:0';
    sizeSlider.addEventListener('input', function () { St.size = Number(sizeSlider.value); });
    toolbar.appendChild(sizeSlider);

    _bindDrawing(canvas);
    _saveHistory();

    ov.querySelector('#qp-close').addEventListener('click', close);
    ov.querySelector('#qp-send').addEventListener('click', doSend);

    return ov;
  }

  function _bindDrawing(canvas) {
    var startX = 0, startY = 0;
    var snapshot = null;

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      var p = e.touches ? e.touches[0] : e;
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    }

    function start(e) {
      e.preventDefault();
      var p = pos(e);
      startX = p.x; startY = p.y;
      St.drawing = true;
      snapshot = St.ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (St.tool === 'brush' || St.tool === 'eraser') {
        St.ctx.beginPath();
        St.ctx.moveTo(p.x, p.y);
      }
    }

    function move(e) {
      if (!St.drawing) return;
      e.preventDefault();
      var p = pos(e);
      var ctx = St.ctx;

      if (St.tool === 'brush' || St.tool === 'eraser') {
        ctx.strokeStyle = St.tool === 'eraser' ? '#000' : St.color;
        ctx.lineWidth = St.tool === 'eraser' ? St.size * 2 : St.size;
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (snapshot) {
        ctx.putImageData(snapshot, 0, 0);
        ctx.strokeStyle = St.color;
        ctx.lineWidth = St.size;
        if (St.tool === 'line') {
          ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(p.x, p.y); ctx.stroke();
        } else if (St.tool === 'rect') {
          ctx.strokeRect(startX, startY, p.x - startX, p.y - startY);
        } else if (St.tool === 'circle') {
          var dx = p.x - startX, dy = p.y - startY;
          var r = Math.sqrt(dx * dx + dy * dy);
          ctx.beginPath(); ctx.arc(startX, startY, r, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    function end(e) {
      if (!St.drawing) return;
      St.drawing = false;
      _saveHistory();
    }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
  }

  function _saveHistory() {
    if (!St.canvas) St.canvas = $id('qp-canvas');
    if (!St.canvas) return;
    try {
      var data = St.canvas.toDataURL('image/png');
      St.history = St.history.slice(0, St.historyIndex + 1);
      St.history.push(data);
      if (St.history.length > 20) St.history.shift();
      St.historyIndex = St.history.length - 1;
    } catch (e) {}
  }

  function _restoreHistory(idx) {
    var data = St.history[idx];
    if (!data) return;
    var img = new Image();
    img.onload = function () {
      St.ctx.drawImage(img, 0, 0);
    };
    img.src = data;
  }

  function handleTool(id) {
    if (id === 'undo') {
      if (St.historyIndex > 0) { St.historyIndex--; _restoreHistory(St.historyIndex); }
      return;
    }
    if (id === 'redo') {
      if (St.historyIndex < St.history.length - 1) { St.historyIndex++; _restoreHistory(St.historyIndex); }
      return;
    }
    if (id === 'clear') {
      if (confirm('مسح اللوحة؟')) {
        St.ctx.fillStyle = '#000';
        St.ctx.fillRect(0, 0, St.canvas.width, St.canvas.height);
        _saveHistory();
      }
      return;
    }
    St.tool = id;
    document.querySelectorAll('#qp-toolbar button[data-tool]').forEach(function (b) {
      b.style.background = b.dataset.tool === id ? 'rgba(212,175,55,.2)' : 'rgba(255,255,255,.04)';
    });
  }

  function doSend() {
    var canvas = $id('qp-canvas');
    if (!canvas) return;
    var data = canvas.toDataURL('image/png');
    emit('painter:send', { dataUrl: data });
    if (window.QamarChat && typeof window.QamarChat.send === 'function') {
      window.QamarChat.send('[paint:' + data.split(',')[1] + ']');
    }
    close();
  }

  function open() {
    var ov = buildModal();
    ov.style.display = 'flex';
  }

  function close() {
    var ov = $id(MODAL_ID);
    if (ov) ov.remove();
    St.history = [];
    St.historyIndex = -1;
  }

  function init() {
    if (St.inited) return;
    St.inited = true;
    try {
      if (window.EventBus && typeof window.EventBus.on === 'function') {
        window.EventBus.on('painter:open', function () { open(); });
      }
    } catch (e) {}
    console.log('[painter] v' + VERSION + ' ready');
  }

  window.QamarPainter = { version: VERSION, open: open, close: close, init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
