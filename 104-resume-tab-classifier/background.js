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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== CONFIG.messageType) {
    return false;
  }

  classifyTab(sender.tab, message.categoryId)
    .then(sendResponse)
    .catch((error) => {
      console.error("[104 履歷分頁分類器] 分類失敗", {
        message: error instanceof Error ? error.message : String(error),
      });

      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "分類時發生未知錯誤。",
      });
    });

  // 非同步回覆時必須保持訊息通道開啟。
  return true;
});

// 只供本機自動測試使用；Chrome service worker 環境不會進入這個分支。
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CONFIG,
    classifyTab,
    getGroupConfig,
  };
}
