const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../104-hide-resume-cards.user.js'), 'utf8');

// 用虛構代碼、虛擬時間及 DOM 狀態模擬慢載入,不連線 104。
function harness(options = {}) {
  let time = 0, sleeps = 0, page = 1, signature = '90000001|90000002', clicked = 0;
  let onSleep = options.onSleep || (() => {});
  const listeners = new Map();
  function node() {
    const n = { style: {}, dataset: {}, children: [],
      addEventListener() {}, append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); },
      setAttribute() {}, removeAttribute() {}, querySelector(selector) { return this.parts?.[selector] || null; }
    };
    Object.defineProperty(n, 'innerHTML', { get() { return this.html || ''; }, set(html) {
      this.html = html; this.parts = {};
      for (const attr of html.matchAll(/\b(data-screening-[\w-]+)/g)) this.parts[`[${attr[1]}]`] = node();
    }});
    return n;
  }
  const next = { textContent: '下一頁', disabled: false, classList: { contains: () => false },
    getAttribute: () => '', closest: () => null, scrollIntoView() {}, click() { clicked += 1; } };
  let showNext = options.showNext !== false;
  let displayedTotal = options.total || 0;
  const requests = [];
  const doc = { hidden: false, body: node(), head: node(), documentElement: { scrollHeight: 1000 },
    scrollingElement: { scrollHeight: 1000 }, createElement: node, getElementById: () => null,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    querySelector(selector) {
      if (selector.includes('resumeCard')) return {};
      if (options.profileHref && selector.includes('aria-current')) return null;
      if (options.profileHref) return { getAttribute: () => options.profileHref };
      return selector.includes('aria-current') ? { textContent: String(page) } : null;
    },
    querySelectorAll(selector) {
      if (selector === 'span, div') return displayedTotal ? [{textContent:`共 ${displayedTotal} 筆`}] : [];
      if (selector.includes('.code')) return signature.split('|').filter(Boolean).map(code => ({ textContent: code }));
      if (selector.startsWith('.pagination') || selector === 'button, a') return showNext ? [next] : [];
      return [];
    }
  };
  const win = { scrollY: 0, innerHeight: 1000, addEventListener() {}, scrollTo(x, y) { this.scrollY = Math.max(0, Math.min(y, 0)); } };
  class ClockDate extends Date { static now() { return time; } }
  const ctx = { __RESUME_SCREENING_TEST_MODE__: true, document: doc, window: win,
    location: { pathname: '/test-fixture', origin: 'https://example.invalid' },
    console: {log(){},warn(){},error(){}}, Date: ClockDate,
    GM_xmlhttpRequest(request) {
      const input=JSON.parse(request.data); requests.push(input);
      request.onload({responseText:JSON.stringify({ok:true,screeningMode:'comprehensive',results:input.cards.map(card=>({resumeCode:card.resumeCode,status:'ranked',score:50}))})});
    }, localStorage: { getItem: () => null, removeItem() {} },
    setTimeout(resolve, delay) {
      sleeps += 1; time += options.timerDelay || delay;
      if (sleeps > 2000) throw new Error('fixture runaway');
      onSleep({ time, sleeps }); resolve();
    }
  };
  vm.createContext(ctx); vm.runInContext(source.replace('Object.freeze({currentPageNumber,', 'Object.freeze({cancelScan:()=>{scanCancellationRequested=true;},currentPageNumber,'), ctx);
  return { api: ctx.__RESUME_SCREENING_TEST_API__, doc, listeners, requests,
    set total(value) { displayedTotal = value; },
    advance(ms) { time += ms; }, get time() { return time; }, get clicked() { return clicked; },
    set signature(value) { signature = value; }, set page(value) { page = value; },
    set showNext(value) { showNext = value; }, set onSleep(fn) { onSleep = fn; },
    visibility(hidden) { doc.hidden = hidden; listeners.get('visibilitychange')?.(); }
  };
}
const cards = count => new Map(Array.from({ length: count }, (_, i) => [String(90000001 + i), {resumeCode:String(90000001 + i)}]));

