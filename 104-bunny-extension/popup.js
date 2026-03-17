const $ = (id) => document.getElementById(id);

const btnCopyCurrent = $("btnCopyCurrent");
const btnCollectRight = $("btnCollectRight");
const btnPause = $("btnPause");
const statusEl = $("status");
const countEl = $("count");

/**
 * 統一更新狀態文字。
 * 這裡集中處理是為了避免各事件自己拼字串，後續要調整文案只改一處即可。
 */
function setStatus(text) {
  statusEl.textContent = text;
}


/**
 * 嘗試把結果直接寫入剪貼簿。
 * 為什麼在 popup 也做一次？
 * 因為背景 service worker 沒有 DOM，部分情境下頁面注入腳本寫剪貼簿可能失敗。
 * 因此這裡補一層前端 fallback，可大幅降低「已完成但貼不上」的機率。
 */
async function copyTextToClipboard(text) {
  if (!text) return { ok: false, error: "沒有可複製內容" };

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * 從背景頁同步目前執行狀態與累計筆數。
 * 因為 popup 可能會被關閉再打開，所以 UI 不應只依賴記憶體狀態。
 */
async function refreshState() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!resp?.ok) return;

    const state = resp.state || {};
    countEl.textContent = String(state.count || 0);

    if (state.running) {
      btnCopyCurrent.disabled = true;
      btnCollectRight.disabled = true;
      btnPause.disabled = false;
      setStatus(
        `狀態：收集中\n` +
        `模式：${state.mode === "current" ? "複製本頁" : "從目前往右收集"}\n` +
        `進度：${state.current || 0}/${state.total || 0}\n` +
        `暫存：${state.count || 0} 筆`
      );
    } else {
      btnCopyCurrent.disabled = false;
      btnCollectRight.disabled = false;
      btnPause.disabled = true;
      if (state.lastStatusText) {
        setStatus(state.lastStatusText);
      }
    }
  } catch (error) {
    setStatus(`狀態：無法讀取目前狀態\n${String(error?.message || error)}`);
  }
}

/**
 * 啟動背景收集流程。
 * 開始前不需要手動清空，背景會自動清空暫存並重新開始。
 */
async function startAction(type) {
  btnCopyCurrent.disabled = true;
  btnCollectRight.disabled = true;
  btnPause.disabled = false;

  setStatus("狀態：已送出指令，準備開始…");

  try {
    const resp = await chrome.runtime.sendMessage({ type });
    if (!resp?.ok) {
      setStatus(`狀態：啟動失敗\n${resp?.error || "unknown error"}`);
      await refreshState();
      return;
    }

    setStatus(
      type === "START_COPY_CURRENT"
        ? "狀態：正在複製本頁資料…"
        : "狀態：正在從目前分頁往右收集…"
    );
  } catch (error) {
    setStatus(`狀態：啟動失敗\n${String(error?.message || error)}`);
    await refreshState();
  }
}

async function pauseCollect() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "PAUSE_COLLECT" });
    if (!resp?.ok) {
      setStatus(`狀態：暫停失敗\n${resp?.error || "unknown error"}`);
      return;
    }
    setStatus("狀態：已送出暫停指令，會在目前頁處理完成後停止");
    btnPause.disabled = true;
  } catch (error) {
    setStatus(`狀態：暫停失敗\n${String(error?.message || error)}`);
  }
}

btnCopyCurrent.addEventListener("click", () => startAction("START_COPY_CURRENT"));
btnCollectRight.addEventListener("click", () => startAction("START_COLLECT_RIGHT"));
btnPause.addEventListener("click", pauseCollect);


chrome.runtime.onMessage.addListener((msg) => {
  (async () => {
    if (!msg) return;

    if (msg.type === "PROGRESS") {
      setStatus(
        `狀態：${msg.message}\n` +
        `進度：${msg.current}/${msg.total}\n` +
        `暫存：${msg.count} 筆`
      );
      countEl.textContent = String(msg.count || 0);
      btnPause.disabled = false;
      return;
    }

    if (msg.type === "DONE") {
      const clipboardResult = await copyTextToClipboard(msg.text || "");
      setStatus(
        `狀態：完成 ✅\n` +
        `結果：${msg.message || "資料已複製到剪貼簿"}${clipboardResult.ok ? "" : "\nPopup 補寫剪貼簿失敗：" + clipboardResult.error}\n` +
        `總筆數：${msg.count || 0}`
      );
      countEl.textContent = String(msg.count || 0);
      btnCopyCurrent.disabled = false;
      btnCollectRight.disabled = false;
      btnPause.disabled = true;
      return;
    }

    if (msg.type === "PAUSED") {
      const clipboardResult = await copyTextToClipboard(msg.text || "");
      setStatus(
        `狀態：已暫停 ⏸\n` +
        `結果：${msg.message || "已停止後續分頁收集"}${clipboardResult.ok ? "" : "\nPopup 補寫剪貼簿失敗：" + clipboardResult.error}\n` +
        `目前筆數：${msg.count || 0}`
      );
      countEl.textContent = String(msg.count || 0);
      btnCopyCurrent.disabled = false;
      btnCollectRight.disabled = false;
      btnPause.disabled = true;
      return;
    }

    if (msg.type === "ERROR") {
      setStatus(`狀態：發生錯誤 ❌\n${msg.error || ""}`);
      btnCopyCurrent.disabled = false;
      btnCollectRight.disabled = false;
      btnPause.disabled = true;
    }
  })().catch((error) => {
    setStatus(`狀態：UI 更新失敗\n${String(error?.message || error)}`);
    btnCopyCurrent.disabled = false;
    btnCollectRight.disabled = false;
    btnPause.disabled = true;
  });
});

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "INIT_BADGE_COPY" });
  } catch {}
  await refreshState();
});
