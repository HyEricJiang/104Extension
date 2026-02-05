const STORE_KEY = "bunny_rows";

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
  // line = name \t email \t phone \t resumeCode
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
  // Send to any open popup (best-effort)
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {}
}

async function collectFromTab(tabId) {
  // Inject content extractor into that tab
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });

  // content.js registers a global function; then execute it
  const [{ result: data }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      // @ts-ignore
      if (typeof window.__bunnyExtractOne !== "function") {
        throw new Error("__bunnyExtractOne not found");
      }
      // @ts-ignore
      return await window.__bunnyExtractOne();
    }
  });

  return data; // { ok, line, resumeCode, error? }
}

async function activateTab(tabId) {
  await chrome.tabs.update(tabId, { active: true });
  // give page a bit time to become active
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

  // Only tabs to the right (including current)
  const targets = allTabs
    .filter(t => t.index >= startIndex && is104Url(t.url))
    .sort((a, b) => a.index - b.index);

  if (!targets.length) {
    await sendToPopup({ type: "ERROR", error: "右側找不到任何 104 VIP 分頁" });
    return;
  }

  let total = targets.length;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.id) continue;

    await activateTab(t.id);

    await sendToPopup({
      type: "PROGRESS",
      message: `處理分頁：${t.title || t.url || ""}`,
      current: i + 1,
      total,
      count: (await getRows()).length
    });

    let data;
    try {
      data = await collectFromTab(t.id);
    } catch (e) {
      await sendToPopup({
        type: "PROGRESS",
        message: `跳過（腳本執行失敗）：${t.title || ""}`,
        current: i + 1,
        total,
        count: (await getRows()).length
      });
      continue;
    }

    if (data?.ok && data?.line) {
      const r = await addLineDedup(data.line);
      await sendToPopup({
        type: "PROGRESS",
        message: r.added ? `已收集 ✅ ${data.resumeCode || ""}` : `已存在略過 ↩ ${data.resumeCode || ""}`,
        current: i + 1,
        total,
        count: r.count
      });
    } else {
      await sendToPopup({
        type: "PROGRESS",
        message: `抓取失敗：${data?.error || "unknown"}`,
        current: i + 1,
        total,
        count: (await getRows()).length
      });
    }

    // small delay between tabs
    await sleep(450);
  }

  const rows = await getRows();
  await sendToPopup({ type: "DONE", count: rows.length });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "START_COLLECT_RIGHT") {
      try {
        await startCollectRight();
        sendResponse({ ok: true });
      } catch (e) {
        await sendToPopup({ type: "ERROR", error: String(e?.message || e) });
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
      return;
    }

    sendResponse({ ok: false, error: "unknown message" });
  })();

  return true;
});