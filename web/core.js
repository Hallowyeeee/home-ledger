// 手機與電腦共用的資料層：本機資料庫（IndexedDB）＋ 跟雲端試算表同步。
// 畫面只讀本機資料，所以永遠不用等網路；寫入先進「待送清單」，背景送到雲端。

const PEOPLE = ['濠亭', '子淳'];
const TYPE_LABEL = { expense: '支出', income: '收入' };
// 第一次同步之前先用這份（跟 backend/Code.gs 的預設一致）
const DEFAULT_CATEGORIES = [
  ['餐飲', 'expense', 20], ['日用品', 'expense', 10], ['交通', 'expense', 5],
  ['居家帳單', 'expense', 25], ['購物娛樂', 'expense', 10], ['其他', 'expense', 5],
  ['薪水', 'income', ''], ['獎金', 'income', ''], ['其他收入', 'income', ''],
].map(([name, type, pct], i) => ({ name, type, sort: i + 1, pct }));

// ---------- 小工具 ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('zh-TW');
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const ym = d => String(d).slice(0, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
function shiftMonth(m, k) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function toast(msg, ms = 1800) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- 設定碼 ----------
// 設定碼 = 把 { api, key } 編成一串文字。手機可用「網址#setup=設定碼」一次帶入。
const Config = {
  get() { try { return JSON.parse(localStorage.getItem('ledger.cfg')); } catch { return null; } },
  set(cfg) { localStorage.setItem('ledger.cfg', JSON.stringify(cfg)); },
  encode(cfg) { return btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))).replace(/=+$/, ''); },
  decode(code) {
    try {
      const cfg = JSON.parse(decodeURIComponent(escape(atob(String(code).trim()))));
      return cfg.api && cfg.key ? cfg : null;
    } catch { return null; }
  },
  fromHash() {
    const code = new URLSearchParams(location.hash.slice(1)).get('setup');
    const cfg = code && Config.decode(code);
    if (cfg) { Config.set(cfg); history.replaceState(null, '', location.pathname + location.search); }
    return cfg;
  },
};

