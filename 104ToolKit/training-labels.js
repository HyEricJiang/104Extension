(() => {
  "use strict";
  const CATEGORIES = Object.freeze({
    systemRecommendedUnsuitable: "系統推薦但不合適",
    reviewedShouldRecommend: "人工審核但需要推薦",
    reviewedShouldExclude: "人工審核但應該排除",
    wronglyExcludedNeedsReview: "不應排除需人工審核",
    wronglyExcludedShouldRecommend: "不應排除應推薦"
  });
  const STORAGE_PREFIX = "resume_training_label_v1:";
  let lastBundle = null;
  const LAST_EXPORT = "resume_training_last_export_v1";

  function identity(info) {
    if (info?.idno) return `search:${encodeURIComponent(info.idno)}`;
    if (info?.snapshotId) return `snapshot:${encodeURIComponent(info.ec || "")}:${encodeURIComponent(info.snapshotId)}`;
    throw new Error("無法辨識這份履歷，請開啟完整履歷頁再標記。");
  }
  async function read(info) {
    const key = STORAGE_PREFIX + identity(info);
    const stored = (await chrome.storage.local.get(key))[key];
    return stored && Object.prototype.hasOwnProperty.call(CATEGORIES, stored.categoryId)
      ? { ...stored, label: CATEGORIES[stored.categoryId] } : null;
  }
  async function save(info, categoryId) {
    if (!Object.prototype.hasOwnProperty.call(CATEGORIES, categoryId)) throw new Error("不支援這個分類選項。");
    const resumeKey = identity(info);
    const record = { resumeKey, categoryId, label: CATEGORIES[categoryId], updatedAt: new Date().toISOString() };
    // 每份履歷使用獨立鍵值，避免不同分頁同時標記時覆蓋彼此。
    await chrome.storage.local.set({ [STORAGE_PREFIX + resumeKey]: record });
    return record;
  }
  async function remove(info) {
    // 只刪除這份履歷的標記，不影響其他履歷或已匯出的分類清單。
    await chrome.storage.local.remove(STORAGE_PREFIX + identity(info));
  }
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function toCsv(rows) {
    const columns = ["pdfFilename", "pdfPath", "filenameVerified", "jobTitle", "trainingLabel", "resumeKey", "labelUpdatedAt", "exportedAt"];
    return "\uFEFF" + [columns.map(csvCell).join(","), ...rows.map(row => columns.map(key => csvCell(row[key])).join(","))].join("\r\n");
  }
  async function downloadReport(rows, subdir = "", remember = true) {
    if (!rows.length) throw new Error("尚無已完成的 PDF 可匯出分類清單。");
    if (remember) {
      lastBundle = { rows, subdir };
      try { await chrome.storage.local.set({ [LAST_EXPORT]: lastBundle }); }
      catch (_) { console.warn("[104 招募工作台] 分類清單僅暫存在背景服務，無法持久保存。"); }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${subdir}training-labels_${stamp}.csv`;
    await chrome.downloads.download({ url: "data:text/csv;charset=utf-8," + encodeURIComponent(toCsv(rows)), filename, conflictAction: "uniquify", saveAs: false });
    return { ok: true, count: rows.length, filename };
  }
  async function downloadLastReport() {
    const bundle = lastBundle || (await chrome.storage.local.get(LAST_EXPORT))[LAST_EXPORT];
    return downloadReport(bundle?.rows || [], bundle?.subdir || "", false);
  }
function parseResumeInfoFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.origin !== "https://vip.104.com.tw") return null;
    const pathname = (u.pathname || "").toLowerCase();
    const pageSource = (u.searchParams.get("pageSource") || "").toLowerCase().trim();
    const ec = (u.searchParams.get("ec") || "").trim();
    const idno = (u.searchParams.get("idno") || "").trim() || (u.searchParams.get("searchEngineIdNos") || "").trim();
    const snapshotId = (u.searchParams.get("sn") || "").trim() || (u.searchParams.get("snapshotIds") || "").trim();

    if (pathname === "/apply/applyresume" && snapshotId && ec) return { mode: "apply", snapshotId, ec };
    if (pageSource === "apply" && snapshotId && ec) return { mode: "apply", snapshotId, ec };
    if (pageSource === "search" && idno) return { mode: "search", idno };
    if ((pathname === "/document/master" || pageSource === "document") && snapshotId) return { mode: "document", snapshotId, ec };
    if (idno) return { mode: "search", idno };
    if (snapshotId) return { mode: "document", snapshotId, ec };
    return null;
  } catch (_) { return null; }
}
  const api = Object.freeze({ CATEGORIES, identity, parseResumeInfoFromUrl, read, save, remove, toCsv, downloadReport, downloadLastReport });
  globalThis.ResumeTrainingLabels = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
