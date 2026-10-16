// 只接受使用者剛在搜尋頁點擊「開啟未讀高分履歷」後發出的批次。
(() => {
  let lastOpenClick = -Infinity;
  document.addEventListener('click', event => {
    if (event.isTrusted && event.target.closest?.('[data-screening-quick-open]')) lastOpenClick = Date.now();
  }, true);
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== '104-screening-request') return;
    if (Date.now() - lastOpenClick > 10000) return;
    lastOpenClick = -Infinity;
    let result;
    try { result = await chrome.runtime.sendMessage({type:'TOOLKIT_OPEN_SCREENED_PROFILES',requestId:data.requestId,profiles:data.profiles}); }
    catch (_) { result = {ok:false,error:'工作台連線失效，請重新整理 104 搜尋頁後重試。'}; }
    window.postMessage({source:'104-toolkit-response',requestId:data.requestId,result},location.origin);
  });
})();
