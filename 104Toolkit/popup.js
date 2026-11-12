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
  downloadCurrent: byId("downloadCurrent"),
  downloadRight: byId("downloadRight"),
  stopPdf: byId("stopPdf"),
  pdfProgress: byId("pdfProgress"),
  pdfStatus: byId("pdfStatus")
};

let legacySubdir = "";
let currentGroupTitle = "";
let canInviteCurrent = false;
let workflowRunning = false;
let jobsRunning = false;
let classificationBusy = false;
let canClassify = false;
let reasonServiceReady = false;
let hasTrainingLabel = false;
let currentTrainingLabel = "";
let canGroupJob = false;
let currentResumeKey = "";
let reasonWrite = Promise.resolve();
let reasonVersion = 0;
let settingsVersion = 0;
let settingsWrite = Promise.resolve(true);

function updateClassificationAvailability() {
  document.querySelectorAll(".classification-button").forEach(button => {
    button.disabled = classificationBusy || !canClassify;
  });
  byId("trainingReason").disabled = classificationBusy || !canClassify || !reasonServiceReady;
  byId("removeTrainingLabel").disabled = classificationBusy || !canClassify || !hasTrainingLabel;
  [ui.startWorkflow, byId("inviteRight"), ui.downloadCurrent, ui.downloadRight].forEach(button => {
    button.disabled = jobsRunning || classificationBusy;
  });
  byId("inviteCurrent").disabled = jobsRunning || classificationBusy || !canInviteCurrent;
  byId("jobGroupSelect").disabled = classificationBusy || jobsRunning || !canGroupJob;
  byId("addJobGroup").disabled = classificationBusy || jobsRunning || !canGroupJob || !byId("jobGroupSelect").value;
}

function selectMode(tab, tabs) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    byId(item.getAttribute("aria-controls")).hidden = !selected;
  }
}

async function refreshClassification() {
  const result = await sendClassification({ type: "TOOLKIT_GET_CLASSIFIER_STATE" });
  if (!result?.ok) throw new Error(result?.error || "無法讀取分類。");
  const popupVersion = chrome.runtime.getManifest().version;
  reasonServiceReady = result.capabilities?.trainingReason === true && result.serviceVersion === popupVersion;
  byId("toolkitVersion").textContent = `工作台 v${popupVersion}／背景 ${result.serviceVersion || "舊版（無版本資訊）"}`;
  byId("reasonStatus").textContent = reasonServiceReady ? "" : reasonServiceUpdateMessage();
  canClassify = result.canClassify;
  currentResumeKey = result.resumeKey || "";
  byId("trainingReason").value = result.reason || "";
  currentTrainingLabel = result.trainingLabel || "";
  hasTrainingLabel = Boolean(currentTrainingLabel);
  canGroupJob = result.canGroupJob;
  byId("jobCurrentGroup").textContent = result.groupTitle || "尚未分類";
  const select = byId("jobGroupSelect");
  if (select.options.length === 1) {
    (result.jobGroups || []).forEach(title => {
      const option = document.createElement("option");
      option.value = title;
      option.textContent = title;
      select.append(option);
    });
    const { lastJobGroup = "" } = await chrome.storage.local.get("lastJobGroup");
    const preferred = result.jobGroups?.includes(result.groupTitle) ? result.groupTitle : lastJobGroup;
    if (result.jobGroups?.includes(preferred)) select.value = preferred;
  }
  if (!canGroupJob) byId("jobGroupStatus").textContent = "請先切換到要加入職缺群組的網頁。";
  byId("classificationGroup").textContent = result.trainingLabel || "尚未標記";
  currentGroupTitle = result.groupTitle || "";
  canInviteCurrent = Boolean(result.jobGroups?.includes(currentGroupTitle) &&
    !ResumeTrainingLabels.isTrainingOnlyGroup(currentGroupTitle));
  const actions = byId("classificationActions");
  actions.querySelectorAll("button").forEach(button => {
    button.setAttribute("aria-pressed", String(button.textContent === result.trainingLabel));
  });
  if (!canClassify) byId("classificationStatus").textContent = "請先切換到 104 VIP 履歷頁再下標籤。";
  updateClassificationAvailability();
  buildPreviewFilename();
}

