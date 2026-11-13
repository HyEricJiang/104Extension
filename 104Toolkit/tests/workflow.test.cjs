const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const workflowSource = fs.readFileSync(
  path.join(__dirname, "..", "workflow.js"),
  "utf8"
);

function createHarness({ permissionError = false, pdfFailure = false, trainingOnly = false, failures = [], rows = ["王小明\tmail@example.com\t0900000000\tR001"] } = {}) {
  const storage = {};
  const listeners = [];
  const calls = [];
  let collectedScope, exportedScope, submittedRows, submittedSource, exportedSource;
  const collectorState = { running: false, stopRequested: false, rows };
  const pdfState = { running: false, stopRequested: false, lastMessage: "完成：成功 1/1" };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    RecruitingInvitation: {
      prepare: async scope => ({
        contactTargets: trainingOnly ? [] : scope,
        capture() {},
        getRows: () => trainingOnly ? [] : rows,
        getSkipped: () => 0,
        getFailures: () => failures
      }),
      send: async (items, _skipped, _windowId, source) => {
        submittedRows = items;
        submittedSource = source;
        calls.push(["submit"]);
        return { firstRow: 10, count: items.length };
      }
    },
    RecruitingTabScope: {capture: async originId => {calls.push(["scope",originId]);return [{id:originId}];}},
    RecruitingOutputDirectory: { getTarget: async () => { calls.push(["permission"]); if (permissionError) throw Error("資料夾需要授權"); return null; } },
    chrome: {
      action: { setBadgeText: async ({text}) => calls.push(["badge", text]), setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
      storage: {
        local: {
          async get(key) {
            return { [key]: storage[key] };
          },
          async set(value) {
            Object.assign(storage, value);
          }
        }
      },
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          }
        },
        async sendMessage(message) {
          calls.push(["notify", message.type]);
          return { ok: true };
        }
      },
      tabs: {
        async query() {
          return [{ id: 17, active: true }];
        },
        async update(tabId, update) {
          calls.push(["activate", tabId, update.active]);
        }
      }
    },
    RecruitingCollector: {
      async getState() {
        return { ...collectorState };
      },
      async startCollection(targets) {
        collectedScope = targets;
        calls.push(["collect"]);
      },
      async pause() {
        collectorState.stopRequested = true;
        calls.push(["pause-collector"]);
      }
    },
    RecruitingPdfExporter: {
      getState() {
        return { ...pdfState };
      },
      async runDownloadRightBatch(targets, source) {
        if (permissionError) throw new Error("資料夾需要授權");
        exportedScope = targets;
        exportedSource = source;
        calls.push(["export", "right"]);
        if (pdfFailure) { pdfState.exportSummary = { fail: 1 }; pdfState.lastMessage = "部分 PDF 匯出失敗"; }
      },
      requestStop() {
        pdfState.stopRequested = true;
        calls.push(["stop-pdf"]);
      }
    }
  };

  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(workflowSource, context);

  async function dispatch(message) {
    const listener = listeners[0];
    return new Promise((resolve, reject) => {
      const accepted = listener(message, {}, resolve);
      if (!accepted) reject(new Error("訊息未被工作流接收"));
    });
  }

  return { calls, dispatch, storage, get submittedRows() { return submittedRows; }, get scopes(){return [collectedScope,exportedScope];}, get sources() { return [submittedSource, exportedSource]; } };
}

