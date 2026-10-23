const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness({permission = 'prompt', grant = 'granted', missing = false, action = 'combined'} = {}) {
 const calls = [], elements = {};
 const ids = ['directoryLocation','directoryStatus','pickDirectory','authorizeExport','defaultDirectory','returnToResume'];
 for(const id of ids) elements[id] = { hidden: id === 'authorizeExport', textContent: '', disabled: false, addEventListener: (_event, fn) => { elements[id].click = fn; } };
 const handle = { queryPermission: async () => permission, requestPermission: async () => { calls.push(['request']); permission = grant; return grant; } };
 const context = vm.createContext({console, URL, location: {href:`https://tool.test/directory.html?returnTab=17&action=${action}`},document:{getElementById:id=>elements[id]},window:{},
  RecruitingOutputDirectory:{ status:async()=>({selected:true,name:'Test'}),getSavedHandle:async()=>missing?null:handle,getTarget:async()=>{calls.push(['target']);if(permission!=='granted')throw Error('需要授權');return handle;} },
  chrome:{tabs:{update:async id=>calls.push(['activate',id]),remove:async()=>calls.push(['close'])},runtime:{sendMessage:async m=>{calls.push(['start',m]);return {ok:true};}}}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../directory.js'),'utf8'),context);
 return { calls, elements };
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('暫時許可失效時只顯示授權按鈕，點擊授權後回原分頁啟動工作流且保留工具頁',async()=>{
 const h=harness();await tick();
 assert.equal(h.elements.authorizeExport.hidden,false);
 assert.equal(h.calls.length,0);
 await h.elements.authorizeExport.click();
 assert.deepEqual(h.calls.map(c=>c[0]),['request','target','activate','start']);
 assert.equal(h.calls[3][1].type,'TOOLKIT_START_COMBINED_RIGHT');
 assert.equal(h.elements.authorizeExport.hidden,true);
 await h.elements.returnToResume.click();
 assert.ok(!h.calls.some(c=>c[0]==='close'));
});
test('拒絕授權不會複製、匯出或跳回履歷，仍可再次授權',async()=>{
 const h=harness({grant:'denied'});await tick();await h.elements.authorizeExport.click();
 assert.deepEqual(h.calls.map(c=>c[0]),['request']);
 assert.match(h.elements.directoryStatus.textContent,/尚未開始複製或匯出/);
 assert.equal(h.elements.authorizeExport.disabled,false);
});
test('已授權時自動啟動純PDF匯出，不再次要求選擇資料夾',async()=>{
 const h=harness({permission:'granted',action:'downloadCurrent'});await tick();
 assert.deepEqual(h.calls.map(c=>c[0]),['target','activate','start']);
 assert.equal(h.calls[2][1].cmd,'downloadCurrent');
});
test('控制代碼遺失時提示重新選取，不自行改存其他位置',async()=>{
 const h=harness({missing:true});await tick();
 assert.equal(h.calls.length,0);
 assert.match(h.elements.directoryStatus.textContent,/請選擇資料夾/);
});
