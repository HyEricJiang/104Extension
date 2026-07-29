# 純 Chrome 版本修改說明

## 這次修改內容
1. 放棄 GAS 架構，維持純 Chrome Extension。
2. 調整搜尋履歷頁的預覽網址拼接規則：
   - 來源頁：`/search/SearchResumeMaster?idno=...&rc=...`
   - 預覽頁：`/ResumeTools/resumePreview?pageSource=search&searchEngineIdNos={idno}`
3. 搜尋情境不再依賴 `rc`、`ec` 等額外參數。
4. 文件履歷情境（`/document/master?sn=...`）維持原本 `snapshotId/ec` 邏輯。

## 主要修改檔案
- `background.js`
- `README.txt`


5. 新增主動應徵頁（`/apply/ApplyResume`）的網址轉換邏輯：
   - 來源頁：`/apply/ApplyResume?sn=...&ec=...`
   - 預覽頁：`/ResumeTools/resumePreview?ec=...&pageSource=apply&searchEngineIdNos=&snapshotIds={sn}`
6. Apply 情境優先直接解析當前網址中的 `sn`、`ec`，避免從頁面 DOM 抓到其他人的履歷連結。
7. 補上 `https://vip.104.com.tw/apply/*` host permission，確保必要時可讀取 Apply 頁內容。
