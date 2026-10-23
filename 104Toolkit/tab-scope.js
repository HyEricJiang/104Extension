(() => {
  function isResume(url) {
    try { const parsed=new URL(url);return parsed.origin==='https://vip.104.com.tw'&&['/search/searchresumemaster','/resumetools/resumepreview','/document/master','/apply/applyresume'].includes(parsed.pathname.toLowerCase()); }
    catch (_) {return false;}
  }
  function selectRight(tabs, originId) {
    const origin=tabs.find(tab=>tab.id===originId);
    if(!origin||!isResume(origin.url))throw Error('請從要開始處理的 104 履歷分頁執行。');
    const sorted=tabs.filter(tab=>tab.windowId===origin.windowId).sort((a,b)=>a.index-b.index);
    const targets=[];
    for(let i=sorted.findIndex(tab=>tab.id===originId);i<sorted.length;i++){
      if(!isResume(sorted[i].url))break;
      targets.push({...sorted[i]});
    }
    return targets;
  }
  async function capture(originId) {
    if(!originId){const [active]=await chrome.tabs.query({active:true,currentWindow:true});originId=active?.id;}
    return selectRight(await chrome.tabs.query({}),originId);
  }
  globalThis.RecruitingTabScope={capture,selectRight,isResume};
  if(typeof module!=='undefined'&&module.exports)module.exports=globalThis.RecruitingTabScope;
})();
