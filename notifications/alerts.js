/* ============================================================
   🌙 قمر الشام — notifications/alerts.js
   Version: 1.0
   الدور: بناء الإشعارات تلقائياً من مصادر مختلفة
   
   مصادر الملك (يستمع لها):
   - guardian_alerts_queue  → pm_violation (من pm-guardian-queue)
   - king_alerts            → تنبيهات عامة
   - multi_account_alerts   → حسابات مكررة
   - reports                → إبلاغات جديدة
   
   EventBus hooks (للمستخدم المستهدف):
   - user:jailed / user:released / user:banned / user:unbanned
   - user:warned / user:promoted / user:demoted
   - points:gifted / mic:kicked / room:kicked / user:transferred
   
   API:
   - QamarAlerts.push(uid, payload)
   - QamarAlerts.toKing(payload)
   - QamarAlerts.pushDeterministic(uid, notifId, payload)
   ============================================================ */
(function () {
  'use strict';

  if (window.QamarAlerts) return;

  var VERSION = '1.0';

  var St = {
    inited: false,
    uid: null,
    isKing: false,
    kingUid: null,
    subs: [],
    eventHooked: false
  };

  /* ==================== helpers ==================== */

  function getDb() {
    try {
      if (window.firebase && window.firebase.apps &&
          window.firebase.apps.length > 0 &&
          typeof window.firebase.database === 'function') {
        return window.firebase.database();
      }
    } catch (e) {}
    return null;
  }

  function refPath(p) {
    var db = getDb();
    return db ? db.ref(p) : null;
  }

  function getUid() {
    try {
      var A = window.QamarAuth;
      if (!A) return null;
      if (typeof A.getCurrentUser === 'function') {
        var u = A.getCurrentUser();
        if (u && u.uid) return u.uid;
      }
      if (A.currentUser && A.currentUser.uid) return A.currentUser.uid;
    } catch (e) {}
    return null;
  }

  function emit(name, data) {
    try {
      if (window.EventBus && window.EventBus.emit) {
        window.EventBus.emit(name, data);
      }
    } catch (e) {}
  }

  function nowTs() { return Date.now(); }

  function makeId(prefix) {
    return (prefix || 'al_') + nowTs().toString(36) + '_' +
           Math.random().toString(36).slice(2, 7);
  }

  /* ==================== core write ==================== */

  function writeOnce(targetUid, notifId, payload) {
    return new Promise(function (resolve) {
      var r = refPath('notifications/' + targetUid + '/' + notifId);
      if (!r) { resolve(false); return; }

      r.once('value').then(function (snap) {
        var exists = false;
        try {
          if (snap) {
            if (typeof snap.exists === 'function') exists = snap.exists();
            else if (typeof snap.val === 'function') exists = snap.val() !== null;
          }
        } catch (e) {}

        if (exists) { resolve(false); return; }

        var data = {
          type: payload.type || 'info',
          title: payload.title || '',
          body: payload.body || '',
          createdAt: payload.createdAt || nowTs(),
          read: false,
          from: payload.from || null,
          fromName: payload.fromName || '',
          link: payload.link || null,
          data: payload.data || null
        };

        r.set(data).then(function () {
          if (targetUid === St.uid &&
              window.QamarNotifications &&
              window.QamarNotifications.push) {
            try { window.QamarNotifications.push(data); } catch (e) {}
          }
          resolve(true);
        }, function () { resolve(false); });

      }, function () { resolve(false); });
    });
  }

  /* ==================== public API ==================== */

  function push(uid, payload) {
    if (!uid || !payload) return Promise.resolve(false);
    return writeOnce(uid, makeId('al_'), payload);
  }

  function toKing(payload) {
    if (!St.kingUid) return Promise.resolve(false);
    return writeOnce(St.kingUid, makeId('kg_'), payload);
  }

  function pushDeterministic(uid, notifId, payload) {
    return writeOnce(uid, notifId, payload);
  }

  /* ==================== king source listeners ==================== */

  function attachSource(prefixPath, notifIdPrefix, mapper) {
    var r = refPath(prefixPath);
    if (!r) return;
    var cb = function (snap) {
      if (!snap || !snap.key) return;
      var val = snap.val();
      if (!val || typeof val !== 'object') return;
      var payload = null;
      try { payload = mapper(snap.key, val); } catch (e) { payload = null; }
      if (!payload) return;
      var notifId = notifIdPrefix + snap.key;
      writeOnce(St.kingUid, notifId, payload);
    };
    try {
      r.on('child_added', cb);
      St.subs.push(function () {
        try { r.off('child_added', cb); } catch (e) {}
      });
    } catch (e) {}
  }

  function mapGuardianQueue(key, v) {
    var sev = v.severity === 'kick' ? 'كلمة طرد' : 'كلمة سجن';
    var side = v.side === 'receive' ? 'استقبل' : 'أرسل';
    return {
      type: 'guardian_alert',
      title: '🚨 ' + sev + ' في الخاص',
      body: (v.suspectName || 'مجهول') + ' ' + side + ' كلمة ممنوعة.\n' +
            'الضحية: ' + (v.victimName || '?') +
            (v.messagePreview ? '\n💬 ' + String(v.messagePreview).slice(0, 100) : ''),
      from: v.suspectUid || null,
      fromName: v.suspectName || '',
      data: {
        suspectUid: v.suspectUid || null,
        victimUid: v.victimUid || null,
        matchedWord: v.matchedWordMasked || null,
        severity: v.severity || null
      }
    };
  }

  function mapKingAlert(key, v) {
    return {
      type: v.type || 'system',
      title: v.title || '📢 تنبيه',
      body: v.body || v.message || '',
      from: v.from || null,
      fromName: v.fromName || ''
    };
  }

  function mapMultiAccount(key, v) {
    var devCount = (v.devices && v.devices.length) || 1;
    return {
      type: 'multi_account',
      title: '👥 حساب مكرر',
      body: (v.name || 'مستخدم') + ' — ' + devCount + ' جهاز',
      data: { uid: v.uid || null, devices: v.devices || null }
    };
  }

  function mapReport(key, v) {
    if (!v) return null;
    if (v.status === 'resolved') return null;
    return {
      type: 'report_sent',
      title: '🚨 إبلاغ جديد',
      body: 'من ' + (v.byName || 'مجهول') +
            ' ضد ' + (v.targetName || '?') +
            (v.reason ? '\nالسبب: ' + String(v.reason).slice(0, 120) : ''),
      from: v.byUid || null,
      fromName: v.byName || '',
      data: { reportId: key, targetUid: v.targetUid || null }
    };
  }

  function attachKingSources() {
    attachSource('guardian_alerts_queue', 'gq_', mapGuardianQueue);
    attachSource('king_alerts', 'ka_', mapKingAlert);
    attachSource('multi_account_alerts', 'ma_', mapMultiAccount);
    attachSource('reports', 'rp_', mapReport);
    console.log('[alerts] king sources attached');
  }

  /* ==================== EventBus hooks ==================== */

  function hookEventBus() {
    if (St.eventHooked) return;
    var bus = window.EventBus;
    if (!bus || typeof bus.on !== 'function') return;
    St.eventHooked = true;

    function on(name, handler) {
      try { bus.on(name, handler); } catch (e) {}
    }

    on('user:jailed', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'jail', title: '⛓️ تم سجنك',
        body: d.reason ? 'السبب: ' + d.reason : 'راجع الملك للتفاصيل',
        fromName: d.byName || ''
      });
    });

    on('user:released', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'release', title: '🔓 تم إفراجك',
        body: 'أهلاً بعودتك 🌙'
      });
    });

    on('user:banned', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'ban', title: '🚫 تم حظرك',
        body: d.reason ? 'السبب: ' + d.reason : '',
        fromName: d.byName || ''
      });
    });

    on('user:unbanned', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'unban', title: '✅ تم فك الحظر'
      });
    });

    on('user:warned', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'warn', title: '⚠️ تحذير',
        body: d.reason || '',
        fromName: d.byName || ''
      });
    });

    on('user:promoted', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'promote', title: '🎖️ ترقية',
        body: 'رتبتك الجديدة: ' + (d.newRank || '—')
      });
    });

    on('user:demoted', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'demote', title: '📉 تخفيض',
        body: 'رتبتك الجديدة: ' + (d.newRank || '—')
      });
    });

    on('points:gifted', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'gift', title: '🎁 هدية نقاط',
        body: '+' + (d.amount || 0) + ' نقطة من ' + (d.byName || '—')
      });
    });

    on('mic:kicked', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'mic_kick', title: '🎤 طرد من المايك'
      });
    });

    on('room:kicked', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'room_kick', title: '🚪 طرد من الغرفة',
        body: 'من غرفة: ' + (d.roomName || '—')
      });
    });

    on('user:transferred', function (d) {
      if (d && d.uid) push(d.uid, {
        type: 'transfer', title: '🔀 نقل',
        body: 'إلى غرفة: ' + (d.roomName || '—')
      });
    });

    on('notification:push', function (d) {
      if (!d) return;
      if (d.targetUid) push(d.targetUid, d.payload || d);
      else if (d.toKing) toKing(d.payload || d);
    });
  }

  /* ==================== auth handling ==================== */

  function detachAll() {
    St.subs.forEach(function (fn) { try { fn(); } catch (e) {} });
    St.subs = [];
  }

  function start(user) {
    if (!user || !user.uid) {
      detachAll();
      St.uid = null;
      St.isKing = false;
      St.kingUid = null;
      return;
    }
    if (St.uid === user.uid) return;
    St.uid = user.uid;

    var kingRef = refPath('config/king_uid');
    if (!kingRef) return;

    var kingCb = function (snap) {
      var k = snap && snap.val ? snap.val() : null;
      St.kingUid = typeof k === 'string' ? k : (k && k.uid ? k.uid : null);
      St.isKing = (St.kingUid === St.uid);
      if (St.isKing) attachKingSources();
    };

    try {
      kingRef.on('value', kingCb);
      St.subs.push(function () {
        try { kingRef.off('value', kingCb); } catch (e) {}
      });
    } catch (e) {}
  }

  function watchAuth() {
    var A = window.QamarAuth;
    if (A && typeof A.onAuthChange === 'function') {
      try {
        A.onAuthChange(function (u) { start(u); });
        return;
      } catch (e) {}
    }
    var last = '__init__';
    setInterval(function () {
      var u = getUid();
      if (u !== last) { last = u; start(u ? { uid: u } : null); }
    }, 1200);
  }

  /* ==================== init ==================== */

  function init() {
    if (St.inited) return;
    St.inited = true;

    hookEventBus();
    watchAuth();

    var uid = getUid();
    if (uid) start({ uid: uid });

    console.log('[alerts] v' + VERSION + ' ready');
  }

  window.QamarAlerts = {
    version: VERSION,
    init: init,
    push: push,
    toKing: toKing,
    pushDeterministic: pushDeterministic
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
