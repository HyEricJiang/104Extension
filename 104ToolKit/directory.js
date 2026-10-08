const locationText = document.getElementById("directoryLocation");
const statusText = document.getElementById("directoryStatus");
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
    await refreshDirectory();
    statusText.textContent = "已設定，之後匯出會存入此資料夾。請按「完成並返回原分頁」。";
  } catch (error) {
    statusText.textContent = error.name === "AbortError" ? "已取消選擇，原設定保持不變。" : `無法設定：${error.message}`;
  } finally { pickerButton.disabled = false; }
});
document.getElementById("defaultDirectory").addEventListener("click", async () => {
  try {
    await RecruitingOutputDirectory.useDefault();
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, subdir: "" } });
    await refreshDirectory();
    statusText.textContent = "已改為瀏覽器預設下載位置。";
  } catch (error) { statusText.textContent = error.message; }
});
document.getElementById("returnToResume").addEventListener("click", async () => {
  const id = Number(new URL(location.href).searchParams.get("returnTab"));
  try { if (Number.isInteger(id) && id > 0) await chrome.tabs.update(id, { active: true }); }
  catch (_) { statusText.textContent = "原分頁已關閉，請自行回到履歷頁。"; return; }
  const current = await chrome.tabs.getCurrent();
  if (current?.id) await chrome.tabs.remove(current.id);
});
refreshDirectory().catch(error => { statusText.textContent = error.message; });