async function waitForWorkflowToSettle(harness) {
  for (let index = 0; index < 20; index += 1) {
    const result = await harness.dispatch({ type: "TOOLKIT_GET_WORKFLOW_STATE" });
    if (!result.state.running && ["done", "submitted", "error", "stopped"].includes(result.state.phase)) {
      return result.state;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("工作流未在預期時間內完成");
}

test("整合工作流先確認 Google 寫入列，再於背景匯出 PDF", async () => {
  const rows = ["row1", "row2", "row3", "row4", "row5"];
  const harness = createHarness({ rows });
  const response = await harness.dispatch({ type: "TOOLKIT_START_COMBINED_RIGHT", source: "104主動投遞" });
  assert.equal(response.ok, true);

  const state = await waitForWorkflowToSettle(harness);
  assert.equal(state.phase, "done");
  assert.equal(state.savedCount, 5);
  assert.match(state.lastMessage, /第 10–14 列/);
  assert.deepEqual(harness.submittedRows, rows);
  assert.deepEqual(harness.sources, ["104主動投遞", "104主動投遞"]);
  assert.deepEqual(
    harness.calls.filter(([name]) => ["collect", "activate", "export", "submit"].includes(name)),
    [
      ["collect"],
      ["submit"],
      ["export", "right"]
    ]
  );
});

test("聯絡資料無法讀取時仍可匯出 PDF，並回報登錄未完成", async () => {
  const harness = createHarness({ rows: [], failures: ["第 1 頁（聯繫方式未載入）"] });
  const response = await harness.dispatch({ type: "TOOLKIT_START_COMBINED_RIGHT" });
  assert.equal(response.ok, true);

  const state = await waitForWorkflowToSettle(harness);
  assert.equal(state.phase, "error");
  assert.match(state.lastMessage, /未寫入邀約紀錄/);
  assert.match(state.error, /第 1 頁/);
  assert.equal(harness.calls.some(([name]) => name === "submit"), false);
  assert.equal(harness.calls.some(([name]) => name === "export"), true);
});

test("五頁只讀到三頁時，整批不寫入，仍可匯出 PDF", async () => {
  const harness = createHarness({ rows: ["row1", "row2", "row3"], failures: ["第 2 頁", "第 5 頁"] });
  await harness.dispatch({ type: "TOOLKIT_START_COMBINED_RIGHT" });
  const state = await waitForWorkflowToSettle(harness);
  assert.equal(state.phase, "error");
  assert.equal(state.savedCount, 0);
  assert.equal(state.firstRow, 0);
  assert.match(state.lastMessage, /本批未寫入/);
  assert.match(state.error, /2 頁讀取失敗.*第 2 頁、第 5 頁/);
  assert.ok(!harness.calls.some(([name]) => name === "submit"));
  assert.ok(harness.calls.some(([name]) => name === "export"));
});


test("資料夾尚未授權也會先完成 Google 登錄", async () => {
  const h = createHarness({ permissionError: true });
  await h.dispatch({ type: "TOOLKIT_START_COMBINED_RIGHT" });
  const state = await waitForWorkflowToSettle(h);
  assert.equal(state.phase, "error");
  assert.equal(state.savedCount, 1);
  assert.equal(state.firstRow, 10);
  assert.match(state.error, /資料夾需要授權/);
  assert.ok(!h.calls.some(([name, text]) => name === "badge" && text === "OK"));
});
test("PDF 部分失敗仍提交邀約，並顯示實際的匯出結果", async () => {
  const h = createHarness({ pdfFailure: true });
  await h.dispatch({ type: "TOOLKIT_START_COMBINED_RIGHT" });
  const state = await waitForWorkflowToSettle(h);
  assert.equal(state.phase, "error");
  assert.match(state.lastMessage, /PDF 匯出失敗/);
  assert.ok(h.calls.some(([name]) => name === "submit"));
  assert.ok(h.calls.some(([name, text]) => name === "badge" && text === "PDF"));
  assert.ok(!h.calls.some(([name, text]) => name === "badge" && text === "OK"));
});

test("工作流固定指定起點，收集與匯出共用同一份範圍，不以收集後作用分頁重算",async()=>{
 const h=createHarness();
 await h.dispatch({type:'TOOLKIT_START_COMBINED_RIGHT',originTabId:42});
 const state=await waitForWorkflowToSettle(h);
 assert.equal(state.phase,'done');
 assert.ok(h.calls.some(call=>call[0]==='scope'&&call[1]===42));
 assert.strictEqual(h.scopes[0],h.scopes[1]);
 assert.equal(h.scopes[0][0].id,42);
});


test("只登錄本頁會略過 PDF 檔案設定與匯出", async () => {
  const h = createHarness({ permissionError: true });
  await h.dispatch({ type: "TOOLKIT_START_INVITE_CURRENT", originTabId: 42 });
  const state = await waitForWorkflowToSettle(h);
  assert.equal(state.phase, "done");
  assert.deepEqual(h.calls.filter(([name]) => ["collect", "permission", "export", "submit"].includes(name)), [
    ["collect"], ["submit"]
  ]);
});


test("不合適批次即使無聯絡資料也匯出訓練 PDF，略過收集及登錄", async () => {
  const h = createHarness({ trainingOnly: true, rows: [] });
  await h.dispatch({ type: "TOOLKIT_START_COMBINED_RIGHT", originTabId: 42 });
  const state = await waitForWorkflowToSettle(h);
  assert.equal(state.phase, "done");
  assert.deepEqual(h.calls.filter(([name]) => ["collect", "export", "submit"].includes(name)), [["export", "right"]]);
});


test("只登錄本頁往右使用批次寫入，並回報 Google 確認的列號", async () => {
  const h = createHarness({ rows: ["row1", "row2"] });
  await h.dispatch({ type: "TOOLKIT_START_INVITE_RIGHT", originTabId: 42, source: "校園徵才" });
  const state = await waitForWorkflowToSettle(h);
  assert.equal(state.phase, "done");
  assert.equal(state.savedCount, 2);
  assert.deepEqual(h.sources, ["校園徵才", undefined]);
  assert.match(state.lastMessage, /第 10–11 列/);
  assert.deepEqual(h.calls.filter(([name]) => ["collect", "activate", "export", "submit"].includes(name)), [
    ["collect"], ["submit"]
  ]);
});
