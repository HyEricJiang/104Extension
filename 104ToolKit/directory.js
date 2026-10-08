const locationText = document.getElementById("directoryLocation");
const statusText = document.getElementById("directoryStatus");
const params = new URL(location.href).searchParams;
const action = params.get("action");
const returnTabId = Number(params.get("returnTab"));
const commands = { combined: { type: "TOOLKIT_START_COMBINED_RIGHT" }, downloadCurrent: { cmd: "downloadCurrent" }, downloadRight: { cmd: "downloadRight" } };
let savedHandle = null;
let started = false;
const authorizeButton = document.getElementById("authorizeExport");
async function returnToResume() {
  if (!Number.isInteger(returnTabId) || returnTabId <= 0) throw new Error("找不到原履歷分頁，請回到履歷重新開始。");
  await chrome.tabs.update(returnTabId, { active: true });
}
async function startPendingExport() {
  if (!commands[action] || started) return;
  await RecruitingOutputDirectory.getTarget();
  await returnToResume();
  const result = await chrome.runtime.sendMessage(commands[action]);
  if (!result?.ok) throw new Error(result?.error || "無法開始匯出。");
  started = true;
  authorizeButton.hidden = true;
  pickerButton.disabled = true;
  document.getElementById("defaultDirectory").disabled = true;
  statusText.textContent = "工作已開始，請保留此工具頁直到匯出結束，可在原履歷開啟工作台查看進度。";
}
authorizeButton.addEventListener("click", async () => {
  authorizeButton.disabled = true;
  try {
    // 原控制代碼在載入時讀取；直接在點擊時請求授權，保留使用者操作啟動權。
    const permission = await savedHandle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("未取得資料夾授權，尚未開始複製或匯出。可再次授權或另選資料夾。");
    await startPendingExport();
  } catch (error) { statusText.textContent = error.message; }
  finally { authorizeButton.disabled = false; }
});
const pickerButton = document.getElementById("pickDirectory");
async function refreshDirectory() {
  const state = await RecruitingOutputDirectory.status();
  locationText.textContent = state.name;
}
pickerButton.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    statusText.textContent = "此瀏覽器無法選擇資料夾，請使用桌面版 Chrome。";
    return;
  }
  pickerButton.disabled = true;
  try {
    // 必須直接在點擊事件內開啟原生選取視窗，保留使用者操作授權。
    const handle = await window.showDirectoryPicker({ id: "104-resume-output", mode: "readwrite" });
    await RecruitingOutputDirectory.set(handle);
    savedHandle = handle;
    await refreshDirectory();
    if (commands[action]) { await startPendingExport(); return; }
    statusText.textContent = "已設定，之後匯出會存入此資料夾。請按「完成並返回原分頁」。";
  } catch (error) {
    statusText.textContent = error.name === "AbortError" ? "已取消選擇，原設定保持不變。" : `無法設定：${error.message}`;
  } finally { pickerButton.disabled = started; }
});
document.getElementById("defaultDirectory").addEventListener("click", async () => {
  try {
    await RecruitingOutputDirectory.useDefault();
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, subdir: "" } });
    await refreshDirectory();
    statusText.textContent = "已改為瀏覽器預設下載位置。";
    if (commands[action]) await startPendingExport();
  } catch (error) { statusText.textContent = error.message; }
});
document.getElementById("returnToResume").addEventListener("click", async () => {
  try { await returnToResume(); }
  catch (_) { statusText.textContent = "原分頁已關閉，請自行回到履歷頁。"; }
  // 不關閉：最後一個同來源工具頁關閉可能撤銷暫時檔案授權。
});
(async () => {
  await refreshDirectory();
  if (!commands[action]) return;
  savedHandle = await RecruitingOutputDirectory.getSavedHandle();
  const state = await RecruitingOutputDirectory.status();
  if (!state.selected || (savedHandle && await savedHandle.queryPermission({ mode: "readwrite" }) === "granted")) {
    await startPendingExport();
  } else if (savedHandle) {
    authorizeButton.hidden = false;
    statusText.textContent = "請授權原資料夾後繼續，不需重新選擇路徑。授權完成後才會開始作業。";
  } else {
    statusText.textContent = "原資料夾設定無法讀取，請選擇資料夾後繼續。";
  }
})().catch(error => { statusText.textContent = error.message; });
