# 家庭記帳

濠亭和子淳共用的家庭記帳。

- **手機**：網頁加到主畫面，3 秒記一筆（支出／收入、自動分類、沒網路也能記）
- **電腦**：Windows 程式 `HomeLedger.exe`，看報表、改明細、匯入手機條碼發票、設預算
- **資料**：存在你自己的 Google 試算表（正本）。電腦和手機都會在本機留一份，所以打開不用等

```
手機網頁 ──▶ Google 試算表（正本） ◀──▶ 電腦 .exe（本機一份，報表在這裡算）
```

---

## 第一次設定（約 10 分鐘，只做一次）

### 1. 建立試算表
1. 打開 https://sheets.new ，左上角取名 `家庭記帳`

### 2. 貼上雲端程式
1. 試算表選單：**擴充功能 → Apps Script**
2. 刪掉裡面原本的內容，貼上 [backend/Code.gs](backend/Code.gs) 的全部內容
3. 把第 14 行的 `change-me-to-a-secret` 改成你們自己的**通關密語**（英數字，越長越好，例如 `ht-zc-2026-ledger-xyz`）
4. 按 💾 儲存
5. 上方函式選單選 `setup`，按 **執行**
   - 跳出授權：選你的 Google 帳號 →「進階」→「前往（不安全）」→「允許」
   - 會說不安全，是因為程式是你自己的、Google 沒審核過，可以放心
6. 回到試算表，會多出 Records、Categories、Rules 三個分頁

### 3. 部署成網址
1. Apps Script 右上角 **部署 → 新增部署作業**
2. 齒輪選 **網頁應用程式**
3. 「執行身分」選 **我**，「誰可以存取」選 **所有人**
4. 按「部署」，複製網址（像 `https://script.google.com/macros/s/xxxx/exec`）

> 「所有人」的意思是網址打得開，但沒有通關密語什麼都讀不到。

### 4. 電腦：下載程式
1. 下載 **[HomeLedger.exe](https://github.com/Hallowyeeee/home-ledger/releases/latest/download/HomeLedger.exe)**，放桌面，雙擊打開
   - 若跳「Windows 已保護您的電腦」：按「其他資訊」→「仍要執行」（我們沒付錢買軟體簽章才會這樣）
   - 想裝到開始選單可改下載 [HomeLedger-setup.exe](https://github.com/Hallowyeeee/home-ledger/releases/latest/download/HomeLedger-setup.exe)
2. 第一次打開，填第 3 步的網址和通關密語，按「開始使用」

### 5. 手機：設定並加到主畫面
1. 電腦程式右上角按 **設定碼**，複製「手機連結」，用 LINE 傳給自己和子淳
2. 在 iPhone 用 **Safari** 打開那個連結（會自動設定好）
3. 下方「分享」→「**加入主畫面**」。之後點圖示就能記帳

---

## 換一台電腦
1. 新電腦下載 [HomeLedger.exe](https://github.com/Hallowyeeee/home-ledger/releases/latest/download/HomeLedger.exe)
2. 打開後貼上**設定碼**（舊電腦程式右上角「設定碼」可以看到；或重新填網址＋通關密語）
3. 資料會自動從雲端下載，完成

## 匯入手機條碼發票
1. 電腦程式 →「匯入發票」→「打開財政部平台」，登入手機條碼（圖形驗證碼要自己打）
2. 到消費資料查詢，選月份，匯出下載檔案
3. 把檔案拖進程式。會自動分類；之前匯過的會略過；手機上可能已記過的同一筆會標出來，預設不勾

## 常見問題
- **顯示「通關密語錯誤」**：Code.gs 的 KEY 和你填的不一樣
- **改了 Code.gs 沒效果**：Apps Script →「部署 → 管理部署作業」→ 鉛筆 → 版本選「新版本」→ 部署（網址不變）
- **想直接看原始資料**：程式「明細」頁右上「在 Google 試算表開啟」
- **資料會不會被別人看到**：帳目只在你的 Google 試算表；這個 GitHub 專案只有程式，沒有任何帳目

---

## 程式結構（給維護的人）
| 位置 | 內容 |
|---|---|
| `backend/Code.gs` | Apps Script 後端：`sync`（增量同步）、`upsert`、`learnRule`、`saveCategories`、`saveRules` |
| `web/core.js` | 共用資料層：IndexedDB 本機資料、待送清單、同步、自動分類 |
| `web/index.html` | 手機快速輸入（GitHub Pages 發布） |
| `web/app.html` | 電腦版畫面（.exe 內嵌，也可用瀏覽器開） |
| `desktop/` | Tauri 2 殼，GitHub Actions 在 Windows 打包成 .exe 並發布到 Releases |
