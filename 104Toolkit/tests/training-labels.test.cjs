const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../training-labels.js');
global.RecruitingOutputDirectory={getTarget:async()=>null};
let stored={};const downloads=[];
global.chrome={storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,value),remove:async key=>{delete stored[key];}}},downloads:{download:async opts=>{downloads.push(opts);return 1;}}};
test('搜尋頁與預覽頁的同一履歷使用同一識別；不同企業快照不混用',()=>{
 const a=api.parseResumeInfoFromUrl('https://vip.104.com.tw/search/SearchResumeMaster?idno=A');
 const b=api.parseResumeInfoFromUrl('https://vip.104.com.tw/ResumeTools/resumePreview?pageSource=search&searchEngineIdNos=A');
 assert.equal(api.identity(a),api.identity(b));
 assert.notEqual(api.identity({snapshotId:'1',ec:'A'}),api.identity({snapshotId:'1',ec:'B'}));
});
test('不同履歷同時保存互不覆蓋，同一履歷重新標記會更新',async()=>{
 await Promise.all([api.save({idno:'A'},'systemRecommendedUnsuitable'),api.save({idno:'B'},'reviewedShouldExclude')]);
 assert.equal((await api.read({idno:'A'})).label,'系統推薦但不合適');
 assert.equal((await api.read({idno:'B'})).label,'人工審核但應該排除');
 await api.save({idno:'A'},'wronglyExcludedNeedsReview');
 assert.equal((await api.read({idno:'A'})).label,'不應排除需人工審核');
});
test('未標記與未知分類不會被誤認為有效資料',async()=>{
 assert.equal(await api.read({idno:'C'}),null);
 await assert.rejects(api.save({idno:'C'},'__proto__'),/不支援/);
});
test('移除只清除此履歷，重複移除安全且不影響其他標記',async()=>{
 await api.save({idno:'REMOVE_A'},'reviewedShouldRecommend');
 await api.save({idno:'REMOVE_B'},'reviewedShouldExclude');
 const exportsBefore=JSON.stringify(stored.resume_training_last_export_v1);
 await api.remove({idno:'REMOVE_A'});
 await api.remove({idno:'REMOVE_A'});
 assert.equal(await api.read({idno:'REMOVE_A'}),null);
 assert.equal((await api.read({idno:'REMOVE_B'})).label,'人工審核但應該排除');
 assert.equal(JSON.stringify(stored.resume_training_last_export_v1),exportsBefore);
});

test('舊標籤沒有原因可正常讀取；更換標籤保留原因，清空原因保留標籤',async()=>{
 stored['resume_training_label_v1:search:LEGACY']={categoryId:'systemRecommendedUnsuitable'};
 assert.equal((await api.read({idno:'LEGACY'})).reason,'');
 await api.saveReason({idno:'LEGACY'},'缺乏Java經驗');
 await api.save({idno:'LEGACY'},'reviewedShouldExclude');
 assert.equal((await api.read({idno:'LEGACY'})).reason,'缺乏Java經驗');
 await api.saveReason({idno:'LEGACY'},'');
 assert.equal((await api.read({idno:'LEGACY'})).reason,'');
 assert.equal((await api.read({idno:'LEGACY'})).categoryId,'reviewedShouldExclude');
});
test('先輸入原因再下標籤，以及快速修改，皆保留最後內容且不影響其他履歷',async()=>{
 await Promise.all([api.saveReason({idno:'DRAFT'},'原'),api.saveReason({idno:'DRAFT'},'修改後'),api.save({idno:'DRAFT'},'reviewedShouldRecommend')]);
 const draft=await api.read({idno:'DRAFT'});
 assert.equal(draft.reason,'修改後');
 assert.equal(draft.categoryId,'reviewedShouldRecommend');
 await api.saveReason({idno:'ONLY_REASON'},'尚未分類');
 assert.equal((await api.read({idno:'ONLY_REASON'})).label,'');
 assert.equal(api.trainingFilename('Test',await api.read({idno:'ONLY_REASON'})),null);
 await assert.rejects(api.saveReason({idno:'DRAFT'},'a'.repeat(10001)),/10000/);
});
test('訓練檔名僅姓名，標籤與原因移至PDF標註頁，原因長度不影響檔名',()=>{
 const record={label:'系統推薦但不合適',reason:'經驗不足'.repeat(1000)};
 assert.equal(api.trainingFilename('Test',record),'AI訓練資料_Test.pdf');
 assert.equal(api.trainingFilename('Test',{...record,reason:''}),'AI訓練資料_Test.pdf');
 assert.equal(api.trainingFilename('A/B',record),'AI訓練資料_A_B.pdf');
});
