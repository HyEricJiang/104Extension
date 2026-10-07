const assert = require("node:assert/strict");
const test = require("node:test");

global.chrome = {
  runtime: {
    onMessage: {
      addListener() {},
    },
  },
  tabGroups: {},
  tabs: {},
};

const { CONFIG, classifyTab, getGroupConfig } = require("../background.js");

test("三個分類都有固定的群組名稱與 Chrome 支援顏色", () => {
  assert.deepEqual(
    Object.values(CONFIG.groups).map(({ title, color }) => ({ title, color })),
    [
      { title: "推薦但不合適", color: "yellow" },
      { title: "人工審核但合適", color: "blue" },
      { title: "排除但推薦", color: "purple" },
    ],
  );
});

test("拒絕未定義的分類代碼", () => {
  assert.throws(() => getGroupConfig("unknown"), /不支援這個分類選項/);
});

test("找到同名群組時直接加入，不建立新群組", async () => {
  const calls = [];
  chrome.tabGroups.query = async (query) => {
    calls.push(["query", query]);
    return [{ id: 41, title: "推薦但不合適", windowId: 7 }];
  };
  chrome.tabs.group = async (options) => {
    calls.push(["group", options]);
    return 41;
  };
  chrome.tabGroups.update = async (groupId, changes) => {
    calls.push(["update", groupId, changes]);
  };

  const result = await classifyTab(
    { id: 15, windowId: 7 },
    "recommendedUnsuitable",
  );

  assert.equal(result.created, false);
  assert.deepEqual(calls, [
    ["query", { windowId: 7 }],
    ["group", { groupId: 41, tabIds: 15 }],
    [
      "update",
      41,
      { title: "推薦但不合適", color: "yellow", collapsed: false },
    ],
  ]);
});

test("找不到同名群組時建立、命名並加入", async () => {
  const calls = [];
  chrome.tabGroups.query = async () => [];
  chrome.tabs.group = async (options) => {
    calls.push(["group", options]);
    return 88;
  };
  chrome.tabGroups.update = async (groupId, changes) => {
    calls.push(["update", groupId, changes]);
  };

  const result = await classifyTab(
    { id: 21, windowId: 9 },
    "excludedRecommended",
  );

  assert.equal(result.created, true);
  assert.equal(result.groupTitle, "排除但推薦");
  assert.deepEqual(calls, [
    ["group", { createProperties: { windowId: 9 }, tabIds: 21 }],
    [
      "update",
      88,
      { title: "排除但推薦", color: "purple", collapsed: false },
    ],
  ]);
});
