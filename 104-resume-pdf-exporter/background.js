// 104 VIP Resume PDF Exporter - MV3
// Features:
//  - One-click download from current tab (search/document/preview)
//  - Batch download from current tab to the right until the FIRST non-resume page
// Implementation (Safe mode):
//  - Builds resumePreview URL from idno+ec and opens it in the active tab, then calls window.print().
//  - NOTE: Chrome does not provide an API to silently save PDFs without CDP/Debugger.
// Badge: Idle=PDF, Running=progress, Done=OK then back to PDF, Error=ERR then back to PDF

const PREVIEW_URL_PREFIX = "https://vip.104.com.tw/ResumeTools/resumePreview";
const NAME_SELECTOR =
  "#app > div.container.page-container.container-3 > section > div > section > div > div.vip-resume-card.resume-block.resume-card.size-medium > div.resume-card-item.resume-card__center > div > h2 > p";

const DEFAULT_SETTINGS = {
  subdir: "104履歷下載區/", // relative to Chrome download directory
  // Legacy fixed waits (no longer required in v1.5+). Kept for backward compatibility.
  firstWait: 2800,
  nextWait: 800,
  // New: max time to wait for preview to fully render (ms)
  renderTimeout: 45000,
  // ✅ 檔名前綴/後綴（可留白）：職稱_Name_來源
  filenamePrefix: "",
  filenameSuffix: ""
};

const PDF_PRINT_OPTIONS = { printBackground: true, preferCSSPageSize: true };

/** =========================
 *  Badge state machine (Idle=PDF)
 *  ========================= */
const PDF_BADGE = {
  IDLE_TEXT: "PDF",
  IDLE_COLOR: "#1a73e8",

  RUNNING_COLOR: "#1a73e8",

  OK_TEXT: "OK",
  OK_COLOR: "#34a853",

  ERR_TEXT: "ERR",
  ERR_COLOR: "#d93025",

  RESET_AFTER_MS: 4500
};

let pdfBadgeState = {
  running: false,
  current: 0,
  total: 0,
  lastTitle: "PDF"
};

function badgeSet(text, color, title) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
  if (title) chrome.action.setTitle({ title });
  if (title) pdfBadgeState.lastTitle = title;
}

function badgeIdle(title = "PDF") {
  pdfBadgeState.running = false;
  badgeSet(PDF_BADGE.IDLE_TEXT, PDF_BADGE.IDLE_COLOR, title);
}

function badgeProgressText(current, total) {
  const t = `${current}/${total}`;
  return t.length <= 4 ? t : String(current);
}

function badgeRunning(current, total, title) {
  pdfBadgeState.running = true;
  pdfBadgeState.current = current;
  pdfBadgeState.total = total;
  badgeSet(badgeProgressText(current, total), PDF_BADGE.RUNNING_COLOR, title || `匯出中：${current}/${total}`);
}

function badgeOkThenReset(title = "完成") {
  pdfBadgeState.running = false;
  badgeSet(PDF_BADGE.OK_TEXT, PDF_BADGE.OK_COLOR, title);
  setTimeout(() => {
    if (!pdfBadgeState.running) badgeIdle("PDF");
  }, PDF_BADGE.RESET_AFTER_MS);
}

function badgeErrThenReset(title = "錯誤") {
  pdfBadgeState.running = false;
  badgeSet(PDF_BADGE.ERR_TEXT, PDF_BADGE.ERR_COLOR, title);
  setTimeout(() => {
    if (!pdfBadgeState.running) badgeIdle("PDF");
  }, PDF_BADGE.RESET_AFTER_MS);
}

// ✅ Ensure idle shows PDF on install + SW restart
chrome.runtime.onInstalled.addListener(() => badgeIdle("PDF"));
badgeIdle("PDF");

/** =========================
 *  Runtime state
 *  ========================= */
let state = {
  running: false,
  stopRequested: false,
  currentIndex: 0,
  total: 0,
  progressText: "",
  lastMessage: "",
  settings: { ...DEFAULT_SETTINGS }
};

// Dedicated worker tab for preview/print (do NOT overwrite user's current working tab)
let workerTabId = null;
let workerWindowId = null;

