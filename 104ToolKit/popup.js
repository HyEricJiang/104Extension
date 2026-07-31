const byId = (id) => document.getElementById(id);

const ui = {
  globalStatus: byId("globalStatus"),
  startWorkflow: byId("startWorkflow"),
  stopWorkflow: byId("stopWorkflow"),
  workflowPhase: byId("workflowPhase"),
  workflowProgress: byId("workflowProgress"),
  workflowBar: byId("workflowBar"),
  workflowMessage: byId("workflowMessage"),
  settingsStatus: byId("settingsStatus"),
  toggleCopyPanel: byId("toggleCopyPanel"),
  toggleExportPanel: byId("toggleExportPanel"),
  copyPanel: byId("copyPanel"),
  exportPanel: byId("exportPanel"),
  copyCurrent: byId("copyCurrent"),
  copyRight: byId("copyRight"),
  stopCopy: byId("stopCopy"),
  copyCount: byId("copyCount"),
  copyStatus: byId("copyStatus"),
  downloadCurrent: byId("downloadCurrent"),
  downloadRight: byId("downloadRight"),
  stopPdf: byId("stopPdf"),
  pdfProgress: byId("pdfProgress"),
  pdfStatus: byId("pdfStatus")
};

let groupInfo = { hasGroup: false, title: "" };
let workflowRunning = false;

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function errorText(error) {
  return String(error?.message || error || "未知錯誤");
}

function setGlobalStatus(text, kind = "idle") {
  ui.globalStatus.textContent = text;
  ui.globalStatus.className = `status-badge status-${kind}`;
}

function setExpandedPanel(panelId = null) {
  [
    { button: ui.toggleCopyPanel, panel: ui.copyPanel },
    { button: ui.toggleExportPanel, panel: ui.exportPanel }
  ].forEach(({ button, panel }) => {
    const expanded = panel.id === panelId;
    button.classList.toggle("is-expanded", expanded);
    button.setAttribute("aria-expanded", String(expanded));
    button.querySelector(".toggle-icon").textContent = expanded ? "−" : "＋";
    panel.hidden = !expanded;
  });
}

function togglePanel(panelId) {
  const target = byId(panelId);
  setExpandedPanel(target.hidden ? panelId : null);
}

function renderWorkflow(state = {}) {
  const running = Boolean(state.running);
  workflowRunning = running;
  const current = Number(state.current || 0);
  const total = Number(state.total || 2);
  const percent = total ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const phaseNames = {
    idle: "尚未開始",
    collecting: "正在複製資料",
    exporting: "正在匯出 PDF",
    done: "已完成",
    stopped: "已停止",
    error: "需要處理"
  };

  ui.workflowPhase.textContent = phaseNames[state.phase] || "處理中";
  ui.workflowProgress.textContent = `${current} / ${total}`;
  ui.workflowBar.style.width = `${percent}%`;
  ui.workflowMessage.textContent = state.error
    ? `${state.lastMessage || "工作流失敗"} ${state.error}`
    : (state.lastMessage || "從目前分頁開始，向右處理連續的 104 履歷分頁。");
  ui.startWorkflow.disabled = running;
  ui.startWorkflow.classList.toggle("is-hidden", running);
  ui.stopWorkflow.classList.toggle("is-hidden", !running);

}

function renderCopy(state = {}) {
  const running = Boolean(state.running);
  ui.copyCurrent.disabled = running || workflowRunning;
  ui.copyRight.disabled = running || workflowRunning;
  ui.stopCopy.disabled = !running || workflowRunning;
  ui.copyCount.textContent = `${state.count || 0} 筆`;
  const statusText = normalizeCopyStatus(state.lastStatusText);
  ui.copyStatus.textContent = running
    ? `收集中｜${state.current || 0}/${state.total || 0}\n${state.lastStatusText || ""}`
    : (statusText || "待命中");
}

function renderPdf(state = {}) {
  const running = Boolean(state.running);
  ui.downloadCurrent.disabled = running || workflowRunning;
  ui.downloadRight.disabled = running || workflowRunning;
  ui.stopPdf.disabled = !running || workflowRunning;
  ui.pdfProgress.textContent = state.progressText || "0 / 0";
  ui.pdfStatus.textContent = state.lastMessage || "待命中";
}

async function copyTextToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.info("[104 招募工作台] Popup 剪貼簿備援未執行", {
      reason: errorText(error)
    });
  }
}

function normalizeCopyStatus(text) {
  const value = String(text || "");
  if (!/Document is not focused|writeText.*Clipboard/i.test(value)) return value;
  const operation = value.includes("本頁")
    ? "本頁資料已整理完成"
    : "資料已整理完成";
  return `狀態：${operation}，可直接貼上使用`;
}

async function refreshStates() {
  try {
    const [workflow, copy, pdf] = await Promise.all([
      send({ type: "TOOLKIT_GET_WORKFLOW_STATE" }),
      send({ type: "GET_STATE" }),
      send({ cmd: "getStatus" })
    ]);
    const workflowState = workflow?.state || {};
    const copyState = copy?.state || {};
    const pdfState = pdf || {};
    if (workflow?.ok) renderWorkflow(workflowState);
    if (copy?.ok) renderCopy(copyState);
    if (pdf) renderPdf(pdfState);

    if (workflowState.running) setGlobalStatus("工作流執行中", "running");
    else if (copyState.running) setGlobalStatus("正在複製", "running");
    else if (pdfState.running) setGlobalStatus("正在匯出", "running");
    else if (workflowState.phase === "done") setGlobalStatus("已完成", "success");
    else if (workflowState.phase === "error") setGlobalStatus("需要處理", "error");
    else setGlobalStatus("待命", "idle");
  } catch (error) {
    setGlobalStatus("無法讀取狀態", "error");
  }
}

