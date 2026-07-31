# 104 Tampermonkey 腳本整合區

此資料夾集中保存實習生常用的三組 104 工具。所有可匯入腳本的檔名都以 `.user.js` 結尾，方便 Tampermonkey 從 ZIP 一次辨識與匯入。

## 內容清單

| 工具 | 匯入檔案 | 用途 |
|---|---|---|
| invite-again | `invite-again-part1.user.js` | 從履歷代碼查詢結果分批開啟聊天室 |
| invite-again | `invite-again-part2.user.js` | 在聊天室帶入姓名與二次邀約範本 |
| SalaryEstimate | `SalaryEstimate.user.js` | 使用 Gemini 協助預估候選人薪資區間 |
| hide-resume-cards | `hide-resume-cards.user.js` | 掃描、標示、篩選與排序履歷卡片 |

> `invite-again` 原始設計由兩個互補腳本組成，因此整合包共有四個 `.user.js` 檔案，但功能上仍是三組工具。請將四個檔案全部匯入。

## ZIP 一次匯入

1. 先安裝 Tampermonkey，並開啟「管理面板」。
2. 進入「實用工具（Utilities）」分頁。
3. 找到 ZIP 匯入區，按「選擇檔案（Choose File）」。
4. 選擇專案根目錄的 `104-Tampermonkey-腳本整合包.zip`。
5. 在匯入清單中確認四個腳本皆有出現，再按「安裝／匯入」。
6. 回到管理面板，確認四個腳本皆已啟用。

若看不到「實用工具」分頁，請先在 Tampermonkey 設定中將設定模式調整為「初學者」或「進階」。

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