/** =========================
 *  Message router
 *  ========================= */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.cmd === "getStatus") {
        return sendResponse({ ...state });
      }

      if (msg?.cmd === "applySettings") {
        const { settings } = await chrome.storage.local.get("settings");
        state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
        badgeIdle("PDF");
        return sendResponse({ ok: true });
      }

      // ✅ New mode: from current tab (searchResumeMaster or resumePreview) -> open preview tab in background -> printToPDF -> download -> close
      if (msg?.cmd === "downloadCurrent") {
        if (state.running) return sendResponse({ ok: false, error: "目前正在匯出中，請先 Stop 或等完成。" });
        runDownloadCurrent().catch(err => hardFail(err));
        return sendResponse({ ok: true });
      }

      // ✅ New mode: batch from active tab to the right, until first non-104 resume page
      if (msg?.cmd === "downloadRight") {
        if (state.running) return sendResponse({ ok: false, error: "目前正在匯出中，請先 Stop 或等完成。" });
        runDownloadRightBatch().catch(err => hardFail(err));
        return sendResponse({ ok: true });
      }

      // ✅ Stop current batch/job gracefully
      if (msg?.cmd === "stop") {
        if (!state.running) {
          state.stopRequested = false;
          state.lastMessage = "（目前沒有執行中的批次）";
          badgeIdle("PDF");
          return sendResponse({ ok: true, running: false });
        }
        state.stopRequested = true;
        state.lastMessage = "⏹ 已要求停止：將在目前步驟結束後中止";
        badgeSet("STOP", PDF_BADGE.ERR_COLOR, "停止中…");
        return sendResponse({ ok: true, running: true });
      }

      // Optional: if you want popup open to force idle badge:
      if (msg?.cmd === "initBadgePDF") {
        badgeIdle("PDF");
        return sendResponse({ ok: true });
      }

      sendResponse({ ok: false, error: "unknown cmd" });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();

  return true;
});

/** =========================
 *  New mode A: open preview tab in background -> printToPDF -> download -> close
 *  ========================= */
async function runDownloadCurrent() {
  const active = await getActiveTab();
  const currentUrl = active?.url || "";
  if (!is104ResumePage(currentUrl)) {
    throw new Error("目前分頁不是 104 履歷/應徵頁（SearchResumeMaster / document/master / resumePreview / apply/ApplyResume）。請切到正確頁面再按一次。");
  }

  const info = parseIdnoEcFromAnyUrl(currentUrl);
  if (!info?.ec) {
    throw new Error("此頁面網址未包含可用的 ec，無法組出預覽頁 URL。");
  }

  // ✅ ApplyResume: use sn+ec to build preview URL (no idno on ApplyResume)
  if (info.mode === "apply") {
    if (!info?.sn) {
      throw new Error(
        "此 ApplyResume 頁面網址未包含可用的 sn，無法組出 apply 預覽頁 URL。\n" +
        "提示：ApplyResume 通常有 sn & ec。"
      );
    }
    await runPrintJob([{ mode: "apply", sn: info.sn, ec: info.ec, tabId: active.id }], "列印目前履歷（Apply：需手動另存PDF）");
    return;
  }

  // ✅ Search/Preview: idno + ec
  if (!info?.idno) {
    throw new Error(
      "此頁面網址未包含可用的 idno，無法組出 search 預覽頁 URL。\n" +
      "提示：SearchResumeMaster 通常有 idno&ec；document/master 通常只有 sn（不一定有 idno）。"
    );
  }
  await runPrintJob([{ mode: "search", idno: info.idno, ec: info.ec, tabId: active.id }], "列印目前履歷（需手動另存PDF）");
}

async function runDownloadRightBatch() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = tabs.find(t => t.active);
  if (!active) throw new Error("找不到目前分頁（active tab）。");

  const sorted = [...tabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const startIdx = sorted.findIndex(t => t.id === active.id);
  if (startIdx < 0) throw new Error("無法定位目前分頁位置。");

  const items = [];
  const seen = new Set();

  for (let i = startIdx; i < sorted.length; i++) {
    const url = sorted[i].url || "";
    if (!is104ResumePage(url)) break; // stop at first non-resume page

    const info = parseIdnoEcFromAnyUrl(url);
    if (!info?.ec) continue;

    // ✅ ApplyResume: sn + ec
    if (info.mode === "apply") {
      if (!info?.sn) continue;
      const key = `apply:sn:${info.sn}|${info.ec}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ mode: "apply", sn: info.sn, ec: info.ec, tabId: sorted[i].id });
      continue;
    }

    // ✅ Search/Preview: idno + ec
    if (!info?.idno) continue;
    const key = `idno:${info.idno}|${info.ec}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ mode: "search", idno: info.idno, ec: info.ec, tabId: sorted[i].id });
  }

  if (items.length === 0) {
    throw new Error("往右沒有找到可列印的 104 履歷頁（需要網址包含 idno+ec 或 ApplyResume 的 sn+ec）。");
  }

  await runPrintJob(items, `往右批次列印（${items.length} 份，需手動另存PDF）`);
}

