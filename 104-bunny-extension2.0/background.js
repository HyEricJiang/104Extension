const STORE_KEY = "bunny_rows";
const STATE_KEY = "bunny_state";

/** =========================
 *  Badge 狀態機
 *  ========================= */
const BADGE = {
  IDLE_TEXT: "COPY",
  IDLE_COLOR: "#1a73e8",

  RUNNING_COLOR: "#1a73e8",

  OK_TEXT: "OK",
  OK_COLOR: "#34a853",

  ERR_TEXT: "ERR",
  ERR_COLOR: "#d93025",

  PAUSE_TEXT: "PAUSE",
  PAUSE_COLOR: "#b26b00",

  RESET_AFTER_MS: 4500
};

const runtimeState = {
  running: false,
  stopRequested: false,
  mode: null,
  current: 0,
  total: 0,
  count: 0,
  lastStatusText: "狀態：待命"
};

function logInfo(...args) {
  console.log("[104-bunny]", ...args);
}

function logError(...args) {
  console.error("[104-bunny]", ...args);
}

function setBadge(text, color, title) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
  if (title) chrome.action.setTitle({ title });
}

function setIdle(title = "COPY") {
  setBadge(BADGE.IDLE_TEXT, BADGE.IDLE_COLOR, title);
}

function progressBadgeText(current, total) {
  const t = `${current}/${total}`;
  return t.length <= 4 ? t : String(current);
}

function setRunningProgress(current, total, title) {
  setBadge(progressBadgeText(current, total), BADGE.RUNNING_COLOR, title || `收集中：${current}/${total}`);
}

function setOkThenReset(title = "完成") {
  setBadge(BADGE.OK_TEXT, BADGE.OK_COLOR, title);
  setTimeout(() => {
    if (!runtimeState.running) setIdle("COPY");
  }, BADGE.RESET_AFTER_MS);
}

function setErrThenReset(title = "錯誤") {
  setBadge(BADGE.ERR_TEXT, BADGE.ERR_COLOR, title);
  setTimeout(() => {
    if (!runtimeState.running) setIdle("COPY");
  }, BADGE.RESET_AFTER_MS);
}

function setPauseThenReset(title = "已暫停") {
  setBadge(BADGE.PAUSE_TEXT, BADGE.PAUSE_COLOR, title);
  setTimeout(() => {
    if (!runtimeState.running) setIdle("COPY");
  }, BADGE.RESET_AFTER_MS);
}

async function persistState() {
  await chrome.storage.local.set({
    [STATE_KEY]: {
      running: runtimeState.running,
      stopRequested: runtimeState.stopRequested,
      mode: runtimeState.mode,
      current: runtimeState.current,
      total: runtimeState.total,
      count: runtimeState.count,
      lastStatusText: runtimeState.lastStatusText
    }
  });
}

async function updateRuntimeState(patch) {
  Object.assign(runtimeState, patch);
  await persistState();
}

async function resetRows() {
  await chrome.storage.local.set({ [STORE_KEY]: [] });
  await updateRuntimeState({ count: 0 });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getRows() {
  const obj = await chrome.storage.local.get([STORE_KEY]);
  return obj[STORE_KEY] || [];
}

async function setRows(rows) {
  await chrome.storage.local.set({ [STORE_KEY]: rows });
  await updateRuntimeState({ count: rows.length });
}

function getResumeCodeFromLine(line) {
  const parts = String(line || "").split("\t");
  return parts[3] || "";
}

function toTSVText(rows) {
  return rows.join("\n");
}

async function addLineDedup(line) {
  const resumeCode = getResumeCodeFromLine(line);
  const rows = await getRows();
  const exists = resumeCode && rows.some((r) => getResumeCodeFromLine(r) === resumeCode);

  if (!exists) {
    rows.push(line);
    await setRows(rows);
    logInfo("新增一筆資料", { resumeCode, count: rows.length });
    return { added: true, count: rows.length, rows };
  }

  logInfo("略過重複履歷代碼", { resumeCode, count: rows.length });
  return { added: false, count: rows.length, rows };
}

async function sendToPopup(msg) {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch (_) {}
}

async function writeClipboardFromTab(tabId, text) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (value) => {
        try {
          await navigator.clipboard.writeText(value);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error?.message || error) };
        }
      },
      args: [text]
    });

    return result || { ok: false, error: "clipboard write failed" };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function collectFromTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });

  const [{ result: data }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      if (typeof window.__bunnyExtractOne !== "function") {
        throw new Error("__bunnyExtractOne not found");
      }
      return await window.__bunnyExtractOne();
    }
  });

  return data;
}

