// 104 VIP Resume PDF Exporter (Control) - MV3
// Features: Start/Pause/Resume/Stop + configurable download subdir + faster mode (no wait download complete)
// Badge: Idle=PDF, Running=progress, Done=OK then back to PDF, Error=ERR then back to PDF
// Download: uses data: URL (no URL.createObjectURL in MV3 SW)

const TARGET_URL_PREFIX = "https://vip.104.com.tw/ResumeTools/resumePreview?";
const NAME_SELECTOR =
  "#app > div.container.page-container.container-3 > section > div > section > div > div.vip-resume-card.resume-block.resume-card.size-medium > div.resume-card-item.resume-card__center > div > h2 > p";

const DEFAULT_SETTINGS = {
  subdir: "104履歷下載區/", // relative to Chrome download directory
  firstWait: 2800,
  nextWait: 800,
  waitDownload: false
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
  paused: false,
  stopRequested: false,
  currentIndex: 0,
  total: 0,
  progressText: "",
  lastMessage: "",
  settings: { ...DEFAULT_SETTINGS }
};

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

      if (msg?.cmd === "start") {
        if (!state.running) runExportLoop().catch(err => hardFail(err));
        return sendResponse({ ok: true });
      }

      if (msg?.cmd === "pause") {
        state.paused = true;
        badgeSet("||", "#f29900", "已暫停");
        return sendResponse({ ok: true });
      }

      if (msg?.cmd === "resume") {
        state.paused = false;
        // restore progress badge if running, else idle
        if (state.running && state.total > 0) {
          badgeRunning(state.currentIndex || 1, state.total, "繼續匯出");
        } else {
          badgeIdle("PDF");
        }
        return sendResponse({ ok: true });
      }

      if (msg?.cmd === "stop") {
        state.stopRequested = true;
        state.paused = false;
        badgeSet("STOP", PDF_BADGE.ERR_COLOR, "停止中…");
        return sendResponse({ ok: true });
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
 *  Core flow
 *  ========================= */
async function runExportLoop() {
  // Load settings fresh
  const { settings } = await chrome.storage.local.get("settings");
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  state.running = true;
  state.stopRequested = false;
  state.paused = false;
  state.currentIndex = 0;
  state.total = 0;
  state.lastMessage = "開始";

  badgeIdle("準備匯出 PDF…");

  const targets = await getTargetTabsInCurrentWindow();
  if (targets.length === 0) throw new Error("目前視窗沒有符合 104 履歷預覽的分頁。");

  state.total = targets.length;

  const report = { ok: 0, fail: 0, failures: [] };

  for (let i = 0; i < targets.length; i++) {
    await checkpoint();

    const tab = targets[i];
    if (!tab.id) continue;

    state.currentIndex = i + 1;
    state.progressText = `${state.currentIndex}/${state.total}`;
    badgeRunning(state.currentIndex, state.total, `匯出中：${state.currentIndex}/${state.total}`);

    try {
      await activateTab(tab.id);

      // Wait for render (first longer)
      await sleep(i === 0 ? state.settings.firstWait : state.settings.nextWait);

      await checkpoint();

      const name = await getCandidateName(tab.id);
      const safeName = sanitizeFilename(name || "未命名");
      const filenameOnly = `${safeName}_104邀約履歷.pdf`;

      // Apply optional subdir (relative)
      const subdir = (state.settings.subdir || "").trim();
      const filename = subdir ? normalizeSubdir(subdir) + filenameOnly : filenameOnly;

      // Print to PDF bytes
      const pdfBytes = await printTabToPDF(tab.id);

      await checkpoint();

      // Download (fast mode by default)
      const downloadId = await downloadPdfBytes(pdfBytes, filename, !!state.settings.waitDownload);

      state.lastMessage = `✅ ${state.currentIndex}/${state.total} 已送出下載：${filenameOnly} (id:${downloadId})`;
      report.ok++;
    } catch (e) {
      const err = e?.message || String(e);
      report.fail++;
      report.failures.push({ index: `${state.currentIndex}/${state.total}`, url: tab.url, error: err });
      state.lastMessage = `❌ ${state.currentIndex}/${state.total} 失敗：${err}`;
      // continue next
    }
  }

  state.running = false;

  if (state.stopRequested) {
    state.lastMessage = "已停止";
    badgeErrThenReset("已停止");
    return;
  }

  if (report.fail === 0) {
    badgeOkThenReset(`完成：成功 ${report.ok}/${state.total}`);
  } else {
    badgeErrThenReset(`完成：成功 ${report.ok}/${state.total}，失敗 ${report.fail}`);
  }

  console.group("📄 104 PDF Export Report");
  console.log("Success:", report.ok, "/", state.total);
  console.log("Failures:", report.failures);
  console.groupEnd();
}

async function checkpoint() {
  // stop
  if (state.stopRequested) {
    state.running = false;
    throw new Error("使用者已要求停止。");
  }
  // pause
  while (state.paused) {
    await sleep(200);
    if (state.stopRequested) {
      state.running = false;
      throw new Error("使用者已要求停止。");
    }
  }
}

/** =========================
 *  Tab discovery / activation
 *  ========================= */
async function getTargetTabsInCurrentWindow() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .filter(t => (t.url || "").startsWith(TARGET_URL_PREFIX))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

async function activateTab(tabId) {
  await chrome.tabs.update(tabId, { active: true });
}

/** =========================
 *  Page helpers
 *  ========================= */
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
async function downloadPdfBytes(uint8Array, filename, waitComplete) {
  const base64 = uint8ToBase64(uint8Array);
  const url = `data:application/pdf;base64,${base64}`;

  const downloadId = await chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });

  if (waitComplete) await waitForDownloadComplete(downloadId, 120000);
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
  state.paused = false;
  state.stopRequested = false;
  state.lastMessage = err?.message || String(err);
  badgeErrThenReset(state.lastMessage || "錯誤");
}