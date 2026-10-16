const test=require('node:test');const assert=require('node:assert/strict');
global.PDFLib=require('../vendor/pdf-lib-1.17.1.min.js');
const api=require('../training-pdf.js');
test('標註HTML保留完整原因與換行、空白顯示未填寫，所有輸入轉義',()=>{
 const reason='第一段\n第二段<script>alert(1)</script>'+ '完整原因'.repeat(1000);
 const html=api.coverHtml('Test',{label:'人工審核但需要推薦',reason});
 assert.ok(html.includes('第一段\n第二段&lt;script&gt;'));
 assert.ok(html.includes('完整原因'.repeat(1000)));
 assert.ok(!html.includes('<script>'));
 assert.ok(api.coverHtml('Test',{label:'人工審核但需要推薦',reason:''}).includes('未填寫'));
});
test('多頁標註在前、全部原始頁在後；頁數與完整答案可精確拆分且不改原始PDF',async()=>{
 const {PDFDocument}=PDFLib;
 const original=await PDFDocument.create();original.addPage([200,300]);original.addPage([201,301]);
 const cover=await PDFDocument.create();cover.addPage([400,500]);cover.addPage([401,501]);
 const bytes=await original.save();const before=Buffer.from(bytes);
 const result=await api.merge(bytes,await cover.save(),'Test',{label:'系統推薦但不合適',reason:'完整原因'.repeat(1000)});
 const merged=await PDFDocument.load(result);assert.equal(merged.getPageCount(),4);
 assert.deepEqual(merged.getPages().map(page=>page.getWidth()),[400,401,200,201]);
 const metadata=JSON.parse(merged.getSubject());assert.equal(metadata.annotationPages,2);
 assert.equal(metadata.reason,'完整原因'.repeat(1000));assert.equal(metadata.schema,'104-training-v1');
 assert.ok(before.equals(Buffer.from(bytes)));
});
