const assert = require("node:assert/strict");
const test = require("node:test");

global.chrome = {
  runtime: {
    onConnect: { addListener() {} },
    onMessage: {
      addListener() {},
    },
  },
  tabGroups: {},
  tabs: {},
};

const { CONFIG, classifyTab, getGroupConfig } = require("../classifier.js");

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
  assert.throws(() => getGroupConfig("__proto__"), /不支援這個分類選項/);
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

const { handleMessage, isResumeTab } = require("../classifier.js");

test("Popup 沒有 sender.tab 仍可分類目前履歷分頁", async () => {
  chrome.tabs.query = async () => [{ id: 18, windowId: 7, url: "https://vip.104.com.tw/search/SearchResumeMaster?x=1" }];
  chrome.tabGroups.query = async () => [];
  chrome.tabs.group = async options => { assert.equal(options.tabIds, 18); return 88; };
  chrome.tabGroups.update = async () => {};
  global.RecruitingWorkflow = { getState: () => ({ running: false }) };
  global.RecruitingCollector = { getState: async () => ({ running: false }) };
  global.RecruitingPdfExporter = { getState: () => ({ running: false }) };
  const result = await handleMessage({ type: "CLASSIFY_CURRENT_TAB", categoryId: "reviewedSuitable" });
  assert.equal(result.groupTitle, "人工審核但合適");
});

test("匯出中拒絕分類，避免群組移動干擾分頁順序", async () => {
  global.RecruitingPdfExporter = { getState: () => ({ running: true }) };
  await assert.rejects(handleMessage({ type: "CLASSIFY_CURRENT_TAB", categoryId: "excludedRecommended" }), /等待目前/);
});

test("分類限制在 104 履歷頁，拒絕相似網域與無關頁面", () => {
  for (const url of ["https://vip.104.com.tw.evil.test/search/SearchResumeMaster", "https://vip.104.com.tw/", "https://example.com/"]) {
    assert.equal(isResumeTab({ url }), false);
  }
  assert.equal(isResumeTab({url: "https://vip.104.com.tw/Apply/ApplyResume?id=1"}), true);
});

test("快速分類同一視窗會共用新建群組", async () => {
  let groups = [], creates = 0;
  chrome.tabGroups.query = async () => groups;
  chrome.tabs.group = async options => {
    if (!options.groupId) { creates++; groups = [{ id: 90, title: "排除但推薦" }]; }
    return 90;
  };
  chrome.tabGroups.update = async () => {};
  await Promise.all([classifyTab({ id: 1, windowId: 9 }, "excludedRecommended"), classifyTab({ id: 2, windowId: 9 }, "excludedRecommended")]);
  assert.equal(creates, 1);
});

test("八個職缺使用固定選單，不接受任意群組名稱", () => {
  assert.deepEqual(CONFIG.jobGroups, ["Jr.Net PG", "Sr.Net PG", "Jr.Java PG", "Sr.Java PG", "Jr.QA", "Sr.QA", "SA", "PM"]);
});

test("職缺分組可處理目前網頁，加入既有群組並保留原顏色", async () => {
  const calls=[];
  chrome.tabs.query=async()=>[{id:27,windowId:8,groupId:-1,url:"https://example.com/job"}];
  chrome.tabGroups.query=async()=>[{id:65,title:"Jr.Java PG",color:"red"}];
  chrome.tabs.group=async options=>{calls.push(options);return 65;};
  chrome.tabGroups.update=async()=>{throw Error("不可改動既有群組外觀");};
  global.RecruitingCollector={getState:async()=>({running:false})};
  global.RecruitingPdfExporter={getState:()=>({running:false})};
  global.RecruitingWorkflow={getState:()=>({running:false})};
  const result=await handleMessage({type:"TOOLKIT_GROUP_JOB_TAB",groupTitle:"Jr.Java PG"});
  assert.equal(result.ok,true);
  assert.equal(result.created,false);
  assert.deepEqual(calls,[{groupId:65,tabIds:27}]);
});

test("不存在的職缺群組會建立並加入目前分頁", async()=>{
  const calls=[];
  chrome.tabGroups.query=async()=>[];
  chrome.tabs.group=async options=>{calls.push(options);return 70;};
  chrome.tabGroups.update=async(id,changes)=>calls.push({id,...changes});
  const result=await handleMessage({type:"TOOLKIT_GROUP_JOB_TAB",groupTitle:"SA"});
  assert.equal(result.created,true);
  assert.deepEqual(calls,[{createProperties:{windowId:8},tabIds:27},{id:70,title:"SA",color:"grey",collapsed:false}]);
});

test("職缺分組拒絕未知名稱、瀏覽器內部頁面與執行中工作",async()=>{
  await assert.rejects(handleMessage({type:"TOOLKIT_GROUP_JOB_TAB",groupTitle:"unknown"}),/有效的職缺/);
  chrome.tabs.query=async()=>[{id:27,windowId:8,url:"chrome://extensions"}];
  await assert.rejects(handleMessage({type:"TOOLKIT_GROUP_JOB_TAB",groupTitle:"PM"}),/切換到/);
  chrome.tabs.query=async()=>[{id:27,windowId:8,url:"https://example.com/"}];
  global.RecruitingWorkflow={getState:()=>({running:true})};
  await assert.rejects(handleMessage({type:"TOOLKIT_GROUP_JOB_TAB",groupTitle:"PM"}),/等待目前/);
});
