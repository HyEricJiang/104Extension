// 104 VIP Resume PDF Exporter - MV3
// 功能摘要：
// 1. 支援目前分頁單份匯出
// 2. 支援從目前分頁往右批次匯出
// 3. 支援檔名前綴模式：手動 / 分頁群組 / 不使用前綴
// 4. 支援自訂檔名後綴
// 5. 支援批次安全終止
// 6. 支援較完整的狀態同步

const PREVIEW_URL_PREFIX = "https://vip.104.com.tw/ResumeTools/resumePreview";
const NAME_SELECTOR =
  "#app > div.container.page-container.container-3 > section > div > section > div > div.vip-resume-card.resume-block.resume-card.size-medium > div.resume-card-item.resume-card__center > div > h2 > p";

const DEFAULT_SETTINGS = {
  subdir: "104履歷下載區/",
  firstWait: 4000,
  nextWait: 800,
  filenamePrefixMode: "manual",
  filenamePrefix: "",
  filenameSuffix: ""
};

const PDF_PRINT_OPTIONS = { printBackground: true, preferCSSPageSize: true };

const PDF_BADGE = {
  IDLE_TEXT: "PDF",
  IDLE_COLOR: "#4f8cff",
  RUNNING_COLOR: "#4f8cff",
  STOPPING_COLOR: "#f59e0b",
  OK_TEXT: "OK",
  OK_COLOR: "#22c55e",
  ERR_TEXT: "ERR",
  ERR_COLOR: "#ef4444",
  RESET_AFTER_MS: 4500
};

let pdfBadgeState = {
  running: false,
  current: 0,
  total: 0,
  lastTitle: "PDF"
};

let state = {
  running: false,
  stopRequested: false,
  currentIndex: 0,
  total: 0,
  progressText: "0/0",
  lastMessage: "",
  settings: { ...DEFAULT_SETTINGS }
};

function logInfo(message, data = null) {
  if (data !== null) console.log(`[104 PDF Exporter] ${message}`, data);
  else console.log(`[104 PDF Exporter] ${message}`);
}

function logError(message, error = null) {
  if (error) console.error(`[104 PDF Exporter] ${message}`, error);
  else console.error(`[104 PDF Exporter] ${message}`);
}

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
  const text = `${current}/${total}`;
  return text.length <= 4 ? text : String(current);
}

