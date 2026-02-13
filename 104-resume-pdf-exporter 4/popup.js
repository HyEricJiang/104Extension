async function send(cmd, payload = {}) {
  return chrome.runtime.sendMessage({ cmd, ...payload });
}

function $(id) { return document.getElementById(id); }

async function saveSettingsSilently() {
  const subdir = $("subdir").value || "";
  const filenamePrefix = $("filenamePrefix").value || "";
  const filenameSuffix = $("filenameSuffix").value || "";
  const firstWait = Number($("firstWait").value || 0);
  const nextWait = Number($("nextWait").value || 0);

  await chrome.storage.local.set({
    settings: { subdir, filenamePrefix, filenameSuffix, firstWait, nextWait }
  });
  // Make sure background picks up the latest settings immediately.
  await send("applySettings");
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {};
  $("subdir").value = s.subdir ?? "104履歷下載區/";
  $("filenamePrefix").value = s.filenamePrefix ?? "";
  $("filenameSuffix").value = s.filenameSuffix ?? "";
  $("firstWait").value = s.firstWait ?? 2800;
  $("nextWait").value = s.nextWait ?? 800;
}

async function refreshStatus() {
  const st = await send("getStatus");
  $("status").textContent =
    `running: ${st.running}\nprogress: ${st.progressText}\ncurrent: ${st.currentIndex}/${st.total}\nlast: ${st.lastMessage}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await refreshStatus();

  $("save").addEventListener("click", async () => {
    await saveSettingsSilently();
    await refreshStatus();
  });

  $("downloadCurrent").addEventListener("click", async () => {
    await saveSettingsSilently();
    await send("downloadCurrent");
    await refreshStatus();
  });

  $("downloadRight").addEventListener("click", async () => {
    await saveSettingsSilently();
    await send("downloadRight");
    await refreshStatus();
  });

  setInterval(refreshStatus, 700);
});