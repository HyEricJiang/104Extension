const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWorker() {
  const connections = [];
  const messages = [];
  const groups = [];
  const storage = {};
  const actions = new Proxy({}, { get: () => async () => {} });
  const context = vm.createContext({
    console, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    chrome: {
      action: actions,
      storage: {local: {get: async key => ({[key]: storage[key]}), set: async value => Object.assign(storage,value)}},
      runtime: {
        onInstalled: {addListener: () => {}},
        onMessage: {addListener: fn => messages.push(fn)},
        onConnect: {addListener: fn => connections.push(fn)},
        sendMessage: async () => ({ok:true})
      },
      tabs: {query: async () => [{id:17,windowId:7,groupId:-1,url:'https://vip.104.com.tw/search/SearchResumeMaster?idno=TEST1'}],
        group: async () => 40},
      tabGroups: {query: async () => groups, update: async (id,group) => groups.push({id,...group})}
    }
  });
  const root = path.join(__dirname,'..');
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context,{filename:'background.js'});
  return {connections,messages,context};
}

function request(worker, message) {
  return new Promise((resolve,reject) => {
    let receive;
    const timer=setTimeout(()=>reject(Error('分類服務沒有回覆')),1000);
    const port={name:'toolkit-classifier',onMessage:{addListener: fn => {receive=fn;}},postMessage: result => {clearTimeout(timer);resolve(result);}};
    worker.connections.forEach(fn=>fn(port));
    assert.equal(typeof receive,'function');
    receive(message);
  });
}

test('完整背景入口載入分類通道，初始化取得五個分類', async()=>{
  const worker=loadWorker();
  const state=await request(worker,{type:'TOOLKIT_GET_CLASSIFIER_STATE'});
  assert.equal(state.ok,true);
  assert.equal(state.canClassify,true);
  assert.deepEqual(Object.values(state.categories).map(c=>c.title),['系統推薦但不合適','人工審核但需要推薦','人工審核但應該排除','不應排除需人工審核','不應排除應推薦']);
});

test('透過專用通道可下標籤，且其他訊息監聽器不會攔截回覆', async()=>{
  const worker=loadWorker();
  worker.messages.push((_message,_sender,reply)=>reply({ok:false,error:'其他模組回覆'}));
  const result=await request(worker,{type:'CLASSIFY_CURRENT_TAB',categoryId:'wronglyExcludedShouldRecommend'});
  assert.equal(result.ok,true);
  assert.equal(result.trainingLabel,'不應排除應推薦');
});

test('分類通道回傳操作失敗原因，不回傳空白',async()=>{
  const worker=loadWorker();
  const result=await request(worker,{type:'CLASSIFY_CURRENT_TAB',categoryId:'unknown'});
  assert.equal(result.ok,false);
  assert.match(result.error,/不支援/);
});

function popupRequest({ disconnect = false, timeout = false } = {}) {
  const source=fs.readFileSync(path.join(__dirname,'..','popup.js'),'utf8');
  const functionSource=source.slice(source.indexOf('function sendClassification('),source.indexOf('async function send(message)'));
  let onMessage, onDisconnect;
  const port={
    onMessage:{addListener:fn=>{onMessage=fn;}},
    onDisconnect:{addListener:fn=>{onDisconnect=fn;}},
    disconnect() {},
    postMessage() {
      if (timeout) return;
      if (disconnect) queueMicrotask(()=>onDisconnect());
      else queueMicrotask(()=>onMessage({ok:true,canClassify:true}));
    }
  };
  const context=vm.createContext({
    chrome:{runtime:{connect: ({name})=>{assert.equal(name,'toolkit-classifier');return port;}}},
    setTimeout:fn=>setTimeout(fn,20),clearTimeout
  });
  vm.runInContext(functionSource,context);
  return context.sendClassification({type:'TOOLKIT_GET_CLASSIFIER_STATE'});
}

test('Popup 初始化使用分類專用連線取得回覆',async()=>{
  assert.equal((await popupRequest()).ok,true);
});
test('分類服務未載入時，提示重新載入擴充功能',async()=>{
  await assert.rejects(popupRequest({disconnect:true}),/重新載入/);
});
test('分類服務沒有回覆時，會逾時並顯示可操作提示',async()=>{
  await assert.rejects(popupRequest({timeout:true}),/逾時/);
});

test('職缺分組訊息透過完整背景服務的專用連線執行',async()=>{
  const result=await request(loadWorker(),{type:'TOOLKIT_GROUP_JOB_TAB',groupTitle:'Sr.QA'});
  assert.equal(result.ok,true);
  assert.equal(result.groupTitle,'Sr.QA');
  assert.equal(result.created,true);
});
