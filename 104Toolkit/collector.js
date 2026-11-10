(() => {
  const CONCURRENCY = 4;
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

  async function startCollection(targets, onContact) {
    if (running) throw new Error("目前正在讀取履歷資料。");
    running = true;
    stopRequested = false;
    try {
      for (let i = 0; i < targets.length && !stopRequested; i += CONCURRENCY) {
        const chunk = targets.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(chunk.map(tab => collectFromTab(tab.id)));
        for (const [index, result] of results.entries()) {
          const data = result.status === "fulfilled" ? result.value : null;
          onContact(chunk[index], data?.ok ? data.line : undefined);
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
