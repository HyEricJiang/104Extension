async function send(cmd, payload = {}) {
  return chrome.runtime.sendMessage({ cmd, ...payload });
}

function $(id) { return document.getElementById(id); }

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {};
  $("subdir").value = s.subdir ?? "104履歷下載區/";
  $("firstWait").value = s.firstWait ?? 2800;
  $("nextWait").value = s.nextWait ?? 800;
  $("waitDownload").checked = !!s.waitDownload;
}

async function refreshStatus() {
  const st = await send("getStatus");
  $("status").textContent =
    `running: ${st.running}\npaused: ${st.paused}\nstopRequested: ${st.stopRequested}\nprogress: ${st.progressText}\ncurrent: ${st.currentIndex}/${st.total}\nlast: ${st.lastMessage}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await refreshStatus();

  $("save").addEventListener("click", async () => {
    const subdir = $("subdir").value || "";
    const firstWait = Number($("firstWait").value || 0);
    const nextWait = Number($("nextWait").value || 0);
    const waitDownload = $("waitDownload").checked;

    await chrome.storage.local.set({
      settings: { subdir, firstWait, nextWait, waitDownload }
    });

    await send("applySettings");
    await refreshStatus();
  });

  $("start").addEventListener("click", async () => { await send("start"); await refreshStatus(); });
  $("pause").addEventListener("click", async () => { await send("pause"); await refreshStatus(); });
  $("resume").addEventListener("click", async () => { await send("resume"); await refreshStatus(); });
  $("stop").addEventListener("click", async () => { await send("stop"); await refreshStatus(); });

  setInterval(refreshStatus, 700);
});