function buildPreviewFilename() {
  const mode = byId("prefixMode").value;
  const manualPrefix = byId("filenamePrefix").value.trim();
  const suffix = byId("filenameSuffix").value.trim();
  const prefix = mode === "tabGroup"
    ? (groupInfo.title || manualPrefix)
    : (mode === "manual" ? manualPrefix : "");
  byId("filenamePreview").textContent = [prefix, "王小明", suffix].filter(Boolean).join("_") + ".pdf";
  byId("groupHint").textContent = groupInfo.hasGroup
    ? `目前群組：${groupInfo.title}`
    : "目前分頁沒有群組；群組模式將改用手動前綴。";
}

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  byId("subdir").value = settings.subdir ?? "104履歷下載區/";
  byId("prefixMode").value = settings.filenamePrefixMode ?? "manual";
  byId("filenamePrefix").value = settings.filenamePrefix ?? "";
  byId("filenameSuffix").value = settings.filenameSuffix ?? "";
  byId("firstWait").value = settings.firstWait ?? 4000;
  byId("nextWait").value = settings.nextWait ?? 800;
  const result = await send({ cmd: "getCurrentTabGroupInfo" });
  groupInfo = result?.ok ? result : groupInfo;
  buildPreviewFilename();
}

async function saveSettings() {
  const settings = {
    subdir: byId("subdir").value.trim(),
    filenamePrefixMode: byId("prefixMode").value,
    filenamePrefix: byId("filenamePrefix").value.trim(),
    filenameSuffix: byId("filenameSuffix").value.trim(),
    firstWait: Math.max(0, Number(byId("firstWait").value || 0)),
    nextWait: Math.max(0, Number(byId("nextWait").value || 0))
  };
  await chrome.storage.local.set({ settings });
  await send({ cmd: "applySettings" });
  ui.settingsStatus.textContent = "已儲存";
  ui.settingsStatus.classList.add("status-success");
}

function markSettingsDirty() {
  ui.settingsStatus.textContent = "尚未儲存";
  ui.settingsStatus.classList.remove("status-success");
}

async function startCopy(type) {
  const response = await send({ type });
  if (!response?.ok) ui.copyStatus.textContent = `啟動失敗：${response?.error || "未知錯誤"}`;
  await refreshStates();
}

async function startPdf(cmd) {
  await saveSettings();
  const response = await send({ cmd });
  if (!response?.ok) ui.pdfStatus.textContent = `啟動失敗：${response?.error || "未知錯誤"}`;
  await refreshStates();
}

function bindActions() {
  ui.toggleCopyPanel.addEventListener("click", () => togglePanel("copyPanel"));
  ui.toggleExportPanel.addEventListener("click", () => togglePanel("exportPanel"));
  ui.startWorkflow.addEventListener("click", async () => {
    await saveSettings();
    const response = await send({ type: "TOOLKIT_START_COMBINED_RIGHT" });
    if (!response?.ok) {
      renderWorkflow({ phase: "error", error: response?.error || "無法啟動工作流。", total: 2 });
    }
    await refreshStates();
  });
  ui.stopWorkflow.addEventListener("click", () => send({ type: "TOOLKIT_STOP_WORKFLOW" }));
  ui.copyCurrent.addEventListener("click", () => startCopy("START_COPY_CURRENT"));
  ui.copyRight.addEventListener("click", () => startCopy("START_COLLECT_RIGHT"));
  ui.stopCopy.addEventListener("click", () => send({ type: "PAUSE_COLLECT" }));
  ui.downloadCurrent.addEventListener("click", () => startPdf("downloadCurrent"));
  ui.downloadRight.addEventListener("click", () => startPdf("downloadRight"));
  ui.stopPdf.addEventListener("click", () => send({ cmd: "stopBatch" }));
  byId("saveSettings").addEventListener("click", saveSettings);

  ["prefixMode", "filenamePrefix", "filenameSuffix"].forEach((id) => {
    byId(id).addEventListener("input", () => {
      buildPreviewFilename();
      markSettingsDirty();
    });
    byId(id).addEventListener("change", () => {
      buildPreviewFilename();
      markSettingsDirty();
    });
  });
  ["subdir", "firstWait", "nextWait"].forEach((id) => {
    byId(id).addEventListener("input", markSettingsDirty);
    byId(id).addEventListener("change", markSettingsDirty);
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "TOOLKIT_WORKFLOW_UPDATE") renderWorkflow(message.state);
  if (message?.type === "PROGRESS") refreshStates();
  if (message?.type === "DONE" || message?.type === "PAUSED") {
    copyTextToClipboard(message.text || "");
    refreshStates();
  }
  if (message?.type === "ERROR") refreshStates();
});

document.addEventListener("DOMContentLoaded", async () => {
  setExpandedPanel(null);
  bindActions();
  await loadSettings();
  await refreshStates();
  setInterval(refreshStates, 900);
});
