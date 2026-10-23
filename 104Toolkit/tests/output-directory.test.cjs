const test=require('node:test');
const assert=require('node:assert/strict');
const output=require('../output-directory.js');
function folder({permission='granted',fail=false}={}) {
 const files=new Map([['Test.pdf','existing']]);
 let aborted=false;
 const target={name:'測試資料夾',queryPermission:async()=>permission,getFileHandle:async(name,options)=>{
   if(!files.has(name)&&!options?.create)throw Object.assign(Error('不存在'),{name:'NotFoundError'});
   return{createWritable:async()=>{
     let content;
     return{write:async data=>{if(fail)throw Error('磁碟寫入失敗');content=data;},close:async()=>files.set(name,content),abort:async()=>{aborted=true;}};
   }};
 }};
 return{target,files,get aborted(){return aborted;}};
}
test('所選資料夾同名檔案保留，連續寫入使用不同名稱',async()=>{
 const f=folder();
 const results=await Promise.all([output.writeFile(f.target,'Test.pdf','new1'),output.writeFile(f.target,'Test.pdf','new2')]);
 assert.deepEqual(results.map(r=>r.filename),['Test (1).pdf','Test (2).pdf']);
 assert.equal(f.files.get('Test.pdf'),'existing');
 assert.equal(f.files.get('Test (2).pdf'),'new2');
});
test('沒有授權與跨資料夾檔名不會寫入其他位置',async()=>{
 const f=folder({permission:'denied'});
 await assert.rejects(output.writeFile(f.target,'Test.pdf','data'),/許可已失效/);
 await assert.rejects(output.writeFile(f.target,'../Test.pdf','data'),/檔名格式/);
 assert.equal(f.files.size,1);
});
test('寫入失敗會中止串流，後續工作仍可進行',async()=>{
 const bad=folder({fail:true});
 await assert.rejects(output.writeFile(bad.target,'new.pdf','data'),/磁碟/);
 assert.equal(bad.aborted,true);
 const good=folder();
 await output.writeFile(good.target,'new.pdf','data');
 assert.equal(good.files.get('new.pdf'),'data');
});