function badgeRunning(current, total, title) {
  pdfBadgeState.running = true;
  pdfBadgeState.current = current;
  pdfBadgeState.total = total;
  badgeSet(
    badgeProgressText(current, total),
    state.stopRequested ? PDF_BADGE.STOPPING_COLOR : PDF_BADGE.RUNNING_COLOR,
    title || `匯出中：${current}/${total}`
  );
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

chrome.runtime.onInstalled.addListener(async () => {
  await syncSettingsFromStorage();
  badgeIdle("PDF");
});

badgeIdle("PDF");

async function syncSettingsFromStorage() {
  const { settings } = await chrome.storage.local.get("settings");
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  
  // 安全加速：確保首份暖機夠久 (4000ms)，但把後續每份的死等時間砍掉 1.2 秒
  if (state.settings.nextWait >= 2000) state.settings.nextWait = 800;
  
  return state.settings;
}

function resetRunState() {
  state.running = false;
  state.stopRequested = false;
  state.currentIndex = 0;
  state.total = 0;
  state.progressText = "0/0";
}

function updateProgress(index, total, message = "") {
  state.currentIndex = index;
  state.total = total;
  state.progressText = `${index}/${total}`;
  if (message) state.lastMessage = message;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.cmd === "getStatus") return sendResponse({ ...state });
      if (msg?.cmd === "applySettings") {
        await syncSettingsFromStorage();
        if (!state.running) badgeIdle("PDF");
        return sendResponse({ ok: true });
      }
      if (msg?.cmd === "getCurrentTabGroupInfo") {
        const info = await getActiveTabGroupInfo();
        return sendResponse({ ok: true, ...info });
      }
      if (msg?.cmd === "stopBatch") {
        if (!state.running) return sendResponse({ ok: false, error: "目前沒有執行中的批次可停止。" });
        state.stopRequested = true;
        state.lastMessage = "已收到停止請求，會在目前這份完成後停止。";
        badgeRunning(state.currentIndex || 0, state.total || 0, "停止請求中");
        return sendResponse({ ok: true });
      }
      if (msg?.cmd === "downloadCurrent") {
        if (state.running) return sendResponse({ ok: false, error: "目前正在匯出中，請先等待。" });
        runDownloadCurrent().catch((error) => hardFail(error));
        return sendResponse({ ok: true });
      }
      if (msg?.cmd === "downloadRight") {
        if (state.running) return sendResponse({ ok: false, error: "目前正在匯出中，請先等待。" });
        runDownloadRightBatch().catch((error) => hardFail(error));
        return sendResponse({ ok: true });
      }
      if (msg?.cmd === "initBadgePDF") {
        badgeIdle("PDF");
        return sendResponse({ ok: true });
      }
      sendResponse({ ok: false, error: "unknown cmd" });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

async function runDownloadCurrent() {
  const active = await getActiveTab();
  const currentUrl = active?.url || "";
  let info = parseResumeInfoFromUrl(currentUrl);

  if ((!info || (!info.idno && !info.snapshotId)) && is104ApplyResumePage(currentUrl)) {
    const resolved = await findFirstResumeUrlInTab(active?.id);
    if (resolved) info = parseResumeInfoFromUrl(resolved);
  }

  if (!info || (!info.idno && !info.snapshotId)) {
    throw new Error("目前分頁不是可辨識的 104 履歷/應徵頁，或缺少必要參數。");
  }

  const item = {
    ...info,
    sourceTabId: active?.id || null,
    sourceTabGroupTitle: await getTabGroupTitleByTab(active)
  };

  await runIdnoExportJob([item], "下載目前履歷");
}

async function runDownloadRightBatch() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = tabs.find((tab) => tab.active);
  if (!active) throw new Error("找不到目前分頁（active tab）。");

  const sorted = [...tabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const startIdx = sorted.findIndex((tab) => tab.id === active.id);
  if (startIdx < 0) throw new Error("無法定位目前分頁位置。");

  const items = [];
  const seen = new Set();

  for (let i = startIdx; i < sorted.length; i++) {
    const tab = sorted[i];
    const url = tab.url || "";
    const isCandidate = is104ResumePage(url) || is104ApplyResumePage(url);
    if (!isCandidate) break;

    let info = parseResumeInfoFromUrl(url);
    if ((!info || (!info.idno && !info.snapshotId)) && is104ApplyResumePage(url)) {
      const resolved = await findFirstResumeUrlInTab(tab?.id);
      if (resolved) info = parseResumeInfoFromUrl(resolved);
    }

    if (!info || (!info.idno && !info.snapshotId)) break;

    const keyMode = info.mode || "";
    const keyValue = info.snapshotId ? `sn:${info.snapshotId}` : `idno:${info.idno}`;
    const key = `${keyMode}|${keyValue}|${info.ec || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      ...info,
      sourceTabId: tab?.id || null,
      sourceTabGroupTitle: await getTabGroupTitleByTab(tab)
    });
  }

  if (items.length === 0) throw new Error("往右沒有找到可下載的 104 履歷頁。");
  await runIdnoExportJob(items, `往右批次下載（${items.length} 份）`);
}

async function runIdnoExportJob(items, jobTitle) {
  await syncSettingsFromStorage();

  state.running = true;
  state.stopRequested = false;
  state.currentIndex = 0;
  state.total = items.length;
  state.progressText = `0/${items.length}`;
  state.lastMessage = `開始：${jobTitle}`;
  badgeIdle(`準備：${jobTitle}`);

  const report = { ok: 0, fail: 0, stopped: false, failures: [] };

  for (let i = 0; i < items.length; i++) {
    if (state.stopRequested) {
      report.stopped = true;
      state.lastMessage = `已停止：共完成 ${report.ok} 份，後續 ${items.length - i} 份未執行。`;
      break;
    }

    const info = items[i];
    const idno = info?.idno || "";
    const snapshotId = info?.snapshotId || "";
    let previewTabId = null;

    updateProgress(i + 1, items.length, `開始處理第 ${i + 1}/${items.length} 份`);
    badgeRunning(state.currentIndex, state.total, `${jobTitle}：${state.currentIndex}/${state.total}`);

    try {
      const url = buildPreviewUrl(info);
      
      // 🌟 核心要求 1：安靜的背景分頁 (絕不跳出新視窗干擾)
      const tab = await chrome.tabs.create({ url, active: false });
      previewTabId = tab.id;

      // 🌟 核心要求 2：提早掛載 Debugger，強迫 Chrome 把背景分頁當作前景處理 (破解藍圈圈凍結)
      const debuggee = { tabId: previewTabId };
      await chrome.debugger.attach(debuggee, "1.3");
      try {
        await chrome.debugger.sendCommand(debuggee, "Page.enable");
        await chrome.debugger.sendCommand(debuggee, "Runtime.enable");
        // 最強的防休眠指令：強迫模擬成 Focus 和 Active 狀態
        await chrome.debugger.sendCommand(debuggee, "Emulation.setFocusEmulationEnabled", { enabled: true });
        await chrome.debugger.sendCommand(debuggee, "Emulation.setWebLifecycleState", { state: "active" });
      } catch (e) {
        console.warn("Emulation override failed", e);
      }

      await waitTabComplete(previewTabId, 45000);

      // 🌟 關鍵修復：第一份履歷載入時，104 網站需要較長時間初始化底層框架與建立連線。
      // 先強制給予一段緩衝時間 (首份 4秒 / 後續 2秒)，等它穩定了再來做後續的嚴格檢查與刪除。
      await sleep(i === 0 ? state.settings.firstWait : state.settings.nextWait);

      // 🌟 核心要求 3：極度嚴格的防藍圈圈守門員
      const checkResult = await chrome.scripting.executeScript({
        target: { tabId: previewTabId },
        func: async (selector) => {
          return new Promise((resolve) => {
            let attempts = 0;
            const checkInterval = setInterval(() => {
              attempts++;
              const el = document.querySelector(selector);
              const hasName = el && el.textContent.trim().length > 0;
              
              // 檢查是否有 104 的載入中動畫 (只要圈圈還在，就絕對不印)
              const loadingMask = document.querySelector('.el-loading-mask:not([style*="display: none"])');
              const hasSpinner = loadingMask !== null;
              
              const hasContent = document.body.innerText && document.body.innerText.length > 200;
              
              if (hasName && hasContent && !hasSpinner) {
                clearInterval(checkInterval);
                resolve({ success: true });
              } else if (attempts > 150) { // 等待上限 30 秒
                clearInterval(checkInterval);
                resolve({ success: false, reason: "履歷內容逾時未載入" });
              }
            }, 200);
          });
        },
        args: [NAME_SELECTOR]
      });

      if (!checkResult[0].result.success) {
        // 如果 40 秒後還是藍圈圈，直接報錯，寧可失敗也【拒絕印出藍圈圈檔案】
        throw new Error("❌ 攔截到藍色圈圈！Chrome 網路可能暫時阻塞，已放棄此份下載以防印出白畫面，請重試。");
      }

      // 確保排版完成，縮短為 0.6 秒彈性緩衝 (榨出速度)
      await sleep(600);

      // 🌟 終極殺手鐧：暴力移除藍色圈圈 + 強制觸發圖片載入
      try {
        await chrome.scripting.executeScript({
          target: { tabId: previewTabId },
          func: () => {
            // 1. 注入絕對隱藏的 CSS，封殺所有 Loading 動畫
            const style = document.createElement('style');
            style.textContent = `
              .el-loading-mask, .el-loading-spinner, .circular {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
              }
              /* 停止所有動畫，防止背景分頁凍結導致動畫卡在畫面上 */
              * {
                transition: none !important;
                animation: none !important;
              }
            `;
            document.head.appendChild(style);

            // 2. 直接把 Loading DOM 節點連根拔起
            document.querySelectorAll('.el-loading-mask, .el-loading-spinner').forEach(el => el.remove());

            // 3. 捲動到底部再捲回，觸發網頁的 Lazy Loading
            window.scrollTo(0, document.body.scrollHeight);
            setTimeout(() => window.scrollTo(0, 0), 200);
            
            // 4. 強制將所有圖片設為立即載入
            document.querySelectorAll('img').forEach(img => {
              img.loading = 'eager';
              if (img.dataset.src) img.src = img.dataset.src;
              if (img.dataset.vSrc) img.src = img.dataset.vSrc;
              if (img.getAttribute('data-original')) img.src = img.getAttribute('data-original');
            });
          }
        });
        // 額外等待 0.8 秒讓圖片有時間下載，並讓 DOM 確實套用隱藏設定
        await sleep(800);
      } catch (err) {}

      const name = await getCandidateName(previewTabId);
      // 🌟 終極防線：如果抓不到名字，代表畫面有問題 (例如已被關閉或權限不足的白畫面)，直接中斷！
      if (!name || name.trim() === "") {
        throw new Error("無法取得候選人姓名 (履歷畫面可能空白或發生異常)，已自動攔截並取消輸出 PDF。");
      }
      const safeName = sanitizeFilename(name);

      const prefix = await resolveFilenamePrefix(info);
      const suffix = sanitizeFilename(String(state.settings.filenameSuffix || "").trim());
      const filenameOnly = buildFilename(prefix, safeName, suffix);
      const subdir = (state.settings.subdir || "").trim();
      const filename = subdir ? normalizeSubdir(subdir) + filenameOnly : filenameOnly;

      // 執行列印 (因為 Debugger 已經掛載，直接發送列印指令)
      const { data } = await chrome.debugger.sendCommand(debuggee, "Page.printToPDF", PDF_PRINT_OPTIONS);
      if (!data) throw new Error("printToPDF 沒有回傳資料。");
      
      const pdfBytes = base64ToUint8Array(data);
      const downloadId = await downloadPdfBytes(pdfBytes, filename);

      state.lastMessage = `✅ ${state.currentIndex}/${state.total} 已完成：${filenameOnly}`;
      report.ok++;
    } catch (error) {
      const errMessage = error?.message || String(error);
      report.fail++;
      report.failures.push({
        index: `${state.currentIndex}/${state.total}`,
        idno,
        snapshotId,
        ec: info?.ec || "",
        error: errMessage
      });
      state.lastMessage = errMessage;
      logError("匯出失敗。", { error: errMessage });
    } finally {
      if (previewTabId) {
        try { await chrome.debugger.detach({ tabId: previewTabId }); } catch (_) {}
        try { await chrome.tabs.remove(previewTabId); } catch (_) {}
      }
    }
  }

  state.running = false;
  state.stopRequested = false;

  if (report.stopped) {
    if (report.fail === 0) badgeOkThenReset(`已停止：成功 ${report.ok}/${items.length}`);
    else badgeErrThenReset(`已停止：成功 ${report.ok}/${items.length}，失敗 ${report.fail}`);
  } else if (report.fail === 0) {
    state.lastMessage = `完成：成功 ${report.ok}/${items.length}`;
    badgeOkThenReset(`完成：成功 ${report.ok}/${items.length}`);
  } else {
    state.lastMessage = `完成：成功 ${report.ok}/${items.length}，失敗 ${report.fail}`;
    badgeErrThenReset(`完成：成功 ${report.ok}/${items.length}，失敗 ${report.fail}`);
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true, active: true });
  return tabs?.[0] || null;
}

async function getActiveTabGroupInfo() {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) return { hasGroup: false, title: "", groupId: -1, hint: "找不到目前分頁。" };
  const title = await getTabGroupTitleByTab(activeTab);
  return {
    hasGroup: Boolean(title),
    title: title || "",
    groupId: activeTab.groupId ?? -1,
    hint: title ? "已抓到群組名稱。" : "目前分頁沒有群組，會改用手動前綴。"
  };
}

async function getTabGroupTitleByTab(tab) {
  try {
    if (!tab || typeof tab.groupId !== "number" || tab.groupId < 0) return "";
    const group = await chrome.tabGroups.get(tab.groupId);
    return sanitizeFilename(String(group?.title || "").trim());
  } catch (_) { return ""; }
}

async function resolveFilenamePrefix(info) {
  const mode = String(state.settings.filenamePrefixMode || "manual").trim();
  const manualPrefix = sanitizeFilename(String(state.settings.filenamePrefix || "").trim());
  const groupPrefix = sanitizeFilename(String(info?.sourceTabGroupTitle || "").trim());
  if (mode === "tabGroup") return groupPrefix || manualPrefix;
  if (mode === "none") return "";
  return manualPrefix;
}

function is104ResumePage(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== "vip.104.com.tw") return false;
    const p = (u.pathname || "").toLowerCase();
    return p === "/resumetools/resumepreview" || p === "/search/searchresumemaster" || p === "/document/master";
  } catch (_) { return false; }
}

function is104ApplyResumePage(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== "vip.104.com.tw") return false;
    return (u.pathname || "").toLowerCase() === "/apply/applyresume";
  } catch (_) { return false; }
}

async function findFirstResumeUrlInTab(tabId) {
  if (!tabId) return "";
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const urls = [];
        document.querySelectorAll("a[href]").forEach((a) => { try { urls.push(a.href); } catch (_) {} });
        document.querySelectorAll("[data-href],[data-url]").forEach((el) => {
          const value = el.getAttribute("data-href") || el.getAttribute("data-url") || "";
          if (!value) return;
          try { urls.push(new URL(value, location.href).toString()); } catch (_) {}
        });
        const re = /https:\/\/vip\.104\.com\.tw\/(resumetools\/resumepreview|search\/searchresumemaster|document\/master)/i;
        return urls.find((u) => re.test(u)) || "";
      }
    });
    return results?.[0]?.result || "";
  } catch (_) { return ""; }
}

function parseResumeInfoFromUrl(url) {
  try {
    const u = new URL(url);
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

function buildPreviewUrl(info) {
  const u = new URL(PREVIEW_URL_PREFIX);
  if (info?.mode === "apply") {
    u.searchParams.set("ec", String(info.ec || ""));
    u.searchParams.set("pageSource", "apply");
    u.searchParams.set("searchEngineIdNos", "");
    u.searchParams.set("snapshotIds", String(info.snapshotId || ""));
    return u.toString();
  }
  if (info?.mode === "document") {
    if (info?.ec) u.searchParams.set("ec", String(info.ec));
    u.searchParams.set("pageSource", "document");
    u.searchParams.set("searchEngineIdNos", "");
    u.searchParams.set("snapshotIds", String(info.snapshotId || ""));
    return u.toString();
  }
  u.searchParams.set("pageSource", "search");
  u.searchParams.set("searchEngineIdNos", String(info?.idno || ""));
  return u.toString();
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("等待頁面載入逾時"));
    }, timeoutMs);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") { cleanup(); resolve(); }
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId !== tabId) return;
      cleanup();
      reject(new Error("等待頁面載入時分頁已關閉"));
    };
    async function immediateCheck() {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.status === "complete") { cleanup(); resolve(); }
      } catch (_) { cleanup(); reject(new Error("等待頁面載入時分頁已關閉")); }
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

async function getCandidateName(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selector) => {
      const el = document.querySelector(selector);
      return el ? (el.textContent || "").trim() : "";
    },
    args: [NAME_SELECTOR]
  });
  return results?.[0]?.result || "";
}

function sanitizeFilename(name) {
  return String(name || "").replace(/[\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
}

function buildFilename(prefix, name, suffix) {
  const parts = [];
  if (prefix) parts.push(prefix);
  if (name) parts.push(name);
  if (suffix) parts.push(suffix);
  const base = parts.filter(Boolean).join("_") || "resume";
  return `${base}.pdf`;
}

function normalizeSubdir(subdir) {
  let value = String(subdir || "").replace(/^\/+/, "");
  if (value && !value.endsWith("/")) value += "/";
  return value;
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function downloadPdfBytes(uint8Array, filename) {
  const base64 = uint8ToBase64(uint8Array);
  const url = `data:application/pdf;base64,${base64}`;
  const downloadId = await chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
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
      if (Date.now() - start > timeoutMs) { cleanup(); reject(new Error("下載逾時")); }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