// ---------- 本機資料庫 ----------
const IDB = {
  db: null,
  open() {
    return new Promise((ok, fail) => {
      const req = indexedDB.open('home-ledger', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { IDB.db = req.result; ok(); };
      req.onerror = () => fail(req.error);
    });
  },
  get(k) {
    return new Promise((ok, fail) => {
      const r = IDB.db.transaction('kv').objectStore('kv').get(k);
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
  },
  set(k, v) {
    return new Promise((ok, fail) => {
      const tx = IDB.db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
    });
  },
};

// ---------- 帳本 ----------
const Ledger = {
  records: new Map(),   // id -> 紀錄（含已刪除，deleted=1）
  categories: [],       // { name, type, sort, pct }
  rules: [],            // { keyword, category }
  since: 0,             // 上次同步的雲端時間
  sheetUrl: '',
  outbox: [],           // 還沒送到雲端的紀錄
  ruleOutbox: [],       // 還沒送到雲端的「自己學」規則
  onChange: () => {},
  onStatus: () => {},

  async init() {
    await IDB.open();
    const s = (await IDB.get('state')) || {};
    (s.records || []).forEach(r => this.records.set(r.id, r));
    this.categories = s.categories?.length ? s.categories : DEFAULT_CATEGORIES;
    this.rules = s.rules || [];
    this.since = s.since || 0;
    this.sheetUrl = s.sheetUrl || '';
    this.outbox = (await IDB.get('outbox')) || [];
    this.ruleOutbox = (await IDB.get('ruleOutbox')) || [];
  },
  persist() {
    return Promise.all([
      IDB.set('state', { records: [...this.records.values()], categories: this.categories, rules: this.rules, since: this.since, sheetUrl: this.sheetUrl }),
      IDB.set('outbox', this.outbox),
      IDB.set('ruleOutbox', this.ruleOutbox),
    ]);
  },

  async api(body) {
    const cfg = Config.get();
    if (!cfg) throw new Error('還沒設定');
    const res = await fetch(cfg.api, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key: cfg.key }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '雲端回應失敗');
    return j;
  },

  // ---- 讀 ----
  list(filter = () => true) {
    return [...this.records.values()].filter(r => !r.deleted && filter(r));
  },
  cats(type) {
    return this.categories.filter(c => c.type === type).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  },
  classify(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return '';
    // 關鍵字越長越優先（「Uber Eats」要贏過「Uber」）
    const hit = [...this.rules].filter(r => r.keyword && t.includes(String(r.keyword).toLowerCase()))
      .sort((a, b) => String(b.keyword).length - String(a.keyword).length)[0];
    return hit ? hit.category : '';
  },

  // ---- 寫：先改本機、更新畫面，再背景送雲端 ----
  save(list) {
    list = [].concat(list);
    for (const r of list) {
      r.id = r.id || uid();
      r.updatedAt = Date.now();
      this.records.set(r.id, r);
      this.outbox = this.outbox.filter(o => o.id !== r.id).concat(r);
    }
    this.persist();
    this.onChange();
    this.flush();
  },
  remove(id) {
    const r = this.records.get(id);
    if (r) this.save({ ...r, deleted: 1 });
  },
  learn(note, category) {
    const keyword = String(note || '').trim();
    if (keyword.length < 2 || keyword.length > 20 || !category) return;
    if (this.classify(keyword) === category) return;
    const i = this.rules.findIndex(r => r.keyword === keyword);
    if (i >= 0) this.rules[i].category = category; else this.rules.push({ keyword, category });
    this.ruleOutbox.push({ keyword, category });
    this.persist();
    this.flush();
  },
  async saveCategories(categories) {
    this.categories = categories;
    await this.persist(); this.onChange();
    await this.api({ action: 'saveCategories', categories });
  },
  async saveRules(rules) {
    this.rules = rules; this.ruleOutbox = [];
    await this.persist(); this.onChange();
    await this.api({ action: 'saveRules', rules });
  },

  // ---- 同步 ----
  _flushing: null,
  flush() { return this._flushing ||= this._flush().finally(() => { this._flushing = null; }); },
  async _flush() {
    while (this.outbox.length) {
      const batch = this.outbox.slice(0, 200);
      try { await this.api({ action: 'upsert', records: batch }); }
      catch (e) { this.onStatus('offline', e); return; }
      const sent = new Set(batch.map(r => r.id + ':' + r.updatedAt));
      this.outbox = this.outbox.filter(r => !sent.has(r.id + ':' + r.updatedAt));
      await this.persist();
    }
    while (this.ruleOutbox.length) {
      try { await this.api({ action: 'learnRule', ...this.ruleOutbox[0] }); }
      catch (e) { this.onStatus('offline', e); return; }
      this.ruleOutbox.shift();
      await this.persist();
    }
    this.onStatus('synced');
  },
  async sync() {
    this.onStatus('syncing');
    await this.flush();
    if (this.outbox.length) return; // 還送不出去，先別拉，避免覆蓋本機的新改動
    let j;
    try { j = await this.api({ action: 'sync', since: this.since }); }
    catch (e) { this.onStatus('offline', e); throw e; }
    const pending = new Set(this.outbox.map(r => r.id));
    for (const r of j.records) if (!pending.has(r.id)) this.records.set(r.id, r);
    this.categories = j.categories.map(c => ({ ...c, sort: Number(c.sort) || 0, pct: c.pct === '' ? '' : Number(c.pct) }));
    if (!this.ruleOutbox.length) this.rules = j.rules;
    this.since = j.serverTime;
    this.sheetUrl = j.sheetUrl || this.sheetUrl;
    await this.persist();
    this.onStatus('synced');
    this.onChange();
    return j.records.length;
  },
};

// 網路恢復時自動補送
window.addEventListener('online', () => Ledger.flush());

// ---------- 第一次設定畫面（手機、電腦共用）----------
function renderSetup(el) {
  el.innerHTML = `<div class="setup"><div class="card">
    <h2 style="margin-top:0">第一次使用</h2>
    <p class="muted">已經有設定碼：貼上就好。第一次安裝：填 Apps Script 網址和通關密語。只要做一次，這台裝置會記住。</p>
    <label class="muted">設定碼</label>
    <textarea id="setupCode" placeholder="貼上設定碼"></textarea>
    <p class="muted" style="text-align:center;margin:10px 0">— 或 —</p>
    <label class="muted">Apps Script 網址</label>
    <input id="setupApi" style="width:100%" placeholder="https://script.google.com/macros/s/…/exec">
    <label class="muted" style="display:block;margin-top:8px">通關密語</label>
    <input id="setupKey" style="width:100%" placeholder="跟 Code.gs 裡的 KEY 一樣">
    <p><button class="btn" id="setupGo">開始使用</button></p>
  </div></div>`;
  el.classList.remove('hidden');
  $('#setupGo').onclick = async () => {
    const api = $('#setupApi').value.trim(), key = $('#setupKey').value.trim();
    const cfg = Config.decode($('#setupCode').value) || (api && key ? { api, key } : null);
    if (!cfg) return toast('設定碼不對，或網址和密語沒填完整');
    Config.set(cfg);
    try { await Ledger.api({ action: 'sync', since: Date.now() }); }
    catch (e) { localStorage.removeItem('ledger.cfg'); return toast('連不上：' + e.message, 3500); }
    location.reload();
  };
}

// 手機用的設定連結：點一次就設定好
const PHONE_URL = 'https://hallowyeeee.github.io/home-ledger/';
const phoneSetupLink = () => `${PHONE_URL}#setup=${Config.encode(Config.get())}`;
