const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function harness({failSecond=false,stopAfterFirst=false,groupTitle="Jr.Java PG",selectedDirectory=false}={}) {
 const stored={settings:{subdir:'104履歷下載區/',filenamePrefixMode:'tabGroup',firstWait:0,nextWait:0}};
 const events=new Set();const downloads=[];let nextTab=100;
 const noopEvent={addListener(){},removeListener(){}};
 const context=vm.createContext({console,URL,Uint8Array,atob,btoa,
  setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms<1000?0:200);if(ms>=1000)timer.unref();return timer;},clearTimeout,setInterval,clearInterval,
  chrome:{
   action:new Proxy({},{get:()=>async()=>{}}),
   runtime:{onInstalled:noopEvent,onMessage:noopEvent},
   storage:{local:{get:async key=>({[key]:stored[key]}),set:async values=>Object.assign(stored,values)}},
   tabs:{query:async()=>[1,2,3].map(id=>({id,active:id===1,index:id-1,groupId:40,url:`https://vip.104.com.tw/search/SearchResumeMaster?idno=TEST${id}`})),
    create:async()=>({id:++nextTab}),get:async()=>({status:'complete'}),remove:async()=>{},onUpdated:noopEvent,onRemoved:noopEvent},
   tabGroups:{get:async()=>({title:groupTitle})},
   scripting:{executeScript:async opts=>{
    if(opts.func.toString().includes('new Promise'))return[{result:{success:true}}];
    if(opts.args)return[{result:failSecond&&opts.target.tabId===102?'':'Test'}];
    return[{result:true}];
   }},
   debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(_tab,cmd)=>{
    if(cmd==='Page.printToPDF')return{data:btoa('%PDF-test')};return{};
   }},
   downloads:{
    onChanged:{addListener:fn=>events.add(fn),removeListener:fn=>events.delete(fn)},
    download:async opts=>{
     downloads.push(opts);const id=downloads.length;
     if(opts.url.startsWith('data:application/pdf'))setImmediate(()=>{
      if(stopAfterFirst)context.RecruitingPdfExporter.requestStop();
      events.forEach(fn=>fn({id,state:{current:'complete'}}));
     });
     return id;
    },
    search:async({id})=>[{filename:`/Downloads/104履歷下載區/${groupTitle}_Test (${id}).pdf`}]
   }
  }});
 const fileWrites=[];
 context.RecruitingOutputDirectory={getTarget:async()=>selectedDirectory?{name:"訓練資料"}:null,writeFile:async(_target,filename,data)=>{
   fileWrites.push({filename,data});return{filename,path:`訓練資料/${filename}`,directWrite:true};
 }};
 context.TextEncoder=TextEncoder;
 const root=path.join(__dirname,'..');
 for(const file of ['training-labels.js','pdf-exporter.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 return {context,downloads,fileWrites};
}

test('實際 PDF 匯出流程使用職稱命名，CSV 對應實際重名序號與五分類',async()=>{
 const {context,downloads}=harness({failSecond:true});
 await context.ResumeTrainingLabels.save({idno:'TEST1'},'wronglyExcludedShouldRecommend');
 await context.RecruitingPdfExporter.runDownloadRightBatch();
 const pdfs=downloads.filter(d=>d.url.startsWith('data:application/pdf'));
 assert.equal(pdfs.length,2);
 assert.equal(pdfs[0].filename,'104履歷下載區/Jr.Java PG_Test.pdf');
 const csv=decodeURIComponent(downloads.find(d=>d.url.startsWith('data:text/csv')).url.split(',').slice(1).join(','));
 assert.ok(csv.includes('Jr.Java PG_Test (1).pdf'));
 assert.ok(csv.includes('不應排除應推薦'));
 assert.ok(csv.includes('未分類'));
 assert.ok(csv.includes('search:TEST3'));
 assert.ok(!csv.includes('search:TEST2'));
 assert.ok(context.RecruitingPdfExporter.getState().lastMessage.includes('分類清單已提交下載（2 筆）'));
});

test('停止匯出只將已完成的 PDF 列入分類 CSV',async()=>{
 const {context,downloads}=harness({stopAfterFirst:true});
 await context.RecruitingPdfExporter.runDownloadRightBatch();
 const csv=decodeURIComponent(downloads.find(d=>d.url.startsWith('data:text/csv')).url.split(',').slice(1).join(','));
 assert.ok(csv.includes('search:TEST1'));
 assert.ok(!csv.includes('search:TEST2'));
 assert.equal(downloads.filter(d=>d.url.startsWith('data:application/pdf')).length,1);
});

test('不合適群組仍可下載全部 PDF 並納入訓練分類 CSV',async()=>{
 const {context,downloads}=harness({groupTitle:'不合適'});
 await context.RecruitingPdfExporter.runDownloadRightBatch();
 const pdfs=downloads.filter(d=>d.url.startsWith('data:application/pdf'));
 assert.equal(pdfs.length,3);
 assert.ok(pdfs.every(d=>d.filename==='104履歷下載區/不合適_Test.pdf'));
 const csv=decodeURIComponent(downloads.find(d=>d.url.startsWith('data:text/csv')).url.split(',').slice(1).join(','));
 assert.ok(csv.includes('不合適_Test (1).pdf'));
 assert.ok(csv.includes('"不合適","未分類"'));
 assert.ok(csv.includes('search:TEST3'));
});

test('選擇資料夾後 PDF 與 CSV 使用同一位置，不走瀏覽器下載位置',async()=>{
 const {context,downloads,fileWrites}=harness({selectedDirectory:true});
 await context.RecruitingPdfExporter.runDownloadRightBatch();
 assert.equal(downloads.length,0);
 assert.equal(fileWrites.filter(f=>f.filename.endsWith('.pdf')).length,3);
 const csv=new TextDecoder().decode(fileWrites.find(f=>f.filename.endsWith('.csv')).data);
 assert.ok(csv.includes('訓練資料/Jr.Java PG_Test.pdf'));
 assert.ok(csv.includes('"true"'));
 assert.ok(context.RecruitingPdfExporter.getState().lastMessage.includes('分類清單已儲存'));
});
