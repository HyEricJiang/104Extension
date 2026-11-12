const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const frontend = readFileSync(join(__dirname, "../invitation.js"), "utf8");
const bridge = readFileSync(join(__dirname, "../invitation-bridge.js"), "utf8");
const backend = readFileSync(join(__dirname, "../../apps-script/104-invitation-writer/Code.gs"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

test("104 聯繫方式視窗有渲染時，即使 aria-hidden 為 true 仍可擷取資料", async () => {
  const label = textContent => ({ textContent, querySelectorAll: () => [] });
  const modal = {
    getAttribute: key => key === "aria-hidden" ? "true" : null,
    getBoundingClientRect: () => ({ width: 720, height: 480 }),
    querySelector: selector => label(selector.includes("title") ? "聯繫方式" : "E-mail 聯絡電話")
  };
  const context = vm.createContext({
    window: {},
    console: { log() {}, error() {} },
    setTimeout,
    clearTimeout,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    MutationObserver: class { observe() {} disconnect() {} },
    document: {
      documentElement: {},
      querySelectorAll(selector) {
        if (selector === "span.copy-content") return [label("00012345")];
        if (selector.includes("div.modal")) return [modal];
        return [];
      },
      querySelector(selector) {
        if (selector.includes("div:nth-child(3) > div.col-10")) return label("0912345678");
        if (selector.includes("div:nth-child(2) > div.col-10")) return label("name@example.test");
        if (selector.endsWith("div:nth-child(1) > div")) return label("測試人員");
        return null;
      }
    }
  });
  const source = readFileSync(join(__dirname, "../collector-content.js"), "utf8");
  vm.runInContext(source, context);
  const result = await context.window.__bunnyExtractOne();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.line, "測試人員\tname@example.test\t0912345678\t00012345");
});

test("逐頁取得職缺群組，保留同一人不同職缺並排除未分類分頁", async () => {
  const context = vm.createContext({
    ResumeTrainingLabels: require("../training-labels.js"),
    chrome: { runtime: { onMessage: { addListener() {} } }, tabs: { onRemoved: { addListener() {} } }, tabGroups: { query: async () => [
      { id: 1, title: "Sr.Java PG" }, { id: 2, title: "SA" }, { id: 3, title: "不合適" }
    ] } }
  });
  vm.runInContext(frontend, context);
  const scope = [1, 1, 2, 3, 2].map((groupId, id) => ({ id, groupId, windowId: 9 }));
  const draft = await context.RecruitingInvitation.prepare(scope);
  assert.deepEqual(plain(draft.contactTargets).map(tab => tab.id), [0, 1, 2, 4]);
  for (const tab of scope) {
    draft.capture(tab, tab.id === 4 ? "" : "測試人員\tname@example.test\t0912345678\t0001");
  }
  assert.deepEqual(plain(draft.getRows()).map(row => row.group), ["Sr.Java PG", "SA"]);
  assert.equal(draft.getSkipped(), 1);
  assert.deepEqual(plain(draft.getFailures()), ["第 5 頁（履歷資料不完整）"]);
});

test("五頁批次遇兩頁暫時讀不到時，重試後仍按分頁順序交付五筆", async () => {
  const attempts = new Map();
  const scope = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1, groupId: index < 2 ? 1 : 2, windowId: 9
  }));
  const context = vm.createContext({
    setTimeout: callback => queueMicrotask(callback),
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
      tabs: { onRemoved: { addListener() {} } },
      tabGroups: { query: async () => [{ id: 1, title: "Sr.QA" }, { id: 2, title: "SA" }] },
      scripting: {
        async executeScript({ target: { tabId }, files }) {
          if (files) return [];
          attempts.set(tabId, (attempts.get(tabId) || 0) + 1);
          if (tabId === 2 && attempts.get(tabId) === 1) throw new Error("分頁尚未可用");
          if (tabId === 5 && attempts.get(tabId) < 4) return [{ result: { ok: false } }];
          return [{ result: { ok: true, line: `測試 ${tabId}\tname@example.test\t0912345678\t000${tabId}` } }];
        }
      }
    }
  });
  vm.runInContext(frontend, context);
  vm.runInContext(readFileSync(join(__dirname, "../collector.js"), "utf8"), context);
  const draft = await context.RecruitingInvitation.prepare(scope);
  await context.RecruitingCollector.startCollection(draft.contactTargets, draft.capture);
  assert.deepEqual(plain(draft.getRows()).map(row => row.resumeCode), ["0001", "0002", "0003", "0004", "0005"]);
  assert.deepEqual(scope.map(tab => attempts.get(tab.id)), [1, 2, 1, 1, 4]);
  assert.deepEqual(plain(draft.getFailures()), []);
  assert.equal(draft.getSkipped(), 0);
});

