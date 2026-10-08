const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', '104-hide-resume-cards.user.js'), 'utf8');

// 以虛構資料驗證請求、分類、標籤及掃描提示，沒有真實履歷或外部請求。
function harness(reply) {
  const requests = [], nodes = [];
  function node() {
    const n = {style:{}, dataset:{}, children:[], listeners:{},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); },
      setAttribute() {}, removeAttribute() {},
      querySelector(selector) { return this.parts?.[selector] || null; }
    };
    nodes.push(n);
    Object.defineProperty(n, 'innerHTML', {set(html) {
      this.html = html; this.parts = {};
      for (const attr of html.matchAll(/\b(data-screening-[\w-]+)/g)) this.parts[`[${attr[1]}]`] = node();
    }, get() {return this.html || '';}});
    return n;
  }
  const doc = {body:node(), head:node(), createElement:node, getElementById:()=>null, addEventListener() {}};
  const ctx = {__RESUME_SCREENING_TEST_MODE__:true, document:doc,
    window:{addEventListener() {}}, localStorage:{getItem:()=>null,removeItem() {}},console,
    GM_xmlhttpRequest(request) {
      requests.push(request);
      const input = request.data ? JSON.parse(request.data) : {action:'health'};
      const response = reply(input, requests.length);
      request.onload({responseText:JSON.stringify(response)});
    }
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {api:ctx.__RESUME_SCREENING_TEST_API__,requests,doc,nodes};
}
const health = {ok:true,mode:'private_backend',screeningMode:'comprehensive',version:'5.0.7'};
const candidate = (i) => ({resumeCode:`fake-${i}`,candidateName:`虛構${i}`,profileUrl:`https://vip.104.com.tw/fake/${i}`,jobLines:['虛構公司 C# ASP.NET 開發']});

test('面板直接提供綜合篩選，無職缺選單；掃描提示可正常開關', () => {
  const {api,doc} = harness(()=>health);api.mountPanel();
  const panel = doc.body.children.find(n=>n.id==='resume-screening-104-panel');
  assert.match(panel.innerHTML,/綜合篩選 Java／C#／SA／QA/);
  assert.doesNotMatch(panel.innerHTML,/<select|data-role|請選擇/);
  assert.match(panel.innerHTML,/v5\.0\.7/);
  api.setScanningIndicator(true);assert.equal(panel.parts['[data-screening-casting]'].style.display,'flex');
  api.setScanningIndicator(false);assert.equal(panel.parts['[data-screening-casting]'].style.display,'none');
});
test('health 接受綜合服務，舊單職位服務停止並給版本提示', async () => {
  await harness(()=>health).api.loadSharedRules();
  await assert.rejects(harness(()=>({...health,screeningMode:undefined})).api.loadSharedRules(),/四職位綜合篩選/);
});
test('不傳職位參數；26筆分批，保留C#與SA推薦及待確認標籤，姓名連結留在前端', async () => {
  const h = harness(input=>({ok:true,screeningMode:'comprehensive',results:input.cards.map(c=>({resumeCode:c.resumeCode,status:'ranked',score:17,displayTags:['#適合C#/.NET','#適合SA','#待確認Java'],recommendedRoles:[{id:'csharp-dotnet-programmer'},{id:'system-analyst'}],displayTagDetails:{'#適合SA':'需求分析'}}))}));
  const result = await h.api.rankCandidates(Array.from({length:26},(_,i)=>candidate(i)));
  assert.equal(h.requests.length,2);
  for (const req of h.requests) {
    const input = JSON.parse(req.data);assert.equal(input.action,'screen');assert.equal('roleId' in input,false);
    for (const c of input.cards) {assert.equal('candidateName' in c,false);assert.equal('profileUrl' in c,false);}
  }
  assert.equal(result.ranked.length,26);assert.equal(result.ranked[0].candidateName,'虛構0');
  assert.equal(result.ranked[0].displayTags[1],'#適合SA');
  assert.equal(result.ranked[0].recommendedRoles.length,2);
});
test('三類結果按後端原分類保留，排除0分與前端跳過保持分開', async () => {
  const h = harness(input=>({ok:true,screeningMode:'comprehensive',results:input.cards.map((c,i)=>({resumeCode:c.resumeCode,status:['ranked','review_required','excluded'][i],score:[12,8,0][i]}))}));
  const r=await h.api.rankCandidates([candidate(0),candidate(1),candidate(2)]);
  assert.equal(r.ranked.length,1);assert.equal(r.reviewRequired.length,1);assert.equal(r.excluded[0].score,0);
  const groups=h.api.mergeScoredAndSkippedResults(r,[{resumeCode:'skipped',status:'excluded',clientSkipped:true,score:null}]);
  assert.equal(groups.excluded.length,1);assert.equal(groups.skipped.length,1);assert.equal(groups.all.length,4);
});
test('評分回應若退回單職位，停止使用結果', async () => {
  const h=harness(input=>({ok:true,results:input.cards.map(c=>({resumeCode:c.resumeCode,status:'ranked'}))}));
  await assert.rejects(h.api.rankCandidates([candidate(0)]),/未回傳綜合篩選結果/);
});
test('數量錯誤與錯誤履歷ID停止顯示，避免把結果套到別人', async () => {
  await assert.rejects(harness(()=>({ok:true,screeningMode:'comprehensive',results:[]})).api.rankCandidates([candidate(0)]),/筆數不符/);
  await assert.rejects(harness(()=>({ok:true,screeningMode:'comprehensive',results:[{resumeCode:'wrong',status:'ranked'}]})).api.rankCandidates([candidate(0)]),/履歷對應不符/);
});
