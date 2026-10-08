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
    // 只刪除這份履歷的標記，不影響其他履歷或已匯出的 PDF。
    await chrome.storage.local.remove(STORAGE_PREFIX + identity(info));
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
  const api = Object.freeze({ CATEGORIES, identity, parseResumeInfoFromUrl, read, save, remove });
  globalThis.ResumeTrainingLabels = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