async function classifyCurrent(categoryId) {
  if (!(await ensureReasonSaved())) return;
  classificationBusy = true;
  updateClassificationAvailability();
  byId("classificationStatus").textContent = "正在保存此履歷的訓練分類…";
  try {
    const result = await sendClassification({ type: "CLASSIFY_CURRENT_TAB", categoryId });
    if (!result?.ok) throw new Error(result?.error || "分類失敗。");
    await refreshClassification();
    byId("classificationStatus").textContent = `已保存「${result.trainingLabel}」；職缺群組保持原設定。`;
  } catch (error) {
    byId("classificationStatus").textContent = `分類失敗：${errorText(error)}`;
  } finally {
    classificationBusy = false;
    updateClassificationAvailability();
  }
}

async function removeCurrentTrainingLabel() {
  if (classificationBusy || !canClassify || !hasTrainingLabel) return;
  if (!(await ensureReasonSaved())) return;
  classificationBusy = true;
  updateClassificationAvailability();
  byId("classificationStatus").textContent = "正在移除此履歷的訓練標籤…";
  try {
    const result = await sendClassification({ type: "TOOLKIT_REMOVE_TRAINING_LABEL" });
    if (!result?.ok) throw new Error(result?.error || "移除標籤失敗。");
    await refreshClassification();
    byId("reasonStatus").textContent = "標籤與原因已移除";
    byId("classificationStatus").textContent = "已移除標籤；此履歷恢復為尚未標記，職缺群組保持原設定。";
  } catch (error) {
    byId("classificationStatus").textContent = `移除失敗：${errorText(error)}`;
  } finally {
    classificationBusy = false;
    updateClassificationAvailability();
  }
}

async function addCurrentToJobGroup() {
  if (!(await ensureReasonSaved())) return;
  const groupTitle = byId("jobGroupSelect").value;
  if (!groupTitle || classificationBusy || jobsRunning) return;
  classificationBusy = true;
  updateClassificationAvailability();
  byId("jobGroupStatus").textContent = `正在加入「${groupTitle}」…`;
  try {
    const result = await sendClassification({ type: "TOOLKIT_GROUP_JOB_TAB", groupTitle });
    if (!result?.ok) throw new Error(result?.error || "加入群組失敗。");
    await refreshClassification();
    byId("jobGroupStatus").textContent = `已${result.created ? "建立並加入" : "加入"}「${result.groupTitle}」群組。`;
    byId("classificationStatus").textContent = "職缺群組已更新；此履歷的訓練分類保持原設定。";
    try { await chrome.storage.local.set({ lastJobGroup: groupTitle }); }
    catch (_) { /* 記住選項失敗不影響已完成的分組。 */ }
  } catch (error) {
    byId("jobGroupStatus").textContent = `加入失敗：${errorText(error)}`;
  } finally {
    classificationBusy = false;
    updateClassificationAvailability();
  }
}

// 每次請求使用獨立分類連線，並明確處理未載入、斷線與逾時。
function sendClassification(message) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "toolkit-classifier" });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("分類服務回覆逾時，請重新載入擴充功能後再試。")), 8000);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.disconnect();
      if (error) reject(error); else resolve(result);
    }
    port.onMessage.addListener(result => finish(null, result));
    port.onDisconnect.addListener(() => {
      const detail = chrome.runtime.lastError?.message;
      finish(new Error(detail ? `分類服務連線失敗：${detail}。請重新載入擴充功能。` : "分類服務未連線，請在 chrome://extensions 重新載入 104 招募工作台。"));
    });
    try { port.postMessage(message); } catch (error) { finish(error); }
  });
}

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

