const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function harness({failSecond=false,stopAfterFirst=false,groupTitle="Jr.Java PG",selectedDirectory=false,failTraining=false,candidateName="Test",prefixMode="tabGroup"}={}) {
 const stored={settings:{subdir:'104履歷下載區/',filenamePrefixMode:prefixMode,filenamePrefix:'Manual',filenameSuffix:'104',firstWait:0,nextWait:0}};
 const events=new Set();const downloads=[];let nextTab=100;let printCount=0;
 const noopEvent={addListener(){},removeListener(){}};
 const context=vm.createContext({console,URL,Uint8Array,atob,btoa,
  setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms<1000?0:200);if(ms>=1000)timer.unref();return timer;},clearTimeout,setInterval,clearInterval,
  chrome:{
   action:new Proxy({},{get:()=>async()=>{}}),
   runtime:{onInstalled:noopEvent,onMessage:noopEvent},
   storage:{local:{get:async key=>({[key]:stored[key]}),set:async values=>Object.assign(stored,values),remove:async key=>{delete stored[key];}}},
   tabs:{query:async()=>[1,2,3].map(id=>({id,active:id===1,index:id-1,groupId:40,url:`https://vip.104.com.tw/search/SearchResumeMaster?idno=TEST${id}`})),
    create:async()=>({id:++nextTab}),get:async()=>({status:'complete'}),remove:async()=>{},onUpdated:noopEvent,onRemoved:noopEvent},
   tabGroups:{get:async()=>({title:groupTitle})},
   scripting:{executeScript:async opts=>{
    if(opts.func.toString().includes('new Promise'))return[{result:{success:true}}];
    if(opts.args)return[{result:failSecond&&opts.target.tabId===102?'':candidateName}];
    return[{result:true}];
   }},
   debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(_tab,cmd)=>{
    if(cmd==='Page.printToPDF'){printCount++;return{data:btoa('%PDF-test')};}return{};
   }},
   downloads:{
    onChanged:{addListener:fn=>events.add(fn),removeListener:fn=>events.delete(fn)},
    download:async opts=>{
     if(failTraining&&opts.filename.includes("AI訓練資料"))throw Error("測試寫入失敗");
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
   if(failTraining&&filename.startsWith("AI訓練資料"))throw Error("測試寫入失敗");
   fileWrites.push({filename,data});return{filename,path:`訓練資料/${filename}`,directWrite:true};
 }};
 context.TextEncoder=TextEncoder;
 const root=path.join(__dirname,'..');
 for(const file of ['training-labels.js','pdf-exporter.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 return {context,downloads,fileWrites,get printCount(){return printCount;}};
}

test('混合批次：有標籤產生一般與訓練兩版；未標記一版；失敗履歷不產生檔案或CSV',async()=>{
 const h=harness({failSecond:true,prefixMode:'manual'});
 await h.context.ResumeTrainingLabels.save({idno:'TEST1'},'wronglyExcludedShouldRecommend');
 await h.context.RecruitingPdfExporter.runDownloadRightBatch();
 assert.deepEqual(h.downloads.map(d=>d.filename),[
  '104履歷下載區/Jr.Java PG_Test_104.pdf',
  '104履歷下載區/AI訓練資料_不應排除應推薦_Test.pdf',
  '104履歷下載區/Jr.Java PG_Test_104.pdf'
 ]);
 assert.ok(h.downloads.every(d=>d.url.startsWith('data:application/pdf')));
 assert.equal(h.downloads[0].url,h.downloads[1].url);
 assert.equal(h.printCount,2);
 assert.ok(h.context.RecruitingPdfExporter.getState().lastMessage.includes('一般履歷 2 份，AI 訓練資料 1 份'));
});

test('停止後不處理下一位，已開始的有標籤履歷仍完成兩個版本',async()=>{
 const h=harness({stopAfterFirst:true});
 await h.context.ResumeTrainingLabels.save({idno:'TEST1'},'reviewedShouldRecommend');
 await h.context.RecruitingPdfExporter.runDownloadRightBatch();
 assert.equal(h.downloads.length,2);
 assert.ok(h.downloads[1].filename.includes('AI訓練資料_人工審核但需要推薦_Test.pdf'));
 assert.equal(h.printCount,1);
 assert.ok(h.context.RecruitingPdfExporter.getState().lastMessage.includes('已停止'));
});

test('不合適群組未標記時只下載一般履歷；所有下載都為PDF',async()=>{
 const h=harness({groupTitle:'不合適'});
 await h.context.RecruitingPdfExporter.runDownloadRightBatch();
 assert.equal(h.downloads.length,3);
 assert.ok(h.downloads.every(d=>d.filename==='104履歷下載區/不合適_Test_104.pdf'));
 assert.ok(h.downloads.every(d=>d.url.startsWith('data:application/pdf')));
});

test('選擇資料夾後五種標籤皆以固定檔名存入，沿用同一PDF內容',async()=>{
 for(const [category,label] of Object.entries({systemRecommendedUnsuitable:'系統推薦但不合適',reviewedShouldRecommend:'人工審核但需要推薦',reviewedShouldExclude:'人工審核但應該排除',wronglyExcludedNeedsReview:'不應排除需人工審核',wronglyExcludedShouldRecommend:'不應排除應推薦'})){
  const h=harness({selectedDirectory:true});
  await h.context.ResumeTrainingLabels.save({idno:'TEST1'},category);
  await h.context.RecruitingPdfExporter.runDownloadCurrent();
  assert.equal(h.downloads.length,0);
  assert.deepEqual(h.fileWrites.map(f=>f.filename),['Jr.Java PG_Test_104.pdf',`AI訓練資料_${label}_Test.pdf`]);
  assert.deepEqual(h.fileWrites[0].data,h.fileWrites[1].data);
  assert.equal(h.printCount,1);
 }
});

test('移除標籤後只產生一般履歷，不再產生訓練版',async()=>{
 const h=harness({selectedDirectory:true});
 await h.context.ResumeTrainingLabels.save({idno:'TEST1'},'reviewedShouldExclude');
 await h.context.ResumeTrainingLabels.remove({idno:'TEST1'});
 await h.context.RecruitingPdfExporter.runDownloadCurrent();
 assert.deepEqual(h.fileWrites.map(f=>f.filename),['Jr.Java PG_Test_104.pdf']);
});

test('訓練版儲存失敗會記為失敗，一般版保留且不重印',async()=>{
 const h=harness({selectedDirectory:true,failTraining:true});
 await h.context.ResumeTrainingLabels.save({idno:'TEST1'},'reviewedShouldExclude');
 await h.context.RecruitingPdfExporter.runDownloadCurrent();
 assert.equal(h.fileWrites.length,1);
 assert.equal(h.printCount,1);
 assert.ok(h.context.RecruitingPdfExporter.getState().lastMessage.includes('失敗 1'));
 assert.ok(h.context.RecruitingPdfExporter.getState().lastMessage.includes('一般履歷 1 份，AI 訓練資料 0 份'));
});

test('未加入群組時沿用手動前綴，訓練版不帶一般後綴',async()=>{
 const h=harness({selectedDirectory:true,groupTitle:'',prefixMode:'manual'});
 await h.context.ResumeTrainingLabels.save({idno:'TEST1'},'systemRecommendedUnsuitable');
 await h.context.RecruitingPdfExporter.runDownloadCurrent();
 assert.deepEqual(h.fileWrites.map(f=>f.filename),['Manual_Test_104.pdf','AI訓練資料_系統推薦但不合適_Test.pdf']);
});
