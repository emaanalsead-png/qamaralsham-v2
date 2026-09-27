// ==============================================
// core/utils.js
// Helpers: security, format, links, mentions, etc.
// ==============================================

(function () {
    'use strict';

    /* ══════════════════════════════════════════════ */
    /* 1. Security — XSS protection                    */
    /* ══════════════════════════════════════════════ */
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function sanitizeAttr(text) {
        if (!text) return '';
        return String(text).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    /* ══════════════════════════════════════════════ */
    /* 2. Toast notifications                          */
    /* ══════════════════════════════════════════════ */
    function showToast(icon, message, duration) {
        duration = duration || 3000;
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        const safeIcon = /^[a-z0-9-]+$/i.test(String(icon).replace('fa-', '')) ? icon : 'fa-info-circle';
        const iconEl = document.createElement('i');
        iconEl.className = 'fas ' + safeIcon;
        const spanEl = document.createElement('span');
        spanEl.textContent = message;
        toast.appendChild(iconEl);
        toast.appendChild(spanEl);
        toast.style.cssText = 'position:fixed;top:20px;right:20px;background:rgba(15,15,20,0.95);border:1px solid rgba(212,175,55,0.3);border-radius:12px;padding:12px 20px;display:flex;align-items:center;gap:10px;z-index:1100;box-shadow:0 5px 15px rgba(0,0,0,0.5);animation:toastIn 0.3s ease-out;max-width:90vw;direction:rtl;';
        document.body.appendChild(toast);
        setTimeout(function () {
            toast.style.animation = 'toastOut 0.3s ease-in';
            setTimeout(function () { toast.remove(); }, 300);
        }, duration);
    }

    /* ══════════════════════════════════════════════ */
    /* 3. Time & Dates                                 */
    /* ══════════════════════════════════════════════ */
    function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
    }

    function formatDate(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString('ar', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    function formatDateTime(ts) {
        if (!ts) return '';
        return formatDate(ts) + ' - ' + formatTime(ts);
    }

    function formatTimeShort(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function timeAgo(ts) {
        if (!ts) return '';
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 60) return 'الآن';
        const m = Math.floor(s / 60);
        if (m < 60) return 'قبل ' + m + ' دقيقة';
        const h = Math.floor(m / 60);
        if (h < 24) return 'قبل ' + h + ' ساعة';
        const d = Math.floor(h / 24);
        if (d < 30) return 'قبل ' + d + ' يوم';
        return formatDate(ts);
    }

    function formatLastSeen(ts, roomName) {
        if (!ts) return '—';
        const parts = [formatDate(ts), formatTimeShort(ts)];
        if (roomName) parts.push('📌 ' + roomName);
        return parts.join(' · ');
    }

    function formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes, i = 0;
        while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
        return size.toFixed(2) + ' ' + units[i];
    }

    function truncate(text, max) {
        max = max || 80;
        if (!text) return '';
        const str = String(text);
        return str.length > max ? str.substring(0, max) + '...' : str;
    }

    /* ══════════════════════════════════════════════ */
    /* 4. Link detection (with token ignore)           */
    /* ══════════════════════════════════════════════ */
    const TOKEN_PATTERNS = [
        /\[img:[^\]]+\]/gi,
        /\[e:\d+\]/gi,
        /\[cu:[^\]]+\]/gi,
        /\[sticker:[^\]]+\]/gi,
        /\[paint:[^\]]+\]/gi,
        /\[yt:[a-zA-Z0-9_-]{11}\]/gi,
        /\[sty:[A-Za-z0-9_\-=]+\]/gi,
        /\[audio:[^\]]+\]/gi,
        /\[video:[^\]]+\]/gi
    ];

    function _stripTokens(text) {
        let c = String(text);
        TOKEN_PATTERNS.forEach(function (p) { c = c.replace(p, ''); });
        return c;
    }

    function isLink(text) {
        if (!text) return false;
        const cleaned = _stripTokens(text);
        if (!cleaned.trim()) return false;
        const patterns = [
            /(https?:\/\/[^\s]+)/i,
            /(www\.[^\s]+)/i,
            /([a-z0-9-]+\.(com|net|org|io|ly|co|me|info|xyz|app|dev|tv|fm|link|sh|to|cc|ru|cn|tk))(\/[^\s]*)?/i,
            /(bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly)/i
        ];
        return patterns.some(function (p) { return p.test(cleaned); });
    }

    function extractLinks(text) {
        if (!text) return [];
        return String(text).match(/(https?:\/\/[^\s]+)/gi) || [];
    }

    /* ══════════════════════════════════════════════ */
    /* 5. Validation                                   */
    /* ══════════════════════════════════════════════ */
    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function isValidName(name) {
        if (!name) return false;
        const t = name.trim();
        return t.length >= 2 && t.length <= 20;
    }

    function isValidCountry(name) {
        if (!name) return false;
        const t = String(name).trim();
        return t.length >= 2 && t.length <= 40;
    }

    function isValidFamily(name) {
        if (!name) return false;
        const t = String(name).trim();
        return t.length >= 2 && t.length <= 30;
    }

    /* ══════════════════════════════════════════════ */
    /* 6. Mentions                                     */
    /* ══════════════════════════════════════════════ */
    function extractMentions(text) {
        if (!text) return [];
        const regex = /(?:^|\s)@([\u0600-\u06FFa-zA-Z0-9_]{2,20})(?=\s|$|[^\u0600-\u06FFa-zA-Z0-9_@])/g;
        const mentions = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            const name = match[1];
            const idx = match.index;
            if (idx > 0 && text[idx - 1] !== ' ' && text[idx - 1] !== '\n') continue;
            if (mentions.indexOf(name) === -1) mentions.push(name);
        }
        return mentions;
    }

    function buildMentionHTML(text, mentions, onClickMention) {
        const container = document.createDocumentFragment();
        if (!text) return container;
        if (!mentions || mentions.length === 0) {
            container.appendChild(document.createTextNode(text));
            return container;
        }
        const escaped = mentions.map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
        const regex = new RegExp('@?(' + escaped.join('|') + ')', 'g');
        let lastIndex = 0, match;
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                container.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            }
            const name = match[1];
            const span = document.createElement('span');
            span.className = 'mention-inline';
            span.setAttribute('data-mention', name);
            const img = document.createElement('img');
            img.src = getDefaultAvatar(name);
            img.alt = name;
            img.loading = 'lazy';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            span.appendChild(img);
            span.appendChild(nameSpan);
            if (onClickMention) {
                span.style.cursor = 'pointer';
                span.addEventListener('click', function () { onClickMention(name); });
            }
            container.appendChild(span);
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length) {
            container.appendChild(document.createTextNode(text.substring(lastIndex)));
        }
        return container;
    }

    /* ══════════════════════════════════════════════ */
    /* 7. Avatars                                      */
    /* ══════════════════════════════════════════════ */
    function getDefaultAvatar(name, bg, color) {
        bg = bg || 'random';
        color = color || 'fff';
        return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || 'User') + '&background=' + bg + '&color=' + color;
    }

    /* ══════════════════════════════════════════════ */
    /* 8. Performance                                  */
    /* ══════════════════════════════════════════════ */
    function debounce(fn, delay) {
        delay = delay || 300;
        let timer = null;
        return function () {
            const args = arguments, self = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(self, args); }, delay);
        };
    }

    function throttle(fn, limit) {
        limit = limit || 1000;
        let inThrottle = false;
        return function () {
            const args = arguments, self = this;
            if (!inThrottle) {
                fn.apply(self, args);
                inThrottle = true;
                setTimeout(function () { inThrottle = false; }, limit);
            }
        };
    }

    /* ══════════════════════════════════════════════ */
    /* 9. Safe storage                                 */
    /* ══════════════════════════════════════════════ */
    function safeGetJSON(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : (fallback || null);
        } catch (e) {
            console.warn('[utils] safeGetJSON error:', key, e);
            return fallback || null;
        }
    }

    function safeSetJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('[utils] safeSetJSON error:', key, e);
            return false;
        }
    }

    /* ══════════════════════════════════════════════ */
    /* 10. Environment detection                       */
    /* ══════════════════════════════════════════════ */
    function isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }
    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    /* ══════════════════════════════════════════════ */
    /* 11. User code                                   */
    /* ══════════════════════════════════════════════ */
    function generateUserCode(name, uid) {
        let prefix;
        const clean = (name || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (clean.length >= 2) prefix = clean.substring(0, 2);
        else if (clean.length === 1) prefix = clean + 'X';
        else prefix = 'U' + Math.floor(Math.random() * 9 + 1);

        let hash = 5381;
        const source = String(uid || (Math.random().toString(36) + Date.now()));
        for (let i = 0; i < source.length; i++) {
            hash = ((hash * 33) ^ source.charCodeAt(i)) >>> 0;
        }
        const h = hash.toString(36).toUpperCase().padStart(3, '0').slice(-3);
        return prefix + '·' + h;
    }

    function extractUserCode(text) {
        if (!text) return null;
        const m = String(text).match(/([A-Z0-9]{2,5})·([A-Z0-9]{3,4})/);
        return m ? m[0] : null;
    }

    /* ══════════════════════════════════════════════ */
    /* 12. Profile URL                                 */
    /* ══════════════════════════════════════════════ */
    function buildProfileUrl(uid, asOwner) {
        const base = (window.QAMAR && window.QAMAR.PROFILE_URL) || 'profile.html';
        if (asOwner) return base + '?owner=1';
        if (!uid) return base;
        return base + '?uid=' + encodeURIComponent(uid);
    }

    /* ══════════════════════════════════════════════ */
    /* 13. Stars background                            */
    /* ══════════════════════════════════════════════ */
    function generateStars() {
        const sf = document.getElementById('starfield');
        if (!sf) return;
        sf.innerHTML = '';
        for (let i = 0; i < 50; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.left = Math.random() * 100 + '%';
            star.style.animationDuration = (Math.random() * 3 + 2) + 's';
            star.style.animationDelay = (Math.random() * 5) + 's';
            sf.appendChild(star);
        }
    }

    /* ══════════════════════════════════════════════ */
    /* 14. Vibrate                                     */
    /* ══════════════════════════════════════════════ */
    function vibrate(ms) {
        ms = ms || 50;
        if (navigator.vibrate) {
            try { navigator.vibrate(ms); } catch (e) {}
        }
    }

    /* ══════════════════════════════════════════════ */
    /* Animations CSS                                  */
    /* ══════════════════════════════════════════════ */
    if (!document.getElementById('qamar-animations')) {
        const style = document.createElement('style');
        style.id = 'qamar-animations';
        style.textContent = [
            '@keyframes toastIn{from{opacity:0;transform:translateX(50px)}to{opacity:1;transform:translateX(0)}}',
            '@keyframes toastOut{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(50px)}}',
            '@keyframes fadeInSlide{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}'
        ].join('');
        document.head.appendChild(style);
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    Object.assign(window, {
        escapeHtml: escapeHtml,
        sanitizeAttr: sanitizeAttr,
        sanitizeText: escapeHtml,
        showToast: showToast,
        formatTime: formatTime,
        formatDate: formatDate,
        formatDateTime: formatDateTime,
        formatTimeShort: formatTimeShort,
        timeAgo: timeAgo,
        formatLastSeen: formatLastSeen,
        formatFileSize: formatFileSize,
        truncate: truncate,
        isLink: isLink,
        extractLinks: extractLinks,
        isValidEmail: isValidEmail,
        isValidName: isValidName,
        isValidCountry: isValidCountry,
        isValidFamily: isValidFamily,
        extractMentions: extractMentions,
        buildMentionHTML: buildMentionHTML,
        getDefaultAvatar: getDefaultAvatar,
        debounce: debounce,
        throttle: throttle,
        safeGetJSON: safeGetJSON,
        safeSetJSON: safeSetJSON,
        isMobile: isMobile,
        isIOS: isIOS,
        generateUserCode: generateUserCode,
        extractUserCode: extractUserCode,
        buildProfileUrl: buildProfileUrl,
        generateStars: generateStars,
        vibrate: vibrate
    });

    console.log('📦 [utils] loaded');
})();
