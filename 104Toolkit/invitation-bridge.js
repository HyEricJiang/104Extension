(() => {
  const panel = "hytech-104-invite-writer";
  const origin = window.origin;
  if (!origin?.endsWith(".googleusercontent.com")) return;

  function getWriterWindow() {
    if (document.getElementById(panel)) return window;
    const frame = document.getElementById("userHtmlFrame");
    try {
      if (frame?.contentDocument?.getElementById(panel) && frame.contentWindow.origin === origin) {
        return frame.contentWindow;
      }
    } catch (_) {
      // The Google frame can navigate while loading.
    }
    return null;
  }

  let working = false;
  const deadline = Date.now() + 18000;

  async function deliver() {
    if (working) return;
    const writer = getWriterWindow();
    if (!writer) {
      if (Date.now() < deadline) setTimeout(deliver, 200);
      return;
    }
    working = true;

    try {
      const payload = await chrome.runtime.sendMessage({ type: "TOOLKIT_INVITE_PAYLOAD", panel });
      if (!payload?.batchId) return;
      const status = writer.document.getElementById("status");
      const sheet = writer.document.getElementById("sheet");
      if (!status || !sheet) return;
      const observer = new MutationObserver(() => {
        const message = status.textContent.trim();
        const range = sheet.href.match(/[&#]range=A(\d+):I(\d+)$/);
        let result;
        if (message.startsWith("登錄失敗：")) result = { type: "TOOLKIT_INVITE_FAILED", error: message };
        else if (message.startsWith("已由") && range) {
          const [, firstRow, lastRow] = range;
          result = { type: "TOOLKIT_INVITE_ACK", firstRow, lastRow };
        }
        if (!result) return;
        observer.disconnect();
        chrome.runtime.sendMessage({ ...result, panel, batchId: payload.batchId }).catch(() => {});
      });
      observer.observe(status, { childList: true, characterData: true, subtree: true });
      // The deployed app expects a message from its own window. Relay from the
      // same-origin panel without relying on a separate injection in the child.
      writer.dispatchEvent(new writer.MessageEvent("message", {
        origin,
        source: writer,
        data: { panel, type: "payload", payload }
      }));
    } catch (error) {
      console.warn("[104Toolkit] Google 登錄頁交接失敗", error.message);
    }
  }

  deliver();
})();
