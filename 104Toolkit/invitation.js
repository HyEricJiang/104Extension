(() => {
  const WRITER_ID = "AKfycby7igqgEuahOlH6-3UX78P1dnAcoS352P8UMVfd56PzErjQGq37CLKZcpWYlEjPyUId1Q";
  const WRITER_URL = `https://script.google.com/a/macros/hy-tech.com.tw/s/${WRITER_ID}/exec`;
  const BATCH_PREFIX = "inviteBatch:";
  const pending = new Map();
  const WAIT_MS = 45000;
  const PANEL_ID = "hytech-104-invite-writer";
  const POSITIONS = Object.freeze([
    "Sr.Java PG", "Jr.Java PG", "Sr.Net PG", "Jr.Net PG", "SA", "PM", "Jr.QA", "Sr.QA"
  ]);

  function deploymentId(value) {
    try {
      const url = new URL(value);
      if (url.origin !== "https://script.google.com" || url.username || url.password) return "";
      return url.pathname.match(/^\/(?:a\/macros\/hy-tech\.com\.tw|macros(?:\/u\/\d+)?)\/s\/([\w-]+)\/exec$/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function confirmedSheetUrl(value, firstRow, lastRow) {
    try {
      const url = new URL(value);
      const gid = new URLSearchParams(url.hash.slice(1)).get("gid");
      if (url.origin !== "https://docs.google.com" || url.username || url.password ||
          !/^\/spreadsheets\/d\/[\w-]+\/edit$/.test(url.pathname) || !/^\d+$/.test(gid || "")) return "";
      return `${url.origin}${url.pathname}#gid=${gid}&range=A${firstRow}:I${lastRow}`;
    } catch (_) {
      return "";
    }
  }

  async function prepare(scope, { requireMatch = false } = {}) {
    const groups = await chrome.tabGroups.query({ windowId: scope[0].windowId });
    const titles = new Map(groups.map(group => [group.id, group.title?.trim()]));
    const eligible = new Map(scope
      .map(tab => [tab.id, titles.get(tab.groupId)])
      .filter(([, title]) => POSITIONS.includes(title)));
    if (requireMatch && !eligible.size) throw new Error("範圍內沒有可登錄的履歷。請先將履歷分頁加入職缺群組。");

    const contactTargets = scope.filter(tab => eligible.has(tab.id));
    const pageNumbers = new Map(scope.map((tab, index) => [tab.id, index + 1]));
    const rowsByTab = new Map();
    const errorsByTab = new Map();
    return {
      contactTargets,
      capture(tab, line, error) {
        const group = eligible.get(tab.id);
        if (!group) return;
        const [name, email, phone, resumeCode] = String(line || "").split("\t");
        if (![name, email, phone, resumeCode].every(value => value?.trim())) {
          rowsByTab.delete(tab.id);
          errorsByTab.set(tab.id, error || "履歷資料不完整");
          return;
        }
        rowsByTab.set(tab.id, { group, name, email, phone, resumeCode });
      },
      getRows() {
        const unique = new Map();
        for (const tab of contactTargets) {
          const row = rowsByTab.get(tab.id);
          if (!row) continue;
          const key = `${row.group}:${row.resumeCode}`;
          if (!unique.has(key)) unique.set(key, row);
        }
        return [...unique.values()];
      },
      getSkipped() { return scope.length - eligible.size; },
      getFailures() {
        return contactTargets.filter(tab => !rowsByTab.has(tab.id))
          .map(tab => `第 ${pageNumbers.get(tab.id)} 頁（${errorsByTab.get(tab.id) || "尚未取得履歷資料"}）`);
      }
    };
  }

  async function send(rows, skipped, windowId, source) {
    if (!rows.length) throw new Error("找不到可登錄的姓名及 104 履歷編號。");
    if (rows.length > 100) throw new Error("單次最多登錄 100 筆，請縮小履歷分頁範圍。");
    const tab = await chrome.tabs.create({ windowId, index: 0, url: "about:blank", active: false });
    const key = BATCH_PREFIX + tab.id;
    const batchId = crypto.randomUUID();
    let timer;
    try {
      await chrome.storage.session.set({ [key]: {
        expires: Date.now() + WAIT_MS,
        payload: { batchId, rows, skipped, source }
      } });
      const receipt = new Promise(resolve => {
        const attempt = { resolve, delivered: false };
        pending.set(tab.id, attempt);
        timer = setTimeout(() => resolve({
          ok: false,
          error: attempt.delivered
            ? "資料已交給登錄頁，但未收到寫入結果。請先核對邀約紀錄，再決定是否重試。"
            : "未連上登錄頁，資料尚未交付。請到「設定 → 開啟登錄服務／Google 授權」，確認 Google 帳號與頁面提示。"
        }), WAIT_MS);
      });
      await chrome.tabs.update(tab.id, { url: WRITER_URL, active: false });
      const result = await receipt;
      if (!result.ok) throw new Error(result.error);
      return result;
    } finally {
      clearTimeout(timer);
      pending.delete(tab.id);
      await Promise.allSettled([chrome.storage.session.remove(key), chrome.tabs.remove(tab.id)]);
    }
  }

  async function exchange(message, sender) {
    const id = deploymentId(sender.tab?.url);
    if (id !== WRITER_ID || !sender.frameId) return null;

    // Google renders the app inside a child iframe that can inherit the panel origin.
    const isInheritedFrame = sender.url === "about:blank" || sender.url === "about:srcdoc";
    const frame = new URL(isInheritedFrame ? sender.origin || "about:blank" : sender.url || "about:blank");
    if (frame.protocol !== "https:" || !frame.hostname.endsWith(".googleusercontent.com") ||
        (!isInheritedFrame && frame.pathname !== "/userCodeAppPanel")) return null;

    const key = BATCH_PREFIX + sender.tab.id;
    const batch = (await chrome.storage.session.get(key))[key];
    const attempt = pending.get(sender.tab.id);
    if (!batch || batch.expires < Date.now() || !attempt) return null;
    if (message.type !== "TOOLKIT_INVITE_PAYLOAD") {
      if (message.batchId !== batch.payload.batchId) return null;
      if (message.type === "TOOLKIT_INVITE_FAILED") {
        attempt.resolve({ ok: false, error: String(message.error || "Google 登錄失敗。") });
      } else {
        const firstRow = Number(message.firstRow);
        const lastRow = Number(message.lastRow);
        if (!Number.isSafeInteger(firstRow) || firstRow < 2 || !Number.isSafeInteger(lastRow)) return null;
        const count = lastRow - firstRow + 1;
        if (count !== batch.payload.rows.length) {
          attempt.resolve({ ok: false, error: "Google 回報的寫入筆數與本批不符，請先核對邀約紀錄後再重試。" });
          return null;
        }
        attempt.resolve({ ok: true, firstRow, count, skipped: batch.payload.skipped, sheetUrl: confirmedSheetUrl(message.sheetUrl, firstRow, lastRow) });
      }
      return null;
    }
    attempt.delivered = true;
    return batch.payload;
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type === "TOOLKIT_GET_WRITER_URL") {
      if (sender.url !== chrome.runtime.getURL("popup.html")) return false;
      reply({ ok: true, url: WRITER_URL });
      return false;
    }
    if (message?.panel !== PANEL_ID ||
        !["TOOLKIT_INVITE_PAYLOAD", "TOOLKIT_INVITE_ACK", "TOOLKIT_INVITE_FAILED"].includes(message.type)) return false;
    exchange(message, sender).then(reply, () => reply(null));
    return true;
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    pending.get(tabId)?.resolve({ ok: false, error: "Google 登錄連線已關閉，請先確認邀約紀錄。"});
    chrome.storage.session.remove(BATCH_PREFIX + tabId).catch(() => {});
  });

  globalThis.RecruitingInvitation = Object.freeze({ prepare, send });
})();
