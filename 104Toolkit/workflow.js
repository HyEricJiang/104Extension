(() => {
  const WORKFLOW_KEY = "recruiting_toolkit_workflow";

  const state = {
    running: false,
    stopRequested: false,
    phase: "idle",
    current: 0,
    total: 2,
    lastMessage: "待命中",
    error: "",
    firstRow: 0,
    savedCount: 0
  };

  let starting = false;

  function publicState() {
    return { ...state };
  }

  async function persistAndNotify(patch = {}) {
    Object.assign(state, patch);
    const badge = state.running ? (state.phase === "exporting" ? "PDF" : "...") : state.phase === "done" ? "OK" : state.phase === "error" ? "ERR" : state.phase === "stopped" ? "STOP" : "";
    await chrome.action.setBadgeText({ text: badge });
    await chrome.action.setBadgeBackgroundColor({ color: state.phase === "error" ? "#ef4444" : state.phase === "done" ? "#22c55e" : "#4f8cff" });
    await chrome.action.setTitle({ title: state.error || state.lastMessage });
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

  async function runWorkflow(originTabId, type, source) {
    const includePdf = type === "TOOLKIT_START_COMBINED_RIGHT";
    const currentOnly = type === "TOOLKIT_START_INVITE_CURRENT";
    const total = includePdf ? 2 : 1;
    await persistAndNotify({
      running: true,
      stopRequested: false,
      phase: "collecting",
      current: 0,
      total,
      lastMessage: "正在讀取符合職缺群組的履歷資料…",
      error: "",
      firstRow: 0,
      savedCount: 0,
      sheetUrl: ""
    });

    try {
      const scope = await globalThis.RecruitingTabScope.capture(originTabId);
      const targets = currentOnly ? scope.slice(0, 1) : scope;
      const writer = globalThis.RecruitingInvitation;
      const invitation = await writer.prepare(targets, { requireMatch: !includePdf });
      if (invitation.contactTargets.length && !state.stopRequested) {
        await globalThis.RecruitingCollector.startCollection(invitation.contactTargets, invitation.capture);
      }
      if (state.stopRequested) {
        await persistAndNotify({ running: false, stopRequested: false, phase: "stopped", lastMessage: "已停止登錄。" });
        return;
      }

      const rows = invitation.getRows();
      const failures = invitation.getFailures();
      let registration = failures.length ? "本批未寫入邀約紀錄。" : "本批沒有符合登錄條件的履歷。";
      let registrationError = "";
      if (rows.length && !failures.length) {
        await persistAndNotify({ phase: "sending", lastMessage: `正在等待 Google 確認 ${rows.length} 筆資料…` });
        if (state.stopRequested) {
          await persistAndNotify({ running: false, stopRequested: false, phase: "stopped", lastMessage: "已停止登錄。" });
          return;
        }
        try {
          const result = await writer.send(rows, invitation.getSkipped(), targets[0].windowId, source);
          const lastRow = result.firstRow + result.count - 1;
          const range = result.count === 1 ? String(result.firstRow) : `${result.firstRow}–${lastRow}`;
          const skipped = result.skipped ? ` ${result.skipped} 頁無可登錄的職缺群組。` : "";
          registration = `已寫入邀約紀錄 ${result.count} 筆，第 ${range} 列。${skipped}`;
          await persistAndNotify({ current: 1, lastMessage: registration, firstRow: result.firstRow, savedCount: result.count, sheetUrl: result.sheetUrl || "" });
        } catch (error) {
          registrationError = error.message;
          registration = "Google 登錄未確認成功。";
        }
      } else if (!includePdf && !failures.length) {
        registrationError = "沒有取得完整的姓名及 104 履歷編號。";
      }

      let pdfError = "";
      let pdfMessage = "";
      if (includePdf && !state.stopRequested) {
        await persistAndNotify({ phase: "exporting", current: 1, lastMessage: `${registration} 正在匯出 PDF…` });
        try {
          await globalThis.RecruitingPdfExporter.runDownloadRightBatch(targets, source);
          const pdf = globalThis.RecruitingPdfExporter.getState();
          pdfMessage = pdf.lastMessage || "PDF 匯出結束。";
          if (pdf.exportSummary?.fail) pdfError = "部分 PDF 匯出失敗。";
        } catch (error) {
          pdfError = error.message;
        }
      }
      const collectionError = failures.length ? `${failures.length} 頁讀取失敗，整批未送出。請確認 ${failures.join("、")} 後重試。` : "";
      const error = [registrationError, collectionError, pdfError].filter(Boolean).join(" ");
      await persistAndNotify({
        running: false,
        stopRequested: false,
        phase: error ? "error" : state.stopRequested ? "stopped" : "done",
        current: state.stopRequested ? state.current : total,
        lastMessage: [registration, pdfMessage].filter(Boolean).join(" "),
        error
      });
    } catch (error) {
      await persistAndNotify({
        running: false,
        stopRequested: false,
        phase: "error",
        lastMessage: "工作流未完成。",
        error: String(error?.message || error)
      });
    }
  }

  async function requestStop() {
    if (!state.running) return { ok: false, error: "目前沒有執行中的工作流。" };
    await persistAndNotify({
      stopRequested: true,
      lastMessage: "已收到停止要求，已送出的 Google 寫入仍會回報結果。"
    });
    await globalThis.RecruitingCollector.pause();
    globalThis.RecruitingPdfExporter.requestStop();
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const supportedTypes = new Set([
      "TOOLKIT_GET_WORKFLOW_STATE",
      "TOOLKIT_START_COMBINED_RIGHT",
      "TOOLKIT_START_INVITE_CURRENT",
      "TOOLKIT_START_INVITE_RIGHT",
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
      if (starting) {
        sendResponse({ ok: false, error: "正在啟動工作流，請稍候。" });
        return;
      }
      starting = true;
      try {
        await ensureNoOtherJob();
        const originTabId = message.originTabId || await getActiveTabId();
        if (!originTabId) throw new Error("找不到目前作用中的分頁。");
        sendResponse({ ok: true });
        await runWorkflow(originTabId, message.type, message.source);
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      } finally {
        starting = false;
      }
    })();
    return true;
  });

  globalThis.RecruitingWorkflow = Object.freeze({ getState: publicState });

  restoreInitialState().catch((error) => {
    console.error("[104 招募工作台] 無法還原工作流狀態", error);
  });
})();
