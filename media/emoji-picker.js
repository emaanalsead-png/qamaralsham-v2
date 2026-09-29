/* ============================================================
   🌙 قمر الشام — media/emoji-picker.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarEmoji) return;

  var VERSION = '1.0';
  var PANEL_ID = 'qamar-emoji-picker';
  var St = { inited: false, currentInput: null, recent: [], tab: 'smileys' };

  var CATEGORIES = {
    smileys: {
      icon: '😀', name: 'وجوه',
      items: ('😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👹 👺 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾').split(' ')
    },
    gestures: {
      icon: '👍', name: 'إشارات',
      items: ('👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤝 🙏 💪 🦾 🦵 🦶 👂 🦻 👃 🧠 🦷 🦴 👀 👁 👅 👄 💋 🫦').split(' ')
    },
    hearts: {
      icon: '❤️', name: 'قلوب',
      items: ('❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💌 💋 💯 💢 💥 💫 💦 💨 🕳 💬 👁️‍🗨️ 🗨️ 🗯️ 💭 💤').split(' ')
    },
    animals: {
      icon: '🐱', name: 'حيوانات',
      items: ('🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐽 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🦟 🦗 🕷 🕸 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐓 🦃 🦚 🦜 🦢 🦩 🕊 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐀 🐿 🦔').split(' ')
    },
    food: {
      icon: '🍕', name: 'طعام',
      items: ('🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🦴 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 🫖 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊 🥄 🍴 🍽').split(' ')
    },
    objects: {
      icon: '⚽', name: 'أشياء',
      items: ('⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛴 🚲 🛵 🏍 🛺 🚗 🚕 🚙 🚌 🚎 🏎 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛺 🚲 🛴 🛹 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩 💺 🛰 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥 🛳 ⛴ 🚢 ⚓ ⛽ 🚧 🚦 🚥 🚏 🗺 🗿 🗽 🗼 🏰 🏯 🏟 🎡 🎢 🎠 ⛲ ⛱ 🏖 🏝 🏜 🌋 ⛰ 🏔 🗻 🏕 ⛺ 🏠 🏡 🏘 🏚 🏗 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛 ⛪ 🕌 🕍 🛕 🕋 ⛩ 🛤 🛣 🗾 🎑 🏞 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙 🌃 🌌 🌉 🌁').split(' ')
    },
    symbols: {
      icon: '✨', name: 'رموز',
      items: ('✨ ⭐ 🌟 💫 ⚡ 🔥 💧 🌊 🌙 ☀️ ⛅ ☁️ 🌤 🌦 🌧 ⛈ 🌩 🌨 ❄️ ☃️ ⛄ 🌬 💨 🌪 🌫 🌈 ☂️ ☔ 💐 🌸 💮 🏵 🌹 🥀 🌺 🌻 🌼 🌷 🌱 🌲 🌳 🌴 🌵 🌾 🌿 ☘️ 🍀 🍁 🍂 🍃 🍄 🌰 🎋 🎍 🎎 🎏 🎐 🎀 🎁 🎗 🎟 🎫 🎖 🏆 🏅 🥇 🥈 🥉 ⚽ ⚾ 🏀 🏐 🏈 🏉 🎾 🥎 🏐 🎱 🏏 🏑 🏒 🥍 🏓 🏸 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛴 🚲 🛵 🏍 🛺 🚗 🚕 🚙').split(' ')
    },
    flags: {
      icon: '🏁', name: 'أعلام',
      items: ('🇸🇾 🇵🇸 🇱🇧 🇯🇴 🇮🇶 🇸🇦 🇦🇪 🇰🇼 🇶🇦 🇧🇭 🇴🇲 🇾🇪 🇪🇬 🇱🇾 🇹🇳 🇩🇿 🇲🇦 🇸🇩 🇲🇷 🇸🇴 🇩🇯 🇰🇲 🇺🇸 🇬🇧 🇫🇷 🇩🇪 🇮🇹 🇪🇸 🇵🇹 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇮🇸 🇮🇪 🇬🇷 🇵🇱 🇨🇿 🇸🇰 🇭🇺 🇷🇴 🇧🇬 🇷🇸 🇭🇷 🇸🇮 🇧🇦 🇲🇪 🇦🇱 🇲🇰 🇹🇷 🇷🇺 🇺🇦 🇧🇾 🇬🇪 🇦🇲 🇦🇿 🇰🇿 🇺🇿 🇹🇲 🇰🇬 🇹🇯 🇦🇫 🇵🇰 🇮🇳 🇧🇩 🇱🇰 🇳🇵 🇧🇹 🇲🇲 🇹🇭 🇻🇳 🇰🇭 🇱🇦 🇲🇾 🇸🇬 🇮🇩 🇵🇭 🇧🇳 🇨🇳 🇯🇵 🇰🇷 🇰🇵 🇲🇳 🇦🇺 🇳🇿 🇫🇯 🇵🇬').split(' ')
    }
  };

  function $id(id) { return document.getElementById(id); }

  function ensurePanel() {
    var p = $id(PANEL_ID);
    if (p) return p;

    p = document.createElement('div');
    p.id = PANEL_ID;
    p.className = 'qamar-emoji-panel';
    p.style.cssText =
      'position:fixed;bottom:80px;left:10px;right:10px;max-width:400px;' +
      'margin:0 auto;background:#0a0616;border:1px solid rgba(212,175,55,.35);' +
      'border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.8);' +
      'z-index:9000;display:none;flex-direction:column;' +
      'max-height:60vh;direction:rtl;font-family:inherit';

    p.innerHTML =
      '<div id="qep-tabs" style="display:flex;gap:4px;padding:8px;' +
        'border-bottom:1px solid rgba(255,255,255,.06);overflow-x:auto"></div>' +
      '<div id="qep-body" style="flex:1;overflow-y:auto;padding:8px"></div>';

    document.body.appendChild(p);

    var tabs = p.querySelector('#qep-tabs');
    Object.keys(CATEGORIES).forEach(function (key) {
      var cat = CATEGORIES[key];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qep-tab';
      btn.setAttribute('data-cat', key);
      btn.style.cssText =
        'flex:0 0 auto;padding:8px 12px;border-radius:10px;' +
        'background:transparent;border:1px solid transparent;' +
        'font-size:20px;cursor:pointer;font-family:inherit';
      btn.textContent = cat.icon;
      btn.setAttribute('title', cat.name);
      tabs.appendChild(btn);
    });

    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.qep-tab');
      if (!b) return;
      var cat = b.getAttribute('data-cat');
      if (!cat) return;
      St.tab = cat;
      renderCategory(cat);
    });

    p.querySelector('#qep-body').addEventListener('click', function (e) {
      var btn = e.target.closest('.qep-emoji');
      if (!btn) return;
      var emoji = btn.getAttribute('data-emoji');
      insertEmoji(emoji);
    });

    return p;
  }

  function renderCategory(cat) {
    var panel = ensurePanel();
    var body = panel.querySelector('#qep-body');
    var c = CATEGORIES[cat];
    if (!c || !body) return;

    panel.querySelectorAll('.qep-tab').forEach(function (b) {
      var isActive = b.getAttribute('data-cat') === cat;
      b.style.background = isActive ? 'rgba(212,175,55,.15)' : 'transparent';
      b.style.borderColor = isActive ? 'rgba(212,175,55,.5)' : 'transparent';
    });

    var html = '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px">';
    c.items.forEach(function (em) {
      html += '<button type="button" class="qep-emoji" data-emoji="' + em + '" ' +
        'style="font-size:24px;padding:6px 0;background:transparent;border:none;' +
        'border-radius:8px;cursor:pointer;font-family:inherit;line-height:1">' + em + '</button>';
    });
    html += '</div>';

    body.innerHTML = html;
  }

  function insertEmoji(emoji) {
    var input = St.currentInput || $id('message-input');
    if (!input) return;

    var start = input.selectionStart != null ? input.selectionStart : input.value.length;
    var end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
    var val = input.value || '';
    input.value = val.slice(0, start) + emoji + val.slice(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();

    try {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {}

    addRecent(emoji);
  }

  function addRecent(emoji) {
    St.recent = St.recent.filter(function (e) { return e !== emoji; });
    St.recent.unshift(emoji);
    if (St.recent.length > 16) St.recent.length = 16;
  }

  function toggle(forceInput) {
    var p = ensurePanel();
    if (forceInput) St.currentInput = forceInput;
    if (p.style.display === 'flex') {
      p.style.display = 'none';
      return false;
    }
    p.style.display = 'flex';
    renderCategory(St.tab);
    return true;
  }

  function close() {
    var p = $id(PANEL_ID);
    if (p) p.style.display = 'none';
  }

  function attachTo(inputEl, buttonEl) {
    if (!inputEl || !buttonEl) return;
    if (buttonEl.dataset.qepHooked) return;
    buttonEl.dataset.qepHooked = '1';
    buttonEl.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle(inputEl);
    });
  }

  function init() {
    if (St.inited) return;
    St.inited = true;

    ensurePanel();

    var emojiBtn = $id('emoji-btn');
    var input = $id('message-input');
    if (emojiBtn && input) attachTo(input, emojiBtn);

    document.addEventListener('click', function (e) {
      var p = $id(PANEL_ID);
      if (!p || p.style.display !== 'flex') return;
      if (p.contains(e.target)) return;
      if (e.target.closest && e.target.closest('#emoji-btn')) return;
      close();
    });

    console.log('[emoji] v' + VERSION + ' ready');
  }

  window.QamarEmoji = {
    version: VERSION,
    toggle: toggle,
    close: close,
    attach: attachTo,
    insert: insertEmoji,
    categories: CATEGORIES
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 200);
  }
})();
