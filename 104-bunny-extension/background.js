const STORE_KEY = "bunny_rows";

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

  RESET_AFTER_MS: 4500
};

let badgeState = {
  running: false,
  current: 0,
  total: 0,
  lastTitle: "COPY"
};

function setBadge(text, color, title) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
  if (title) chrome.action.setTitle({ title });
  if (title) badgeState.lastTitle = title;
}

function setIdle(title = "COPY") {
  badgeState.running = false;
  setBadge(BADGE.IDLE_TEXT, BADGE.IDLE_COLOR, title);
}

function progressBadgeText(current, total) {
  const t = `${current}/${total}`;
  return t.length <= 4 ? t : String(current);
}

function setRunningProgress(current, total, title) {
  badgeState.running = true;
  badgeState.current = current;
  badgeState.total = total;
  setBadge(progressBadgeText(current, total), BADGE.RUNNING_COLOR, title || `收集中：${current}/${total}`);
}

function setOkThenReset(title = "完成") {
  badgeState.running = false;
  setBadge(BADGE.OK_TEXT, BADGE.OK_COLOR, title);
  setTimeout(() => {
    if (!badgeState.running) setIdle("COPY");
  }, BADGE.RESET_AFTER_MS);
}

function setErrThenReset(title = "錯誤") {
  badgeState.running = false;
  setBadge(BADGE.ERR_TEXT, BADGE.ERR_COLOR, title);
  setTimeout(() => {
    if (!badgeState.running) setIdle("COPY");
  }, BADGE.RESET_AFTER_MS);
}

// ⬅️ 重要：確保 service worker 啟動 / 重載時就是 COPY
chrome.runtime.onInstalled.addListener(() => setIdle("COPY"));
setIdle("COPY");

/** =========================
 *  原本的邏輯（未改動核心流程）
 *  ========================= */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getRows() {
  const obj = await chrome.storage.local.get([STORE_KEY]);
  return obj[STORE_KEY] || [];
}

async function setRows(rows) {
  await chrome.storage.local.set({ [STORE_KEY]: rows });
}

function getResumeCodeFromLine(line) {
  const parts = String(line || "").split("\t");
  return parts[3] || "";
}

async function addLineDedup(line) {
  const resumeCode = getResumeCodeFromLine(line);
  let rows = await getRows();

  const exists = resumeCode && rows.some((r) => getResumeCodeFromLine(r) === resumeCode);
  if (!exists) {
    rows.push(line);
    await setRows(rows);
    return { added: true, count: rows.length };
  }
  return { added: false, count: rows.length };
}

async function sendToPopup(msg) {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {}
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

async function startCollectRight() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) throw new Error("No active tab");

  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const startIndex = activeTab.index;

  const targets = allTabs
    .filter(t => t.index >= startIndex && is104Url(t.url))
    .sort((a, b) => a.index - b.index);

  if (!targets.length) {
    await sendToPopup({ type: "ERROR", error: "右側找不到任何 104 VIP 分頁" });
    setErrThenReset("右側找不到 104 分頁");
    return;
  }

  const total = targets.length;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.id) continue;

    setRunningProgress(i + 1, total, `收集中：${i + 1}/${total}`);
    await activateTab(t.id);

    let data;
    try {
      data = await collectFromTab(t.id);
    } catch (e) {
      continue;
    }

    if (data?.ok && data?.line) {
      await addLineDedup(data.line);
    }

    await sleep(450);
  }

  const rows = await getRows();
  await sendToPopup({ type: "DONE", count: rows.length });
  setOkThenReset(`完成：共收集 ${rows.length} 筆`);
}

/** =========================
 *  Message router
 *  ========================= */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {

    // ✅ popup 打開時，強制顯示 COPY
    if (msg?.type === "INIT_BADGE_COPY") {
      setIdle("COPY");
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "START_COLLECT_RIGHT") {
      try {
        setIdle("COPY");
        await startCollectRight();
        sendResponse({ ok: true });
      } catch (e) {
        const errMsg = String(e?.message || e);
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