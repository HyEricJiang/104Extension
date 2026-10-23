(() => {
  const FOCUS_ERROR_PATTERNS = [
    "document is not focused",
    "notallowederror",
    "clipboard write failed"
  ];

  function isFocusRelatedError(error) {
    const normalized = String(error || "").toLowerCase();
    return FOCUS_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
  }

  /**
   * 資料整理與剪貼簿寫入是兩個不同結果。
   * 背景分頁失焦是 Chrome 的執行限制，不代表收集失敗，因此不應顯示失敗訊息。
   */
  function resolveCompletion(operationMessage, clipboardResult) {
    const completedMessage = String(operationMessage).includes("資料已整理完成")
      ? operationMessage
      : `${operationMessage}，資料已整理完成`;

    if (clipboardResult?.ok) {
      return {
        message: `${operationMessage}，已複製到剪貼簿`,
        clipboardState: "copied"
      };
    }

    if (isFocusRelatedError(clipboardResult?.error)) {
      return {
        message: `${completedMessage}，可直接貼上使用`,
        clipboardState: "focus-fallback"
      };
    }

    return {
      message: completedMessage,
      clipboardState: "popup-fallback"
    };
  }

  globalThis.RecruitingClipboardPolicy = Object.freeze({
    isFocusRelatedError,
    resolveCompletion
  });
})();
