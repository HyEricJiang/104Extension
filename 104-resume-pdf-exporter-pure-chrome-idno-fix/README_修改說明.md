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
