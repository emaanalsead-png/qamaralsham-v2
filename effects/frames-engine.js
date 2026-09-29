/* ============================================================
   🌙 قمر الشام — effects/frames-engine.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarFrames) return;

  var VERSION = '1.0';

  var FRAMES = {
    gold:    { name: 'ذهبي',   colors: ['#d4af37', '#ffd700', '#b8860b'], anim: true },
    silver:  { name: 'فضي',   colors: ['#c0c0c0', '#e8e8e8', '#a8a8a8'], anim: true },
    pink:    { name: 'وردي',   colors: ['#ff69b4', '#ffb6c1', '#ff1493'], anim: true },
    gray:    { name: 'رمادي',   colors: ['#6b7280', '#9ca3af', '#4b5563'], anim: false },
    fire:    { name: 'نار',    colors: ['#ff4500', '#ff8c00', '#ffd700'], anim: true },
    ice:     { name: 'جليد',   colors: ['#00f3ff', '#87ceeb', '#ffffff'], anim: true },
    neon:    { name: 'نيون',   colors: ['#39ff14', '#00ff88', '#adff2f'], anim: true },
    cyber:   { name: 'سايبر',  colors: ['#a855f7', '#ff00ff', '#00f3ff'], anim: true },
    blood:   { name: 'دم',     colors: ['#8b0000', '#ff0000', '#dc143c'], anim: true },
    aurora:  { name: 'شفق',    colors: ['#a855f7', '#06b6d4', '#84cc16'], anim: true },
    rainbow: { name: 'قوس قزح', colors: ['#ff0000', '#ffd700', '#00ff00', '#00bfff', '#a855f7'], anim: true },
    emerald: { name: 'زمرد',   colors: ['#10b981', '#34d399', '#059669'], anim: true }
  };

  var St = { inited: false, styleInjected: false };

  function injectStyle() {
    if (St.styleInjected) return;
    St.styleInjected = true;
    var st = document.createElement('style');
    st.id = 'qf-frames-style';
    st.textContent =
      '.qf-wrap{position:relative;display:inline-block;line-height:0;' +
        'border-radius:50%;isolation:isolate}' +
      '.qf-frame{position:absolute;inset:-4px;border-radius:50%;' +
        'pointer-events:none;z-index:2}' +
      '.qf-frame-spin{position:absolute;inset:-4px;border-radius:50%;' +
        'pointer-events:none;z-index:1;animation:qfSpin 4s linear infinite}' +
      '@keyframes qfSpin{to{transform:rotate(360deg)}}' +
      '@keyframes qfPulse{0%,100%{opacity:1}50%{opacity:.5}}' +
      '@keyframes qfGlow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.4)}}' +
      '@keyframes qfFireMove{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}' +
      '.qf-anim-glow{animation:qfGlow 2s ease-in-out infinite}' +
      '.qf-anim-pulse{animation:qfPulse 2s ease-in-out infinite}' +
      '.qf-anim-move{background-size:300% 300%;animation:qfFireMove 3s ease infinite}';
    document.head.appendChild(st);
  }

  function getFrame(name) {
    return FRAMES[name] || null;
  }

  function makeGradient(colors, angle) {
    if (!colors || !colors.length) return '#d4af37';
    var stops = colors.map(function (c, i) {
      var pct = colors.length === 1 ? 100 : (i / (colors.length - 1)) * 100;
      return c + ' ' + pct.toFixed(1) + '%';
    }).join(', ');
    return 'linear-gradient(' + (angle || 45) + 'deg, ' + stops + ')';
  }

  function applyToImg(imgEl, frameName) {
    if (!imgEl) return;
    var frame = getFrame(frameName);
    if (!frame) { clearFromImg(imgEl); return; }

    injectStyle();

    var wrap = imgEl.parentNode;
    if (!wrap || !wrap.classList || !wrap.classList.contains('qf-wrap')) {
      wrap = document.createElement('span');
      wrap.className = 'qf-wrap';
      imgEl.parentNode.insertBefore(wrap, imgEl);
      wrap.appendChild(imgEl);
    }

    var old = wrap.querySelectorAll('.qf-frame, .qf-frame-spin');
    for (var i = 0; i < old.length; i++) old[i].remove();

    var frameEl = document.createElement('span');
    frameEl.className = 'qf-frame';
    frameEl.style.background = makeGradient(frame.colors, 45);

    var innerMask = document.createElement('span');
    innerMask.style.cssText =
      'position:absolute;inset:3px;border-radius:50%;' +
      'background:transparent;box-shadow:0 0 12px rgba(0,0,0,.9) inset';
    frameEl.appendChild(innerMask);

    if (frame.anim) {
      frameEl.classList.add('qf-anim-move');
      var spin = document.createElement('span');
      spin.className = 'qf-frame-spin qf-anim-pulse';
      spin.style.background = makeGradient(frame.colors, 135);
      spin.style.filter = 'blur(6px)';
      wrap.insertBefore(spin, frameEl);
    }

    wrap.appendChild(frameEl);

    try {
      if (imgEl.style) imgEl.style.borderRadius = '50%';
    } catch (e) {}
  }

  function clearFromImg(imgEl) {
    if (!imgEl) return;
    var wrap = imgEl.parentNode;
    if (wrap && wrap.classList && wrap.classList.contains('qf-wrap')) {
      var children = wrap.querySelectorAll('.qf-frame, .qf-frame-spin');
      for (var i = 0; i < children.length; i++) children[i].remove();
      var parent = wrap.parentNode;
      if (parent) {
        parent.insertBefore(imgEl, wrap);
        try { wrap.remove(); } catch (e) {}
      }
    }
  }

  function defaultFrameForRank(rankLevel) {
    if (rankLevel >= 100) return 'gold';
    if (rankLevel >= 95) return 'pink';
    if (rankLevel >= 85) return 'silver';
    if (rankLevel >= 60) return 'silver';
    return 'gray';
  }

  function listFrames() {
    return Object.keys(FRAMES).map(function (k) {
      return {
        id: k,
        name: FRAMES[k].name,
        colors: FRAMES[k].colors.slice(),
        animated: !!FRAMES[k].anim
      };
    });
  }

  function previewSVG(frameName, size) {
    size = size || 64;
    var frame = getFrame(frameName);
    if (!frame) return '';
    var colors = frame.colors;
    var gradId = 'qfg_' + frameName + '_' + Math.random().toString(36).slice(2, 6);
    var stops = colors.map(function (c, i) {
      var pct = colors.length === 1 ? 100 : (i / (colors.length - 1)) * 100;
      return '<stop offset="' + pct.toFixed(1) + '%" stop-color="' + c + '"/>';
    }).join('');
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 64 64">' +
      '<defs><linearGradient id="' + gradId + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
      stops + '</linearGradient></defs>' +
      '<circle cx="32" cy="32" r="30" fill="none" stroke="url(#' + gradId + ')" stroke-width="4"/>' +
    '</svg>';
  }

  function applyAll(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-qf]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var frameName = el.getAttribute('data-qf');
      if (el.tagName === 'IMG') applyToImg(el, frameName);
    }
  }

  function init() {
    if (St.inited) return;
    St.inited = true;
    injectStyle();
    applyAll();
    try {
      if (window.EventBus && window.EventBus.on) {
        window.EventBus.on('frame:apply', function (d) {
          if (d && d.img && d.frame) applyToImg(d.img, d.frame);
        });
        window.EventBus.on('frame:clear', function (d) {
          if (d && d.img) clearFromImg(d.img);
        });
      }
    } catch (e) {}
    console.log('[frames-engine] v' + VERSION + ' ready');
  }

  window.QamarFrames = {
    version: VERSION,
    frames: FRAMES,
    list: listFrames,
    get: getFrame,
    apply: applyToImg,
    clear: clearFromImg,
    applyAll: applyAll,
    defaultForRank: defaultFrameForRank,
    previewSVG: previewSVG,
    gradient: makeGradient,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