async function activateTab(tabId) {
  await chrome.tabs.update(tabId, { active: true });
  await sleep(350);
}

function is104Url(url) {
  return typeof url === "string" && url.startsWith("https://vip.104.com.tw/");
}

async function sendProgress(message) {
  const rows = await getRows();
  await updateRuntimeState({
    lastStatusText: `狀態：${message}\n暫存：${rows.length} 筆`
  });
  await sendToPopup({
    type: "PROGRESS",
    message,
    current: runtimeState.current,
    total: runtimeState.total,
    count: rows.length
  });
}

async function completeRun(finalTabId, message, doneType = "DONE") {
  const rows = await getRows();
  const text = toTSVText(rows);

  let clipboardResult = { ok: false, error: "沒有可複製資料" };
  if (rows.length && finalTabId) {
    clipboardResult = await writeClipboardFromTab(finalTabId, text);
  }

  const finalMessage = clipboardResult.ok
    ? `${message}，已自動複製到剪貼簿`
    : `${message}，但自動複製失敗：${clipboardResult.error || "unknown error"}`;

  await updateRuntimeState({
    running: false,
    stopRequested: false,
    mode: null,
    current: runtimeState.current,
    total: runtimeState.total,
    count: rows.length,
    lastStatusText: `狀態：${finalMessage}\n總筆數：${rows.length}`
  });

  if (doneType === "PAUSED") {
    setPauseThenReset(finalMessage);
  } else {
    setOkThenReset(finalMessage);
  }

  await sendToPopup({
    type: doneType,
    count: rows.length,
    message: finalMessage,
    text
  });

  logInfo(doneType === "PAUSED" ? "流程已暫停" : "流程已完成", {
    rows: rows.length,
    clipboard: clipboardResult
  });
}

async function buildTargets(mode) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error("找不到目前作用中的分頁");
  }
  if (!is104Url(activeTab.url)) {
    throw new Error("目前分頁不是 104 VIP 頁面");
  }

  if (mode === "current") {
    return [activeTab];
  }

  const allTabs = await chrome.tabs.query({ currentWindow: true });
  return allTabs
    .filter((t) => t.index >= activeTab.index && is104Url(t.url))
    .sort((a, b) => a.index - b.index);
}

