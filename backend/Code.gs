/**
 * 家庭記帳 後端（Google Apps Script）
 *
 * 試算表是唯一正本。手機與電腦都透過這支程式讀寫：
 *   - sync：回傳某個時間點之後有變動的紀錄（增量同步），外加分類與規則
 *   - upsert：新增或修改紀錄（刪除＝把 deleted 設成 1）
 *   - saveCategories / saveRules：整份覆蓋分類、自動分類規則（電腦上編輯用）
 *   - learnRule：新增或修改一條自動分類規則（手機「自己學」用）
 *   - saveFixed：整份覆蓋固定支出清單（電腦上編輯用；每月自動記帳由電腦程式負責）
 *
 * 安裝方式見 README.md。
 */

// 改成你們自己的通關密語（英數字，越長越好）
const KEY = 'change-me-to-a-secret';

const SHEETS = {
  Records: ['id', 'type', 'date', 'amount', 'category', 'note', 'who', 'source', 'invoiceNo', 'updatedAt', 'deleted'],
  Categories: ['name', 'type', 'sort', 'pct'],
  Rules: ['keyword', 'category'],
  Fixed: ['id', 'name', 'amount', 'category', 'day', 'who', 'start'],
};

const DEFAULT_CATEGORIES = [
  ['餐飲', 'expense', 1, 20], ['日用品', 'expense', 2, 10], ['帳單/交通', 'expense', 3, 30],
  ['小孩用品', 'expense', 4, ''], ['購物娛樂', 'expense', 5, 10], ['其他', 'expense', 6, 5],
  ['薪水', 'income', 1, ''], ['獎金', 'income', 2, ''], ['其他收入', 'income', 3, ''],
];

const DEFAULT_RULES = [
  ['全聯', '日用品'], ['家樂福', '日用品'], ['大潤發', '日用品'], ['好市多', '日用品'], ['Costco', '日用品'],
  ['美廉社', '日用品'], ['屈臣氏', '日用品'], ['康是美', '日用品'], ['寶雅', '日用品'], ['IKEA', '購物娛樂'],
  ['7-11', '餐飲'], ['統一超商', '餐飲'], ['全家', '餐飲'], ['萊爾富', '餐飲'], ['OK超商', '餐飲'],
  ['麥當勞', '餐飲'], ['肯德基', '餐飲'], ['摩斯', '餐飲'], ['星巴克', '餐飲'], ['路易莎', '餐飲'],
  ['Uber Eats', '餐飲'], ['foodpanda', '餐飲'], ['早餐', '餐飲'], ['午餐', '餐飲'], ['晚餐', '餐飲'], ['飲料', '餐飲'],
  ['中油', '帳單/交通'], ['台塑石油', '帳單/交通'], ['加油', '帳單/交通'], ['停車', '帳單/交通'], ['高鐵', '帳單/交通'], ['台鐵', '帳單/交通'],
  ['捷運', '帳單/交通'], ['悠遊卡', '帳單/交通'], ['Uber', '帳單/交通'], ['台灣大車隊', '帳單/交通'], ['計程車', '帳單/交通'],
  ['台電', '帳單/交通'], ['電費', '帳單/交通'], ['水費', '帳單/交通'], ['自來水', '帳單/交通'], ['瓦斯', '帳單/交通'],
  ['房租', '帳單/交通'], ['管理費', '帳單/交通'], ['中華電信', '帳單/交通'], ['台灣大哥大', '帳單/交通'], ['遠傳', '帳單/交通'],
  ['蝦皮', '購物娛樂'], ['momo', '購物娛樂'], ['PChome', '購物娛樂'], ['Netflix', '購物娛樂'], ['Spotify', '購物娛樂'],
  ['威秀', '購物娛樂'], ['秀泰', '購物娛樂'], ['UNIQLO', '購物娛樂'], ['誠品', '購物娛樂'],
  ['尿布', '小孩用品'], ['奶粉', '小孩用品'], ['嬰兒', '小孩用品'], ['寶寶', '小孩用品'], ['童裝', '小孩用品'],
  ['玩具', '小孩用品'], ['麗嬰房', '小孩用品'], ['營養師輕食', '小孩用品'], ['安親', '小孩用品'], ['補習', '小孩用品'],
  ['康達盛通', '日用品'], ['大創', '日用品'], ['清潔袋', '日用品'], ['清潔劑', '日用品'], ['衛生紙', '日用品'],
  ['汽油', '帳單/交通'], ['加油站', '帳單/交通'], ['停車費', '帳單/交通'], ['Digital Storage', '帳單/交通'], ['iCloud', '帳單/交通'],
  ['餐飲', '餐飲'], ['便當', '餐飲'], ['飯糰', '餐飲'], ['土司', '餐飲'], ['米漿', '餐飲'], ['豆漿', '餐飲'], ['奶茶', '餐飲'], ['麥茶', '餐飲'], ['啤酒', '餐飲'],
  ['名品城', '購物娛樂'], ['皮件', '購物娛樂'], ['羽球', '購物娛樂'], ['泳衣', '購物娛樂'],
  ['診所', '其他'], ['醫院', '其他'], ['藥局', '其他'], ['保險', '其他'],
];

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
    if (name === 'Categories') appendRows_(sh, DEFAULT_CATEGORIES);
    if (name === 'Rules') appendRows_(sh, DEFAULT_RULES);
    if (name === 'Records') sh.getRange('C:C').setNumberFormat('@'); // 日期存文字，避免時區換算
    if (name === 'Fixed') sh.getRange('G:G').setNumberFormat('@');
  }
  return sh;
}

