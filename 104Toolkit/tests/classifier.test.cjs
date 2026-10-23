const assert = require("node:assert/strict");
const test = require("node:test");
let stored = {};
global.chrome = {
  runtime: { onConnect: { addListener() {} }, onMessage: { addListener() {} } },
  storage: { local: { get: async key => ({ [key]: stored[key] }), set: async value => Object.assign(stored, value), remove: async key => { delete stored[key]; } } },
  tabGroups: {}, tabs: {}
};
global.ResumeTrainingLabels = require("../training-labels.js");
const { CONFIG, classifyTab, getGroupConfig, handleMessage, isResumeTab } = require("../classifier.js");
const titles = ["系統推薦但不合適", "人工審核但需要推薦", "人工審核但應該排除", "不應排除需人工審核", "不應排除應推薦"];

test("五個訓練分類符合最新要求", () => {
  assert.deepEqual(Object.values(CONFIG.groups).map(c => c.title), titles);
  assert.throws(() => getGroupConfig("__proto__"), /不支援/);
});
test("標記不呼叫群組 API；同一履歷跨分頁仍讀到分類", async () => {
  chrome.tabs.group = async () => { throw Error("不應移動分頁"); };
  chrome.tabGroups.update = async () => { throw Error("不應改動群組"); };
  const url = "https://vip.104.com.tw/search/SearchResumeMaster?idno=TEST1";
  await classifyTab({ id: 1, windowId: 7, url }, "reviewedShouldRecommend");
  chrome.tabs.query = async () => [{ id: 9, windowId: 7, groupId: 40, url }];
  chrome.tabGroups.get = async () => ({ title: "Jr.Java PG" });
  const state = await handleMessage({ type: "TOOLKIT_GET_CLASSIFIER_STATE" });
  assert.equal(state.trainingLabel, "人工審核但需要推薦");
  assert.equal(state.groupTitle, "Jr.Java PG");
});
test("無法辨識履歷時拒絕保存，不能用暫時分頁 ID 取代", async()=>{
  await assert.rejects(classifyTab({id:2,url:"https://vip.104.com.tw/search/SearchResumeMaster"},"reviewedShouldExclude"),/無法辨識/);
});
test("無關網域不能取得履歷訓練標記",()=>{
  assert.equal(isResumeTab({url:"https://example.com/search/SearchResumeMaster?idno=1"}),false);
});
test("九個群組使用固定選單，不接受任意群組名稱", () => {
  assert.deepEqual(CONFIG.jobGroups, ["Jr.Net PG", "Sr.Net PG", "Jr.Java PG", "Sr.Java PG", "Jr.QA", "Sr.QA", "SA", "PM", "不合適"]);
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
