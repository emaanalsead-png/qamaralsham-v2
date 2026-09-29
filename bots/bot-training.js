// ==============================================
// bots/bot-training.js
// King's training panel for bot memory
// ==============================================
// يعتمد على: bots.js + bot-commands.js + firebase.js + auth.js + ranks.js + audit.js
// يعطي: window.QamarBotTraining
// ==============================================

(function () {
    'use strict';

    if (!window.QamarBots || !window.QamarBotCommands) {
        console.error('❌ [bot-training] bots.js أو bot-commands.js غير محمّل');
        return;
    }

    const LOG_TAG = '[TRN]';
    const Logger = {
        debug: function () { if (window.QAMAR_DEBUG) console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        info:  function () { console.log.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        warn:  function () { console.warn.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); },
        error: function () { console.error.apply(console, [LOG_TAG].concat(Array.prototype.slice.call(arguments))); }
    };

    /* ══════════════════════════════════════════════ */
    /* Config                                          */
    /* ══════════════════════════════════════════════ */
    const CONFIG = {
        MEM_ROOT: 'bot_memory',
        PENDING_ROOT: 'bot_learning/pending',
        KING_LEVEL: 100,
        OPERATOR_LEVEL: 90,
        BATCH_SIZE: 200,
        RATE_WINDOW_MS: 60 * 1000,
        RATE_MAX_OPS: 30,
        SEARCH_DEBOUNCE_MS: 200,
        IMPORT_CACHE_KEY: 'qamar_import_cache',
        IMPORT_CACHE_TTL_MS: 24 * 60 * 60 * 1000
    };

    const TABS = {
        badWords:      { label: '🚔 كلمات السجن',  type: 'wordlist', path: 'badWords',      kingOnly: false, minLength: 2 },
        kickWords:     { label: '🚪 كلمات الطرد',  type: 'wordlist', path: 'kickWords',     kingOnly: true,  minLength: 2 },
        hakawati:      { label: '📖 ردود حكواتي',  type: 'kv',       path: 'hakawati',      kingOnly: false },
        hakawatiAuto:  { label: '🔔 ردود تلقائية', type: 'kv',       path: 'hakawati_auto', kingOnly: false },
        quiz:          { label: '🎯 مسابقات',      type: 'quiz',     path: 'quiz',          kingOnly: false },
        islamic:       { label: '🌙 إسلاميات',     type: 'textlist', path: 'islamic',       kingOnly: false },
        pending:       { label: '📥 معلقة',        type: 'pending',  path: null,            kingOnly: false }
    };

    /* ══════════════════════════════════════════════ */
    /* State                                           */
    /* ══════════════════════════════════════════════ */
    const State = {
        open: false,
        activeTab: 'badWords',
        memory: {},           // { path: data }
        filtered: {},         // { path: filteredData }
        searchQuery: {},
        rateMap: {},
        _importing: false,
        overlayEl: null,
        dlgEl: null,
        dlgCleanup: null,
        searchTimers: {},
        listeners: []
    };

    /* ══════════════════════════════════════════════ */
    /* Helpers                                         */
    /* ══════════════════════════════════════════════ */
    function _getCurrentUid() {
        if (window.QamarAuth && window.QamarAuth.getUid) return window.QamarAuth.getUid();
        return window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;
    }

    function _myLevel() {
        if (window.QamarRanks && window.QamarRanks.myLevel) return window.QamarRanks.myLevel();
        return 0;
    }

    function _isKing100() {
        return _myLevel() >= CONFIG.KING_LEVEL;
    }

    function _isOperator() {
        return _myLevel() >= CONFIG.OPERATOR_LEVEL;
    }

    function _canTrainBots() {
        if (_isKing100()) return true;
        if (_myLevel() >= CONFIG.OPERATOR_LEVEL) {
            if (window.QamarRanks && window.QamarRanks.hasPermission) {
                return window.QamarRanks.hasPermission('canTrainBots');
            }
            return false;
        }
        return false;
    }

    function _canSeeTab(tabId) {
        const tab = TABS[tabId];
        if (!tab) return false;
        if (tab.kingOnly) return _isKing100();
        return _canTrainBots();
    }

    function _canEditTab(tabId) {
        const tab = TABS[tabId];
        if (!tab) return false;
        if (tab.kingOnly) return _isKing100();
        return _canTrainBots();
    }

    function _toArray(val) {
        if (!val) return [];
        if (Array.isArray(val)) return val.slice();
        if (typeof val === 'object') {
            return Object.keys(val).map(function (k) {
                var v = val[k];
                if (v && typeof v === 'object') return Object.assign({ _key: k }, v);
                return { _key: k, text: v };
            });
        }
        return [];
    }

    function _escapeHtml(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function _toast(msg, icon) {
        if (window.showToast) { try { window.showToast(icon || 'fa-info-circle', msg); return; } catch (e) {} }
        Logger.info(msg);
    }

    function _confirm(msg) {
        if (window.confirm) return window.confirm(msg);
        return true;
    }

    function _now() { return Date.now(); }

    /* ══════════════════════════════════════════════ */
    /* Rate limit                                      */
    /* ══════════════════════════════════════════════ */
    function _checkRate() {
        const uid = _getCurrentUid();
        if (!uid) return false;
        const now = _now();
        if (!State.rateMap[uid]) State.rateMap[uid] = [];
        State.rateMap[uid] = State.rateMap[uid].filter(function (t) { return now - t < CONFIG.RATE_WINDOW_MS; });
        if (State.rateMap[uid].length >= CONFIG.RATE_MAX_OPS) return false;
        State.rateMap[uid].push(now);
        return true;
    }

    /* ══════════════════════════════════════════════ */
    /* Audit                                           */
    /* ══════════════════════════════════════════════ */
    function _audit(action, data) {
        if (!window.QamarAudit) return;
        try {
            window.QamarAudit.log('editBotMemory', Object.assign({
                reason: action,
                details: data || {}
            }, data || {}));
        } catch (e) {}
    }

    /* ══════════════════════════════════════════════ */
    /* Load                                            */
    /* ══════════════════════════════════════════════ */
    function _loadMemory() {
        const paths = Object.keys(TABS)
            .filter(function (k) { return TABS[k].path; })
            .map(function (k) { return TABS[k].path; });

        return Promise.all(paths.map(function (p) {
            return window.QamarFB.get(CONFIG.MEM_ROOT + '/' + p).catch(function () { return null; });
        })).then(function (results) {
            Object.keys(TABS).forEach(function (k) {
                const path = TABS[k].path;
                if (!path) return;
                const idx = paths.indexOf(path);
                State.memory[k] = results[idx];
            });
            // معلقة
            return window.QamarFB.get(CONFIG.PENDING_ROOT).catch(function () { return null; });
        }).then(function (pending) {
            State.memory.pending = pending;
            Logger.info('📚 Memory cached for training');
        });
    }

    function _refreshAfterSave(tabId) {
        return window.QamarBotCommands.reloadMemory().catch(function () {});
    }

    /* ══════════════════════════════════════════════ */
    /* CRUD — word list                                */
    /* ══════════════════════════════════════════════ */
    function addWord(tabId, word) {
        return Promise.resolve().then(function () {
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'wordlist') throw new Error('نوع غير صحيح');

            const w = String(word || '').trim();
            if (w.length < tab.minLength) throw new Error('الكلمة قصيرة جداً');
            if (w.length > 60) throw new Error('الكلمة طويلة جداً');

            // كشف التكرار
            const existing = _toArray(State.memory[tabId]).map(function (x) { return (x.text || x) + ''; });
            if (existing.indexOf(w) !== -1) throw new Error('الكلمة موجودة');

            const path = CONFIG.MEM_ROOT + '/' + tab.path;
            return window.QamarFB.push(path, { text: w }).then(function (key) {
                _audit('addWord_' + tabId, { word: w, path: tab.path });
                State.memory[tabId] = State.memory[tabId] || {};
                State.memory[tabId][key] = { text: w };
                return _refreshAfterSave(tabId).then(function () { return { ok: true, key: key }; });
            });
        });
    }

    function editWord(tabId, key, newWord) {
        return Promise.resolve().then(function () {
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'wordlist') throw new Error('نوع غير صحيح');

            const w = String(newWord || '').trim();
            if (w.length < tab.minLength) throw new Error('الكلمة قصيرة جداً');

            const path = CONFIG.MEM_ROOT + '/' + tab.path + '/' + key;
            return window.QamarFB.update(path, { text: w }).then(function () {
                _audit('editWord_' + tabId, { key: key, newWord: w });
                if (State.memory[tabId] && State.memory[tabId][key]) {
                    State.memory[tabId][key] = Object.assign({}, State.memory[tabId][key], { text: w });
                }
                return _refreshAfterSave(tabId).then(function () { return { ok: true }; });
            });
        });
    }

    function deleteWord(tabId, key) {
        return Promise.resolve().then(function () {
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'wordlist') throw new Error('نوع غير صحيح');

            const path = CONFIG.MEM_ROOT + '/' + tab.path + '/' + key;
            return window.QamarFB.remove(path).then(function () {
                _audit('deleteWord_' + tabId, { key: key });
                if (State.memory[tabId]) delete State.memory[tabId][key];
                return _refreshAfterSave(tabId).then(function () { return { ok: true }; });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* CRUD — key-value (hakawati)                     */
    /* ══════════════════════════════════════════════ */
    function addPair(tabId, key, reply) {
        return Promise.resolve().then(function () {
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'kv') throw new Error('نوع غير صحيح');

            const k = String(key || '').trim();
            const r = String(reply || '').trim();
            if (!k) throw new Error('الكلمة المفتاحية مطلوبة');
            if (!r) throw new Error('الرد مطلوب');

            const safeKey = k.replace(/[.#$/\[\]]/g, '_').substring(0, 80);
            const path = CONFIG.MEM_ROOT + '/' + tab.path + '/' + safeKey;

            return window.QamarFB.set(path, r).then(function () {
                _audit('addPair_' + tabId, { key: safeKey, reply: r });
                State.memory[tabId] = State.memory[tabId] || {};
                State.memory[tabId][safeKey] = r;
                return _refreshAfterSave(tabId).then(function () { return { ok: true, safeKey: safeKey }; });
            });
        });
    }

    function editPair(tabId, safeKey, newReply) {
        return Promise.resolve().then(function () {
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'kv') throw new Error('نوع غير صحيح');

            const r = String(newReply || '').trim();
            if (!r) throw new Error('الرد مطلوب');

            const path = CONFIG.MEM_ROOT + '/' + tab.path + '/' + safeKey;
            return window.QamarFB.set(path, r).then(function () {
                _audit('editPair_' + tabId, { key: safeKey, newReply: r });
                if (State.memory[tabId]) State.memory[tabId][safeKey] = r;
                return _refreshAfterSave(tabId).then(function () { return { ok: true }; });
            });
        });
    }

    function deletePair(tabId, safeKey) {
        return Promise.resolve().then(function () {
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'kv') throw new Error('نوع غير صحيح');

            const path = CONFIG.MEM_ROOT + '/' + tab.path + '/' + safeKey;
            return window.QamarFB.remove(path).then(function () {
                _audit('deletePair_' + tabId, { key: safeKey });
                if (State.memory[tabId]) delete State.memory[tabId][safeKey];
                return _refreshAfterSave(tabId).then(function () { return { ok: true }; });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* CRUD — quiz                                     */
    /* ══════════════════════════════════════════════ */
    function addQuiz(question, answersArr) {
        return Promise.resolve().then(function () {
            if (!_canEditTab('quiz')) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');

            const q = String(question || '').trim();
            if (!q) throw new Error('السؤال مطلوب');
            if (!Array.isArray(answersArr) || answersArr.length === 0) throw new Error('أجب بصيغة: جواب1, جواب2');

            const path = CONFIG.MEM_ROOT + '/quiz';
            return window.QamarFB.push(path, { q: q, answers: answersArr }).then(function (key) {
                _audit('addQuiz', { question: q });
                return _refreshAfterSave('quiz').then(function () { return { ok: true, key: key }; });
            });
        });
    }

    function deleteQuiz(key) {
        return Promise.resolve().then(function () {
            if (!_canEditTab('quiz')) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');

            return window.QamarFB.remove(CONFIG.MEM_ROOT + '/quiz/' + key).then(function () {
                _audit('deleteQuiz', { key: key });
                return _refreshAfterSave('quiz').then(function () { return { ok: true }; });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* CRUD — text list (islamic)                      */
    /* ══════════════════════════════════════════════ */
    function addTextItem(tabId, text) {
        return Promise.resolve().then(function () {
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'textlist') throw new Error('نوع غير صحيح');

            const t = String(text || '').trim();
            if (!t) throw new Error('النص مطلوب');

            const path = CONFIG.MEM_ROOT + '/' + tab.path;
            return window.QamarFB.push(path, { text: t }).then(function (key) {
                _audit('addText_' + tabId, {});
                return _refreshAfterSave(tabId).then(function () { return { ok: true, key: key }; });
            });
        });
    }

    function deleteTextItem(tabId, key) {
        return Promise.resolve().then(function () {
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'textlist') throw new Error('نوع غير صحيح');

            return window.QamarFB.remove(CONFIG.MEM_ROOT + '/' + tab.path + '/' + key).then(function () {
                _audit('deleteText_' + tabId, { key: key });
                return _refreshAfterSave(tabId).then(function () { return { ok: true }; });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* CRUD — pending (learn hakawati)                 */
    /* ══════════════════════════════════════════════ */
    function teachPending(pendingKey, keyword, reply) {
        return Promise.resolve().then(function () {
            if (!_canEditTab('pending')) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');

            const k = String(keyword || '').trim();
            const r = String(reply || '').trim();
            if (!k || !r) throw new Error('الكلمة والرد مطلوبان');

            const safeKey = k.replace(/[.#$/\[\]]/g, '_').substring(0, 80);
            const updates = {};
            updates[CONFIG.MEM_ROOT + '/hakawati/' + safeKey] = r;
            updates[CONFIG.PENDING_ROOT + '/' + pendingKey] = null;

            return window.QamarFB.multiUpdate(updates).then(function () {
                _audit('teachPending', { keyword: k });
                return window.QamarBotCommands.reloadMemory().then(function () { return { ok: true }; });
            });
        });
    }

    function deletePending(pendingKey) {
        return Promise.resolve().then(function () {
            if (!_canEditTab('pending')) throw new Error('غير مصرّح');
            if (!_checkRate()) throw new Error('محاولات كثيرة');

            return window.QamarFB.remove(CONFIG.PENDING_ROOT + '/' + pendingKey).then(function () {
                _audit('deletePending', { key: pendingKey });
                if (State.memory.pending) delete State.memory.pending[pendingKey];
                return { ok: true };
            });
        });
    }

    function clearPending() {
        return Promise.resolve().then(function () {
            if (!_canEditTab('pending')) throw new Error('غير مصرّح');
            return window.QamarFB.remove(CONFIG.PENDING_ROOT).then(function () {
                _audit('clearPending', {});
                State.memory.pending = null;
                return { ok: true };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Import from internet                            */
    /* ══════════════════════════════════════════════ */
    function importArabicList(tabId) {
        return Promise.resolve().then(function () {
            if (State._importing) throw new Error('استيراد جارٍ بالفعل');
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'wordlist') throw new Error('الاستيراد للقوائم فقط');

            State._importing = true;

            // cache
            let cached = null;
            try {
                const raw = localStorage.getItem(CONFIG.IMPORT_CACHE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && parsed.at && (_now() - parsed.at) < CONFIG.IMPORT_CACHE_TTL_MS && Array.isArray(parsed.words)) {
                        cached = parsed.words;
                    }
                }
            } catch (e) {}

            const source = (window.QAMAR && window.QAMAR.SWEAR_WORDS_SOURCES && window.QAMAR.SWEAR_WORDS_SOURCES.arabic) ||
                           'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/ar';

            const fetchPromise = cached
                ? Promise.resolve(cached)
                : fetch(source)
                    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
                    .then(function (txt) {
                        const words = String(txt).split(/\r?\n/).map(function (w) { return w.trim(); })
                            .filter(function (w) { return w && w.length >= 2 && w.charAt(0) !== '#'; });
                        try { localStorage.setItem(CONFIG.IMPORT_CACHE_KEY, JSON.stringify({ words: words, at: _now() })); } catch (e) {}
                        return words;
                    });

            return fetchPromise.then(function (words) {
                // اقرأ الحالي
                return window.QamarFB.get(CONFIG.MEM_ROOT + '/' + tab.path).catch(function () { return null; });
            }).then(function (current) {
                const existingSet = {};
                _toArray(current).forEach(function (it) {
                    const t = (typeof it === 'string') ? it : (it.text || '');
                    if (t) existingSet[t] = true;
                });

                // فلترة المكرر
                const newWords = cached.filter(function (w) { return !existingSet[w]; });
                if (!newWords.length) {
                    _toast('لا كلمات جديدة', 'fa-info-circle');
                    State._importing = false;
                    return { ok: true, added: 0 };
                }

                // batch writes
                const path = CONFIG.MEM_ROOT + '/' + tab.path;
                let written = 0;
                const batches = [];
                for (let i = 0; i < newWords.length; i += CONFIG.BATCH_SIZE) {
                    batches.push(newWords.slice(i, i + CONFIG.BATCH_SIZE));
                }

                return batches.reduce(function (p, batch) {
                    return p.then(function () {
                        const newRef = window.QamarFB.ref(path);
                        const updates = {};
                        batch.forEach(function (w) {
                            const key = newRef.push().key;
                            updates[key] = { text: w };
                        });
                        return window.QamarFB.multiUpdate(
                            (function () {
                                const full = {};
                                Object.keys(updates).forEach(function (k) {
                                    full[path + '/' + k] = updates[k];
                                });
                                return full;
                            })()
                        ).then(function () {
                            written += batch.length;
                        });
                    });
                }, Promise.resolve()).then(function () {
                    _audit('import_' + tabId, { added: written });
                    _toast('تم استيراد ' + written + ' كلمة', 'fa-check');
                    return _refreshAfterSave(tabId).then(function () {
                        State._importing = false;
                        return { ok: true, added: written };
                    });
                });
            }).catch(function (e) {
                State._importing = false;
                throw e;
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Import from file (JSON)                         */
    /* ══════════════════════════════════════════════ */
    function importFromFile(tabId) {
        return new Promise(function (resolve, reject) {
            if (!_canEditTab(tabId)) { reject(new Error('غير مصرّح')); return; }
            const tab = TABS[tabId];
            if (!tab || tab.type !== 'wordlist') { reject(new Error('للقوائم فقط')); return; }

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.style.display = 'none';
            input.onchange = function () {
                const file = input.files && input.files[0];
                input.remove();
                if (!file) { resolve({ ok: false }); return; }

                const reader = new FileReader();
                reader.onload = function () {
                    try {
                        const data = JSON.parse(reader.result);
                        const words = Array.isArray(data)
                            ? data.map(function (x) {
                                if (typeof x === 'string') return x.trim();
                                if (x && typeof x === 'object' && x.text) return String(x.text).trim();
                                return null;
                            }).filter(Boolean)
                            : [];
                        if (!words.length) { reject(new Error('الملف فارغ أو غير صحيح')); return; }
                        _batchAddWords(tabId, words).then(resolve).catch(reject);
                    } catch (e) { reject(new Error('JSON غير صحيح')); }
                };
                reader.onerror = function () { reject(new Error('فشل قراءة الملف')); };
                reader.readAsText(file);
            };
            document.body.appendChild(input);
            input.click();
        });
    }

    function _batchAddWords(tabId, words) {
        const tab = TABS[tabId];
        const path = CONFIG.MEM_ROOT + '/' + tab.path;
        return window.QamarFB.get(path).catch(function () { return null; }).then(function (current) {
            const existing = {};
            _toArray(current).forEach(function (it) {
                const t = (typeof it === 'string') ? it : (it.text || '');
                if (t) existing[t] = true;
            });
            const filtered = words.filter(function (w) { return w && !existing[w]; });
            if (!filtered.length) {
                _toast('لا كلمات جديدة', 'fa-info-circle');
                return { ok: true, added: 0 };
            }
            const updates = {};
            filtered.forEach(function (w) {
                const key = window.QamarFB.ref(path).push().key;
                updates[path + '/' + key] = { text: w };
            });
            return window.QamarFB.multiUpdate(updates).then(function () {
                _audit('importFile_' + tabId, { added: filtered.length });
                _toast('تم استيراد ' + filtered.length + ' كلمة', 'fa-check');
                return _refreshAfterSave(tabId).then(function () {
                    return { ok: true, added: filtered.length };
                });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Export JSON                                     */
    /* ══════════════════════════════════════════════ */
    function exportTab(tabId) {
        return Promise.resolve().then(function () {
            if (!_canSeeTab(tabId)) throw new Error('غير مصرّح');
            const tab = TABS[tabId];
            const path = CONFIG.MEM_ROOT + '/' + tab.path;
            return window.QamarFB.get(path).catch(function () { return null; }).then(function (data) {
                const arr = _toArray(data).map(function (it) {
                    if (typeof it === 'string') return it;
                    if (it.text) return { text: it.text };
                    if (it.q) return { q: it.q, answers: it.answers };
                    return it;
                });
                const json = JSON.stringify(arr, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'qamar-' + tabId + '-' + _now() + '.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
                return { ok: true, count: arr.length };
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Clear all                                       */
    /* ══════════════════════════════════════════════ */
    function clearTab(tabId) {
        return Promise.resolve().then(function () {
            if (!_canEditTab(tabId)) throw new Error('غير مصرّح');
            const tab = TABS[tabId];
            if (!tab.path) throw new Error('لا يمكن مسح هذا التبويب بهذه الطريقة');

            // تأكيد
            const input = prompt('اكتب كلمة "حذف" للمتابعة:\n\n' + tab.label);
            if (input !== 'حذف') throw new Error('أُلغي');

            return window.QamarFB.remove(CONFIG.MEM_ROOT + '/' + tab.path).then(function () {
                _audit('clearTab_' + tabId, {});
                State.memory[tabId] = null;
                _toast('تم مسح الذاكرة', 'fa-trash');
                return _refreshAfterSave(tabId).then(function () { return { ok: true }; });
            });
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Search filter                                   */
    /* ══════════════════════════════════════════════ */
    function _matchesSearch(item, q) {
        if (!q) return true;
        const n = q.toLowerCase();
        const t1 = String(item.text || '').toLowerCase();
        if (t1.indexOf(n) !== -1) return true;
        const t2 = String(item.key || '').toLowerCase();
        if (t2.indexOf(n) !== -1) return true;
        const t3 = String(item.reply || '').toLowerCase();
        if (t3.indexOf(n) !== -1) return true;
        const t4 = String(item.q || '').toLowerCase();
        if (t4.indexOf(n) !== -1) return true;
        if (Array.isArray(item.answers)) {
            for (let i = 0; i < item.answers.length; i++) {
                if (String(item.answers[i]).toLowerCase().indexOf(n) !== -1) return true;
            }
        }
        return false;
    }

    /* ══════════════════════════════════════════════ */
    /* Dialog (simple)                                 */
    /* ══════════════════════════════════════════════ */
    function _openDlg(title, fields, onSave) {
        _closeDlg();

        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:16000;background:rgba(0,0,0,0.85);' +
            'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
            'display:flex;align-items:center;justify-content:center;padding:20px;' +
            'direction:rtl;font-family:inherit;';

        const box = document.createElement('div');
        box.style.cssText =
            'background:#0a0616;border:2px solid #a855f7;border-radius:16px;' +
            'padding:20px;width:100%;max-width:420px;max-height:88vh;overflow-y:auto;' +
            'display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,0.9);';

        const h = document.createElement('h3');
        h.style.cssText = 'color:#c084fc;font-size:15px;font-weight:900;margin:0;text-align:center;padding-bottom:10px;border-bottom:1px solid rgba(168,85,247,0.3);';
        h.textContent = title;
        box.appendChild(h);

        const inputs = {};
        fields.forEach(function (f) {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

            if (f.label) {
                const lbl = document.createElement('label');
                lbl.style.cssText = 'color:#c084fc;font-size:12px;font-weight:900;';
                lbl.textContent = f.label;
                wrap.appendChild(lbl);
            }

            let inp;
            if (f.multiline) {
                inp = document.createElement('textarea');
                inp.style.cssText = 'width:100%;min-height:90px;padding:10px;background:rgba(255,255,255,0.06);' +
                    'border:1px solid rgba(168,85,247,0.4);border-radius:10px;color:#fff;' +
                    'font-family:inherit;font-size:13px;outline:none;text-align:right;box-sizing:border-box;resize:vertical;';
            } else {
                inp = document.createElement('input');
                inp.type = f.type || 'text';
                inp.style.cssText = 'width:100%;padding:10px 12px;background:rgba(255,255,255,0.06);' +
                    'border:1px solid rgba(168,85,247,0.4);border-radius:10px;color:#fff;' +
                    'font-family:inherit;font-size:13px;outline:none;text-align:right;box-sizing:border-box;';
            }
            inp.placeholder = f.placeholder || '';
            inp.value = f.value || '';
            if (f.maxLength) inp.maxLength = f.maxLength;

            wrap.appendChild(inp);
            box.appendChild(wrap);
            inputs[f.id] = inp;
        });

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;margin-top:8px;';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'إلغاء';
        cancel.style.cssText = 'flex:1;padding:11px;background:rgba(255,255,255,0.08);color:#fff;' +
            'border:1px solid rgba(168,85,247,0.3);border-radius:10px;font-family:inherit;' +
            'font-weight:900;font-size:13px;cursor:pointer;';
        cancel.onclick = _closeDlg;

        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'حفظ';
        save.style.cssText = 'flex:1;padding:11px;background:linear-gradient(135deg,#a855f7,#7c3aed);' +
            'color:#fff;border:none;border-radius:10px;font-family:inherit;font-weight:900;' +
            'font-size:13px;cursor:pointer;';
        save.onclick = function () {
            const values = {};
            Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
            try {
                const r = onSave(values);
                if (r && typeof r.then === 'function') {
                    r.then(function () { _closeDlg(); }).catch(function (e) { _toast(e.message || 'فشل'); });
                } else {
                    _closeDlg();
                }
            } catch (e) { _toast(e.message || 'فشل'); }
        };

        actions.appendChild(cancel);
        actions.appendChild(save);
        box.appendChild(actions);

        overlay.appendChild(box);
        overlay.onclick = function (ev) { if (ev.target === overlay) _closeDlg(); };
        document.body.appendChild(overlay);

        State.dlgEl = overlay;
        State.dlgCleanup = function () {};
        setTimeout(function () {
            const first = Object.keys(inputs)[0];
            if (first && inputs[first].focus) inputs[first].focus();
        }, 100);
    }

    function _closeDlg() {
        if (State.dlgEl && State.dlgEl.parentNode) {
            State.dlgEl.parentNode.removeChild(State.dlgEl);
        }
        State.dlgEl = null;
        if (State.dlgCleanup) { try { State.dlgCleanup(); } catch (e) {} State.dlgCleanup = null; }
    }

    /* ══════════════════════════════════════════════ */
    /* UI — Overlay + Tabs                             */
    /* ══════════════════════════════════════════════ */
    function _ensureOverlay() {
        if (State.overlayEl && State.overlayEl.parentNode) return State.overlayEl;

        const ov = document.createElement('div');
        ov.id = 'bot-training-overlay';
        ov.style.cssText =
            'position:fixed;inset:0;z-index:15000;background:linear-gradient(180deg,#050508,#0a0a15);' +
            'display:none;flex-direction:column;direction:rtl;font-family:inherit;color:#f3f4f6;';

        // Header
        const header = document.createElement('div');
        header.style.cssText =
            'padding:14px 16px;background:linear-gradient(135deg,rgba(168,85,247,0.2),rgba(0,0,0,0.4));' +
            'border-bottom:1px solid rgba(168,85,247,0.3);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
        header.innerHTML =
            '<h3 style="color:#c084fc;margin:0;font-size:15px;font-weight:900;display:flex;align-items:center;gap:8px;">' +
                '<span>🤖</span><span>لوحة تدريب البوتات</span>' +
            '</h3>' +
            '<button id="bt-close" type="button" style="background:rgba(255,68,68,0.2);' +
                'border:1px solid rgba(255,68,68,0.5);color:#ff7777;width:32px;height:32px;' +
                'border-radius:50%;cursor:pointer;font-size:14px;font-weight:900;padding:0;">✕</button>';
        ov.appendChild(header);

        // Tabs
        const tabsBar = document.createElement('div');
        tabsBar.id = 'bt-tabs';
        tabsBar.style.cssText =
            'display:flex;overflow-x:auto;background:rgba(0,0,0,0.3);' +
            'border-bottom:1px solid rgba(168,85,247,0.2);flex-shrink:0;';
        ov.appendChild(tabsBar);

        // Toolbar
        const tools = document.createElement('div');
        tools.style.cssText =
            'display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(168,85,247,0.2);' +
            'background:rgba(0,0,0,0.2);flex-wrap:wrap;flex-shrink:0;';
        tools.innerHTML =
            '<input id="bt-search" type="text" placeholder="🔍 بحث..." autocomplete="off" ' +
                'style="flex:1;min-width:140px;padding:9px 12px;background:rgba(255,255,255,0.06);' +
                'border:1px solid rgba(168,85,247,0.4);border-radius:10px;color:#fff;' +
                'font-family:inherit;font-size:13px;outline:none;text-align:right;box-sizing:border-box;">' +
            '<button id="bt-add" type="button" style="padding:9px 14px;background:#84cc16;color:#fff;' +
                'border:none;border-radius:10px;font-family:inherit;font-weight:900;font-size:12px;cursor:pointer;">➕ إضافة</button>' +
            '<button id="bt-import" type="button" style="padding:9px 14px;background:#3b82f6;color:#fff;' +
                'border:none;border-radius:10px;font-family:inherit;font-weight:900;font-size:12px;cursor:pointer;">📥 استيراد</button>' +
            '<button id="bt-import-file" type="button" style="padding:9px 14px;background:#0ea5e9;color:#fff;' +
                'border:none;border-radius:10px;font-family:inherit;font-weight:900;font-size:12px;cursor:pointer;">📂 ملف</button>' +
            '<button id="bt-export" type="button" style="padding:9px 14px;background:#6366f1;color:#fff;' +
                'border:none;border-radius:10px;font-family:inherit;font-weight:900;font-size:12px;cursor:pointer;">📤 تصدير</button>' +
            '<button id="bt-clear" type="button" style="padding:9px 14px;background:rgba(255,68,68,0.85);color:#fff;' +
                'border:none;border-radius:10px;font-family:inherit;font-weight:900;font-size:12px;cursor:pointer;">🗑️ حذف الكل</button>';
        ov.appendChild(tools);

        // Body
        const body = document.createElement('div');
        body.id = 'bt-body';
        body.style.cssText =
            'flex:1;overflow-y:auto;padding:12px;';
        ov.appendChild(body);

        document.body.appendChild(ov);

        // Events
        document.getElementById('bt-close').onclick = close;
        document.getElementById('bt-add').onclick = _handleAdd;
        document.getElementById('bt-import').onclick = _handleImport;
        document.getElementById('bt-import-file').onclick = _handleImportFile;
        document.getElementById('bt-export').onclick = _handleExport;
        document.getElementById('bt-clear').onclick = _handleClear;

        let searchTimer = null;
        document.getElementById('bt-search').addEventListener('input', function () {
            clearTimeout(searchTimer);
            const self = this;
            searchTimer = setTimeout(function () {
                State.searchQuery[State.activeTab] = self.value.trim();
                _renderBody();
            }, CONFIG.SEARCH_DEBOUNCE_MS);
        });

        State.overlayEl = ov;
        return ov;
    }

    function _renderTabs() {
        const tabsBar = document.getElementById('bt-tabs');
        if (!tabsBar) return;
        tabsBar.innerHTML = '';

        Object.keys(TABS).forEach(function (tabId) {
            if (!_canSeeTab(tabId)) return;
            const tab = TABS[tabId];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.tab = tabId;
            const active = (State.activeTab === tabId);
            btn.style.cssText =
                'padding:10px 14px;background:' + (active ? 'rgba(168,85,247,0.25)' : 'transparent') + ';' +
                'border:none;border-bottom:3px solid ' + (active ? '#c084fc' : 'transparent') + ';' +
                'color:' + (active ? '#c084fc' : '#999') + ';font-family:inherit;font-size:12px;' +
                'font-weight:900;cursor:pointer;white-space:nowrap;flex-shrink:0;';
            btn.textContent = tab.label;
            btn.onclick = function () {
                if (State.activeTab === tabId) return;
                State.activeTab = tabId;
                _renderTabs();
                _renderBody();
                const si = document.getElementById('bt-search');
                if (si) si.value = State.searchQuery[tabId] || '';
            };
            tabsBar.appendChild(btn);
        });
    }

    /* ══════════════════════════════════════════════ */
    /* UI — Render body                                */
    /* ══════════════════════════════════════════════ */
    function _renderBody() {
        const body = document.getElementById('bt-body');
        if (!body) return;
        body.innerHTML = '';

        const tabId = State.activeTab;
        const tab = TABS[tabId];
        if (!tab) return;

        if (!_canSeeTab(tabId)) {
            body.innerHTML = '<div style="text-align:center;color:#888;padding:40px;">لا صلاحية</div>';
            return;
        }

        const search = State.searchQuery[tabId] || '';
        const items = _buildItems(tabId);
        const filtered = items.filter(function (it) { return _matchesSearch(it, search); });

        // Counter
        const counter = document.createElement('div');
        counter.style.cssText =
            'text-align:center;color:#c084fc;font-size:11px;font-weight:900;' +
            'padding:6px 0 10px;';
        counter.textContent = '📊 ' + filtered.length + (search ? ' / ' + items.length : '');
        body.appendChild(counter);

        // Health warnings
        _renderHealthWarnings(body, tabId, items);

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align:center;color:#666;padding:30px 20px;font-size:13px;';
            empty.textContent = search ? 'لا نتائج' : 'الذاكرة فارغة — البوت سيعتمد على القائمة الافتراضية';
            body.appendChild(empty);
            return;
        }

        filtered.forEach(function (item) {
            body.appendChild(_buildItemCard(tabId, item));
        });
    }

    function _buildItems(tabId) {
        const tab = TABS[tabId];
        if (!tab || !tab.path) {
            // pending
            const p = State.memory.pending || {};
            return Object.keys(p).map(function (k) {
                const v = p[k] || {};
                return { key: k, question: v.question || '', fromName: v.fromName || '—', time: v.time || 0 };
            }).sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
        }

        const data = State.memory[tabId];
        if (!data) return [];
        const arr = _toArray(data);

        if (tab.type === 'kv') {
            return arr.map(function (it) {
                if (typeof it === 'string') return { key: '', reply: it };
                return { key: it._key || '', reply: (typeof it.text === 'string' ? it.text : (it.text || '')) };
            }).filter(function (x) { return x.key || x.reply; });
        }

        if (tab.type === 'quiz') {
            return arr.map(function (it) {
                return { key: it._key || '', q: it.q || '', answers: it.answers || [] };
            });
        }

        if (tab.type === 'textlist') {
            return arr.map(function (it) {
                if (typeof it === 'string') return { key: '', text: it };
                return { key: it._key || '', text: it.text || '' };
            });
        }

        // wordlist
        return arr.map(function (it) {
            if (typeof it === 'string') return { key: '', text: it };
            return { key: it._key || '', text: it.text || '' };
        }).filter(function (x) { return x.text || x.key; });
    }

    function _renderHealthWarnings(body, tabId, items) {
        const warnings = [];
        if (!items.length) return;

        if (TABS[tabId].type === 'wordlist') {
            const tooShort = items.filter(function (it) {
                const t = String(it.text || '');
                return t.length > 0 && t.length < 3;
            }).length;
            if (tooShort > 0) warnings.push('⚠️ ' + tooShort + ' كلمة قصيرة جداً (احتمال إيجابيات كاذبة)');
            if (items.length > 500) warnings.push('📈 القائمة كبيرة (' + items.length + ') — قد تُبطئ الفحص');
        }

        if (TABS[tabId].type === 'kv') {
            const empty = items.filter(function (x) { return !x.reply; }).length;
            if (empty > 0) warnings.push('⚠️ ' + empty + ' عنصر بدون رد');
        }

        warnings.forEach(function (w) {
            const el = document.createElement('div');
            el.style.cssText =
                'background:rgba(255,152,0,0.1);border:1px solid rgba(255,152,0,0.4);' +
                'color:#fbbf24;font-size:11px;font-weight:700;padding:8px 12px;' +
                'border-radius:8px;margin-bottom:6px;text-align:center;';
            el.textContent = w;
            body.appendChild(el);
        });
    }

    function _buildItemCard(tabId, item) {
        const tab = TABS[tabId];
        const card = document.createElement('div');
        card.style.cssText =
            'background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.2);' +
            'border-radius:12px;padding:10px 12px;margin-bottom:8px;display:flex;' +
            'align-items:center;gap:10px;';

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;word-break:break-word;';

        if (tab.type === 'wordlist') {
            info.innerHTML =
                '<div style="color:#fff;font-weight:900;font-size:13px;">' + _escapeHtml(item.text || '—') + '</div>' +
                (item.key ? '<div style="color:#666;font-size:9px;margin-top:2px;">' + _escapeHtml(item.key) + '</div>' : '');
        } else if (tab.type === 'kv') {
            info.innerHTML =
                '<div style="color:#c084fc;font-weight:900;font-size:12px;">🔑 ' + _escapeHtml(item.key || '—') + '</div>' +
                '<div style="color:#fff;font-size:12px;margin-top:4px;">💬 ' + _escapeHtml(item.reply || '—') + '</div>';
        } else if (tab.type === 'quiz') {
            info.innerHTML =
                '<div style="color:#ffd700;font-weight:900;font-size:12px;">❓ ' + _escapeHtml(item.q || '—') + '</div>' +
                '<div style="color:#ccc;font-size:11px;margin-top:4px;">✅ ' + _escapeHtml((item.answers || []).join(' / ')) + '</div>';
        } else if (tab.type === 'textlist') {
            info.innerHTML = '<div style="color:#fff;font-size:12px;">' + _escapeHtml(item.text || '—') + '</div>';
        } else if (tab.type === 'pending') {
            const ago = item.time ? Math.round((_now() - item.time) / 60000) : 0;
            info.innerHTML =
                '<div style="color:#fff;font-weight:900;font-size:12px;">❓ ' + _escapeHtml(item.question || '—') + '</div>' +
                '<div style="color:#888;font-size:10px;margin-top:3px;">من: ' + _escapeHtml(item.fromName || '—') + ' · قبل ' + ago + 'د</div>';
        }

        card.appendChild(info);

        // Actions
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

        if (tab.type === 'pending') {
            const teachBtn = _mkBtn('✅', '#84cc16', function () {
                _openDlg('تعليم حكواتي', [
                    { id: 'k', label: 'الكلمة المفتاحية', value: item.question || '', maxLength: 60 },
                    { id: 'r', label: 'الرد', multiline: true, placeholder: 'اكتب الرد...' }
                ], function (v) {
                    return teachPending(item.key, v.k, v.r);
                });
            });
            actions.appendChild(teachBtn);

            const delBtn = _mkBtn('🗑️', '#ef4444', function () {
                if (!_confirm('حذف السؤال؟')) return;
                deletePending(item.key).then(function () { _renderBody(); }).catch(function (e) { _toast(e.message); });
            });
            actions.appendChild(delBtn);
        } else if (tab.type === 'wordlist') {
            const editBtn = _mkBtn('✏️', '#3b82f6', function () {
                _openDlg('تعديل', [
                    { id: 'w', label: 'الكلمة', value: item.text || '', maxLength: 60 }
                ], function (v) { return editWord(tabId, item.key, v.w); }).then_ = true;
                _openDlg('تعديل الكلمة', [
                    { id: 'w', label: 'الكلمة', value: item.text || '', maxLength: 60 }
                ], function (v) {
                    return editWord(tabId, item.key, v.w).then(function () {
                        item.text = v.w;
                        _renderBody();
                    });
                });
            });
            actions.appendChild(editBtn);

            const delBtn = _mkBtn('🗑️', '#ef4444', function () {
                if (!_confirm('حذف الكلمة؟')) return;
                deleteWord(tabId, item.key).then(function () { _renderBody(); }).catch(function (e) { _toast(e.message); });
            });
            actions.appendChild(delBtn);
        } else if (tab.type === 'kv') {
            const editBtn = _mkBtn('✏️', '#3b82f6', function () {
                _openDlg('تعديل الرد', [
                    { id: 'r', label: 'الرد', multiline: true, value: item.reply || '' }
                ], function (v) {
                    return editPair(tabId, item.key, v.r).then(function () {
                        item.reply = v.r;
                        _renderBody();
                    });
                });
            });
            actions.appendChild(editBtn);

            const delBtn = _mkBtn('🗑️', '#ef4444', function () {
                if (!_confirm('حذف الرد؟')) return;
                deletePair(tabId, item.key).then(function () { _renderBody(); }).catch(function (e) { _toast(e.message); });
            });
            actions.appendChild(delBtn);
        } else if (tab.type === 'quiz') {
            const delBtn = _mkBtn('🗑️', '#ef4444', function () {
                if (!_confirm('حذف السؤال؟')) return;
                deleteQuiz(item.key).then(function () { _renderBody(); }).catch(function (e) { _toast(e.message); });
            });
            actions.appendChild(delBtn);
        } else if (tab.type === 'textlist') {
            const delBtn = _mkBtn('🗑️', '#ef4444', function () {
                if (!_confirm('حذف العنصر؟')) return;
                deleteTextItem(tabId, item.key).then(function () { _renderBody(); }).catch(function (e) { _toast(e.message); });
            });
            actions.appendChild(delBtn);
        }

        card.appendChild(actions);
        return card;
    }

    function _mkBtn(icon, bg, handler) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = icon;
        b.style.cssText =
            'width:32px;height:32px;border-radius:50%;background:' + bg + ';color:#fff;' +
            'border:none;cursor:pointer;font-size:13px;padding:0;flex-shrink:0;';
        b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); handler(); };
        return b;
    }

    /* ══════════════════════════════════════════════ */
    /* UI — Toolbar handlers                           */
    /* ══════════════════════════════════════════════ */
    function _handleAdd() {
        const tabId = State.activeTab;
        const tab = TABS[tabId];

        if (tab.type === 'wordlist') {
            _openDlg('إضافة كلمة', [
                { id: 'w', label: 'الكلمة', maxLength: 60 }
            ], function (v) {
                return addWord(tabId, v.w).then(function () { _renderBody(); });
            });
        } else if (tab.type === 'kv') {
            _openDlg('إضافة رد', [
                { id: 'k', label: 'الكلمة المفتاحية', maxLength: 60 },
                { id: 'r', label: 'الرد', multiline: true }
            ], function (v) {
                return addPair(tabId, v.k, v.r).then(function () { _renderBody(); });
            });
        } else if (tab.type === 'quiz') {
            _openDlg('إضافة سؤال', [
                { id: 'q', label: 'السؤال', multiline: true },
                { id: 'a', label: 'الأجوبة (افصل بفاصلة)', placeholder: 'مثال: دمشق, الشام' }
            ], function (v) {
                const answers = String(v.a || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
                return addQuiz(v.q, answers).then(function () { _renderBody(); });
            });
        } else if (tab.type === 'textlist') {
            _openDlg('إضافة نص', [
                { id: 't', label: 'النص', multiline: true }
            ], function (v) {
                return addTextItem(tabId, v.t).then(function () { _renderBody(); });
            });
        } else {
            _toast('لا يمكن الإضافة هنا', 'fa-info-circle');
        }
    }

    function _handleImport() {
        const tabId = State.activeTab;
        if (TABS[tabId].type !== 'wordlist') {
            _toast('الاستيراد للقوائم فقط', 'fa-info-circle');
            return;
        }
        if (!_confirm('استيراد قائمة عربية جاهزة (500+ كلمة)؟')) return;
        _toast('⏳ جاري الاستيراد...', 'fa-spinner');
        importArabicList(tabId).then(function (r) {
            _renderBody();
        }).catch(function (e) { _toast('فشل: ' + e.message, 'fa-times'); });
    }

    function _handleImportFile() {
        const tabId = State.activeTab;
        if (TABS[tabId].type !== 'wordlist') {
            _toast('استيراد الملفات للقوائم فقط', 'fa-info-circle');
            return;
        }
        importFromFile(tabId).then(function (r) {
            if (r && r.ok) _renderBody();
        }).catch(function (e) { _toast('فشل: ' + e.message, 'fa-times'); });
    }

    function _handleExport() {
        exportTab(State.activeTab).then(function (r) {
            _toast('تم تصدير ' + r.count + ' عنصر', 'fa-check');
        }).catch(function (e) { _toast(e.message, 'fa-times'); });
    }

    function _handleClear() {
        clearTab(State.activeTab).then(function () {
            _renderBody();
        }).catch(function (e) {
            if (e.message !== 'أُلغي') _toast(e.message, 'fa-times');
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Open / Close                                    */
    /* ══════════════════════════════════════════════ */
    function open() {
        return Promise.resolve().then(function () {
            if (!_canTrainBots()) throw new Error('غير مصرّح — الملك أو 90+ بصلاحية canTrainBots');

            // اختيار أول تبويب مسموح
            const tabsAllowed = Object.keys(TABS).filter(_canSeeTab);
            if (!tabsAllowed.length) throw new Error('لا تبويبات مسموحة');
            if (tabsAllowed.indexOf(State.activeTab) === -1) {
                State.activeTab = tabsAllowed[0];
            }

            const ov = _ensureOverlay();
            ov.style.display = 'flex';
            State.open = true;

            // تحميل
            _loadMemory().then(function () {
                _renderTabs();
                _renderBody();
            }).catch(function (e) {
                Logger.warn('load failed:', e.message);
                _renderTabs();
                _renderBody();
            });

            _emit('bot-training:opened', {});
            Logger.info('📖 Bot training opened');
            return { ok: true };
        });
    }

    function close() {
        const ov = State.overlayEl;
        if (ov) ov.style.display = 'none';
        State.open = false;
        _closeDlg();
        _emit('bot-training:closed', {});
        return { ok: true };
    }

    function isOpen() { return State.open; }

    /* ══════════════════════════════════════════════ */
    /* Events                                          */
    /* ══════════════════════════════════════════════ */
    function onTrainingEvent(cb) {
        if (typeof cb !== 'function') return function () {};
        State.listeners.push(cb);
        return function off() {
            State.listeners = State.listeners.filter(function (h) { return h !== cb; });
        };
    }

    function _emit(name, payload) {
        if (window.EventBus) {
            try { window.EventBus.emit(name, payload); } catch (e) {}
        }
        State.listeners.slice().forEach(function (cb) {
            try { cb({ type: name, data: payload }); } catch (e) {}
        });
    }

    /* ══════════════════════════════════════════════ */
    /* Status / Debug                                  */
    /* ══════════════════════════════════════════════ */
    function getStatus() {
        const allowed = Object.keys(TABS).filter(_canSeeTab);
        return {
            open: State.open,
            activeTab: State.activeTab,
            canTrain: _canTrainBots(),
            isKing100: _isKing100(),
            myLevel: _myLevel(),
            tabsAllowed: allowed,
            cachedMemories: Object.keys(State.memory).filter(function (k) { return !!State.memory[k]; }),
            isImporting: State._importing
        };
    }

    /* ══════════════════════════════════════════════ */
    /* Exports                                         */
    /* ══════════════════════════════════════════════ */
    window.QamarBotTraining = {
        CONFIG: CONFIG,
        TABS: TABS,

        open: open,
        close: close,
        isOpen: isOpen,

        // CRUD
        addWord: addWord,
        editWord: editWord,
        deleteWord: deleteWord,
        addPair: addPair,
        editPair: editPair,
        deletePair: deletePair,
        addQuiz: addQuiz,
        deleteQuiz: deleteQuiz,
        addTextItem: addTextItem,
        deleteTextItem: deleteTextItem,
        teachPending: teachPending,
        deletePending: deletePending,
        clearPending: clearPending,

        // Import / Export
        importArabicList: importArabicList,
        importFromFile: importFromFile,
        exportTab: exportTab,
        clearTab: clearTab,

        // Events
        onTrainingEvent: onTrainingEvent,

        // Debug
        getStatus: getStatus
    };

    Logger.info('📦 [bot-training.js] loaded');
})();