test('持續增加資料超過原本 22 秒仍不逾時', () => {
  const h = harness(); const clock = h.api.createScanClock();
  const watchdog = h.api.createProgressWatchdog(22000, clock.now);
  for (let i = 0; i < 300; i += 1) { h.advance(1000); assert.equal(watchdog.stalled(String(i)), false); }
  assert.ok(h.time > 22000); clock.dispose(); assert.equal(h.listeners.size, 0);
});
test('背景十分鐘不消耗停滯額度,回到前景後才判斷真停滯', () => {
  const h = harness(); const clock = h.api.createScanClock(); const watchdog = h.api.createProgressWatchdog(22000, clock.now);
  assert.equal(watchdog.stalled('50'), false);
  h.visibility(true); h.advance(600000); assert.equal(watchdog.stalled('50'), false);
  h.visibility(false);
  for (let i = 0; i < 4; i++) { h.advance(5000); assert.equal(watchdog.stalled('50'), false); }
  h.advance(2001); assert.equal(watchdog.stalled('50'), true);
});
test('總數不符保留差異但可評分；未知總數標記未確認', () => {
  const h = harness();
  const partial=h.api.finalizeCollection(cards(749),972);
  assert.equal(partial.complete,false);assert.equal(partial.difference,223);
  assert.equal(h.api.finalizeCollection(cards(50),0).complete,false);
  assert.equal(h.api.finalizeCollection(cards(972),972).complete,true);
  assert.equal(h.api.finalizeCollection(cards(50),0,true).complete,true);
});
test('慢載入 972 份、超過 22 秒時收集持續進行至總數達標', async () => {
  const h = harness(); const map = cards(50);
  h.onSleep = ({ sleeps }) => {
    if (sleeps % 2 === 0 && map.size < 972) {
      const nextSize = Math.min(972, map.size + 20);
      while (map.size < nextSize) map.set(String(90000001 + map.size), {});
      h.signature = [...map.keys()].join('|');
    }
  };
  await h.api.scrollUntilStable(map, 972);
  assert.ok(h.time > 22000); assert.equal(map.size, 972);
  assert.doesNotThrow(() => h.api.finalizeCollection(map, 972));
});
test('翻頁不以頁碼先改或同頁新增卡片作為換頁成功', () => {
  const { api } = harness();
  assert.equal(api.pageTransitionReady('1|2', '1|2', 1, 2), false);
  assert.equal(api.pageTransitionReady('1|2', '1|2|3', 1, 1), false);
  assert.equal(api.pageTransitionReady('1|2', '3|4', 1, 2), true);
  assert.equal(api.pageTransitionReady('1|2', '3|4', 1, 1), true);
});
test('切分頁後翻頁延遲逾 14 秒仍等到新卡片,不以第一頁結算', async () => {
  const h = harness({ timerDelay: 60000 }); const map = cards(50); const clock = h.api.createScanClock();
  h.visibility(true);
  h.onSleep = ({ sleeps }) => { if (sleeps === 4) { h.page = 2; h.signature = '91000001|91000002'; } };
  assert.equal(await h.api.goNextPage(map, 972, clock), true);
  assert.equal(h.clicked, 1); assert.ok(h.time >= 240000);
  assert.equal(h.api.finalizeCollection(map, 972).complete, false);
});
test('已知還缺資料但下一頁按鈕延遲出現時繼續等待', async () => {
  const h = harness({ showNext: false }); const clock = h.api.createScanClock();
  h.onSleep = ({ sleeps }) => {
    if (sleeps === 3) h.showNext = true;
    if (sleeps === 5) { h.page = 2; h.signature = '91000001'; }
  };
  assert.equal(await h.api.goNextPage(cards(50), 972, clock), true);
  assert.equal(h.clicked, 1);
});
test('前景真正卡住翻頁時回報未完成,不回傳末頁成功', async () => {
  const h = harness({ showNext: false }); const clock = h.api.createScanClock();
  await assert.rejects(h.api.goNextPage(cards(50), 972, clock), /尚未找到可用的下一頁/);
});
test('收集停滯後可進第二階段；進度持續時沒有固定總耗時截斷', () => {
  const scan = source.slice(source.indexOf('  async function scan()'));
  assert.ok(scan.indexOf('await collectSearchResults(') < scan.indexOf('await enrichResumeDetails('));
  assert.doesNotMatch(source, /先用目前已(?:載入|收集)履歷結算|Date\.now\(\) - startedAt|batch <= expectedPages/);
});
test('單頁只載入 30 份時不能因頁尾穩定跳過另外 20 份', async () => {
  const h = harness(); const map = cards(30); h.signature = [...map.keys()].join('|');
  h.onSleep = ({ time }) => {
    if (time >= 30000 && map.size < 50) {
      while (map.size < 50) map.set(String(90000001 + map.size), {});
      h.signature = [...map.keys()].join('|');
    }
  };
  await h.api.scrollUntilStable(map, 100);
  assert.equal(map.size, 50); assert.ok(h.time >= 30000);
  assert.equal(h.api.finalizeCollection(map, 100).difference, 50);
});

