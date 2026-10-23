const test=require('node:test');const assert=require('node:assert/strict');
let calls=[],members=[],fail=false;
global.chrome={runtime:{onMessage:{addListener(){}}},tabGroups:{query:async()=>[{id:80,title:'系統推薦'}],update:async(id,config)=>calls.push(['name',id,config.title])},tabs:{create:async options=>{if(fail&&calls.some(c=>c[0]==='create'))throw Error('test');const tab={id:members.length+1,index:members.length};members.push(tab);calls.push(['create',options.url]);return tab;},group:async options=>{calls.push(['group',options.groupId]);return options.groupId??90;},query:async()=>members,move:async()=>{},update:async()=>{}}};
const {openProfiles}=require('../screening-groups.js');
const sender={tab:{id:17,windowId:7,url:'https://vip.104.com.tw/search/searchResult?x=1'}};
const profile=(code,status)=>({resumeCode:code,status,url:`https://vip.104.com.tw/search/SearchResumeMaster?idno=${code}`});
test('依推薦、人工審核開啟分組；重用同名群組',async()=>{
 calls=[];members=[];fail=false;
 const result=await openProfiles({profiles:[profile('review','review_required'),profile('recommended','ranked')]},sender);
 assert.equal(result.ok,true);assert.deepEqual(result.openedCodes,['recommended','review']);
 assert.deepEqual(calls.filter(c=>c[0]==='group').map(c=>c[1]),[80,undefined]);
 assert.ok(calls.some(c=>c[0]==='name'&&c[2]==='人工審核'));
});
test('驗證整批網址與狀態，不開啟外站或排除結果',async()=>{
 calls=[];members=[];
 await assert.rejects(openProfiles({profiles:[profile('good','ranked'),{...profile('bad','ranked'),url:'https://example.com/'}]},sender));
 assert.equal(calls.length,0);
 await assert.rejects(openProfiles({profiles:[profile('excluded','excluded')]},sender));
});
test('部分失敗仍回報已開啟識別，避免重複開啟',async()=>{
 calls=[];members=[];fail=true;
 const result=await openProfiles({profiles:[profile('one','ranked'),profile('two','ranked')]},sender);
 assert.equal(result.ok,false);assert.deepEqual(result.openedCodes,['one']);fail=false;
});
