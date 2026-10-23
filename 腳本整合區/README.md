# 104 Tampermonkey 腳本整合區

此資料夾集中保存實習生常用的三組 104 工具。所有可安裝腳本的檔名都以 `.user.js` 結尾；請依下方連結取得各功能資料夾內的現行版本。

## 內容清單

| 工具 | 匯入檔案 | 用途 |
|---|---|---|
| invite-again | `invite-again-part1.user.js` | 從履歷代碼查詢結果分批開啟聊天室 |
| invite-again | `invite-again-part2.user.js` | 在聊天室帶入姓名與二次邀約範本 |
| SalaryEstimate | `SalaryEstimate.user.js` | 使用 Gemini 協助預估候選人薪資區間 |
| hide-resume-cards | `hide-resume-cards.user.js` | 掃描、標示、篩選與排序履歷卡片 |

> `invite-again` 原始設計由兩個互補腳本組成，因此共有四個 `.user.js` 檔案，功能上是三組工具。需要全部功能時，請安裝四個腳本。

## 安裝方式

不再提供內含舊 Toolkit 的「實習生下載整合包.zip」。招募工作台請依 [`104Toolkit` 安裝與更新說明](../104Toolkit/README.md) 安裝；Chrome 擴充功能與 Tampermonkey 腳本使用不同安裝方式。

Tampermonkey 腳本請從各功能資料夾取得現行版本並逐一安裝：

- [履歷掃描與篩選](../104-hide-resume-cards/)
- [薪資試算](../104-SalaryEstimate/)
- [二次邀約](../104-Ivite-again/)

本資料夾保留腳本整合說明；遇到版本差異，以以上各功能資料夾為準。

## 匯入後必要設定

### SalaryEstimate

每位使用者都必須使用自己的 Gemini API Key：

1. 在 Tampermonkey 管理面板開啟 `104 履歷內建 Gemini 試算`。
2. 搜尋 `GEMINI_API_KEY`。
3. 將 `請把你的API_KEY貼在這裡` 換成自己的 API Key。
4. 儲存腳本。

請勿把 API Key 貼到群組、截圖、GitHub 或交給其他人共用。

### invite-again

- 第一次批次開啟聊天室時，瀏覽器可能會阻擋彈出視窗。
- 請允許 `vip.104.com.tw` 開啟彈出式視窗。
- 工具只會填入邀約內容，不會自動送出；送出前請人工確認姓名、職缺、內容與 HR 署名。

## 安裝後快速驗收

- 履歷代碼查詢結果頁：可看到「104 批次開聊」面板。
- 104 聊天室頁：可看到「二邀助手」面板。
- 104 履歷頁：工作經歷附近可使用薪資預估功能。
- 104 搜尋結果頁：可看到履歷掃描／篩選工具。

若功能沒有出現，請先確認腳本已啟用、網址符合腳本支援範圍，並重新整理頁面。