test('頁碼可從編碼連結取得,不完整 URL 編碼不造成中斷', () => {
  assert.equal(harness({ profileHref: '%7B%22page%22%3A%20%2017%7D' }).api.currentPageNumber(), 17);
  assert.doesNotThrow(() => harness({ profileHref: '%bad%url' }).api.currentPageNumber());
});


test('985/987下一頁停滯後保留985份並實際送入評分，不罷工', async()=>{
  const h=harness({total:987}); const map=cards(985);h.signature=[...map.keys()].slice(0,50).join('|');
  const outcome=await h.api.collectSearchResults(map);
  assert.equal(outcome.collected,985);assert.equal(outcome.difference,2);assert.equal(outcome.complete,false);
  assert.match(outcome.reason,/下一頁/);
  const enrichment=await h.api.enrichResumeDetails([...map.values()]);
  assert.equal(enrichment.requested,0);
  const ranking=await h.api.rankCandidates([...map.values()]);
  assert.equal(ranking.allResults.length,985);
  assert.equal(h.requests.reduce((sum,r)=>sum+r.cards.length,0),985);
  assert.equal(new Set(h.requests.flatMap(r=>r.cards.map(c=>c.resumeCode))).size,985);
});
test('總數987降至986且986張含1重複，顯示差異而非宣稱全收齊',async()=>{
  const h=harness({total:987}); const map=cards(985);
  h.signature=[...map.keys(),[...map.keys()][0]].join('|');
  h.onSleep=()=>{h.total=986;};
  const outcome=await h.api.collectSearchResults(map);
  assert.equal(outcome.initialTotal,987);assert.equal(outcome.total,986);
  assert.equal(outcome.duplicateCards,1);assert.equal(outcome.difference,1);
  const message=h.api.collectionNotice(outcome);
  assert.match(message,/重複卡片/);assert.match(message,/987 改為 986/);assert.match(message,/未取得者未評分/);
  assert.match(h.api.collectionNoticeMarkup(outcome),/data-collection-notice/);
});
test('尚缺很多且沒有下一頁也接續評分，不能只容忍少量差額',async()=>{
  const h=harness({total:972,showNext:false});
  const outcome=await h.api.collectSearchResults(cards(50));
  assert.equal(outcome.collected,50);assert.equal(outcome.difference,922);assert.equal(outcome.complete,false);
});
test('有持續進度超過舊逾時仍收至總數，不提前評分',async()=>{
  const h=harness({total:972});const map=cards(50);
  h.onSleep=({sleeps})=>{if(sleeps%2===0){while(map.size<Math.min(972,50+10*sleeps))map.set(String(90000001+map.size),{resumeCode:String(90000001+map.size)});h.signature=[...map.keys()].join('|');}};
  const outcome=await h.api.collectSearchResults(map);
  assert.equal(outcome.collected,972);assert.equal(outcome.complete,true);assert.ok(h.time>22000);
});
test('使用者主動中止仍尊重，不將取消當停滯送出評分',async()=>{
  const h=harness({total:987});h.onSleep=()=>h.api.cancelScan();
  await assert.rejects(h.api.collectSearchResults(cards(50)),/SCAN_CANCELLED/);assert.equal(h.requests.length,0);
});
test('完全沒有資料仍給可處理的錯誤，不能冒稱已評分',()=>{
  const h=harness();assert.throws(()=>h.api.finalizeCollection(cards(0),987),/未取得任何履歷/);
});

test('單頁30份卡住仍嘗試下一頁，不直接放棄後續頁面',async()=>{
  const h=harness({total:100}); const map=cards(30);h.signature=[...map.keys()].join('|');
  let completedPage=0;
  h.onSleep=()=>{if(h.clicked>completedPage){completedPage=h.clicked;const target=h.clicked===1?80:100;while(map.size<target)map.set(String(90000001+map.size),{resumeCode:String(90000001+map.size)});h.page=h.clicked+1;h.signature=[...map.keys()].slice(-50).join('|');}};
  const outcome=await h.api.collectSearchResults(map);
  assert.ok(h.clicked>=1);assert.equal(outcome.collected,100);assert.equal(outcome.complete,true);
});
