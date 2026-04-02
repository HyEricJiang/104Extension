# 104 Resume PDF Exporter / 104 Bunny Extension

這是一套用於 **104 VIP 履歷處理** 的輔助工具，主要用來協助快速整理履歷資料、降低人工操作錯誤，並支援主動應徵履歷網址的正確轉換。
<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/a33508fe-5d28-449c-a32a-0b23c1c7c8c6" />

## 功能簡介

### 104 Bunny Extension
`104-bunny-extension` 是一個 Chrome Extension，主要提供以下功能：

- 快速擷取 104 履歷頁中的聯絡資訊
- 支援單頁複製與多分頁批次收集
- 自動整理成可貼到 Google Sheet 的格式
- 降低人工複製姓名、Email、電話等資料的時間成本
- 支援避免重複收集相同履歷資料

### 104 Resume PDF Exporter
`104-resume-pdf-exporter` 主要負責處理 104 履歷頁面的網址轉換邏輯，特別是主動應徵情境下的履歷網址辨識。

主要功能包含：

- 辨識 `ApplyResume` 類型網址
- 將主動應徵網址轉換為正確的履歷預覽 / 列印網址
- 使用 `sn` 與 `ec` 作為重要轉換依據
- 降低導出錯誤履歷資訊的風險
- 作為後續 PDF 匯出與履歷歸檔流程的基礎

## 綜合說明

這個專案的核心目標，是讓 104 履歷處理流程更穩定、更快速，也更容易串接後續的自動化應用，例如：

- 履歷資料整理
- Google Sheet 貼表
- PDF 預覽與匯出
- 履歷歸檔與管理

整體來說，`104-bunny-extension` 負責前端資料收集，`104-resume-pdf-exporter` 負責網址辨識與列印網址轉換，兩者搭配後可形成更完整的履歷處理流程。
