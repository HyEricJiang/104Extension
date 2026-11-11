(() => {
  const CONCURRENCY = 4;
  const RETRY_DELAYS_MS = [1000, 2500, 5000];
  let running = false;
  let stopRequested = false;

  async function collectFromTab(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["collector-content.js"]
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => window.__bunnyExtractOne()
    });
    return result;
  }

  async function readContact(tabId) {
    try {
      return await collectFromTab(tabId);
    } catch (_) {
      return { ok: false, error: "無法讀取履歷分頁" };
    }
  }

  async function collectWithRetry(tabId) {
    let result = await readContact(tabId);
    for (const delay of RETRY_DELAYS_MS) {
      if (result?.ok || stopRequested) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      if (stopRequested) break;
      result = await readContact(tabId);
    }
    return result;
  }

  async function startCollection(targets, onContact) {
    if (running) throw new Error("目前正在讀取履歷資料。");
    running = true;
    stopRequested = false;
    try {
      for (let i = 0; i < targets.length && !stopRequested; i += CONCURRENCY) {
        const chunk = targets.slice(i, i + CONCURRENCY);
        const results = await Promise.all(chunk.map(tab => collectWithRetry(tab.id)));
        for (const [index, result] of results.entries()) {
          onContact(chunk[index], result?.ok ? result.line : undefined, result?.error);
        }
      }
    } finally {
      running = false;
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.remove(["bunny_rows", "bunny_state"]).catch(() => {});
  });

  globalThis.RecruitingCollector = Object.freeze({
    startCollection,
    getState: () => ({ running, stopRequested }),
    pause: () => { stopRequested = true; }
  });
})();