function appendRows_(sh, rows) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function readAll_(name) {
  const sh = sheet_(name);
  if (sh.getLastRow() < 2) return [];
  const head = SHEETS[name];
  return sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues()
    .filter(r => r[0] !== '')
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function replaceAll_(name, rows) {
  const sh = sheet_(name);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS[name].length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function normRecord_(r) {
  const d = r.date instanceof Date ? Utilities.formatDate(r.date, 'Asia/Taipei', 'yyyy-MM-dd') : String(r.date);
  return { ...r, date: d, amount: Number(r.amount) || 0, updatedAt: Number(r.updatedAt) || 0, deleted: Number(r.deleted) ? 1 : 0 };
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) { return out_(handle_(e.parameter || {})); }

// 前端用 text/plain 送 JSON，避免瀏覽器的跨網域預檢請求
function doPost(e) { return out_(handle_(JSON.parse((e.postData && e.postData.contents) || '{}'))); }

function handle_(p) {
  if (p.key !== KEY) return { ok: false, error: '通關密語錯誤' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    switch (p.action) {
      case 'sync': return sync_(Number(p.since) || 0);
      case 'upsert': return { ok: true, saved: upsert_(p.records || []), serverTime: Date.now() };
      case 'saveCategories':
        replaceAll_('Categories', (p.categories || []).map(c => [c.name, c.type, Number(c.sort) || 0, c.pct === '' || c.pct == null ? '' : Number(c.pct)]));
        return { ok: true };
      case 'learnRule': return { ok: true, saved: learnRule_(String(p.keyword || '').trim(), String(p.category || '')) };
      case 'saveFixed':
        replaceAll_('Fixed', (p.fixed || []).map(f => [f.id, f.name, Number(f.amount) || 0, f.category, Number(f.day) || 1, f.who, String(f.start)]));
        return { ok: true };
      case 'saveRules':
        replaceAll_('Rules', (p.rules || []).map(r => [r.keyword, r.category]));
        return { ok: true };
      default: return { ok: false, error: '不認得的動作：' + p.action };
    }
  } finally {
    lock.releaseLock();
  }
}

function sync_(since) {
  const serverTime = Date.now();
  const records = readAll_('Records').map(normRecord_).filter(r => r.id && r.updatedAt > since);
  const fixed = readAll_('Fixed').map(f => ({ ...f, amount: Number(f.amount) || 0, day: Number(f.day) || 1,
    start: f.start instanceof Date ? Utilities.formatDate(f.start, 'Asia/Taipei', 'yyyy-MM') : String(f.start).slice(0, 7) }));
  return { ok: true, serverTime, records, categories: readAll_('Categories'), rules: readAll_('Rules'), fixed,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
}

// 「自己學」：同一個關鍵字已存在就改分類，沒有就新增一條
function learnRule_(keyword, category) {
  if (!keyword || !category) return false;
  const sh = sheet_('Rules');
  const rules = readAll_('Rules');
  const i = rules.findIndex(r => String(r.keyword) === keyword);
  if (i >= 0) sh.getRange(i + 2, 2).setValue(category);
  else sh.appendRow([keyword, category]);
  return true;
}

// 依 id 新增或覆蓋。updatedAt 一律用伺服器時間，所有裝置的「之後有變動」才會一致。
function upsert_(list) {
  if (!list.length) return 0;
  const sh = sheet_('Records');
  const head = SHEETS.Records;
  const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : [];
  const rowOf = new Map(ids.map((id, i) => [id, i + 2]));
  const now = Date.now();
  const fresh = [];
  const byId = new Map(list.map(r => [String(r.id), r])); // 同一批重複的 id 以最後一筆為準
  byId.forEach(r => {
    const row = head.map(h => {
      if (h === 'updatedAt') return now;
      if (h === 'deleted') return r.deleted ? 1 : 0;
      if (h === 'amount') return Number(r.amount) || 0;
      return r[h] == null ? '' : String(r[h]);
    });
    const at = rowOf.get(String(r.id));
    if (at) sh.getRange(at, 1, 1, head.length).setValues([row]);
    else fresh.push(row);
  });
  if (fresh.length) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 3, fresh.length, 1).setNumberFormat('@');
    sh.getRange(start, 1, fresh.length, head.length).setValues(fresh);
  }
  return byId.size;
}

// 安裝時在 Apps Script 編輯器手動執行一次：建立分頁、授權
function setup() {
  Object.keys(SHEETS).forEach(sheet_);
}