function renderWorkflow(state = {}) {
  const running = Boolean(state.running);
  workflowRunning = running;
  const current = Number(state.current || 0);
  const total = Number(state.total || 2);
  const percent = total ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const phaseNames = {
    idle: "尚未開始",
    collecting: "正在讀取履歷",
    sending: "正在登錄邀約",
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
  const link = byId("inviteSheetLink");
  link.hidden = !state.sheetUrl;
  if (state.sheetUrl) link.href = state.sheetUrl;
  else link.removeAttribute("href");
  byId("inviteRight").disabled = running || jobsRunning || classificationBusy;
  ui.startWorkflow.disabled = running || jobsRunning || classificationBusy;
  byId("inviteCurrent").disabled = running || jobsRunning || classificationBusy || !canInviteCurrent;
  ui.startWorkflow.classList.toggle("is-hidden", running);
  ui.stopWorkflow.classList.toggle("is-hidden", !running);

}

function renderPdf(state = {}) {
  const running = Boolean(state.running);
  ui.downloadCurrent.disabled = running || workflowRunning || jobsRunning || classificationBusy;
  ui.downloadRight.disabled = running || workflowRunning || jobsRunning || classificationBusy;
  ui.stopPdf.disabled = !running || workflowRunning || classificationBusy;
  ui.pdfProgress.textContent = state.progressText || "0 / 0";
  ui.pdfStatus.textContent = state.lastMessage || "待命中";
}

async function refreshStates() {
  try {
    const [workflow, pdf] = await Promise.all([
      send({ type: "TOOLKIT_GET_WORKFLOW_STATE" }),
      send({ cmd: "getStatus" })
    ]);
    const workflowState = workflow?.state || {};
    const pdfState = pdf || {};
    jobsRunning = Boolean(workflowState.running || pdfState.running);
    updateClassificationAvailability();
    if (workflow?.ok) renderWorkflow(workflowState);
    if (pdf) renderPdf(pdfState);

    if (workflowState.running) setGlobalStatus("工作流執行中", "running");
    else if (pdfState.running) setGlobalStatus("正在匯出", "running");
    else if (workflowState.phase === "done") setGlobalStatus("已完成", "success");
    else if (workflowState.phase === "error") setGlobalStatus("需要處理", "error");
    else setGlobalStatus("待命", "idle");
  } catch (error) {
    setGlobalStatus("無法讀取狀態", "error");
  }
}

function selectedInvitationSuffix() {
  return ResumeTrainingLabels.normalizeInvitationSuffix(byId("invitationSuffix").querySelector("input:checked")?.value);
}

function buildPreviewFilename() {
  const labels = ResumeTrainingLabels;
  const trainingOnly = labels.isTrainingOnlyGroup(currentGroupTitle);
  const annotation = labels.exportAnnotation(currentGroupTitle, { label: currentTrainingLabel });
  const trainingFilename = labels.trainingFilename("王小明", annotation);
  const mode = selectedInvitationSuffix();
  const custom = labels.customSuffix(byId("customInvitationSuffix").value);
  byId("customInvitationSuffixField").hidden = mode !== "other";
  byId("filenamePreview").hidden = trainingOnly;
  byId("filenamePreview").textContent = trainingOnly ? "" : mode === "other" && !custom
    ? "請輸入自訂後綴"
    : labels.invitationFilename("王小明", currentGroupTitle, mode, custom);
  byId("trainingFilenamePreview").hidden = !trainingFilename;
  byId("trainingFilenamePreview").textContent = trainingFilename || "";
  byId("groupHint").textContent = trainingOnly
    ? "「不合適」只匯出 AI 訓練版，略過邀約登錄。"
    : "";
}

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  legacySubdir = settings.subdir ?? "104履歷下載區/";
  byId("firstWait").value = settings.firstWait ?? 4000;
  byId("nextWait").value = settings.nextWait ?? 800;
  const mode = ResumeTrainingLabels.normalizeInvitationSuffix(settings.invitationSuffix);
  byId("invitationSuffix").querySelector(`input[value="${mode}"]`).checked = true;
  byId("customInvitationSuffix").value = settings.customInvitationSuffix ?? "";
  buildPreviewFilename();
  const output = await RecruitingOutputDirectory.status();
  byId("outputLocation").textContent = output.selected ? output.name : (legacySubdir ? `瀏覽器下載位置／${legacySubdir}` : output.name);
}

