const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const frontend = readFileSync(join(__dirname, "../invitation.js"), "utf8");
const bridge = readFileSync(join(__dirname, "../invitation-bridge.js"), "utf8");
const backend = readFileSync(join(__dirname, "../../apps-script/104-invitation-writer/Code.gs"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

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
  assert.equal(draft.getSkipped(), 2);
});

test("僅對同一個開啟的 Google 部署頁交付暫存資料", async () => {
  const cache = {};
  let listener, url, closed, opened;
  const navigated = new Promise(resolve => { opened = resolve; });
  const context = vm.createContext({
    URL, crypto, setTimeout, clearTimeout,
    chrome: {
      storage: { session: {
        set: async entries => Object.assign(cache, entries),
        get: async key => ({ [key]: cache[key] }),
        remove: async key => { delete cache[key]; }
      } },
      runtime: { onMessage: { addListener: fn => { listener = fn; } } },
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
  const sender = { url: "https://example-script.googleusercontent.com/userCodeAppPanel", frameId: 1, tab: { id: 5, url } };
  const send = (from, type = "TOOLKIT_INVITE_PAYLOAD", batchId, firstRow) => new Promise(resolve => {
    listener({ panel: "hytech-104-invite-writer", type, batchId, firstRow }, from, resolve);
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
  assert.deepEqual(plain(await writing), { ok: true, firstRow: 42, count: 1, skipped: 0 });
  assert.equal(closed, 5);
  assert.equal(await send(sender), null);
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
  const settings = { getLastRow: () => 2, getRange: () => ({ getDisplayValues: () => [["Eric.J"]] }) };
  const context = vm.createContext({
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => name === "設定" ? settings : sheet }) },
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
  context.Session.getActiveUser = () => ({ getEmail: () => "eric.jiang@gmail.com" });
  assert.throws(() => context.submitInvitations(payload), /公司 Google 帳號/);
});
