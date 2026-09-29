/* ============================================================
   🌙 QAMAR PROBE — ملف واحد، لا يحتاج تعديل index.html
   الاستخدام: افتح الموقع ثم أضف #probe في النهاية
   مثال: https://emaanalsead-png.github.io/qamaralsham-v2/#probe
   ============================================================ */
(function () {
  'use strict';

  // يعمل عند: #probe أو ?probe=1
  var hash = (location.hash || '').toLowerCase();
  var search = (location.search || '').toLowerCase();
  if (hash.indexOf('probe') === -1 && search.indexOf('probe') === -1) return;

  // انتظر QamarFirebase و QamarAuth
  function waitFor(test, timeout, cb) {
    var start = Date.now();
    var t = setInterval(function () {
      if (test()) { clearInterval(t); cb(true); }
      else if (Date.now() - start > timeout) { clearInterval(t); cb(false); }
    }, 300);
  }

  function start() {
    waitFor(function () {
      return window.QamarFirebase && window.QamarAuth;
    }, 15000, function () {
      setTimeout(run, 2500);
    });
  }

  var R = [];
  function L(s) { R.push(s == null ? '' : String(s)); }
  function H(s) { L(''); L('══════ ' + s + ' ══════'); }
  function K(o) { try { return Object.keys(o || {}).sort().join(','); } catch (e) { return '?'; } }
  function J(o) { try { return JSON.stringify(o); } catch (e) { return '?'; } }

  async function run() {
    var F = window.QamarFirebase || {};
    var A = window.QamarAuth || {};
    var S = window.QamarState || {};
    var EB = window.EventBus || {};

    var uid = (A.currentUser && A.currentUser.uid) ||
              (S.user && S.user.uid) ||
              (A.getCurrentUser && (A.getCurrentUser() || {}).uid) ||
              null;

    L('🌙 QAMAR PROBE v1');
    L('URL: ' + location.href);
    L('Time: ' + new Date().toISOString());
    L('UID: ' + (uid || '❌ none'));

    /* ===== 1. GLOBALS ===== */
    H('1. GLOBALS');
    ['QamarFirebase','QamarAuth','QamarState','EventBus','QamarToast',
     'QamarConstants','QamarUtils','QamarRooms','QamarChat','QamarBoot',
     'QamarAdaptive','QamarIdentity','QamarRanks','QamarNotifications',
     'QamarKing','QamarBots','QamarPM','QamarVoice','QamarDeviceGuard'
    ].forEach(function(k){ L('  ' + k + ' = ' + (window[k] ? '✅' : '❌')); });

    /* ===== 2. FIREBASE API ===== */
    H('2. FIREBASE API');
    L('  methods: ' + K(F));
    ['ref','onValue','off','push','set','update','remove','get','once','serverTimestamp']
      .forEach(function(m){ L('  .' + m + ' = ' + typeof F[m]); });

    /* ===== 3. AUTH ===== */
    H('3. AUTH');
    L('  methods: ' + K(A));
    L('  currentUser.uid = ' + (A.currentUser ? A.currentUser.uid : 'null'));
    L('  currentUser.isAnon = ' + (A.currentUser ? A.currentUser.isAnonymous : 'null'));

    /* ===== 4. STATE ===== */
    H('4. STATE');
    L('  keys: ' + K(S));
    L('  user keys: ' + K(S.user));
    L('  user sample: ' + J({
      uid: S.user && S.user.uid,
      name: S.user && S.user.name,
      rank: S.user && S.user.rank,
      rankLevel: S.user && S.user.rankLevel,
      isGuest: S.user && S.user.isGuest
    }));
    L('  room: ' + J(S.room));

    /* ===== 5. EVENTBUS ===== */
    H('5. EVENTBUS');
    L('  methods: ' + K(EB));
    var evts = EB._events || EB._handlers || EB.handlers || EB.map;
    L('  registered events: ' + (evts ? K(evts) : 'none'));

    /* ===== 6. HEADER BUTTONS ===== */
    H('6. HEADER BUTTONS');
    var hdr = document.querySelector('header, .chat-header, #chat-header, .app-header, .topbar');
    if (hdr) {
      var hb = hdr.querySelectorAll('button, [role="button"], .header-btn, [data-action]');
      L('  header tag: ' + hdr.tagName + '.' + (hdr.className || ''));
      L('  buttons: ' + hb.length);
      hb.forEach(function(b,i){
        L('  [' + i + '] id=' + (b.id||'-') +
          ' cls=' + (b.className||'-').slice(0,40) +
          ' txt=' + (b.textContent||'').trim().slice(0,20) +
          ' title=' + (b.title||'-') +
          ' data-action=' + (b.dataset.action||'-') +
          ' html=' + (b.innerHTML||'').slice(0,50));
      });
    } else L('  ❌ header not found');

    /* ===== 7. BOTTOM NAV ===== */
    H('7. BOTTOM NAV');
    var nav = document.querySelector('.bottom-nav, #bottom-nav, nav.bottom-nav, .nav-bar');
    if (nav) {
      var nb = nav.querySelectorAll('button, .nav-btn, [data-nav]');
      L('  buttons: ' + nb.length);
      nb.forEach(function(b,i){
        L('  [' + i + '] id=' + (b.id||'-') +
          ' cls=' + (b.className||'-').slice(0,40) +
          ' txt=' + (b.textContent||'').trim().slice(0,20) +
          ' data-nav=' + (b.dataset.nav||'-'));
      });
    } else L('  ❌ nav not found');

    /* ===== 8. SIDEBARS & MODALS ===== */
    H('8. SIDEBARS & MODALS');
    var found = 0;
    document.querySelectorAll('.sidebar, [class*="sidebar"], [id*="sidebar"], .modal, [class*="modal"], [id*="modal"]')
      .forEach(function(s,i){ found++; L('  [' + i + '] ' + s.tagName + ' id=' + (s.id||'-') + ' cls=' + (s.className||'-').slice(0,60)); });
    if (!found) L('  none');

    /* ===== 9. FIREBASE DATA (v1 paths) ===== */
    H('9. FIREBASE DATA — v1 sample paths');
    if (!F.ref || !F.get) { L('  ❌ no ref/get'); }
    else {
      var paths = [
        'notifications/' + uid,
        'user_notifications/' + uid,
        'users/' + uid,
        'guardian_inbox/' + uid,
        'king_alerts',
        'king_suspects',
        'multi_account_alerts',
        'bot_memory/hakawati',
        'bot_memory/hakawati_auto',
        'bot_memory/quiz',
        'bot_memory/islamic',
        'config/king_uid',
        'config/telegram',
        'banned_devices',
        'banned_ips',
        'reports',
        'audit_log'
      ];
      for (var i = 0; i < paths.length; i++) {
        try {
          var snap = await F.get(F.ref(paths[i]));
          var val = snap && snap.val ? snap.val() : null;
          if (val === null || val === undefined) {
            L('  ' + paths[i] + ' → 🟡 empty');
          } else if (typeof val === 'object') {
            var k = Object.keys(val);
            L('  ' + paths[i] + ' → ✅ ' + k.length + ' keys');
            if (k.length > 0) {
              var fk = k[0];
              var sample = val[fk];
              var s = (typeof sample === 'object') ? J(sample) : String(sample);
              L('      sample[' + fk + ']=' + s.slice(0, 180));
            }
          } else {
            L('  ' + paths[i] + ' → ✅ = ' + String(val).slice(0, 100));
          }
        } catch (e) {
          L('  ' + paths[i] + ' → ❌ ' + e.message);
        }
      }
    }

    /* ===== 10. SCRIPTS ===== */
    H('10. SCRIPTS');
    document.querySelectorAll('script[src]').forEach(function(s){
      L('  ' + (s.getAttribute('src')||''));
    });

    /* ===== 11. SCREEN ===== */
    H('11. SCREEN');
    L('  ' + innerWidth + '×' + innerHeight + ' dpr=' + devicePixelRatio);

    L('');
    L('══════ END ══════');

    showOverlay();
  }

  function showOverlay() {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:#050508;z-index:999999;display:flex;flex-direction:column;padding:10px;padding-top:max(10px,env(safe-area-inset-top));padding-bottom:max(10px,env(safe-area-inset-bottom));font-family:monospace';

    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-bottom:8px';
    bar.innerHTML =
      '<button id="p-copy" style="flex:1;padding:12px;border-radius:8px;background:#d4af37;color:#000;border:none;font-weight:900;font-family:inherit">📋 نسخ التقرير</button>' +
      '<button id="p-close" style="padding:12px 18px;border-radius:8px;background:#ef4444;color:#fff;border:none;font-weight:900;font-family:inherit">✕</button>';
    ov.appendChild(bar);

    var pre = document.createElement('pre');
    pre.id = 'p-txt';
    pre.style.cssText = 'flex:1;overflow:auto;background:#0a0a15;padding:10px;border-radius:8px;border:1px solid #d4af37;white-space:pre-wrap;word-break:break-all;margin:0;color:#d1d5db;font-size:10.5px;line-height:1.5;direction:ltr;text-align:left';
    pre.textContent = R.join('\n');
    ov.appendChild(pre);

    document.body.appendChild(ov);

    document.getElementById('p-copy').onclick = function () {
      var t = document.getElementById('p-txt').textContent;
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
      document.getElementById('p-copy').textContent = '✅ تم النسخ!';
    };
    document.getElementById('p-close').onclick = function () { ov.remove(); };
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
