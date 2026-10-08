const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../training-labels.js');
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
test('CSV 含 BOM、完整引號轉義及公式注入防護',()=>{
 const csv=api.toCsv([{pdfFilename:'="危險",\n.pdf',trainingLabel:'人工審核但需要推薦'}]);
 assert.ok(csv.startsWith('\uFEFF'));
 assert.ok(csv.includes('"\'=\"\"危險\"\",\n.pdf"'));
 assert.ok(csv.includes('人工審核但需要推薦'));
});
test('分類清單保存可重下載；空清單不產生誤導檔案',async()=>{
 const rows=[{pdfFilename:'Jr.Java PG_Test.pdf',jobTitle:'Jr.Java PG',trainingLabel:'未分類'}];
 await api.downloadReport(rows,'104履歷下載區/');
 await api.downloadLastReport();
 assert.equal(downloads.length,2);
 assert.equal(downloads[1].url,downloads[0].url);
 assert.ok(downloads[0].filename.startsWith('104履歷下載區/training-labels_'));
 await assert.rejects(api.downloadReport([]),/尚無/);
});

test('分類清單下載失敗後可重試最新清單，不誤下載上一批',async()=>{
 const rows=[{pdfFilename:'latest.pdf',resumeKey:'search:latest',trainingLabel:'不應排除應推薦'}];
 chrome.downloads.download=async()=>{throw Error('下載遭拒');};
 await assert.rejects(api.downloadReport(rows),/下載遭拒/);
 let retried;
 chrome.downloads.download=async options=>{retried=options;return 3;};
 await api.downloadLastReport();
 assert.ok(decodeURIComponent(retried.url).includes('latest.pdf'));
 assert.ok(decodeURIComponent(retried.url).includes('不應排除應推薦'));
});

test('移除只清除此履歷，重複移除安全且不影響其他標記與匯出清單',async()=>{
 await api.save({idno:'REMOVE_A'},'reviewedShouldRecommend');
 await api.save({idno:'REMOVE_B'},'reviewedShouldExclude');
 const exportsBefore=JSON.stringify(stored.resume_training_last_export_v1);
 await api.remove({idno:'REMOVE_A'});
 await api.remove({idno:'REMOVE_A'});
 assert.equal(await api.read({idno:'REMOVE_A'}),null);
 assert.equal((await api.read({idno:'REMOVE_B'})).label,'人工審核但應該排除');
 assert.equal(JSON.stringify(stored.resume_training_last_export_v1),exportsBefore);
});
