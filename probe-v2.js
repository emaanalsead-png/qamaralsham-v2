/* ============================================================
   🌙 QAMAR PROBE v2 — فحص شامل للمشروع
   - يعمل تلقائياً عند التحميل
   - يقيس: الملفات + Globals + DOM + Firebase + أخطاء console
   - واجهة موبايل + زر نسخ
   ============================================================ */
(function () {
  'use strict';

  if (window.__probeV2Loaded) return;
  window.__probeV2Loaded = true;

  // ═══════════════════════════════════════════
  // القائمة الكاملة للملفات المتوقعة
  // ═══════════════════════════════════════════
  var EXPECTED_FILES = [
    // ─── Core ───
    { path: 'core/config.js',        global: 'FIREBASE_CONFIG',   name: 'config.js' },
    { path: 'core/constants.js',     global: 'QAMAR',             name: 'constants.js' },
    { path: 'core/utils.js',         global: 'showToast',         name: 'utils.js' },
    { path: 'core/state.js',         global: 'EventBus',          name: 'state.js' },
    { path: 'core/net-quality.js',   global: 'QamarNet',          name: 'net-quality.js' },
    { path: 'core/adaptive.js',      global: 'QamarAdaptive',     name: 'adaptive.js' },
    { path: 'core/boot.js',          global: 'QamarBoot',         name: 'boot.js' },

    // ─── Firebase ───
    { path: 'firebase/firebase.js',    global: 'QamarFB',           name: 'firebase.js' },
    { path: 'firebase/optimizers.js',  global: 'QamarOpt',          name: 'optimizers.js' },
    { path: 'firebase/resilience.js',  global: 'QamarResilience',   name: 'resilience.js' },
    { path: 'firebase/cleaners.js',    global: 'QamarCleaners',     name: 'cleaners.js' },

    // ─── Auth ───
    { path: 'auth/auth.js',      global: 'QamarAuth',      name: 'auth.js' },
    { path: 'auth/session.js',   global: 'QamarSession',   name: 'session.js' },
    { path: 'auth/identity.js',  global: 'QamarIdentity',  name: 'identity.js' },
    { path: 'auth/ranks.js',     global: 'QamarRanks',     name: 'ranks.js' },

    // ─── Security ───
    { path: 'security/audit.js',         global: 'QamarAudit',       name: 'audit.js' },
    { path: 'security/device-guard.js',  global: 'QamarDeviceGuard', name: 'device-guard.js' },
    { path: 'security/bans.js',          global: 'QamarBans',        name: 'bans.js' },
    { path: 'security/reports.js',       global: 'QamarReports',     name: 'reports.js' },
    { path: 'security/suspects.js',      global: 'QamarSuspects',    name: 'suspects.js' },

    // ─── Chat ───
    { path: 'chat/chat-effects.js', global: 'QamarNameEffects',  name: 'chat-effects.js' },
    { path: 'chat/chat.js',         global: 'QamarChat',         name: 'chat.js' },
    { path: 'chat/chat-ui.js',      global: 'QamarChatUI',       name: 'chat-ui.js' },
    { path: 'chat/chat-input.js',   global: 'QamarChatInput',    name: 'chat-input.js' },

    // ─── Rooms ───
    { path: 'rooms/room-settings.js', global: 'QamarRoomSettings', name: 'room-settings.js' },
    { path: 'rooms/room-voice.js',    global: 'QamarRoomVoice',    name: 'room-voice.js' },
    { path: 'rooms/rooms.js',         global: 'QamarRooms',        name: 'rooms.js' },

    // ─── PM ───
    { path: 'pm/pm.js',              global: 'QamarPM',           name: 'pm.js' },
    { path: 'pm/pm-voice.js',        global: 'QamarPMVoice',      name: 'pm-voice.js' },
    { path: 'pm/pm-guardian-queue.js', global: 'QamarGuardianQueue', name: 'pm-guardian-queue.js' },
    { path: 'pm/pm-monitor.js',      global: 'QamarPMMonitor',    name: 'pm-monitor.js' },
    { path: 'pm/pm-archiver.js',     global: 'QamarPMArchiver',   name: 'pm-archiver.js' },

    // ─── Voice ───
    { path: 'voice/voice-system.js',  global: 'QamarVoiceSystem',  name: 'voice-system.js' },
    { path: 'voice/voice-studio.js',  global: 'QamarVoiceStudio',  name: 'voice-studio.js' },
    { path: 'voice/voice-monitor.js', global: 'QamarVoiceMonitor', name: 'voice-monitor.js' },

    // ─── Bots ───
    { path: 'bots/bots.js',            global: 'QamarBots',           name: 'bots.js' },
    { path: 'bots/bot-commands.js',    global: 'QamarBotCommands',    name: 'bot-commands.js' },
    { path: 'bots/bot-training.js',    global: 'QamarBotTraining',    name: 'bot-training.js' },
    { path: 'bots/guardian-inbox.js',  global: 'QamarGuardianInbox',  name: 'guardian-inbox.js' },

    // ─── King ───
    { path: 'king/king-actions.js', global: 'QamarKingActions', name: 'king-actions.js' },
    { path: 'king/king-queens.js',  global: 'QamarKingQueens',  name: 'king-queens.js' },
    { path: 'king/king-room.js',    global: 'QamarKingRoom',    name: 'king-room.js' },

    // ─── UI ───
    { path: 'ui/login-flow.js',    global: 'QamarLoginFlow',    name: 'login-flow.js' },
    { path: 'ui/nav.js',           global: 'QamarNav',          name: 'nav.js' },
    { path: 'ui/sidebar.js',       global: 'QamarSidebar',      name: 'sidebar.js' },
    { path: 'ui/modal.js',         global: 'QamarModal',        name: 'modal.js' },
    { path: 'ui/context-menu.js',  global: 'QamarContextMenu',  name: 'context-menu.js' },
    { path: 'ui/profile.js',       global: 'QamarProfile',      name: 'profile.js' },

    // ─── Notifications ───
    { path: 'notifications/notifications.js', global: 'QamarNotifications', name: 'notifications.js' },
    { path: 'notifications/alerts.js',        global: 'QamarAlerts',        name: 'alerts.js' },

    // ─── Media ───
    { path: 'media/uploader.js',      global: 'QamarUploader',    name: 'uploader.js' },
    { path: 'media/media-picker.js',  global: 'QamarMediaPicker', name: 'media-picker.js' },
    { path: 'media/viewer.js',        global: 'QamarViewer',      name: 'viewer.js' },
    { path: 'media/emoji-picker.js',  global: 'QamarEmoji',       name: 'emoji-picker.js' },

    // ─── Effects ───
    { path: 'effects/frames-engine.js',    global: 'QamarFrames',          name: 'frames-engine.js' },
    { path: 'effects/name-effects-ui.js',  global: 'QamarNameEffectsUI',   name: 'name-effects-ui.js' },

    // ─── Guest ───
    { path: 'guest/guest-ui.js', global: 'QamarGuestUI', name: 'guest-ui.js' },

    // ─── Misc ───
    { path: 'misc/dice.js',          global: 'QamarDice',          name: 'dice.js' },
    { path: 'misc/youtube.js',       global: 'QamarYoutube',       name: 'youtube.js' },
    { path: 'misc/painter.js',       global: 'QamarPainter',       name: 'painter.js' },
    { path: 'misc/text-styler.js',   global: 'QamarTextStyler',    name: 'text-styler.js' },

    // ─── Debug ───
    { path: 'debug/debug-panel.js', global: 'QamarDebug', name: 'debug-panel.js' },

    // ─── Optional ───
    { path: 'room-picker.js',         global: 'QamarRoomPicker',  name: 'room-picker.js', optional: true },
    { path: 'stories/stories.js',     global: 'QamarStories',     name: 'stories.js', optional: true },
    { path: 'stories/stories-ui.js',  global: 'QamarStoriesUI',   name: 'stories-ui.js', optional: true },
    { path: 'social/friends.js',      global: 'QamarFriends',     name: 'friends.js', optional: true },
    { path: 'social/mentions.js',     global: 'QamarMentions',    name: 'mentions.js', optional: true },

    // ─── Profile (iframe) ───
    { path: 'profile/profile.html',       isFetch: true, name: 'profile/profile.html' },
    { path: 'profile/profile.css',        isFetch: true, name: 'profile/profile.css' },
    { path: 'profile/profile-core.js',    isFetch: true, name: 'profile/profile-core.js' },
    { path: 'profile/profile-actions.js', isFetch: true, name: 'profile/profile-actions.js' },
    { path: 'profile/profile-settings.js', isFetch: true, name: 'profile/profile-settings.js', optional: true }
  ];

  // ═══════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════
  var REPORT = [];
  var CONSOLE_ERRORS = [];
  var CONSOLE_WARNS = [];
  var originalError = console.error;
  var originalWarn = console.warn;

  // التقاط الأخطاء منذ البداية
  console.error = function () {
    var msg = Array.prototype.slice.call(arguments).map(function (a) {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ');
    CONSOLE_ERRORS.push(msg.substring(0, 200));
    if (CONSOLE_ERRORS.length > 30) CONSOLE_ERRORS.shift();
    return originalError.apply(console, arguments);
  };

  console.warn = function () {
    var msg = Array.prototype.slice.call(arguments).map(function (a) {
      return String(a);
    }).join(' ');
    CONSOLE_WARNS.push(msg.substring(0, 200));
    if (CONSOLE_WARNS.length > 30) CONSOLE_WARNS.shift();
    return originalWarn.apply(console, arguments);
  };

  window.addEventListener('error', function (e) {
    CONSOLE_ERRORS.push('[window.onerror] ' + (e.message || 'unknown') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || '?'));
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason || {};
    CONSOLE_ERRORS.push('[unhandled] ' + (r.message || String(r)));
  });

  // ═══════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════
  function L(line) { REPORT.push(line == null ? '' : String(line)); }
  function H(title) { L(''); L('══════════ ' + title + ' ══════════'); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function existsGlobal(name) {
    try {
      var v = window[name];
      return v !== undefined && v !== null;
    } catch (e) { return false; }
  }

  async function checkFile(fileObj) {
    if (fileObj.isFetch) {
      try {
        var r = await fetch(fileObj.path + '?probe=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
        return { ok: r.ok, status: r.status };
      } catch (e) {
        return { ok: false, status: 'error', error: e.message };
      }
    }
    // فحص الـ global
    return { ok: existsGlobal(fileObj.global), via: 'global' };
  }

  // ═══════════════════════════════════════════
  // Run Test
  // ═══════════════════════════════════════════
  async function runTest() {
    REPORT = [];

    L('🌙 QAMAR PROBE v2');
    L('Time: ' + new Date().toISOString());
    L('URL: ' + location.href);
    L('UA: ' + navigator.userAgent);
    L('Screen: ' + window.innerWidth + '×' + window.innerHeight);

    // ─── 1. البيئة ───
    H('1. ENVIRONMENT');
    L('  protocol: ' + location.protocol);
    L('  host: ' + location.host);
    L('  path: ' + location.pathname);
    L('  https: ' + (location.protocol === 'https:' ? '✅' : '❌'));
    L('  localStorage: ' + (function () {
      try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return '✅'; }
      catch (e) { return '❌ ' + e.message; }
    })());
    L('  indexedDB: ' + (window.indexedDB ? '✅' : '❌'));
    L('  fetch: ' + (window.fetch ? '✅' : '❌'));
    L('  AudioContext: ' + ((window.AudioContext || window.webkitAudioContext) ? '✅' : '❌'));
    L('  MediaRecorder: ' + (window.MediaRecorder ? '✅' : '❌'));

    // ─── 2. Firebase SDK ───
    H('2. FIREBASE SDK');
    L('  firebase global: ' + (typeof firebase !== 'undefined' ? '✅' : '❌'));
    if (typeof firebase !== 'undefined') {
      L('  firebase.apps: ' + (firebase.apps ? firebase.apps.length : '?'));
      try { L('  auth.current: ' + (firebase.auth().currentUser ? firebase.auth().currentUser.uid.substring(0, 12) + '...' : 'null')); }
      catch (e) { L('  auth error: ' + e.message); }
    }
    L('  window.auth: ' + (window.auth ? '✅' : '❌'));
    L('  window.db: ' + (window.db ? '✅' : '❌'));

    // ─── 3. الملفات ───
    H('3. FILES & GLOBALS');
    var missing = [];
    var loaded = [];
    var failed = [];

    for (var i = 0; i < EXPECTED_FILES.length; i++) {
      var f = EXPECTED_FILES[i];
      var result = await checkFile(f);
      var status = result.ok ? '✅' : (f.optional ? '⚠️' : '❌');
      var extra = '';
      if (result.via === 'global') extra = ' (global)';
      else if (result.status) extra = ' (' + result.status + ')';

      L('  ' + status + ' ' + f.name + extra);

      if (result.ok) loaded.push(f.name);
      else if (f.optional) failed.push(f.name + ' [optional]');
      else missing.push(f.name);
    }

    L('');
    L('  Summary:');
    L('    ✅ loaded: ' + loaded.length + '/' + EXPECTED_FILES.length);
    L('    ❌ missing (critical): ' + missing.length);
    L('    ⚠️ missing (optional): ' + failed.length);
    if (missing.length > 0) {
      L('');
      L('  CRITICAL MISSING:');
      missing.forEach(function (m) { L('    - ' + m); });
    }

    // ─── 4. DOM ───
    H('4. DOM ELEMENTS');
    var domCheck = [
      ['#login-screen', 'login-screen'],
      ['#main-app', 'main-app'],
      ['#starfield', 'starfield'],
      ['#qamar-boot-loader', 'boot-loader'],
      ['#chat-header', 'chat-header'],
      ['#messages-container', 'messages-container'],
      ['#message-input', 'message-input'],
      ['#send-btn', 'send-btn'],
      ['#bottom-nav', 'bottom-nav'],
      ['#sidebar-backdrop', 'sidebar-backdrop'],
      ['#sidebar-rooms', 'sidebar-rooms'],
      ['#sidebar-notifications', 'sidebar-notifications'],
      ['#sidebar-pm', 'sidebar-pm'],
      ['#sidebar-settings', 'sidebar-settings'],
      ['#pm-modal', 'pm-modal'],
      ['#profile-frame-container', 'profile-frame-container'],
      ['#profile-iframe', 'profile-iframe'],
      ['#pfc-close', 'pfc-close'],
      ['#bot-profile-modal', 'bot-profile-modal'],
      ['#upgrade-modal', 'upgrade-modal']
    ];
    domCheck.forEach(function (pair) {
      L('  ' + (document.querySelector(pair[0]) ? '✅' : '❌') + ' ' + pair[1]);
    });

    // ─── 5. الروابط ───
    H('5. SCRIPTS IN PAGE');
    var scripts = document.querySelectorAll('script[src]');
    L('  Total: ' + scripts.length);
    var scriptPaths = [];
    scripts.forEach(function (s) {
      var src = s.getAttribute('src');
      scriptPaths.push(src);
      L('  ' + src);
    });

    // ─── 6. CSS ───
    H('6. STYLESHEETS');
    var styles = document.querySelectorAll('link[rel="stylesheet"]');
    L('  Total: ' + styles.length);
    styles.forEach(function (s) {
      L('  ' + s.getAttribute('href'));
    });

    // ─── 7. Profile ───
    H('7. PROFILE CHECK');
    L('  profile-frame-container: ' + (document.getElementById('profile-frame-container') ? '✅' : '❌'));
    L('  profile-iframe: ' + (document.getElementById('profile-iframe') ? '✅' : '❌'));
    L('  openUserProfile (global): ' + (typeof window.openUserProfile === 'function' ? '✅' : '❌'));
    L('  openProfile (global): ' + (typeof window.openProfile === 'function' ? '✅' : '❌'));
    L('  QamarProfile (modal): ' + (window.QamarProfile ? '✅' : '❌'));
    L('  QamarNav.openProfile: ' + (window.QamarNav && window.QamarNav.openProfile ? '✅' : '❌'));

    // ─── 8. الأخطاء ───
    H('8. CONSOLE ERRORS');
    if (CONSOLE_ERRORS.length === 0) {
      L('  ✅ none');
    } else {
      L('  Total: ' + CONSOLE_ERRORS.length);
      CONSOLE_ERRORS.slice(-20).forEach(function (e, i) {
        L('  [' + i + '] ' + e);
      });
    }

    H('9. CONSOLE WARNINGS');
    if (CONSOLE_WARNS.length === 0) {
      L('  ✅ none');
    } else {
      L('  Total: ' + CONSOLE_WARNS.length);
      CONSOLE_WARNS.slice(-15).forEach(function (w, i) {
        L('  [' + i + '] ' + w);
      });
    }

    // ─── 10. Firebase Data Test ───
    H('10. FIREBASE DATA');
    if (window.QamarFB && typeof window.QamarFB.get === 'function') {
      var authUser = null;
      try { authUser = firebase.auth().currentUser; } catch (e) {}

      if (!authUser) {
        L('  ⚠️ no auth user — skipping data test');
      } else {
        var paths = [
          'users/' + authUser.uid,
          'config/king_uid',
          'user_presence/' + authUser.uid,
          'room_messages/general'
        ];
        for (var j = 0; j < paths.length; j++) {
          try {
            var v = await window.QamarFB.get(paths[j]);
            if (v === null || v === undefined) L('  🟡 ' + paths[j] + ' → empty');
            else if (typeof v === 'object') L('  ✅ ' + paths[j] + ' → ' + Object.keys(v).length + ' keys');
            else L('  ✅ ' + paths[j] + ' → ' + String(v).substring(0, 50));
          } catch (e) {
            L('  ❌ ' + paths[j] + ' → ' + e.message);
          }
        }
      }
    } else {
      L('  ❌ QamarFB not ready');
    }

    // ─── 11. Recommendations ───
    H('11. RECOMMENDATIONS');
    if (missing.indexOf('profile/profile-core.js') !== -1 ||
        missing.indexOf('profile/profile-actions.js') !== -1) {
      L('  🔴 الملفات الأساسية للبروفايل مفقودة — تأكد من مجلد profile/');
    }
    if (missing.indexOf('effects/name-effects-ui.js') !== -1) {
      L('  🔴 name-effects-ui.js مفقود — واجهة محرر الأنماط معطلة');
    }
    if (typeof window.QamarNameEffects !== 'undefined' && 
        typeof window.QamarNameEffects.open !== 'function') {
      L('  🔴 QamarNameEffects.open غير موجود (تصادم بين chat-effects و name-effects-ui)');
    }
    if (typeof window.QamarFrames !== 'undefined' && 
        !window.QamarFramesEngine) {
      L('  🟠 QamarFramesEngine غير معرّف — chat-ui لن يجد الإطارات');
    }
    if (!existsGlobal('QamarUploader')) {
      L('  🟠 QamarUploader غير محمّل — الرفع لن يعمل');
    }
    L('  ');
    L('  📱 للنسخ: اضغط زر "نسخ"');

    return {
      report: REPORT.join('\n'),
      summary: {
        loaded: loaded.length,
        missing: missing.length,
        optional: failed.length,
        errors: CONSOLE_ERRORS.length,
        warnings: CONSOLE_WARNS.length,
        criticalMissing: missing
      }
    };
  }

  // ═══════════════════════════════════════════
  // UI Overlay
  // ═══════════════════════════════════════════
  function showOverlay(text, summary) {
    // احذف القديم
    var old = document.getElementById('__probe_overlay');
    if (old) old.remove();

    var ov = document.createElement('div');
    ov.id = '__probe_overlay';
    ov.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:#050508;' +
      'display:flex;flex-direction:column;' +
      'padding-top:max(8px,env(safe-area-inset-top));' +
      'padding-bottom:max(8px,env(safe-area-inset-bottom));' +
      'padding-left:8px;padding-right:8px;font-family:monospace;direction:ltr';

    // Status bar
    var status = document.createElement('div');
    var statusColor = summary.missing > 0 || summary.errors > 0 ? '#ef4444' : '#84cc16';
    status.style.cssText =
      'padding:10px;background:' + statusColor + ';color:#000;' +
      'border-radius:8px;font-weight:900;font-size:13px;' +
      'text-align:center;margin-bottom:6px;font-family:Cairo,sans-serif;direction:rtl';
    status.innerHTML =
      '✅ محمّل: ' + summary.loaded + ' &nbsp;|&nbsp; ' +
      '❌ مفقود: ' + summary.missing + ' &nbsp;|&nbsp; ' +
      '⚠️ أخطاء: ' + summary.errors;
    ov.appendChild(status);

    // Actions
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';

    var copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 نسخ التقرير';
    copyBtn.style.cssText =
      'flex:1;padding:14px;border-radius:10px;background:#d4af37;' +
      'color:#000;border:none;font-family:Cairo,sans-serif;' +
      'font-weight:900;font-size:14px;cursor:pointer';
    copyBtn.onclick = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, 999999);
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
      // للمتصفحات الحديثة
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(function () {});
      }
      copyBtn.textContent = '✅ تم النسخ!';
      copyBtn.style.background = '#84cc16';
      setTimeout(function () {
        copyBtn.textContent = '📋 نسخ التقرير';
        copyBtn.style.background = '#d4af37';
      }, 2000);
    };
    bar.appendChild(copyBtn);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'padding:14px 20px;border-radius:10px;background:#ef4444;' +
      'color:#fff;border:none;font-weight:900;font-size:16px;cursor:pointer';
    closeBtn.onclick = function () { ov.remove(); };
    bar.appendChild(closeBtn);

    ov.appendChild(bar);

    // Report text
    var pre = document.createElement('pre');
    pre.style.cssText =
      'flex:1;overflow:auto;background:#0a0a15;color:#d1d5db;' +
      'padding:10px;border-radius:8px;border:1px solid #d4af37;' +
      'white-space:pre-wrap;word-break:break-all;margin:0;' +
      'font-size:10.5px;line-height:1.5';
    pre.textContent = text;
    ov.appendChild(pre);

    document.body.appendChild(ov);
  }

  // ═══════════════════════════════════════════
  // Auto-trigger
  // ═══════════════════════════════════════════
  function run() {
    // أظهر مؤشر تحميل
    var loading = document.createElement('div');
    loading.id = '__probe_loading';
    loading.style.cssText =
      'position:fixed;bottom:20px;left:20px;right:20px;max-width:300px;margin:auto;' +
      'z-index:2147483646;background:#0a0616;border:2px solid #d4af37;' +
      'border-radius:12px;padding:14px;font-family:Cairo,sans-serif;' +
      'direction:rtl;color:#d4af37;text-align:center;font-weight:900;font-size:13px;' +
      'box-shadow:0 10px 40px rgba(0,0,0,0.9)';
    loading.innerHTML = '🔍 جاري الفحص... <span id="__probe_pct">0%</span>';
    document.body.appendChild(loading);

    runTest().then(function (result) {
      if (loading.parentNode) loading.remove();
      showOverlay(result.report, result.summary);
      // وفر للـ console أيضاً
      console.log('══════ PROBE REPORT ══════');
      console.log(result.report);
    }).catch(function (e) {
      if (loading.parentNode) loading.remove();
      var er = '❌ Fatal error in probe: ' + e.message + '\n' + (e.stack || '');
      showOverlay(er, { loaded: 0, missing: 0, optional: 0, errors: 1, warnings: 0, criticalMissing: [] });
      console.error(er);
    });
  }

  // ابدأ بعد 3 ثواني من تحميل الصفحة
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(run, 3000);
  } else {
    window.addEventListener('load', function () {
      setTimeout(run, 3000);
    });
  }

  // اسمح بالتشغيل اليدوي من console
  window.__runProbe = run;

})();
