(() => {
  const groups = {ranked:{title:'系統推薦',color:'green'},review_required:{title:'人工審核',color:'blue'}};
  let running = false;
  async function openProfiles(message, sender) {
    if (running) throw new Error('正在開啟履歷，請等待完成。');
    const source = new URL(sender.tab?.url || '');
    if (source.origin !== 'https://vip.104.com.tw' || source.pathname.toLowerCase() !== '/search/searchresult') throw new Error('請從 104 搜尋結果頁操作。');
    const profiles = message.profiles;
    if (!Array.isArray(profiles) || !profiles.length || profiles.length > 15) throw new Error('每批限開啟 1–15 份履歷。');
    const seen = new Set();
    for (const item of profiles) {
      const url = new URL(item.url);
      if (url.origin !== source.origin || !['/search/searchresumemaster','/resumetools/resumepreview','/document/master','/apply/applyresume'].includes(url.pathname.toLowerCase()) || !Object.prototype.hasOwnProperty.call(groups,item.status) || typeof item.resumeCode !== 'string' || seen.has(item.resumeCode)) throw new Error('履歷網址或分類不正確，未開啟分頁。');
      seen.add(item.resumeCode);
    }
    running = true;
    const openedCodes = [];
    try {
      if (globalThis.RecruitingWorkflow?.getState().running || globalThis.RecruitingPdfExporter?.getState().running || (await globalThis.RecruitingCollector?.getState())?.running) return {ok:false,openedCodes,error:'請等待複製或匯出完成後再開啟履歷群組。'};
      let lastTabId;
      // 保持每類的分數次序，先推薦後人工審核；不改動後端評分或判斷。
      for (const status of ['ranked','review_required']) {
        const config = groups[status];
        const existing = (await chrome.tabGroups.query({windowId:sender.tab.windowId})).find(group=>group.title === config.title);
        let groupId = existing?.id;
        for (const item of profiles.filter(profile=>profile.status===status)) {
          const tab = await chrome.tabs.create({windowId:sender.tab.windowId,url:item.url,active:false});
          // 已開啟即回報已讀，即使分組失敗也避免重開同一位。
          openedCodes.push(item.resumeCode);
          if (groupId === undefined) {
            groupId = await chrome.tabs.group({tabIds:[tab.id]});
            await chrome.tabGroups.update(groupId,config);
          } else await chrome.tabs.group({groupId,tabIds:[tab.id]});
          // 同群組有舊分頁時，明確將本批分頁接到群組尾端。
          const members = await chrome.tabs.query({groupId});
          const end = Math.max(...members.map(member=>member.index));
          if (Number.isFinite(end)) await chrome.tabs.move(tab.id,{index:end});
          lastTabId ??= tab.id;
        }
      }
      if (lastTabId) await chrome.tabs.update(lastTabId,{active:true});
      return {ok:true,openedCodes};
    } catch (_) { return {ok:false,openedCodes,error:'部分履歷已開啟，但未能完成分組；已開啟者已標為已讀，請確認分頁後再開啟下一批。'}; }
    finally { running=false; }
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type!=='TOOLKIT_OPEN_SCREENED_PROFILES')return false;
    openProfiles(message,sender).then(respond).catch(error=>respond({ok:false,openedCodes:[],error:error.message}));
    return true;
  });
  if(typeof module!=='undefined'&&module.exports)module.exports={openProfiles};
})();
