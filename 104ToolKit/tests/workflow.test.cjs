const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const workflowSource = fs.readFileSync(
  path.join(__dirname, "..", "workflow.js"),
  "utf8"
);

function createHarness({ rows = ["王小明\tmail@example.com\t0900000000\tR001"] } = {}) {
  const storage = {};
  const listeners = [];
  const calls = [];
  const collectorState = { running: false, stopRequested: false, rows };
  const pdfState = { running: false, stopRequested: false, lastMessage: "完成：成功 1/1" };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    chrome: {
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
      async startCollection(mode) {
        calls.push(["collect", mode]);
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
      async runDownloadRightBatch() {
        calls.push(["export", "right"]);
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

  return { calls, dispatch, storage };
}

async function waitForWorkflowToSettle(harness) {
  for (let index = 0; index < 20; index += 1) {
    const result = await harness.dispatch({ type: "TOOLKIT_GET_WORKFLOW_STATE" });
    if (!result.state.running && ["done", "error", "stopped"].includes(result.state.phase)) {
      return result.state;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("工作流未在預期時間內完成");
}

test("整合工作流會先複製、回到起始分頁，再匯出 PDF", async () => {
  const harness = createHarness();
  const response = await harness.dispatch({ type: "TOOLKIT_START_COMBINED_RIGHT" });
  assert.equal(response.ok, true);

  const state = await waitForWorkflowToSettle(harness);
  assert.equal(state.phase, "done");
  assert.deepEqual(
    harness.calls.filter(([name]) => ["collect", "activate", "export"].includes(name)),
    [
      ["collect", "right"],
      ["activate", 17, true],
      ["export", "right"]
    ]
  );
});

test("沒有聯絡資料時不會繼續匯出 PDF", async () => {
  const harness = createHarness({ rows: [] });
  const response = await harness.dispatch({ type: "TOOLKIT_START_COMBINED_RIGHT" });
  assert.equal(response.ok, true);

  const state = await waitForWorkflowToSettle(harness);
  assert.equal(state.phase, "error");
  assert.match(state.error, /沒有取得可複製的聯絡資料/);
  assert.equal(harness.calls.some(([name]) => name === "export"), false);
});
