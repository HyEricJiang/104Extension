使用方式：
1. Chrome 設定 > 下載內容：
   - 關閉「每次下載前詢問儲存位置」
   - 把「位置」改成 /Users/sunrisesundown/我的雲端硬碟/招募/104履歷下載區

2. ✅ 新模式（一鍵下載，不需先開列印頁）：
   - 在以下任一頁面按擴充套件 →「下載目前履歷」
     - 原始頁： https://vip.104.com.tw/search/searchResumeMaster?idno=...
     - 文件頁： https://vip.104.com.tw/document/master?sn=...
     - 預覽頁： https://vip.104.com.tw/ResumeTools/resumePreview?...
     - 主動投遞/應徵頁： https://vip.104.com.tw/apply/ApplyResume
   - 會自動：開「背景」預覽頁 → 匯出 PDF → 下載 → 關閉背景頁

3. ✅ 新模式（往右批次）：
   - 把多個履歷頁（原始頁/預覽頁）依序排在同一個 Chrome 視窗，且「目前分頁」停在第一份
   - 按擴充套件 →「往右批次下載」
   - 會從目前分頁開始，一直往右處理，直到遇到第一個「非 104 履歷頁」就停止
   - 也支援把「主動投遞/應徵頁」混在中間（會嘗試從頁面中解析出真正的履歷網址）

4. 備註：
   - 往右批次會同時支援大小寫不同的履歷路徑，例如：
     - /search/searchResumeMaster
     - /search/SearchResumeMaster

5. 搜尋履歷頁規則更新：
   - 當來源頁是：
     https://vip.104.com.tw/search/SearchResumeMaster?idno=30000001874676&rc=19031000
   - 下載時會直接拼成：
     https://vip.104.com.tw/ResumeTools/resumePreview?pageSource=search&searchEngineIdNos=30000001874676
   - ✅ 搜尋情境只依賴 idno，不再依賴 rc / ec。