function markSettingsDirty(status = ui.settingsStatus) {
  const version = ++settingsVersion;
  const showProgress = status === ui.settingsStatus;
  status.textContent = showProgress ? "儲存中…" : "";
  status.classList.remove("status-success");
  const settings = {
    subdir: legacySubdir,
    firstWait: Math.max(0, Number(byId("firstWait").value || 0)),
    nextWait: Math.max(0, Number(byId("nextWait").value || 0)),
    invitationSuffix: selectedInvitationSuffix(),
    customInvitationSuffix: byId("customInvitationSuffix").value
  };
  settingsWrite = settingsWrite.then(async () => {
    await chrome.storage.local.set({ settings });
    await send({ cmd: "applySettings" });
    if (version === settingsVersion && showProgress) {
      status.textContent = "已自動儲存";
      status.classList.add("status-success");
    }
    return true;
  }).catch(error => {
    if (version === settingsVersion) status.textContent = `儲存失敗：${errorText(error)}，請重新調整後重試。`;
    return false;
  });
}

async function openWriter() {
  const status = byId("writerStatus");
  try {
    const result = await send({ type: "TOOLKIT_GET_WRITER_URL" });
    if (!result?.url) throw new Error("無法取得公司登錄網址。");
    await chrome.tabs.create({ url: result.url });
  } catch (error) {
    status.textContent = errorText(error);
  }
}
function reasonServiceUpdateMessage() {
  return "背景服務版本不相容，暫停原因編輯。請完整更新原安裝資料夾的 104Toolkit 檔案，在 chrome://extensions 重新載入「104 招募工作台」，再關閉並重開工作台；仍有問題時請重新啟動 Chrome。請勿移除擴充功能，以免遺失既有標籤。";
}

async function ensureReasonSaved() {
  // 寫入失敗時保留文字，避免刷新標籤覆蓋草稿或匯出缺少原因的 PDF。
  if ((await reasonWrite) !== false) return true;
  const message = "原因尚未儲存，請先保留輸入文字並處理下標籤頁的錯誤，再重試。";
  byId("classificationStatus").textContent = message;
  ui.pdfStatus.textContent = message;
  ui.workflowMessage.textContent = message;
  return false;
}

function saveCurrentReason() {
  if (!reasonServiceReady) {
    byId("reasonStatus").textContent = reasonServiceUpdateMessage();
    return;
  }
  const version = ++reasonVersion;
  const reason = byId("trainingReason").value;
  byId("reasonStatus").textContent = "儲存中…";
  buildPreviewFilename();
  // 每次輸入即送至背景保存，不以計時器延後，避免關閉 popup 遺失尚未送出的內容。
  reasonWrite = sendClassification({ type: "TOOLKIT_SAVE_TRAINING_REASON", resumeKey: currentResumeKey, reason }).then(result => {
    if (!result?.ok) {
      // 舊背景仍能下標籤，但不認識儲存原因的訊息；直接說明更新方式。
      if (result?.code === "UNSUPPORTED_CLASSIFIER_OPERATION" || /不支援這個分類操作/.test(result?.error || "")) {
        reasonServiceReady = false;
        updateClassificationAvailability();
        throw new Error(reasonServiceUpdateMessage());
      }
      throw new Error(result?.error || "原因儲存失敗。");
    }
    if (version === reasonVersion) byId("reasonStatus").textContent = reason.trim() ? "原因已自動儲存" : "原因已清空";
    return true;
  }).catch(error => {
    if (version === reasonVersion) byId("reasonStatus").textContent = `儲存失敗：${errorText(error)}`;
    return false;
  });
}

async function startPdf(cmd) {
  if (!(await ensureReasonSaved())) return;
  try {
    await ensurePdfSettingsSaved();
    const response = await send({ cmd });
    if (!response?.ok) throw new Error(response?.error || "無法開始匯出。");
    await refreshStates();
  } catch (error) {
    ui.pdfStatus.textContent = errorText(error);
  }
}

async function startInvitation(type) {
  if (!(await ensureReasonSaved())) return;
  try {
    if (type === "TOOLKIT_START_COMBINED_RIGHT") await ensurePdfSettingsSaved();
    const response = await send({ type });
    if (!response?.ok) throw new Error(response?.error || "無法啟動登錄。");
    await refreshStates();
  } catch (error) {
    ui.workflowMessage.textContent = errorText(error);
  }
}

