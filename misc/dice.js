/* ============================================================
   🌙 قمر الشام — misc/dice.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarDice) return;

  var VERSION = '1.0';
  var MODAL_ID = 'qamar-dice-modal';
  var St = { inited: false, rolling: false };

  function $id(id) { return document.getElementById(id); }

  function emit(name, data) {
    try { if (window.EventBus && window.EventBus.emit) window.EventBus.emit(name, data); } catch (e) {}
  }

  function playClack() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(200 + Math.random() * 400, ctx.currentTime);
      g.gain.setValueAtTime(0.06, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.1);
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 300);
    } catch (e) {}
  }

  function playFinal() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      [523, 659, 784].forEach(function (f, i) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f, ctx.currentTime + i * 0.1);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.1);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.1 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.1 + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.1);
        o.stop(ctx.currentTime + i * 0.1 + 0.3);
      });
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 800);
    } catch (e) {}
  }

  function ensureStyle() {
    if ($id('qd-style')) return;
    var st = document.createElement('style');
    st.id = 'qd-style';
    st.textContent =
      '.qd-cube-wrap{perspective:600px;width:120px;height:120px;margin:0 auto;position:relative}' +
      '.qd-cube{position:relative;width:100%;height:100%;transform-style:preserve-3d;' +
        'transition:transform 1.4s cubic-bezier(.2,.7,.3,1)}' +
      '.qd-face{position:absolute;width:100%;height:100%;background:linear-gradient(135deg,#1a1a2e,#0f0f1a);' +
        'border:2px solid #d4af37;border-radius:14px;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:52px;color:#ffd700;font-weight:900;' +
        'box-shadow:inset 0 0 20px rgba(212,175,55,.2),0 0 20px rgba(212,175,55,.15)}' +
      '.qd-f1{transform:translateZ(60px)}' +
      '.qd-f2{transform:rotateY(90deg) translateZ(60px)}' +
      '.qd-f3{transform:rotateY(180deg) translateZ(60px)}' +
      '.qd-f4{transform:rotateY(-90deg) translateZ(60px)}' +
      '.qd-f5{transform:rotateX(90deg) translateZ(60px)}' +
      '.qd-f6{transform:rotateX(-90deg) translateZ(60px)}';
    document.head.appendChild(st);
  }

  var DICE_FACES = {
    1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅'
  };

  function buildModal() {
    var old = $id(MODAL_ID);
    if (old) return old;

    var ov = document.createElement('div');
    ov.id = MODAL_ID;
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:17000;' +
      'display:flex;align-items:center;justify-content:center;flex-direction:column;' +
      'gap:20px;padding:20px;font-family:inherit';

    ov.innerHTML =
      '<div style="color:#d4af37;font-size:20px;font-weight:900">🎲 النرد</div>' +
      '<div class="qd-cube-wrap">' +
        '<div class="qd-cube" id="qd-cube">' +
          '<div class="qd-face qd-f1">⚀</div>' +
          '<div class="qd-face qd-f2">⚁</div>' +
          '<div class="qd-face qd-f3">⚂</div>' +
          '<div class="qd-face qd-f4">⚃</div>' +
          '<div class="qd-face qd-f5">⚄</div>' +
          '<div class="qd-face qd-f6">⚅</div>' +
        '</div>' +
      '</div>' +
      '<div id="qd-result" style="color:#f3f4f6;font-size:18px;font-weight:900;' +
        'min-height:26px;text-align:center">اضغط لترمي</div>' +
      '<button id="qd-roll" style="padding:14px 40px;border-radius:12px;' +
        'background:linear-gradient(135deg,#d4af37,#b8860b);' +
        'color:#000;font-weight:900;font-size:14px;border:none;cursor:pointer;' +
        'font-family:inherit">🎲 ارمِ النرد</button>' +
      '<button id="qd-close" style="padding:10px 20px;border-radius:10px;' +
        'background:transparent;border:1px solid rgba(255,255,255,.15);' +
        'color:#9ca3af;font-size:12px;cursor:pointer;font-family:inherit">إغلاق</button>';

    document.body.appendChild(ov);

    ov.querySelector('#qd-roll').addEventListener('click', function () { roll(); });
    ov.querySelector('#qd-close').addEventListener('click', close);

    ov.addEventListener('click', function (e) {
      if (e.target === ov) close();
    });

    return ov;
  }

  var ROTATIONS = {
    1: { x: 0, y: 0 },
    2: { x: 0, y: -90 },
    3: { x: 0, y: 180 },
    4: { x: 0, y: 90 },
    5: { x: -90, y: 0 },
    6: { x: 90, y: 0 }
  };

  function roll() {
    if (St.rolling) return;
    St.rolling = true;

    var cube = $id('qd-cube');
    var result = $id('qd-result');
    if (!cube || !result) { St.rolling = false; return; }

    result.textContent = '...';
    var finalNum = 1 + Math.floor(Math.random() * 6);
    var rot = ROTATIONS[finalNum];

    // Spin animation
    var spinX = 720 + rot.x + (Math.floor(Math.random() * 4) * 360);
    var spinY = 720 + rot.y + (Math.floor(Math.random() * 4) * 360);

    cube.style.transition = 'transform 1.4s cubic-bezier(.2,.7,.3,1)';
    cube.style.transform = 'rotateX(' + spinX + 'deg) rotateY(' + spinY + 'deg)';

    var clackCount = 0;
    var clackTimer = setInterval(function () {
      playClack();
      clackCount++;
      if (clackCount >= 6) clearInterval(clackTimer);
    }, 180);

    setTimeout(function () {
      playFinal();
      result.innerHTML = 'النتيجة: <span style="color:#ffd700;font-size:26px">' +
        DICE_FACES[finalNum] + ' ' + finalNum + '</span>';
      St.rolling = false;

      setTimeout(function () { sendToChat(finalNum); }, 400);
    }, 1500);
  }

  function sendToChat(num) {
    var text = '🎲 النرد: ' + DICE_FACES[num] + ' **' + num + '**';
    if (window.QamarChat && typeof window.QamarChat.send === 'function') {
      try { window.QamarChat.send(text); return; } catch (e) {}
    }
    emit('chat:send-attachment', { kind: 'text', text: text });
    emit('dice:result', { num: num });
  }

  function open() {
    ensureStyle();
    var ov = buildModal();
    ov.style.display = 'flex';
  }

  function close() {
    var ov = $id(MODAL_ID);
    if (ov) ov.style.display = 'none';
  }

  function init() {
    if (St.inited) return;
    St.inited = true;
    ensureStyle();

    try {
      if (window.EventBus && typeof window.EventBus.on === 'function') {
        window.EventBus.on('dice:open', function () { open(); });
      }
    } catch (e) {}

    console.log('[dice] v' + VERSION + ' ready');
  }

  window.QamarDice = {
    version: VERSION,
    open: open,
    close: close,
    roll: roll,
    faces: DICE_FACES,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
