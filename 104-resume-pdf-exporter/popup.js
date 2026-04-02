async function send(cmd, payload = {}) {
  return chrome.runtime.sendMessage({ cmd, ...payload });
}

function $(id) {
  return document.getElementById(id);
}

function buildPreviewFilename(prefixMode, manualPrefix, tabGroupTitle, suffix) {
  const sampleName = "王小明";
  const safeManualPrefix = String(manualPrefix || "").trim();
  const safeGroup = String(tabGroupTitle || "").trim();
  const safeSuffix = String(suffix || "").trim();

  let finalPrefix = "";
  if (prefixMode === "tabGroup") {
    finalPrefix = safeGroup || safeManualPrefix;
  } else if (prefixMode === "manual") {
    finalPrefix = safeManualPrefix;
  }

  const parts = [];
  if (finalPrefix) parts.push(finalPrefix);
  parts.push(sampleName);
  if (safeSuffix) parts.push(safeSuffix);

  return `${parts.join("_") || "resume"}.pdf`;
}

async function getCurrentGroupInfo() {
  try {
    const result = await send("getCurrentTabGroupInfo");
    if (!result?.ok) {
      return { hasGroup: false, title: "", hint: result?.error || "目前無法讀取分頁群組。" };
    }
    return result;
  } catch (error) {
    return { hasGroup: false, title: "", hint: error?.message || String(error) };
  }
}

function applyGroupInfoToUi(groupInfo) {
  const hasGroup = Boolean(groupInfo?.hasGroup);
  $("groupName").textContent = hasGroup ? groupInfo.title : "目前分頁沒有群組";
  $("groupHint").textContent = hasGroup
    ? "偵測到群組名稱，選擇「使用目前分頁群組名稱」時會自動帶入。"
    : "偵測不到群組時，群組模式會自動退回你輸入的手動前綴。";
}

function updateFilenamePreview(groupInfo = null) {
  const prefixMode = $("prefixMode").value;
  const manualPrefix = $("filenamePrefix").value;
  const suffix = $("filenameSuffix").value;
  const tabGroupTitle = groupInfo?.title || $("groupName").dataset.groupTitle || "";

  $("filenamePreview").textContent = buildPreviewFilename(prefixMode, manualPrefix, tabGroupTitle, suffix);
}

function setRunningUi(status) {
  const isRunning = Boolean(status?.running);
  const isStopping = Boolean(status?.stopRequested);

  $("downloadCurrent").disabled = isRunning;
  $("downloadRight").disabled = isRunning;
  $("stopBatch").disabled = !isRunning;

  $("runningLabel").textContent = isStopping ? "停止請求中" : (isRunning ? "批次執行中" : "待命中");
  $("progressLabel").textContent = status?.progressText || "0/0";
  $("currentInfo").textContent = `目前：${status?.currentIndex || 0} / ${status?.total || 0}`;

  const chip = $("statusChip");
  chip.className = "status-chip";
  if (isStopping) {
    chip.classList.add("stopping");
    chip.textContent = "停止請求中";
  } else if (isRunning) {
    chip.classList.add("running");
    chip.textContent = "執行中";
  } else {
    chip.classList.add("idle");
    chip.textContent = "閒置中";
  }
}

async function saveSettingsSilently() {
  const subdir = $("subdir").value || "";
  const filenamePrefixMode = $("prefixMode").value || "manual";
  const filenamePrefix = $("filenamePrefix").value || "";
  const filenameSuffix = $("filenameSuffix").value || "";
  const firstWait = Number($("firstWait").value || 0);
  const nextWait = Number($("nextWait").value || 0);

  await chrome.storage.local.set({
    settings: {
      subdir,
      filenamePrefixMode,
      filenamePrefix,
      filenameSuffix,
      firstWait,
      nextWait
    }
  });

  await send("applySettings");
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {};
  $("subdir").value = s.subdir ?? "104履歷下載區/";
  $("prefixMode").value = s.filenamePrefixMode ?? "manual";
  $("filenamePrefix").value = s.filenamePrefix ?? "";
  $("filenameSuffix").value = s.filenameSuffix ?? "";
  $("firstWait").value = s.firstWait ?? 2800;
  $("nextWait").value = s.nextWait ?? 800;
}

async function refreshStatus() {
  const st = await send("getStatus");
  setRunningUi(st);

  const lines = [
    `執行中：${st.running ? "是" : "否"}`,
    `停止請求：${st.stopRequested ? "是" : "否"}`,
    `進度：${st.progressText || "0/0"}`,
    `目前索引：${st.currentIndex || 0}/${st.total || 0}`,
    `最後訊息：${st.lastMessage || "尚無紀錄"}`
  ];

  $("status").textContent = lines.join("\n");
}

async function refreshGroupInfoAndPreview() {
  const groupInfo = await getCurrentGroupInfo();
  $("groupName").dataset.groupTitle = groupInfo?.title || "";
  applyGroupInfoToUi(groupInfo);
  updateFilenamePreview(groupInfo);
}

async function handleDownloadCurrent() {
  await saveSettingsSilently();
  const result = await send("downloadCurrent");
  if (!result?.ok && result?.error) {
    $("status").textContent = `啟動失敗：${result.error}`;
  }
  await refreshStatus();
}

async function handleDownloadRight() {
  await saveSettingsSilently();
  const result = await send("downloadRight");
  if (!result?.ok && result?.error) {
    $("status").textContent = `啟動失敗：${result.error}`;
  }
  await refreshStatus();
}

async function handleStopBatch() {
  const result = await send("stopBatch");
  if (!result?.ok && result?.error) {
    $("status").textContent = `停止失敗：${result.error}`;
  }
  await refreshStatus();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await refreshGroupInfoAndPreview();
  await refreshStatus();

  ["prefixMode", "filenamePrefix", "filenameSuffix"].forEach((id) => {
    $(id).addEventListener("input", () => updateFilenamePreview());
    $(id).addEventListener("change", () => updateFilenamePreview());
  });

  $("save").addEventListener("click", async () => {
    await saveSettingsSilently();
    await refreshGroupInfoAndPreview();
    await refreshStatus();
  });

  $("downloadCurrent").addEventListener("click", handleDownloadCurrent);
  $("downloadRight").addEventListener("click", handleDownloadRight);
  $("stopBatch").addEventListener("click", handleStopBatch);

  setInterval(async () => {
    await refreshStatus();
  }, 700);

  setInterval(async () => {
    await refreshGroupInfoAndPreview();
  }, 2500);
});
