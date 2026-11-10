(() => {
  const WRITER_ID = "REPLACE_WITH_DEPLOYMENT_ID";
  const WRITER_URL = `https://script.google.com/a/macros/hy-tech.com.tw/s/${WRITER_ID}/exec`;
  const BATCH_PREFIX = "inviteBatch:";
  const pending = new Map();
  const WAIT_MS = 20000;
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

  async function prepare(scope, { requireMatch = false } = {}) {
    const groups = await chrome.tabGroups.query({ windowId: scope[0].windowId });
    const titles = new Map(groups.map(group => [group.id, group.title?.trim()]));
    const eligible = new Map(scope
      .map(tab => [tab.id, titles.get(tab.groupId)])
      .filter(([, title]) => POSITIONS.includes(title)));
    if (requireMatch && !eligible.size) throw new Error("範圍內沒有可登錄的履歷。請先將履歷分頁加入職缺群組。");

    const contactTargets = scope.filter(tab => eligible.has(tab.id));
    const rows = new Map();
    let missing = 0;
    return {
      contactTargets,
      capture(tab, line) {
        const group = eligible.get(tab.id);
        if (!group) return;
        const [name, email, phone, resumeCode] = String(line || "").split("\t");
        if (!name || !resumeCode) {
          missing++;
          return;
        }
        const key = `${group}:${resumeCode}`;
        if (!rows.has(key)) rows.set(key, { group, name, email, phone, resumeCode });
      },
      getRows() { return [...rows.values()]; },
      getSkipped() { return scope.length - eligible.size + missing; }
    };
  }

  async function send(rows, skipped, windowId) {
    if (!rows.length) throw new Error("找不到可登錄的姓名及 104 履歷編號。");
    if (rows.length > 100) throw new Error("單次最多登錄 100 筆，請縮小履歷分頁範圍。");

    const tab = await chrome.tabs.create({ windowId, index: 0, url: "about:blank", active: false });
    const key = BATCH_PREFIX + tab.id;
    const batchId = crypto.randomUUID();
    let timer;
    try {
      await chrome.storage.session.set({ [key]: {
        expires: Date.now() + WAIT_MS,
        payload: { batchId, rows, skipped }
      } });
      const receipt = new Promise(resolve => {
        pending.set(tab.id, resolve);
        timer = setTimeout(() => resolve({
          ok: false,
          error: "Google 未回報寫入結果。請先核對邀約紀錄，並確認公司 Google 帳號已登入及授權後再試。"
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
    if (!batch || batch.expires < Date.now()) return null;
    if (message.type !== "TOOLKIT_INVITE_PAYLOAD") {
      if (message.batchId !== batch.payload.batchId) return null;
      if (message.type === "TOOLKIT_INVITE_FAILED") {
        pending.get(sender.tab.id)?.({ ok: false, error: String(message.error || "Google 登錄失敗。") });
      } else {
        const firstRow = Number(message.firstRow);
        const count = batch.payload.rows.length;
        if (!Number.isSafeInteger(firstRow) || firstRow < 2) return null;
        pending.get(sender.tab.id)?.({ ok: true, firstRow, count, skipped: batch.payload.skipped });
      }
      return null;
    }
    return batch.payload;
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.panel !== PANEL_ID ||
        !["TOOLKIT_INVITE_PAYLOAD", "TOOLKIT_INVITE_ACK", "TOOLKIT_INVITE_FAILED"].includes(message.type)) return false;
    exchange(message, sender).then(reply, () => reply(null));
    return true;
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    pending.get(tabId)?.({ ok: false, error: "Google 登錄連線已關閉，請先確認邀約紀錄。"});
    chrome.storage.session.remove(BATCH_PREFIX + tabId).catch(() => {});
  });

  globalThis.RecruitingInvitation = Object.freeze({ prepare, send });
})();