test("僅對同一個開啟的 Google 部署頁交付暫存資料", async () => {
  const cache = {};
  let listener, url, closed, opened;
  const navigated = new Promise(resolve => { opened = resolve; });
  const context = vm.createContext({
    URL, URLSearchParams, crypto, setTimeout, clearTimeout,
    chrome: {
      storage: { session: {
        set: async entries => Object.assign(cache, entries),
        get: async key => ({ [key]: cache[key] }),
        remove: async key => { delete cache[key]; }
      } },
      runtime: { getURL: path => `chrome-extension://toolkit/${path}`, onMessage: { addListener: fn => { listener = fn; } } },
      tabs: {
        create: async options => { assert.equal(options.active, false); return { id: 5 }; },
        update: async (_, patch) => { assert.equal(patch.active, false); url = patch.url; opened(); },
        remove: async tabId => { closed = tabId; },
        onRemoved: { addListener() {} }
      }
    }
  });
  vm.runInContext(frontend, context);
  const writing = context.RecruitingInvitation.send([{}], 0, 9);
  await navigated;
  assert.match(url, /^https:\/\/script\.google\.com\/a\/macros\/hy-tech\.com\.tw\/s\/AK[\w-]+\/exec$/);
  const auth = await new Promise(resolve => {
    listener({ type: "TOOLKIT_GET_WRITER_URL" }, { url: "chrome-extension://toolkit/popup.html" }, resolve);
  });
  assert.deepEqual(plain(auth), { ok: true, url });
  const sender = { url: "https://example-script.googleusercontent.com/userCodeAppPanel", frameId: 1, tab: { id: 5, url } };
  const send = (from, type = "TOOLKIT_INVITE_PAYLOAD", batchId, firstRow, lastRow = firstRow) => new Promise(resolve => {
    const sheetUrl = "https://docs.google.com/spreadsheets/d/test/edit#gid=61635491&range=A42:I42";
    listener({ panel: "hytech-104-invite-writer", type, batchId, firstRow, lastRow, sheetUrl }, from, resolve);
  });
  assert.equal(await send({ ...sender, tab: { ...sender.tab, url: url.replace(/s\/[^/]+\/exec$/, "s/Other/exec") } }), null);
  assert.equal(await send({ ...sender, frameId: 0 }), null);
  assert.equal(await send({ ...sender, tab: { ...sender.tab, id: 6 } }), null);
  const inheritedFrame = { ...sender, url: "about:blank", origin: new URL(sender.url).origin };
  assert.equal(await send({ ...inheritedFrame, origin: "https://example.com" }), null);
  assert.equal(await send({ ...inheritedFrame, origin: "null" }), null);
  const batch = await send(inheritedFrame);
  assert.deepEqual(plain(await send(sender)), plain(batch));
  assert.equal(batch.rows.length, 1);
  await send(sender, "TOOLKIT_INVITE_ACK", "wrong-batch", 42);
  assert.equal(closed, undefined);
  await send(sender, "TOOLKIT_INVITE_ACK", batch.batchId, 42);
  assert.deepEqual(plain(await writing), { ok: true, firstRow: 42, count: 1, skipped: 0, sheetUrl: "https://docs.google.com/spreadsheets/d/test/edit#gid=61635491&range=A42:I42" });
  assert.equal(closed, 5);
  assert.equal(await send(sender), null);

  const partial = context.RecruitingInvitation.send([{}, {}], 0, 9);
  const rejected = assert.rejects(partial, /寫入筆數與本批不符/);
  while (!Object.keys(cache).length) await Promise.resolve();
  const nextBatch = await send(sender);
  await send(sender, "TOOLKIT_INVITE_ACK", nextBatch.batchId, 42);
  await rejected;
});

test("外層 Google 框架等待內頁並在回讀成功列號後回報", async () => {
  const sent = [];
  const scheduled = [];
  let mutation;
  let message;
  let loaded = false;
  const payload = { batchId: "test-batch", rows: [{ name: "測試人員" }] };
  const origin = "https://example-script.googleusercontent.com";
  const status = { textContent: "等待中" };
  const sheet = { href: "https://docs.google.com/spreadsheets/d/test/edit#gid=61635491" };
  const writer = {
    origin,
    document: { getElementById: id => ({ status, sheet })[id] || {} },
    MessageEvent: class { constructor(type, init) { Object.assign(this, init, { type }); } },
    dispatchEvent: event => { message = event; }
  };
  const frame = { get contentDocument() { return loaded ? writer.document : null; }, contentWindow: writer };
  vm.runInNewContext(bridge, {
    window: { origin },
    document: { getElementById: id => id === "userHtmlFrame" ? frame : null },
    setTimeout: callback => scheduled.push(callback),
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} disconnect() {} },
    chrome: { runtime: { sendMessage: async request => { sent.push(request); return payload; } } }
  });
  assert.equal(sent.length, 0);
  loaded = true;
  await scheduled.shift()();
  assert.equal(sent[0].type, "TOOLKIT_INVITE_PAYLOAD");
  assert.equal(message.source, writer);
  assert.deepEqual(plain(message.data.payload), payload);
  status.textContent = "正在登錄 1 筆資料…";
  mutation();
  assert.equal(sent.length, 1);
  status.textContent = "已由 Eric.J 登錄 1 筆，列號 42–42。";
  sheet.href += "&range=A42:I42";
  mutation();
  assert.equal(sent[1].type, "TOOLKIT_INVITE_ACK");
  assert.equal(sent[1].firstRow, "42");
  assert.equal(sent[1].lastRow, "42");
  assert.equal(sent[1].batchId, payload.batchId);
});

