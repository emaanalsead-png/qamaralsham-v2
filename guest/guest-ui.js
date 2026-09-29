/* ============================================================
   🌙 قمر الشام — guest/guest-ui.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarGuestUI) return;

  var VERSION = '1.0';
  var St = { inited: false, isGuest: false };

  var RESTRICTIONS = {
    pm:          { name: 'الخاص',        icon: '✉️' },
    upload:      { name: 'رفع الملفات',  icon: '📎' },
    effects:     { name: 'إطارات وسينما', icon: '🎨' },
    dice:        { name: 'النرد',         icon: '🎲' },
    alerts:      { name: 'تنبيهات',      icon: '🚨' },
    profile:     { name: 'البروفايل',     icon: '👤' },
    kingRoom:    { name: 'غرفة الملك',    icon: '👑' },
    uid:         { name: 'رؤية UID',      icon: '🔑' },
    mic:         { name: 'المايك',        icon: '🎙️' },
    stories:     { name: 'الحالات',       icon: '📸' },
    friends:     { name: 'الأصدقاء',      icon: '👥' },
    gifting:     { name: 'إهداء النقاط',  icon: '🎁' }
  };

  function $id(id) { return document.getElementById(id); }

  function isGuest() {
    try {
      var A = window.QamarAuth;
      if (A && typeof A.isGuest === 'function') return A.isGuest();
      if (A && A.currentUser) return !!A.currentUser.isAnonymous;
    } catch (e) {}
    return false;
  }

  function showUpgradeModal(feature) {
    var label = RESTRICTIONS[feature] ? RESTRICTIONS[feature].name : 'هذه الميزة';

    if (window.QamarModal && window.QamarModal.open) {
      var content = document.createElement('div');
      content.style.cssText = 'text-align:center;padding:8px 4px;direction:rtl';
      content.innerHTML =
        '<div style="font-size:56px;margin-bottom:12px">✨</div>' +
        '<h3 style="font-size:20px;font-weight:900;color:#d4af37;margin:0 0 8px">' +
          'رقّي حسابك</h3>' +
        '<p style="font-size:13px;color:#9ca3af;line-height:1.7;margin:0 0 16px">' +
          'للوصول إلى <strong style="color:#f3f4f6">' + label + '</strong>، ' +
          'تحتاج ترقية حسابك من زائر إلى عضو.<br>' +
          'الترقية مجانية وتحفظ UID ونقاطك وبروفايلك.' +
        '</p>' +
        '<button id="guest-upgrade" type="button" ' +
          'style="width:100%;padding:14px;border-radius:12px;' +
          'background:linear-gradient(135deg,#d4af37,#b8860b);' +
          'color:#000;font-weight:900;font-size:14px;border:none;cursor:pointer;' +
          'font-family:inherit">' +
          '✨ ابدأ الترقية الآن' +
        '</button>';

      window.QamarModal.open({
        id: 'guest-upgrade-modal',
        content: content,
        maxWidth: '380px'
      });

      setTimeout(function () {
        var btn = $id('guest-upgrade');
        if (btn) {
          btn.addEventListener('click', function () {
            if (window.QamarModal && window.QamarModal.close) {
              window.QamarModal.close('guest-upgrade-modal');
            }
            try {
              if (window.EventBus && window.EventBus.emit) {
                window.EventBus.emit('guest:upgrade-request');
              }
            } catch (e) {}
          });
        }
      }, 50);
      return;
    }

    try {
      if (window.EventBus && window.EventBus.emit) {
        window.EventBus.emit('toast:show', {
          message: '✨ رقّي حسابك للوصول إلى ' + label,
          kind: 'warn'
        });
      }
    } catch (e) {}
  }

  function blockUI(selector, feature) {
    var els = document.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        el.setAttribute('data-guest-locked', '1');
        el.style.opacity = '0.55';
        el.style.cursor = 'not-allowed';
        el.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          showUpgradeModal(feature);
        }, true);
      })(els[i]);
    }
  }

  function applyGuestMode() {
    St.isGuest = true;
    document.body.setAttribute('data-guest', '1');

    blockUI('#pm-slot', 'pm');
    blockUI('#plus-btn', 'upload');
    blockUI('#king-room-btn', 'kingRoom');
    blockUI('#mic-btn', 'mic');
    blockUI('[data-nav="pm"]', 'pm');
    blockUI('[data-nav="profile"]', 'profile');
    blockUI('[data-nav="notifications"]', 'alerts');

    var pmBtn = $id('pm-slot');
    if (pmBtn) pmBtn.style.display = '';

    var kingBtn = $id('king-room-btn');
    if (kingBtn) kingBtn.classList.add('hidden');

    var inviteBanner = $id('guest-banner');
    if (!inviteBanner) {
      inviteBanner = document.createElement('div');
      inviteBanner.id = 'guest-banner';
      inviteBanner.style.cssText =
        'position:fixed;bottom:70px;left:10px;right:10px;padding:10px 14px;' +
        'background:linear-gradient(135deg,rgba(212,175,55,.9),rgba(184,134,11,.9));' +
        'color:#000;font-weight:900;font-size:12px;border-radius:12px;' +
        'display:flex;align-items:center;gap:10px;z-index:600;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.5);font-family:inherit;' +
        'padding-bottom:max(10px,env(safe-area-inset-bottom))';
      inviteBanner.innerHTML =
        '<span style="font-size:20px">✨</span>' +
        '<span style="flex:1">أنت زائر — رقّي حسابك للوصول لكل الميزات</span>' +
        '<button id="guest-banner-btn" type="button" ' +
          'style="padding:6px 12px;border-radius:8px;background:#000;color:#d4af37;' +
          'border:none;font-weight:900;font-size:11px;cursor:pointer;font-family:inherit">' +
          'ترقية</button>' +
        '<button id="guest-banner-close" type="button" ' +
          'style="width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.2);' +
          'color:#000;border:none;cursor:pointer;font-family:inherit">✕</button>';

      document.body.appendChild(inviteBanner);

      setTimeout(function () {
        var b = $id('guest-banner-btn');
        if (b) b.addEventListener('click', function () { showUpgradeModal(null); });
        var c = $id('guest-banner-close');
        if (c) c.addEventListener('click', function () {
          inviteBanner.style.display = 'none';
        });
      }, 50);
    }
  }

  function applyMemberMode() {
    St.isGuest = false;
    document.body.removeAttribute('data-guest');

    var banner = $id('guest-banner');
    if (banner) banner.style.display = 'none';

    var locked = document.querySelectorAll('[data-guest-locked]');
    for (var i = 0; i < locked.length; i++) {
      locked[i].style.opacity = '';
      locked[i].style.cursor = '';
      locked[i].removeAttribute('data-guest-locked');
    }
  }

  function refresh() {
    if (isGuest()) applyGuestMode();
    else applyMemberMode();
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    refresh();

    try {
      var A = window.QamarAuth;
      if (A && typeof A.onAuthChange === 'function') {
        A.onAuthChange(function () { setTimeout(refresh, 200); });
      }
    } catch (e) {}

    setInterval(refresh, 3000);

    try {
      if (window.EventBus && window.EventBus.on) {
        window.EventBus.on('guest:blocked', function (d) {
          showUpgradeModal(d && d.feature);
        });
      }
    } catch (e) {}

    console.log('[guest-ui] v' + VERSION + ' ready');
  }

  window.QamarGuestUI = {
    version: VERSION,
    isGuest: isGuest,
    refresh: refresh,
    showUpgrade: showUpgradeModal,
    restrictions: RESTRICTIONS,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 250);
  }
})();
