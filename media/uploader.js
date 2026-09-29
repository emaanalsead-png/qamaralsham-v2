/* ============================================================
   🌙 قمر الشام — media/uploader.js
   Version: 1.0
   ============================================================ */
(function () {
  'use strict';
  if (window.QamarUploader) return;

  var VERSION = '1.0';

  var LIMITS = {
    image: 5 * 1024 * 1024,
    gif: 5 * 1024 * 1024,
    audio: 10 * 1024 * 1024,
    video: 20 * 1024 * 1024
  };

  var St = {
    inited: false,
    telegram: null,
    telegramLoaded: false
  };

  /* ==================== utils ==================== */

  function emit(name, data) {
    try { if (window.EventBus && window.EventBus.emit) window.EventBus.emit(name, data); } catch (e) {}
  }

  function classify(file) {
    if (!file) return null;
    var mime = (file.type || '').toLowerCase();
    var name = (file.name || '').toLowerCase();

    if (mime === 'image/gif' || /\.gif$/.test(name)) return 'gif';
    if (mime.indexOf('image/') === 0) return 'image';
    if (mime.indexOf('audio/') === 0) return 'audio';
    if (mime.indexOf('video/') === 0) return 'video';
    return null;
  }

  function validate(file) {
    var kind = classify(file);
    if (!kind) return { ok: false, error: 'نوع الملف غير مدعوم' };
    var max = LIMITS[kind] || LIMITS.image;
    if (file.size > max) {
      var mb = (max / 1024 / 1024).toFixed(0);
      return { ok: false, error: 'الحد الأقصى ' + mb + 'MB (' + kind + ')' };
    }
    return { ok: true, kind: kind, max: max };
  }

  function toDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  function getDb() {
    try {
      if (window.firebase && window.firebase.apps && window.firebase.apps.length > 0) {
        return window.firebase.database();
      }
    } catch (e) {}
    return null;
  }

  /* ==================== telegram config ==================== */

  function loadTelegramConfig() {
    if (St.telegramLoaded) return Promise.resolve(St.telegram);
    return new Promise(function (resolve) {
      var db = getDb();
      if (!db) { St.telegramLoaded = true; resolve(null); return; }
      db.ref('config/telegram').once('value').then(function (snap) {
        var v = snap && snap.val ? snap.val() : null;
        if (v && v.botToken && v.chatId && v.enabled !== false) {
          St.telegram = { botToken: v.botToken, chatId: v.chatId };
        }
        St.telegramLoaded = true;
        resolve(St.telegram);
      }, function () {
        St.telegramLoaded = true;
        resolve(null);
      });
    });
  }

  /* ==================== uploaders ==================== */

  function uploadTelegram(file, kind) {
    return loadTelegramConfig().then(function (cfg) {
      if (!cfg) throw new Error('telegram-not-configured');

      var fd = new FormData();
      fd.append('chat_id', cfg.chatId);

      var method = 'sendDocument';
      var field = 'document';
      if (kind === 'image' || kind === 'gif') {
        method = 'sendPhoto';
        field = 'photo';
      } else if (kind === 'audio') {
        method = 'sendAudio';
        field = 'audio';
      } else if (kind === 'video') {
        method = 'sendVideo';
        field = 'video';
      }

      var name = file.name || (kind + '_' + Date.now());
      var ext = (file.name && file.name.split('.').pop()) || 'bin';
      var renamed = new File([file], name, { type: file.type });
      fd.append(field, renamed);

      return fetch('https://api.telegram.org/bot' + cfg.botToken + '/' + method, {
        method: 'POST',
        body: fd
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) throw new Error('telegram-failed');
        var result = j.result;
        var fileId = null;
        if (result.photo && result.photo.length) {
          fileId = result.photo[result.photo.length - 1].file_id;
        } else if (result.document) fileId = result.document.file_id;
        else if (result.audio) fileId = result.audio.file_id;
        else if (result.video) fileId = result.video.file_id;
        else if (result.voice) fileId = result.voice.file_id;

        if (!fileId) throw new Error('no-file-id');

        return fetch('https://api.telegram.org/bot' + cfg.botToken + '/getFile?file_id=' + fileId)
          .then(function (r) { return r.json(); })
          .then(function (g) {
            if (!g || !g.ok || !g.result || !g.result.file_path) {
              throw new Error('no-file-path');
            }
            return 'https://api.telegram.org/file/bot' + cfg.botToken + '/' + g.result.file_path;
          });
      });
    });
  }

  function uploadImgBB(file) {
    return new Promise(function (resolve, reject) {
      var db = getDb();
      if (!db) { reject(new Error('no-db')); return; }
      db.ref('config/imgbb_key').once('value').then(function (snap) {
        var key = snap && snap.val ? snap.val() : null;
        if (!key) { reject(new Error('no-imgbb-key')); return; }

        var fd = new FormData();
        fd.append('image', file);
        fd.append('key', key);

        fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: fd })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j && j.success && j.data && j.data.url) resolve(j.data.url);
            else reject(new Error('imgbb-failed'));
          })
          .catch(reject);
      }, function () { reject(new Error('no-db')); });
    });
  }

  function uploadCatbox(file) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('reqtype', 'fileupload');
      fd.append('fileToUpload', file, file.name || ('qamar_' + Date.now()));

      fetch('https://catbox.moe/user/api.php', { method: 'POST', body: fd })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          t = (t || '').trim();
          if (/^https?:\/\//.test(t)) resolve(t);
          else reject(new Error('catbox-failed'));
        })
        .catch(reject);
    });
  }

  function upload0x0(file) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('file', file, file.name || ('qamar_' + Date.now()));

      fetch('https://0x0.st', { method: 'POST', body: fd, headers: { 'User-Agent': 'QamarAlSham/2.0' } })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          t = (t || '').trim();
          if (/^https?:\/\//.test(t)) resolve(t);
          else reject(new Error('0x0-failed'));
        })
        .catch(reject);
    });
  }

  function uploadUguu(file) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('files[]', file, file.name || ('qamar_' + Date.now()));

      fetch('https://uguu.se/upload.php', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var url = j && j.files && j.files[0] && j.files[0].url;
          if (url) resolve(url);
          else reject(new Error('uguu-failed'));
        })
        .catch(reject);
    });
  }

  /* ==================== race helpers ==================== */

  function race(promises) {
    return new Promise(function (resolve, reject) {
      var pending = promises.length;
      var errors = [];
      var done = false;
      promises.forEach(function (p) {
        p.then(function (v) {
          if (done) return;
          done = true;
          resolve(v);
        }, function (e) {
          errors.push(e);
          pending--;
          if (pending === 0 && !done) {
            done = true;
            reject(new Error('all-failed: ' + errors.map(function (e) { return e.message; }).join(', ')));
          }
        });
      });
    });
  }

  /* ==================== main upload ==================== */

  function upload(file, opts) {
    opts = opts || {};
    var v = validate(file);
    if (!v.ok) return Promise.reject(new Error(v.error));

    var kind = v.kind;
    var onProgress = opts.onProgress;

    if (onProgress) onProgress(5, 'جارٍ التحضير...');

    var attempts = [];

    if (kind === 'image' || kind === 'gif') {
      attempts.push(function () { return uploadTelegram(file, kind); });
      attempts.push(function () { return uploadImgBB(file); });
      attempts.push(function () { return uploadCatbox(file); });
      attempts.push(function () { return upload0x0(file); });
      attempts.push(function () { return uploadUguu(file); });
    } else if (kind === 'audio') {
      attempts.push(function () { return uploadTelegram(file, kind); });
      attempts.push(function () { return uploadCatbox(file); });
      attempts.push(function () { return upload0x0(file); });
      attempts.push(function () { return uploadUguu(file); });
    } else {
      attempts.push(function () { return uploadTelegram(file, kind); });
      attempts.push(function () { return uploadCatbox(file); });
      attempts.push(function () { return upload0x0(file); });
    }

    if (onProgress) onProgress(15, 'جارٍ الرفع...');

    var chain = Promise.reject(new Error('start'));
    var lastErr = null;
    var idx = 0;

    function tryNext() {
      if (idx >= attempts.length) {
        return Promise.reject(lastErr || new Error('all-uploaders-failed'));
      }
      var fn = attempts[idx++];
      if (onProgress) onProgress(15 + idx * 15, 'محاولة ' + idx + '...');
      return fn().catch(function (e) {
        lastErr = e;
        return tryNext();
      });
    }

    return tryNext().then(function (url) {
      if (onProgress) onProgress(100, 'تم');
      emit('upload:success', { url: url, kind: kind });
      return { url: url, kind: kind, size: file.size, name: file.name };
    });
  }

  function init() {
    if (St.inited) return;
    St.inited = true;
    console.log('[uploader] v' + VERSION + ' ready');
  }

  window.QamarUploader = {
    version: VERSION,
    upload: upload,
    validate: validate,
    classify: classify,
    limits: LIMITS,
    toDataURL: toDataURL,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 150);
  }
})();