async function runPrintJob(items, jobTitle) {
  // Load settings fresh
  const { settings } = await chrome.storage.local.get("settings");
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  // reset stop flag for this job
  state.stopRequested = false;

  state.running = true;
  state.currentIndex = 0;
  state.total = items.length;
  state.progressText = "0/" + items.length;
  state.lastMessage = `開始：${jobTitle}`;

  badgeIdle(`準備：${jobTitle}`);

  const report = { ok: 0, fail: 0, failures: [] };

  for (let i = 0; i < items.length; i++) {
    if (state.stopRequested) {
      state.lastMessage = `⏹ 已停止於 ${state.currentIndex}/${state.total}`;
      break;
    }

    state.currentIndex = i + 1;
    state.progressText = `${state.currentIndex}/${state.total}`;
    badgeRunning(state.currentIndex, state.total, `${jobTitle}：${state.currentIndex}/${state.total}`);

    const info = items[i];
    const mode = info?.mode || "search";
    const ec = info?.ec || "";
    const idno = info?.idno || "";
    const sn = info?.sn || "";

    try {
      if (!ec) throw new Error("缺少 ec，無法組出預覽頁。");
      if (mode === "apply") {
        if (!sn) throw new Error("缺少 sn（ApplyResume），無法組出預覽頁。");
      } else {
        if (!idno) throw new Error("缺少 idno，無法組出預覽頁。");
      }

      if (state.stopRequested) throw new Error("已要求停止");

      // ✅ 唯一來源：一律以「預覽頁」上的姓名 selector 抓取姓名，再組 prefix_姓名_suffix
      const { safeName } = await openPreviewInWorkerTabAndPrint({ mode, idno, sn, ec }, i === 0);
      state.lastMessage = `✅ ${state.currentIndex}/${state.total} 已開啟列印視窗：${safeName}`;
      report.ok++;
    } catch (e) {
      const err = e?.message || String(e);
      report.fail++;
      report.failures.push({ index: `${state.currentIndex}/${state.total}`, mode, idno, sn, ec, error: err });
      state.lastMessage = `❌ ${state.currentIndex}/${state.total} 失敗：${err}`;
    }
  }

  const stoppedEarly = state.stopRequested;
  state.running = false;
  state.stopRequested = false;

  if (stoppedEarly) {
    badgeOkThenReset(`已停止：成功 ${report.ok}/${state.total}`);
  } else if (report.fail === 0) {
    badgeOkThenReset(`完成：成功 ${report.ok}/${state.total}`);
  } else {
    badgeErrThenReset(`完成：成功 ${report.ok}/${state.total}，失敗 ${report.fail}`);
  }

  console.group(`📄 104 PDF Export Report - ${jobTitle}`);
  console.log("Success:", report.ok, "/", state.total);
  console.log("Failures:", report.failures);
  console.groupEnd();
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true, active: true });
  return tabs?.[0] || null;
}

function is104ResumePage(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== "vip.104.com.tw") return false;
    const p = (u.pathname || "").toLowerCase();
    return (
      p === "/resumetools/resumepreview" ||
      p === "/search/searchresumemaster" ||
      p === "/document/master" ||
      p === "/apply/applyresume"
    );
  } catch (_) {
    return false;
  }
}

function parseIdnoEcFromAnyUrl(url) {
  // ✅ Unified parser for multiple 104 contexts:
  //  - Search/Preview: idno + ec
  //  - ApplyResume (主動投遞/應徵): sn + ec
  try {
    const u = new URL(url);
    if (u.hostname !== "vip.104.com.tw") return null;

    const p = (u.pathname || "").toLowerCase();
    const qs = u.searchParams;

    const ec = qs.get("ec") || "";
    const idno = qs.get("idno") || qs.get("searchEngineIdNos") || "";
    const sn = qs.get("sn") || qs.get("snapshotIds") || "";

    if (p === "/apply/applyresume") {
      return { mode: "apply", sn, ec, idno: "" };
    }

    // Default: treat as search/preview context
    return { mode: "search", idno, ec, sn: "" };
  } catch (_) {
    return null;
  }
}

function buildSearchPreviewUrl(idno, ec) {
  const u = new URL(PREVIEW_URL_PREFIX);
  u.searchParams.set("pageSource", "search");
  u.searchParams.set("searchEngineIdNos", String(idno || ""));
  u.searchParams.set("snapshotIds", "");
  u.searchParams.set("ec", String(ec || ""));
  return u.toString();
}

