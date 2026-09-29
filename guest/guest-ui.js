/* ============================================================
   🌙 قمر الشام — guest/guest-ui.js
   Version: 2.0 — only blocks TRULY restricted features
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarGuestUI) return;

  var VERSION = '2.0';
  var St = { inited: false, isGuest: false, modalOpen: false };

  var RESTRICTIONS = {
    pm:          { name: 'الخاص',        icon: '✉️' },
    upload:      { name: 'رفع الملفات',  icon: '📎' },
    effects:     { name: 'إطارات وسينما', icon: '🎨' },
    dice:        { name: 'النرد',         icon: '🎲' },
    profile:     { name: 'البروفايل',     icon: '👤' },
    kingRoom:    { name: 'غرفة الملك',    icon: '👑' },
    uid:         { name: 'رؤية UID',      icon: '🔑' },
    mic:         { name: 'المايك',        icon: '🎙️' }
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
    if (St.modalOpen) return;
    St.modalOpen = true;

    var label = RESTRICTIONS[feature] ? RESTRICTIONS[feature].name : 'هذه الميزة';

    var ov = document.createElement('div');
    ov.id = 'guest-upgrade-modal';
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:18500;' +
      'display:flex;align-items:center;justify-content:center;padding:20px;' +
      'font-family:inherit;direction:rtl';

    var card = document.createElement('div');
    card.style.cssText =
      'width:100%;max-width:380px;background:#0a0616;' +
      'border:1px solid rgba(212,175,55,.4);border-radius:18px;padding:22px;' +
      'text-align:center;position:relative';

    card.innerHTML =
      '<button id="gu-x" type="button" style="position:absolute;top:10px;left:10px;' +
        'width:28px;height:28px;border-radius:50%;background:transparent;' +
        'border:1px solid rgba(255,255,255,.1);color:#9ca3af;font-size:12px;' +
        'cursor:pointer;font-family:inherit">✕</button>' +
      '<div style="font-size:52px;margin-bottom:10px">✨</div>' +
      '<h3 style="font-size:18px;font-weight:900;color:#d4af37;margin:0 0 8px">' +
        'رقّي حسابك</h3>' +
      '<p style="font-size:13px;color:#9ca3af;line-height:1.7;margin:0 0 18px">' +
        'للوصول إلى <strong style="color:#f3f4f6">' + label + '</strong>، ' +
        'تحتاج ترقية حسابك من زائر إلى عضو.<br>' +
        'الترقية مجانية وتحفظ UID ونقاطك وبروفايلك.' +
      '</p>' +
      '<button id="gu-upgrade" type="button" ' +
        'style="width:100%;padding:14px;border-radius:12px;' +
        'background:linear-gradient(135deg,#d4af37,#b8860b);' +
        'color:#000;font-weight:900;font-size:14px;border:none;cursor:pointer;' +
        'font-family:inherit;margin-bottom:8px">' +
        '✨ ابدأ الترقية الآن' +
      '</button>' +
      '<button id="gu-later" type="button" ' +
        'style="width:100%;padding:10px;border-radius:10px;' +
        'background:transparent;border:1px solid rgba(255,255,255,.1);' +
        'color:#9ca3af;font-size:12px;cursor:pointer;font-family:inherit">' +
        'لاحقاً' +
      '</button>';

    ov.appendChild(card);
    document.body.appendChild(ov);

    function closeModal() {
      St.modalOpen = false;
      try { ov.remove(); } catch (e) {}
    }

    card.querySelector('#gu-x').addEventListener('click', closeModal);
    card.querySelector('#gu-later').addEventListener('click', closeModal);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });

    card.querySelector('#gu-upgrade').addEventListener('click', function () {
      closeModal();
      try {
        if (window.EventBus && window.EventBus.emit) {
          window.EventBus.emit('guest:upgrade-request');
        }
      } catch (e) {}
    });
  }

  // Only bubble phase — no capture
  function blockUI(selector, feature) {
    var els = document.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        if (el.dataset.guestHooked === '1') return;
        el.dataset.guestHooked = '1';
        el.setAttribute('data-guest-locked', '1');

        el.addEventListener('click', function (e) {
          if (!isGuest()) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          showUpgradeModal(feature);
        }, false);  // ← bubble, NOT capture
      })(els[i]);
    }
  }

  function applyGuestMode() {
    if (St.isGuest) return;
    St.isGuest = true;
    document.body.setAttribute('data-guest', '1');

    // Restrict ONLY truly restricted features
    blockUI('#pm-slot', 'pm');
    blockUI('[data-nav="pm"]', 'pm');
    blockUI('#plus-btn', 'upload');
    blockUI('#mic-btn', 'mic');
    blockUI('[data-nav="profile"]', 'profile');

    // NOT blocked: #notif-slot, [data-nav="notifications"],
    //              [data-nav="rooms"], [data-nav="chat"], #menu-btn

    // Guest banner
    var banner = $id('guest-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'guest-banner';
      banner.style.cssText =
        'position:fixed;bottom:70px;left:10px;right:10px;padding:10px 14px;' +
        'background:linear-gradient(135deg,rgba(212,175,55,.95),rgba(184,134,11,.95));' +
        'color:#000;font-weight:900;font-size:12px;border-radius:12px;' +
        'display:flex;align-items:center;gap:8px;z-index:600;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.5);font-family:inherit';

      banner.innerHTML =
        '<span style="font-size:18px">✨</span>' +
        '<span style="flex:1">أنت زائر — رقّي للوصول لكل الميزات</span>' +
        '<button id="guest-banner-btn" type="button" ' +
          'style="padding:6px 12px;border-radius:8px;background:#000;color:#d4af37;' +
          'border:none;font-weight:900;font-size:11px;cursor:pointer;font-family:inherit">' +
          'ترقية</button>' +
        '<button id="guest-banner-close" type="button" ' +
          'style="width:24px;height:24px;border-radius:50%;' +
          'background:rgba(0,0,0,.2);color:#000;border:none;cursor:pointer;' +
          'font-family:inherit">✕</button>';

      document.body.appendChild(banner);

      setTimeout(function () {
        var b = $id('guest-banner-btn');
        if (b) b.addEventListener('click', function () { showUpgradeModal(null); });
        var c = $id('guest-banner-close');
        if (c) c.addEventListener('click', function () {
          banner.style.display = 'none';
        });
      }, 50);
    }
  }

  function applyMemberMode() {
    if (!St.isGuest) return;
    St.isGuest = false;
    document.body.removeAttribute('data-guest');

    var banner = $id('guest-banner');
    if (banner) banner.style.display = 'none';

    var locked = document.querySelectorAll('[data-guest-locked]');
    for (var i = 0; i < locked.length; i++) {
      locked[i].removeAttribute('data-guest-locked');
      locked[i].style.opacity = '';
      locked[i].style.cursor = '';
    }
  }

  function refresh() {
    if (isGuest()) applyGuestMode();
    else applyMemberMode();
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    setTimeout(refresh, 500);

    try {
      var A = window.QamarAuth;
      if (A && typeof A.onAuthChange === 'function') {
        A.onAuthChange(function () { setTimeout(refresh, 200); });
      }
    } catch (e) {}

    // Re-apply after user navigates (new elements may appear)
    setInterval(refresh, 3000);

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