test("資料接在尚未補號的列之後，原子更新指定欄位並允許安全重試", () => {
  const headers = ["編號", "邀約人", "招募管道", "職稱", "測驗題目", "姓名", "E-Mail", "手機", "履歷編號"];
  const grid = [
    headers,
    [400, "Eric.J", "", "", "", "", "", "", ""],
    ["", "Eric.J", "", "", "", "", "", "", ""],
    ["", "", "", "", "保留的測驗題目", "", "", "", ""]
  ];
  const notes = new Map([[4, "保留的附註"]]);
  const requests = [];
  const sheet = {
    getSheetId: () => 61635491,
    getLastRow: () => 4,
    getMaxRows: () => 4,
    getRange: (row, col, count = 1, width = 1) => ({
      getDisplayValues: () => [headers],
      getValues: () => Array.from({ length: count }, (_, i) =>
        Array.from({ length: width }, (_, j) => grid[row + i - 1]?.[col + j - 1] ?? "")),
      getFormulas: () => Array.from({ length: count }, () => Array(width).fill("")),
      getNotes: () => Array.from({ length: count }, (_, i) => [notes.get(row + i) || ""]),
      getNote: () => notes.get(row) || ""
    })
  };
  const context = vm.createContext({
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => name === "邀約紀錄" ? sheet : null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => "Eric.Jiang@hy-tech.com.tw" }) },
    Sheets: { Spreadsheets: { batchUpdate: request => {
      requests.push(plain(request.requests));
      const note = request.requests.find(item => item.updateCells?.fields === "note").updateCells;
      notes.set(note.start.rowIndex + 1, note.rows[0].values[0].note);
    } } }
  });
  vm.runInContext(backend, context);
  const row = { name: "=2+2", email: "name@example.test", phone: "0912345678", resumeCode: "00123" };
  const payload = {
    batchId: "00000000-0000-0000-0000-000000000000",
    rows: [{ ...row, group: "Sr.Net PG" }, { ...row, group: "Jr.QA" }]
  };
  const result = plain(context.submitInvitations(payload));
  assert.deepEqual(result, { recruiter: "Eric.J", firstRow: 4, count: 2 });
  assert.deepEqual(requests[0][0].appendDimension, { sheetId: 61635491, dimension: "ROWS", length: 1 });
  const [roles, note, contacts] = requests[0].slice(1).map(request => request.updateCells);
  assert.deepEqual([roles.start.columnIndex, contacts.start.columnIndex], [1, 5]);
  assert.deepEqual(roles.rows[0].values.map(cell => cell.userEnteredValue.stringValue), ["Eric.J", "104邀約", "資深C#.Net軟體工程師"]);
  assert.deepEqual(contacts.rows[0].values.map(cell => cell.userEnteredValue.stringValue), Object.values(row));
  assert.match(note.rows[0].values[0].note, /^保留的附註\n104Toolkit /);
  assert.deepEqual(plain(context.submitInvitations(payload)), result);
  assert.equal(requests.length, 1);
  context.Session.getActiveUser = () => ({ getEmail: () => "Tammie.Lin@hy-tech.com.tw" });
  assert.equal(context.getRecruiter_(), "Tammie.L");
  context.Session.getActiveUser = () => ({ getEmail: () => "HRIntern@hy-tech.com.tw" });
  assert.equal(context.submitInvitations(payload).recruiter, "hrintern");
  context.Session.getActiveUser = () => ({ getEmail: () => "hr@hy-tech.com.tw" });
  assert.equal(context.submitInvitations(payload).recruiter, "hr");
  context.Session.getActiveUser = () => ({ getEmail: () => "hr@hy-tech.com.tw.example.test" });
  assert.throws(() => context.submitInvitations(payload), /公司 Google 帳號/);
  assert.equal(requests.length, 3);
  context.Session.getActiveUser = () => ({ getEmail: () => "" });
  assert.throws(() => context.submitInvitations(payload), /未提供目前帳號的電子郵件/);
});