function buildApplyPreviewUrl(sn, ec) {
  // ApplyResume -> resumePreview
  // Example:
  // https://vip.104.com.tw/apply/ApplyResume?sn=...&ec=14
  // -> https://vip.104.com.tw/ResumeTools/resumePreview?ec=14&pageSource=apply&searchEngineIdNos=&snapshotIds=...
  const u = new URL(PREVIEW_URL_PREFIX);
  u.searchParams.set("pageSource", "apply");
  u.searchParams.set("searchEngineIdNos", "");
  u.searchParams.set("snapshotIds", String(sn || ""));
  u.searchParams.set("ec", String(ec || ""));
  return u.toString();
}

async function ensureWorkerTab() {
  // If worker tab is missing/closed, recreate it in current window.
  try {
    if (workerTabId) {
      const t = await chrome.tabs.get(workerTabId);
      if (t && !t.discarded) return t;
    }
  } catch (_) {
    // ignore
  }

  const active = await getActiveTab();
  const winId = active?.windowId;
  const created = await chrome.tabs.create({
    url: "about:blank",
    active: false,
    windowId: winId
  });
  workerTabId = created.id;
  workerWindowId = created.windowId;
  return created;
}

async function openPreviewInWorkerTabAndPrint({ mode = "search", idno = "", sn = "", ec = "" }, isFirst) {
  if (state.stopRequested) throw new Error("已要求停止");
  const previewUrl = (mode === "apply") ? buildApplyPreviewUrl(sn, ec) : buildSearchPreviewUrl(idno, ec);
  const worker = await ensureWorkerTab();
  if (!worker?.id) throw new Error("無法建立列印用分頁（worker tab）。");

  await chrome.tabs.update(worker.id, { url: previewUrl, active: true });
  if (state.stopRequested) throw new Error("已要求停止");
  await waitTabComplete(worker.id, state.settings.renderTimeout || 45000);

  if (state.stopRequested) throw new Error("已要求停止");

  // ✅ v1.5+: smart wait until preview is really rendered (avoid blank PDFs)
  const rendered = await waitForPreviewRendered(worker.id, state.settings.renderTimeout || 45000);

  if (state.stopRequested) throw new Error("已要求停止");

  const result = await chrome.scripting.executeScript({
    target: { tabId: worker.id },
    world: "MAIN",
    func: () => {
      const text = (document.body?.innerText || "").slice(0, 2000);
      const title = document.title || "";
      return { title, text };
    }
  });
  const page = result?.[0]?.result;
  const deny = ["無權限", "已失效", "已關閉", "無法列印", "請重新登入", "逾時"];
  if (page && deny.some(k => page.title.includes(k) || page.text.includes(k))) {
    throw new Error("預覽頁顯示無權限/已失效/已關閉，無法列印。請確認此履歷仍有查看權限或放慢批次速度。");
  }

  // ✅ 唯一來源：只從「預覽頁」抓姓名（以 smart wait 的結果為準）
  const rawName = rendered?.name || "";
  const safeName = sanitizeFilename(rawName) || (mode === "apply" ? `sn_${sn}` : `idno_${idno}`);
  const filename = buildFilename(state.settings.filenamePrefix, safeName, state.settings.filenameSuffix);

  // Set document title to influence the default "Save as" filename in Chrome print dialog.
  // (Chrome doesn't guarantee this, but it helps in practice.)
  await chrome.scripting.executeScript({
    target: { tabId: worker.id },
    world: "MAIN",
    func: (title) => {
      try { document.title = title; } catch (_) {}
    },
    args: [filename.replace(/\.pdf$/i, "")]
  });

  await chrome.scripting.executeScript({
    target: { tabId: worker.id },
    world: "MAIN",
    func: () => {
      window.focus();
      window.print();
    }
  });

  return { safeName, filename };
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("等待頁面載入逾時"));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    };

    const onRemoved = (removedTabId) => {
      if (removedTabId !== tabId) return;
      cleanup();
      reject(new Error("等待頁面載入時分頁已關閉"));
    };

    async function immediateCheck() {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.status === "complete") {
          cleanup();
          resolve();
        }
      } catch (_) {
        cleanup();
        reject(new Error("等待頁面載入時分頁已關閉"));
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    immediateCheck();
  });
}

/** =========================
 *  Page helpers
 *  ========================= */