async function ensurePdfSettingsSaved() {
  if (selectedInvitationSuffix() === "other" && !ResumeTrainingLabels.customSuffix(byId("customInvitationSuffix").value)) {
    byId("customInvitationSuffix").focus();
    throw new Error("請輸入自訂的 PDF 檔名後綴。");
  }
  if (!(await settingsWrite)) throw new Error("PDF 設定尚未儲存，請重新選擇後重試。");
}

function bindActions() {
  byId("inviteCurrent").addEventListener("click", () => startInvitation("TOOLKIT_START_INVITE_CURRENT"));
  byId("inviteRight").addEventListener("click", () => startInvitation("TOOLKIT_START_INVITE_RIGHT"));
  byId("chooseOutputDirectory").addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.create({ url: chrome.runtime.getURL("directory.html") + `?returnTab=${tab?.id || ""}` });
    } catch (error) { byId("outputLocation").textContent = `無法開啟資料夾設定：${errorText(error)}`; }
  });
  byId("removeTrainingLabel").addEventListener("click", removeCurrentTrainingLabel);
  byId("jobGroupSelect").addEventListener("change", updateClassificationAvailability);
  byId("addJobGroup").addEventListener("click", addCurrentToJobGroup);
  document.querySelectorAll(".classification-button").forEach(button => {
    button.addEventListener("click", () => classifyCurrent(button.dataset.category));
  });
  const tabs = [...document.querySelectorAll(".mode-tab")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectMode(tab, tabs));
    tab.addEventListener("keydown", event => {
      const nextIndex = {
        ArrowUp: (index - 1 + tabs.length) % tabs.length,
        ArrowDown: (index + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1
      }[event.key];
      if (nextIndex === undefined) return;
      event.preventDefault();
      const next = tabs[nextIndex];
      selectMode(next, tabs);
      next.focus();
    });
  });
  ui.startWorkflow.addEventListener("click", () => startInvitation("TOOLKIT_START_COMBINED_RIGHT"));
  ui.stopWorkflow.addEventListener("click", () => send({ type: "TOOLKIT_STOP_WORKFLOW" }));
  ui.downloadCurrent.addEventListener("click", () => startPdf("downloadCurrent"));
  ui.downloadRight.addEventListener("click", () => startPdf("downloadRight"));
  ui.stopPdf.addEventListener("click", () => send({ cmd: "stopBatch" }));
  byId("trainingReason").addEventListener("input", event => { if (!event.isComposing) saveCurrentReason(); });
  byId("trainingReason").addEventListener("compositionend", saveCurrentReason);
  const updateSuffix = () => {
    buildPreviewFilename();
    markSettingsDirty(byId("invitationSuffixStatus"));
  };
  byId("invitationSuffix").addEventListener("change", updateSuffix);
  byId("customInvitationSuffix").addEventListener("input", event => { if (!event.isComposing) updateSuffix(); });
  byId("customInvitationSuffix").addEventListener("compositionend", updateSuffix);
  byId("openWriter").addEventListener("click", openWriter);

  ["firstWait", "nextWait"].forEach((id) => {
    byId(id).addEventListener("input", () => markSettingsDirty());
    byId(id).addEventListener("change", () => markSettingsDirty());
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "TOOLKIT_WORKFLOW_UPDATE") renderWorkflow(message.state);

});

document.addEventListener("DOMContentLoaded", async () => {
  bindActions();
  await refreshStates();
  try {
    await loadSettings();
    await refreshClassification();
    if (canClassify) byId("classificationStatus").textContent = "選擇分類即可保存此履歷的訓練標記。";
    if (canGroupJob) byId("jobGroupStatus").textContent = "先加入職缺群組，再登錄邀約。";
  } catch (error) {
    byId("classificationStatus").textContent = `初始化失敗：${errorText(error)}`;
    byId("jobGroupStatus").textContent = `初始化失敗：${errorText(error)}`;
    updateClassificationAvailability();
  }
  setInterval(refreshStates, 900);
});
