const test=require('node:test');const assert=require('node:assert/strict');
const {selectRight}=require('../tab-scope.js');
const resume=(id,index,windowId=7)=>({id,index,windowId,url:`https://vip.104.com.tw/search/SearchResumeMaster?idno=TEST${id}`});
test('只選同視窗起點含本頁往右連續履歷，左側、其他視窗及隔開的履歷均不納入',()=>{
 const tabs=[resume(8,4),resume(1,0),resume(3,2),resume(2,1),{id:4,index:3,windowId:7,url:'https://example.com/'},resume(9,2,8)];
 assert.deepEqual(selectRight(tabs,2).map(tab=>tab.id),[2,3]);
});
test('拖曳後按實際索引選取，移動起點可縮小範圍',()=>{
 const tabs=[resume(1,0),resume(3,1),resume(2,2)];
 assert.deepEqual(selectRight(tabs,3).map(tab=>tab.id),[3,2]);
 assert.deepEqual(selectRight(tabs,2).map(tab=>tab.id),[2]);
});
test('起點不是履歷或已關閉時停止，不退回處理全部104分頁',()=>{
 assert.throws(()=>selectRight([resume(1,0)],99),/104 履歷/);
 assert.throws(()=>selectRight([{id:1,index:0,windowId:7,url:'https://vip.104.com.tw/search/searchResult'}],1),/104 履歷/);
});