async function startCollection(mode) {
  if (runtimeState.running) {
    throw new Error("目前已有收集流程在執行中");
  }

  const targets = await buildTargets(mode);
  if (!targets.length) {
    throw new Error(mode === "current" ? "本頁不是可收集頁面" : "右側找不到任何 104 VIP 分頁");
  }

  await resetRows();
  await updateRuntimeState({
    running: true,
    stopRequested: false,
    mode,
    current: 0,
    total: targets.length,
    count: 0,
    lastStatusText: "狀態：收集準備中"
  });

  let lastProcessedTabId = targets[0]?.id || null;
  logInfo("開始收集", { mode, total: targets.length });

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (!target?.id) continue;

    lastProcessedTabId = target.id;

    if (runtimeState.stopRequested) {
      await completeRun(lastProcessedTabId, "已依指示暫停後續收集", "PAUSED");
      return;
    }

    await updateRuntimeState({ current: i + 1 });
    setRunningProgress(i + 1, targets.length, `收集中：${i + 1}/${targets.length}`);
    await sendProgress(`正在處理第 ${i + 1}/${targets.length} 頁`);
    await activateTab(target.id);

    try {
      const data = await collectFromTab(target.id);
      if (data?.ok && data?.line) {
        const addResult = await addLineDedup(data.line);
        await sendProgress(`已完成第 ${i + 1}/${targets.length} 頁`);
        await updateRuntimeState({ count: addResult.count });
      } else {
        const reason = data?.error || "本頁無法取得資料";
        logInfo("本頁未取得資料", { tabId: target.id, reason });
        await sendProgress(`第 ${i + 1}/${targets.length} 頁略過：${reason}`);
      }
    } catch (error) {
      const reason = String(error?.message || error);
      logError("收集分頁失敗", { tabId: target.id, reason });
      await sendProgress(`第 ${i + 1}/${targets.length} 頁失敗：${reason}`);
    }

    await sleep(450);
  }

  await completeRun(lastProcessedTabId, mode === "current" ? "本頁資料已整理完成" : "全部分頁資料已整理完成");
}

chrome.runtime.onInstalled.addListener(async () => {
  setIdle("COPY");
  await chrome.storage.local.set({
    [STORE_KEY]: [],
    [STATE_KEY]: {
      running: false,
      stopRequested: false,
      mode: null,
      current: 0,
      total: 0,
      count: 0,
      lastStatusText: "狀態：待命"
    }
  });
});

(async () => {
  setIdle("COPY");
  const obj = await chrome.storage.local.get([STATE_KEY]);
  Object.assign(runtimeState, obj[STATE_KEY] || {});
})();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "INIT_BADGE_COPY") {
      setIdle("COPY");
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "GET_STATE") {
      const rows = await getRows();
      await updateRuntimeState({ count: rows.length });
      sendResponse({
        ok: true,
        state: {
          ...runtimeState,
          count: rows.length
        }
      });
      return;
    }

    if (msg?.type === "PAUSE_COLLECT") {
      if (!runtimeState.running) {
        sendResponse({ ok: false, error: "目前沒有正在執行的流程" });
        return;
      }
      await updateRuntimeState({
        stopRequested: true,
        lastStatusText: "狀態：已送出暫停指令，等待目前頁完成"
      });
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "START_COPY_CURRENT" || msg?.type === "START_COLLECT_RIGHT") {
      try {
        const mode = msg.type === "START_COPY_CURRENT" ? "current" : "right";

        /**
         * 重要修正：
         * 不能在 onMessage 內 await 整個收集流程，否則 popup 端的 sendMessage
         * 會一直卡住，表面上看起來像「永遠在處理中」，也會影響後續按鈕操作。
         *
         * 這裡改成：
         * 1. 先快速回應 popup「已成功啟動」
         * 2. 背景執行真正的收集流程
         *
         * 這樣 popup 能正常接收後續 PROGRESS / DONE / PAUSED 訊息。
         */
        sendResponse({ ok: true });

        startCollection(mode).catch(async (error) => {
          const errMsg = String(error?.message || error);
          logError("啟動流程失敗", errMsg);
          await updateRuntimeState({
            running: false,
            stopRequested: false,
            mode: null,
            lastStatusText: `狀態：發生錯誤
${errMsg}`
          });
          await sendToPopup({ type: "ERROR", error: errMsg });
          setErrThenReset(`錯誤：${errMsg}`);
        });
      } catch (error) {
        const errMsg = String(error?.message || error);
        logError("啟動流程失敗", errMsg);
        await updateRuntimeState({
          running: false,
          stopRequested: false,
          mode: null,
          lastStatusText: `狀態：發生錯誤
${errMsg}`
        });
        await sendToPopup({ type: "ERROR", error: errMsg });
        setErrThenReset(`錯誤：${errMsg}`);
        sendResponse({ ok: false, error: errMsg });
      }
      return;
    }

    sendResponse({ ok: false, error: "unknown message" });
  })();

  return true;
});
