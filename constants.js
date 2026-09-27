// ==============================================
// core/constants.js
// All QAMAR constants (rooms, ranks, keys, etc.)
// ==============================================

(function () {
    'use strict';

    const QAMAR = {

        /* ═══ Versions & URLs ═══ */
        VERSION: '2.0.0',
        PROFILE_URL: 'profile.html',
        INDEX_URL: 'index.html',

        /* ═══ Rank Levels ═══ */
        RANK_LEVELS: {
            'King': 100,
            'Queen': 95,
            'Master Owner': 90,
            'Room Owner': 85,
            'Grand Owner': 80,
            'Owner': 75,
            'Super Admin': 70,
            'Admin': 65,
            'Premium': 60,
            'User': 50
        },

        RANKS_ORDERED: [
            'King', 'Queen', 'Master Owner', 'Room Owner', 'Grand Owner',
            'Owner', 'Super Admin', 'Admin', 'Premium', 'User'
        ],

        getRankLevel: function (rank) {
            return this.RANK_LEVELS[rank] || 0;
        },
        isHigherRank: function (a, b) {
            return this.getRankLevel(a) > this.getRankLevel(b);
        },
        isHigherOrEqual: function (a, b) {
            return this.getRankLevel(a) >= this.getRankLevel(b);
        },

        /* ═══ Rooms ═══ */
        ROOMS: {
            general:      { id: 'general',      name: 'الروم العام',    icon: '🌍', type: 'public',  visibleTo: 'all',      micCount: 4, allowMic: true,  maxUsers: null },
            quiz:         { id: 'quiz',         name: 'روم المسابقات',  icon: '🎯', type: 'public',  visibleTo: 'all',      micCount: 4, allowMic: true,  maxUsers: null },
            islamic:      { id: 'islamic',      name: 'روم الإسلاميات', icon: '🕌', type: 'public',  visibleTo: 'all',      micCount: 1, allowMic: true,  maxUsers: null },
            royal:        { id: 'royal',        name: 'السويت الملكي',  icon: '👑', type: 'private', visibleTo: 'royal',    micCount: 2, allowMic: true,  maxUsers: 2 },
            candy:        { id: 'candy',        name: 'كانديز',         icon: '🍫', type: 'public',  visibleTo: 'all',      micCount: 4, allowMic: true,  maxUsers: null },
            studio:       { id: 'studio',       name: 'استديو التسجيل', icon: '🎙️', type: 'private', visibleTo: 'owner+',   micCount: 1, allowMic: true,  maxUsers: 1, hasRecording: true, hasEcho: true, hasEqualizer: true },
            gaza:         { id: 'gaza',         name: 'غزة العزة',      icon: '🇵🇸', type: 'public',  visibleTo: 'all',      micCount: 4, allowMic: true,  maxUsers: null },
            sham:         { id: 'sham',         name: 'ليالي الشام',    icon: '🌙', type: 'public',  visibleTo: 'all',      micCount: 4, allowMic: true,  maxUsers: null },
            bot_training: { id: 'bot_training', name: 'تدريب البوت',    icon: '🤖', type: 'private', visibleTo: 'royal',    micCount: 0, allowMic: false, maxUsers: 2, invisible: true },
            jail:         { id: 'jail',         name: 'السجن',          icon: '🚔', type: 'private', visibleTo: 'jailed',   micCount: 0, allowMic: false, maxUsers: null }
        },

        isRoomVisible: function (roomId, user) {
            const room = this.ROOMS[roomId];
            if (!room || !user) return false;
            if (user.rank === 'King') return true;
            if (roomId === 'bot_training' && user.rank === 'Queen') return true;
            switch (room.visibleTo) {
                case 'all':         return true;
                case 'royal':       return user.rank === 'King' || user.rank === 'Queen';
                case 'owner+':      return ['King','Queen','Master Owner','Room Owner','Grand Owner','Owner'].indexOf(user.rank) !== -1;
                case 'grandowner+': return ['King','Queen','Master Owner','Room Owner','Grand Owner'].indexOf(user.rank) !== -1;
                case 'jailed':      return user.isJailed === true;
                case 'king':        return user.rank === 'King';
                default:            return false;
            }
        },

        getVisibleRooms: function (user) {
            const out = {};
            for (const [id, room] of Object.entries(this.ROOMS)) {
                if (room.invisible) continue;
                if (this.isRoomVisible(id, user)) out[id] = room;
            }
            return out;
        },

        /* ═══ Colors ═══ */
        COLORS: {
            gold: '#d4af37',
            goldLight: '#ffd700',
            bgDark: '#050508'
        },

        /* ═══ Defaults ═══ */
        DEFAULT_BIO: '❋ نجوم الشام ❋',
        DEFAULT_NAME_SIZE: 26,
        AVATAR_SIZE: 120,

        DEFAULT_AVATAR_FRAMES: {
            'King': 'gold', 'Queen': 'pink',
            'Master Owner': 'silver', 'Room Owner': 'silver',
            'Grand Owner': 'silver', 'Owner': 'silver',
            'Super Admin': 'silver', 'Admin': 'silver',
            'Premium': 'gray', 'User': 'gray'
        },

        /* ═══ Backgrounds ═══ */
        BACKGROUNDS: [
            { id: 'stars',  class: 'background-type-stars' },
            { id: 'nebula', class: 'background-type-nebula' },
            { id: 'moon',   class: 'background-type-moon' },
            { id: 'dust',   class: 'background-type-dust' },
            { id: 'waves',  class: 'background-type-waves' }
        ],

        /* ═══ Rate Limiting ═══ */
        RATE_LIMIT: {
            MESSAGE_INTERVAL_MS: 5000,
            PRIVATE_MESSAGE_INTERVAL_MS: 3000,
            MAX_MESSAGE_LENGTH: 2000,
            MAX_FILE_SIZE: {
                image: 5 * 1024 * 1024,
                gif:   5 * 1024 * 1024,
                audio: 10 * 1024 * 1024,
                video: 20 * 1024 * 1024
            }
        },

        /* ═══ Jail ═══ */
        JAIL: {
            FIRST_OFFENSE_MS: 2 * 60 * 1000,
            ESCALATION_WINDOW_MS: 10 * 60 * 1000,
            MAX_AUTO_JAIL_MS: 15 * 60 * 1000,
            ESCALATION_MULTIPLIER: 2
        },

        /* ═══ Bots ═══ */
        BOTS: {
            GUARDIAN:   { id: 'guardian',   name: 'السجان',       icon: '🚔', color: '#ff4444', description: 'يحرس المكان.' },
            ISLAMIC:    { id: 'islamic',    name: 'قمر الشام',    icon: '🌙', color: '#d4af37', intervalMs: 5*60*1000, description: 'أدعية وأذكار.' },
            QUIZ:       { id: 'quiz',       name: 'الشاطر',       icon: '🎯', color: '#FF9800', intervalMs: 5*60*1000, revealDelayMs: 60*1000, description: 'أسئلة كل 5 دقائق.' },
            HAKAWATI:   { id: 'hakawati',   name: 'حكواتي الشام', icon: '📖', color: '#9C27B0', description: 'مساعد الموقع.' },
            AMBASSADOR: { id: 'ambassador', name: 'السفير',       icon: '🚪', color: '#84cc16', description: 'يرحب بالأعضاء الجدد.' }
        },

        /* ═══ Storage Keys ═══ */
        STORAGE_KEYS: {
            USER:                 'qamar_user',
            GUEST:                'qamar_guest',
            CURRENT_USER:         'qamar_current_user',
            BACKGROUND:           'qamar_background',
            IDENTITY_UPDATED_AT:  'qamar_identity_updated_at',
            ROOM_PICKER_DONE:     'qamar_room_picker_done',
            LAST_ROOM:            'qamar_last_room',
            SIDEBAR_STYLE:        'qamar_sidebar_style',
            SAVED_AVATAR:         'saved_avatar',
            SAVED_COVER:          'saved_cover',
            AVATAR_FRAME:         'saved_avatar_frame_motion',
            PROFILE_BG_TYPE:      'profile_bg_type',
            PROFILE_BG_VALUE:     'profile_bg_value',
            NAME_COLOR:           'name_color',
            NAME_GRADIENT:        'name_gradient',
            NAME_BG_COLOR:        'name_bg_color',
            NAME_BG_GRADIENT:     'name_bg_gradient',
            PROFILE_GLOW:         'profile_glow',
            PROFILE_NAME:         'profile_name',
            PROFILE_BIO:          'profile_bio',
            POETRY_TEXT:          'poetry_text',
            MUSIC_URL:            'profile_music_url',
            DEVICE_HASH:          'qamar_device_hash',
            DEVICE_ID:            'qamar_device_id',
            IP_HASH:              'qamar_ip_hash',
            DEVICE_UUID:          'qamar_device_uuid'
        },

        /* ═══ Settings ═══ */
        SETTINGS: {
            MESSAGES_LIMIT: 100,
            PRIVATE_MESSAGES_LIMIT: 50,
            NOTIFICATIONS_LIMIT: 50,
            USERS_PAGE_SIZE: 10,
            STORIES_LIMIT: 100
        },

        /* ═══ Queen Orders ═══ */
        QUEEN_ORDERS: {
            1: { label: 'الملكة الأولى',  short: 'الأولى',  color: '#ff69b4' },
            2: { label: 'الملكة الثانية', short: 'الثانية', color: '#ff69b4' },
            3: { label: 'الملكة الثالثة', short: 'الثالثة', color: '#ff69b4' },
            4: { label: 'الملكة الرابعة', short: 'الرابعة', color: '#ff69b4' }
        },

        /* ═══ Identity Fields (for profile) ═══ */
        IDENTITY_FIELDS: [
            'avatar', 'cover', 'coverType', 'name', 'bio',
            'nameColor', 'nameGradient', 'nameBgColor', 'nameBgGradient',
            'cinemaTextStyle', 'cinemaBgStyle',
            'avatarFrame', 'profileGlow', 'profileBgType', 'profileBgValue',
            'musicURL', 'poetry', 'poetryBg', 'poetryAttachment',
            'country', 'family'
        ],

        /* ═══ Visual Effects ═══ */
        PROFILE_GLOWS: [
            '#ffd700', '#ff69b4', '#00f3ff', '#39ff14',
            '#a855f7', '#ff0066', '#ffffff', '#ff4444',
            '#ff8c00', '#00ff88', '#8b00ff', '#feca57'
        ],

        NAME_BG_COLORS: [
            '#000000', '#ffffff', '#ff0000', '#ff4500',
            '#ff8c00', '#ffd700', '#ffff00', '#adff2f',
            '#39ff14', '#00cc00', '#00b894', '#00f3ff',
            '#00bfff', '#1e90ff', '#0000ff', '#6c5ce7',
            '#8a2be2', '#a855f7', '#ff00ff', '#da70d6',
            '#ff1493', '#e0115f', '#8b4513', '#696969'
        ],

        /* ═══ Firebase Paths ═══ */
        PATHS: {
            DEVICE_REGISTRY:      'device_registry',
            IP_REGISTRY:          'ip_registry',
            BANNED_DEVICES:       'banned_devices',
            BANNED_IPS:           'banned_ips',
            MULTI_ACCOUNT_ALERTS: 'multi_account_alerts',
            AUDIT_LOG:            'audit_log',
            KING_SUSPECTS:        'king_suspects',
            KING_ALERTS:          'king_alerts',
            ROOM_VOICE:           'room_voice',
            STUDIO_RECORDINGS:    'studio_recordings',
            STUDIO_SESSIONS:      'studio_sessions',
            ROOM_VOICE_MSGS:      'room_voice_msgs',
            PM_VOICE_MSGS:        'pm_voice_msgs',
            VOICE_MONITOR_LOCK:   'voice_monitor_lock'
        },

        /* ═══ Types ═══ */
        MUTE_TYPES: { GLOBAL: 'global', ROOM: 'room' },
        BAN_TYPES:  { TEMPORARY: 'temp', PERMANENT: 'perm' },

        /* ═══ Services ═══ */
        IP_SERVICE: 'https://ipwho.is/',

        /* ═══ Behaviors ═══ */
        TRANSFER: {
            MIN_RANK_LEVEL: 90,
            NOTIFY_USER: true,
            SAVE_LAST_ROOM: true
        },

        JAIL_BEHAVIOR: {
            FORCE_TRANSFER: true,
            SAVE_LAST_ROOM: true,
            LOCK_ROOM_SWITCH: true,
            AUTO_RETURN: true
        },

        MULTI_ACCOUNT: {
            ENABLED: true,
            NOTIFY_KING_VIA_BOT: true,
            SHOW_TAB: true
        },

        /* ═══ Arabic Normalization ═══ */
        ARABIC_EQUIVALENTS: {
            'ڪ': 'ك', 'ک': 'ك', 'گ': 'ك', 'ݢ': 'ك',
            'ی': 'ي', 'ے': 'ي', 'ى': 'ي', 'ئ': 'ي',
            'ہ': 'ه', 'ۀ': 'ه', 'ھ': 'ه', 'ە': 'ه',
            'ٱ': 'ا', 'آ': 'ا', 'أ': 'ا', 'إ': 'ا', 'ٲ': 'ا', 'ٳ': 'ا',
            'ﻭ': 'و', 'ۆ': 'و', 'ۇ': 'و',
            'ں': 'ن', 'ڕ': 'ر', 'ڒ': 'ر', 'ړ': 'ر',
            'ڵ': 'ل', 'ﻝ': 'ل', 'ﻡ': 'م',
            'ٻ': 'ب', 'پ': 'ب', 'ٹ': 'ت', 'ٺ': 'ت',
            'چ': 'ج', 'ډ': 'د', 'ښ': 'س', 'ڛ': 'س',
            'ﻉ': 'ع', 'ڠ': 'غ', 'ﻍ': 'غ',
            'ڨ': 'ق', 'ﻕ': 'ق', 'ڤ': 'ف', 'ڦ': 'ف',
            'ځ': 'ح', 'ڂ': 'ح', 'ڝ': 'ص', 'ڞ': 'ص',
            'ڟ': 'ط', 'ﻁ': 'ط', 'ﻅ': 'ظ',
            'ڊ': 'ذ', 'ڌ': 'ذ', 'ڜ': 'ش'
        },

        SWEAR_WORDS_SOURCES: {
            arabic: 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/ar',
            arabicFallback: 'https://cdn.jsdelivr.net/gh/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words@master/ar'
        }
    };

    /* ═══ Global exports ═══ */
    window.QAMAR = QAMAR;
    window.getRankLevel = function (rank) { return QAMAR.getRankLevel(rank); };

    console.log('📦 [constants] loaded | rooms:', Object.keys(QAMAR.ROOMS).length, '| ranks:', QAMAR.RANKS_ORDERED.length);
})();