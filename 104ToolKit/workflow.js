(() => {
  const WORKFLOW_KEY = "recruiting_toolkit_workflow";

  const state = {
    running: false,
    stopRequested: false,
    phase: "idle",
    current: 0,
    total: 2,
    lastMessage: "待命中",
    error: ""
  };

  function publicState() {
    return { ...state };
  }

  async function persistAndNotify(patch = {}) {
    Object.assign(state, patch);
    await chrome.storage.local.set({ [WORKFLOW_KEY]: publicState() });
    try {
      await chrome.runtime.sendMessage({
        type: "TOOLKIT_WORKFLOW_UPDATE",
        state: publicState()
      });
    } catch (_) {
      // Popup 關閉時不需要視為錯誤，狀態已保存於 storage。
    }
  }

  async function restoreInitialState() {
    const stored = await chrome.storage.local.get(WORKFLOW_KEY);
    const previous = stored[WORKFLOW_KEY];
    if (previous?.running) {
      await persistAndNotify({
        running: false,
        stopRequested: false,
        phase: "idle",
        current: 0,
        lastMessage: "上次工作流已中止，可重新執行。",
        error: ""
      });
      return;
    }
    Object.assign(state, previous || {});
  }

  async function getActiveTabId() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id || null;
  }

  async function ensureNoOtherJob() {
    const collectorState = await globalThis.RecruitingCollector.getState();
    const pdfState = globalThis.RecruitingPdfExporter.getState();
    if (state.running || collectorState.running || pdfState.running) {
      throw new Error("目前已有工作正在執行，請等待完成或先停止。");
    }
  }

  async function runCombinedRight() {
    await ensureNoOtherJob();
    const originTabId = await getActiveTabId();
    if (!originTabId) throw new Error("找不到目前作用中的分頁。");

    await persistAndNotify({
      running: true,
      stopRequested: false,
      phase: "collecting",
      current: 0,
      total: 2,
      lastMessage: "步驟 1/2：正在複製本頁往右的聯絡資料…",
      error: ""
    });

    try {
      await globalThis.RecruitingCollector.startCollection("right");
      const collectorResult = await globalThis.RecruitingCollector.getState();
      if (state.stopRequested || collectorResult.stopRequested) {
        await persistAndNotify({
          running: false,
          stopRequested: false,
          phase: "stopped",
          current: 1,
          lastMessage: "已停止；已保留目前完成的複製結果。"
        });
        return;
      }
      if (!collectorResult.rows?.length) {
        throw new Error("沒有取得可複製的聯絡資料，因此未繼續匯出 PDF。");
      }

      await chrome.tabs.update(originTabId, { active: true });
      await persistAndNotify({
        phase: "exporting",
        current: 1,
        lastMessage: `步驟 2/2：已複製 ${collectorResult.rows.length} 筆，開始匯出 PDF…`
      });

      await globalThis.RecruitingPdfExporter.runDownloadRightBatch();
      const pdfResult = globalThis.RecruitingPdfExporter.getState();
      if (state.stopRequested) {
        await persistAndNotify({
          running: false,
          stopRequested: false,
          phase: "stopped",
          current: 2,
          lastMessage: pdfResult.lastMessage || "已停止 PDF 匯出。"
        });
        return;
      }

      await persistAndNotify({
        running: false,
        stopRequested: false,
        phase: "done",
        current: 2,
        lastMessage: `工作流完成：已複製 ${collectorResult.rows.length} 筆；${pdfResult.lastMessage || "PDF 已匯出。"}`,
        error: ""
      });
    } catch (error) {
      const message = String(error?.message || error);
      console.error("[104 招募工作台] 工作流失敗", { phase: state.phase, message });
      await persistAndNotify({
        running: false,
        stopRequested: false,
        phase: "error",
        lastMessage: "工作流未完成，請查看錯誤訊息後重試。",
        error: message
      });
    }
  }

  async function requestStop() {
    if (!state.running) return { ok: false, error: "目前沒有執行中的工作流。" };
    await persistAndNotify({
      stopRequested: true,
      lastMessage: "已收到停止要求，會在目前這份資料處理完成後停止。"
    });
    await globalThis.RecruitingCollector.pause();
    globalThis.RecruitingPdfExporter.requestStop();
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const supportedTypes = new Set([
      "TOOLKIT_GET_WORKFLOW_STATE",
      "TOOLKIT_START_COMBINED_RIGHT",
      "TOOLKIT_STOP_WORKFLOW"
    ]);
    if (!supportedTypes.has(message?.type)) return false;

    (async () => {
      if (message.type === "TOOLKIT_GET_WORKFLOW_STATE") {
        sendResponse({ ok: true, state: publicState() });
        return;
      }
      if (message.type === "TOOLKIT_STOP_WORKFLOW") {
        sendResponse(await requestStop());
        return;
      }
      try {
        await ensureNoOtherJob();
        sendResponse({ ok: true });
        runCombinedRight().catch((error) => {
          console.error("[104 招募工作台] 無法啟動工作流", error);
        });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    })();
    return true;
  });

  restoreInitialState().catch((error) => {
    console.error("[104 招募工作台] 無法還原工作流狀態", error);
  });
})();
