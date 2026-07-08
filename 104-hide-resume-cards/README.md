# 104 隱藏履歷卡片與共用規則標示

這個資料夾保留 Google Sheet / Apps Script 共用規則服務，以及舊 hide-only userscript 的 deprecated 提示。

新版架構已整合到 [104 Resume Screening Unified](/Users/sunrisesundown/Documents/AI_HR_Workflow/resume-screening-system/userscripts/104-resume-screening-collector.user.js)。Tampermonkey 請安裝整合版，不要再安裝 `104-hide-resume-cards.user.js`。

## 隱藏規則

當履歷卡片符合以下任一條件時，就會被隱藏：

- 卡片中有備註區塊：`.resume-remark.mt-2`
- 近三個月的歷程中有包含「發出」的紀錄，代表我們曾主動聯繫對方
- 如果 `CONFIG.RISK_ACTION` 改成 `hide`，命中高/中高信心博弈風險規則也會隱藏；預設為 `review`，只標示人工覆核。

目前可涵蓋的歷程情境包含：

- `發出聊聊通知`
- `發出詢問意願通知`
- 其他歷程文字中包含「發出」的主動聯繫紀錄

例如「應徵履歷」不包含「發出」，目前不會因為這個情境被隱藏。

履歷代碼回查模式，例如搜尋 `20000001931331`，不會自動隱藏卡片，避免回查名單時人數變少。

## 共用規則標示

Tampermonkey 會在卡片上方插入 badge：

- `SI +3`：命中同業/SI/軟體服務加分規則。
- `博弈風險 +5｜人工覆核`：命中博弈風險規則，預設只提示人工覆核。
- 低信心規則會以虛線 badge 呈現，只提示，不參與自動隱藏。

滑鼠停在 badge 上可看到命中詞、規則名稱、可信度、備註與來源 URL。

## 同仁要去哪裡新增公司

部署 Apps Script 後會建立一份 Google Sheet。打開後先看 `維護入口` 分頁：

- 要新增 SI / 同業 / 軟體服務公司：到 `加分_乙方SI軟體服務` 新增一列。
- 要新增博弈 / 博奕 / 娛樂城風險公司：到 `風險_博弈相關` 新增一列。
- 要新增博弈關鍵字或 SI 關鍵字：到 `關鍵字_正規化規則` 新增一列。

新增時先把 `啟用` 留 `FALSE`，資料確認後改成 `TRUE`。Tampermonkey 會在約 60 秒內抓到更新。

## 檔案

- `104-hide-resume-cards.user.js`
- `apps-script/rule-service/`：Google Sheet 規則服務。
- `src/rule-matcher.js`：可測的規則比對邏輯。
- `tests/rule-matcher.test.js`：Tampermonkey 規則 fixture 測試。

## 安裝方式

1. 依照 [Apps Script 規則服務 README](/Users/sunrisesundown/Documents/AI_HR_Workflow/104-hide-resume-cards/apps-script/rule-service/README.md) 部署 Web App。
2. 複製 `.../exec?action=rules` URL。
3. 將 [104-resume-screening-collector.user.js](/Users/sunrisesundown/Documents/AI_HR_Workflow/resume-screening-system/userscripts/104-resume-screening-collector.user.js) 貼到 Tampermonkey。
4. 把整合腳本設定區的 `RULES_API_URL` 改成你的 Apps Script URL。

如果 104 頁面顯示「規則 API 回傳 HTML，不是 JSON」，代表 Apps Script URL 目前不是公開 JSON。請先用無痕視窗打開 `.../exec?action=rules`，確認畫面從 `{` 開始；若不是，回 Apps Script 重新部署 Web App，權限設為 `Execute as: Me` 與 `Anyone with the link`。

腳本會在以下網址執行：

```text
https://*.104.com.tw/*
```

## 本機測試

```bash
cd /Users/sunrisesundown/Documents/AI_HR_Workflow/104-hide-resume-cards
npm test
```
