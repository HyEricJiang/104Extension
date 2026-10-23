(() => {
  const escape = text => String(text || '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function coverHtml(name, record) {
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>模型訓練標註</title><style>
    @page {size:A4;margin:20mm}*{box-sizing:border-box}body{margin:0;font:12pt/1.75 "PingFang TC","Microsoft JhengHei",sans-serif;color:#172b43}header{border-top:6px solid #153653;padding-top:16px;margin-bottom:22px}h1{font-size:24pt;margin:4px 0}h2{font-size:12pt;color:#52677d;margin:20px 0 5px;break-after:avoid}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}small{color:#52677d} .notice{margin-top:28px;border-top:1px solid #ccd6df;padding-top:14px;font-size:10pt;color:#52677d}
    </style></head><body><header><small>104 RECRUITING TOOLKIT · TRAINING ANNOTATION</small><h1>模型訓練標註</h1><small>人工標籤與錯位原因 · 非候選人原始履歷內容</small></header>
    <h2>人才姓名</h2><p>${escape(name)}</p><h2>人工標籤</h2><p>${escape(record.label)}</p><h2>錯位原因</h2><p>${escape(record.reason || '未填寫')}</p>
    <p class="notice">標註結束。後續頁面為原始履歷。準備訓練資料時，標註作為預期答案，原始履歷作為模型輸入；不要將本標註頁送入待判斷內容。</p></body></html>`;
  }
  async function merge(originalBytes, coverBytes, name, record) {
    const {PDFDocument}=globalThis.PDFLib;
    const original=await PDFDocument.load(originalBytes);
    const cover=await PDFDocument.load(coverBytes);
    const output=await PDFDocument.create();
    for(const page of await output.copyPages(cover,cover.getPageIndices()))output.addPage(page);
    for(const page of await output.copyPages(original,original.getPageIndices()))output.addPage(page);
    output.setTitle('AI訓練資料');
    // 邊界與答案同步留在 PDF 內，匯入工具可精確拆分；畫面仍以標註頁呈現完整內容。
    output.setSubject(JSON.stringify({schema:'104-training-v1',annotationPages:cover.getPageCount(),name,label:record.label,reason:record.reason||''}));
    return output.save();
  }
  async function prepend(originalBytes, debuggee, name, record) {
    const send=(method,params={})=>chrome.debugger.sendCommand(debuggee,method,params);
    // 原始 PDF 已取得並另存；清空這個即將關閉的背景預覽頁，避免網站腳本影響標註。
    await send('Page.navigate',{url:'about:blank'});
    let ready=false;
    for(let i=0;i<30;i++){
      const state=await send('Runtime.evaluate',{expression:'location.href === "about:blank" && document.readyState === "complete"',returnByValue:true});
      if(state.result?.value){ready=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ready)throw Error('訓練標註頁準備逾時；一般履歷已保留。');
    await send('Page.setBypassCSP',{enabled:true});
    const tree=await send('Page.getFrameTree');
    await send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:coverHtml(name,record)});
    const fonts=await send('Runtime.evaluate',{expression:'document.fonts.ready.then(() => true)',awaitPromise:true,returnByValue:true});
    if(fonts.exceptionDetails)throw Error('無法完成標註頁文字排版。');
    const result=await send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
    if(!result.data)throw Error('訓練標註頁未產生PDF。');
    const cover=Uint8Array.from(atob(result.data),char=>char.charCodeAt(0));
    return merge(originalBytes,cover,name,record);
  }
  globalThis.RecruitingTrainingPdf={coverHtml,merge,prepend};
  if(typeof module!=='undefined'&&module.exports)module.exports=globalThis.RecruitingTrainingPdf;
})();
