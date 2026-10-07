(() => {
/**
 * 104 履歷分頁分類器：背景服務
 *
 * 此檔案只負責 Chrome 分頁群組操作，不讀取或保存履歷內容。
 */

const CONFIG = Object.freeze({
  messageType: "CLASSIFY_CURRENT_TAB",
  groups: Object.freeze({
    recommendedUnsuitable: Object.freeze({ title: "推薦但不合適", color: "yellow" }),
    reviewedSuitable: Object.freeze({ title: "人工審核但合適", color: "blue" }),
    excludedRecommended: Object.freeze({ title: "排除但推薦", color: "purple" }),
  }),
});

// 同一視窗的快速連點依序執行，避免同名群組被重複建立。
const windowQueues = new Map();

function enqueueForWindow(windowId, task) {
  const previousTask = windowQueues.get(windowId) ?? Promise.resolve();
  const nextTask = previousTask.catch(() => undefined).then(task);

  windowQueues.set(windowId, nextTask);
  const cleanup = () => {
    if (windowQueues.get(windowId) === nextTask) {
      windowQueues.delete(windowId);
    }
  };
  nextTask.then(cleanup, cleanup);

  return nextTask;
}

function getGroupConfig(categoryId) {
  if (typeof categoryId !== "string") {
    throw new Error("分類代碼格式不正確。");
  }

  const groupConfig = CONFIG.groups[categoryId];
  if (!Object.prototype.hasOwnProperty.call(CONFIG.groups, categoryId)) {
    throw new Error("不支援這個分類選項。");
  }

  return groupConfig;
}

async function findGroupByExactTitle(windowId, title) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((group) => group.title === title) ?? null;
}

async function classifyTab(tab, categoryId) {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
    throw new Error("無法取得目前分頁資訊。");
  }

  const groupConfig = getGroupConfig(categoryId);

  return enqueueForWindow(tab.windowId, async () => {
    const existingGroup = await findGroupByExactTitle(
      tab.windowId,
      groupConfig.title,
    );

    let groupId;
    let created = false;

    if (existingGroup) {
      groupId = existingGroup.id;
      await chrome.tabs.group({
        groupId,
        tabIds: tab.id,
      });
    } else {
      groupId = await chrome.tabs.group({
        createProperties: { windowId: tab.windowId },
        tabIds: tab.id,
      });
      created = true;
    }

    // 每次都校正名稱與顏色，避免使用者手動改名後造成分類混淆。
    await chrome.tabGroups.update(groupId, {
      title: groupConfig.title,
      color: groupConfig.color,
      collapsed: false,
    });

    console.info("[104 履歷分頁分類器] 分類完成", {
      category: groupConfig.title,
      created,
    });

    return {
      ok: true,
      groupTitle: groupConfig.title,
      created,
    };
  });
}

// Popup 沒有 sender.tab，因此在背景服務取得當前作用中分頁。
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function isResumeTab(tab) {
  try {
    const url = new URL(tab?.url);
    return url.origin === "https://vip.104.com.tw" && [
      "/search/searchresumemaster", "/resumetools/resumepreview",
      "/document/master", "/apply/applyresume"
    ].includes(url.pathname.toLowerCase());
  } catch (_) { return false; }
}
async function handleMessage(message) {
  const tab = await getCurrentTab();
  if (message.type === "TOOLKIT_GET_CLASSIFIER_STATE") {
    const group = tab?.groupId >= 0 ? await chrome.tabGroups.get(tab.groupId) : null;
    return { ok: true, canClassify: isResumeTab(tab), groupTitle: group?.title || "", categories: CONFIG.groups };
  }
  if (!isResumeTab(tab)) throw new Error("請先切換到 104 VIP 履歷頁再下標籤。");
  // 分組會改變分頁順序；複製或匯出中禁止分類，以維持批次範圍。
  const collector = await globalThis.RecruitingCollector.getState();
  const pdf = globalThis.RecruitingPdfExporter.getState();
  if (collector.running || pdf.running || globalThis.RecruitingWorkflow.getState().running) throw new Error("請等待目前複製或匯出完成，再下標籤。");
  return classifyTab(tab, message.categoryId);
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!["CLASSIFY_CURRENT_TAB", "TOOLKIT_GET_CLASSIFIER_STATE"].includes(message?.type)) return false;
  handleMessage(message).then(sendResponse).catch((error) => {
    console.error("[104 招募工作台] 分類操作失敗", { message: error.message });
    sendResponse({ ok: false, error: error.message || "分類失敗，請重試。" });
  });
  return true;
});

// 分類使用專用連線，避免共用訊息管道取得其他模組的回覆。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "toolkit-classifier") return;
  port.onMessage.addListener((message) => {
    if (!["CLASSIFY_CURRENT_TAB", "TOOLKIT_GET_CLASSIFIER_STATE"].includes(message?.type)) {
      port.postMessage({ ok: false, error: "不支援這個分類操作。" });
      return;
    }
    handleMessage(message).then((result) => {
      try { port.postMessage(result); } catch (_) { /* Popup 已關閉。 */ }
    }).catch((error) => {
      console.error("[104 招募工作台] 分類連線操作失敗", { message: error.message });
      try { port.postMessage({ ok: false, error: error.message || "分類失敗，請重試。" }); } catch (_) { /* Popup 已關閉。 */ }
    });
  });
});

// 只供本機自動測試使用；Chrome service worker 環境不會進入這個分支。
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CONFIG,
    classifyTab,
    getGroupConfig,
    handleMessage,
    isResumeTab,
  };
}

})();
