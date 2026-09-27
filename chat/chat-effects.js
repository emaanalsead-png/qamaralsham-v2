// ==============================================
// chat/chat-effects.js
// 42 unique name effects + cinema + glow
// ==============================================
// يعتمد على: constants.js + utils.js
// يعطي: window.QamarNameEffects + window.QamarChatEffects
// ==============================================

(function () {
    'use strict';

    const LOG_TAG = '[FX]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); }
    };

    /* ══════════════════════════════════════════════ */
    /* Style Registry — 42 unique styles               */
    /* ══════════════════════════════════════════════ */
    const STYLES = {
        // ─── A) ألوان ثابتة (12) ───
        gold:      { type: 'gradient', colors: ['#d4af37', '#ffd700', '#b8860b'] },
        sunset:    { type: 'gradient', colors: ['#ff6b35', '#f7931e', '#ff006e'] },
        aurora:    { type: 'gradient', colors: ['#00f5a0', '#00d9f5', '#a855f7'] },
        ocean:     { type: 'gradient', colors: ['#0077b6', '#00b4d8', '#90e0ef'] },
        galaxy:    { type: 'gradient', colors: ['#2b0a3d', '#7209b7', '#4cc9f0'] },
        fire:      { type: 'gradient', colors: ['#ff0000', '#ff8c00', '#ffd700'] },
        emerald:   { type: 'gradient', colors: ['#00b894', '#55efc4', '#00cec9'] },
        blood:     { type: 'gradient', colors: ['#8b0000', '#dc143c', '#8b0000'] },
        diamond:   { type: 'gradient', colors: ['#ffffff', '#c0c0c0', '#ffffff'] },
        royal:     { type: 'gradient', colors: ['#4b0082', '#d4af37', '#4b0082'] },
        cyber:     { type: 'gradient', colors: ['#00f3ff', '#ff00ff', '#00f3ff'] },
        rainbowtext: { type: 'gradient', colors: ['#ff0000', '#ff8c00', '#ffd700', '#00ff00', '#00bfff', '#8a2be2'] },

        // ─── B) تدرجات متحركة (6) ───
        'shimmer-gold':    { type: 'gradient', colors: ['#b8860b', '#ffd700', '#b8860b'], anim: 'shimmer', size: '250%' },
        'shimmer-rainbow': { type: 'gradient', colors: ['#ff0000', '#ff8c00', '#ffd700', '#00ff00', '#00bfff', '#a855f7'], anim: 'shimmer', size: '300%' },
        multicolor:        { type: 'anim-hue' },
        'hue-rotate':      { type: 'anim-hue', speed: '4s' },
        'diagonal-flow':   { type: 'gradient', colors: ['#00f3ff', '#a855f7', '#ff69b4'], anim: 'diag', size: '200%' },
        silk:              { type: 'gradient', colors: ['#ffd700', '#fff', '#ffd700'], anim: 'silk', size: '300%' },

        // ─── C) توهج (7) ───
        neon:            { type: 'glow', color: '#00f3ff' },
        'neon-flicker':  { type: 'glow', color: '#ff00ff', anim: 'flicker' },
        'glow-breathe':  { type: 'glow', color: '#ffd700', anim: 'breathe' },
        electric:        { type: 'glow', color: '#ffff00', anim: 'electric' },
        candle:          { type: 'glow', color: '#ff8c00', anim: 'candle' },
        twinkle:         { type: 'glow', color: '#fff', anim: 'twinkle' },
        'contrast-flash': { type: 'glow', color: '#ffffff', anim: 'flash' },

        // ─── D) تحويلات (6) ───
        breathe:           { type: 'transform', anim: 'breathe' },
        'skew-wave':       { type: 'transform', anim: 'skew' },
        'tilt-swing':      { type: 'transform', anim: 'tilt' },
        'saturate-breathe': { type: 'transform', anim: 'saturate' },
        'brightness-pulse': { type: 'transform', anim: 'brightness' },
        'spin-slow':       { type: 'transform', anim: 'spin' },

        // ─── E) مشاهد خاصة (11) ───
        spiral:       { type: 'gradient', colors: ['#ff006e', '#ffbe0b', '#3a86ff', '#8338ec'], anim: 'spiral', size: '400%' },
        nebula:       { type: 'gradient', colors: ['#7209b7', '#3a0ca3', '#4361ee', '#4cc9f0'], anim: 'nebula', size: '300%' },
        storm:        { type: 'gradient', colors: ['#2c3e50', '#4ca1af', '#2c3e50'], anim: 'storm', size: '250%' },
        fireworks:    { type: 'gradient', colors: ['#ff0000', '#ffff00', '#ff00ff', '#00ffff', '#00ff00'], anim: 'fireworks', size: '400%' },
        sugar:        { type: 'gradient', colors: ['#ff69b4', '#ffc0cb', '#fff'], anim: 'sugar', size: '250%' },
        snow:         { type: 'gradient', colors: ['#ffffff', '#cce7ff', '#ffffff'], anim: 'snow', size: '300%' },
        volcano:      { type: 'gradient', colors: ['#3d0000', '#ff4500', '#ffd700', '#3d0000'], anim: 'volcano', size: '300%' },
        waves:        { type: 'gradient', colors: ['#0077b6', '#00b4d8', '#00f5ff'], anim: 'waves', size: '250%' },
        liquid:       { type: 'gradient', colors: ['#00f5ff', '#ff00ff', '#00ff88', '#00f5ff'], anim: 'liquid', size: '400%' },
        'radial-pulse': { type: 'gradient', colors: ['#ffd700', '#ff006e', '#ffd700'], anim: 'radial', size: '200%' },
        sunrise:      { type: 'gradient', colors: ['#ffd700', '#ff8c00', '#ff69b4', '#8a2be2'], anim: 'sunrise', size: '350%' }
    };

    const STYLE_NAMES = Object.keys(STYLES);

    // Cinema styles — 8 variants (Text + Bg)
    const CINEMA_TEXT = {
        'ct-3d':       '3D Shadow',
        'ct-neon':     'نيون',
        'ct-gold':     'ذهبي فاخر',
        'ct-fire':     'نار',
        'ct-ice':      'جليد',
        'ct-blood':    'دم',
        'ct-outline':  'خط خارجي',
        'ct-emboss':   'بارز'
    };

    const CINEMA_BG = {
        'cb-dark':     'داكن',
        'cb-gradient': 'تدرج',
        'cb-glass':    'زجاجي',
        'cb-gold':     'ذهبي',
        'cb-fire':     'ناري'
    };

    /* ══════════════════════════════════════════════ */
    /* Inject CSS once                                 */
    /* ══════════════════════════════════════════════ */
    function _injectCSS() {
        if (document.getElementById('qamar-fx-styles')) return;

        const css = [
            // Animations (keyframes)
            '@keyframes qfx-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}',
            '@keyframes qfx-diag{0%{background-position:0% 0%}100%{background-position:200% 200%}}',
            '@keyframes qfx-silk{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}',
            '@keyframes qfx-hue{0%{filter:hue-rotate(0deg)}100%{filter:hue-rotate(360deg)}}',
            '@keyframes qfx-flicker{0%,19%,21%,23%,25%,54%,56%,100%{opacity:1;text-shadow:0 0 4px var(--qfx-c),0 0 11px var(--qfx-c),0 0 19px var(--qfx-c),0 0 40px var(--qfx-c)}20%,24%,55%{opacity:.85;text-shadow:none}}',
            '@keyframes qfx-breathe-glow{0%,100%{text-shadow:0 0 4px var(--qfx-c),0 0 10px var(--qfx-c)}50%{text-shadow:0 0 12px var(--qfx-c),0 0 28px var(--qfx-c),0 0 44px var(--qfx-c)}}',
            '@keyframes qfx-electric{0%,100%{text-shadow:0 0 2px var(--qfx-c),0 0 6px var(--qfx-c)}50%{text-shadow:0 0 8px var(--qfx-c),0 0 20px var(--qfx-c),0 0 34px var(--qfx-c)}}',
            '@keyframes qfx-candle{0%,100%{text-shadow:0 0 6px var(--qfx-c),0 0 14px var(--qfx-c);opacity:1}50%{text-shadow:0 0 10px var(--qfx-c),0 0 22px var(--qfx-c);opacity:.88}}',
            '@keyframes qfx-twinkle{0%,100%{opacity:1}50%{opacity:.4}}',
            '@keyframes qfx-flash{0%,100%{text-shadow:0 0 4px var(--qfx-c)}50%{text-shadow:0 0 22px var(--qfx-c)}}',

            '@keyframes qfx-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}',
            '@keyframes qfx-skew{0%,100%{transform:skewX(0deg)}50%{transform:skewX(8deg)}}',
            '@keyframes qfx-tilt{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}',
            '@keyframes qfx-saturate{0%,100%{filter:saturate(1)}50%{filter:saturate(2)}}',
            '@keyframes qfx-brightness{0%,100%{filter:brightness(1)}50%{filter:brightness(1.6)}}',
            '@keyframes qfx-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}',

            '@keyframes qfx-spiral{0%{background-position:0% 0%}50%{background-position:100% 100%}100%{background-position:0% 0%}}',
            '@keyframes qfx-nebula{0%{background-position:0% 50%;filter:brightness(1)}50%{background-position:100% 50%;filter:brightness(1.3)}100%{background-position:0% 50%;filter:brightness(1)}}',
            '@keyframes qfx-storm{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}',
            '@keyframes qfx-fireworks{0%,100%{background-position:0% 50%;filter:brightness(1)}25%{filter:brightness(1.6)}50%{background-position:100% 50%;filter:brightness(1.2)}75%{filter:brightness(1.8)}}',
            '@keyframes qfx-sugar{0%{background-position:0% 50%}100%{background-position:200% 50%}}',
            '@keyframes qfx-snow{0%{background-position:0% 50%}100%{background-position:200% 50%}}',
            '@keyframes qfx-volcano{0%{background-position:0% 50%;filter:brightness(.9)}50%{background-position:100% 50%;filter:brightness(1.5)}100%{background-position:0% 50%;filter:brightness(.9)}}',
            '@keyframes qfx-waves{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}',
            '@keyframes qfx-liquid{0%{background-position:0% 50%}25%{background-position:50% 0%}50%{background-position:100% 50%}75%{background-position:50% 100%}100%{background-position:0% 50%}}',
            '@keyframes qfx-radial{0%,100%{background-position:50% 50%;background-size:100% 100%}50%{background-size:160% 160%}}',
            '@keyframes qfx-sunrise{0%{background-position:0% 50%}100%{background-position:200% 50%}}',

            // Base text-style
            '.qfx-text{display:inline-block;font-weight:900;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;}',
            '.qfx-text.qfx-fallback{-webkit-text-fill-color:currentColor;color:inherit;}',

            // Gradient classes
            '.qfx-t-gold{background:linear-gradient(90deg,#d4af37,#ffd700,#b8860b);}',
            '.qfx-t-sunset{background:linear-gradient(90deg,#ff6b35,#f7931e,#ff006e);}',
            '.qfx-t-aurora{background:linear-gradient(90deg,#00f5a0,#00d9f5,#a855f7);}',
            '.qfx-t-ocean{background:linear-gradient(90deg,#0077b6,#00b4d8,#90e0ef);}',
            '.qfx-t-galaxy{background:linear-gradient(90deg,#2b0a3d,#7209b7,#4cc9f0);}',
            '.qfx-t-fire{background:linear-gradient(90deg,#ff0000,#ff8c00,#ffd700);}',
            '.qfx-t-emerald{background:linear-gradient(90deg,#00b894,#55efc4,#00cec9);}',
            '.qfx-t-blood{background:linear-gradient(90deg,#8b0000,#dc143c,#8b0000);}',
            '.qfx-t-diamond{background:linear-gradient(90deg,#fff,#c0c0c0,#fff);}',
            '.qfx-t-royal{background:linear-gradient(90deg,#4b0082,#d4af37,#4b0082);}',
            '.qfx-t-cyber{background:linear-gradient(90deg,#00f3ff,#ff00ff,#00f3ff);}',
            '.qfx-t-rainbowtext{background:linear-gradient(90deg,#ff0000,#ff8c00,#ffd700,#00ff00,#00bfff,#8a2be2,#ff0000);}',

            // Animated gradients
            '.qfx-t-shimmer-gold{background:linear-gradient(90deg,#b8860b,#ffd700,#b8860b);background-size:250% auto;animation:qfx-shimmer 3s linear infinite;}',
            '.qfx-t-shimmer-rainbow{background:linear-gradient(90deg,#ff0000,#ff8c00,#ffd700,#00ff00,#00bfff,#a855f7);background-size:300% auto;animation:qfx-shimmer 4s linear infinite;}',
            '.qfx-t-multicolor{animation:qfx-hue 3s linear infinite;}',
            '.qfx-t-hue-rotate{animation:qfx-hue 4s linear infinite;}',
            '.qfx-t-diagonal-flow{background:linear-gradient(135deg,#00f3ff,#a855f7,#ff69b4,#00f3ff);background-size:200% 200%;animation:qfx-diag 4s linear infinite;}',
            '.qfx-t-silk{background:linear-gradient(90deg,#b8860b,#ffd700,#fff,#ffd700,#b8860b);background-size:300% auto;animation:qfx-silk 5s ease-in-out infinite;}',

            // Glow classes
            '.qfx-glow{--qfx-c:#ffd700;}',
            '.qfx-glow-neon{color:#00f3ff;text-shadow:0 0 4px #00f3ff,0 0 10px #00f3ff,0 0 22px #00f3ff;}',
            '.qfx-glow-neon-flicker{color:#ff00ff;--qfx-c:#ff00ff;animation:qfx-flicker 2.2s linear infinite;}',
            '.qfx-glow-glow-breathe{color:#ffd700;--qfx-c:#ffd700;animation:qfx-breathe-glow 2.4s ease-in-out infinite;}',
            '.qfx-glow-electric{color:#ffff00;--qfx-c:#ffff00;animation:qfx-electric 0.9s ease-in-out infinite;}',
            '.qfx-glow-candle{color:#ff8c00;--qfx-c:#ff8c00;animation:qfx-candle 1.6s ease-in-out infinite;}',
            '.qfx-glow-twinkle{color:#fff;--qfx-c:#fff;animation:qfx-twinkle 1.4s ease-in-out infinite;}',
            '.qfx-glow-contrast-flash{color:#fff;--qfx-c:#fff;animation:qfx-flash 1s ease-in-out infinite;}',

            // Transforms
            '.qfx-tf-breathe{display:inline-block;animation:qfx-breathe 2.4s ease-in-out infinite;}',
            '.qfx-tf-skew-wave{display:inline-block;animation:qfx-skew 1.8s ease-in-out infinite;}',
            '.qfx-tf-tilt-swing{display:inline-block;animation:qfx-tilt 2.6s ease-in-out infinite;}',
            '.qfx-tf-saturate-breathe{display:inline-block;animation:qfx-saturate 3s ease-in-out infinite;}',
            '.qfx-tf-brightness-pulse{display:inline-block;animation:qfx-brightness 2s ease-in-out infinite;}',
            '.qfx-tf-spin-slow{display:inline-block;animation:qfx-spin 8s linear infinite;}',

            // Special scenes
            '.qfx-t-spiral{background:linear-gradient(45deg,#ff006e,#ffbe0b,#3a86ff,#8338ec,#ff006e);background-size:400% 400%;animation:qfx-spiral 6s ease infinite;}',
            '.qfx-t-nebula{background:linear-gradient(90deg,#7209b7,#3a0ca3,#4361ee,#4cc9f0,#7209b7);background-size:300% auto;animation:qfx-nebula 5s ease infinite;}',
            '.qfx-t-storm{background:linear-gradient(90deg,#2c3e50,#4ca1af,#2c3e50);background-size:250% auto;animation:qfx-storm 3.5s ease infinite;}',
            '.qfx-t-fireworks{background:linear-gradient(90deg,#ff0000,#ffff00,#ff00ff,#00ffff,#00ff00,#ff0000);background-size:400% auto;animation:qfx-fireworks 4s ease infinite;}',
            '.qfx-t-sugar{background:linear-gradient(90deg,#ff69b4,#ffc0cb,#fff,#ffc0cb,#ff69b4);background-size:250% auto;animation:qfx-sugar 4s linear infinite;}',
            '.qfx-t-snow{background:linear-gradient(90deg,#fff,#cce7ff,#fff,#cce7ff,#fff);background-size:300% auto;animation:qfx-snow 5s linear infinite;}',
            '.qfx-t-volcano{background:linear-gradient(90deg,#3d0000,#ff4500,#ffd700,#ff4500,#3d0000);background-size:300% auto;animation:qfx-volcano 5s ease infinite;}',
            '.qfx-t-waves{background:linear-gradient(90deg,#0077b6,#00b4d8,#00f5ff,#00b4d8,#0077b6);background-size:250% auto;animation:qfx-waves 3s ease-in-out infinite;}',
            '.qfx-t-liquid{background:linear-gradient(90deg,#00f5ff,#ff00ff,#00ff88,#00f5ff);background-size:400% auto;animation:qfx-liquid 7s ease infinite;}',
            '.qfx-t-radial-pulse{background:radial-gradient(circle,#ffd700,#ff006e,#ffd700);background-size:100% 100%;background-position:50% 50%;animation:qfx-radial 3s ease-in-out infinite;}',
            '.qfx-t-sunrise{background:linear-gradient(90deg,#ffd700,#ff8c00,#ff69b4,#8a2be2,#ffd700);background-size:350% auto;animation:qfx-sunrise 6s linear infinite;}',

            // Name background (behind text)
            '.qfx-name-bg{display:inline-block;padding:1px 6px;border-radius:8px;}',
            '.qfx-name-bg-glow{box-shadow:0 0 4px 1px var(--qfx-bg-glow),0 0 10px 2px var(--qfx-bg-glow);}',

            // Cinema — Text
            '.qfx-cin-text-3d{color:#fff;text-shadow:1px 1px 0 #333,2px 2px 0 #333,3px 3px 0 #333,4px 4px 8px rgba(0,0,0,0.6);letter-spacing:1px;}',
            '.qfx-cin-text-neon{color:#fff;text-shadow:0 0 4px #fff,0 0 12px #00f3ff,0 0 22px #00f3ff,0 0 40px #00f3ff;letter-spacing:1px;}',
            '.qfx-cin-text-gold{color:#ffd700;text-shadow:0 1px 0 #8b6914,0 2px 0 #8b6914,0 3px 4px rgba(0,0,0,0.7);letter-spacing:1px;}',
            '.qfx-cin-text-fire{color:#ff8c00;text-shadow:0 0 6px #ff4500,0 0 14px #ff0000,0 0 24px #8b0000;}',
            '.qfx-cin-text-ice{color:#cce7ff;text-shadow:0 0 6px #00bfff,0 0 14px #0077b6,0 0 22px #0077b6;}',
            '.qfx-cin-text-blood{color:#ff2222;text-shadow:0 1px 0 #600,0 2px 0 #600,0 3px 6px rgba(0,0,0,0.8);}',
            '.qfx-cin-text-outline{color:#0a0a15;-webkit-text-stroke:1.2px #ffd700;text-shadow:none;}',
            '.qfx-cin-text-emboss{color:#e0e0e0;text-shadow:1px 1px 0 #fff,-1px -1px 0 #808080;}',

            // Cinema — Background
            '.qfx-cin-bg-dark{background:rgba(0,0,0,0.85);padding:2px 8px;border-radius:8px;}',
            '.qfx-cin-bg-gradient{background:linear-gradient(90deg,#4b0082,#7209b7,#d4af37);padding:2px 8px;border-radius:8px;}',
            '.qfx-cin-bg-glass{background:rgba(255,255,255,0.12);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:2px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);}',
            '.qfx-cin-bg-gold{background:linear-gradient(90deg,#8b6914,#ffd700,#8b6914);padding:2px 8px;border-radius:8px;}',
            '.qfx-cin-bg-fire{background:linear-gradient(90deg,#3d0000,#ff4500,#3d0000);padding:2px 8px;border-radius:8px;}'
        ].join('');

        const style = document.createElement('style');
        style.id = 'qamar-fx-styles';
        style.textContent = css;
        document.head.appendChild(style);
        Logger.debug('CSS injected');
    }

    _injectCSS();

    /* ══════════════════════════════════════════════ */
    /* Apply / Clear                                   */
    /* ══════════════════════════════════════════════ */
    function _clearAll(el) {
        if (!el) return;
        // احذف كل qfx-* classes
        const classes = el.className.split(/\s+/).filter(function (c) {
            return c && c.indexOf('qfx-') !== 0;
        });
        el.className = classes.join(' ');
        el.style.color = '';
        el.style.background = '';
        el.style.webkitTextFillColor = '';
        el.style.textShadow = '';
        el.style.boxShadow = '';
        el.style.animation = '';
        el.style.transform = '';
    }

    function isValidStyle(name) {
        return !!(name && STYLES[name]);
    }

    function listStyles() {
        return STYLE_NAMES.slice();
    }

    function getRandomStyle() {
        return STYLE_NAMES[Math.floor(Math.random() * STYLE_NAMES.length)];
    }

    /* ══════════════════════════════════════════════ */
    /* Apply single style                              */
    /* ══════════════════════════════════════════════ */
    function applyStyle(el, styleName) {
        if (!el || !styleName) return false;
        if (!STYLES[styleName]) {
            Logger.debug('unknown style:', styleName);
            return false;
        }
        el.classList.add('qfx-t-' + styleName);
        return true;
    }

    /* ══════════════════════════════════════════════ */
    /* Apply gradient                                  */
    /* ══════════════════════════════════════════════ */
    function applyGradient(el, g1, g2) {
        if (!el || !g1 || !g2) return;
        el.style.background = 'linear-gradient(90deg,' + g1 + ',' + g2 + ',' + g1 + ')';
        el.style.backgroundSize = '200% auto';
        el.style.webkitBackgroundClip = 'text';
        el.style.backgroundClip = 'text';
        el.style.webkitTextFillColor = 'transparent';
        // animation
        if (!el.style.animation) {
            el.style.animation = 'qfx-shimmer 3s linear infinite';
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Apply glow                                      */
    /* ══════════════════════════════════════════════ */
    function applyGlow(el, color) {
        if (!el || !color) return;
        el.style.textShadow = '0 0 4px ' + color + ', 0 0 10px ' + color + ', 0 0 18px ' + color;
    }

    /* ══════════════════════════════════════════════ */
    /* Apply name background (behind text)             */
    /* ══════════════════════════════════════════════ */
    function applyNameBg(el, bgColor, bgGradient) {
        if (!el) return;
        el.classList.add('qfx-name-bg');
        if (bgColor) {
            el.style.background = bgColor;
            el.style.setProperty('--qfx-bg-glow', bgColor);
            el.classList.add('qfx-name-bg-glow');
        } else if (Array.isArray(bgGradient) && bgGradient.length === 2) {
            el.style.background = 'linear-gradient(90deg,' + bgGradient[0] + ',' + bgGradient[1] + ')';
            el.style.setProperty('--qfx-bg-glow', bgGradient[0]);
            el.classList.add('qfx-name-bg-glow');
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Apply cinema                                    */
    /* ══════════════════════════════════════════════ */
    function applyCinemaText(el, styleName) {
        if (!el || !styleName) return false;
        if (!CINEMA_TEXT[styleName]) return false;
        el.classList.add('qfx-cin-text-' + styleName.replace('ct-', ''));
        return true;
    }

    function applyCinemaBg(el, styleName) {
        if (!el || !styleName) return false;
        if (!CINEMA_BG[styleName]) return false;
        el.classList.add('qfx-cin-bg-' + styleName.replace('cb-', ''));
        return true;
    }

    /* ══════════════════════════════════════════════ */
    /* Master apply — priority: cinema > gradient > color */
    /* ══════════════════════════════════════════════ */
    function apply(el, source) {
        if (!el || !source) return;
        _clearAll(el);

        // text base
        el.classList.add('qfx-text');

        // ═══ 1) Cinema has top priority for text visual ═══
        let cinemaApplied = false;
        if (source.cinemaTextStyle && CINEMA_TEXT[source.cinemaTextStyle]) {
            cinemaApplied = applyCinemaText(el, source.cinemaTextStyle);
        }
        if (source.cinemaBgStyle && CINEMA_BG[source.cinemaBgStyle]) {
            applyCinemaBg(el, source.cinemaBgStyle);
        }

        if (cinemaApplied) {
            // cinema text style يغلب التدرجات
            el.classList.remove('qfx-text');
        } else {
            // ═══ 2) style by name (if provided) ═══
            if (source.nameStyle && STYLES[source.nameStyle]) {
                applyStyle(el, source.nameStyle);
            }

            // ═══ 3) explicit gradient overrides color ═══
            if (Array.isArray(source.nameGradient) && source.nameGradient.length === 2) {
                applyGradient(el, source.nameGradient[0], source.nameGradient[1]);
            } else if (source.nameColor) {
                // fallback — remove gradient clip and set color
                el.classList.remove('qfx-text');
                el.classList.add('qfx-fallback');
                el.style.color = source.nameColor;
            }
        }

        // ═══ 4) Name background (always, on top of text style) ═══
        const bgColor = source.nameBgColor;
        const bgGradient = source.nameBgGradient;
        if (bgColor || (Array.isArray(bgGradient) && bgGradient.length === 2)) {
            // لكن إذا cinema bg مطبّق — لا نطبّق هنا
            if (!source.cinemaBgStyle) {
                applyNameBg(el, bgColor, bgGradient);
            }
        }

        // ═══ 5) Profile glow (text-shadow) ═══
        if (source.profileGlow) {
            // لا نُلغي shadows أخرى — نضيف
            const existing = el.style.textShadow || '';
            const extra = '0 0 6px ' + source.profileGlow;
            el.style.textShadow = existing ? (existing + ', ' + extra) : extra;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Preview (للاستخدام في البروفايل لاحقاً)          */
    /* ══════════════════════════════════════════════ */
    function preview(styleName) {
        const el = document.createElement('span');
        el.textContent = 'قمر الشام';
        applyStyle(el, styleName);
        return el.outerHTML;
    }

    /* ══════════════════════════════════════════════ */
    /* Bulk apply — إلى قائمة عناصر                    */
    /* ══════════════════════════════════════════════ */
    function applyToSelector(selector, source) {
        try {
            const els = document.querySelectorAll(selector);
            for (let i = 0; i < els.length; i++) apply(els[i], source);
            return els.length;
        } catch (e) { return 0; }
    }

    /* ══════════════════════════════════════════════ */
    /* Clear                                           */
    /* ══════════════════════════════════════════════ */
    function clear(el) {
        _clearAll(el);
    }

    function clearAll(selector) {
        try {
            const els = document.querySelectorAll(selector || '.qfx-text');
            for (let i = 0; i < els.length; i++) _clearAll(els[i]);
        } catch (e) {}
    }

    /* ══════════════════════════════════════════════ */
    /* Status                                          */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        return {
            stylesCount: STYLE_NAMES.length,
            cinemaTextCount: Object.keys(CINEMA_TEXT).length,
            cinemaBgCount: Object.keys(CINEMA_BG).length,
            injected: !!document.getElementById('qamar-fx-styles')
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    const QamarNameEffects = {
        STYLES: STYLES,
        STYLE_NAMES: STYLE_NAMES,
        CINEMA_TEXT: CINEMA_TEXT,
        CINEMA_BG: CINEMA_BG,

        // Apply
        apply: apply,
        applyStyle: applyStyle,
        applyGradient: applyGradient,
        applyGlow: applyGlow,
        applyNameBg: applyNameBg,
        applyCinemaText: applyCinemaText,
        applyCinemaBg: applyCinemaBg,
        applyToSelector: applyToSelector,

        // Utilities
        isValidStyle: isValidStyle,
        listStyles: listStyles,
        getRandomStyle: getRandomStyle,
        preview: preview,

        // Clear
        clear: clear,
        clearAll: clearAll,

        // Debug
        getStatus: getStatus
    };

    // Alias لـ chat-ui.js
    window.QamarNameEffects = QamarNameEffects;
    window.QamarChatEffects = QamarNameEffects;

    Logger.info('📦 [chat-effects.js] loaded | styles:', STYLE_NAMES.length);
})();
