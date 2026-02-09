const $ = (id) => document.getElementById(id);

const btnStart = $("btnStart");
const btnExport = $("btnExport");
const btnClear = $("btnClear");
const statusEl = $("status");
const countEl = $("count");

function setStatus(text) {
  statusEl.textContent = text;
}

async function refreshCount() {
  const { bunny_rows = [] } = await chrome.storage.local.get(["bunny_rows"]);
  countEl.textContent = String(bunny_rows.length);
}

function toTSVText(rows) {
  return rows.join("\n");
}

async function exportTSV() {
  const { bunny_rows = [] } = await chrome.storage.local.get(["bunny_rows"]);
  if (!bunny_rows.length) {
    setStatus("狀態：沒有資料可匯出");
    return;
  }

  const text = toTSVText(bunny_rows);

  // Clipboard API in popup context
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`狀態：已複製 TSV ✅（${bunny_rows.length} 筆）\n直接貼到 Google Sheet 即可分欄分列。`);
  } catch (e) {
    // fallback: show text for manual copy
    setStatus(`狀態：剪貼簿權限失敗（可能被瀏覽器阻擋）\n請手動複製以下內容：\n\n${text}`);
  }
}

async function clearAll() {
  await chrome.storage.local.set({ bunny_rows: [] });
  setStatus("狀態：已清空暫存");
  await refreshCount();
}

async function startCollectRight() {
  btnStart.disabled = true;
  btnExport.disabled = true;
  btnClear.disabled = true;

  setStatus("狀態：開始收集…（會自動切換分頁）");

  // Ask background to run
  const resp = await chrome.runtime.sendMessage({ type: "START_COLLECT_RIGHT" });
  if (!resp?.ok) {
    setStatus(`狀態：啟動失敗：${resp?.error || "unknown"}`);
  } else {
    setStatus("狀態：收集進行中…（請不要手動關閉分頁）");
  }

  btnStart.disabled = false;
  btnExport.disabled = false;
  btnClear.disabled = false;
  await refreshCount();
}

btnStart.addEventListener("click", startCollectRight);
btnExport.addEventListener("click", exportTSV);
btnClear.addEventListener("click", clearAll);

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;

  if (msg.type === "PROGRESS") {
    setStatus(
      `狀態：${msg.message}\n` +
      `目前：${msg.current}/${msg.total}\n` +
      `暫存：${msg.count} 筆`
    );
    countEl.textContent = String(msg.count);
  }

  if (msg.type === "DONE") {
    setStatus(`狀態：完成 ✅\n總共暫存：${msg.count} 筆`);
    countEl.textContent = String(msg.count);
  }

  if (msg.type === "ERROR") {
    setStatus(`狀態：發生錯誤 ❌\n${msg.error || ""}`);
  }
});

// ⬅️ 新增：popup 打開時，初始化 badge 為 COPY
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "INIT_BADGE_COPY" });
  } catch {}
});

refreshCount();