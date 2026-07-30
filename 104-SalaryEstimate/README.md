# 104 求職者薪資預估小工具

哈囉大家！👋

這是一個可以在 **104 網站上協助預估求職者薪資** 的小工具。  
為了讓工具順利運作，請先安裝 Tampermonkey，並設定一組自己的 Gemini API Key。整個流程大約 **3 分鐘**即可完成！

> [!NOTE]
> 薪資預估結果由 AI 產生，僅供招募與評估時參考，不代表求職者的實際薪資，也不是 104 官方提供的結果。使用時請搭配職務內容、市場行情與面談資訊進行判斷。

## 安裝前準備

- Chrome 或 Microsoft Edge 瀏覽器
- 可登入 Google AI Studio 的 Google 帳號
- 約 3 分鐘的設定時間

## 步驟一：安裝 Tampermonkey

請依照使用的瀏覽器，前往擴充功能商店安裝 **Tampermonkey（竄改猴）**：

- [Chrome 版 Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Edge 版 Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

安裝完成後，瀏覽器右上角的擴充功能區會出現 Tampermonkey 圖示。若沒有看到，可以從「擴充功能」選單將它釘選在工具列上。

## 步驟二：安裝薪資預估腳本

1. 開啟以下連結：
   - [104 求職者薪資預估腳本](https://gist.github.com/dora20051213-creator/4b1b3f88825176f32f6e7fabbed692ed)
2. 畫面出現 Tampermonkey 安裝提示後，點選「安裝」。
3. 如果沒有自動出現安裝畫面，請在 Gist 頁面開啟 `.user.js` 檔案的 **Raw** 版本，再依提示安裝。

## 步驟三：取得 Gemini API Key

本工具會使用 Gemini API 進行 AI 分析，因此每位使用者都需要設定一組自己的 API Key。

1. 前往 [Google AI Studio API Key 頁面](https://aistudio.google.com/app/apikey)。
2. 登入 Google 帳號。
3. 點選頁面中的 **Get API key** 或 **Create API key**。
4. 依畫面指示選擇現有的 Google Cloud 專案，或建立新專案。
5. 等待系統產生 API Key，接著按下複製按鈕。

> [!IMPORTANT]
> API Key 就像個人密碼，請勿貼到群組、公開文件、GitHub 或分享給其他人，也不要把完整金鑰放進問題截圖中。若不慎外流，請立即到 Google AI Studio 停用或刪除舊金鑰，並建立新金鑰。

Google AI Studio 的介面文字可能會更新，按鈕名稱若與本說明略有不同，請以頁面上的 API Key 建立流程為準。

## 步驟四：將 API Key 貼到腳本中

1. 點擊瀏覽器右上角的 Tampermonkey 圖示。
2. 選擇「管理面板」。
3. 點擊剛剛安裝的腳本名稱，進入編輯畫面。
4. 找到以下這行設定：

```javascript
const GEMINI_API_KEY = '請把你的API_KEY貼在這裡';
```

5. 將剛才複製的 API Key 貼到單引號內，取代原本的中文。例如：

```javascript
const GEMINI_API_KEY = '你的_Gemini_API_Key';
```

> [!WARNING]
> 請保留 API Key 前後的半形單引號 `'`，不要誤刪，也不要把範例文字一併保留下來。

由於腳本版本更新後行號可能改變，若在第 16～17 行附近沒有看到這段設定，可在編輯器中搜尋 `GEMINI_API_KEY`。

## 步驟五：儲存並啟用

1. 點選左上角的「檔案」→「儲存」，或使用快捷鍵：
   - Windows：`Ctrl + S`
   - macOS：`Command + S`
2. 確認腳本在 Tampermonkey 管理面板中處於「已啟用」狀態。
3. 回到要使用的 104 網頁。
4. 按下 `F5`，或點擊瀏覽器的重新整理按鈕。

完成後，小工具就會開始運作囉！🎉

## 常見問題

### 出現計算錯誤或暫時無法取得結果

Gemini API 有請求頻率與使用額度限制；實際限制會依 Google 當下政策、帳號、地區與使用模型而異。若短時間內操作過於頻繁，可能暫時出現錯誤。

建議依序嘗試：

1. 暫停操作約 3 分鐘。
2. 重新整理 104 頁面後再試一次。
3. 確認網路連線正常。
4. 確認 Tampermonkey 腳本仍為啟用狀態。
5. 確認 API Key 已完整貼上，前後沒有多餘空白，也保留了單引號。
6. 到 Google AI Studio 確認 API Key 仍有效，且尚未超過使用額度。

### 重新整理後仍然沒有出現工具

請確認：

- 已安裝並啟用 Tampermonkey。
- 薪資預估腳本已安裝且處於啟用狀態。
- 目前開啟的是腳本支援的 104 頁面。
- 瀏覽器沒有阻擋腳本執行。

## 問題回報

如果等待並重新整理後仍無法使用，請回報以下資訊：

- 使用的瀏覽器與版本
- 發生問題的操作步驟
- 畫面顯示的錯誤訊息
- 問題發生的時間
- 隱藏個人資料與 API Key 後的畫面截圖

請務必先遮住履歷中的個人資料、公司內部資訊及完整 API Key，再傳送截圖。

---

祝大家使用順利！如有任何問題，歡迎隨時用截圖或文字訊息告知我。 🙌
