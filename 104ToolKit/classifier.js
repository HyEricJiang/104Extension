(() => {
/**
 * 104 履歷分頁分類器：背景服務
 *
 * 此檔案協調獨立訓練標記與職缺群組；標記不會移動分頁。
 */

const CONFIG = Object.freeze({
  messageType: "CLASSIFY_CURRENT_TAB",
  jobGroups: Object.freeze(["Jr.Net PG", "Sr.Net PG", "Jr.Java PG", "Sr.Java PG", "Jr.QA", "Sr.QA", "SA", "PM"]),
  groups: Object.freeze(Object.fromEntries(Object.entries(globalThis.ResumeTrainingLabels.CATEGORIES).map(([id, title]) => [id, Object.freeze({ title })]))),
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
  getGroupConfig(categoryId);
  const info = await getResumeInfo(tab);
  if (!info) throw new Error("無法辨識這份履歷，請開啟完整履歷頁再標記。");
  const record = await globalThis.ResumeTrainingLabels.save(info, categoryId);
  return { ok: true, trainingLabel: record.label };
}
async function getResumeInfo(tab) {
  if (!isResumeTab(tab)) return null;
  let info = globalThis.ResumeTrainingLabels.parseResumeInfoFromUrl(tab.url);
  if (!info && new URL(tab.url).pathname.toLowerCase() === "/apply/applyresume") {
    const url = await globalThis.RecruitingPdfExporter.findFirstResumeUrlInTab(tab.id);
    info = globalThis.ResumeTrainingLabels.parseResumeInfoFromUrl(url);
  }
  return info;
}

async function moveTabToGroup(tab, groupConfig, preserveAppearance = false) {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
    throw new Error("無法取得目前分頁資訊。");
  }

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

    // 分類群組校正名稱與顏色；既有職缺群組保留使用者設定的外觀。
    if (!preserveAppearance || created) await chrome.tabGroups.update(groupId, {
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
  if (message.type === "TOOLKIT_DOWNLOAD_TRAINING_REPORT") return globalThis.ResumeTrainingLabels.downloadLastReport();
  const tab = await getCurrentTab();
  if (message.type === "TOOLKIT_GET_CLASSIFIER_STATE") {
    const group = tab?.groupId >= 0 ? await chrome.tabGroups.get(tab.groupId) : null;
    const info = await getResumeInfo(tab);
    const record = info ? await globalThis.ResumeTrainingLabels.read(info) : null;
    return { ok: true, trainingLabel: record?.label || "", canClassify: Boolean(info), groupTitle: group?.title || "", categories: CONFIG.groups, jobGroups: CONFIG.jobGroups, canGroupJob: isWebTab(tab) };
  }
  if (message.type === "TOOLKIT_GROUP_JOB_TAB") {
    if (!isWebTab(tab)) throw new Error("請先切換到要加入職缺群組的網頁。");
    if (!CONFIG.jobGroups.includes(message.groupTitle)) throw new Error("請選擇有效的職缺群組。");
    await ensureGroupingIdle();
    return moveTabToGroup(tab, { title: message.groupTitle, color: "grey" }, true);
  }
  if (!isResumeTab(tab)) throw new Error("請先切換到 104 VIP 履歷頁再下標籤。");
  return classifyTab(tab, message.categoryId);
}

function isWebTab(tab) {
  try { return ["https:", "http:"].includes(new URL(tab?.url).protocol); }
  catch (_) { return false; }
}
async function ensureGroupingIdle() {
  // 分組會改變分頁順序；複製或匯出中禁止移動，以維持批次範圍。
  const collector = await globalThis.RecruitingCollector.getState();
  const pdf = globalThis.RecruitingPdfExporter.getState();
  if (collector.running || pdf.running || globalThis.RecruitingWorkflow.getState().running) {
    throw new Error("請等待目前複製或匯出完成，再加入群組。");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!["CLASSIFY_CURRENT_TAB", "TOOLKIT_GET_CLASSIFIER_STATE", "TOOLKIT_GROUP_JOB_TAB", "TOOLKIT_DOWNLOAD_TRAINING_REPORT"].includes(message?.type)) return false;
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
    if (!["CLASSIFY_CURRENT_TAB", "TOOLKIT_GET_CLASSIFIER_STATE", "TOOLKIT_GROUP_JOB_TAB", "TOOLKIT_DOWNLOAD_TRAINING_REPORT"].includes(message?.type)) {
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