// ✅ Smart wait: ensure preview content is actually rendered (avoid blank PDF)
// Strategy:
//  - Wait until NAME_SELECTOR exists and looks like a real name
//  - Wait until body text length is above a minimum threshold
//  - Require the above signals to be stable for a few consecutive polls
async function waitForPreviewRendered(tabId, timeoutMs = 45000) {
  const start = Date.now();
  let last = { name: "", bodyLen: 0 };
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    if (state.stopRequested) throw new Error("已要求停止");
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (nameSel) => {
        const deny = ["無權限", "已失效", "已關閉", "無法列印", "請重新登入", "逾時", "稍早已關閉"];
        const text = (document.body?.innerText || "");
        const title = document.title || "";
        const denied = deny.some(k => title.includes(k) || text.includes(k));
        const nameEl = document.querySelector(nameSel);
        const name = (nameEl?.textContent || "").replace(/\s+/g, " ").trim();
        const bodyLen = text.trim().length;

        // Very lightweight name heuristics
        const zh = name.replace(/[·．•\s]/g, "");
        const isZh = /^[\u4e00-\u9fff]{2,6}$/.test(zh);
        const isEn = /^[A-Za-z][A-Za-z.'\- ]{1,29}$/.test(name) && name.split(" ").filter(Boolean).length <= 4;
        const looksName = !!name && (isZh || isEn);

        return { denied, name, looksName, bodyLen };
      },
      args: [NAME_SELECTOR]
    });

    if (!result) {
      await sleep(250);
      continue;
    }
    if (result.denied) {
      throw new Error("預覽頁顯示無權限/已失效/已關閉，無法列印。請確認此履歷仍有查看權限或放慢批次速度。");
    }

    const okSignals = result.looksName && result.bodyLen >= 300;
    const nearSameName = result.name === last.name;
    const nearSameLen = Math.abs(result.bodyLen - last.bodyLen) <= 30;

    if (okSignals && nearSameName && nearSameLen) {
      stableCount += 1;
    } else {
      stableCount = 0;
    }

    last = { name: result.name, bodyLen: result.bodyLen };

    // Require ~3 consecutive stable polls (~900ms) to reduce "half-rendered" PDFs
    if (stableCount >= 3) {
      return { name: last.name, bodyLen: last.bodyLen };
    }

    await sleep(300);
  }

  throw new Error("等待預覽頁渲染完成逾時（可能網路較慢或被 104 風控阻擋）。");
}
async function getCandidateName(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || "").trim() : "";
    },
    args: [NAME_SELECTOR]
  });
  return results?.[0]?.result || "";
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
}

function buildFilename(prefix, name, suffix) {
  const parts = [];
  if (prefix) parts.push(prefix);
  if (name) parts.push(name);
  if (suffix) parts.push(suffix);
  const base = parts.filter(Boolean).join("_") || "resume";
  return `${base}.pdf`;
}

function normalizeSubdir(s) {
  s = s.replace(/^\/+/, ""); // must be relative
  if (!s.endsWith("/")) s += "/";
  return s;
}

/** =========================
 *  PDF export via CDP
 *  ========================= */
async function printTabToPDF(tabId) {
  const debuggee = { tabId };
  const protocolVersion = "1.3";
  try {
    await chrome.debugger.attach(debuggee, protocolVersion);
    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    await chrome.debugger.sendCommand(debuggee, "Runtime.enable");

    const { data } = await chrome.debugger.sendCommand(debuggee, "Page.printToPDF", PDF_PRINT_OPTIONS);
    if (!data) throw new Error("printToPDF 沒有回傳資料，可能頁面尚未完成渲染。");

    return base64ToUint8Array(data);
  } finally {
    try { await chrome.debugger.detach(debuggee); } catch (_) {}
  }
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** =========================
 *  Download (data: URL) - MV3 safe
 *  ========================= */
async function downloadPdfBytes(uint8Array, filename) {
  const base64 = uint8ToBase64(uint8Array);
  const url = `data:application/pdf;base64,${base64}`;

  const downloadId = await chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });

  // ✅ Always wait until the file is fully downloaded before we close the background preview tab.
  await waitForDownloadComplete(downloadId, 120000);
  return downloadId;
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function waitForDownloadComplete(downloadId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const timer = setInterval(() => {
      if (Date.now() - start > timeoutMs) {
        cleanup();
        reject(new Error("下載逾時"));
      }
    }, 1000);

    function onChanged(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") { cleanup(); resolve(); }
      if (delta.error?.current) { cleanup(); reject(new Error(`下載失敗：${delta.error.current}`)); }
    }

    function cleanup() {
      clearInterval(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
    }

    chrome.downloads.onChanged.addListener(onChanged);
  });
}

/** =========================
 *  Utils
 *  ========================= */
function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function hardFail(err) {
  console.error(err);
  state.running = false;
  state.lastMessage = err?.message || String(err);
  badgeErrThenReset(state.lastMessage || "錯誤");
}