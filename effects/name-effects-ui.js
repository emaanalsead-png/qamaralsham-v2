/* ============================================================
   🌙 قمر الشام — effects/name-effects-ui.js
   Version: 1.1 — إصلاح تصادم QamarNameEffects
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarNameEffectsUI) return;

  var VERSION = '1.1';
  var St = { inited: false, currentUid: null };

  var SOLID_COLORS = [
    { id: 'gold',      name: 'ذهبي',    value: '#d4af37' },
    { id: 'sunset',    name: 'غروب',    value: '#ff6b35' },
    { id: 'aurora',    name: 'شفق',     value: '#a855f7' },
    { id: 'ocean',     name: 'محيط',    value: '#06b6d4' },
    { id: 'galaxy',    name: 'مجرة',    value: '#8b00ff' },
    { id: 'fire',      name: 'نار',     value: '#ff4500' },
    { id: 'emerald',   name: 'زمرد',    value: '#10b981' },
    { id: 'blood',     name: 'دم',      value: '#dc143c' },
    { id: 'diamond',   name: 'ألماس',   value: '#e0ffff' },
    { id: 'royal',     name: 'ملكي',    value: '#7c3aed' },
    { id: 'cyber',     name: 'سايبر',   value: '#00f3ff' },
    { id: 'rainbow',   name: 'قزح',     value: '#ff0066' }
  ];

  var GRADIENTS = [
    { id: 'shimmer-gold',     name: 'شيمر ذهبي',  c1: '#d4af37', c2: '#fff4b8', c3: '#d4af37' },
    { id: 'shimmer-rainbow',  name: 'شيمر قزح',   c1: '#ff0000', c2: '#ffd700', c3: '#00bfff' },
    { id: 'multicolor',       name: 'متعدد',      c1: '#ff0066', c2: '#a855f7', c3: '#00f3ff' },
    { id: 'hue-rotate',       name: 'تدوير',      c1: '#ff6b35', c2: '#a855f7', c3: '#06b6d4' },
    { id: 'diagonal-flow',    name: 'انسيابي',    c1: '#ff0080', c2: '#7928ca', c3: '#00d4ff' },
    { id: 'silk',             name: 'حرير',       c1: '#e0ffff', c2: '#a855f7', c3: '#ff69b4' }
  ];

  var GLOWS = [
    { id: 'neon',           name: 'نيون',      color: '#39ff14' },
    { id: 'neon-flicker',   name: 'وميض',      color: '#ff0066' },
    { id: 'glow-breathe',   name: 'تنفس',      color: '#00f3ff' },
    { id: 'electric',       name: 'كهربائي',   color: '#ffd700' },
    { id: 'candle',         name: 'شمعة',      color: '#ff8c00' },
    { id: 'twinkle',        name: 'لمعان',     color: '#a855f7' },
    { id: 'contrast-flash', name: 'وهج',       color: '#ffffff' }
  ];

  var TRANSFORMS = [
    { id: 'breathe',           name: 'تنفس' },
    { id: 'skew-wave',         name: 'موجة' },
    { id: 'tilt-swing',        name: 'تمايل' },
    { id: 'saturate-breathe',  name: 'تشبع' },
    { id: 'brightness-pulse',  name: 'نبض' },
    { id: 'spin-slow',         name: 'دوران' }
  ];

  var SCENES = [
    { id: 'spiral',        name: 'حلزون' },
    { id: 'nebula',        name: 'سديم' },
    { id: 'storm',         name: 'عاصفة' },
    { id: 'fireworks',     name: 'ألعاب نارية' },
    { id: 'sugar',         name: 'سكر' },
    { id: 'snow',          name: 'ثلج' },
    { id: 'volcano',       name: 'بركان' },
    { id: 'waves',         name: 'أمواج' },
    { id: 'liquid',        name: 'سائل' },
    { id: 'radial-pulse',  name: 'نبض دائري' },
    { id: 'sunrise',       name: 'شروق' }
  ];

  var BG_COLORS = [
    '#000000', '#ffffff', '#ff0000', '#ff4500', '#ff8c00', '#ffd700',
    '#ffff00', '#adff2f', '#39ff14', '#00cc00', '#00b894', '#00f3ff',
    '#00bfff', '#1e90ff', '#0000ff', '#6c5ce7', '#8a2be2', '#a855f7',
    '#ff00ff', '#da70d6', '#ff1493', '#e0115f', '#8b4513', '#696969'
  ];

  function $id(id) { return document.getElementById(id); }

  function injectStyle() {
    if (document.getElementById('qne-style')) return;
    var st = document.createElement('style');
    st.id = 'qne-style';
    st.textContent =
      '.qne-shimmer{background-size:200% 100%;-webkit-background-clip:text;' +
        'background-clip:text;-webkit-text-fill-color:transparent;' +
        'animation:qneShimmer 3s linear infinite}' +
      '@keyframes qneShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}' +
      '.qne-glow{filter:brightness(1.2)}' +
      '.qne-glow-neon{text-shadow:0 0 4px currentColor,0 0 8px currentColor,0 0 16px currentColor}' +
      '.qne-glow-flicker{animation:qneFlicker 1.5s infinite}' +
      '@keyframes qneFlicker{0%,100%{opacity:1}45%{opacity:.6}50%{opacity:.3}55%{opacity:.6}}' +
      '.qne-glow-breathe{animation:qneBreathe 3s ease-in-out infinite}' +
      '@keyframes qneBreathe{0%,100%{filter:brightness(1)}50%{filter:brightness(1.6)}}' +
      '.qne-tx-breathe{animation:qneBreathe 3s ease-in-out infinite}' +
      '.qne-tx-wave{animation:qneWave 3s ease-in-out infinite}' +
      '@keyframes qneWave{0%,100%{transform:skewX(0)}25%{transform:skewX(10deg)}75%{transform:skewX(-10deg)}}' +
      '.qne-tx-tilt{animation:qneTilt 3s ease-in-out infinite}' +
      '@keyframes qneTilt{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}' +
      '.qne-tx-spin{animation:qneSpin 6s linear infinite;display:inline-block}' +
      '@keyframes qneSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }

  function apply(el, cfg) {
    if (!el || !cfg) return;
    injectStyle();

    el.classList.remove(
      'qne-shimmer', 'qne-glow', 'qne-glow-neon', 'qne-glow-flicker',
      'qne-glow-breathe', 'qne-tx-breathe', 'qne-tx-wave', 'qne-tx-tilt', 'qne-tx-spin'
    );
    el.style.color = '';
    el.style.background = '';
    el.style.backgroundImage = '';
    el.style.webkitTextFillColor = '';
    el.style.textShadow = '';
    el.style.padding = '';
    el.style.borderRadius = '';

    var mode = cfg.mode || 'solid';
    var value = cfg.value;
    var c1 = cfg.c1, c2 = cfg.c2, c3 = cfg.c3;
    var bg = cfg.bg;

    if (mode === 'solid' && value) {
      el.style.color = value;
    } else if (mode === 'gradient') {
      var grad = 'linear-gradient(90deg, ' + c1 + ' 0%, ' + (c3 || c2) + ' 50%, ' + c1 + ' 100%)';
      el.style.backgroundImage = grad;
      el.classList.add('qne-shimmer');
    } else if (mode === 'glow') {
      el.classList.add('qne-glow');
      el.style.textShadow =
        '0 0 4px ' + value + ', 0 0 8px ' + value + ', 0 0 16px ' + value;
    } else if (mode === 'transform') {
      var tClass = 'qne-tx-' + (cfg.transform || 'breathe');
      el.classList.add(tClass);
    }

    if (bg) {
      el.style.padding = '0 8px';
      el.style.borderRadius = '6px';
      if (bg.indexOf('gradient') === 0) el.style.backgroundImage = bg;
      else el.style.background = bg;
    }
  }

  function buildUI(targetUid) {
    St.currentUid = targetUid || St.currentUid;
    var uid = St.currentUid;
    if (!uid) return;

    var container = document.createElement('div');
    container.style.cssText = 'padding:10px;color:#f3f4f6;font-family:inherit;direction:rtl';

    container.innerHTML =
      '<div style="font-size:16px;font-weight:900;color:#d4af37;margin-bottom:14px;' +
        'text-align:center">🎨 نمط الاسم</div>' +
      '<div id="qne-preview" style="text-align:center;padding:20px;' +
        'background:rgba(255,255,255,.03);border-radius:12px;margin-bottom:14px">' +
        '<span id="qne-preview-name" style="font-size:22px;font-weight:900;color:#f3f4f6">' +
          'اسمك هنا</span>' +
      '</div>' +
      '<div id="qne-sections"></div>';

    var sections = container.querySelector('#qne-sections');

    sections.appendChild(makeSection('لون ثابت', SOLID_COLORS.map(function (c) {
      return { id: c.id, name: c.name, preview: '<span style="color:' + c.value + ';font-weight:900">' + c.name + '</span>' };
    })));

    sections.appendChild(makeSection('تدرجات متحركة', GRADIENTS.map(function (g) {
      return { id: g.id, name: g.name, preview: '<span style="background:linear-gradient(90deg,' + g.c1 + ',' + g.c2 + ',' + g.c3 + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:900">' + g.name + '</span>' };
    })));

    sections.appendChild(makeSection('توهج', GLOWS.map(function (g) {
      return { id: g.id, name: g.name, preview: '<span style="color:' + g.color + ';text-shadow:0 0 6px ' + g.color + ';font-weight:900">' + g.name + '</span>' };
    })));

    sections.appendChild(makeSection('تحويلات', TRANSFORMS.map(function (t) {
      return { id: t.id, name: t.name, preview: '<span style="font-weight:900">' + t.name + '</span>' };
    })));

    sections.appendChild(makeSection('مشاهد خاصة', SCENES.map(function (s) {
      return { id: s.id, name: s.name, preview: '<span style="font-weight:900">' + s.name + '</span>' };
    })));

    container.addEventListener('click', function (e) {
      var tile = e.target.closest('.qne-tile');
      if (!tile) return;
      var section = tile.closest('.qne-sec').getAttribute('data-sec');
      var id = tile.getAttribute('data-id');
      applySelection(section, id);
    });

    var preview = container.querySelector('#qne-preview-name');
    var savedCfg = null;

    function applySelection(section, id) {
      var cfg = null;
      if (section === 'solid') {
        var c = SOLID_COLORS.find(function (x) { return x.id === id; });
        if (c) cfg = { mode: 'solid', value: c.value, id: c.id };
      } else if (section === 'gradient') {
        var g = GRADIENTS.find(function (x) { return x.id === id; });
        if (g) cfg = { mode: 'gradient', c1: g.c1, c2: g.c2, c3: g.c3, id: g.id };
      } else if (section === 'glow') {
        var gl = GLOWS.find(function (x) { return x.id === id; });
        if (gl) cfg = { mode: 'glow', value: gl.color, id: gl.id };
      } else if (section === 'transform') {
        cfg = { mode: 'transform', transform: id, id: id };
      } else if (section === 'scene') {
        cfg = { mode: 'scene', scene: id, id: id };
      }
      if (!cfg) return;
      savedCfg = cfg;

      apply(preview, cfg);

      try {
        var db = window.firebase && window.firebase.apps && window.firebase.apps.length ?
                 window.firebase.database() : null;
        if (db && St.currentUid) {
          db.ref('users/' + St.currentUid + '/nameEffects').set(cfg);
        }
      } catch (err) {}
    }

    try {
      var db2 = window.firebase && window.firebase.apps && window.firebase.apps.length ?
                window.firebase.database() : null;
      if (db2 && St.currentUid) {
        db2.ref('users/' + St.currentUid + '/nameEffects').once('value').then(function (snap) {
          var cfg = snap && snap.val ? snap.val() : null;
          if (cfg) apply(preview, cfg);
        });
      }
    } catch (err) {}

    if (window.QamarModal && window.QamarModal.open) {
      window.QamarModal.open({
        id: 'qne-modal',
        content: container,
        maxWidth: '420px'
      });
    } else {
      document.body.appendChild(container);
    }
  }

  function makeSection(title, items) {
    var div = document.createElement('div');
    div.className = 'qne-sec';
    div.style.marginBottom = '14px';

    var secId = title === 'لون ثابت' ? 'solid' :
                title === 'تدرجات متحركة' ? 'gradient' :
                title === 'توهج' ? 'glow' :
                title === 'تحويلات' ? 'transform' : 'scene';

    var html = '<div style="font-size:12px;font-weight:900;color:#9ca3af;' +
      'margin-bottom:8px;padding:0 4px">' + title + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));' +
        'gap:6px">';
    items.forEach(function (it) {
      html += '<button class="qne-tile" data-id="' + it.id + '" type="button" ' +
        'style="padding:10px 6px;border-radius:10px;background:rgba(255,255,255,.04);' +
        'border:1px solid rgba(255,255,255,.08);cursor:pointer;' +
        'font-family:inherit;color:#f3f4f6;font-size:12px">' +
        (it.preview || it.name) + '</button>';
    });
    html += '</div>';
    div.innerHTML = html;
    div.setAttribute('data-sec', secId);
    return div;
  }

  function init() {
    if (St.inited) return;
    St.inited = true;
    injectStyle();
    try {
      if (window.EventBus && window.EventBus.on) {
        window.EventBus.on('name-effects:open', function (d) {
          buildUI(d && d.uid);
        });
      }
    } catch (e) {}
    console.log('[name-effects-ui] v' + VERSION + ' ready');
  }

  window.QamarNameEffectsUI = {
    version: VERSION,
    open: buildUI,
    apply: apply,
    solidColors: SOLID_COLORS,
    gradients: GRADIENTS,
    glows: GLOWS,
    transforms: TRANSFORMS,
    scenes: SCENES,
    bgColors: BG_COLORS,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
